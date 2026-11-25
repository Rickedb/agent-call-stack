import type { Session } from '../model'
import { resourcesOf } from '../resources'
import type { Node } from '../types'
import { span } from './format'
import type { Ctx, View } from './types'

/** Children by parent; a node whose parent is gone has none above it. */
export const index = (list: Node[]) => {
  const ids = new Set(list.map(n => n.id))
  const kids = new Map<string, Node[]>()
  for (const n of list) {
    if (n.parent && ids.has(n.parent)) kids.set(n.parent, [...(kids.get(n.parent) ?? []), n])
  }
  // Transcript notes are read after the calls the hooks saw; draw every parent's children in time order.
  for (const [id, children] of kids) kids.set(id, children.slice().sort((a, b) => a.start - b.start))
  const below = (n: Node): Node[] => (kids.get(n.id) ?? []).flatMap(c => [c, ...below(c)])
  return { kids, below }
}

export const makeCtx = (s: Session, v: View): Ctx => {
  const list = s.nodes
  const { kids, below } = index(list)
  const prompts = list.filter(n => n.kind === 'prompt')
  return {
    v,
    list,
    prompts,
    byId: new Map(list.map(n => [n.id, n])),
    resById: new Map(list.flatMap(node => resourcesOf(node).map(res => [res.id, { res, node }] as const))),
    kids,
    below,
    promptNo: new Map(prompts.map((n, i) => [n.id, i + 1])),
    isWaterfall: v.mode === 'waterfall',
  }
}

/** The prompt a row belongs to: itself when it is one. */
export const promptOf = (c: Ctx, n: Node): Node => {
  let cur = n
  while (cur.parent && c.byId.has(cur.parent)) cur = c.byId.get(cur.parent) as Node
  return cur
}

/** The time axis of a prompt: where it starts, and how long it and all under it took. */
export const timesOf = (c: Ctx, top: Node): { t0: number; t1: number } => {
  const t0 = top.start
  const t1 = Math.max(1000, ...[top, ...c.below(top)].map(n => (n.end ?? c.v.now) - t0))
  return { t0, t1 }
}

export const slowestOf = (c: Ctx, top: Node): Node | undefined =>
  [top, ...c.below(top)]
    .filter(n => n.kind !== 'prompt' && n.kind !== 'event' && n.kind !== 'note' && n.status !== 'run')
    .sort((a, b) => span(b, c.v.now) - span(a, c.v.now))[0]
