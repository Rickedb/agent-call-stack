import * as fs from 'node:fs'
import * as path from 'node:path'

import { Model } from './model'
import type { Ev } from './types'

const MAX_FILES = 30
const MAX_AGE_MS = 7 * 24 * 3600 * 1000

type Tail = { offset: number; rest: Buffer; sids: Set<string> }

/**
 * Reads the event log the hook script writes, and keeps reading as it grows.
 * One file per chat session; a half-written last line waits for its end.
 */
export class EventStore {
  readonly model = new Model()
  private tails = new Map<string, Tail>()
  private listeners = new Set<() => void>()
  private timer?: NodeJS.Timeout
  private watcher?: fs.FSWatcher

  constructor(readonly dir: string) {}

  get eventsDir(): string {
    return path.join(this.dir, 'events')
  }

  onChange(fn: () => void): { dispose(): void } {
    this.listeners.add(fn)
    return { dispose: () => void this.listeners.delete(fn) }
  }

  start(): void {
    fs.mkdirSync(this.eventsDir, { recursive: true })
    this.scan(true)
    try {
      // Quick to notice; the timer below is for the hosts where this misses.
      this.watcher = fs.watch(this.eventsDir, { persistent: false }, () => this.scan())
      this.watcher.on('error', () => {})
    } catch {
      // The timer alone does it.
    }
    this.timer = setInterval(() => this.scan(), 750)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.watcher?.close()
    this.listeners.clear()
  }

  /** Reads what grew since the last scan. True when something new came in. */
  scan(isStart = false): boolean {
    let names: string[]
    try {
      names = fs.readdirSync(this.eventsDir).filter(f => f.endsWith('.jsonl'))
    } catch {
      return false
    }
    const now = Date.now()
    const files = names
      .map(f => {
        const file = path.join(this.eventsDir, f)
        try {
          return { file, mtime: fs.statSync(file).mtimeMs, size: fs.statSync(file).size }
        } catch {
          return undefined
        }
      })
      .filter((f): f is { file: string; mtime: number; size: number } => !!f)
      .filter(f => !isStart || now - f.mtime < MAX_AGE_MS)
      // The oldest first, so that a session's newest events are applied last.
      .sort((a, b) => a.mtime - b.mtime)
      .slice(-MAX_FILES)

    let changed = false
    for (const f of files) {
      let tail = this.tails.get(f.file)
      if (!tail) this.tails.set(f.file, (tail = { offset: 0, rest: Buffer.alloc(0), sids: new Set() }))
      if (f.size < tail.offset) {
        // The file was replaced: read it from its start.
        for (const sid of tail.sids) this.model.remove(sid)
        Object.assign(tail, { offset: 0, rest: Buffer.alloc(0), sids: new Set<string>() })
      }
      if (f.size === tail.offset) continue
      if (this.read(f.file, tail, f.size)) changed = true
    }
    if (changed) for (const fn of this.listeners) fn()
    return changed
  }

  private read(file: string, tail: Tail, size: number): boolean {
    let fd: number | undefined
    try {
      fd = fs.openSync(file, 'r')
      const buf = Buffer.alloc(size - tail.offset)
      const got = fs.readSync(fd, buf, 0, buf.length, tail.offset)
      tail.offset += got
      const data = Buffer.concat([tail.rest, buf.subarray(0, got)])
      const end = data.lastIndexOf(0x0a)
      if (end < 0) {
        tail.rest = data
        return false
      }
      tail.rest = data.subarray(end + 1)
      let any = false
      for (const line of data.subarray(0, end).toString('utf8').split('\n')) {
        if (!line.trim()) continue
        try {
          const ev = JSON.parse(line) as Ev
          if (ev && ev.v === 1 && typeof ev.sid === 'string') {
            tail.sids.add(ev.sid)
            this.model.apply(ev)
            any = true
          }
        } catch {
          // A torn line: the rest of the log is fine.
        }
      }
      return any
    } catch {
      return false
    } finally {
      if (fd !== undefined) fs.closeSync(fd)
    }
  }

  /** Forgets sessions and deletes their logs. */
  clear(sids: string[]): void {
    const gone = new Set(sids)
    for (const [file, tail] of this.tails) {
      if (![...tail.sids].some(s => gone.has(s))) continue
      try {
        fs.rmSync(file, { force: true })
      } catch {
        // It stays until the next time.
      }
      for (const s of tail.sids) this.model.remove(s)
      this.tails.delete(file)
    }
    for (const fn of this.listeners) fn()
  }
}
