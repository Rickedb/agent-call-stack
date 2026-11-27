import type { EngineInterface } from 'claude-code'

import { clip, modelName } from '../format'
import { toggleFolded, toggleSelected } from '../state'
import { bar } from './bar'
import { cellsOf, WIDE } from './cells'
import type { Pane, Place, Section } from './context'
import { details } from './details'
import { openId, resourcesOf } from '../resources'
import { resourceRow } from './resource'
import { tagOf } from './tags'
import { toolArg, toolName } from '../names'
import { glyph, mark, tint } from './theme'

// The room the words of a row keep, at most, before its tag is cut short; the least a tag is shown in.
const MIN_ARG = 10
const MIN_TAG = 4

// One row: the tree guides and fold arrow, a status glyph, name and argument,
// then (to the right, in columns) its output's size and its time; the bar under it in the waterfall; its details when picked.
export function row($: EngineInterface, c: Pane, s: Section, place: Place) {
  const { Box, Text, Button } = c.els
  const { node, depth, hidden, trail, isLast } = place
  if (place.res) return resourceRow($, c, s, place)
  const hasKids = (c.kids.get(node.id) ?? []).length > 0
  // The arrow folds the call's children; a call with only things it involved opens and shuts those.
  const hasRes = !hasKids && resourcesOf(node).length > 0
  const arrowId = hasRes ? openId(node.id) : node.id
  const isShut = hasRes ? !c.fold.has(arrowId) : c.fold.has(arrowId)
  const isPicked = node.id === c.pick
  const { right, out } = cellsOf(c, node)

  const lead = depth * 2 + 2
  // The tree says every status with a glyph. The waterfall's bar color already says it, so only
  // a failure gets one there, after the name.
  const isFailed = node.status === 'err'
  const icon = glyph(node)
  const markW = (c.isWaterfall ? (isFailed ? 2 : 0) : 2) + (icon ? icon.length + 1 : 0)
  const name = node.kind === 'prompt' ? `Prompt ${c.promptNo.get(node.id)}` : toolName(node)
  const own = isLast ? '└─' : '├─'
  const isSlowest = node === s.slowest && s.rowCount > 3 && c.cols >= WIDE

  // The output size and the time are badges: the text on a fill, a space each side, and one before it.
  const tokCol = s.tokW ? s.tokW + 3 : 0
  const timeCol = s.timeW + 3
  // What the label has left once the right-hand cells and the bar column are taken.
  const barCol = c.barW ? c.barW + 1 : 0
  const room =
    c.cols - lead - markW - (isSlowest ? 8 : 0) - tokCol - timeCol - barCol - 1
  const model = node.model ? modelName(node.model) : ''
  // What follows the name: the model, a tag (`interrupted`, `asked, waited 2s`) and the words of the call or the
  // prompt. The words get the room they need (all of them, up to MIN_ARG cells), so that a row can still be told
  // apart; the tag is cut short to what is left, or left off under MIN_TAG cells. The mark still says it failed,
  // and the details and the summary give the whole of the tag.
  const words = toolArg(node)
  const left = room - name.length - (model ? model.length + 1 : 0) - 1
  const found = tagOf(node)
  const tagRoom = left - Math.min(words.length, MIN_ARG) - 1
  const tag = found && tagRoom >= MIN_TAG ? { ...found, text: clip(found.text, tagRoom) } : undefined
  const arg = clip(words, left - (tag ? tag.text.length + 1 : 0))

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
            {hasKids || hasRes ? (
              <Button
                key={`fold:${arrowId}`}
                plain
                dimColor
                onPress={() => void toggleFolded($, arrowId)}
              >
                {`${isShut ? '▸' : '▾'} `}
              </Button>
            ) : (
              <Text> </Text>
            )}
          </Box>
          <Box flexGrow={1} flexShrink={1} overflow="hidden">
            <Button key={`open:${node.id}`} plain onPress={() => void toggleSelected($, node.id)}>
              {c.isWaterfall ? null : <Text color={tint(node)}>{mark(node)} </Text>}
              {icon ? <Text dimColor>{`${icon} `}</Text> : null}
              <Text bold={isPicked || (node.kind !== 'tool' && node.kind !== 'event' && node.kind !== 'note')} wrap="truncate-end">
                {name}
              </Text>
              {c.isWaterfall && isFailed ? <Text color="error">{` ${mark(node)}`}</Text> : null}
              {model ? <Text color="permission">{` ${model}`}</Text> : null}
              {tag ? <Text color={tag.color}>{` ${tag.text}`}</Text> : null}
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
              {out ? <Text backgroundColor="subtle">{` ${out} `}</Text> : null}
            </Box>
          ) : null}
          <Box width={timeCol} justifyContent="flex-end">
            <Text backgroundColor="subtle">{` ${right} `}</Text>
          </Box>
          {c.barW ? bar(c, node, s.t0, s.t1) : null}
        </Box>
      </Box>
      {isPicked ? details($, c, node, s.t0, s.t1) : null}
    </Box>
  )
}
