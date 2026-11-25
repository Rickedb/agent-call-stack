import { historyNodes, type HistPrompt } from './history'
import type { Ev, EvKind, Node } from './types'

// A prompt's thinking and replies are a row each, between its calls.
export const MAX_NODES = 800

/** What the prompt is called that the hooks began in the middle of, before the transcript says what it was. */
const EARLIER = '(earlier activity)'

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
 * What a finished call changes about its row beyond its status and text. A call the person was asked
 * about waited for the answer, and that wait is not the tool's time: the row is drawn from when the tool
 * ran (`perm.ran`, which Claude Code reports), and says how long it waited. An ask that failed with no
 * run was not allowed.
 */
export const settle = (was: Node, failed: boolean, end: number): Partial<Node> => {
  const perm = was.perm
  if (perm?.decision !== 'ask') return {}
  if (perm.ran !== undefined) {
    return {
      start: Math.max(was.start, end - perm.ran),
      perm: { ...perm, waited: Math.max(0, end - was.start - perm.ran) },
    }
  }
  return failed ? { perm: { ...perm, refused: true } } : {}
}

/**
 * One chat session's calls, built up from its events in the order they came.
 *
 * Claude Code gives every tool call an id, and a subagent's id on its start, so
 * calls and subagents pair exactly. The pairing by what a call was given stays for a
 * result whose call was not seen (hooks installed while it ran), and for a permission
 * request, which names the tool and its arguments but not the call.
 */
export class Session {
  nodes: Node[] = []
  root = ''
  cwd?: string
  /** The session's transcript file, from the hooks' payloads. */
  transcript?: string
  firstT = 0
  lastT = 0
  /** True once what came before the hooks was read back from the transcript. */
  historyDone = false
  private firstKind?: EvKind

  private byId = new Map<string, Node>()
  private seq = 0
  /** Calls without a result yet, by id or by what they were given: oldest first. */
  private open = new Map<string, string[]>()
  /** Calls by what they were given, oldest first: a permission request names no call. */
  private byFp = new Map<string, string[]>()
  /** The compaction now running. */
  private compacting?: string
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

  /**
   * Where the hooks' own record begins: what is earlier is history. A prompt that is the first event is
   * received a moment before its hook runs, so the line is drawn a little before it.
   */
  historyCut(): number {
    return this.firstKind === 'prompt' ? this.firstT - 3000 : this.firstT
  }

  /**
   * Puts what the transcript says came before the hooks at the start of the tree, once. A prompt the
   * hooks began in the middle of (it shows as "earlier activity") is the last of them: it takes its
   * words and its earlier calls, and keeps what the hooks saw of the rest.
   */
  adoptHistory(history: HistPrompt[]): void {
    if (this.historyDone) return
    this.historyDone = true
    // A call the hooks saw as well stays as they drew it.
    const rows = historyNodes(history, Math.max(20, MAX_NODES - this.nodes.length)).filter(n => !this.byId.has(n.id))
    const placeholder = this.nodes.find(n => n.kind === 'prompt' && n.arg === EARLIER)
    const last = [...rows].reverse().find(n => n.kind === 'prompt')
    if (placeholder && last && last.start <= placeholder.start) {
      for (const n of this.nodes) if (n.parent === placeholder.id) n.parent = last.id
      Object.assign(last, {
        status: placeholder.status,
        end: placeholder.end,
        output: placeholder.output ?? last.output,
        outputLen: placeholder.outputLen ?? last.outputLen,
        transcript: placeholder.transcript,
      })
      delete last.hist
      this.nodes = this.nodes.filter(n => n !== placeholder)
      this.byId.delete(placeholder.id)
      if (this.root === placeholder.id) this.root = last.id
    }
    this.nodes = [...rows, ...this.nodes]
    for (const n of rows) this.byId.set(n.id, n)
  }

  /**
   * Adds the notes the transcript has (what the model wrote between calls) that are not rows yet; one whose
   * prompt or subagent is not in the tree is left out. Calling it again with the same notes changes nothing.
   */
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
    if (!this.firstT) {
      this.firstT = ev.t
      this.firstKind = ev.kind
    }
    this.lastT = Math.max(this.lastT, ev.t)
    if (ev.cwd && !this.cwd) this.cwd = ev.cwd
    if (ev.transcript) this.transcript = ev.transcript

    switch (ev.kind) {
      case 'prompt':
        return this.prompt(ev)
      case 'stop':
        return this.stop(ev)
      case 'session_end':
        return this.sessionEnd(ev)
      case 'stop_fail':
        return this.stopFail(ev)
      case 'compact':
        return this.compact(ev)
      case 'compact_end':
        return this.compactEnd(ev)
      case 'perm_ask':
        return this.permAsk(ev)
      case 'perm_denied':
        return this.permDenied(ev)
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
      arg: EARLIER,
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
      // A call the person was asked about, that never ran: they did not allow it.
      if (n.kind === 'tool' && n.perm?.decision === 'ask') n.perm = { ...n.perm, refused: true }
    }
    Object.assign(top, out)
    if (why) top.why = why
    this.open.clear()
    this.pending = []
  }

  // A session that ends while a prompt runs ends the prompt, badly: it did not get its answer.
  private sessionEnd(ev: Ev): void {
    this.finishRoot(ev.t, 'err', {}, 'session ended')
  }

  // The turn ended on an API error instead of an answer: the prompt failed, with the reason.
  private stopFail(ev: Ev): void {
    this.ensureRoot(ev.t)
    this.finishRoot(ev.t, 'err', texts(ev, 'output'), ev.arg || 'API error')
  }

  // A compaction runs from its PreCompact to its PostCompact. It sits under what was running.
  private compact(ev: Ev): void {
    this.ensureRoot(ev.t)
    this.compacting = this.add({
      parent: this.parentFor(ev) || undefined,
      kind: 'event',
      name: 'Compact',
      arg: ev.arg ?? '',
      status: 'run',
      start: ev.t,
      compact: { trigger: ev.reason ?? '' },
      ...texts(ev, 'input'),
    }).id
  }

  // ...and ends with the summary it left. One with no start seen is an instant.
  private compactEnd(ev: Ev): void {
    const row = this.compacting ? this.byId.get(this.compacting) : undefined
    this.compacting = undefined
    if (row) {
      row.status = 'ok'
      row.end = ev.t
      Object.assign(row, texts(ev, 'output'))
      return
    }
    this.ensureRoot(ev.t)
    this.add({
      parent: this.parentFor(ev) || undefined,
      kind: 'event',
      name: 'Compact',
      arg: ev.reason ?? '',
      status: 'ok',
      start: ev.t,
      end: ev.t,
      compact: { trigger: ev.reason ?? '' },
      ...texts(ev, 'output'),
    })
  }

  // The person is about to be asked whether a call may run. The request names the tool and its
  // arguments, not the call: it is the oldest running call that was given the same.
  private permAsk(ev: Ev): void {
    const ids = this.byFp.get(`${ev.agentId ?? ''}:${ev.fp ?? ''}`) ?? []
    const node = ids.map(id => this.byId.get(id)).find(n => n && n.status === 'run' && !n.perm)
    if (node) node.perm = { decision: 'ask' }
  }

  // A classifier refused a call it was asked about: it fails now, with the reason it gave.
  private permDenied(ev: Ev): void {
    const node = ev.toolUseId ? this.byId.get(`t:${ev.toolUseId}`) : undefined
    if (!node) return
    node.perm = { decision: node.perm?.decision ?? 'ask', reason: ev.reason, refused: true }
    node.status = 'err'
    node.end = ev.t
    node.output = `denied${ev.reason ? `: ${ev.reason}` : ''}`
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
    const fp = `${ev.agentId ?? ''}:${ev.fp ?? ''}`
    this.byFp.set(fp, [...(this.byFp.get(fp) ?? []), node.id])
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
    const failed = ev.kind === 'tool_fail'
    node.status = failed ? 'err' : 'ok'
    node.end = ev.t
    Object.assign(node, texts(ev, 'output'))
    // The tool's own time, which a call that waited for the person's answer needs to tell its wait.
    if (ev.durationMs !== undefined && node.perm?.decision === 'ask') node.perm = { ...node.perm, ran: ev.durationMs }
    Object.assign(node, settle(node, failed, ev.t))
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
    if (ev.agentTranscript) node.transcript = ev.agentTranscript
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
