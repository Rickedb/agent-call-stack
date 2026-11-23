import type { Node } from '../../types'
import type { Pane } from './context'
import { tint } from './theme'

// A row's duration as a bar at the row's right end, from where it started, in
// the waterfall. A fixed-width track with a filled box in it, one line high: no
// text to wrap, and nothing for a surface's font to push out of its cell.
export const bar = (c: Pane, n: Node, t0: number, t1: number) => {
  const { Box, Text } = c.els
  // History has no start time, and most of it no duration: the track alone.
  const isTimed = !n.hist || n.ms !== undefined
  const off = c.isWaterfall && !n.hist ? Math.min(c.barW - 1, Math.floor(((n.start - t0) / t1) * c.barW)) : 0
  const wide = Math.max(1, Math.min(c.barW - off, Math.ceil((c.span(n) / t1) * c.barW)))
  return (
    <Box width={c.barW} flexShrink={0} marginLeft={1} overflow="hidden" backgroundColor="subtle">
      {isTimed ? (
        <Box marginLeft={off} width={wide} flexShrink={0} backgroundColor={tint(n)}>
          <Text> </Text>
        </Box>
      ) : (
        <Text> </Text>
      )}
    </Box>
  )
}
