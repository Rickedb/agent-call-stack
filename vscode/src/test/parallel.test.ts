import * as assert from 'node:assert/strict'
import { test } from 'node:test'

import { parallelGroups } from '../parallel'
import type { Node } from '../types'

const node = (id: string, start: number, end?: number): Node => ({
  id,
  kind: 'tool',
  name: id,
  arg: '',
  status: end === undefined ? 'run' : 'ok',
  start,
  ...(end === undefined ? {} : { end }),
})
const ids = (m: Map<string, { members: Node[] }>) => [...m.keys()].sort()

test('calls that overlap in time are one group; calls in sequence are not', () => {
  const g = parallelGroups([node('a', 0, 100), node('b', 50, 150), node('c', 200, 300)], 1000)
  assert.deepEqual(ids(g), ['a', 'b'])
  assert.equal(g.get('a')?.members.length, 2)
  assert.equal(g.get('a'), g.get('b'))
})

test('a call that starts as another ends is in sequence with it', () => {
  assert.equal(parallelGroups([node('a', 0, 100), node('b', 100, 200)], 1000).size, 0)
})

test('overlap chains: A with B and B with C make one group of three', () => {
  const g = parallelGroups([node('a', 0, 100), node('b', 90, 190), node('c', 180, 280)], 1000)
  assert.equal(g.get('a')?.members.length, 3)
})

test('a call still running lasts until now', () => {
  // b started while a was still running, and neither has ended.
  const g = parallelGroups([node('a', 0), node('b', 400)], 1000)
  assert.deepEqual(ids(g), ['a', 'b'])
  // A later call that starts after a finished is not with it.
  assert.equal(parallelGroups([node('a', 0, 100), node('b', 400)], 1000).size, 0)
})

test('order in the list does not matter, and two separate groups stay apart', () => {
  const g = parallelGroups(
    [node('d', 510, 600), node('b', 40, 80), node('a', 0, 50), node('c', 500, 550)],
    1000,
  )
  assert.equal(g.get('a')?.members.length, 2)
  assert.equal(g.get('c')?.members.length, 2)
  assert.notEqual(g.get('a'), g.get('c'))
})

test('one call alone is no group', () => {
  assert.equal(parallelGroups([node('a', 0, 10)], 100).size, 0)
  assert.equal(parallelGroups([], 100).size, 0)
})
