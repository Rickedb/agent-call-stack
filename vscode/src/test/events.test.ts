import * as assert from 'node:assert/strict'
import { test } from 'node:test'

import { Session } from '../model'
import { normalize } from '../record'
import { renderBody, renderText, summaryMarkdown, type View } from '../render'
import { reportOf } from '../stats'
import type { Ev } from '../types'

let t = 1000
const ev = (e: Partial<Ev> & Pick<Ev, 'kind'>): Ev => ({ v: 1, t: (t += 100), sid: 's', ...e })
const session = (...events: Ev[]) => {
  const s = new Session('s')
  events.forEach(e => s.apply(e))
  return s
}
const view = (over: Partial<View> = {}): View => ({
  mode: 'tree',
  selected: '',
  folded: new Set(),
  shown: new Set(),
  shut: new Set(),
  now: t + 500,
  hooksInstalled: true,
  hooksOff: false,
  hasWorkspace: true,
  sessions: [],
  picked: '',
  ...over,
})

test('an ErrorOccurred payload is read in both spellings, with its context and stack', () => {
  const snake = normalize(
    'ErrorOccurred',
    {
      session_id: 's',
      error: { message: 'Rate limit exceeded', name: 'RateLimitError', stack: 'at call (a.js:1)' },
      error_context: 'model_call',
      recoverable: false,
    },
    5,
  ) as Ev
  assert.equal(snake.kind, 'error')
  assert.equal(snake.arg, 'Rate limit exceeded')
  assert.equal(snake.reason, 'model_call')
  assert.equal(
    snake.output,
    'RateLimitError: Rate limit exceeded\ncontext: model_call\nrecoverable: no\nat call (a.js:1)',
  )
  const camel = normalize('errorOccurred', { sessionId: 's', error: { message: 'boom' }, errorContext: 'tool_execution' }, 5) as Ev
  assert.equal(camel.arg, 'boom')
  assert.equal(camel.reason, 'tool_execution')
  // An error that is only a string.
  assert.equal((normalize('ErrorOccurred', { session_id: 's', error: 'plain' }, 5) as Ev).arg, 'plain')
})

test('a PreCompact payload keeps the trigger and the instructions', () => {
  const e = normalize('PreCompact', { session_id: 's', trigger: 'manual', custom_instructions: 'keep the plan' }, 5) as Ev
  assert.equal(e.kind, 'compact')
  assert.equal(e.reason, 'manual')
  assert.equal(e.arg, 'manual')
  assert.equal(e.input, 'keep the plan')
  assert.equal((normalize('preCompact', { sessionId: 's', trigger: 'auto', customInstructions: '' }, 5) as Ev).input, undefined)
})

test('a SessionEnd keeps its reason', () => {
  assert.equal((normalize('SessionEnd', { session_id: 's', reason: 'abort' }, 5) as Ev).reason, 'abort')
})

test('an error is a failed row under what was running; a compaction is an instant row', () => {
  const s = session(
    ev({ kind: 'prompt', arg: 'work' }),
    ev({ kind: 'compact', arg: 'auto', reason: 'auto', input: 'keep the plan' }),
    ev({ kind: 'error', arg: 'Rate limit exceeded', reason: 'model_call', output: 'RateLimitError: Rate limit exceeded' }),
    ev({ kind: 'stop' }),
  )
  const [prompt, compact, error] = s.nodes
  assert.equal(compact?.kind, 'event')
  assert.equal(compact?.name, 'Compact')
  assert.equal(compact?.parent, prompt?.id)
  assert.equal(compact?.status, 'ok')
  assert.equal(compact?.compact?.trigger, 'auto')
  assert.equal(compact?.input, 'keep the plan')
  assert.equal(error?.kind, 'event')
  assert.equal(error?.name, 'Error')
  assert.equal(error?.status, 'err')
  assert.equal(error?.why, 'Rate limit exceeded')
  // An error row does not fail the prompt: the host may recover.
  assert.equal(prompt?.status, 'ok')
})

test('a session that ends badly while a prompt runs fails the prompt, and says why', () => {
  for (const [reason, why] of [['abort', 'interrupted'], ['error', 'session error'], ['timeout', 'timed out']] as const) {
    const s = session(ev({ kind: 'prompt', arg: 'p' }), ev({ kind: 'tool_pre', tool: 'x', toolUseId: 'u' }), ev({ kind: 'session_end', reason }))
    assert.equal(s.nodes[0]?.status, 'err')
    assert.equal(s.nodes[0]?.why, why)
  }
  const fine = session(ev({ kind: 'prompt', arg: 'p' }), ev({ kind: 'session_end', reason: 'user_exit' }))
  assert.equal(fine.nodes[0]?.status, 'ok')
  assert.equal(fine.nodes[0]?.why, undefined)
})

test('the rows, the tag and the summary show errors and compactions, and they are not calls', () => {
  const s = session(
    ev({ kind: 'prompt', arg: 'work' }),
    ev({ kind: 'tool_pre', tool: 'Bash', arg: 'npm test', toolUseId: 'u1', input: 'command: npm test' }),
    ev({ kind: 'tool_fail', tool: 'Bash', toolUseId: 'u1', output: 'exit code 1\nmore' }),
    ev({ kind: 'compact', arg: 'manual', reason: 'manual' }),
    ev({ kind: 'error', arg: 'Network down', reason: 'system', output: 'Error: Network down' }),
    ev({ kind: 'session_end', reason: 'timeout' }),
  )
  const html = renderBody(s, view())
  assert.match(html, /Compact<\/span>/)
  assert.match(html, /Error<\/span>/)
  assert.match(html, /<span class="tag err" title="timed out">timed out<\/span>/)
  // The counts at the top are of calls: the one failed call, not the error row.
  assert.match(html, /✗ 1 failed/)

  const top = s.nodes[0]!
  const r = reportOf(top, s.nodes.slice(1), t + 500)!
  assert.equal(r.calls, 1)
  assert.equal(r.compacts?.count, 1)
  assert.equal(r.compacts?.manual, 1)
  assert.deepEqual(r.errors.map(f => f.why), ['timed out', 'exit code 1', 'Network down'])
  assert.match(html, /Error<\/span><span class="val"[^>]*>Bash npm test — exit code 1/)
  assert.match(html, /Compacts<\/span><span class="val"[^>]*>1 \(1 manual\)/)

  const text = renderText(s, t + 500)
  assert.match(text, /compactions: 1/)
  assert.match(text, /error: the prompt — timed out/)

  const md = summaryMarkdown(s, top.id, t + 500) ?? ''
  assert.match(md, /\*\*Compactions:\*\* 1 \(1 manual\)/)
  assert.match(md, /\*\*Errors:\*\* 3/)
  assert.match(md, / {2}- Bash `npm test` — exit code 1/)
})

test('a compaction opens in the modal with its instructions, and says the host gives no more', () => {
  const s = session(ev({ kind: 'prompt', arg: 'p' }), ev({ kind: 'compact', arg: 'auto', reason: 'auto', input: 'keep the plan' }), ev({ kind: 'stop' }))
  const html = renderBody(s, view({ selected: s.nodes[1]!.id }))
  assert.match(html, /INSTRUCTIONS/)
  assert.match(html, /keep the plan/)
  assert.match(html, /auto · the host reports no size, length or summary for it/)
})

test('a prompt that only failed still has a summary', () => {
  const s = session(ev({ kind: 'prompt', arg: 'p' }), ev({ kind: 'session_end', reason: 'abort' }))
  const r = reportOf(s.nodes[0]!, [], t + 500)
  assert.equal(r?.calls, 0)
  assert.deepEqual(r?.errors.map(f => f.why), ['interrupted'])
  const quiet = session(ev({ kind: 'prompt', arg: 'p' }), ev({ kind: 'stop' }))
  assert.equal(reportOf(quiet.nodes[0]!, [], t + 500), undefined)
})

test('a hook file written before the compaction and error events is brought up to date, once', async () => {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const { buildHookConfig, EVENTS, refreshHookFile } = await import('../hooks')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'call-tree-'))
  const file = path.join(dir, 'ai-call-stack.json')
  const old = buildHookConfig('/r/record.cjs')
  delete (old.hooks as Record<string, unknown>).PreCompact
  delete (old.hooks as Record<string, unknown>).ErrorOccurred
  fs.writeFileSync(file, JSON.stringify(old, null, 2) + '\n')

  assert.equal(refreshHookFile(file, '/r/record.cjs'), true)
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')).hooks), [...EVENTS])
  assert.ok(EVENTS.includes('PreCompact') && EVENTS.includes('ErrorOccurred'))
  // Nothing left to change; and a file that is not there is not made.
  assert.equal(refreshHookFile(file, '/r/record.cjs'), false)
  assert.equal(refreshHookFile(path.join(dir, 'none.json'), '/r/record.cjs'), false)
  fs.rmSync(dir, { recursive: true })
})

test('the transcript path is read from the events that carry it, and shown with a copy button', () => {
  assert.equal((normalize('Stop', { session_id: 's', transcript_path: '/t/s.jsonl' }, 5) as Ev).transcript, '/t/s.jsonl')
  assert.equal((normalize('agentStop', { sessionId: 's', transcriptPath: '/t/c.jsonl' }, 5) as Ev).transcript, '/t/c.jsonl')
  assert.equal((normalize('PreToolUse', { session_id: 's', tool_name: 'x' }, 5) as Ev).transcript, undefined)

  const s = session(
    ev({ kind: 'prompt', arg: 'p' }),
    ev({ kind: 'agent_start', agentType: 'Explore', transcript: '/t/start.jsonl' }),
    ev({ kind: 'compact', arg: 'auto', reason: 'auto', transcript: '/t/compact.jsonl' }),
    ev({ kind: 'agent_stop', agentType: 'Explore', transcript: '/t/stop.jsonl' }),
    ev({ kind: 'stop', transcript: '/t/s.jsonl' }),
  )
  const [prompt, agent, compact] = s.nodes
  assert.equal(prompt?.transcript, '/t/s.jsonl')
  // A subagent's stop names its transcript last; that is the one kept.
  assert.equal(agent?.transcript, '/t/stop.jsonl')
  assert.equal(compact?.transcript, '/t/compact.jsonl')

  const html = renderBody(s, view({ selected: prompt!.id }))
  assert.match(html, /transcript \/t\/s\.jsonl/)
  assert.match(html, /data-act="copyTranscript" data-id="[^"]+"[^>]*>Copy transcript path</)
  // A row with none shows none.
  assert.doesNotMatch(renderBody(s, view({ selected: s.nodes[3]?.id ?? '' })), /Copy transcript path/)
})

test('the Touched view lists files, commands and lookups, and a call opens in the modal', () => {
  const s = session(
    ev({ kind: 'prompt', arg: 'fix login' }),
    ev({ kind: 'tool_pre', tool: 'read_file', toolUseId: 'r1', arg: '/p/src/login.ts', input: 'filePath: /p/src/login.ts', touch: { op: 'read', paths: ['/p/src/login.ts'] } }),
    ev({ kind: 'tool_post', tool: 'read_file', toolUseId: 'r1', output: 'text' }),
    ev({ kind: 'tool_pre', tool: 'replace_string_in_file', toolUseId: 'e1', arg: '/p/src/login.ts', touch: { op: 'edit', paths: ['/p/src/login.ts'] } }),
    ev({ kind: 'tool_fail', tool: 'replace_string_in_file', toolUseId: 'e1', output: 'no match' }),
    ev({ kind: 'tool_pre', tool: 'replace_string_in_file', toolUseId: 'e2', arg: '/p/src/login.ts', touch: { op: 'edit', paths: ['/p/src/login.ts'] } }),
    ev({ kind: 'tool_post', tool: 'replace_string_in_file', toolUseId: 'e2', output: 'ok' }),
    ev({ kind: 'tool_pre', tool: 'read_file', toolUseId: 'r2', arg: '/p/src/util.ts', touch: { op: 'read', paths: ['/p/src/util.ts'] } }),
    ev({ kind: 'tool_post', tool: 'read_file', toolUseId: 'r2', output: 'text' }),
    ev({ kind: 'tool_pre', tool: 'run_in_terminal', toolUseId: 'c1', arg: 'npm test', touch: { op: 'run', paths: [], what: 'npm test' } }),
    ev({ kind: 'tool_post', tool: 'run_in_terminal', toolUseId: 'c1', output: 'ok' }),
    ev({ kind: 'tool_pre', tool: 'grep_search', toolUseId: 'g1', arg: 'login', touch: { op: 'search', paths: [], what: 'login' } }),
    ev({ kind: 'tool_post', tool: 'grep_search', toolUseId: 'g1', output: 'hits' }),
    ev({ kind: 'stop' }),
  )
  const html = renderBody(s, view({ mode: 'files' }))
  assert.match(html, /2 files \(1 changed, 1 read only\) · 1 command · 1 lookup/)
  assert.match(html, /calls ran .* of .* · model and other time/)
  assert.match(html, /FILES · under …\/p\/src/)
  assert.match(html, /<bdi>login\.ts<\/bdi>/)
  assert.match(html, /<bdi>util\.ts<\/bdi>/)
  // The changed file comes first; it was read, then edited twice, the first edit failing.
  assert.ok(html.indexOf('login.ts</bdi>') < html.indexOf('util.ts</bdi>'))
  assert.match(html, />R1 E2</)
  assert.match(html, /retried 1×/)
  assert.match(html, /✗1/)
  assert.match(html, /COMMANDS/)
  assert.match(html, />npm test</)
  assert.match(html, /LOOKUPS/)
  assert.match(html, /grep_search login/)
  // No rows of the other views, and no fold-all.
  assert.doesNotMatch(html, /class="row/)
  assert.doesNotMatch(html, /data-act="foldAll"/)
  // The toolbar says which view it is; the other views are one press away.
  assert.match(html, /data-v="files"[^>]*>Touched<\/button>/)
  assert.match(html, /class="btn primary" data-act="mode" data-v="files"/)
  // A call is a button that opens its details.
  const call = s.nodes.find(n => n.name === 'run_in_terminal')!
  assert.match(html, new RegExp(`class="tv-call [^"]*" data-act="select" data-id="${call.id.replace(/[#:]/g, '.')}"`))
  assert.match(renderBody(s, view({ mode: 'files', selected: call.id })), /class="modal/)
  assert.doesNotMatch(renderBody(s, view({ mode: 'tree' })), /tv-call/)
})

test('a tool call start carries what it touched', () => {
  const ev = normalize('PreToolUse', { session_id: 's', tool_name: 'replace_string_in_file', tool_input: { filePath: '/p/a.ts', oldString: 'x' } }, 1) as Ev
  assert.deepEqual(ev.touch, { op: 'edit', paths: ['/p/a.ts'] })
  assert.equal(normalize('PostToolUse', { session_id: 's', tool_name: 'x', tool_input: { filePath: '/p/a.ts' } }, 1)?.touch, undefined)
  const cmd = normalize('PreToolUse', { sessionId: 's', toolName: 'run_in_terminal', toolArgs: JSON.stringify({ command: 'ls' }) }, 1) as Ev
  assert.deepEqual(cmd.touch, { op: 'run', paths: [], what: 'ls' })
})
