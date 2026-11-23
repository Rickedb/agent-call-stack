import type { EngineInterface, SessionMessage } from 'claude-code'

import type { Node } from '../types'
import { HIST_KEEP, MAX_NODES } from './config'
import { clip, describe, summarize, userText } from './format'
import { keep } from './nodes'
import { foldIds, markFilled, readFilled, readNodes, updateNodes } from './state'

// Reads the chat's history once into the nodes: every prompt before the first
// one this mod saw live, with its tool calls and subagents. History has no
// start or end times, so those rows draw without bars; an agent's duration is
// the one time the transcript keeps.
export async function backfill($: EngineInterface) {
  if (await readFilled($)) return
  const msgs = await $.session.messages()
  await markFilled($)

  const existing = await readNodes($)
  const firstLive = existing.find(n => n.kind === 'prompt' && !n.hist)
  let end = msgs.length
  if (firstLive?.input) {
    // History stops where the first prompt seen live begins.
    const probe = firstLive.input.trim().slice(0, 200)
    let at = -1
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i]
      if (m && m.role === 'user' && userText(m.text).startsWith(probe)) {
        at = i
        break
      }
    }
    if (at < 0) return
    end = at
  } else if (existing.length > 0) {
    return
  }

  const have = new Set(existing.map(n => n.id))
  const out: Node[] = []
  const finalText = new Map<string, string>()

  const addUses = async (
    uses: SessionMessage['toolUses'],
    parent: string,
    depth: number,
  ): Promise<void> => {
    for (const u of uses) {
      const isAgent = u.tool === 'Agent'
      const id = isAgent ? `a:${u.agentId ?? u.tool_use_id}` : u.tool_use_id
      if (have.has(id)) continue
      have.add(id)
      const input = isAgent ? String(u.input.prompt ?? '') : describe(u.input)
      out.push({
        id,
        parent,
        kind: isAgent ? 'agent' : 'tool',
        name: isAgent ? String(u.input.subagent_type ?? 'Agent') : u.tool,
        arg: isAgent ? clip(String(u.input.description ?? ''), 160) : summarize(u.input),
        status: u.isError ? 'err' : 'ok',
        start: 0,
        hist: true,
        ...(u.durationMs !== undefined ? { ms: u.durationMs } : {}),
        ...(await keep($, id, 'input', input, HIST_KEEP)),
        ...(u.text ? await keep($, id, 'output', u.text, HIST_KEEP) : {}),
      })
      if (isAgent && u.agentId && depth < 3) {
        const inner = await $.session.messages({ agentId: u.agentId })
        if (Array.isArray(inner)) {
          await addUses(
            inner.flatMap(m => m.toolUses),
            id,
            depth + 1,
          )
        }
      }
    }
  }

  let current = ''
  for (let i = 0; i < end; i++) {
    const m = msgs[i]
    if (!m) continue
    if (m.role === 'user') {
      const text = userText(m.text)
      if (!text) continue
      current = `h:${i}`
      out.push({
        id: current,
        kind: 'prompt',
        name: 'Prompt',
        arg: clip(text, 160),
        status: 'ok',
        start: 0,
        hist: true,
        ...(await keep($, current, 'input', text, HIST_KEEP)),
      })
    } else {
      if (!current) {
        current = 'h:start'
        out.push({
          id: current,
          kind: 'prompt',
          name: 'Prompt',
          arg: '(earlier activity)',
          status: 'ok',
          start: 0,
          hist: true,
        })
      }
      if (m.text) finalText.set(current, m.text)
      await addUses(m.toolUses, current, 0)
    }
  }
  for (const n of out) {
    const text = n.kind === 'prompt' ? finalText.get(n.id) : undefined
    if (text) Object.assign(n, await keep($, n.id, 'output', text, HIST_KEEP))
  }

  await updateNodes($, list =>
    [...out, ...list.filter(n => !out.some(o => o.id === n.id))].slice(-MAX_NODES),
  )
  // What came before is folded, as every earlier prompt is: all of it when a
  // live prompt follows, else all but the last, which is then the latest.
  const past = out.filter(n => n.kind === 'prompt').map(n => n.id)
  await foldIds($, firstLive ? past : past.slice(0, -1))
}
