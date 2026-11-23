import type { EngineInterface } from 'claude-code'

import type { Node } from '../../types'
import { clip, dur, tokText } from '../format'
import { clearSelected } from '../state'
import { block } from './block'
import type { Pane } from './context'
import { mark, PARALLEL, tint } from './theme'

// What opens under a row: its state, timing, sizes, and its input and output.
export function details($: EngineInterface, c: Pane, n: Node, t0: number, t1: number) {
  const { Box, Text, Button } = c.els
  // Who a call ran at the same time as.
  const others = (c.together.get(n.id)?.members ?? []).filter(m => m.id !== n.id)
  const together = others.length
    ? `∥ ran at the same time as ${others.length} other${others.length === 1 ? '' : 's'}: ${others
        .slice(0, 5)
        .map(m => m.name + (m.arg ? ` ${clip(m.arg, 30)}` : ''))
        .join(', ')}${others.length > 5 ? ', …' : ''}`
    : ''
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={tint(n)}
      paddingX={1}
      marginLeft={c.gutter}
      marginY={1}
      gap={1}
    >
      <Box flexDirection="column">
        <Text>
          <Text color={tint(n)} bold>
            {mark(n)} {n.status === 'run' ? 'Running' : n.status === 'ok' ? 'Done' : 'Failed'}
          </Text>
          <Text dimColor> · {n.kind}</Text>
        </Text>
        {n.hist ? (
          <Text dimColor>
            From earlier in the chat{n.ms !== undefined ? ` · took ${dur(n.ms)}` : ' · timing was not recorded'}
          </Text>
        ) : (
          <Text dimColor>
            started +{dur(n.start - t0)} · took {dur(c.span(n))} ·{' '}
            {Math.min(100, Math.round((c.span(n) / t1) * 100))}% of prompt
          </Text>
        )}
        <Text dimColor>{`input ${tokText(n, 'input')} · output ${tokText(n, 'output')}`}</Text>
        {together ? <Text color={PARALLEL}>{together}</Text> : null}
      </Box>
      {block($, c, n, 'input')}
      {block($, c, n, 'output')}
      <Button key="close" role="dismiss" onPress={() => void clearSelected($)}>
        Close
      </Button>
    </Box>
  )
}
