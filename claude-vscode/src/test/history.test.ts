import * as assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { test } from 'node:test'

import { historyNodes, readHistory, userText } from '../history'
import { Session } from '../model'
import { renderBody, type View } from '../render'
import { reportOf } from '../stats'
import { Parsed, TranscriptReader } from '../transcript'
import type { Ev, Node } from '../types'

const at = (s: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, s)).toISOString()
const ms = (s: number) => Date.UTC(2026, 0, 1, 0, 0, s)
const user = (s: number, content: unknown, over: object = {}) =>
  JSON.stringify({ type: 'user', uuid: `u${s}`, timestamp: at(s), message: { content }, ...over })
const reply = (s: number, content: unknown[], over: object = {}) =>
  JSON.stringify({ type: 'assistant', timestamp: at(s), message: { id: `m${s}`, model: 'claude-opus-5-5', content, usage: { input_tokens: 1, output_tokens: 1 } }, ...over })
const use = (id: string, name: string, input: object) => ({ type: 'tool_use', id, name, input })
const result = (s: number, id: string, content: unknown, isError = false) =>
  user(s, [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }], { toolUseResult: {} })

const transcript = [
  user(0, 'fix the login'),
  reply(2, [{ type: 'text', text: 'Looking.' }, use('r1', 'Read', { file_path: '/p/login.ts' })]),
  result(3, 'r1', [{ type: 'text', text: 'export const login = 1' }]),
  reply(5, [use('e1', 'Edit', { file_path: '/p/login.ts', old_string: 'a', new_string: 'b' })]),
  result(9, 'e1', 'no match', true),
  reply(10, [use('sp', 'Agent', { description: 'look around', prompt: 'find auth', subagent_type: 'Explore' })]),
  // The subagent's own lines are in the transcript too, and are not the prompt's calls.
  reply(11, [use('in', 'Grep', { pattern: 'x' })], { isSidechain: true }),
  result(14, 'sp', 'found it'),
  reply(15, [{ type: 'text', text: 'Fixed.' }]),
  JSON.stringify({ type: 'system', subtype: 'compact_boundary', timestamp: at(16), compactMetadata: { trigger: 'auto', preTokens: 180000, postTokens: 12000, durationMs: 2000 } }),
  // Not prompts: a meta line, a compaction's summary, a command's output, a tool result with no call.
  user(17, 'caveat', { isMeta: true }),
  user(17, 'This session is being continued', { isCompactSummary: true }),
  user(17, '<local-command-stdout>ok</local-command-stdout>'),
  result(17, 'nobody', 'x'),
  user(20, '<system-reminder>noise</system-reminder>second ask'),
  reply(22, [use('b1', 'Bash', { command: 'npm test' })]),
  // No result: the chat ended before it came.
  user(100, 'after the hooks'),
  'not json "type":"user"',
].join('\n')

test('prompts, calls with their results, subagents and compactions are read back, with their times', () => {
  const h = readHistory(transcript, ms(60))
  assert.deepEqual(h.map(p => [p.text, p.start, p.end]), [
    ['fix the login', ms(0), ms(16 - 1)],
    ['second ask', ms(20), ms(22)],
  ])
  const [first, second] = h
  assert.deepEqual(first?.calls.map(c => [c.name, c.start, c.end, c.isError, c.output]), [
    ['Read', ms(2), ms(3), false, 'export const login = 1'],
    ['Edit', ms(5), ms(9), true, 'no match'],
    ['Agent', ms(10), ms(14), false, 'found it'],
  ])
  assert.equal(first?.answer, 'Fixed.')
  assert.deepEqual(first?.compacts, [{ t: ms(16), trigger: 'auto', before: 180000, after: 12000, ms: 2000 }])
  assert.deepEqual(second?.calls.map(c => [c.name, c.end]), [['Bash', undefined]])
  // Nothing at or after the cut.
  assert.equal(readHistory(transcript, ms(4)).length, 1)
  assert.equal(readHistory(transcript, ms(4))[0]?.calls.length, 1)
})

test('what a person typed is what is left of a line without the app\'s reminders and command wrappers', () => {
  assert.equal(userText('<system-reminder>x</system-reminder>hello'), 'hello')
  assert.equal(userText('<command-name>/compact</command-name><command-args>keep it</command-args>'), '/compact keep it')
  assert.equal(userText('<local-command-stdout>ok</local-command-stdout>'), '')
})

test('the rows read back are timed, marked, and say how they ended', () => {
  const rows = historyNodes(readHistory(transcript, ms(60)), 300)
  const by = (name: string) => rows.find(n => n.name === name) as Node
  assert.ok(rows.every(n => n.hist))
  assert.deepEqual([by('Read').parent, by('Read').arg, by('Read').status, by('Read').end! - by('Read').start], [rows[0]?.id, '/p/login.ts', 'ok', 1000])
  assert.deepEqual(by('Read').touch, { op: 'read', paths: ['/p/login.ts'] })
  assert.deepEqual([by('Edit').status, by('Edit').output], ['err', 'no match'])
  assert.deepEqual([by('Explore').kind, by('Explore').arg, by('Explore').input, by('Explore').status], ['agent', 'look around', 'find auth', 'ok'])
  assert.deepEqual([by('Bash').status, by('Bash').output], ['err', '(no result recorded)'])
  assert.deepEqual([by('Compact').compact, by('Compact').start, by('Compact').end], [{ trigger: 'auto', before: 180000, after: 12000 }, ms(14), ms(16)])
  assert.equal(rows.find(n => n.kind === 'prompt')?.output, 'Fixed.')
  // Only the newest prompts that fit are kept.
  const few = historyNodes(readHistory(transcript, ms(60)), 3)
  assert.deepEqual(few.filter(n => n.kind === 'prompt').map(n => n.arg), ['second ask'])
})

let t = ms(1000)
const ev = (e: Partial<Ev> & Pick<Ev, 'kind'>): Ev => ({ v: 1, t: (t += 100), sid: 's', ...e })
const view = (over: Partial<View> = {}): View => ({
  mode: 'tree', selected: '', folded: new Set(), shown: new Set(), shut: new Set(), now: ms(1100),
  hooksInstalled: true, hooksOff: false, hasWorkspace: true, sessions: [], picked: '', ...over,
})
const history = () => readHistory(transcript, ms(60))

test('history goes before what the hooks recorded, once, and a call the hooks saw is left as they drew it', () => {
  const s = new Session('s')
  s.apply({ v: 1, t: ms(60), sid: 's', kind: 'session_start', reason: 'startup' })
  s.apply({ v: 1, t: ms(61), sid: 's', kind: 'prompt', arg: 'live' })
  s.apply({ v: 1, t: ms(62), sid: 's', kind: 'tool_pre', tool: 'Read', toolUseId: 'r1', arg: 'live read' })
  s.adoptHistory(history())
  const prompts = s.nodes.filter(n => n.kind === 'prompt').map(n => n.arg)
  assert.deepEqual(prompts, ['fix the login', 'second ask', 'live'])
  // The Read of the history is the one the hooks drew: not twice.
  assert.equal(s.nodes.filter(n => n.id === 't:r1').length, 1)
  assert.equal(s.get('t:r1')?.arg, 'live read')
  assert.equal(s.get('t:r1')?.hist, undefined)
  const count = s.nodes.length
  s.adoptHistory(history())
  assert.equal(s.nodes.length, count)
  assert.equal(s.historyDone, true)
})

test('where the hooks began in the middle of a prompt, it takes its words and earlier calls and keeps what the hooks saw', () => {
  const s = new Session('s')
  // The hooks were added while the prompt "second ask" ran: its first event is a call.
  s.apply({ v: 1, t: ms(23), sid: 's', kind: 'tool_pre', tool: 'Bash', toolUseId: 'b2', arg: 'npm run build' })
  s.apply({ v: 1, t: ms(25), sid: 's', kind: 'tool_post', tool: 'Bash', toolUseId: 'b2', output: 'ok' })
  s.apply({ v: 1, t: ms(30), sid: 's', kind: 'stop', output: 'done' })
  assert.equal(s.nodes[0]?.arg, '(earlier activity)')
  assert.equal(s.historyCut(), ms(23))
  s.adoptHistory(readHistory(transcript, s.historyCut()))

  const prompts = s.nodes.filter(n => n.kind === 'prompt')
  assert.deepEqual(prompts.map(n => n.arg), ['fix the login', 'second ask'])
  const second = prompts[1] as Node
  assert.deepEqual([second.status, second.end, second.output, second.hist], ['ok', ms(30), 'done', undefined])
  // Its calls: the one before the hooks, and the one they saw, both under it.
  assert.deepEqual(s.nodes.filter(n => n.parent === second.id).map(n => n.name), ['Bash', 'Bash'])
  assert.equal(s.root, second.id)
  assert.equal(s.nodes.some(n => n.arg === '(earlier activity)'), false)
})

test('a prompt that is the first event is not read twice; a resumed session\'s earlier prompts come back', () => {
  const s = new Session('s')
  s.apply({ v: 1, t: ms(20) + 400, sid: 's', kind: 'prompt', arg: 'second ask' })
  assert.equal(s.historyCut(), ms(20) + 400 - 3000)
  s.adoptHistory(readHistory(transcript, s.historyCut()))
  assert.deepEqual(s.nodes.filter(n => n.kind === 'prompt').map(n => n.arg), ['fix the login', 'second ask'])
  assert.equal(s.nodes.filter(n => n.kind === 'prompt' && n.hist).length, 1)
})

test('the reader reads history once the transcript is there, and a history prompt has a summary and a note', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'call-stack-'))
  const file = path.join(dir, 't.jsonl')
  const s = new Session('s')
  s.apply({ v: 1, t: ms(60), sid: 's', kind: 'session_start', transcript: file })
  const r = new TranscriptReader()
  r.apply(s)
  // Not written yet: nothing, and it tries again.
  assert.equal(s.historyDone, false)
  fs.writeFileSync(file, transcript + '\n')
  r.apply(s)
  assert.equal(s.historyDone, true)
  assert.deepEqual(s.nodes.filter(n => n.kind === 'prompt').map(n => n.arg), ['fix the login', 'second ask'])
  // The model and usage of its replies come with it.
  assert.equal(s.nodes[0]?.model, 'claude-opus-5-5')

  const first = s.nodes[0] as Node
  const rep = reportOf(first, s.nodes.filter(n => n.parent === first.id), ms(1000))
  assert.equal(rep?.calls, 2)
  // What was asked is not known for a call read back.
  assert.equal(rep?.perms, undefined)
  const html = renderBody(s, view({ selected: (s.nodes.find(n => n.name === 'Edit') as Node).id }))
  assert.match(html, /read back from the transcript, from before the hooks/)
  fs.rmSync(dir, { recursive: true })
})

const cancelMark = (s: number, over: object = {}, text = '[Request interrupted by user]') => user(s, [{ type: 'text', text }], over)

test('a cancel is a user message that starts with the marker, and nothing that only holds those words', () => {
  const p = new Parsed()
  p.feed(
    [
      cancelMark(4),
      cancelMark(8, {}, '[Request interrupted by user for tool use]'),
      // A tool result that holds the words (a file being read), a prompt that quotes them, a subagent's own.
      result(9, 'r1', 'the marker is "[Request interrupted by user]" in the transcript'),
      user(10, 'why does it say [Request interrupted by user] in the log?'),
      cancelMark(11, { isSidechain: true }),
    ].join('\n') + '\n',
  )
  assert.deepEqual(p.interrupts, [ms(4), ms(8)])
})

test('a prompt the hooks left open is ended as interrupted at the cancel the transcript tells of', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'call-stack-'))
  const file = path.join(dir, 't.jsonl')
  fs.writeFileSync(file, [user(0, 'long job'), reply(1, [use('b1', 'Bash', { command: 'sleep 60' })]), cancelMark(6)].join('\n') + '\n')
  const s = new Session('s')
  s.apply({ v: 1, t: ms(0), sid: 's', kind: 'prompt', arg: 'long job', transcript: file })
  s.apply({ v: 1, t: ms(2), sid: 's', kind: 'tool_pre', tool: 'Bash', toolUseId: 'b1', arg: 'sleep 60' })
  // The next prompt began later, and closed the first as done; the session end closed nothing more.
  s.apply({ v: 1, t: ms(120), sid: 's', kind: 'prompt', arg: 'next', transcript: file })
  const first = s.nodes.find(n => n.kind === 'prompt') as Node
  assert.equal(first.status, 'ok')
  new TranscriptReader().apply(s)
  assert.deepEqual([first.status, first.why, first.end], ['err', 'interrupted', ms(6)])
  const call = s.nodes.find(n => n.kind === 'tool') as Node
  assert.deepEqual([call.status, call.end], ['err', ms(6)])
  const second = s.nodes.filter(n => n.kind === 'prompt')[1] as Node
  assert.deepEqual([second.status, second.why], ['run', undefined])
})

test('a prompt that got its Stop is not marked, even if a cancel falls in its time', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'call-stack-'))
  const file = path.join(dir, 't.jsonl')
  fs.writeFileSync(file, [user(0, 'quick'), cancelMark(3)].join('\n') + '\n')
  const s = new Session('s')
  s.apply({ v: 1, t: ms(0), sid: 's', kind: 'prompt', arg: 'quick', transcript: file })
  s.apply({ v: 1, t: ms(2), sid: 's', kind: 'stop', transcript: file })
  new TranscriptReader().apply(s)
  const p = s.nodes.find(n => n.kind === 'prompt') as Node
  assert.deepEqual([p.status, p.why], ['ok', undefined])
})
