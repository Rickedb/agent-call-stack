import * as assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { test } from 'node:test'

import { KEEP, normalize, resultText, spill } from '../record'
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
