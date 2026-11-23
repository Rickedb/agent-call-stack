import type { On } from 'claude-code'

import { clip, describe, summarize } from './format'
import { guard, keep, patch, upsert } from './nodes'
import { readRoot, setRoot, updateNodes } from './state'

// What is seen of the work, as it happens: a prompt, a subagent, a tool call
// and its result, each a row in the state.
export const recording = (on: On) => {
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      await guard($, 'prompt', async () => {
        const text = await keep($, e.turnId, 'input', e.text)
        await setRoot($, e.turnId)
        await updateNodes($, list =>
          upsert(list, {
            id: e.turnId,
            kind: 'prompt',
            name: 'Prompt',
            arg: clip(e.text || '(continued turn)', 160),
            status: 'run',
            start: Date.now(),
            ...text,
          }),
        )
      })
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await guard($, 'turn end', async () => {
      const id = e.agentId === undefined ? e.turnId : `a:${e.agentId}`
      const status = e.reason === 'answer' ? 'ok' : 'err'
      const text = await keep($, id, 'output', e.answer || `(${e.reason})`)
      await updateNodes($, list => patch(list, id, { status, end: Date.now(), ...text }))
    })
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const out = await next(e)
    if ('agentId' in out && out.agentId) {
      await guard($, 'subagent', async () => {
        const id = `a:${out.agentId}`
        const parent = e.parentAgentId ? `a:${e.parentAgentId}` : await readRoot($)
        const text = await keep($, id, 'input', e.prompt)
        await updateNodes($, list =>
          upsert(list, {
            id,
            parent: parent || undefined,
            kind: 'agent',
            name: e.subagentType,
            arg: clip(e.description, 160),
            status: 'run',
            start: Date.now(),
            ...text,
          }),
        )
      })
    }
    return out
  })

  on('tool.call', async ($, e, next) => {
    // The Agent call is drawn as the subagent it starts.
    if (e.tool === 'Agent') return next(e)

    const id = e.tool_use_id
    await guard($, 'tool call', async () => {
      const rootId = await readRoot($)
      const parent = e.agentId ? `a:${e.agentId}` : rootId
      const args = e as unknown as Record<string, unknown>
      const given = await keep($, id, 'input', describe(args))
      await updateNodes($, list => {
        // A subagent's call may arrive before its spawn settles.
        const withAgent =
          e.agentId && !list.some(n => n.id === `a:${e.agentId}`)
            ? upsert(list, {
                id: `a:${e.agentId}`,
                parent: rootId || undefined,
                kind: 'agent',
                name: 'subagent',
                arg: '',
                status: 'run',
                start: Date.now(),
              })
            : list
        return upsert(withAgent, {
          id,
          parent: parent || undefined,
          kind: 'tool',
          name: e.tool,
          arg: summarize(args),
          status: 'run',
          start: Date.now(),
          ...given,
        })
      })
    })
    const ran = await next(e)
    await guard($, 'tool result', async () => {
      const isDenied = 'deny' in ran && ran.deny !== undefined
      const failed = isDenied || ('isError' in ran && ran.isError === true)
      const text = isDenied ? `denied: ${ran.deny}` : 'text' in ran && ran.text ? ran.text : ''
      const got = await keep($, id, 'output', text)
      await updateNodes($, list =>
        patch(list, id, { status: failed ? 'err' : 'ok', end: Date.now(), ...got }),
      )
    })
    return ran
  })
}
