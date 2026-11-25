import type { On } from 'claude-code'

import { PANE } from './config'
import { backfill } from './history'
import { readClosed, readNodes, setClosed } from './state'

// Opening the pane at session start, the `/call-stack` command that opens it
// again, and the button above the prompt that does the same once it is closed.
export const lifecycle = (on: On) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'call-stack',
      description: 'Show the call stack of this session in a pane',
    })
    await setClosed($, false)
    void $.ui.open({ id: PANE, title: 'Agent Call Stack' })

    // Running bars grow with the clock: redraw once a second while any runs.
    $.clock.every(1000, async () => {
      if ((await readNodes($)).some(n => n.status === 'run')) $.ui.invalidate('ui.render')
    })

    const out = await next(e)
    // The chat's earlier prompts, read back from its history.
    await backfill($).catch(() => {})
    return out
  })

  on('command.run', { command: 'call-stack' }, async $ => {
    await setClosed($, false)
    await $.ui.open({ id: PANE, title: 'Agent Call Stack' })
    return { text: 'Agent Call Stack pane opened.' }
  })

  // A pane the person closed leaves a button above the prompt to open it again.
  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) await setClosed($, true)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await readClosed($))) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const running = (await readNodes($)).filter(n => n.status === 'run' && n.kind !== 'prompt')

    return (
      <Box gap={1}>
        <Button
          key="open-call-stack"
          onPress={async () => {
            await setClosed($, false)
            await $.ui.open({ id: PANE, title: 'Agent Call Stack' })
          }}
        >
          Open call stack
        </Button>
        {running.length ? <Text color="warning">● {running.length} running</Text> : null}
      </Box>
    )
  })
}
