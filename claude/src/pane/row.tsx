import type { EngineInterface } from 'claude-code'

import { clip } from '../format'
import { toggleFolded, toggleSelected } from '../state'
import { bar } from './bar'
import { cellsOf, WIDE } from './cells'
import type { Pane, Place, Section } from './context'
import { details } from './details'
import { mark, tint } from './theme'

// One row: the tree guides and fold arrow, a status glyph, name and argument,
// then (to the right, in columns) its output's size and its time; the bar under it in the waterfall; its details when picked.
export function row($: EngineInterface, c: Pane, s: Section, place: Place) {
  const { Box, Text, Button } = c.els
  const { node, depth, hidden, trail, isLast } = place
  const hasKids = (c.kids.get(node.id) ?? []).length > 0
  const isPicked = node.id === c.pick
  const { right, out } = cellsOf(c, node, s.t0)

  const lead = depth * 2 + 2
  const name = node.kind === 'prompt' ? `Prompt ${c.promptNo.get(node.id)}` : node.name
  const own = isLast ? '└─' : '├─'
  const isSlowest = node === s.slowest && s.rowCount > 3 && c.cols >= WIDE

  const tokCol = s.tokW ? s.tokW + 2 : 0
  // What the label has left once the right-hand cells and the bar column are taken.
  const barCol = c.barW ? c.barW + 1 : 0
  const room =
    c.cols - lead - 2 - (isSlowest ? 8 : 0) - tokCol - (s.timeW + 1) - barCol - 1
  const arg = clip(node.arg, room - name.length - 1)

  return (
    <Box flexDirection="column">
      <Box key={`row:${node.id}`} flexDirection="column" hover={{ backgroundColor: 'subtle' }}>
        <Box backgroundColor={isPicked ? 'subtle' : undefined}>
          <Box width={lead} flexShrink={0}>
            {trail.map(l => (
              <Text mono wrap="truncate" dimColor>
                {l.last ? '  ' : '│ '}
              </Text>
            ))}
            {depth > 0 ? (
              <Text mono wrap="truncate" dimColor>
                {own}
              </Text>
            ) : null}
            {hasKids ? (
              <Button
                key={`fold:${node.id}`}
                plain
                dimColor
                onPress={() => void toggleFolded($, node.id)}
              >
                {`${c.fold.has(node.id) ? '▸' : '▾'} `}
              </Button>
            ) : (
              <Text> </Text>
            )}
          </Box>
          <Box flexGrow={1} flexShrink={1} overflow="hidden">
            <Button key={`open:${node.id}`} plain onPress={() => void toggleSelected($, node.id)}>
              <Text color={tint(node)}>{mark(node)} </Text>
              <Text bold={isPicked || node.kind !== 'tool'} wrap="truncate-end">
                {name}
              </Text>
              {arg ? (
                <Text dimColor wrap="truncate-end">
                  {` ${arg}`}
                </Text>
              ) : null}
              {hidden ? <Text dimColor> +{hidden}</Text> : null}
            </Button>
          </Box>
          {isSlowest ? <Text color="warning">slowest </Text> : null}
          {tokCol ? (
            <Box width={tokCol} justifyContent="flex-end">
              <Text dimColor>{out ? `${out}  ` : ''}</Text>
            </Box>
          ) : null}
          <Box width={s.timeW + 1} justifyContent="flex-end">
            <Text dimColor>{right}</Text>
          </Box>
          {c.barW ? bar(c, node, s.t0, s.t1) : null}
        </Box>
      </Box>
      {isPicked ? details($, c, node, s.t0, s.t1) : null}
    </Box>
  )
}
