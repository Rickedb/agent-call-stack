import type { Node } from '../../types'
import { dur, sizeOf, tokText } from '../format'
import type { Pane } from './context'

/** Below this many columns a row gives up the "slowest" label. */
export const WIDE = 72

/**
 * The two cells at a row's right: its output's size (none until there is an output) and its time:
 * what the call itself took, never the time elapsed before it (the bar shows where it started).
 * A prompt's is the total of the prompt.
 */
export const cellsOf = (c: Pane, node: Node) => {
  const ms = c.span(node)
  const right = node.hist && node.ms === undefined ? '—' : dur(ms)
  const out = sizeOf(node, 'output') > 0 ? tokText(node, 'output') : ''
  return { right, out }
}
