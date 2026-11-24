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
  // The commands and lookups are calls too, with what they ran or looked for.
  assert.match(html, /CALLS · under …\/p\/src/)
  assert.match(html, /mono[^>]*>npm test</)
  assert.match(html, /tv-call[^>]*>grep_search [^<]*<\/button>[^]*?>login</)
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

test('the Touched view is a tree of the tool calls, each with the files it touched and its lines, then a summary of files and the total', () => {
  const s = session(
    ev({ kind: 'prompt', arg: 'refactor' }),
    ev({ kind: 'tool_pre', tool: 'Edit', toolUseId: 'e1', arg: '', touch: { op: 'edit', paths: ['/p/src/pane/row.tsx'], changes: [{ path: '/p/src/pane/row.tsx', added: 10, removed: 2 }] } }),
    ev({ kind: 'tool_post', tool: 'Edit', toolUseId: 'e1', output: 'ok' }),
    ev({ kind: 'tool_pre', tool: 'Edit', toolUseId: 'e2', arg: '', touch: { op: 'edit', paths: ['/p/src/pane/row.tsx'], changes: [{ path: '/p/src/pane/row.tsx', added: 3, removed: 0 }] } }),
    ev({ kind: 'tool_post', tool: 'Edit', toolUseId: 'e2', output: 'ok' }),
    ev({ kind: 'tool_pre', tool: 'Edit', toolUseId: 'e3', arg: '', touch: { op: 'edit', paths: ['/p/src/pane/row.tsx'], changes: [{ path: '/p/src/pane/row.tsx', added: 99, removed: 99 }] } }),
    ev({ kind: 'tool_fail', tool: 'Edit', toolUseId: 'e3', output: 'ok' }),
    ev({ kind: 'tool_pre', tool: 'Write', toolUseId: 'w1', arg: '', touch: { op: 'write', paths: ['/p/src/touch.ts'], changes: [{ path: '/p/src/touch.ts', added: 5, removed: 0 }] } }),
    ev({ kind: 'tool_post', tool: 'Write', toolUseId: 'w1', output: 'ok' }),
    ev({ kind: 'tool_pre', tool: 'MultiEdit', toolUseId: 'm1', arg: '', touch: { op: 'edit', paths: ['/p/src/a.ts', '/p/src/b.ts'], changes: [{ path: '/p/src/a.ts', added: 1, removed: 1 }, { path: '/p/src/b.ts', added: 2, removed: 0 }] } }),
    ev({ kind: 'tool_post', tool: 'MultiEdit', toolUseId: 'm1', output: 'ok' }),
    ev({ kind: 'tool_pre', tool: 'Read', toolUseId: 'r1', arg: '', touch: { op: 'read', paths: ['/p/src/pane/bar.tsx'] } }),
    ev({ kind: 'tool_post', tool: 'Read', toolUseId: 'r1', output: 'ok' }),
    ev({ kind: 'tool_pre', tool: 'Bash', toolUseId: 'c1', arg: '', touch: { op: 'run', paths: [], what: 'npm test' } }),
    ev({ kind: 'tool_post', tool: 'Bash', toolUseId: 'c1', output: 'ok' }),
    ev({ kind: 'stop' }),
  )
  const html = renderBody(s, view({ mode: 'files' }))
  // The calls in the order they ran, each with its file under it.
  assert.match(html, /CALLS · under …\/p\/src/)
  assert.match(
    html,
    /tv-call[^>]*>Edit [^<]*<\/button>[\s\S]*?<bdi>pane\/row\.tsx<\/bdi>[\s\S]*?tv-add">\+10<[\s\S]*?tv-del">−2<[\s\S]*?tv-call[^>]*>Edit [^<]*<\/button>[\s\S]*?tv-add">\+3<[\s\S]*?tv-call[^>]*>Edit [^<]*✗<\/button>[\s\S]*?tv-call[^>]*>Write [^<]*<\/button>[\s\S]*?<bdi>touch\.ts<\/bdi>[\s\S]*?tv-add">\+5<[\s\S]*?tv-call[^>]*>Read /,
  )
  // A failed edit changed nothing: its file shows no lines.
  assert.doesNotMatch(html, /\+99/)
  // A call that touched several files sums them on its own row.
  assert.match(html, /tv-call[^>]*>MultiEdit [^<]*<\/button>\s*\n?\s*<span class="tv-delta"[^>]*><span class="tv-add">\+3<\/span> <span class="tv-del">−1</)
  // The summary of each file, and the total of all.
  assert.match(html, /FILES · under …\/p\/src/)
  assert.match(html, /<bdi>pane\/row\.tsx<\/bdi>[^]*?E3[^]*?tv-add">\+13<[^]*?tv-del">−2</)
  assert.match(html, /\+21 −3 lines/)
  assert.match(html, /<b>Total<\/b>[^]*?5 files · 4 changed[^]*?tv-add">\+21<[^]*?tv-del">−3</)
  // A command is a call too, with what it ran.
  assert.match(html, /tv-call[^>]*>npm [^<]*<\/button>[^]*?mono[^>]*>npm test</)
  assert.doesNotMatch(html, /COMMANDS|LOOKUPS/)
})

test('a call shows what it involved under its row, in the tree and the waterfall, and a click opens the details', () => {
  const s = session(
    ev({ kind: 'prompt', arg: 'look into login' }),
    ev({ kind: 'tool_pre', tool: 'Read', toolUseId: 'r1', arg: '', touch: { op: 'read', paths: ['/p/src/login.ts'] } }),
    ev({ kind: 'tool_post', tool: 'Read', toolUseId: 'r1', output: 'ok' }),
    ev({ kind: 'tool_pre', tool: 'Edit', toolUseId: 'e1', arg: '', touch: { op: 'edit', paths: ['/p/src/login.ts'], changes: [{ path: '/p/src/login.ts', added: 2, removed: 1 }] } }),
    ev({ kind: 'tool_post', tool: 'Edit', toolUseId: 'e1', output: 'ok' }),
    ev({ kind: 'tool_pre', tool: 'WebFetch', toolUseId: 'w1', arg: '', touch: { op: 'web', paths: [], what: 'https://x.dev/docs/auth', links: ['https://x.dev/docs/auth'] } }),
    ev({ kind: 'tool_post', tool: 'WebFetch', toolUseId: 'w1', output: 'ok' }),
    ev({ kind: 'tool_pre', tool: 'Bash', toolUseId: 'c1', arg: '', touch: { op: 'run', paths: [], what: 'npm test' } }),
    ev({ kind: 'tool_post', tool: 'Bash', toolUseId: 'c1', output: 'ok' }),
    ev({ kind: 'stop' }),
  )
  const edit = s.nodes.find(n => n.name === 'Edit')!
  // What a call involved is shut until it is opened: the call has an arrow, and nothing under it.
  const shut = renderBody(s, view())
  assert.doesNotMatch(shut, /class="row res/)
  assert.match(shut, new RegExp(`data-act="fold" data-id="open:${edit.id.replace(/[#:]/g, '.')}"[^>]*>▸<`))
  assert.match(shut, /<span class="dim">\+1<\/span>/)
  const open = new Set(s.nodes.map(n => `open:${n.id}`))
  for (const mode of ['tree', 'waterfall'] as const) {
    const html = renderBody(s, view({ mode, folded: open }))
    // A file is shown by its name only, with what was done to it and its lines; an address without its scheme; a command whole.
    assert.match(html, /class="row res"[^]*?res-name">login\.ts<\/span>\s*<span class="dim">read</)
    assert.match(html, new RegExp(`data-act="select" data-id="res:${edit.id.replace(/[#:]/g, '.')}:0"[^>]*>[^]*?res-name">login\\.ts</span>\\s*<span class="dim">edit</span><span class="tv-delta"[^>]*><span class="tv-add">\\+2</span> <span class="tv-del">−1<`))
    assert.match(html, /res-name">x\.dev\/docs\/auth<\/span>\s*<span class="dim">fetch</)
    assert.match(html, /res-name mono">npm test<\/span>\s*<span class="dim">run</)
  }
  // The chat's text shows them too.
  const text = renderText(s, t + 500)
  assert.match(text, /◦ login\.ts read/)
  assert.match(text, /◦ login\.ts edit \+2 −1/)
  assert.match(text, /↗ x\.dev\/docs\/auth fetch/)
  assert.match(text, /└─ \$ npm test run/)
  // A click on the file shows its whole path, the calls that involved it, and a way to the call.
  const modalHtml = renderBody(s, view({ selected: `res:${edit.id}:0` }))
  assert.match(modalHtml, /class="modal-arg">\/p\/src\/login\.ts</)
  assert.match(modalHtml, /file · edit by Edit/)
  assert.match(modalHtml, /2 calls in this prompt · in all/)
  assert.match(modalHtml, /data-act="select" data-id="[^"]+">Read /)
  assert.ok(modalHtml.includes(`data-act="select" data-id="${edit.id}">Open the call<`))
  // An address shows whole.
  const web = s.nodes.find(n => n.name === 'WebFetch')!
  const link = renderBody(s, view({ selected: `res:${web.id}:0` }))
  assert.match(link, /class="modal-arg">https:\/\/x\.dev\/docs\/auth</)
  assert.match(link, /address · fetch by WebFetch/)
  // Each call opens on its own.
  const one = renderBody(s, view({ folded: new Set([`open:${web.id}`]) }))
  assert.doesNotMatch(one, /res-name">login/)
  assert.match(one, /res-name">x\.dev/)
  assert.match(one, new RegExp(`data-id="open:${web.id.replace(/[#:]/g, '.')}"[^>]*>▾<`))
})

test('the details of a shell call show its commands as a tree, each joined by its own operator', () => {
  const s = session(
    ev({ kind: 'prompt', arg: 'go' }),
    ev({ kind: 'tool_pre', tool: 'Bash', toolUseId: 'b1', arg: 'x', touch: { op: 'run', paths: [], what: 'cd /p && sed -n 1p f | grep -E "Test" || echo none; ls' } }),
    ev({ kind: 'tool_post', tool: 'Bash', toolUseId: 'b1', output: 'ok' }),
    ev({ kind: 'tool_pre', tool: 'Bash', toolUseId: 'b2', arg: 'y', touch: { op: 'run', paths: [], what: 'npm test' } }),
    ev({ kind: 'tool_post', tool: 'Bash', toolUseId: 'b2', output: 'ok' }),
    ev({ kind: 'stop' }),
  )
  const chain = s.nodes.find(n => n.arg === 'x')!
  // The row is named by the first command that is not a cd.
  const rows = renderBody(s, view())
  assert.match(rows, /<span class="strong">sed<\/span>|<span class="">sed<\/span>/)
  const html = renderBody(s, view({ selected: chain.id }))
  assert.match(html, /class="seq"/)
  // cd (dim, a common call), then && sed with | grep under it, then || echo, then ; ls.
  assert.match(html, /<span class="dim">cd<\/span>/)
  assert.match(html, /<b class="op op-and"[^>]*>&amp;&amp;<\/b> <span class="">sed<\/span>/)
  assert.match(html, /└─ <\/span><b class="op op-pipe"[^>]*>\|<\/b> <span class="">grep<\/span>/)
  assert.match(html, /<b class="op op-or"[^>]*>\|\|<\/b> <span class="">echo<\/span>/)
  assert.match(html, /<b class="op op-seq"[^>]*>;<\/b> <span class="">ls<\/span>/)
  // What each operator means, for the ones used.
  assert.match(html, /seq-legend[^]*runs the next only if this succeeded[^]*feeds this one&#39;s output to the next/)
  // A line of one command has no tree.
  const single = s.nodes.find(n => n.arg === 'y')!
  assert.doesNotMatch(renderBody(s, view({ selected: single.id })), /class="seq"/)
})
