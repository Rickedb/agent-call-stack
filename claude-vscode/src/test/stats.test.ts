import * as assert from 'node:assert/strict'
import { test } from 'node:test'

import { reportOf } from '../stats'
import type { Node } from '../types'

const node = (over: Partial<Node> & Pick<Node, 'id' | 'kind' | 'name'>): Node => ({
  arg: '',
  status: 'ok',
  start: 0,
  end: 0,
  ...over,
})
// A text of this many tokens (four characters each).
const tok = (n: number) => 'x'.repeat(n * 4)

const prompt = node({ id: 'p', kind: 'prompt', name: 'Prompt', start: 0, end: 10_000, input: tok(10), output: tok(20) })
const below = [
  node({ id: 'a', kind: 'tool', name: 'Read', parent: 'p', start: 0, end: 1000, input: tok(5), output: tok(100) }),
  node({ id: 'b', kind: 'tool', name: 'Read', parent: 'p', start: 1000, end: 4000, input: tok(5), output: tok(300) }),
  node({ id: 'c', kind: 'tool', name: 'Bash', parent: 'p', start: 5000, end: 6000, input: tok(4), output: tok(6), status: 'err' }),
  node({ id: 'ag', kind: 'agent', name: 'Explore', parent: 'p', start: 6000, end: 9000, input: tok(8), output: tok(2) }),
]

test('no summary while the prompt runs, or when it made no call', () => {
  assert.equal(reportOf({ ...prompt, status: 'run', end: undefined }, below, 20_000), undefined)
  assert.equal(reportOf(prompt, [], 20_000), undefined)
})

test('calls are counted and grouped by tool, the most called first', () => {
  const r = reportOf(prompt, below, 20_000)
  assert.ok(r)
  assert.equal(r.calls, 3) // the subagent is not a tool call
  assert.equal(r.failed, 1)
  assert.deepEqual(
    r.kinds.map(k => [k.name, k.count, k.failed]),
    [
      ['Read', 2, 0],
      ['Bash', 1, 1],
    ],
  )
  const read = r.kinds[0]
  assert.equal(read?.ms, 4000)
  assert.equal(read?.avg, 2000)
  assert.equal(read?.tokens, 5 + 100 + 5 + 300)
})

test('the average, slowest and heaviest calls', () => {
  const r = reportOf(prompt, below, 20_000)
  assert.ok(r)
  assert.equal(r.avg, (1000 + 3000 + 1000) / 3)
  assert.equal(r.slowest?.id, 'b')
  assert.equal(r.heaviest?.id, 'b')
  assert.equal(r.heavy, 305)
})

test('tokens: the prompt and every call in, the answer and every call out', () => {
  const r = reportOf(prompt, below, 20_000)
  assert.ok(r)
  assert.equal(r.input, 10 + 5 + 5 + 4 + 8)
  assert.equal(r.output, 20 + 100 + 300 + 6 + 2)
})

test('the time in calls counts overlaps once, and the subagents are told apart', () => {
  const r = reportOf(prompt, [...below, node({ id: 'd', kind: 'tool', name: 'Grep', parent: 'p', start: 500, end: 2000 })], 20_000)
  assert.ok(r)
  assert.equal(r.wall, 10_000)
  // 0-4000 (Read, Read, Grep inside), 5000-6000, and the subagent's 6000-9000.
  assert.equal(r.busy, 4000 + 1000 + 3000)
  assert.equal(r.agents.count, 1)
  assert.equal(r.agents.ms, 3000)
  assert.equal(r.agents.longest?.id, 'ag')
})

test('a call with no end yet has no time, but counts', () => {
  const open = node({ id: 'z', kind: 'tool', name: 'Edit', parent: 'p', start: 7000, end: undefined, status: 'err' })
  const r = reportOf(prompt, [...below, open], 20_000)
  assert.ok(r)
  assert.equal(r.calls, 4)
  const edit = r.kinds.find(k => k.name === 'Edit')
  assert.equal(edit?.done, 0)
  assert.equal(edit?.avg, 0)
  assert.equal(r.avg, (1000 + 3000 + 1000) / 3)
})
