import type { Node } from '../types'
import { sizeOf } from './format'

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
  if (tools.length + agents.length === 0) return undefined

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

  // Time some call was running: the calls' spans merged, so overlaps count once.
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

  const agentDone = agents.filter(n => n.end !== undefined)
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
  }
}
