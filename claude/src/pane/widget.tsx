import type { Node } from '../../types'
import { clip, dur } from '../format'
import type { Pane } from './context'
import { icon, mark, tint } from './theme'

// A small seat: what runs now, at a glance.
export const widget = (c: Pane) => {
  const { Box, Text } = c.els
  const last = c.prompts[c.prompts.length - 1] as Node
  const live = [last, ...c.below(last)].filter(n => n.status === 'run' && n.kind !== 'prompt')
  const inner = live[live.length - 1] ?? last
  return (
    <Box flexDirection="column">
      <Text bold color={tint(inner)}>
        {icon(inner)} {mark(inner)} {clip(inner.name + (inner.arg ? ` ${inner.arg}` : ''), c.cols - 5)}
      </Text>
      <Text dimColor>
        {live.length} running · {dur(c.span(last))}
      </Text>
    </Box>
  )
}
