import * as fs from 'node:fs'

import { HIST_BYTES, readHistory } from './history'
import type { Session } from './model'
import type { Node, Usage } from './types'
import { fmtTokens } from './view/format'

/**
 * Claude Code's hooks carry no model and no token counts, but each session keeps a transcript (the path
 * is in every hook payload): a line per message, an assistant message with the model that answered and
 * the usage the API reported. The file's format is Claude Code's own and not documented, so this reads
 * it defensively, and shows nothing for what it does not find. It is also written asynchronously, so
 * what the last turn used may show a moment after the turn ends.
 */

/** One API response: when, the model that answered, what it used. */
export type Reply = { t: number; side: boolean; model?: string; usage?: Usage }

/** A compaction the transcript records, with the conversation's size before and after, in tokens. */
export type Boundary = { t: number; trigger: string; before?: number; after?: number }

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** A transcript read so far: what is parsed, and where to go on from. */
export class Parsed {
  replies: Reply[] = []
  boundaries: Boundary[] = []
  offset = 0
  private rest = ''
  private byId = new Map<string, Reply>()

  /** Reads more of the transcript's text: lines that are whole count, the last half line waits. */
  feed(chunk: string): void {
    const data = this.rest + chunk
    const end = data.lastIndexOf('\n')
    if (end < 0) {
      this.rest = data
      return
    }
    this.rest = data.slice(end + 1)
    for (const line of data.slice(0, end).split('\n')) this.line(line)
  }

  private line(line: string): void {
    // Most lines are not ours (attachments, file history, requests): skip them without parsing.
    const isReply = line.includes('"type":"assistant"')
    if (!isReply && !line.includes('compact_boundary')) return
    let o: unknown
    try {
      o = JSON.parse(line)
    } catch {
      return
    }
    if (!isRec(o)) return
    const t = typeof o.timestamp === 'string' ? Date.parse(o.timestamp) : NaN
    if (!Number.isFinite(t)) return

    if (o.type === 'system' && o.subtype === 'compact_boundary' && isRec(o.compactMetadata)) {
      const m = o.compactMetadata
      this.boundaries.push({
        t,
        trigger: typeof m.trigger === 'string' ? m.trigger : '',
        before: typeof m.preTokens === 'number' ? m.preTokens : undefined,
        after: typeof m.postTokens === 'number' ? m.postTokens : undefined,
      })
      return
    }
    if (o.type !== 'assistant' || !isRec(o.message)) return
    const m = o.message
    const u = isRec(m.usage) ? m.usage : undefined
    const usage: Usage | undefined = u
      ? {
          input: num(u.input_tokens),
          output: num(u.output_tokens),
          cacheRead: num(u.cache_read_input_tokens),
          cacheWrite: num(u.cache_creation_input_tokens),
        }
      : undefined
    // An error the client made up is no response of a model.
    const model = typeof m.model === 'string' && !m.model.startsWith('<') ? m.model : undefined
    const reply: Reply = { t, side: o.isSidechain === true, model, usage }

    // A response is written once per content block, with the same usage (as far as it had streamed).
    const id = typeof m.id === 'string' ? m.id : undefined
    const prev = id ? this.byId.get(id) : undefined
    if (prev) {
      prev.t = Math.min(prev.t, t)
      if (usage) {
        const was = prev.usage
        prev.usage = was
          ? {
              input: Math.max(was.input, usage.input),
              output: Math.max(was.output, usage.output),
              cacheRead: Math.max(was.cacheRead, usage.cacheRead),
              cacheWrite: Math.max(was.cacheWrite, usage.cacheWrite),
            }
          : usage
      }
      prev.model ??= model
      return
    }
    if (id) this.byId.set(id, reply)
    this.replies.push(reply)
  }
}

const sum = (replies: Reply[]): Usage | undefined => {
  const used = replies.filter(r => r.usage)
  if (!used.length) return undefined
  return used.reduce<Usage>(
    (t, r) => ({
      input: t.input + (r.usage?.input ?? 0),
      output: t.output + (r.usage?.output ?? 0),
      cacheRead: t.cacheRead + (r.usage?.cacheRead ?? 0),
      cacheWrite: t.cacheWrite + (r.usage?.cacheWrite ?? 0),
    }),
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  )
}

const lastModel = (replies: Reply[]): string | undefined =>
  [...replies].sort((a, b) => a.t - b.t).reverse().find(r => r.model)?.model

/** How far from a compaction's row a transcript's boundary may be and still be it. */
const NEAR_MS = 120_000

/**
 * Names the model and the usage of the prompts the hooks recorded, from the main transcript: a response
 * belongs to the prompt it came after (the next prompt's start ends it). A subagent has a transcript of
 * its own, read whole. A compaction row learns its size before and after.
 */
export const assign = (s: Session, main: Parsed | undefined, agents: Map<string, Parsed>): void => {
  const prompts = s.nodes.filter(n => n.kind === 'prompt')
  if (main) {
    const own = main.replies.filter(r => !r.side)
    prompts.forEach((p, i) => {
      // A little before the hook ran: the clock of the hook and of the transcript agree to a second or so.
      const from = p.start - 1000
      const to = prompts[i + 1] ? (prompts[i + 1] as Node).start - 1000 : Infinity
      const mine = own.filter(r => r.t >= from && r.t < to)
      p.model = lastModel(mine) ?? p.model
      p.usage = sum(mine)
    })
    const used = new Set<Boundary>()
    for (const row of s.nodes.filter(n => n.kind === 'event' && n.name === 'Compact')) {
      const at = row.end ?? row.start
      const hit = main.boundaries
        .filter(b => !used.has(b) && (!row.compact?.trigger || !b.trigger || b.trigger === row.compact.trigger))
        .sort((a, b) => Math.abs(a.t - at) - Math.abs(b.t - at))[0]
      if (!hit || Math.abs(hit.t - at) > NEAR_MS) continue
      used.add(hit)
      row.compact = { trigger: row.compact?.trigger ?? hit.trigger, before: hit.before, after: hit.after }
      if (hit.before !== undefined && hit.after !== undefined) {
        row.arg = `${row.compact.trigger} · ${fmtTokens(hit.before)} → ${fmtTokens(hit.after)} tok`
      }
    }
  }
  for (const a of s.nodes.filter(n => n.kind === 'agent' && n.transcript)) {
    const t = agents.get(a.transcript as string)
    if (!t) continue
    a.model = lastModel(t.replies) ?? a.model
    a.usage = sum(t.replies)
  }
}

/** Reads the transcripts of the sessions it is asked about, a little at a time: they are long, and only grow. */
export class TranscriptReader {
  private files = new Map<string, Parsed>()

  /** What a transcript holds so far; nothing for a file that is not there. */
  read(file: string): Parsed | undefined {
    try {
      const size = fs.statSync(file).size
      let parsed = this.files.get(file)
      // A file that got shorter was replaced: read it again from its start.
      if (parsed && size < parsed.offset) parsed = undefined
      if (!parsed) this.files.set(file, (parsed = new Parsed()))
      if (size > parsed.offset) {
        const fd = fs.openSync(file, 'r')
        try {
          const buf = Buffer.alloc(size - parsed.offset)
          const got = fs.readSync(fd, buf, 0, buf.length, parsed.offset)
          parsed.offset += got
          parsed.feed(buf.subarray(0, got).toString('utf8'))
        } finally {
          fs.closeSync(fd)
        }
      }
      return parsed
    } catch {
      return undefined
    }
  }

  /**
   * Reads what the chat held before the hooks into the session, once its transcript can be read. The
   * end of a long transcript is enough: the older part is left out.
   */
  private history(s: Session): void {
    if (s.historyDone || !s.transcript || !s.firstT) return
    let text: string
    try {
      const size = fs.statSync(s.transcript).size
      if (size <= HIST_BYTES) text = fs.readFileSync(s.transcript, 'utf8')
      else {
        const fd = fs.openSync(s.transcript, 'r')
        try {
          const buf = Buffer.alloc(HIST_BYTES)
          fs.readSync(fd, buf, 0, HIST_BYTES, size - HIST_BYTES)
          // The first line is cut: leave it out.
          text = buf.toString('utf8')
          text = text.slice(text.indexOf('\n') + 1)
        } finally {
          fs.closeSync(fd)
        }
      }
    } catch {
      // Not written yet, or gone: the next draw tries again.
      return
    }
    s.adoptHistory(readHistory(text, s.historyCut()))
  }

  /** Sets the model and usage of a session's prompts and subagents, when their transcripts are found. */
  apply(s: Session | undefined): void {
    if (!s) return
    this.history(s)
    const main = s.transcript ? this.read(s.transcript) : undefined
    const agents = new Map<string, Parsed>()
    for (const a of s.nodes) {
      if (a.kind !== 'agent' || !a.transcript) continue
      const t = this.read(a.transcript)
      if (t) agents.set(a.transcript, t)
    }
    assign(s, main, agents)
  }
}
