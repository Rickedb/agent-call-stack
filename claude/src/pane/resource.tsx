import type { EngineInterface } from 'claude-code'

import type { Node } from '../../types'
import { dur } from '../format'
import { toolName } from '../names'
import { callsOn } from '../resources'
import { clearSelected, toggleSelected } from '../state'
import type { Pane, Place, Section } from './context'
import { sequence } from './sequence'
import { tagOf } from './tags'

// A glyph for each kind of thing a call involved.
const GLYPH = { file: '◦', link: '↗', command: '$', query: '?', more: ' ' } as const

// Lines added and taken out, as text on a color: nothing when neither.
const lines = (c: Pane, added: number, removed: number) => {
  const { Text } = c.els
  return added || removed
    ? [
        <Text key="add" color="success">{` +${added}`}</Text>,
        <Text key="del" color="error">{` −${removed}`}</Text>,
      ]
    : null
}

// One row under a call: a file it involved (the name only), an address it fetched, a command it ran,
// what it searched for. A click opens its details under the row. No time and no bar of its own.
export function resourceRow($: EngineInterface, c: Pane, s: Section, place: Place) {
  const { Box, Text, Button } = c.els
  const { depth, trail, isLast } = place
  const r = place.res!
  const isPicked = r.id === c.pick
  const lead = depth * 2 + 2
  return (
    <Box flexDirection="column">
      <Box key={`row:${r.id}`} flexDirection="column" hover={{ backgroundColor: 'subtle' }}>
        <Box backgroundColor={isPicked ? 'subtle' : undefined}>
          <Box width={lead} flexShrink={0}>
            {trail.map(l => (
              <Text mono wrap="truncate" dimColor>
                {l.last ? '  ' : '│ '}
              </Text>
            ))}
            <Text mono wrap="truncate" dimColor>
              {isLast ? '└─' : '├─'}
            </Text>
            <Text> </Text>
          </Box>
          <Box flexGrow={1} flexShrink={1} overflow="hidden">
            {r.kind === 'more' ? (
              <Text dimColor>{r.label}</Text>
            ) : (
              <Button key={`open:${r.id}`} plain onPress={() => void toggleSelected($, r.id)}>
                <Text dimColor>{`${GLYPH[r.kind]} `}</Text>
                <Text mono={r.kind === 'command'} bold={isPicked} wrap="truncate-end">
                  {r.label}
                </Text>
                <Text dimColor>{` ${r.op}`}</Text>
                {lines(c, r.added, r.removed)}
              </Button>
            )}
          </Box>
        </Box>
      </Box>
      {isPicked ? resourceDetails($, c, s, place) : null}
    </Box>
  )
}

const KIND = { file: 'file', link: 'address', command: 'command', query: 'search', more: '' } as const

// What opens under a resource row: the whole path, address or command, what the call did with it, and
// every call of the prompt that involved the same one (each a button that opens that call's details).
function resourceDetails($: EngineInterface, c: Pane, s: Section, place: Place) {
  const { Box, Text, Button } = c.els
  const r = place.res!
  const call: Node = place.node
  const same = callsOn(c.below(s.top), r)
  const added = same.reduce((n, x) => n + x.added, 0)
  const removed = same.reduce((n, x) => n + x.removed, 0)
  const tag = tagOf(call)
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={1} marginLeft={c.gutter} marginY={1} gap={1}>
      <Box flexDirection="column">
        <Text>
          <Text bold>{`${GLYPH[r.kind]} ${KIND[r.kind]}`}</Text>
          <Text dimColor>{` · ${r.op} by ${toolName(call)} ${dur(c.span(call))}${tag ? ` · ${tag.text}` : ''}`}</Text>
        </Text>
        <Text mono={r.kind === 'command'}>{r.full}</Text>
        {r.added || r.removed ? (
          <Text>
            <Text dimColor>this call </Text>
            {lines(c, r.added, r.removed)}
          </Text>
        ) : null}
      </Box>
      {r.kind === 'command' ? sequence(c, call) : null}
      {same.length > 1 || added || removed ? (
        <Box flexDirection="column">
          <Text dimColor>
            {`${same.length} ${same.length === 1 ? 'call' : 'calls'} in this prompt${added || removed ? ' · in all' : ''}`}
            {lines(c, added, removed)}
          </Text>
          <Box gap={1} overflow="hidden">
            {same.map(x => (
              <Button key={`call:${r.id}:${x.node.id}`} plain onPress={() => void toggleSelected($, x.node.id)}>
                <Text color={x.node.status === 'err' ? 'error' : undefined} bold={x.node.id === call.id}>
                  {`${toolName(x.node)} ${dur(c.span(x.node))}${x.node.status === 'err' ? ' ✗' : ''}`}
                </Text>
                {x.node.status === 'ok' ? lines(c, x.added, x.removed) : null}
              </Button>
            ))}
          </Box>
        </Box>
      ) : null}
      <Box gap={2}>
        <Button key={`call:${call.id}`} plain onPress={() => void toggleSelected($, call.id)}>
          Open the call
        </Button>
        <Button key="close" role="dismiss" onPress={() => void clearSelected($)}>
          Close
        </Button>
      </Box>
    </Box>
  )
}
