import * as assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { test } from 'node:test'

import { Session, settle } from '../model'
import { renderBody, summaryMarkdown, type View } from '../render'
import { reportOf } from '../stats'
import { assign, Parsed, TranscriptReader } from '../transcript'
import type { Ev, Node } from '../types'

// Events at the times given, so that waits and runs can be told apart.
const ev = (t: number, e: Partial<Ev> & Pick<Ev, 'kind'>): Ev => ({ v: 1, t, sid: 's', ...e })
const run = (...events: Ev[]) => {
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
  now: 100_000,
  hooksInstalled: true,
  hooksOff: false,
  hasWorkspace: true,
  sessions: [],
  picked: '',
  ...over,
})
const byName = (s: Session, name: string) => s.nodes.find(n => n.name === name)

test('a subagent is found by its id; its calls hang under it; the transcripts are kept', () => {
  const s = run(
    ev(0, { kind: 'prompt', arg: 'p' }),
    ev(10, { kind: 'tool_pre', tool: 'Agent', toolUseId: 'sp', arg: 'look around', agentType: 'Explore', input: 'find auth' }),
    ev(20, { kind: 'agent_start', agentId: 'ag1', agentType: 'Explore' }),
    ev(30, { kind: 'tool_pre', tool: 'Grep', toolUseId: 'g', agentId: 'ag1', arg: 'auth' }),
    ev(40, { kind: 'tool_post', tool: 'Grep', toolUseId: 'g', agentId: 'ag1', output: 'hits' }),
    ev(50, { kind: 'agent_stop', agentId: 'ag1', agentType: 'Explore', agentTranscript: '/t/agent.jsonl', transcript: '/t/main.jsonl', output: 'found' }),
    ev(60, { kind: 'stop', transcript: '/t/main.jsonl', output: 'done' }),
  )
  const agent = byName(s, 'Explore') as Node
  const grep = byName(s, 'Grep') as Node
  assert.equal(agent.arg, 'look around')
  assert.equal(grep.parent, agent.id)
  assert.equal(agent.transcript, '/t/agent.jsonl')
  assert.equal(s.nodes[0]?.transcript, '/t/main.jsonl')
  assert.equal(s.transcript, '/t/main.jsonl')
  assert.equal(agent.status, 'ok')
})

test('a call the person was asked about is drawn from when it ran, and says how long it waited', () => {
  const s = run(
    ev(0, { kind: 'prompt', arg: 'p' }),
    ev(100, { kind: 'tool_pre', tool: 'Bash', toolUseId: 'u', arg: 'npm test', fp: 'f1' }),
    ev(110, { kind: 'perm_ask', tool: 'Bash', fp: 'f1' }),
    ev(5100, { kind: 'tool_post', tool: 'Bash', toolUseId: 'u', fp: 'f1', output: 'ok', durationMs: 300 }),
    ev(5200, { kind: 'stop' }),
  )
  const call = byName(s, 'Bash') as Node
  // It ran the 300ms before it ended; the 4.7s before that was the person's answer.
  assert.deepEqual([call.start, call.end, call.status], [4800, 5100, 'ok'])
  assert.deepEqual(call.perm, { decision: 'ask', ran: 300, waited: 4700 })
})

test('a request is matched to the oldest running call that was given the same, in its own loop', () => {
  const s = run(
    ev(0, { kind: 'prompt', arg: 'p' }),
    ev(10, { kind: 'tool_pre', tool: 'Bash', toolUseId: 'a', fp: 'same', arg: 'first' }),
    ev(11, { kind: 'tool_pre', tool: 'Bash', toolUseId: 'b', fp: 'same', arg: 'second' }),
    ev(12, { kind: 'tool_pre', tool: 'Bash', toolUseId: 'c', fp: 'same', agentId: 'ag', arg: 'inside' }),
    ev(20, { kind: 'perm_ask', tool: 'Bash', fp: 'same' }),
    ev(21, { kind: 'perm_ask', tool: 'Bash', fp: 'same' }),
    ev(22, { kind: 'perm_ask', tool: 'Bash', fp: 'nothing like it' }),
  )
  const perms = s.nodes.filter(n => n.kind === 'tool').map(n => [n.arg, n.perm?.decision])
  assert.deepEqual(perms, [['first', 'ask'], ['second', 'ask'], ['inside', undefined]])
})

test('an ask that was not allowed is told by the failure with no run, by a denial, or by the prompt ending', () => {
  const failed = run(
    ev(0, { kind: 'prompt', arg: 'p' }),
    ev(10, { kind: 'tool_pre', tool: 'Bash', toolUseId: 'u', fp: 'f' }),
    ev(11, { kind: 'perm_ask', tool: 'Bash', fp: 'f' }),
    ev(900, { kind: 'tool_fail', tool: 'Bash', toolUseId: 'u', fp: 'f', output: 'The user rejected it' }),
  )
  assert.deepEqual(byName(failed, 'Bash')?.perm, { decision: 'ask', refused: true })

  const denied = run(
    ev(0, { kind: 'prompt', arg: 'p' }),
    ev(10, { kind: 'tool_pre', tool: 'Bash', toolUseId: 'u', fp: 'f' }),
    ev(11, { kind: 'perm_ask', tool: 'Bash', fp: 'f' }),
    ev(20, { kind: 'perm_denied', tool: 'Bash', toolUseId: 'u', reason: 'too risky' }),
  )
  const call = byName(denied, 'Bash') as Node
  assert.deepEqual([call.status, call.end, call.output, call.perm?.refused, call.perm?.reason], ['err', 20, 'denied: too risky', true, 'too risky'])

  const ended = run(
    ev(0, { kind: 'prompt', arg: 'p' }),
    ev(10, { kind: 'tool_pre', tool: 'Bash', toolUseId: 'u', fp: 'f' }),
    ev(11, { kind: 'perm_ask', tool: 'Bash', fp: 'f' }),
    ev(50, { kind: 'stop' }),
  )
  assert.equal(byName(ended, 'Bash')?.perm?.refused, true)

  // A call that ran and failed was allowed.
  const ran = run(
    ev(0, { kind: 'prompt', arg: 'p' }),
    ev(10, { kind: 'tool_pre', tool: 'Bash', toolUseId: 'u', fp: 'f' }),
    ev(11, { kind: 'perm_ask', tool: 'Bash', fp: 'f' }),
    ev(900, { kind: 'tool_fail', tool: 'Bash', toolUseId: 'u', fp: 'f', output: 'exit 1', durationMs: 50 }),
  )
  assert.equal(byName(ran, 'Bash')?.perm?.refused, undefined)
  assert.equal(byName(ran, 'Bash')?.perm?.waited, 840)
})

test('settle leaves a call that was not asked alone, and never moves a start back', () => {
  const was = { id: 't', kind: 'tool' as const, name: 'Bash', arg: '', status: 'run' as const, start: 1000, perm: { decision: 'ask' as const, ran: 150 } }
  assert.deepEqual(settle(was, false, 6150), { start: 6000, perm: { decision: 'ask', ran: 150, waited: 5000 } })
  assert.deepEqual(settle(was, false, 1100), { start: 1000, perm: { decision: 'ask', ran: 150, waited: 0 } })
  assert.deepEqual(settle({ ...was, perm: undefined }, false, 2000), {})
})

test('a compaction runs from its PreCompact to its PostCompact and keeps the summary', () => {
  const s = run(
    ev(0, { kind: 'prompt', arg: 'p' }),
    ev(100, { kind: 'compact', arg: 'auto', reason: 'auto', input: 'keep the plan' }),
    ev(400, { kind: 'compact_end', reason: 'auto', output: 'The user asked.' }),
    ev(500, { kind: 'compact_end', reason: 'manual', output: 'no start seen' }),
  )
  const [prompt, first, second] = s.nodes
  assert.deepEqual([first?.name, first?.kind, first?.status, first?.start, first?.end], ['Compact', 'event', 'ok', 100, 400])
  assert.deepEqual([first?.parent, first?.input, first?.output, first?.compact?.trigger], [prompt?.id, 'keep the plan', 'The user asked.', 'auto'])
  // An end with no start is an instant.
  assert.deepEqual([second?.start, second?.end, second?.output, second?.compact?.trigger], [500, 500, 'no start seen', 'manual'])
})

test('an API failure fails the prompt, with the reason; a session that ends on a running prompt fails it too', () => {
  const failed = run(
    ev(0, { kind: 'prompt', arg: 'p' }),
    ev(10, { kind: 'tool_pre', tool: 'Bash', toolUseId: 'u' }),
    ev(20, { kind: 'stop_fail', arg: 'rate limited: try later', reason: 'rate_limit', output: 'partial' }),
  )
  const top = failed.nodes[0] as Node
  assert.deepEqual([top.status, top.why, top.output, top.end], ['err', 'rate limited: try later', 'partial', 20])
  assert.equal(byName(failed, 'Bash')?.status, 'err')

  const ended = run(ev(0, { kind: 'prompt', arg: 'p' }), ev(5, { kind: 'session_end', reason: 'prompt_input_exit' }))
  assert.deepEqual([ended.nodes[0]?.status, ended.nodes[0]?.why], ['err', 'session ended'])
  const fine = run(ev(0, { kind: 'prompt', arg: 'p' }), ev(5, { kind: 'stop' }), ev(9, { kind: 'session_end', reason: 'logout' }))
  assert.deepEqual([fine.nodes[0]?.status, fine.nodes[0]?.why], ['ok', undefined])
})

// ---- the transcript ----

const reply = (id: string, t: string, model: string, usage: object, over: object = {}) =>
  JSON.stringify({ type: 'assistant', timestamp: t, message: { id, model, usage }, ...over })
const use = (input: number, output: number, read: number, write: number) => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: read,
  cache_creation_input_tokens: write,
})

test('a transcript is read a line at a time, a response once however many blocks it was written in', () => {
  const p = new Parsed()
  const lines = [
    JSON.stringify({ type: 'user', timestamp: '2026-01-01T00:00:00.000Z', message: {} }),
    reply('m1', '2026-01-01T00:00:01.000Z', 'claude-opus-5-5', use(2, 100, 5000, 0)),
    // The same response, written again for its next block, with more of its output counted.
    reply('m1', '2026-01-01T00:00:02.000Z', 'claude-opus-5-5', use(2, 319, 5000, 0)),
    reply('m2', '2026-01-01T00:00:05.000Z', 'claude-opus-5-5', use(1, 50, 5300, 10)),
    reply('x', '2026-01-01T00:00:06.000Z', '<synthetic>', use(0, 0, 0, 0)),
    reply('side', '2026-01-01T00:00:07.000Z', 'claude-haiku-5-5', use(9, 9, 9, 9), { isSidechain: true }),
    'not json but it says "type":"assistant"',
    JSON.stringify({ type: 'system', subtype: 'compact_boundary', timestamp: '2026-01-01T00:00:08.000Z', compactMetadata: { trigger: 'auto', preTokens: 180000, postTokens: 12000 } }),
  ]
  const text = lines.join('\n') + '\n'
  // Fed in pieces that cut a line in two, as the file grows.
  p.feed(text.slice(0, 130))
  p.feed(text.slice(130, 400))
  p.feed(text.slice(400))
  p.feed('{"type":"assistant"')
  assert.equal(p.replies.length, 4)
  const [m1, m2, synthetic, side] = p.replies
  assert.deepEqual(m1?.usage, { input: 2, output: 319, cacheRead: 5000, cacheWrite: 0 })
  assert.equal(m1?.t, Date.parse('2026-01-01T00:00:01.000Z'))
  assert.deepEqual([m2?.model, synthetic?.model, side?.side], ['claude-opus-5-5', undefined, true])
  assert.deepEqual(p.boundaries, [{ t: Date.parse('2026-01-01T00:00:08.000Z'), trigger: 'auto', before: 180000, after: 12000 }])
})

test('each prompt gets the model and usage of the responses that came after it; a subagent its own file', () => {
  const s = run(
    ev(Date.parse('2026-01-01T00:00:00.000Z'), { kind: 'prompt', arg: 'one' }),
    ev(Date.parse('2026-01-01T00:00:10.000Z'), { kind: 'prompt', arg: 'two' }),
    ev(Date.parse('2026-01-01T00:00:12.000Z'), { kind: 'agent_start', agentId: 'ag', agentType: 'Explore' }),
    ev(Date.parse('2026-01-01T00:00:15.000Z'), { kind: 'agent_stop', agentId: 'ag', agentType: 'Explore', agentTranscript: '/t/agent.jsonl' }),
    ev(Date.parse('2026-01-01T00:00:16.000Z'), { kind: 'compact', arg: 'auto', reason: 'auto' }),
    ev(Date.parse('2026-01-01T00:00:17.000Z'), { kind: 'compact_end', reason: 'auto' }),
  )
  const main = new Parsed()
  main.feed(
    [
      reply('a', '2026-01-01T00:00:03.000Z', 'claude-opus-5-5', use(1, 10, 100, 0)),
      reply('b', '2026-01-01T00:00:04.000Z', 'claude-opus-5-5', use(1, 20, 200, 5)),
      reply('c', '2026-01-01T00:00:11.000Z', 'claude-sonnet-5-5', use(3, 30, 0, 300)),
      reply('d', '2026-01-01T00:00:18.000Z', 'claude-sonnet-5-5', use(4, 40, 400, 0)),
      JSON.stringify({ type: 'system', subtype: 'compact_boundary', timestamp: '2026-01-01T00:00:16.500Z', compactMetadata: { trigger: 'auto', preTokens: 180000, postTokens: 12000 } }),
    ].join('\n') + '\n',
  )
  const agent = new Parsed()
  agent.feed(reply('e', '2026-01-01T00:00:13.000Z', 'claude-haiku-5-5', use(7, 70, 700, 0)) + '\n')
  assign(s, main, new Map([['/t/agent.jsonl', agent]]))

  const [one, two] = s.nodes.filter(n => n.kind === 'prompt')
  assert.deepEqual([one?.model, one?.usage], ['claude-opus-5-5', { input: 2, output: 30, cacheRead: 300, cacheWrite: 5 }])
  assert.deepEqual([two?.model, two?.usage], ['claude-sonnet-5-5', { input: 7, output: 70, cacheRead: 400, cacheWrite: 300 }])
  const sub = byName(s, 'Explore') as Node
  assert.deepEqual([sub.model, sub.usage], ['claude-haiku-5-5', { input: 7, output: 70, cacheRead: 700, cacheWrite: 0 }])
  const compact = byName(s, 'Compact') as Node
  assert.deepEqual(compact.compact, { trigger: 'auto', before: 180000, after: 12000 })
  assert.equal(compact.arg, 'auto · 180k → 12k tok')
})

test('the reader goes on from where it was, starts again on a file that shrank, and says nothing of a missing one', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'call-stack-'))
  const file = path.join(dir, 't.jsonl')
  const r = new TranscriptReader()
  assert.equal(r.read(file), undefined)

  fs.writeFileSync(file, reply('a', '2026-01-01T00:00:01.000Z', 'm', use(1, 1, 1, 1)) + '\n')
  assert.equal(r.read(file)?.replies.length, 1)
  fs.appendFileSync(file, reply('b', '2026-01-01T00:00:02.000Z', 'm', use(1, 1, 1, 1)) + '\n')
  const again = r.read(file)
  assert.equal(again?.replies.length, 2)
  // Nothing new: the same, not read twice.
  assert.equal(r.read(file)?.replies.length, 2)
  fs.writeFileSync(file, reply('z', '2026-01-01T00:00:09.000Z', 'm', use(1, 1, 1, 1)) + '\n')
  assert.deepEqual(r.read(file)?.replies.map(x => x.t), [Date.parse('2026-01-01T00:00:09.000Z')])

  // A session with its transcript read through the session's own path.
  const s = run(ev(Date.parse('2026-01-01T00:00:08.500Z'), { kind: 'prompt', arg: 'p', transcript: file }))
  r.apply(s)
  assert.equal(s.nodes[0]?.model, 'm')
  assert.deepEqual(s.nodes[0]?.usage, { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 })
  fs.rmSync(dir, { recursive: true })
})

// ---- what shows ----

const finished = () => {
  const s = run(
    ev(0, { kind: 'prompt', arg: 'fix it', transcript: '/t/main.jsonl' }),
    ev(100, { kind: 'tool_pre', tool: 'Bash', toolUseId: 'u', arg: 'npm test', fp: 'f1', touch: { op: 'run', paths: [], what: 'npm test' } }),
    ev(110, { kind: 'perm_ask', tool: 'Bash', fp: 'f1' }),
    ev(5100, { kind: 'tool_post', tool: 'Bash', toolUseId: 'u', fp: 'f1', output: 'ok', durationMs: 300 }),
    ev(5200, { kind: 'tool_pre', tool: 'Read', toolUseId: 'r', arg: '/p/a.ts', touch: { op: 'read', paths: ['/p/a.ts'] } }),
    ev(5300, { kind: 'tool_post', tool: 'Read', toolUseId: 'r', output: 'text' }),
    ev(5400, { kind: 'compact', arg: 'auto', reason: 'auto' }),
    ev(5900, { kind: 'compact_end', reason: 'auto', output: 'The user asked.' }),
    ev(6000, { kind: 'stop', output: 'done' }),
  )
  const top = s.nodes[0] as Node
  top.model = 'claude-opus-5-5-20260101'
  top.usage = { input: 800, output: 520, cacheRead: 4000, cacheWrite: 0 }
  ;(byName(s, 'Compact') as Node).compact = { trigger: 'auto', before: 180000, after: 12000 }
  return s
}

test('the summary reports what the API counted, the approvals, the compactions and the models', () => {
  const s = finished()
  const r = reportOf(s.nodes[0] as Node, s.nodes.slice(1), 10_000)!
  assert.deepEqual(r.perms, { unasked: 1, asked: 1, denied: 0, waited: 4700 })
  assert.deepEqual(r.usage, { input: 800, output: 520, cacheRead: 4000, cacheWrite: 0 })
  assert.equal(r.compacts?.saved, 168000)

  const html = renderBody(s, view({ now: 10_000 }))
  assert.match(html, /<span class="val"[^>]*>in 4\.8k tok · out 520 tok · total 5\.3k tok \(reported\)/)
  assert.match(html, /83% of input from cache/)
  assert.match(html, /Call text/)
  assert.match(html, /1 ran unasked · 1 asked you \(waited 4\.7s\)/)
  assert.match(html, /1 \(1 auto\) · 180k → 12k tok · 168k tok saved · took 500ms/)
  assert.match(html, /opus-5-5 \(prompt\)/)
  // The row says the model that answered; the asked call says it asked and how long it waited.
  assert.match(html, /<span class="model"[^>]*>opus-5-5<\/span>/)
  assert.match(html, /<span class="tag warn"[^>]*>asked, waited 4\.7s<\/span>/)

  const md = summaryMarkdown(s, (s.nodes[0] as Node).id, 10_000) ?? ''
  assert.match(md, /\*\*Tokens:\*\* in 4\.8k tok · out 520 tok · total 5\.3k tok \(reported\)/)
  assert.match(md, /\*\*Approvals:\*\* 1 ran unasked · 1 asked you \(waited 4\.7s\)/)
  assert.match(md, /\*\*Compactions:\*\* 1 \(1 auto\) · 180k → 12k tok/)
})

test('the details give the permission, the usage, the compaction and the summary it left', () => {
  const s = finished()
  const id = (name: string) => (byName(s, name) as Node).id
  assert.match(renderBody(s, view({ selected: id('Bash') })), /permission asked you, waited 4\.7s/)
  const prompt = renderBody(s, view({ selected: (s.nodes[0] as Node).id }))
  assert.match(prompt, /reported in 4\.8k tok \(4\.0k tok cached\) · out 520 tok · subagents not included/)
  assert.match(prompt, /model opus-5-5/)
  const compact = renderBody(s, view({ selected: id('Compact') }))
  assert.match(compact, /auto · 180k → 12k tok \(−93%\)/)
  assert.match(compact, /The user asked\./)
})

test('a call shows what it involved under its row, in the tree and the waterfall, and a click opens the details', () => {
  const s = run(
    ev(10, { kind: 'prompt', arg: 'look into login' }),
    ev(20, { kind: 'tool_pre', tool: 'Read', toolUseId: 'r1', arg: '', touch: { op: 'read', paths: ['/p/src/login.ts'] } }),
    ev(30, { kind: 'tool_post', tool: 'Read', toolUseId: 'r1', output: 'ok' }),
    ev(40, { kind: 'tool_pre', tool: 'Edit', toolUseId: 'e1', arg: '', touch: { op: 'edit', paths: ['/p/src/login.ts'], changes: [{ path: '/p/src/login.ts', added: 2, removed: 1 }] } }),
    ev(50, { kind: 'tool_post', tool: 'Edit', toolUseId: 'e1', output: 'ok' }),
    ev(60, { kind: 'tool_pre', tool: 'WebFetch', toolUseId: 'w1', arg: '', touch: { op: 'web', paths: [], what: 'https://x.dev/docs/auth', links: ['https://x.dev/docs/auth'] } }),
    ev(70, { kind: 'tool_post', tool: 'WebFetch', toolUseId: 'w1', output: 'ok' }),
    ev(80, { kind: 'tool_pre', tool: 'Bash', toolUseId: 'c1', arg: '', touch: { op: 'run', paths: [], what: 'npm test' } }),
    ev(90, { kind: 'tool_post', tool: 'Bash', toolUseId: 'c1', output: 'ok' }),
    ev(100, { kind: 'stop' }),
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
  const s = run(
    ev(10, { kind: 'prompt', arg: 'go' }),
    ev(20, { kind: 'tool_pre', tool: 'Bash', toolUseId: 'b1', arg: 'x', touch: { op: 'run', paths: [], what: 'cd /p && sed -n 1p f | grep -E "Test" || echo none; ls' } }),
    ev(30, { kind: 'tool_post', tool: 'Bash', toolUseId: 'b1', output: 'ok' }),
    ev(40, { kind: 'tool_pre', tool: 'Bash', toolUseId: 'b2', arg: 'y', touch: { op: 'run', paths: [], what: 'npm test' } }),
    ev(50, { kind: 'tool_post', tool: 'Bash', toolUseId: 'b2', output: 'ok' }),
    ev(60, { kind: 'stop' }),
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

// ---- what the model wrote between calls ----

const block = (uuid: string, t: string, content: object[], over: object = {}) =>
  JSON.stringify({ type: 'assistant', uuid, timestamp: t, message: { id: `m-${uuid}`, model: 'claude-opus-5-5', content }, ...over })
const userLine = (t: string, over: object = {}) => JSON.stringify({ type: 'user', timestamp: t, message: { content: 'x' }, ...over })
const T = (s: string) => Date.parse(`2026-01-01T00:00:${s}Z`)

test('the transcript gives the thinking and the text between calls, timed from the line before', () => {
  const p = new Parsed()
  p.feed(
    [
      userLine('2026-01-01T00:00:00.000Z'),
      block('u1', '2026-01-01T00:00:02.000Z', [{ type: 'thinking', thinking: 'Where is the config read?', signature: 'x' }]),
      block('u2', '2026-01-01T00:00:03.000Z', [{ type: 'text', text: "I'll read the file." }]),
      block('u3', '2026-01-01T00:00:03.500Z', [{ type: 'tool_use', id: 't1', name: 'Read', input: {} }]),
      // Thinking the model returned empty (a signature only) is nothing to show.
      block('u4', '2026-01-01T00:00:04.000Z', [{ type: 'thinking', thinking: '', signature: 'y' }]),
      // The same line read twice, and a message the client made up, add nothing.
      block('u2', '2026-01-01T00:00:03.000Z', [{ type: 'text', text: "I'll read the file." }]),
      block('u5', '2026-01-01T00:00:04.500Z', [{ type: 'text', text: 'No response requested.' }], { message: { id: 'q', model: '<synthetic>', content: [{ type: 'text', text: 'No response requested.' }] } }),
      userLine('2026-01-01T00:00:05.000Z'),
      block('u6', '2026-01-01T00:00:07.000Z', [{ type: 'text', text: 'x'.repeat(9000) }]),
      userLine('2026-01-01T00:00:08.000Z', { isSidechain: true }),
      block('u7', '2026-01-01T00:00:09.000Z', [{ type: 'text', text: 'a subagent speaking' }], { isSidechain: true }),
    ].join('\n') + '\n',
  )
  assert.deepEqual(
    p.notes.map(n => [n.name, n.start, n.t, n.side, n.len]),
    [
      ['Thinking', T('00.000'), T('02.000'), false, 25],
      ['Reply', T('02.000'), T('03.000'), false, 19],
      ['Reply', T('05.000'), T('07.000'), false, 9000],
      ['Reply', T('08.000'), T('09.000'), true, 19],
    ],
  )
  assert.equal(p.notes[2]?.text.length, 8000)
})

const withNotes = () => {
  const s = run(
    ev(T('00.000'), { kind: 'prompt', arg: 'fix it' }),
    ev(T('04.000'), { kind: 'tool_pre', tool: 'Read', toolUseId: 't1', arg: 'a.ts' }),
    ev(T('05.000'), { kind: 'tool_post', tool: 'Read', toolUseId: 't1', output: 'code' }),
    ev(T('08.000'), { kind: 'stop', output: 'done' }),
  )
  const main = new Parsed()
  main.feed(
    [
      userLine('2026-01-01T00:00:00.000Z'),
      block('u1', '2026-01-01T00:00:02.000Z', [{ type: 'thinking', thinking: 'Where is the config read?' }]),
      block('u2', '2026-01-01T00:00:03.000Z', [{ type: 'text', text: "I'll read the file." }]),
      userLine('2026-01-01T00:00:05.000Z'),
      block('u6', '2026-01-01T00:00:07.000Z', [{ type: 'text', text: 'It reads from a.ts.' }]),
    ].join('\n') + '\n',
  )
  return { s, main }
}

test('the notes become rows under their prompt, once, in the order things happened', () => {
  const { s, main } = withNotes()
  assign(s, main, new Map())
  assign(s, main, new Map())
  const notes = s.nodes.filter(n => n.kind === 'note')
  assert.equal(notes.length, 3)
  const prompt = s.nodes.find(n => n.kind === 'prompt') as Node
  assert.ok(notes.every(n => n.parent === prompt.id && n.status === 'ok'))
  assert.deepEqual(
    [notes[0]?.name, notes[0]?.arg, notes[0]?.output, notes[0]?.start, notes[0]?.end],
    ['Thinking', 'Where is the config read?', 'Where is the config read?', T('00.000'), T('02.000')],
  )

  // The view puts them among the calls by time, and counts none of them as a call.
  const html = renderBody(s, view({ mode: 'tree' }))
  const at = (word: string) => html.indexOf(word)
  assert.ok(at('Thinking') > 0 && at('Thinking') < at('Read') && at('Read') < at('It reads from a.ts.'))
  assert.match(html, /1 prompt/)
  assert.equal(reportOf(prompt, s.nodes.filter(n => n.parent === prompt.id), T('10.000'))?.calls, 1)
})

test('a note opens in the details with its text, named for what it is; a subagent has its own', () => {
  const { s, main } = withNotes()
  s.apply(ev(T('09.000'), { kind: 'agent_start', agentId: 'ag', agentType: 'Explore' }))
  s.apply(ev(T('12.000'), { kind: 'agent_stop', agentId: 'ag', agentType: 'Explore', agentTranscript: '/t/agent.jsonl' }))
  const agent = new Parsed()
  agent.feed(userLine('2026-01-01T00:00:09.000Z') + '\n' + block('s1', '2026-01-01T00:00:11.000Z', [{ type: 'text', text: 'Found it in b.ts.' }]) + '\n')
  assign(s, main, new Map([['/t/agent.jsonl', agent]]))
  const sub = byName(s, 'Explore') as Node
  const mine = s.nodes.find(n => n.kind === 'note' && n.parent === sub.id) as Node
  assert.equal(mine.output, 'Found it in b.ts.')
  const thought = s.nodes.find(n => n.name === 'Thinking') as Node
  const html = renderBody(s, view({ selected: thought.id }))
  assert.match(html, /THINKING/)
  assert.match(html, /the model's thinking between calls/)
  assert.match(html, /Where is the config read\?/)
})
