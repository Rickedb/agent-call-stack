import type { Node } from '../../types'
import type { Pane } from './context'
import { tint } from './theme'

// A row's duration as a bar under it: from where it started, in the waterfall.
export const bar = (c: Pane, n: Node, t0: number, t1: number) => {
  const { Box, Text } = c.els
  // History has no start time, and most of it no duration: the track alone.
  const isTimed = !n.hist || n.ms !== undefined
  const off =
    c.isWaterfall && !n.hist ? Math.min(c.barW - 1, Math.floor(((n.start - t0) / t1) * c.barW)) : 0
  const wide = Math.max(1, Math.min(c.barW - off, Math.ceil((c.span(n) / t1) * c.barW)))
  return (
    <Box marginLeft={c.gutter} width={c.barW} flexShrink={0} backgroundColor="subtle">
      {isTimed ? (
        <Box marginLeft={off} width={wide} backgroundColor={tint(n)}>
          <Text> </Text>
        </Box>
      ) : (
        <Text> </Text>
      )}
    </Box>
  )
}
