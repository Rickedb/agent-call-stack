import * as fs from 'node:fs'

import type { Session } from './model'
import type { Node } from './types'
import { clip } from './view/format'

/** How much of a transcript note is kept in memory; the transcript retains the whole text. */
export const NOTE_KEEP = 8000
/** A longer gap is more likely a wait than time spent thinking or replying. */
const NOTE_MAX_MS = 30 * 60_000

type Rec = Record<string, unknown>

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v)

type Note = {
  id: string
  name: 'Thinking' | 'Reply'
  start: number
  t: number
  text: string
  len: number
}

/** Incrementally reads the Copilot transcript records that contain model thinking and reply text. */
export class ParsedTranscript {
  notes: Note[] = []
  offset = 0
  private rest = ''
  private last = 0
  private seq = 0
  private seen = new Set<string>()

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
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      return
    }
    if (!isRec(value) || typeof value.timestamp !== 'string') return
    const t = Date.parse(value.timestamp)
    if (!Number.isFinite(t)) return

    if (value.type === 'assistant.message' && isRec(value.data)) {
      const data = value.data
      const id = typeof value.id === 'string' ? value.id : `${t}:${this.seq++}`
      const start = this.last > 0 && this.last <= t && t - this.last < NOTE_MAX_MS ? this.last : t
      this.add(id, 'Thinking', data.reasoningText, start, t)
      this.add(id, 'Reply', data.content, start, t)
    }
    this.last = t
  }

  private add(id: string, name: Note['name'], text: unknown, start: number, t: number): void {
    if (typeof text !== 'string' || !text.trim()) return
    const key = `${id}:${name}`
    if (this.seen.has(key)) return
    this.seen.add(key)
    this.notes.push({ id: `n:${key}`, name, start, t, text: text.slice(0, NOTE_KEEP), len: text.length })
  }
}

const noteRow = (n: Note, parent: string): Node => ({
  id: `${parent}:${n.id}`,
  parent,
  kind: 'note',
  name: n.name,
  arg: clip(n.text, 160),
  status: 'ok',
  start: n.start,
  end: n.t,
  output: n.text,
  outputLen: n.len,
})

/** Reads notes for the prompt and any subagent with its own transcript path. */
export class TranscriptReader {
  private files = new Map<string, ParsedTranscript>()

  read(file: string): ParsedTranscript | undefined {
    try {
      const size = fs.statSync(file).size
      let parsed = this.files.get(file)
      if (parsed && size < parsed.offset) parsed = undefined
      if (!parsed) this.files.set(file, (parsed = new ParsedTranscript()))
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

  apply(s: Session | undefined): void {
    if (!s) return
    const prompts = s.nodes.filter(n => n.kind === 'prompt')
    const notes: Node[] = []
    const mainPath = [...prompts].reverse().find(p => p.transcript)?.transcript
    const main = mainPath ? this.read(mainPath) : undefined
    if (main) {
      const own = main.notes
      prompts.forEach((p, i) => {
        const from = p.start - 1000
        const next = prompts[i + 1]
        const to = next ? next.start - 1000 : Infinity
        for (const n of own) if (n.t >= from && n.t < to) notes.push(noteRow(n, p.id))
      })
    }
    const agents = s.nodes.filter(
      (n): n is Node & { kind: 'agent'; transcript: string } =>
        n.kind === 'agent' && !!n.transcript && n.transcript !== mainPath,
    )
    for (const a of agents) {
      const transcript = this.read(a.transcript)
      if (!transcript) continue
      for (const n of transcript.notes) {
        if (n.t >= a.start - 1000 && n.t <= (a.end ?? Infinity) + 1000) notes.push(noteRow(n, a.id))
      }
    }
    s.addNotes(notes)
  }
}
