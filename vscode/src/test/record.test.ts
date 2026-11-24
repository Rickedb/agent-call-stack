import * as assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { test } from 'node:test'

import { KEEP, normalize, resultText, spill, touchOf } from '../record'
import type { Ev } from '../types'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'call-tree-'))

test('a snake_case PreToolUse becomes a tool_pre with its arguments read', () => {
  const ev = normalize(
    'PreToolUse',
    {
      session_id: 's1',
      cwd: '/w',
      tool_name: 'run_in_terminal',
      tool_input: { command: 'npm test', explanation: 'x' },
      tool_use_id: 'u1',
    },
    100,
  ) as Ev
  assert.equal(ev.kind, 'tool_pre')
  assert.equal(ev.sid, 's1')
  assert.equal(ev.toolUseId, 'u1')
  assert.equal(ev.arg, 'npm test')
  assert.match(ev.input ?? '', /command: npm test/)
  assert.ok(ev.fp)
})

test('a camelCase payload, with its arguments as a JSON string, reads the same', () => {
  const ev = normalize(
    'preToolUse',
    { sessionId: 's2', toolName: 'view', toolArgs: JSON.stringify({ path: '/a/b.ts' }) },
    1,
  ) as Ev
  assert.equal(ev.kind, 'tool_pre')
  assert.equal(ev.sid, 's2')
  assert.equal(ev.arg, '/a/b.ts')
})

test('results and failures are read from every shape the hosts use', () => {
  const ok = normalize(
    'PostToolUse',
    { session_id: 's', tool_name: 'x', tool_input: {}, tool_result: { result_type: 'success', text_result_for_llm: 'two files' } },
    1,
  ) as Ev
  assert.equal(ok.kind, 'tool_post')
  assert.equal(ok.output, 'two files')

  const camel = normalize('postToolUse', { sessionId: 's', toolName: 'x', toolResult: { textResultForLlm: 'camel' } }, 1) as Ev
  assert.equal(camel.output, 'camel')

  const vs = normalize('PostToolUse', { session_id: 's', tool_name: 'x', tool_response: 'plain' }, 1) as Ev
  assert.equal(vs.output, 'plain')

  const fail = normalize('PostToolUseFailure', { session_id: 's', tool_name: 'x', error: 'boom' }, 1) as Ev
  assert.equal(fail.kind, 'tool_fail')
  assert.equal(fail.output, 'boom')

  assert.equal(resultText([{ text: 'a' }, { text: 'b' }]), 'a\nb')
})

test('the event name comes from argv, else from the payload', () => {
  assert.equal(normalize('', { hook_event_name: 'Stop', session_id: 's' }, 1)?.kind, 'stop')
  assert.equal(normalize('Nope', { session_id: 's' }, 1), null)
})

test('a Stop inside a subagent ends the subagent, not the prompt', () => {
  assert.equal(normalize('Stop', { session_id: 's', agent_id: 'a1' }, 1)?.kind, 'agent_stop')
})

test('a spawn tool call carries the description and prompt for its subagent', () => {
  const ev = normalize(
    'PreToolUse',
    { session_id: 's', tool_name: 'runSubagent', tool_input: { description: 'find auth', prompt: 'look for login code' } },
    1,
  ) as Ev
  assert.equal(ev.arg, 'find auth')
  assert.equal(ev.input, 'look for login code')
})

test('the chat commands of this extension are not recorded as prompts', () => {
  assert.equal(normalize('UserPromptSubmit', { session_id: 's', prompt: '@calltree' }, 1), null)
  assert.ok(normalize('UserPromptSubmit', { session_id: 's', prompt: 'fix it' }, 1))
})

test('a long text is cut in the event and kept whole in a file', () => {
  const dir = tmp()
  const ev = spill({ v: 1, t: 5, sid: 's/1', kind: 'tool_post', output: 'x'.repeat(50000) }, dir)
  assert.equal(ev.output?.length, KEEP)
  assert.equal(ev.outputLen, 50000)
  assert.ok(ev.outputFile?.startsWith(path.join(dir, 'blobs')))
  assert.equal(fs.readFileSync(ev.outputFile as string, 'utf8').length, 50000)
})

test('the script writes a line per event, prints {}, and survives garbage', () => {
  const dir = tmp()
  const script = path.join(__dirname, '..', 'record.js')
  const run = (event: string, input: string) =>
    spawnSync(process.execPath, [script, event], { input, env: { ...process.env, AI_CALL_STACK_DIR: dir } })

  const a = run('UserPromptSubmit', JSON.stringify({ session_id: 'sess', cwd: '/w', prompt: 'hello' }))
  assert.equal(a.status, 0)
  assert.equal(a.stdout.toString(), '{}')

  const b = run('PreToolUse', 'this is not json')
  assert.equal(b.status, 0)
  assert.equal(b.stdout.toString(), '{}')

  const c = run('PreToolUse', '')
  assert.equal(c.status, 0)

  const lines = fs.readFileSync(path.join(dir, 'events', 'sess.jsonl'), 'utf8').trim().split('\n')
  assert.equal(lines.length, 1)
  assert.equal((JSON.parse(lines[0] as string) as Ev).arg, 'hello')
})

test('the lines a call added and took out are read from its arguments', () => {
  const changes = (tool: string, args: Record<string, unknown>) => touchOf(tool, args)?.changes
  // An edit counts the lines that differ: what the two texts share at the start and the end is left out.
  assert.deepEqual(changes('Edit', { file_path: '/p/a.ts', old_string: 'a\nb\nc', new_string: 'a\nB\nB2\nc' }), [
    { path: '/p/a.ts', added: 2, removed: 1 },
  ])
  assert.deepEqual(changes('Edit', { file_path: '/p/a.ts', old_string: 'a\nb\n', new_string: '' }), [{ path: '/p/a.ts', added: 0, removed: 2 }])
  assert.equal(changes('Edit', { file_path: '/p/a.ts', old_string: 'x', new_string: 'x' }), undefined)
  // A list of edits to one file.
  assert.deepEqual(
    changes('MultiEdit', { file_path: '/p/a.ts', edits: [{ old_string: 'a', new_string: 'b' }, { old_string: '', new_string: 'x\ny' }] }),
    [{ path: '/p/a.ts', added: 3, removed: 1 }],
  )
  // A text written whole counts as added: the call does not say what was there.
  assert.deepEqual(changes('Write', { file_path: '/p/n.ts', content: 'a\nb\nc\n' }), [{ path: '/p/n.ts', added: 3, removed: 0 }])
  // Copilot's tools: a replacement per file, a created file, code inserted between "existing code" marks.
  assert.deepEqual(
    changes('multi_replace_string_in_file', {
      replacements: [
        { filePath: '/p/a.ts', oldString: 'x', newString: 'y\nz' },
        { filePath: '/p/b.ts', oldString: 'q\nr', newString: '' },
        { filePath: '/p/a.ts', oldString: 'm', newString: 'n' },
      ],
    }),
    [
      { path: '/p/a.ts', added: 3, removed: 2 },
      { path: '/p/b.ts', added: 0, removed: 2 },
    ],
  )
  assert.deepEqual(changes('create_file', { filePath: '/p/b.ts', content: 'one\ntwo' }), [{ path: '/p/b.ts', added: 2, removed: 0 }])
  assert.deepEqual(
    changes('insert_edit_into_file', { filePath: '/p/a.ts', code: '// ...existing code...\nconst x = 1\n// ...existing code...' }),
    [{ path: '/p/a.ts', added: 1, removed: 0 }],
  )
  // A patch names its files itself.
  const patch = touchOf('apply_patch', {
    input: '*** Begin Patch\n*** Update File: /p/a.ts\n@@\n keep\n-old\n+new\n+more\n*** Add File: /p/c.ts\n+hello\n*** End Patch',
  })
  assert.deepEqual(patch?.paths, ['/p/a.ts', '/p/c.ts'])
  assert.deepEqual(patch?.changes, [
    { path: '/p/a.ts', added: 2, removed: 1 },
    { path: '/p/c.ts', added: 1, removed: 0 },
  ])
  // A read has no lines to count.
  assert.equal(touchOf('Read', { file_path: '/p/a.ts' })?.changes, undefined)
})

test('the addresses a fetch was given are kept', () => {
  assert.deepEqual(touchOf('WebFetch', { url: 'https://x.dev/a', prompt: 'summarize' }), { op: 'web', paths: [], what: 'https://x.dev/a', links: ['https://x.dev/a'] })
  assert.deepEqual(touchOf('fetch_webpage', { urls: ['https://a.dev', 'https://b.dev', 'https://a.dev'], query: 'q' })?.links, ['https://a.dev', 'https://b.dev'])
  // A search has a query, not an address.
  assert.deepEqual(touchOf('WebSearch', { query: 'tsc noEmit' }), { op: 'web', paths: [], what: 'tsc noEmit' })
})
