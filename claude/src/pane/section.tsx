import type { EngineInterface } from 'claude-code'

import type { Node } from '../../types'
import { dur } from '../format'
import { MAX_RESOURCES, openId, resourcesOf, type Resource } from '../resources'
import { cellsOf } from './cells'
import type { Lane, Pane, Place, Section } from './context'
import { report } from './report'
import { row } from './row'

// One prompt: its own time axis and its rows, honoring folds.
export function section($: EngineInterface, c: Pane, top: Node) {
  const { Box, Text } = c.els
  const all = [top, ...c.below(top)]
  const t0 = top.start
  const t1 = Math.max(1000, ...all.map(n => (n.hist ? c.span(n) : (n.end ?? c.now) - t0)))
  const slowest = all
    .filter(n => n.kind !== 'prompt' && n.kind !== 'event' && n.status !== 'run')
    .sort((a, b) => c.span(b) - c.span(a))[0]

  // Each row with its place in the tree: for each level above it, whether that
  // branch goes on below (a guide line).
  const rows: Place[] = []
  const walk = (n: Node, depth: number, trail: Lane[], isLast: boolean) => {
    const isFolded = c.fold.has(n.id)
    // What a call involved stays shut until the person opens it.
    const res = c.fold.has(openId(n.id)) ? resourcesOf(n) : []
    const shut = res.length === 0 ? resourcesOf(n).length : 0
    rows.push({ node: n, depth, hidden: isFolded ? c.below(n).length : shut, trail, isLast })
    if (isFolded) return
    const sibs = c.kids.get(n.id) ?? []
    const next = depth === 0 ? [] : [...trail, { last: isLast }]
    // What the call involved comes first, then what it started.
    const shown: Resource[] = res.slice(0, MAX_RESOURCES)
    if (res.length > shown.length) {
      shown.push({ id: `more:${n.id}`, kind: 'more', label: `+${res.length - shown.length} more`, full: '', op: '', added: 0, removed: 0 })
    }
    shown.forEach((r, i) => rows.push({ node: n, res: r, depth: depth + 1, hidden: 0, trail: next, isLast: sibs.length === 0 && i === shown.length - 1 }))
    sibs.forEach((k, i) => walk(k, depth + 1, next, i === sibs.length - 1))
  }
  walk(top, 0, [], true)

  // The right-hand cells of every row, measured, so that the columns line up.
  const own = rows.filter(r => !r.res)
  const cells = own.map(r => cellsOf(c, r.node))
  const s: Section = {
    top,
    t0,
    t1,
    slowest,
    rowCount: own.length,
    tokW: Math.max(0, ...cells.map(x => x.out.length)),
    timeW: Math.max(0, ...cells.map(x => x.right.length)),
  }
  return (
    // A row is one line, and in the waterfall its bar is the line under it.
    <Box flexDirection="column">
      {top.hist ? (
        <Text dimColor>Earlier in this chat · only subagent durations were recorded</Text>
      ) : null}
      {c.barW > 0 && !top.hist && !c.fold.has(top.id) ? (
        // The time axis, over the bar column at the right end of the rows.
        <Box justifyContent="flex-end">
          <Box width={c.barW} justifyContent="space-between">
            <Text dimColor>0</Text>
            <Text dimColor>{dur(Math.round(t1 / 2))}</Text>
            <Text dimColor>{dur(t1)}</Text>
          </Box>
        </Box>
      ) : null}
      {rows.map(r => row($, c, s, r))}
      {c.fold.has(top.id) ? null : report($, c, top)}
    </Box>
  )
}
