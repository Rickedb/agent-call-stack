import type { Node } from './types'
import { clip, describe, isSpawnTool, resultText, summarize, touchOf } from './record'

/**
 * What the chat held before the hooks were added, read back from Claude Code's transcript. The
 * transcript has what the hooks would have said, with the time each line was written: a prompt
 * (a `user` line with text), the calls the model made (`tool_use` blocks) and what came back
 * (`tool_result` blocks of the next `user` line). It does not say what you were asked, how long a tool
 * ran, or which hook fired, so such rows have times that include a wait for you, and no verdicts.
 */

/** What the state keeps of one text of a row read back: it can be many calls at once. */
export const HIST_KEEP = 1500
/** How many bytes of the end of a transcript are read: the older part of a longer one is left out. */
export const HIST_BYTES = 64 * 1024 * 1024
/** How many prompts, at most, are read back. */
const HIST_PROMPTS = 30

export type HistCall = {
  id: string
  name: string
  input: Record<string, unknown>
  start: number
  end?: number
  output?: string
  isError?: boolean
}

export type HistPrompt = {
  id: string
  start: number
  end: number
  text: string
  answer?: string
  calls: HistCall[]
  /** Compactions the transcript records within the prompt. */
  compacts: { t: number; trigger: string; before?: number; after?: number; ms?: number }[]
}

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

// What a person typed: the app's reminders around it, and the wrapper of a slash command, are not it.
export const userText = (raw: string): string => {
  const t = raw.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim()
  const cmd = /<command-name>([\s\S]*?)<\/command-name>/.exec(t)
  if (cmd) {
    const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(t)?.[1]?.trim()
    return `${(cmd[1] ?? '').trim()}${args ? ` ${args}` : ''}`
  }
  // The output of a local command is no prompt.
  return t.startsWith('<local-command-') ? '' : t
}

const blocks = (content: unknown): Record<string, unknown>[] =>
  Array.isArray(content) ? content.filter(isRec) : []

/**
 * The prompts of a transcript's text that were written before `until`, oldest first, each with its
 * calls. Lines of subagents (`isSidechain`) and of anything but prompts, replies and compactions are
 * skipped without more ado.
 */
export const readHistory = (text: string, until: number): HistPrompt[] => {
  const prompts: HistPrompt[] = []
  const calls = new Map<string, HistCall>()
  let cur: HistPrompt | undefined
  for (const line of text.split('\n')) {
    const isUser = line.includes('"type":"user"')
    const isReply = line.includes('"type":"assistant"')
    if (!isUser && !isReply && !line.includes('compact_boundary')) continue
    let o: unknown
    try {
      o = JSON.parse(line)
    } catch {
      continue
    }
    if (!isRec(o) || o.isSidechain === true) continue
    const t = typeof o.timestamp === 'string' ? Date.parse(o.timestamp) : NaN
    if (!Number.isFinite(t) || t >= until) continue

    if (o.type === 'system' && o.subtype === 'compact_boundary' && isRec(o.compactMetadata) && cur) {
      const m = o.compactMetadata
      cur.compacts.push({
        t,
        trigger: typeof m.trigger === 'string' ? m.trigger : '',
        before: typeof m.preTokens === 'number' ? m.preTokens : undefined,
        after: typeof m.postTokens === 'number' ? m.postTokens : undefined,
        ms: typeof m.durationMs === 'number' ? m.durationMs : undefined,
      })
      continue
    }
    const message = isRec(o.message) ? o.message : undefined
    if (!message) continue

    if (o.type === 'user') {
      const content = message.content
      if (typeof content === 'string') {
        if (o.isMeta === true || o.isCompactSummary === true) continue
        const typed = userText(content)
        if (!typed) continue
        cur = { id: `h:${typeof o.uuid === 'string' ? o.uuid : t}`, start: t, end: t, text: typed, calls: [], compacts: [] }
        prompts.push(cur)
        continue
      }
      for (const b of blocks(content)) {
        if (b.type !== 'tool_result' || typeof b.tool_use_id !== 'string') continue
        const call = calls.get(b.tool_use_id)
        if (!call) continue
        call.end = t
        call.output = resultText(b.content)
        call.isError = b.is_error === true
        if (cur) cur.end = Math.max(cur.end, t)
      }
      continue
    }

    if (o.type === 'assistant' && cur) {
      cur.end = Math.max(cur.end, t)
      for (const b of blocks(message.content)) {
        if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) cur.answer = b.text
        if (b.type === 'tool_use' && typeof b.id === 'string' && typeof b.name === 'string' && !calls.has(b.id)) {
          const call: HistCall = { id: b.id, name: b.name, input: isRec(b.input) ? b.input : {}, start: t }
          calls.set(b.id, call)
          cur.calls.push(call)
        }
      }
    }
  }
  return prompts
}

// A text kept up to HIST_KEEP characters, and its whole length.
const kept = (which: 'input' | 'output', text: string): Partial<Node> => ({
  [which]: text.slice(0, HIST_KEEP),
  [`${which}Len`]: text.length,
})

/** The rows of the prompts read back: each prompt, its calls and subagents, its compactions. Newest prompts first to fit in `room`. */
export const historyNodes = (prompts: HistPrompt[], room: number): Node[] => {
  const nodes: Node[][] = []
  let left = room
  for (const p of prompts.slice(-HIST_PROMPTS).reverse()) {
    const rows: Node[] = [
      {
        id: p.id,
        kind: 'prompt',
        name: 'Prompt',
        arg: clip(p.text, 160),
        status: 'ok',
        start: p.start,
        end: p.end,
        hist: true,
        ...kept('input', p.text),
        ...(p.answer ? kept('output', p.answer) : {}),
      },
    ]
    for (const c of p.calls) {
      const end = c.end ?? p.end
      const isFailed = c.isError === true || c.end === undefined
      const output = c.end === undefined ? '(no result recorded)' : (c.output ?? '')
      if (isSpawnTool(c.name)) {
        rows.push({
          id: `t:${c.id}`,
          parent: p.id,
          kind: 'agent',
          name: typeof c.input.subagent_type === 'string' ? c.input.subagent_type : 'subagent',
          arg: clip(String(c.input.description ?? ''), 160),
          status: isFailed ? 'err' : 'ok',
          start: c.start,
          end,
          hist: true,
          ...kept('input', String(c.input.prompt ?? describe(c.input))),
          ...kept('output', output),
        })
        continue
      }
      const touch = touchOf(c.name, c.input)
      rows.push({
        id: `t:${c.id}`,
        parent: p.id,
        kind: 'tool',
        name: c.name,
        arg: summarize(c.input),
        status: isFailed ? 'err' : 'ok',
        start: c.start,
        end,
        hist: true,
        ...kept('input', describe(c.input)),
        ...kept('output', output),
        ...(touch ? { touch } : {}),
      })
    }
    for (const k of p.compacts) {
      rows.push({
        id: `${p.id}:compact:${k.t}`,
        parent: p.id,
        kind: 'event',
        name: 'Compact',
        arg: k.trigger,
        status: 'ok',
        start: k.ms !== undefined ? k.t - k.ms : k.t,
        end: k.t,
        hist: true,
        compact: { trigger: k.trigger, before: k.before, after: k.after },
      })
    }
    if (rows.length > left && nodes.length) break
    left -= rows.length
    nodes.unshift(rows)
  }
  return nodes.flat()
}
