import * as assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { test } from 'node:test'

import { assignModels, ChatModelReader, parseChatLog } from '../chatmodels'
import { Session } from '../model'
import { renderBody, summaryMarkdown, type View } from '../render'
import { reportOf } from '../stats'
import type { Ev, Node } from '../types'

const lines = (...o: unknown[]) => o.map(x => JSON.stringify(x)).join('\n') + '\n'
const picked = (id: string) => ({ identifier: id, metadata: { name: 'x' } })

test('the snapshot gives the requests and the model picked', () => {
  const log = lines({
    kind: 0,
    v: {
      requests: [{ requestId: 'a', modelId: 'copilot/gpt-4.1' }, { requestId: 'b' }],
      inputState: { selectedModel: picked('copilot/auto') },
    },
  })
  assert.deepEqual(parseChatLog(log), { requests: ['copilot/gpt-4.1', undefined], selected: 'copilot/auto' })
})

test('the changes after the snapshot are replayed: requests added, a model set, a pick changed', () => {
  const log = lines(
    { kind: 0, v: { requests: [], inputState: { selectedModel: picked('copilot/auto') } } },
    { kind: 2, k: ['requests'], v: [{ modelId: 'copilot/gpt-4.1' }] },
    { kind: 2, k: ['requests'], v: [{ requestId: 'two' }] },
    { kind: 1, k: ['requests', 1, 'modelId'], v: 'copilot/claude-sonnet-4' },
    { kind: 1, k: ['inputState', 'selectedModel'], v: picked('copilot/o3') },
    { kind: 1, k: ['requests', 0, 'response'], v: [] },
  )
  assert.deepEqual(parseChatLog(log), { requests: ['copilot/gpt-4.1', 'copilot/claude-sonnet-4'], selected: 'copilot/o3' })
})

test('a torn line, an unknown kind or a log with none of it leave the model unknown', () => {
  assert.deepEqual(parseChatLog('{"kind":0,"v":{"requests":[{"modelId":"a"}]}}\n{"kind":'), { requests: ['a'], selected: undefined })
  assert.deepEqual(parseChatLog(lines({ kind: 9, k: ['requests'], v: [] }, [1, 2], 'x')), { requests: [] })
  assert.deepEqual(parseChatLog(''), { requests: [] })
})

const prompts = (n: number): Node[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, kind: 'prompt', name: 'Prompt', arg: '', status: 'ok', start: i, end: i }) as Node)

test('prompts are matched to the chat requests from the newest end', () => {
  // The chat has three requests; the hooks saw only the last two.
  const ps = prompts(2)
  assignModels(ps, { requests: ['m1', 'm2', 'm3'] })
  assert.deepEqual(ps.map(p => p.model), ['m2', 'm3'])
  // More prompts than requests: the oldest have no model.
  const more = prompts(3)
  assignModels(more, { requests: ['m3'] })
  assert.deepEqual(more.map(p => p.model), [undefined, undefined, 'm3'])
})

test('with no model on the requests, the newest prompt takes the model picked', () => {
  const ps = prompts(2)
  assignModels(ps, { requests: [undefined, undefined], selected: 'copilot/auto' })
  assert.deepEqual(ps.map(p => p.model), [undefined, 'copilot/auto'])
})

test('the reader finds a session by id in the chat folders, and re-reads a file that changed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chats-'))
  try {
    const file = path.join(dir, 's.jsonl')
    fs.writeFileSync(file, lines({ kind: 0, v: { requests: [{ modelId: 'copilot/gpt-4.1' }] } }))
    const reader = new ChatModelReader(() => [path.join(dir, 'nope'), dir])
    assert.deepEqual(reader.read('s')?.requests, ['copilot/gpt-4.1'])
    fs.appendFileSync(file, lines({ kind: 2, k: ['requests'], v: [{ modelId: 'copilot/o3' }] }))
    assert.deepEqual(reader.read('s')?.requests, ['copilot/gpt-4.1', 'copilot/o3'])
    assert.equal(reader.read('missing'), undefined)
    // An id that is a path is not read.
    assert.equal(reader.read('../s'), undefined)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// A finished prompt that made a call, in a session the reader names a model for.
let t = 1000
const ev = (e: Partial<Ev> & Pick<Ev, 'kind'>): Ev => ({ v: 1, t: (t += 100), sid: 's', ...e })
const done = () => {
  const s = new Session('s')
  ;[
    ev({ kind: 'prompt', arg: 'work' }),
    ev({ kind: 'tool_pre', tool: 'Read', arg: 'a.ts', toolUseId: 'r' }),
    ev({ kind: 'tool_post', tool: 'Read', toolUseId: 'r', output: 'x' }),
    ev({ kind: 'stop', output: 'done' }),
  ].forEach(e => s.apply(e))
  return s
}
const view = (over: Partial<View> = {}): View => ({
  mode: 'waterfall', selected: '', folded: new Set(), shown: new Set(), shut: new Set(), now: t + 500,
  hooksInstalled: true, hooksOff: false, hasWorkspace: true, sessions: [], picked: '', ...over,
})

test('a prompt shows its model, a call says which model called it, and the summary lists it', () => {
  const s = done()
  assignModels(s.nodes.filter(n => n.kind === 'prompt'), { requests: ['copilot/gpt-4.1'] })
  const html = renderBody(s, view())
  assert.match(html, /<span class="model"[^>]*>gpt-4\.1<\/span>/)
  const call = s.nodes.find(n => n.name === 'Read')
  assert.match(renderBody(s, view({ selected: call?.id ?? '' })), /called by gpt-4\.1/)
  assert.match(renderBody(s, view({ selected: s.nodes[0]?.id ?? '' })), /model gpt-4\.1/)
  assert.match(html, /<span class="dim">Models<\/span><span class="val"[^>]*>gpt-4\.1</)
  assert.equal(reportOf(s.nodes[0] as Node, s.nodes.slice(1), t)?.models[0]?.model, 'copilot/gpt-4.1')
  assert.match(summaryMarkdown(s, s.nodes[0]?.id ?? '', t) ?? '', /- \*\*Models:\*\* gpt-4\.1/)
})

test('without a model nothing about one is drawn', () => {
  const html = renderBody(done(), view())
  assert.doesNotMatch(html, /class="model"|Models|called by/)
})
