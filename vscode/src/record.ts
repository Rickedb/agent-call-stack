/**
 * The hook script. VS Code / GitHub Copilot runs it as a command hook, once per
 * event, with the event's JSON on stdin and the event's name as argv[2]:
 *
 *     node record.cjs PreToolUse < payload.json
 *
 * It appends one normalized line to the session's event log and prints `{}`.
 * It must never get in the way of the work: it never denies, never blocks, and
 * swallows every error. Keep this file free of imports from the extension: it
 * is copied on its own to ~/.copilot/ai-call-tree/record.cjs.
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
  process.env.AI_CALL_TREE_DIR || path.join(os.homedir(), '.copilot', 'ai-call-tree')

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

// The most telling argument of a tool call, whatever the tool. Copilot's tools
// name them differently from one another, so the list is long.
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
    for (const k of [
      'text_result_for_llm',
      'textResultForLlm',
      'text',
      'content',
      'output',
      'stdout',
      'result',
    ]) {
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

/**
 * What a tool call touched, read from its arguments: the files it was given, the command it ran,
 * the address it fetched, what it searched for. By the tool's name and the shape of its arguments,
 * so that it works for tools it has not seen. Undefined for a call that touched none of these.
 */
export const touchOf = (tool: string, args: Rec): Touch | undefined => {
  const name = tool.toLowerCase()
  if (typeof args.command === 'string' && args.command.trim()) return { op: 'run', paths: [], what: args.command }
  if (/web_?fetch|web_?search|fetch_webpage/.test(name) || typeof args.url === 'string' || Array.isArray(args.urls)) {
    return { op: 'web', paths: [], what: whatOf(args) }
  }
  if (/grep|glob|search|find|(^|_)ls$|list/.test(name)) return { op: 'search', paths: pathsIn(args), what: whatOf(args) }
  const paths = pathsIn(args)
  if (!paths.length) return undefined
  if (/(^|[_-])(read|view|open|cat)([_-]|$)/.test(name)) return { op: 'read', paths }
  if (/create|write|new_file/.test(name)) return { op: 'write', paths }
  if (/edit|replace|insert|patch|apply|notebook|rename|move|delete|remove/.test(name)) return { op: 'edit', paths }
  return { op: 'other', paths }
}

// Tools that start a subagent. The subagent is drawn from its own start event;
// this call only lends it a description and a prompt.
const SPAWN_TOOLS = new Set(['runsubagent', 'run_subagent', 'agent', 'task'])
export const isSpawnTool = (name: string | undefined): boolean =>
  !!name && SPAWN_TOOLS.has(name.toLowerCase())

const KINDS: Record<string, EvKind> = {
  sessionstart: 'session_start',
  sessionend: 'session_end',
  userpromptsubmit: 'prompt',
  userpromptsubmitted: 'prompt',
  stop: 'stop',
  agentstop: 'stop',
  pretooluse: 'tool_pre',
  posttooluse: 'tool_post',
  posttoolusefailure: 'tool_fail',
  subagentstart: 'agent_start',
  subagentstop: 'agent_stop',
  erroroccurred: 'error',
  precompact: 'compact',
}

// The chat's own commands are not work worth drawing.
const SELF = /^\s*(@calltree|\/call-tree)\b/i

const fingerprint = (tool: string, args: Rec): string =>
  crypto.createHash('sha1').update(`${tool}\0${JSON.stringify(args)}`).digest('hex').slice(0, 12)

/**
 * One hook payload to one log event, or null for an event not drawn. Pure:
 * texts are whole here, `spill` cuts them.
 */
export const normalize = (event: string, p: Rec, now: number): Ev | null => {
  const name = event || str(first(p, 'hook_event_name', 'hookEventName')) || ''
  let kind = KINDS[name.toLowerCase()]
  if (!kind) return null

  const agentId = str(first(p, 'agent_id', 'agentId'))
  // A Stop that happens inside a subagent ends the subagent, not the prompt.
  if (kind === 'stop' && agentId) kind = 'agent_stop'

  const ev: Ev = {
    v: 1,
    t: now,
    sid: str(first(p, 'session_id', 'sessionId', 'sessionID')) ?? 'unknown',
    kind,
  }
  const cwd = str(p.cwd)
  if (cwd) ev.cwd = cwd
  if (agentId) ev.agentId = agentId
  // Only some events carry it: a turn's end, a subagent's start and stop, a compaction.
  const transcript = str(first(p, 'transcript_path', 'transcriptPath'))
  if (transcript) ev.transcript = transcript
  const parent = str(first(p, 'parent_agent_id', 'parentAgentId'))
  if (parent) ev.parentAgentId = parent
  const type = str(first(p, 'agent_type', 'agentType', 'agent_name', 'agentName'))
  if (type) ev.agentType = type

  switch (kind) {
    case 'prompt': {
      const text = str(p.prompt) ?? ''
      if (SELF.test(text)) return null
      ev.arg = clip(text || '(continued turn)', 160)
      ev.input = text
      break
    }
    case 'session_end': {
      const reason = str(p.reason)
      if (reason) ev.reason = reason
      break
    }
    case 'error': {
      // `error` is an object (message, name, stack), or only a string.
      const err = p.error
      const message = isRec(err) ? (str(err.message) ?? '') : (str(err) ?? '')
      const name = isRec(err) ? str(err.name) : undefined
      const stack = isRec(err) ? str(err.stack) : undefined
      const context = str(first(p, 'error_context', 'errorContext'))
      const recoverable = first(p, 'recoverable')
      ev.arg = clip(message || name || 'error', 160)
      if (context) ev.reason = context
      ev.output = [
        name && message ? `${name}: ${message}` : message || name || '',
        context ? `context: ${context}` : '',
        typeof recoverable === 'boolean' ? `recoverable: ${recoverable ? 'yes' : 'no'}` : '',
        stack ?? '',
      ]
        .filter(Boolean)
        .join('\n')
      break
    }
    case 'compact': {
      const trigger = str(p.trigger)
      if (trigger) ev.reason = trigger
      ev.arg = trigger ?? ''
      const instructions = str(first(p, 'custom_instructions', 'customInstructions'))
      if (instructions) ev.input = instructions
      break
    }
    case 'stop':
    case 'agent_stop': {
      const answer = str(first(p, 'last_assistant_message', 'response', 'answer'))
      if (answer) ev.output = answer
      break
    }
    case 'tool_pre':
    case 'tool_post':
    case 'tool_fail': {
      const tool = str(first(p, 'tool_name', 'toolName')) ?? 'tool'
      const args = parseArgs(first(p, 'tool_input', 'toolArgs', 'toolInput'))
      ev.tool = tool
      ev.fp = fingerprint(tool, args)
      const id = str(first(p, 'tool_use_id', 'toolUseId', 'tool_call_id', 'toolCallId'))
      if (id) ev.toolUseId = id

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
      if (kind === 'tool_post') {
        ev.output = resultText(first(p, 'tool_response', 'tool_result', 'toolResult', 'toolResponse'))
      }
      if (kind === 'tool_fail') {
        const err = first(p, 'error', 'tool_response', 'tool_result')
        ev.output = isRec(err) ? str(err.message) ?? resultText(err) : resultText(err)
      }
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
  // An empty answer is "no decision": the work goes on as it would have.
  process.stdout.write('{}')
}

if (require.main === module) main()
