import type { Node } from '../../types'
import { dur, sizeOf, tokText } from '../format'
import type { Pane } from './context'

/** Below this many columns a row gives up its `+start` text and the "slowest" label: the bar shows where it started. */
export const WIDE = 72

/** The two cells at a row's right: its output's size (none until there is an output) and its time. */
export const cellsOf = (c: Pane, node: Node, t0: number) => {
  const ms = c.span(node)
  const right = node.hist
    ? node.ms !== undefined
      ? dur(ms)
      : '—'
    : c.isWaterfall && c.cols >= WIDE
      ? `+${dur(node.start - t0)}  ${dur(ms)}`
      : dur(ms)
  const out = sizeOf(node, 'output') > 0 ? tokText(node, 'output') : ''
  return { right, out }
}
