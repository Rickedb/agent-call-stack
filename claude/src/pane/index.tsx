import type { On } from 'claude-code'

import type { Node } from '../../types'
import { PANE } from '../config'
import { readFolded, readMode, readNodes, readSelected, readShown } from '../state'
import type { Pane as Draw } from './context'
import { parallelGroups } from './parallel'
import { section } from './section'
import { summary, toolbar } from './toolbar'
import { widget } from './widget'

// The pane itself: reads the state once, then draws the toolbar, the counts
// and a section per prompt, or the small widget where the surface wants one.
export const pane = (on: On) => {
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text } = els
    try {
      const list = await readNodes($)
      const cols = Math.max(24, e.props.bodyColumns)
      const now = Date.now()

      const prompts = list.filter(n => n.kind === 'prompt')
      if (prompts.length === 0) {
        return (
          <Box flexDirection="column" gap={1} paddingY={1}>
            <Text bold>No calls yet</Text>
            <Text dimColor>Send a prompt and what Claude does shows up here, as a tree.</Text>
          </Box>
        )
      }

      const ids = new Set(list.map(n => n.id))
      const kids = new Map<string, Node[]>()
      for (const n of list) {
        if (n.parent && ids.has(n.parent)) kids.set(n.parent, [...(kids.get(n.parent) ?? []), n])
      }
      const below = (n: Node): Node[] => (kids.get(n.id) ?? []).flatMap(c => [c, ...below(c)])

      // Calls under one parent that ran at the same time.
      const together: Draw['together'] = new Map()
      for (const sibs of kids.values()) for (const [id, g] of parallelGroups(sibs, now)) together.set(id, g)

      const gutter = 2
      const isWaterfall = (await readMode($)) === 'waterfall'
      const c: Draw = {
        els,
        list,
        prompts,
        pick: await readSelected($),
        isWaterfall,
        fold: new Set(await readFolded($)),
        whole: new Set(await readShown($)),
        cols,
        now,
        kids,
        below,
        together,
        span: n => (n.hist ? (n.ms ?? 0) : (n.end ?? now) - n.start),
        gutter,
        // The bar column: a quarter of the width, 8 to 32 cells. None in the tree. A narrow
        // pane keeps it (the bar is the waterfall) and gives up other cells instead.
        barW: isWaterfall ? Math.min(32, Math.max(8, Math.floor(cols / 4))) : 0,
        promptNo: new Map(prompts.map((n, i) => [n.id, i + 1])),
      }

      if (e.props.placement === 'widget') return widget(c)

      return (
        <Box flexDirection="column" gap={1}>
          {toolbar($, c)}
          {summary(c)}
          {[...prompts].reverse().map((top, i) => (
            <Box flexDirection="column" gap={1}>
              {i > 0 ? (
                <Text dimColor wrap="truncate">
                  {'─'.repeat(cols)}
                </Text>
              ) : null}
              {section($, c, top)}
            </Box>
          ))}
        </Box>
      )
    } catch (err) {
      // Say what went wrong where the tree would be, instead of an empty pane.
      return (
        <Box flexDirection="column" gap={1}>
          <Text color="error" bold>
            The call tree could not be drawn
          </Text>
          <Text dimColor>{err instanceof Error ? err.message : String(err)}</Text>
        </Box>
      )
    }
  })
}
