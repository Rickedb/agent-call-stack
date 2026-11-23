import type { EngineInterface, On } from 'claude-code'

import { clip, describe, failureWord, fmtTokens, summarize } from './format'
import { touchOf } from './touch'
import { addUsage, guard, keep, patch, patchPerm, settle, upsert } from './nodes'
import { foldIds, readNodes, readRoot, setRoot, updateNodes } from './state'

// Says which model a row ran on; nothing is written when it is already said, since
// every model response of a turn asks.
async function noteModel($: EngineInterface, id: string, model: string | undefined) {
  if (!model) return
  const row = (await readNodes($)).find(n => n.id === id)
  if (!row || row.model === model) return
  await updateNodes($, list => patch(list, id, { model }))
}

// A response the model stopped in a way that is a problem, in the words a person says it.
const STOPS: Record<string, string> = {
  max_tokens: 'the reply hit the output limit',
  model_context_window_exceeded: 'the context window is full',
}

// Puts an error row under the prompt (or the subagent) whose model request stopped badly.
async function noteStop(
  $: EngineInterface,
  at: { turnId: string; index: number; agentId?: string },
  stop: string | null,
) {
  const what = stop ? STOPS[stop] : undefined
  if (!what) return
  const now = Date.now()
  await updateNodes($, list =>
    upsert(list, {
      id: `${at.turnId}:stop:${at.index}`,
      parent: at.agentId ? `a:${at.agentId}` : at.turnId,
      kind: 'event',
      name: 'Error',
      arg: what,
      status: 'err',
      start: now,
      end: now,
      why: what,
    }),
  )
}

// How long the tool itself ran, which leaves out the person's answer and the hooks. Only a call that
// was asked needs it (to tell its wait from its run), so nothing is written for the rest.
async function ranFor($: EngineInterface, id: string, ms: number | undefined) {
  if (ms === undefined) return
  const was = (await readNodes($)).find(n => n.id === id)
  if (was?.perm?.decision !== 'ask') return
  await updateNodes($, list => patchPerm(list, id, { ran: ms }))
}

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
        // A new prompt folds the ones before it; the person can open any again.
        const before = (await readNodes($)).filter(n => n.kind === 'prompt' && n.id !== e.turnId)
        await foldIds(
          $,
          before.map(n => n.id),
        )
      })
    }
    return next(e)
  })

  // The model of each response of the prompt's turn; a subagent's is known at its spawn.
  on('turn.step', async function* ($, e, next) {
    await guard($, 'model', () => noteModel($, e.turnId, e.model))
    const step = yield* next(e)
    await guard($, 'stop', () => noteStop($, e, step.stopReason))
    return step
  })

  on('turn.complete', async ($, e, next) => {
    const id = e.agentId === undefined ? e.turnId : `a:${e.agentId}`
    await guard($, 'turn end', async () => {
      const status = e.reason === 'answer' ? 'ok' : 'err'
      const text = await keep($, id, 'output', e.answer || `(${e.reason})`)
      const used = e.usage
      // Why it did not end in an answer; an API error may have said more already (`classic.StopFailure`).
      const refusal = e.reason === 'refusal' ? e.refusal : undefined
      await updateNodes($, list => {
        const was = list.find(n => n.id === id)
        const why =
          e.reason === 'aborted'
            ? 'interrupted'
            : e.reason === 'refusal'
              ? `refused${refusal?.category ? ` (${refusal.category})` : ''}${refusal?.explanation ? `: ${clip(refusal.explanation, 160)}` : ''}`
              : e.reason === 'error'
                ? (was?.why ?? 'API error')
                : undefined
        return patch(list, id, {
          status,
          end: Date.now(),
          ...text,
          ...(why ? { why } : {}),
          ...(used ? { usage: addUsage(was?.usage, used) } : {}),
        })
      })
    })
    const out = await next(e)
    // What answered, as the API reports it: the last response's, which a fallback may have changed.
    await guard($, 'model', () => noteModel($, id, out.usage?.model))
    return out
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
            model: out.model,
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
      const touch = touchOf(e.tool, args)
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
          ...(touch ? { touch } : {}),
        })
      })
    })
    const ran = await next(e)
    await guard($, 'tool result', async () => {
      const isDenied = 'deny' in ran && ran.deny !== undefined
      const failed = isDenied || ('isError' in ran && ran.isError === true)
      const text = isDenied ? `denied: ${ran.deny}` : 'text' in ran && ran.text ? ran.text : ''
      const got = await keep($, id, 'output', text)
      await updateNodes($, list => {
        const was = list.find(n => n.id === id)
        const end = Date.now()
        return patch(list, id, { status: failed ? 'err' : 'ok', end, ...got, ...settle(was, failed, end) })
      })
    })
    return ran
  })

  // The engine's verdict on letting the call run. It comes after the call's row is drawn and before the
  // person is asked, so the row learns here that it will wait.
  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    const id = e.tool_use_id
    if (id) {
      await guard($, 'permission', () =>
        updateNodes($, list =>
          patchPerm(list, id, {
            decision: verdict.decision,
            reason: verdict.reason,
            rule: verdict.rule,
            by: verdict.plugin ?? verdict.hook ?? verdict.setting,
          }),
        ),
      )
    }
    return verdict
  })

  on('classic.PostToolUse', async ($, e, next) => {
    await guard($, 'permission', () => ranFor($, e.tool_use_id, e.duration_ms))
    return next(e)
  })
  on('classic.PostToolUseFailure', async ($, e, next) => {
    await guard($, 'permission', () => ranFor($, e.tool_use_id, e.duration_ms))
    return next(e)
  })

  // An ask the person did not answer yes to, or that a classifier refused, with its reason.
  on('classic.PermissionDenied', async ($, e, next) => {
    await guard($, 'permission', () =>
      updateNodes($, list => patchPerm(list, e.tool_use_id, { refused: true, reason: e.reason })),
    )
    return next(e)
  })

  // Where the transcript is kept: the session's, known when a turn ends; a subagent's own, when it stops.
  on('classic.Stop', async ($, e, next) => {
    await guard($, 'transcript', async () => {
      const id = await readRoot($)
      if (id && e.transcript_path) await updateNodes($, list => patch(list, id, { transcript: e.transcript_path }))
    })
    return next(e)
  })
  on('classic.SubagentStop', async ($, e, next) => {
    await guard($, 'transcript', async () => {
      const path = e.agent_transcript_path
      if (path) await updateNodes($, list => patch(list, `a:${e.agent_id}`, { transcript: path }))
    })
    return next(e)
  })

  // Why the turn failed, from the API: rate limit, overloaded, billing, and so on.
  on('classic.StopFailure', async ($, e, next) => {
    await guard($, 'error', async () => {
      const id = e.agent_id ? `a:${e.agent_id}` : await readRoot($)
      const why = `${failureWord(e.error)}${e.error_details ? `: ${clip(e.error_details, 160)}` : ''}`
      await updateNodes($, list => patch(list, id, { why }))
    })
    return next(e)
  })

  // A compaction is a row under the prompt it happened in: when it began and ended, what it was told
  // to keep, how much it saved, and the summary it left.
  on('session.compact', async ($, e, next) => {
    // A precompute installs nothing: it is a computation ahead of time, not a compaction.
    if (e.trigger === 'precompute') return next(e)
    const start = Date.now()
    const id = `c:${start}`
    await guard($, 'compaction', async () => {
      const parent = e.agentId ? `a:${e.agentId}` : await readRoot($)
      if (!parent) return
      const text = e.instructions ? await keep($, id, 'input', e.instructions) : {}
      await updateNodes($, list =>
        upsert(list, {
          id,
          parent,
          kind: 'event',
          name: 'Compact',
          arg: e.trigger,
          status: 'run',
          start,
          ...text,
          compact: { trigger: e.trigger, messagesBefore: e.messages.length },
        }),
      )
    })
    try {
      const out = await next(e)
      await guard($, 'compaction', () =>
        updateNodes($, list => {
          const was = list.find(n => n.id === id)
          const compact = { ...was?.compact, trigger: e.trigger }
          if (out.skip !== undefined) {
            return patch(list, id, {
              status: 'ok',
              end: Date.now(),
              arg: `${e.trigger} · skipped: ${clip(out.skip, 100)}`,
              compact: { ...compact, skipped: out.skip },
            })
          }
          const saved =
            out.tokensBefore !== undefined && out.tokensAfter !== undefined
              ? ` · ${fmtTokens(out.tokensBefore)} → ${fmtTokens(out.tokensAfter)} tok`
              : ''
          return patch(list, id, {
            status: 'ok',
            end: Date.now(),
            arg: `${e.trigger}${saved}`,
            compact: {
              ...compact,
              before: out.tokensBefore,
              after: out.tokensAfter,
              messagesAfter: out.messages.length,
              ...(out.usage ? { usage: addUsage(undefined, out.usage) } : {}),
            },
          })
        }),
      )
      return out
    } catch (err) {
      await guard($, 'compaction', () =>
        updateNodes($, list =>
          patch(list, id, {
            status: 'err',
            end: Date.now(),
            why: err instanceof Error ? err.message : String(err),
          }),
        ),
      )
      throw err
    }
  })

  // The summary the compaction left, as the conversation continues from it.
  on('classic.PostCompact', async ($, e, next) => {
    await guard($, 'compaction', async () => {
      const row = [...(await readNodes($))].reverse().find(n => n.kind === 'event' && n.name === 'Compact' && !n.output)
      if (!row) return
      const text = await keep($, row.id, 'output', e.compact_summary)
      await updateNodes($, list => patch(list, row.id, text))
    })
    return next(e)
  })
}
