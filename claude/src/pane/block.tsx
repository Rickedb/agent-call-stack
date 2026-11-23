import type { EngineInterface } from 'claude-code'

import type { Node } from '../../types'
import { LINES } from '../config'
import { toggleShown } from '../state'
import type { Pane } from './context'

// One text of a call, drawn whole and wrapped; the first lines until
// "Show all". A cut text says so, and where the whole is.
export function block($: EngineInterface, c: Pane, n: Node, which: 'input' | 'output') {
  const { Box, Text, Button } = c.els
  const text = which === 'input' ? n.input : n.output
  if (!text) return null
  const len = (which === 'input' ? n.inputLen : n.outputLen) ?? text.length
  const file = which === 'input' ? n.inputFile : n.outputFile
  const key = `${n.id}:${which}`
  // A compaction's input is what it was told to keep, its output the summary it left.
  const label =
    n.kind === 'event' && n.name === 'Compact'
      ? which === 'input'
        ? 'INSTRUCTIONS'
        : 'SUMMARY'
      : which === 'input'
        ? 'INPUT'
        : 'OUTPUT'
  const split = text.split('\n')
  const isOpen = c.whole.has(key)
  const visible = isOpen ? split : split.slice(0, LINES)
  const isCut = len > text.length
  return (
    <Box flexDirection="column">
      <Text dimColor>
        {label}
        {isCut ? ` · first ${text.length.toLocaleString()} of ${len.toLocaleString()} characters` : ''}
      </Text>
      <Box backgroundColor="subtle" paddingX={1}>
        <Box flexGrow={1} flexShrink={1}>
          <Text mono>{visible.join('\n')}</Text>
        </Box>
        {/* The copy icon sits in the box's top-right corner, as on a code block of a markdown preview. */}
        <Box flexShrink={0} paddingLeft={1}>
          <Button
            key={`copy:${key}`}
            plain
            dimColor
            onPress={async p => {
              // The whole text: from its file when the state kept only a cut.
              const full = file ? await $.fs.read(file).catch(() => text) : text
              void $.ui.copy({ text: full, surface: p.surface })
            }}
          >
            ⧉
          </Button>
        </Box>
      </Box>
      <Box gap={2}>
        {split.length > LINES ? (
          <Button
            key={`more:${key}`}
            plain
            onPress={() => void toggleShown($, key)}
          >
            {isOpen ? 'Show less' : `Show all ${split.length} lines`}
          </Button>
        ) : null}
        {file ? (
          <Button
            key={`path:${key}`}
            plain
            onPress={p => void $.ui.copy({ text: file, surface: p.surface })}
          >
            Copy file path
          </Button>
        ) : null}
      </Box>
      {isCut ? (
        <Text dimColor>{file ? `Whole text: ${file}` : 'The rest could not be saved.'}</Text>
      ) : null}
    </Box>
  )
}
