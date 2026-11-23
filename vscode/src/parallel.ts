import type { Node } from './types'

/** Calls under one parent that ran at the same time. */
export type Group = { members: Node[] }

/**
 * Which of a parent's children ran at the same time: those whose spans overlap,
 * chained, so that A and B overlapping and B and C overlapping make one group
 * of three. A call still running lasts until `now`. Calls that touch end to
 * start are in sequence, not together. Answers by node id, only for calls in a
 * group of two or more.
 *
 * Neither Copilot's hooks nor the engine say which call started another, so
 * overlap in time is what there is to go on.
 */
export const parallelGroups = (siblings: Node[], now: number): Map<string, Group> => {
  const out = new Map<string, Group>()
  const sorted = [...siblings].sort((a, b) => a.start - b.start)

  let cur: Node[] = []
  let curEnd = -Infinity
  const flush = () => {
    if (cur.length > 1) {
      const group = { members: cur }
      for (const n of cur) out.set(n.id, group)
    }
    cur = []
  }
  for (const n of sorted) {
    if (cur.length > 0 && n.start < curEnd) {
      cur.push(n)
      curEnd = Math.max(curEnd, n.end ?? now)
    } else {
      flush()
      cur = [n]
      curEnd = n.end ?? now
    }
  }
  flush()
  return out
}
