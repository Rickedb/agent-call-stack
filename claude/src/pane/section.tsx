import type { EngineInterface } from 'claude-code'

import type { Node } from '../../types'
import { dur } from '../format'
import type { Pane, Section } from './context'
import { row } from './row'

// One prompt: its own time axis and its rows, honoring folds.
export function section($: EngineInterface, c: Pane, top: Node) {
  const { Box, Text } = c.els
  const all = [top, ...c.below(top)]
  const t0 = top.start
  const t1 = Math.max(1000, ...all.map(n => (n.hist ? c.span(n) : (n.end ?? c.now) - t0)))
  const slowest = all
    .filter(n => n.kind !== 'prompt' && n.status !== 'run')
    .sort((a, b) => c.span(b) - c.span(a))[0]

  const rows: { node: Node; depth: number; hidden: number }[] = []
  const walk = (n: Node, depth: number) => {
    rows.push({ node: n, depth, hidden: c.fold.has(n.id) ? c.below(n).length : 0 })
    if (!c.fold.has(n.id)) (c.kids.get(n.id) ?? []).forEach(k => walk(k, depth + 1))
  }
  walk(top, 0)

  const s: Section = { t0, t1, slowest, rowCount: rows.length }
  return (
    // The tree is one line per call; only the waterfall needs air for its bars.
    <Box flexDirection="column" gap={c.isWaterfall ? 1 : 0}>
      {top.hist ? (
        <Text dimColor>Earlier in this chat · only subagent durations were recorded</Text>
      ) : null}
      {c.isWaterfall && !top.hist ? (
        <Box marginLeft={c.gutter} width={c.barW} justifyContent="space-between">
          <Text dimColor>0</Text>
          <Text dimColor>{dur(Math.round(t1 / 2))}</Text>
          <Text dimColor>{dur(t1)}</Text>
        </Box>
      ) : null}
      {rows.map(r => row($, c, s, r))}
    </Box>
  )
}
