import * as fs from 'node:fs'
import * as path from 'node:path'

import type { Session } from './model'
import type { Node } from './types'

/**
 * Copilot's hooks carry no model, but VS Code keeps each chat session in a file of its own
 * (`chatSessions/<session id>.jsonl`, in the workspace's storage): a log of a snapshot and the
 * changes after it. Each request there names the model it was sent to, and the chat input
 * names the model now picked. The format is VS Code's own and not documented, so what is read
 * here is the little that is needed, and anything not found just leaves the model unknown.
 */
export type ChatModels = {
  /** The model id of each request of the chat, in order; undefined where it names none. */
  requests: (string | undefined)[]
  /** The model picked in the chat input, as of the last line. */
  selected?: string
}

type Line = { kind?: number; k?: unknown[]; v?: unknown; i?: number }

const idOf = (x: unknown): string | undefined => {
  const o = x as { modelId?: unknown } | null
  return typeof o?.modelId === 'string' && o.modelId ? o.modelId : undefined
}
const selectedOf = (x: unknown): string | undefined => {
  const o = x as { identifier?: unknown } | null
  return typeof o?.identifier === 'string' && o.identifier ? o.identifier : undefined
}

/** Replays the log far enough to know each request's model and the model picked. */
export const parseChatLog = (text: string): ChatModels => {
  const out: ChatModels = { requests: [] }
  for (const raw of text.split('\n')) {
    if (!raw.trim()) continue
    let line: Line
    try {
      line = JSON.parse(raw) as Line
    } catch {
      continue
    }
    const k = Array.isArray(line.k) ? line.k : []
    if (line.kind === 0 && line.v && typeof line.v === 'object') {
      // The snapshot.
      const v = line.v as { requests?: unknown[]; inputState?: { selectedModel?: unknown } }
      if (Array.isArray(v.requests)) out.requests = v.requests.map(idOf)
      out.selected = selectedOf(v.inputState?.selectedModel) ?? out.selected
    } else if (line.kind === 1) {
      // A value set at a path.
      if (k[0] === 'inputState' && k[1] === 'selectedModel' && k.length === 2) {
        out.selected = selectedOf(line.v) ?? out.selected
      } else if (k[0] === 'requests') {
        if (k.length === 1 && Array.isArray(line.v)) out.requests = line.v.map(idOf)
        else if (k.length === 2 && typeof k[1] === 'number') out.requests[k[1]] = idOf(line.v)
        else if (k.length === 3 && typeof k[1] === 'number' && k[2] === 'modelId') {
          out.requests[k[1]] = typeof line.v === 'string' && line.v ? line.v : undefined
        }
      }
    } else if (line.kind === 2 && k[0] === 'requests' && k.length === 1 && Array.isArray(line.v)) {
      // Requests added, at an index when the log says where.
      if (typeof line.i === 'number') out.requests.length = Math.min(out.requests.length, line.i)
      out.requests.push(...line.v.map(idOf))
    }
  }
  return out
}

/**
 * Names the model of the prompts the hooks recorded. The chat may hold requests from before
 * the hooks were installed, so the two lists are matched from the newest end. When the chat
 * names no model for a request, the newest prompt gets the model now picked.
 */
export const assignModels = (prompts: Node[], chat: ChatModels): void => {
  const r = chat.requests
  prompts.forEach((p, i) => {
    const fromEnd = prompts.length - 1 - i
    const id = fromEnd < r.length ? r[r.length - 1 - fromEnd] : undefined
    p.model = id ?? (fromEnd === 0 ? chat.selected : undefined)
  })
}

/**
 * Reads the chat logs of the session ids it is asked about, from the folders VS Code keeps
 * them in, and re-reads a file only when it changed.
 */
export class ChatModelReader {
  private cache = new Map<string, { mtimeMs: number; size: number; models: ChatModels }>()

  constructor(private dirs: () => string[]) {}

  read(sid: string): ChatModels | undefined {
    if (!/^[\w-]+$/.test(sid)) return undefined
    for (const dir of this.dirs()) {
      const file = path.join(dir, `${sid}.jsonl`)
      try {
        const st = fs.statSync(file)
        const hit = this.cache.get(file)
        if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.models
        const models = parseChatLog(fs.readFileSync(file, 'utf8'))
        this.cache.set(file, { mtimeMs: st.mtimeMs, size: st.size, models })
        return models
      } catch {
        // Not in this folder.
      }
    }
    return undefined
  }

  /** Sets the model of a session's prompts, when its chat log is found. */
  apply(s: Session | undefined): void {
    if (!s) return
    const chat = this.read(s.id)
    if (chat) assignModels(s.nodes.filter(n => n.kind === 'prompt'), chat)
  }
}
