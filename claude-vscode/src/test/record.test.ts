import * as assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { test } from 'node:test'

import { failureWord, normalize, resultText, spill, touchOf, KEEP } from '../record'
import type { Ev } from '../types'

const base = { session_id: 's1', transcript_path: '/t/s1.jsonl', cwd: '/w' }

test('a prompt, its tool call and result are read from Claude Code snake_case payloads', () => {
  const prompt = normalize('UserPromptSubmit', { ...base, prompt: 'list files' }, 1) as Ev
  assert.deepEqual([prompt.kind, prompt.sid, prompt.cwd, prompt.transcript, prompt.input], ['prompt', 's1', '/w', '/t/s1.jsonl', 'list files'])

  const pre = normalize('PreToolUse', { ...base, tool_name: 'Bash', tool_input: { command: 'ls -la' }, tool_use_id: 'u1' }, 2) as Ev
  assert.deepEqual([pre.kind, pre.tool, pre.toolUseId, pre.arg], ['tool_pre', 'Bash', 'u1', 'ls -la'])
  assert.match(pre.input ?? '', /command: ls -la/)
  assert.deepEqual(pre.touch, { op: 'run', paths: [], what: 'ls -la' })

  const post = normalize(
    'PostToolUse',
    { ...base, tool_name: 'Bash', tool_input: { command: 'ls' }, tool_response: { stdout: 'a\nb', stderr: 'warn' }, tool_use_id: 'u1', duration_ms: 42 },
    3,
  ) as Ev
  assert.equal(post.kind, 'tool_post')
  assert.equal(post.output, 'a\nb\nwarn')
  assert.equal(post.durationMs, 42)

  const fail = normalize('PostToolUseFailure', { ...base, tool_name: 'Bash', tool_input: {}, tool_use_id: 'u2', error: 'exit 1', is_interrupt: false, duration_ms: 7 }, 4) as Ev
  assert.deepEqual([fail.kind, fail.output, fail.durationMs], ['tool_fail', 'exit 1', 7])
})

test('a file read result is its content; other shapes are kept whole', () => {
  assert.equal(resultText({ type: 'text', file: { filePath: '/a', content: 'hello' } }), 'hello')
  assert.equal(resultText('plain'), 'plain')
  assert.equal(resultText([{ text: 'a' }, { text: 'b' }]), 'a\nb')
  assert.equal(resultText(undefined), '')
  assert.match(resultText({ filePath: '/a', structuredPatch: [] }), /structuredPatch/)
})

test('a subagent call, a spawn call, and a stop keep what names them', () => {
  const inside = normalize('PreToolUse', { ...base, tool_name: 'Grep', tool_input: { pattern: 'x' }, tool_use_id: 'u', agent_id: 'ag1', agent_type: 'Explore' }, 1) as Ev
  assert.deepEqual([inside.agentId, inside.agentType], ['ag1', 'Explore'])

  const spawn = normalize('PreToolUse', { ...base, tool_name: 'Agent', tool_input: { description: 'look around', prompt: 'find auth', subagent_type: 'Explore' }, tool_use_id: 'sp' }, 1) as Ev
  assert.deepEqual([spawn.arg, spawn.agentType, spawn.input], ['look around', 'Explore', 'find auth'])
  assert.equal(spawn.touch, undefined)

  const start = normalize('SubagentStart', { ...base, agent_id: 'ag1', agent_type: 'Explore' }, 1) as Ev
  assert.deepEqual([start.kind, start.agentId, start.agentType], ['agent_start', 'ag1', 'Explore'])

  const stop = normalize('SubagentStop', { ...base, agent_id: 'ag1', agent_type: 'Explore', agent_transcript_path: '/t/agent.jsonl', last_assistant_message: 'found it' }, 2) as Ev
  assert.deepEqual([stop.kind, stop.agentTranscript, stop.output, stop.transcript], ['agent_stop', '/t/agent.jsonl', 'found it', '/t/s1.jsonl'])

  const end = normalize('Stop', { ...base, last_assistant_message: 'done', stop_hook_active: false }, 3) as Ev
  assert.deepEqual([end.kind, end.output], ['stop', 'done'])
})

test('permissions, failures and compactions are read', () => {
  const ask = normalize('PermissionRequest', { ...base, tool_name: 'Bash', tool_input: { command: 'rm x' } }, 1) as Ev
  const pre = normalize('PreToolUse', { ...base, tool_name: 'Bash', tool_input: { command: 'rm x' }, tool_use_id: 'u' }, 1) as Ev
  assert.equal(ask.kind, 'perm_ask')
  // The request names no call: it matches by what the call was given.
  assert.equal(ask.fp, pre.fp)
  assert.equal(ask.toolUseId, undefined)

  const denied = normalize('PermissionDenied', { ...base, tool_name: 'Bash', tool_input: {}, tool_use_id: 'u', reason: 'too risky' }, 1) as Ev
  assert.deepEqual([denied.kind, denied.toolUseId, denied.reason], ['perm_denied', 'u', 'too risky'])

  const fail = normalize('StopFailure', { ...base, error: 'rate_limit', error_details: 'try later' }, 1) as Ev
  assert.deepEqual([fail.kind, fail.arg, fail.reason], ['stop_fail', 'rate limited: try later', 'rate_limit'])
  assert.equal(failureWord('something_new'), 'something new')

  const pc = normalize('PreCompact', { ...base, trigger: 'auto', custom_instructions: 'keep the plan' }, 1) as Ev
  assert.deepEqual([pc.kind, pc.reason, pc.arg, pc.input], ['compact', 'auto', 'auto', 'keep the plan'])
  const done = normalize('PostCompact', { ...base, trigger: 'auto', compact_summary: 'The user asked.' }, 2) as Ev
  assert.deepEqual([done.kind, done.output], ['compact_end', 'The user asked.'])

  const end = normalize('SessionEnd', { ...base, reason: 'logout' }, 1) as Ev
  assert.deepEqual([end.kind, end.reason], ['session_end', 'logout'])
  const begin = normalize('SessionStart', { ...base, source: 'resume', model: 'claude-opus-5-5' }, 1) as Ev
  assert.deepEqual([begin.kind, begin.reason], ['session_start', 'resume'])
})

test('events not drawn are ignored', () => {
  assert.equal(normalize('Notification', { ...base, message: 'x' }, 1), null)
  assert.equal(normalize('', {}, 1), null)
})

test('what a call touched is read from its arguments, whatever the tool is called', () => {
  assert.deepEqual(touchOf('Read', { file_path: '/p/a.ts' }), { op: 'read', paths: ['/p/a.ts'] })
  assert.deepEqual(touchOf('Edit', { file_path: '/p/a.ts', old_string: 'x' }), { op: 'edit', paths: ['/p/a.ts'] })
  assert.equal(touchOf('Write', { file_path: '/p/n.ts' })?.op, 'write')
  assert.equal(touchOf('NotebookEdit', { notebook_path: '/p/n.ipynb' })?.op, 'edit')
  assert.deepEqual(touchOf('Grep', { pattern: 'login', path: '/p' }), { op: 'search', paths: ['/p'], what: 'login' })
  assert.equal(touchOf('WebFetch', { url: 'https://x.dev' })?.op, 'web')
  assert.equal(touchOf('TodoWrite', { todos: [{ content: 'x' }] }), undefined)
  assert.deepEqual(touchOf('mcp__srv__open', { path: '/p/z.md' }), { op: 'read', paths: ['/p/z.md'] })
})

test('long texts are cut in the log and kept whole in a file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'call-tree-'))
  const ev = spill({ v: 1, t: 5, sid: 's', kind: 'tool_post', output: 'x'.repeat(KEEP + 500) }, dir)
  assert.equal(ev.output?.length, KEEP)
  assert.equal(ev.outputLen, KEEP + 500)
  assert.equal(fs.readFileSync(ev.outputFile as string, 'utf8').length, KEEP + 500)
  fs.rmSync(dir, { recursive: true })
})

test('the script appends one line per event and prints nothing, so the work goes on as it would have', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'call-tree-'))
  const script = path.join(__dirname, '..', 'record.js')
  const run = (event: string, payload: object | string) =>
    spawnSync(process.execPath, [script, event], {
      input: typeof payload === 'string' ? payload : JSON.stringify(payload),
      env: { ...process.env, AI_CALL_STACK_CLAUDE_DIR: dir },
      encoding: 'utf8',
    })
  const a = run('UserPromptSubmit', { ...base, prompt: 'hi' })
  const b = run('PreToolUse', 'this is not json')
  const c = run('Notification', { ...base })
  for (const r of [a, b, c]) {
    assert.equal(r.status, 0)
    assert.equal(r.stdout, '')
  }
  const lines = fs.readFileSync(path.join(dir, 'events', 's1.jsonl'), 'utf8').trim().split('\n')
  assert.equal(lines.length, 1)
  assert.equal((JSON.parse(lines[0] as string) as Ev).kind, 'prompt')
  fs.rmSync(dir, { recursive: true })
})
