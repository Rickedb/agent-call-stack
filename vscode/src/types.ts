/** What a tool call touched, read from its arguments. */
export type Touch = {
  /** `read`, `edit` (change a file) and `write` (create or replace one) touch files; `run` a command; `search` and `web` look something up. */
  op: 'read' | 'edit' | 'write' | 'other' | 'run' | 'search' | 'web'
  /** The files it was given (for a search, where it looked). */
  paths: string[]
  /** The command it ran, the address it fetched, what it searched for. */
  what?: string
  /** For a fetch: the addresses it was given. */
  links?: string[]
  /** For an edit or a write: the lines it added to each file and took out of it, from its arguments. */
  changes?: { path: string; added: number; removed: number }[]
}

/** One row of the tree: a prompt, a subagent, or a tool call. */
export type Node = {
  id: string
  parent?: string
  kind: 'prompt' | 'agent' | 'tool' | 'event'
  /** The short name: a tool's, an agent's type, `Prompt`. */
  name: string
  /** What it was given, in a few words: a command, a path, a task. */
  arg: string
  status: 'run' | 'ok' | 'err'
  start: number
  end?: number
  /** What the call was given, as text; cut at a limit, the whole in `inputFile`. */
  input?: string
  /** What came back, as text; cut at a limit, the whole in `outputFile`. */
  output?: string
  /** The length of the whole input and output, in characters. */
  inputLen?: number
  outputLen?: number
  /** Where the whole text went when it was cut: a file the recorder wrote. */
  inputFile?: string
  outputFile?: string
  /** The model a prompt was sent to, read from VS Code's chat log (the hooks carry none). */
  model?: string
  /** Why a prompt, a subagent or an event ended badly, in a few words (`interrupted`, `timed out`). */
  why?: string
  /** For a compaction row: what set it off. Copilot's hook says nothing more (not the size, not the summary). */
  compact?: { trigger: string }
  /** What a tool call touched. */
  touch?: Touch
  /** The file Copilot keeps this loop's transcript in, when its hook says (a prompt's end, a subagent, a compaction). */
  transcript?: string
}

export type EvKind =
  | 'session_start'
  | 'session_end'
  | 'prompt'
  | 'stop'
  | 'tool_pre'
  | 'tool_post'
  | 'tool_fail'
  | 'agent_start'
  | 'agent_stop'
  | 'error'
  | 'compact'

/**
 * One line of the event log. The hook script turns whatever a Copilot host
 * sends (camelCase or snake_case) into this one shape, so the rest of the
 * extension never sees the differences.
 */
export type Ev = {
  v: 1
  /** Epoch milliseconds, taken when the hook ran. */
  t: number
  /** The chat session's id. */
  sid: string
  cwd?: string
  kind: EvKind
  /** Set when the event happened inside a subagent. */
  agentId?: string
  parentAgentId?: string
  /** A subagent's type or name; for a spawn tool call, the type it asked for. */
  agentType?: string
  /** The host's id for a tool call, when it gives one. */
  toolUseId?: string
  tool?: string
  /** A hash of tool and arguments: pairs a call with its result when there is no id. */
  fp?: string
  /** The most telling argument, in a few words. */
  arg?: string
  input?: string
  inputLen?: number
  inputFile?: string
  output?: string
  outputLen?: number
  outputFile?: string
  /** Why the session ended, or what set a compaction off (`manual`, `auto`). */
  reason?: string
  /** The transcript file the host names, on the events that carry it. */
  transcript?: string
  /** On a tool call's start: what it touched. */
  touch?: Touch
}
