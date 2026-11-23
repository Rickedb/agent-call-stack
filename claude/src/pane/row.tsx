import type { EngineInterface } from 'claude-code'

import type { Node } from '../../types'
import { clip, dur, sizeOf, tokText } from '../format'
import { toggleFolded, toggleSelected } from '../state'
import { bar } from './bar'
import type { Pane, Section } from './context'
import { details } from './details'
import { icon, mark, tint } from './theme'

// One row: fold arrow, kind, status, name and argument, then its output's
// size and its time; the bar under it in the waterfall; its details when picked.
export function row(
  $: EngineInterface,
  c: Pane,
  s: Section,
  { node, depth, hidden }: { node: Node; depth: number; hidden: number },
) {
  const { Box, Text, Button } = c.els
  const hasKids = (c.kids.get(node.id) ?? []).length > 0
  const ms = c.span(node)
  const right = node.hist
    ? node.ms !== undefined
      ? dur(ms)
      : '—'
    : c.isWaterfall
      ? `+${dur(node.start - s.t0)}  ${dur(ms)}`
      : dur(ms)
  const lead = depth * 2 + 2
  const name = node.kind === 'prompt' ? `Prompt ${c.promptNo.get(node.id)}` : node.name
  // The output's size beside the time; nothing until there is an output.
  const out = sizeOf(node, 'output') > 0 ? tokText(node, 'output') : ''
  const room = c.cols - lead - right.length - (out ? out.length + 2 : 0) - 7 // kind icon + status mark
  const arg = clip(node.arg, room - name.length - 1)
  return (
    <Box flexDirection="column">
      <Box key={`row:${node.id}`} flexDirection="column" hover={{ backgroundColor: 'subtle' }}>
        <Box>
          <Box width={lead} flexShrink={0}>
            {hasKids ? (
              <Button
                key={`fold:${node.id}`}
                plain
                dimColor
                onPress={() => void toggleFolded($, node.id)}
              >
                {`${' '.repeat(depth * 2)}${c.fold.has(node.id) ? '▸' : '▾'} `}
              </Button>
            ) : (
              <Text> </Text>
            )}
          </Box>
          <Box flexGrow={1}>
            <Button
              key={`open:${node.id}`}
              plain
              onPress={() => void toggleSelected($, node.id)}
            >
              <Text>{icon(node)} </Text>
              <Text color={tint(node)}>{mark(node)} </Text>
              <Text bold={node.id === c.pick || node.kind !== 'tool'}>{name}</Text>
              {arg ? <Text dimColor> {arg}</Text> : null}
              {hidden ? <Text dimColor> +{hidden}</Text> : null}
            </Button>
          </Box>
          {node === s.slowest && s.rowCount > 3 ? <Text color="warning">slowest </Text> : null}
          {out ? <Text dimColor>{`${out}  `}</Text> : null}
          <Text dimColor>{right}</Text>
        </Box>
        {c.isWaterfall ? bar(c, node, s.t0, s.t1) : null}
      </Box>
      {node.id === c.pick ? details($, c, node, s.t0, s.t1) : null}
    </Box>
  )
}
