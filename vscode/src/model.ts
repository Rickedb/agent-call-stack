import type { Ev, Node } from './types'

export const MAX_NODES = 800

type Texts = Pick<Node, 'input' | 'inputLen' | 'inputFile' | 'output' | 'outputLen' | 'outputFile'>

const texts = (ev: Ev, which: 'input' | 'output'): Texts => {
  const out: Texts = {}
  if (ev[which] !== undefined) out[which] = ev[which]
  if (ev[`${which}Len`] !== undefined) out[`${which}Len`] = ev[`${which}Len`]
  if (ev[`${which}File`] !== undefined) out[`${which}File`] = ev[`${which}File`]
  return out
}

type Spawn = { agentId?: string; type?: string; arg: string; input: Texts }

const SPAWN = new Set(['runsubagent', 'run_subagent', 'agent', 'task'])
const isSpawn = (tool?: string) => !!tool && SPAWN.has(tool.toLowerCase())

/**
 * One chat session's calls, built up from its events in the order they came.
 *
 * Copilot gives a tool call an id only on some hosts, and a subagent's id only
 * when it stops or when it calls a tool. So a call is paired with its result by
 * id when there is one, and by what it was given otherwise; and a subagent is
 * found by id once known, or bound to the oldest one still waiting for it.
 */
export class Session {
  nodes: Node[] = []
  root = ''
  cwd?: string
  firstT = 0
  lastT = 0

  private byId = new Map<string, Node>()
  private seq = 0
  /** Calls without a result yet, by id or by what they were given: oldest first. */
  private open = new Map<string, string[]>()
  /** A subagent's id, to its node. */
  private agents = new Map<string, string>()
  /** Subagents that started without an id, oldest first. */
  private pending: string[] = []
  /** Spawn calls seen, waiting for their subagent's start. */
  private spawns: Spawn[] = []

  constructor(readonly id: string) {}

  get(id: string): Node | undefined {
    return this.byId.get(id)
  }

  /** Adds transcript notes once, and only while their prompt or subagent is still in the tree. */
  addNotes(notes: Node[]): void {
    for (const n of notes) {
      if (this.byId.has(n.id) || !n.parent || !this.byId.has(n.parent)) continue
      this.add(n)
    }
  }

  /** The first prompt, to tell sessions apart. */
  get label(): string {
    return this.nodes.find(n => n.kind === 'prompt')?.arg || '(no prompt yet)'
  }

  apply(ev: Ev): void {
    if (!this.firstT) this.firstT = ev.t
    this.lastT = Math.max(this.lastT, ev.t)
    if (ev.cwd && !this.cwd) this.cwd = ev.cwd

    switch (ev.kind) {
      case 'prompt':
        return this.prompt(ev)
      case 'stop':
        return this.stop(ev)
      case 'session_end':
        return this.sessionEnd(ev)
      case 'error':
        return this.error(ev)
      case 'compact':
        return this.compact(ev)
      case 'tool_pre':
        return this.toolPre(ev)
      case 'tool_post':
      case 'tool_fail':
        return this.toolPost(ev)
      case 'agent_start':
        return this.agentStart(ev)
      case 'agent_stop':
        return this.agentStop(ev)
      default:
        return
    }
  }

  private add(fields: Omit<Node, 'id'> & { id?: string }): Node {
    const node: Node = { ...fields, id: fields.id ?? `${this.id}#${++this.seq}` }
    this.nodes.push(node)
    this.byId.set(node.id, node)
    if (this.nodes.length > MAX_NODES) this.dropOldest()
    return node
  }

  // The oldest prompt goes, with everything under it; the one running stays.
  private dropOldest(): void {
    const old = this.nodes.find(n => n.kind === 'prompt' && n.id !== this.root)
    if (!old) return
    const gone = new Set([old.id])
    for (const n of this.nodes) if (n.parent && gone.has(n.parent)) gone.add(n.id)
    this.nodes = this.nodes.filter(n => !gone.has(n.id))
    for (const id of gone) this.byId.delete(id)
  }

  private ensureRoot(t: number): void {
    if (this.root && this.byId.has(this.root)) return
    this.root = this.add({
      kind: 'prompt',
      name: 'Prompt',
      arg: '(earlier activity)',
      status: 'run',
      start: t,
    }).id
  }

  private prompt(ev: Ev): void {
    if (ev.agentId) return
    this.finishRoot(ev.t, 'ok')
    this.root = this.add({
      kind: 'prompt',
      name: 'Prompt',
      arg: ev.arg ?? '',
      status: 'run',
      start: ev.t,
      ...texts(ev, 'input'),
    }).id
  }

  private stop(ev: Ev): void {
    this.finishRoot(ev.t, 'ok', texts(ev, 'output'))
    const top = this.byId.get(this.root)
    if (top && ev.transcript) top.transcript = ev.transcript
  }

  // Ends the prompt and what is still under it: a call that never got a result
  // (one that was denied, say) is drawn as failed; a subagent as done.
  private finishRoot(t: number, status: Node['status'], out: Texts = {}, why?: string): void {
    const top = this.byId.get(this.root)
    if (!top || top.status !== 'run') return
    const below = new Set([top.id])
    for (const n of this.nodes) if (n.parent && below.has(n.parent)) below.add(n.id)
    for (const n of this.nodes) {
      if (!below.has(n.id) || n.status !== 'run') continue
      n.end = t
      n.status = n.kind === 'tool' ? 'err' : status
      if (n.kind === 'tool' && !n.output) n.output = '(no result recorded)'
    }
    Object.assign(top, out)
    if (why) top.why = why
    this.open.clear()
    this.pending = []
  }

  // A session that ends while a prompt runs ends the prompt: well if it completed or the person left,
  // badly if it was aborted, timed out or failed.
  private sessionEnd(ev: Ev): void {
    const bad: Record<string, string> = { abort: 'interrupted', error: 'session error', timeout: 'timed out' }
    const why = ev.reason ? bad[ev.reason] : undefined
    this.finishRoot(ev.t, why ? 'err' : 'ok', {}, why)
  }

  // An error the host reported: a row under what was running, with the message in its words and the
  // rest (context, whether it was recoverable, the stack) in its text.
  private error(ev: Ev): void {
    this.ensureRoot(ev.t)
    this.add({
      parent: this.parentFor(ev) || undefined,
      kind: 'event',
      name: 'Error',
      arg: ev.arg ?? '',
      status: 'err',
      start: ev.t,
      end: ev.t,
      why: ev.arg || 'error',
      ...texts(ev, 'output'),
    })
  }

  // The context was compacted. The hook fires before it and nothing after, so the row has no length,
  // no size and no summary: only what set it off and what it was told to keep.
  private compact(ev: Ev): void {
    this.ensureRoot(ev.t)
    this.add({
      parent: this.parentFor(ev) || undefined,
      kind: 'event',
      name: 'Compact',
      arg: ev.arg ?? '',
      status: 'ok',
      start: ev.t,
      end: ev.t,
      compact: { trigger: ev.reason ?? '' },
      ...(ev.transcript ? { transcript: ev.transcript } : {}),
      ...texts(ev, 'input'),
    })
  }

  private key(ev: Ev): string {
    return ev.toolUseId ? `id:${ev.toolUseId}` : `fp:${ev.agentId ?? ''}:${ev.fp ?? ev.tool ?? ''}`
  }

  private queue(key: string): string[] {
    let q = this.open.get(key)
    if (!q) this.open.set(key, (q = []))
    return q
  }

  // Where a call inside a subagent hangs. An id not seen before belongs to the
  // oldest subagent still waiting for one, or to a new, unnamed one.
  private agentNode(agentId: string, t: number): string {
    const known = this.agents.get(agentId)
    if (known && this.byId.has(known)) return known
    const waiting = this.pending.shift()
    if (waiting && this.byId.has(waiting)) {
      this.agents.set(agentId, waiting)
      return waiting
    }
    this.ensureRoot(t)
    const node = this.add({
      id: `a:${agentId}`,
      parent: this.root,
      kind: 'agent',
      name: 'subagent',
      arg: '',
      status: 'run',
      start: t,
    })
    this.agents.set(agentId, node.id)
    return node.id
  }

  private parentFor(ev: Ev): string {
    return ev.agentId ? this.agentNode(ev.agentId, ev.t) : this.root
  }

  private toolPre(ev: Ev): void {
    if (isSpawn(ev.tool)) {
      this.spawns.push({
        agentId: ev.agentId,
        type: ev.agentType,
        arg: ev.arg ?? '',
        input: texts(ev, 'input'),
      })
      return
    }
    this.ensureRoot(ev.t)
    const id = ev.toolUseId ? `t:${ev.toolUseId}` : undefined
    if (id && this.byId.has(id)) return
    const node = this.add({
      id,
      parent: this.parentFor(ev) || undefined,
      kind: 'tool',
      name: ev.tool ?? 'tool',
      arg: ev.arg ?? '',
      status: 'run',
      start: ev.t,
      ...(ev.touch ? { touch: ev.touch } : {}),
      ...texts(ev, 'input'),
    })
    this.queue(this.key(ev)).push(node.id)
  }

  private toolPost(ev: Ev): void {
    if (isSpawn(ev.tool)) return
    this.ensureRoot(ev.t)
    let node: Node | undefined
    const q = this.open.get(this.key(ev))
    while (q && q.length && !node) node = this.byId.get(q.shift() as string)
    // A result with no call seen: the hooks were installed while it ran.
    node ??= this.add({
      parent: this.parentFor(ev) || undefined,
      kind: 'tool',
      name: ev.tool ?? 'tool',
      arg: ev.arg ?? '',
      status: 'run',
      start: ev.t,
    })
    node.status = ev.kind === 'tool_fail' ? 'err' : 'ok'
    node.end = ev.t
    Object.assign(node, texts(ev, 'output'))
  }

  private agentStart(ev: Ev): void {
    this.ensureRoot(ev.t)
    const spawn = this.spawns.shift()
    const name = ev.agentType ?? spawn?.type ?? 'subagent'
    const known = ev.agentId ? this.agents.get(ev.agentId) : undefined
    const existing = known ? this.byId.get(known) : undefined
    if (existing) {
      // Its first call came before its start: name it now.
      existing.name = name
      if (ev.transcript) existing.transcript = ev.transcript
      existing.arg = spawn?.arg ?? existing.arg
      Object.assign(existing, spawn?.input)
      return
    }
    const parent =
      spawn?.agentId && this.agents.has(spawn.agentId)
        ? (this.agents.get(spawn.agentId) as string)
        : this.root
    const node = this.add({
      id: ev.agentId ? `a:${ev.agentId}` : undefined,
      parent,
      kind: 'agent',
      name,
      arg: spawn?.arg ?? '',
      status: 'run',
      start: ev.t,
      ...(ev.transcript ? { transcript: ev.transcript } : {}),
      ...spawn?.input,
    })
    if (ev.agentId) this.agents.set(ev.agentId, node.id)
    else this.pending.push(node.id)
  }

  private agentStop(ev: Ev): void {
    this.ensureRoot(ev.t)
    let node = ev.agentId ? this.byId.get(this.agents.get(ev.agentId) ?? '') : undefined
    if (!node) {
      // No id seen so far: it is the oldest waiting of its type, else the oldest.
      const at = this.pending.findIndex(id => this.byId.get(id)?.name === ev.agentType)
      const id = this.pending.splice(at < 0 ? 0 : at, 1)[0]
      node = id ? this.byId.get(id) : undefined
      if (node && ev.agentId) this.agents.set(ev.agentId, node.id)
    }
    node ??= this.add({
      id: ev.agentId ? `a:${ev.agentId}` : undefined,
      parent: this.root,
      kind: 'agent',
      name: ev.agentType ?? 'subagent',
      arg: '',
      status: 'run',
      start: ev.t,
    })
    const below = new Set([node.id])
    for (const n of this.nodes) if (n.parent && below.has(n.parent)) below.add(n.id)
    for (const n of this.nodes) {
      if (n.id === node.id || !below.has(n.id) || n.status !== 'run') continue
      n.end = ev.t
      n.status = n.kind === 'tool' ? 'err' : 'ok'
      if (n.kind === 'tool' && !n.output) n.output = '(no result recorded)'
    }
    node.status = 'ok'
    node.end = ev.t
    if (ev.transcript) node.transcript = ev.transcript
    Object.assign(node, texts(ev, 'output'))
  }
}

/** Every session the log holds. */
export class Model {
  sessions = new Map<string, Session>()

  apply(ev: Ev): Session {
    let s = this.sessions.get(ev.sid)
    if (!s) this.sessions.set(ev.sid, (s = new Session(ev.sid)))
    s.apply(ev)
    return s
  }

  /** Sessions newest first, those of the folders given (all when none). */
  list(folders: string[] = []): Session[] {
    const within = (s: Session) =>
      folders.length === 0 ||
      !s.cwd ||
      folders.some(f => s.cwd === f || s.cwd?.startsWith(f + '/') || s.cwd?.startsWith(f + '\\') || f.startsWith(s.cwd + '/'))
    return [...this.sessions.values()].filter(within).sort((a, b) => b.lastT - a.lastT)
  }

  remove(id: string): void {
    this.sessions.delete(id)
  }
}
