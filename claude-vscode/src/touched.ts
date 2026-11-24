import { busyOf } from './stats'
import type { Node } from './types'
import { sizeOf } from './view/format'

/** One file, and what the calls of a prompt did to it. */
export type FileTouch = {
  path: string
  reads: number
  edits: number
  writes: number
  others: number
  /** The calls that touched it, in the order they started. */
  calls: Node[]
  /** Their time added up, and the estimated tokens that went through them. */
  ms: number
  tokens: number
  failed: number
  /** The lines its finished calls added and took out, from their arguments. */
  added: number
  removed: number
  /** Reads of the file again with nothing written to it in between. */
  rereads: number
  /** Calls that did the same to the file right after one that failed. */
  retries: number
}

/** The calls that ran one command, or looked up one thing, grouped. */
export type Group = {
  kind: 'run' | 'search' | 'web'
  what: string
  calls: Node[]
  ms: number
  tokens: number
  failed: number
}

/** What the calls of a prompt touched: files, commands, things looked up. */
export type Touched = {
  /** Files changed first, then the most touched. */
  files: FileTouch[]
  /** Every call that touched something, in the order they started. */
  calls: Node[]
  commands: Group[]
  lookups: Group[]
  /** Files the prompt changed or created, and files it only read. */
  edited: number
  readOnly: number
  /** The lines added and taken out, over all the files. */
  added: number
  removed: number
  /** The prompt's time, how much of it a call was running, and how long a call waited for the person. */
  wall: number
  busy: number
  waited: number
}

const tok = (n: Node) => Math.ceil((sizeOf(n, 'input') + sizeOf(n, 'output')) / 4)

const total = (calls: Node[], now: number) => calls.reduce((t, n) => t + Math.max(0, (n.end ?? now) - n.start), 0)

/**
 * What the calls under a prompt touched, from what each was given (`Node.touch`), so that it works
 * while the prompt runs. A call that touched several files counts once for each.
 */
export const touchedOf = (top: Node, below: Node[], now: number): Touched => {
  const calls = below.filter(n => n.kind === 'tool' && n.touch).sort((a, b) => a.start - b.start)

  const files = new Map<string, FileTouch>()
  const state = new Map<string, { read: boolean; failedOp?: string }>()
  const groups = new Map<string, Group>()
  for (const n of calls) {
    const t = n.touch!
    if (t.op === 'run' || t.op === 'search' || t.op === 'web') {
      const what = (t.what || t.paths.join(' ') || n.name).replace(/\s+/g, ' ').trim()
      const key = `${t.op}:${what}`
      const g = groups.get(key) ?? { kind: t.op, what, calls: [], ms: 0, tokens: 0, failed: 0 }
      g.calls.push(n)
      g.tokens += tok(n)
      if (n.status === 'err') g.failed++
      groups.set(key, g)
      continue
    }
    for (const path of t.paths) {
      const f = files.get(path) ?? {
        path,
        reads: 0,
        edits: 0,
        writes: 0,
        others: 0,
        calls: [],
        ms: 0,
        tokens: 0,
        failed: 0,
        added: 0,
        removed: 0,
        rereads: 0,
        retries: 0,
      }
      const st = state.get(path) ?? { read: false }
      f.calls.push(n)
      f.tokens += tok(n)
      if (n.status === 'err') f.failed++
      const c = changeIn(n, path)
      if (c) {
        f.added += c.added
        f.removed += c.removed
      }
      if (t.op === 'read') {
        f.reads++
        if (st.read) f.rereads++
        st.read = true
      } else {
        if (t.op === 'edit') f.edits++
        else if (t.op === 'write') f.writes++
        else f.others++
        st.read = false
      }
      if (st.failedOp === t.op) f.retries++
      st.failedOp = n.status === 'err' ? t.op : undefined
      files.set(path, f)
      state.set(path, st)
    }
  }
  for (const f of files.values()) f.ms = total(f.calls, now)
  for (const g of groups.values()) g.ms = total(g.calls, now)

  const list = [...files.values()].sort((a, b) => {
    const aw = a.edits + a.writes > 0 ? 0 : 1
    const bw = b.edits + b.writes > 0 ? 0 : 1
    return aw - bw || b.calls.length - a.calls.length || a.path.localeCompare(b.path)
  })
  const wall = (top.end ?? now) - top.start
  return {
    files: list,
    calls,
    commands: [...groups.values()].filter(g => g.kind === 'run'),
    lookups: [...groups.values()].filter(g => g.kind !== 'run'),
    edited: list.filter(f => f.edits + f.writes > 0).length,
    readOnly: list.filter(f => f.edits + f.writes === 0).length,
    added: list.reduce((n, f) => n + f.added, 0),
    removed: list.reduce((n, f) => n + f.removed, 0),
    wall,
    busy: busyOf(top, below.filter(n => n.kind === 'tool' || n.kind === 'agent'), now),
    waited: below.reduce((t, n) => t + (n.perm?.waited ?? 0), 0),
  }
}

/** What one call added to a file and took out of it, when the call is done (a failed edit changed nothing). */
export const changeIn = (n: Node, path: string): { added: number; removed: number } | undefined =>
  n.status === 'ok' ? n.touch?.changes?.find(c => c.path === path) : undefined

/** The lines a finished call added and took out over all the files it touched. */
export const callLines = (n: Node): { added: number; removed: number } =>
  n.status === 'ok'
    ? (n.touch?.changes ?? []).reduce((t, c) => ({ added: t.added + c.added, removed: t.removed + c.removed }), { added: 0, removed: 0 })
    : { added: 0, removed: 0 }

/** The directory every path in the list sits under (whole segments), '' when they share none. */
export const commonDir = (paths: string[]): string => {
  const dirs = paths.map(p => p.split('/').slice(0, -1))
  const first = dirs[0]
  if (!first) return ''
  let n = first.length
  for (const d of dirs) {
    let i = 0
    while (i < n && i < d.length && d[i] === first[i]) i++
    n = i
  }
  return first.slice(0, n).join('/')
}
