import * as assert from 'node:assert/strict'
import { test } from 'node:test'

import { collapseOlder } from '../collapse'
import { Model } from '../model'
import type { Ev } from '../types'

let t = 0
const prompt = (sid: string, arg: string): Ev => ({ v: 1, t: (t += 10), sid, kind: 'prompt', arg })
const ids = (m: Model, sid: string) =>
  (m.sessions.get(sid)?.nodes ?? []).filter(n => n.kind === 'prompt').map(n => n.id)

test('a new prompt folds the ones before it, and not itself', () => {
  const m = new Model()
  const seen = new Set<string>()
  const folded = new Set<string>()

  m.apply(prompt('s', 'one'))
  assert.equal(collapseOlder(m.sessions.values(), seen, folded), false)
  assert.equal(folded.size, 0)

  m.apply(prompt('s', 'two'))
  assert.equal(collapseOlder(m.sessions.values(), seen, folded), true)
  const [one, two] = ids(m, 's')
  assert.ok(folded.has(one as string))
  assert.ok(!folded.has(two as string))

  m.apply(prompt('s', 'three'))
  collapseOlder(m.sessions.values(), seen, folded)
  assert.deepEqual([...folded].sort(), ids(m, 's').slice(0, 2).sort())
})

test('what the person opened stays open until the next prompt', () => {
  const m = new Model()
  const seen = new Set<string>()
  const folded = new Set<string>()
  m.apply(prompt('s', 'one'))
  m.apply(prompt('s', 'two'))
  collapseOlder(m.sessions.values(), seen, folded)
  const [one] = ids(m, 's')

  folded.delete(one as string)
  // Nothing new came: the person's choice holds.
  assert.equal(collapseOlder(m.sessions.values(), seen, folded), false)
  assert.ok(!folded.has(one as string))

  m.apply(prompt('s', 'three'))
  collapseOlder(m.sessions.values(), seen, folded)
  assert.ok(folded.has(one as string))
})

test('the history read at start folds all but the latest, per session', () => {
  const m = new Model()
  for (const a of ['a1', 'a2', 'a3']) m.apply(prompt('A', a))
  m.apply(prompt('B', 'b1'))
  const folded = new Set<string>()
  collapseOlder(m.sessions.values(), new Set(), folded)
  assert.equal(folded.size, 2)
  assert.ok(!folded.has(ids(m, 'A')[2] as string))
  assert.ok(!folded.has(ids(m, 'B')[0] as string))
})

test('node ids do not repeat across sessions', () => {
  const m = new Model()
  m.apply({ v: 1, t: 1, sid: 'A', kind: 'tool_pre', tool: 'x' })
  m.apply({ v: 1, t: 2, sid: 'B', kind: 'tool_pre', tool: 'x' })
  const all = [...m.sessions.values()].flatMap(s => s.nodes.map(n => n.id))
  assert.equal(new Set(all).size, all.length)
})
