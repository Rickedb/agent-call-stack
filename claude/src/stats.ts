import type { Node, Usage } from '../types'
import { clip, sizeOf } from './format'

/** One kind of tool: how often it ran, how long it took, how much text went through it. */
export type Kind = {
  name: string
  count: number
  failed: number
  /** Calls with an end time: only these have a time. */
  done: number
  /** Their total time, and the average. */
  ms: number
  avg: number
  /** Estimated tokens in and out of its calls. */
  tokens: number
}

/** A row that went wrong, and what the record says of why. */
export type Fail = { node: Node; why: string }

/** What the person was asked, and what was decided without asking. */
export type Perms = {
  allowed: number
  /** Calls the engine put to the person (or a classifier). */
  asked: number
  /** Those that were not allowed to run, asked or not. */
  denied: number
  /** How long the asked calls waited for an answer, summed. */
  waited: number
}

/** The compactions of a prompt. */
export type Compacts = {
  count: number
  manual: number
  auto: number
  /** Tokens the compactions left out of the conversation, summed over those that said. */
  saved: number
  /** The conversation's size before the first and after the last, when they said. */
  before?: number
  after?: number
  ms: number
  /** What the summarizing requests cost, as the API reported it, summed. */
  usage?: Usage
}

/** What a finished prompt did, worked out from its rows. */
export type Report = {
  /** Tool calls (a subagent is counted apart). */
  calls: number
  failed: number
  /** The prompt's own time, and how much of it some call was running. */
  wall: number
  busy: number
  /** Tools, the most called first. */
  kinds: Kind[]
  /** The average time of the tool calls that finished. */
  avg: number
  slowest?: Node
  /** The call that moved the most text, and its tokens. */
  heaviest?: Node
  heavy: number
  /** Estimated tokens: what went in (the prompt and every call's input) and out (every call's output and the answer). */
  input: number
  output: number
  agents: { count: number; failed: number; ms: number; longest?: Node }
  /** The models the prompt and its subagents ran on, the prompt's first. */
  models: { model: string; main: boolean; agents: number }[]
  /** What the API reported for the prompt's turn and its subagents', summed; undefined when it reported none. */
  usage?: Usage
  /** Every row under it that failed, and the prompt itself if it did, in the order they happened. */
  errors: Fail[]
  /** Undefined when nothing was compacted. */
  compacts?: Compacts
  /** Undefined when no call had a permission verdict (a prompt read back from history). */
  perms?: Perms
}

/** Time some call was running: the calls' spans merged, so overlaps count once. */
export const busyOf = (top: Node, calls: Node[], now: number): number => {
  const end = top.end ?? now
  let busy = 0
  let from = -Infinity
  let to = -Infinity
  for (const n of [...calls].sort((a, b) => a.start - b.start)) {
    const s = Math.max(n.start, top.start)
    const e = Math.min(n.end ?? end, end)
    if (e <= s) continue
    if (s > to) {
      if (to > from) busy += to - from
      from = s
      to = e
    } else to = Math.max(to, e)
  }
  if (to > from) busy += to - from
  return busy
}

/** Why a row failed, in a line: what it said when it ended, else the first line of its error. */
export const whyOf = (n: Node): string => {
  if (n.why) return n.why
  const p = n.perm
  if (p?.decision === 'deny') return `denied${p.rule ? ` by ${p.rule}` : ''}${p.reason ? `: ${clip(p.reason, 120)}` : ''}`
  if (p?.refused) return `not allowed${p.reason ? `: ${clip(p.reason, 120)}` : ''}`
  const line = (n.output ?? '').split('\n').find(l => l.trim())
  return line ? clip(line, 140) : 'failed'
}

/** The model a row ran on: its own, else its nearest ancestor's (a tool call is the loop's). */
export const modelOf = (list: Node[], n: Node): string | undefined => {
  const byId = new Map(list.map(x => [x.id, x]))
  for (let cur: Node | undefined = n; cur; cur = cur.parent ? byId.get(cur.parent) : undefined) {
    if (cur.model) return cur.model
  }
  return undefined
}

const tok = (n: Node, which: 'input' | 'output') => Math.ceil(sizeOf(n, which) / 4)

/**
 * The summary of a prompt that has finished, or undefined while it runs or if it
 * made no call. Tokens are estimates, four characters a token, of the whole text.
 * `below` is every row under the prompt.
 */
export const reportOf = (top: Node, below: Node[], now: number): Report | undefined => {
  if (top.status === 'run' || top.hist) return undefined
  const tools = below.filter(n => n.kind === 'tool')
  const agents = below.filter(n => n.kind === 'agent')
  const events = below.filter(n => n.kind === 'event')
  // A prompt that did nothing but fail or compact still has something to say.
  if (tools.length + agents.length + events.length === 0 && !top.why) return undefined

  const took = (n: Node) => (n.end as number) - n.start
  const byName = new Map<string, Node[]>()
  for (const n of tools) byName.set(n.name, [...(byName.get(n.name) ?? []), n])
  const kinds: Kind[] = [...byName].map(([name, list]) => {
    const done = list.filter(n => n.end !== undefined)
    const ms = done.reduce((t, n) => t + took(n), 0)
    return {
      name,
      count: list.length,
      failed: list.filter(n => n.status === 'err').length,
      done: done.length,
      ms,
      avg: done.length ? ms / done.length : 0,
      tokens: list.reduce((t, n) => t + tok(n, 'input') + tok(n, 'output'), 0),
    }
  })
  kinds.sort((a, b) => b.count - a.count || b.ms - a.ms || a.name.localeCompare(b.name))

  const finished = tools.filter(n => n.end !== undefined)
  const totalMs = finished.reduce((t, n) => t + took(n), 0)
  const slowest = [...finished].sort((a, b) => took(b) - took(a))[0]

  const calls = [...tools, ...agents]
  const weight = (n: Node) => tok(n, 'input') + tok(n, 'output')
  const heaviest = [...calls].sort((a, b) => weight(b) - weight(a))[0]

  const end = top.end ?? now
  const busy = busyOf(top, calls, now)

  const models: Report['models'] = []
  for (const n of [top, ...agents]) {
    if (!n.model) continue
    let one = models.find(m => m.model === n.model)
    if (!one) {
      one = { model: n.model, main: false, agents: 0 }
      models.push(one)
    }
    if (n === top) one.main = true
    else one.agents++
  }
  const agentDone = agents.filter(n => n.end !== undefined)

  const errors: Fail[] = [...(top.status === 'err' ? [top] : []), ...below.filter(n => n.status === 'err')]
    .sort((a, b) => a.start - b.start)
    .map(node => ({ node, why: whyOf(node) }))

  const compacted = events.filter(n => n.name === 'Compact' && n.compact && !n.compact.skipped)
  const compacts: Compacts | undefined = compacted.length
    ? {
        count: compacted.length,
        manual: compacted.filter(n => n.compact?.trigger === 'manual').length,
        auto: compacted.filter(n => n.compact?.trigger === 'auto').length,
        saved: compacted.reduce((t, n) => t + Math.max(0, (n.compact?.before ?? 0) - (n.compact?.after ?? 0)), 0),
        before: compacted[0]?.compact?.before,
        after: compacted[compacted.length - 1]?.compact?.after,
        ms: compacted.reduce((t, n) => t + (n.end !== undefined ? n.end - n.start : 0), 0),
        usage: compacted.reduce<Usage | undefined>((sum, n) => {
          const u = n.compact?.usage
          if (!u) return sum
          return sum
            ? { input: sum.input + u.input, output: sum.output + u.output, cacheRead: sum.cacheRead + u.cacheRead, cacheWrite: sum.cacheWrite + u.cacheWrite }
            : { ...u }
        }, undefined),
      }
    : undefined

  const judged = tools.filter(n => n.perm)
  const perms: Perms | undefined = judged.length
    ? {
        allowed: judged.filter(n => n.perm?.decision === 'allow').length,
        asked: judged.filter(n => n.perm?.decision === 'ask').length,
        denied: judged.filter(n => n.perm?.decision === 'deny' || n.perm?.refused).length,
        waited: judged.reduce((t, n) => t + (n.perm?.waited ?? 0), 0),
      }
    : undefined
  return {
    calls: tools.length,
    failed: tools.filter(n => n.status === 'err').length,
    wall: end - top.start,
    busy,
    kinds,
    avg: finished.length ? totalMs / finished.length : 0,
    slowest,
    heaviest: heaviest && weight(heaviest) > 0 ? heaviest : undefined,
    heavy: heaviest ? weight(heaviest) : 0,
    input: tok(top, 'input') + calls.reduce((t, n) => t + tok(n, 'input'), 0),
    output: tok(top, 'output') + calls.reduce((t, n) => t + tok(n, 'output'), 0),
    agents: {
      count: agents.length,
      failed: agents.filter(n => n.status === 'err').length,
      ms: agentDone.reduce((t, n) => t + took(n), 0),
      longest: [...agentDone].sort((a, b) => took(b) - took(a))[0],
    },
    models,
    errors,
    compacts,
    perms,
    usage: [top, ...agents].reduce<Usage | undefined>((sum, n) => {
      if (!n.usage) return sum
      const u = n.usage
      return sum
        ? { input: sum.input + u.input, output: sum.output + u.output, cacheRead: sum.cacheRead + u.cacheRead, cacheWrite: sum.cacheWrite + u.cacheWrite }
        : { ...u }
    }, undefined),
  }
}
