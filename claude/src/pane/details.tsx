import type { EngineInterface } from 'claude-code'

import type { Node } from '../../types'
import { dur, modelName, tokExact, tokText } from '../format'
import { modelOf } from '../stats'
import { clearSelected } from '../state'
import { block } from './block'
import type { Pane } from './context'
import { sequence } from './sequence'
import { compactLine, permLine } from './tags'
import { mark, tint } from './theme'

// What opens under a row: its state, timing, sizes, and its input and output.
export function details($: EngineInterface, c: Pane, n: Node, t0: number, t1: number) {
  const { Box, Text, Button } = c.els
  const model = modelOf(c.list, n)
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
        <Text dimColor>
          {n.kind === 'note'
            ? `${n.name === 'Thinking' ? "the model's thinking" : 'what the model wrote'} between calls · ${tokText(n, 'output')}`
            : `input ${tokText(n, 'input')} · output ${tokText(n, 'output')}`}
        </Text>
        {n.usage ? (
          <Text dimColor>
            {`reported in ${tokExact(n.usage.input + n.usage.cacheRead + n.usage.cacheWrite)} (${tokExact(n.usage.cacheRead)} cached) · out ${tokExact(n.usage.output)} ${n.kind === 'prompt' ? '· subagents not included' : ''}`.trim()}
          </Text>
        ) : null}
        {model && n.kind !== 'event' ? <Text dimColor>{`${n.model ? 'model' : 'called by'} ${modelName(model)}`}</Text> : null}
        {n.why ? <Text color="error">{`why: ${n.why}`}</Text> : null}
        {n.perm ? <Text dimColor>{permLine(n.perm)}</Text> : null}
        {n.compact ? <Text dimColor>{compactLine(n.compact)}</Text> : null}
      </Box>
      {n.transcript ? (
        <Box gap={1}>
          <Box flexShrink={1} overflow="hidden">
            <Text dimColor wrap="truncate-start">{`transcript ${n.transcript}`}</Text>
          </Box>
          <Button
            key={`copy-transcript:${n.id}`}
            plain
            onPress={p => void $.ui.copy({ text: n.transcript ?? '', surface: p.surface })}
          >
            Copy transcript path
          </Button>
        </Box>
      ) : null}
      {sequence(c, n)}
      {block($, c, n, 'input')}
      {block($, c, n, 'output')}
      <Button key="close" role="dismiss" onPress={() => void clearSelected($)}>
        Close
      </Button>
    </Box>
  )
}
