/**
 * The hook script. Claude Code runs it as a command hook, once per event, with the event's
 * JSON on stdin and the event's name as argv[2]:
 *
 *     node record.cjs PreToolUse < payload.json
 *
 * It appends one normalized line to the session's event log and prints nothing, which for a
 * hook is "no decision": the work goes on as it would have. It never blocks or denies, and
 * swallows every error. Keep this file free of imports from the extension: it is copied on
 * its own to ~/.claude/ai-call-stack-vscode/record.cjs.
 */
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import type { Ev, EvKind, Touch } from './types'

/** What the log keeps of one text. Longer text goes whole to a file. */
export const KEEP = 8000
/** What a spilled file keeps. */
export const FILE_MAX = 1_000_000
const RETENTION_MS = 14 * 24 * 3600 * 1000

type Rec = Record<string, unknown>

export const dataDir = (): string =>
  process.env.AI_CALL_STACK_CLAUDE_DIR || path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'ai-call-stack-vscode')

export const clip = (s: string, n: number): string => {
  const one = s.replace(/\s+/g, ' ').trim()
  if (n <= 0) return ''
  return one.length > n ? one.slice(0, Math.max(1, n - 1)) + '…' : one
}

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)
const first = (o: Rec, ...keys: string[]): unknown => {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k]
  return undefined
}

// The most telling argument of a tool call, whatever the tool.
const KEYS = [
  'command',
  'filePath',
  'file_path',
  'path',
  'pattern',
  'query',
  'url',
  'description',
  'prompt',
  'input',
]
export const summarize = (e: Rec): string => {
  for (const k of KEYS) {
    const v = e[k]
    if (typeof v === 'string' && v) return clip(v, 160)
  }
  return ''
}

// A call's arguments as a person reads them: `key: value`, and a long or
// multi-line value on lines of its own, as it is, not as an escaped string.
export const describe = (e: Rec): string =>
  Object.keys(e)
    .filter(k => e[k] !== undefined)
    .map(k => {
      const v = e[k]
      if (typeof v === 'string' && (v.includes('\n') || v.length > 80)) return `${k}:\n${v}`
      return `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`
    })
    .join('\n')

/** Arguments arrive as an object, or as a JSON string of one. */
export const parseArgs = (v: unknown): Rec => {
  if (isRec(v)) return v
  if (typeof v === 'string' && v.trim()) {
    try {
      const j: unknown = JSON.parse(v)
      if (isRec(j)) return j
    } catch {
      // Not JSON: keep it as the one argument it is.
    }
    return { input: v }
  }
  return {}
}

/** A tool's result as text, whatever shape the host gave it. */
export const resultText = (v: unknown): string => {
  if (v === undefined || v === null) return ''
  if (typeof v === 'string') return v
  if (Array.isArray(v)) {
    const parts = v.map(x => (isRec(x) ? str(x.text) ?? str(x.value) : typeof x === 'string' ? x : undefined))
    if (parts.every(p => p !== undefined)) return parts.join('\n')
    return JSON.stringify(v)
  }
  if (isRec(v)) {
    // A shell's result: what it printed, and what it said on the error stream.
    if (typeof v.stdout === 'string' || typeof v.stderr === 'string') {
      return [str(v.stdout), str(v.stderr)].filter(Boolean).join('\n')
    }
    // A file read: its content.
    if (isRec(v.file) && typeof v.file.content === 'string') return v.file.content
    for (const k of ['text', 'content', 'output', 'result']) {
      const inner = v[k]
      if (inner !== undefined && inner !== null) return resultText(inner)
    }
    return JSON.stringify(v)
  }
  return String(v)
}

// The argument names tools use for the files they take, across the tools of both agents.
const PATH_KEYS = new Set([
  'file_path',
  'filePath',
  'notebook_path',
  'notebookPath',
  'path',
  'file',
  'filepath',
  'uri',
  'paths',
  'files',
  'filePaths',
])

const oneLine = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() && !v.includes('\n') && v.length <= 400 ? v.replace(/^file:\/\//, '') : undefined

// Every file path a call was given, however deep the tool nests them (an edit list, a list of files).
const pathsIn = (args: Rec): string[] => {
  const out: string[] = []
  const walk = (v: unknown, named: boolean, depth: number) => {
    if (depth > 3) return
    if (Array.isArray(v)) return v.forEach(x => walk(x, named, depth + 1))
    if (isRec(v)) {
      for (const [k, x] of Object.entries(v)) walk(x, PATH_KEYS.has(k), depth + 1)
      return
    }
    const s = named ? oneLine(v) : undefined
    if (s) out.push(s)
  }
  for (const [k, v] of Object.entries(args)) walk(v, PATH_KEYS.has(k), 0)
  return [...new Set(out)]
}

// What a search looked for: the first of these arguments that is a line of text.
const WHAT = ['pattern', 'query', 'glob', 'includePattern', 'url', 'prompt']
const whatOf = (args: Rec): string => {
  for (const k of WHAT) {
    const v = args[k]
    if (typeof v === 'string' && v.trim()) return clip(v, 200)
    if (Array.isArray(v) && typeof v[0] === 'string') return clip(v.join(' '), 200)
  }
  return ''
}

/** The lines one call added to a file and took out of it, as far as its arguments say. */
export type Change = { path: string; added: number; removed: number }

// A text as lines: no line for an empty text, and a last newline ends a line rather than starting one.
const linesOf = (s: string): string[] => (s === '' ? [] : s.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n'))

// The lines two texts differ by: what they share at the start and at the end is not counted.
const diffCount = (before: string, after: string): { added: number; removed: number } => {
  const a = linesOf(before)
  const b = linesOf(after)
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++
  return { removed: a.length - head - tail, added: b.length - head - tail }
}

// The arguments that hold a text before and after, across the tools of the agents.
const PAIRS: [string, string][] = [
  ['old_string', 'new_string'],
  ['oldString', 'newString'],
  ['old_str', 'new_str'],
  ['oldText', 'newText'],
]
// The arguments that hold a text written whole: a file's content, a notebook cell, the code an edit inserts.
const WRITTEN = ['content', 'file_text', 'new_source', 'newSource', 'code']
// What Copilot's edit tool puts where the file stays as it is.
const KEPT = /^\s*(\/\/|#|\/\*|<!--|--)?\s*\.\.\.\s*existing (code|content)\b/i

const firstPath = (r: Record<string, unknown>): string | undefined => {
  for (const k of PATH_KEYS) {
    const s = oneLine(r[k])
    if (s) return s
  }
  return undefined
}

// A patch in a text: Copilot's `*** Begin Patch` blocks, or a unified diff. Its lines by file.
const patchChanges = (text: string): Change[] => {
  const out = new Map<string, Change>()
  const lines = text.split('\n')
  const isBlocks = lines.some(l => l.startsWith('*** Begin Patch'))
  let cur: Change | undefined
  const open = (path: string) => {
    const p = path.trim().replace(/^[ab]\//, '')
    cur = out.get(p) ?? { path: p, added: 0, removed: 0 }
    out.set(p, cur)
  }
  lines.forEach((line, i) => {
    const block = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/.exec(line)
    if (isBlocks) {
      if (block) return open(block[1]!)
      if (!cur || line.startsWith('***')) return
    } else {
      if (line.startsWith('--- ') && lines[i + 1]?.startsWith('+++ ')) return
      if (line.startsWith('+++ ')) return open(line.slice(4).split('\t')[0]!)
      if (!cur || line.startsWith('@@')) return
    }
    if (line.startsWith('+')) cur.added++
    else if (line.startsWith('-')) cur.removed++
  })
  return [...out.values()].filter(c => c.added || c.removed)
}

// A patch the call carries.
const patchesIn = (args: Record<string, unknown>): Change[] =>
  ['input', 'patch', 'diff'].flatMap(k => {
    const v = args[k]
    return typeof v === 'string' && (v.includes('*** Begin Patch') || /^--- .*\n\+\+\+ /m.test(v)) ? patchChanges(v) : []
  })

/**
 * The lines a call that changes files added and removed, per file, from its arguments: a text and
 * what replaced it (an edit, a list of them), a text written whole, a patch. A text written whole
 * counts as added only: what the file held before is not in the call.
 */
export const changesOf = (args: Record<string, unknown>, paths: string[]): Change[] => {
  const out = new Map<string, Change>()
  const add = (path: string | undefined, added: number, removed: number) => {
    if (!path || (!added && !removed)) return
    const c = out.get(path) ?? { path, added: 0, removed: 0 }
    c.added += added
    c.removed += removed
    out.set(path, c)
  }
  const walk = (v: unknown, inherited: string | undefined, depth: number) => {
    if (depth > 3) return
    if (Array.isArray(v)) return v.forEach(x => walk(x, inherited, depth + 1))
    if (!isRec(v)) return
    const own = firstPath(v) ?? inherited
    for (const [from, to] of PAIRS) {
      const a = v[from]
      const b = v[to]
      if (typeof a === 'string' && typeof b === 'string') {
        const d = diffCount(a, b)
        add(own, d.added, d.removed)
      }
    }
    for (const k of WRITTEN) {
      const s = v[k]
      if (typeof s === 'string') add(own, linesOf(s).filter(l => !KEPT.test(l)).length, 0)
    }
    for (const x of Object.values(v)) walk(x, own, depth + 1)
  }
  walk(args, paths.length === 1 ? paths[0] : undefined, 0)
  for (const p of patchesIn(args)) add(p.path, p.added, p.removed)
  return [...out.values()]
}

// The addresses a call was given to fetch.
const linksIn = (args: Record<string, unknown>): string[] => {
  const out: string[] = []
  const take = (v: unknown) => {
    if (typeof v === 'string' && /^https?:\/\//i.test(v.trim()) && !v.includes('\n') && v.length <= 2000) out.push(v.trim())
  }
  take(args.url)
  if (Array.isArray(args.urls)) args.urls.forEach(take)
  return [...new Set(out)]
}

/**
 * What a tool call touched, read from its arguments: the files it was given, the command it ran,
 * the address it fetched, what it searched for. By the tool's name and the shape of its arguments,
 * so that it works for tools it has not seen. Undefined for a call that touched none of these.
 */
export const touchOf = (tool: string, args: Rec): Touch | undefined => {
  const name = tool.toLowerCase()
  if (typeof args.command === 'string' && args.command.trim()) return { op: 'run', paths: [], what: args.command }
  if (/web_?fetch|web_?search|fetch_webpage/.test(name) || typeof args.url === 'string' || Array.isArray(args.urls)) {
    const links = linksIn(args)
    return links.length ? { op: 'web', paths: [], what: whatOf(args), links } : { op: 'web', paths: [], what: whatOf(args) }
  }
  if (/grep|glob|search|find|(^|_)ls$|list/.test(name)) return { op: 'search', paths: pathsIn(args), what: whatOf(args) }
  let paths = pathsIn(args)
  // A patch names its files itself.
  if (!paths.length) paths = patchesIn(args).map(c => c.path)
  if (!paths.length) return undefined
  const op = /(^|[_-])(read|view|open|cat)([_-]|$)/.test(name)
    ? 'read'
    : /create|write|new_file/.test(name)
      ? 'write'
      : /edit|replace|insert|patch|apply|notebook|rename|move|delete|remove/.test(name)
        ? 'edit'
        : 'other'
  if (op !== 'edit' && op !== 'write') return { op, paths }
  const changes = changesOf(args, paths)
  return changes.length ? { op, paths, changes } : { op, paths }
}

// Tools that start a subagent. The subagent is drawn from its own start event;
// this call only lends it a description and a prompt.
const SPAWN_TOOLS = new Set(['runsubagent', 'run_subagent', 'agent', 'task'])
export const isSpawnTool = (name: string | undefined): boolean =>
  !!name && SPAWN_TOOLS.has(name.toLowerCase())

// What the API calls an error, as a person says it.
const FAILURES: Record<string, string> = {
  authentication_failed: 'sign-in failed',
  oauth_org_not_allowed: 'organization not allowed',
  account_on_hold: 'account on hold',
  verification_required: 'verification required',
  billing_error: 'billing error',
  rate_limit: 'rate limited',
  overloaded: 'API overloaded',
  invalid_request: 'invalid request',
  model_not_found: 'model not found',
  server_error: 'server error',
  max_output_tokens: 'hit the output limit',
  cloud_credential_error: 'cloud credentials failed',
}
export const failureWord = (error: string): string => FAILURES[error] ?? error.replace(/_/g, ' ')

const KINDS: Record<string, EvKind> = {
  sessionstart: 'session_start',
  sessionend: 'session_end',
  userpromptsubmit: 'prompt',
  stop: 'stop',
  stopfailure: 'stop_fail',
  pretooluse: 'tool_pre',
  posttooluse: 'tool_post',
  posttoolusefailure: 'tool_fail',
  permissionrequest: 'perm_ask',
  permissiondenied: 'perm_denied',
  subagentstart: 'agent_start',
  subagentstop: 'agent_stop',
  precompact: 'compact',
  postcompact: 'compact_end',
}

const fingerprint = (tool: string, args: Rec): string =>
  crypto.createHash('sha1').update(`${tool}\0${JSON.stringify(args)}`).digest('hex').slice(0, 12)

/**
 * One hook payload to one log event, or null for an event not drawn. Pure:
 * texts are whole here, `spill` cuts them. Claude Code's payloads are snake_case.
 */
export const normalize = (event: string, p: Rec, now: number): Ev | null => {
  const name = event || str(p.hook_event_name) || ''
  let kind = KINDS[name.toLowerCase()]
  if (!kind) return null

  const agentId = str(p.agent_id)
  // A Stop that happens inside a subagent ends the subagent, not the prompt.
  if (kind === 'stop' && agentId) kind = 'agent_stop'

  const ev: Ev = { v: 1, t: now, sid: str(p.session_id) ?? 'unknown', kind }
  const cwd = str(p.cwd)
  if (cwd) ev.cwd = cwd
  if (agentId) ev.agentId = agentId
  // Every payload names the session's transcript.
  const transcript = str(p.transcript_path)
  if (transcript) ev.transcript = transcript
  const type = str(p.agent_type)
  if (type) ev.agentType = type

  switch (kind) {
    case 'prompt': {
      const text = str(p.prompt) ?? ''
      ev.arg = clip(text || '(continued turn)', 160)
      ev.input = text
      break
    }
    case 'session_start':
    case 'session_end': {
      const reason = str(p.reason) ?? str(p.source)
      if (reason) ev.reason = reason
      break
    }
    case 'stop_fail': {
      // `error` is a kind (`rate_limit`, `overloaded`...); the details say more.
      const error = str(p.error) ?? 'error'
      const details = str(p.error_details)
      ev.reason = error
      ev.arg = clip(details ? `${failureWord(error)}: ${details}` : failureWord(error), 160)
      const answer = str(p.last_assistant_message)
      if (answer) ev.output = answer
      break
    }
    case 'compact': {
      const trigger = str(p.trigger)
      if (trigger) ev.reason = trigger
      ev.arg = trigger ?? ''
      const instructions = str(p.custom_instructions)
      if (instructions) ev.input = instructions
      break
    }
    case 'compact_end': {
      const trigger = str(p.trigger)
      if (trigger) ev.reason = trigger
      const summary = str(p.compact_summary)
      if (summary) ev.output = summary
      break
    }
    case 'stop':
    case 'agent_stop': {
      const answer = str(p.last_assistant_message)
      if (answer) ev.output = answer
      // A subagent has a transcript of its own.
      const own = str(p.agent_transcript_path)
      if (own) ev.agentTranscript = own
      break
    }
    case 'agent_start':
      break
    case 'perm_ask':
    case 'perm_denied':
    case 'tool_pre':
    case 'tool_post':
    case 'tool_fail': {
      const tool = str(p.tool_name) ?? 'tool'
      const args = parseArgs(p.tool_input)
      ev.tool = tool
      ev.fp = fingerprint(tool, args)
      const id = str(p.tool_use_id)
      if (id) ev.toolUseId = id
      if (kind === 'perm_ask') break
      if (kind === 'perm_denied') {
        const reason = str(p.reason)
        if (reason) ev.reason = reason
        break
      }

      if (isSpawnTool(tool)) {
        ev.arg = clip(String(args.description ?? args.name ?? ''), 160)
        const sub = str(first(args, 'subagent_type', 'agentName', 'agent_name', 'agent'))
        if (sub) ev.agentType = sub
        if (kind === 'tool_pre') ev.input = String(args.prompt ?? describe(args))
      } else {
        ev.arg = summarize(args)
        if (kind === 'tool_pre') {
          ev.input = describe(args)
          const touch = touchOf(tool, args)
          if (touch) ev.touch = touch
        }
      }
      if (kind === 'tool_post') ev.output = resultText(p.tool_response)
      if (kind === 'tool_fail') {
        const err = first(p, 'error', 'tool_response')
        ev.output = isRec(err) ? (str(err.message) ?? resultText(err)) : resultText(err)
      }
      // How long the tool itself ran: the person's answer and the hooks are not in it.
      if (typeof p.duration_ms === 'number' && Number.isFinite(p.duration_ms)) ev.durationMs = Math.max(0, p.duration_ms)
      break
    }
    default:
      break
  }
  return ev
}

const safe = (s: string) => s.replace(/[^\w.-]/g, '_')

/**
 * Keeps a text in the event up to KEEP characters; a longer one is also
 * written whole to a file whose path the event carries. A file that cannot be
 * written leaves the cut text, which says so.
 */
export const spill = (ev: Ev, dir: string): Ev => {
  for (const which of ['input', 'output'] as const) {
    const text = ev[which]
    if (text === undefined) continue
    ev[`${which}Len`] = text.length
    if (text.length <= KEEP) continue
    ev[which] = text.slice(0, KEEP)
    try {
      const file = path.join(
        dir,
        'blobs',
        `${safe(ev.sid)}.${ev.t}.${crypto.randomBytes(3).toString('hex')}.${which}.txt`,
      )
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, text.slice(0, FILE_MAX))
      ev[`${which}File`] = file
    } catch {
      // The cut text stands.
    }
  }
  return ev
}

const prune = (dir: string, now: number) => {
  for (const sub of ['events', 'blobs']) {
    try {
      const d = path.join(dir, sub)
      for (const f of fs.readdirSync(d)) {
        const file = path.join(d, f)
        if (now - fs.statSync(file).mtimeMs > RETENTION_MS) fs.rmSync(file, { force: true })
      }
    } catch {
      // Nothing to prune.
    }
  }
}

export const append = (ev: Ev, dir: string) => {
  const events = path.join(dir, 'events')
  fs.mkdirSync(events, { recursive: true })
  fs.appendFileSync(path.join(events, `${safe(ev.sid)}.jsonl`), JSON.stringify(ev) + '\n')
}

export const main = () => {
  const event = process.argv[2] ?? ''
  try {
    let raw = ''
    try {
      raw = fs.readFileSync(0, 'utf8')
    } catch {
      // No stdin: record what there is.
    }
    const parsed: unknown = raw.trim() ? JSON.parse(raw) : {}
    const ev = normalize(event, isRec(parsed) ? parsed : {}, Date.now())
    if (ev) {
      const dir = dataDir()
      append(spill(ev, dir), dir)
      if (ev.kind === 'session_start') prune(dir, ev.t)
    }
  } catch {
    // Recording is best effort.
  }
  // No output is "no decision": the work goes on as it would have.
}

if (require.main === module) main()
