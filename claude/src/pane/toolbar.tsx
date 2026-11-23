import type { EngineInterface } from 'claude-code'

import { setFolded, setMode } from '../state'
import type { Pane } from './context'

// The buttons above the rows: Tree or Waterfall, and fold all.
export function toolbar($: EngineInterface, c: Pane) {
  const { Box, Button } = c.els
  const foldable = c.list.filter(n => (c.kids.get(n.id) ?? []).length > 0).map(n => n.id)
  const isAllFolded = foldable.length > 0 && foldable.every(id => c.fold.has(id))
  return (
    <Box justifyContent="space-between">
      <Box gap={1}>
        <Button
          key="view-tree"
          variant={c.isWaterfall ? 'secondary' : 'primary'}
          onPress={() => void setMode($, 'tree')}
        >
          Tree
        </Button>
        <Button
          key="view-waterfall"
          variant={c.isWaterfall ? 'primary' : 'secondary'}
          onPress={() => void setMode($, 'waterfall')}
        >
          Waterfall
        </Button>
      </Box>
      {foldable.length ? (
        <Button
          key="fold-all"
          plain
          dimColor
          onPress={() => void setFolded($, isAllFolded ? [] : foldable)}
        >
          {isAllFolded ? 'unfold all' : 'fold all'}
        </Button>
      ) : null}
    </Box>
  )
}

// How many prompts, and how many calls run, are done or failed.
export const summary = (c: Pane) => {
  const { Box, Text } = c.els
  const everyCall = c.prompts.flatMap(p => c.below(p))
  const total = {
    ok: everyCall.filter(n => n.status === 'ok').length,
    err: everyCall.filter(n => n.status === 'err').length,
    run: everyCall.filter(n => n.status === 'run').length,
  }
  return (
    <Box gap={2}>
      <Text dimColor>
        {c.prompts.length} {c.prompts.length === 1 ? 'prompt' : 'prompts'}
      </Text>
      {total.run ? <Text color="warning">● {total.run} running</Text> : null}
      <Text color="success">✓ {total.ok}</Text>
      {total.err ? <Text color="error">✗ {total.err} failed</Text> : null}
    </Box>
  )
}
