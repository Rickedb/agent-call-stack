import type { Node } from './types'
import { changeIn } from './touched'

/** What a tool call involved: a file, an address it fetched, a command it ran, what it searched for. */
export type Resource = {
  /** Its row's id, which tells it apart from the call's own and from the call's other resources. */
  id: string
  kind: 'file' | 'link' | 'command' | 'query' | 'more'
  /** What its row shows: a file's name only, an address without its scheme, a command. */
  label: string
  /** The whole path, address, command or search text. */
  full: string
  /** What the call did with it: read, edit, write, fetch, run, search. */
  op: string
  /** The lines the call added to it and took out, for a file it changed. */
  added: number
  removed: number
}

/**
 * The id a call's resources are opened under, in the same set as the folded rows: they are shut until
 * the person opens them, so what the set holds here is what is open.
 */
export const openId = (id: string): string => `open:${id}`

/** The resources a call shows under its row before the rest are counted in a line. */
export const MAX_RESOURCES = 8

const oneLine = (s: string, max: number): string => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

const nameOf = (path: string): string => path.replace(/\/+$/, '').split('/').pop() || path

/** The resources of a call, from what it was given (`Node.touch`): none for a call that touched nothing. */
export const resourcesOf = (n: Node): Resource[] => {
  const t = n.touch
  if (!t || n.kind !== 'tool') return []
  const out: Omit<Resource, 'id'>[] = []
  const none = { added: 0, removed: 0 }
  if (t.op === 'run') {
    if (t.what) out.push({ kind: 'command', label: oneLine(t.what, 200), full: t.what, op: 'run', ...none })
  } else if (t.op === 'web') {
    const links = t.links ?? []
    for (const url of links) out.push({ kind: 'link', label: url.replace(/^https?:\/\//i, '').replace(/\/$/, ''), full: url, op: 'fetch', ...none })
    if (!links.length && t.what) out.push({ kind: 'query', label: oneLine(t.what, 200), full: t.what, op: 'search', ...none })
  } else {
    if (t.op === 'search' && t.what) out.push({ kind: 'query', label: oneLine(t.what, 200), full: t.what, op: 'search', ...none })
    for (const path of t.paths) {
      const c = changeIn(n, path)
      out.push({
        kind: 'file',
        label: nameOf(path),
        full: path,
        op: t.op === 'search' ? 'searched in' : t.op === 'other' ? 'touched' : t.op,
        added: c?.added ?? 0,
        removed: c?.removed ?? 0,
      })
    }
  }
  return out.map((r, i) => ({ ...r, id: `res:${n.id}:${i}` }))
}

/** The calls of a list that involved the same resource, with the lines each added and took out. */
export const callsOn = (calls: Node[], r: Resource): { node: Node; added: number; removed: number }[] =>
  calls.flatMap(node => {
    const same = resourcesOf(node).find(x => x.kind === r.kind && x.full === r.full)
    return same ? [{ node, added: same.added, removed: same.removed }] : []
  })
