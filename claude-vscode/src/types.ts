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

/** Token counts the API reported for a prompt's turns or a subagent's loop, read from the transcript. */
export type Usage = {
  /** Uncached input tokens. */
  input: number
  output: number
  /** Input served from, and written to, the prompt cache. */
  cacheRead: number
  cacheWrite: number
}

/** What was decided about letting a tool call run, and what came of it. */
export type Perm = {
  decision: 'allow' | 'ask' | 'deny'
  /** The reason given (a classifier's, for a call it refused). */
  reason?: string
  /** For an ask: the person did not let it run (or a classifier refused it). */
  refused?: true
  /** For an ask answered yes: how long the call waited for the answer, in milliseconds. */
  waited?: number
  /** How long the tool itself ran, as Claude Code reports it (the wait is not in it). Kept for an ask. */
  ran?: number
}

/** One compaction of the conversation: what set it off, and (from the transcript) its size before and after, in tokens. */
export type Compact = { trigger: string; before?: number; after?: number }

/** One row of the tree: a prompt, a subagent, a tool call, or something that happened to them. */
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
  /** The model a prompt or subagent ran on, read from the transcript (the hooks carry none): the last that answered. */
  model?: string
  /** What the API reported the prompt's turns (or the subagent's loop) used, read from the transcript. */
  usage?: Usage
  /** The permission verdict for a tool call, when the hooks told of one. */
  perm?: Perm
  /** Why a prompt, a subagent or an event ended badly, in a few words (`interrupted`, `timed out`). */
  why?: string
  /** For a compaction row: what set it off, and (from the transcript) the conversation's size before and after, in tokens. */
  compact?: Compact
  /** What a tool call touched. */
  touch?: Touch
  /** Read back from the transcript, not recorded as it happened: its times are when each line was written. */
  hist?: true
  /** The file Claude Code keeps this loop's transcript in: the session's for a prompt, a subagent's own for it. */
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
  | 'compact'
  | 'compact_end'
  | 'perm_ask'
  | 'perm_denied'
  | 'stop_fail'

/**
 * One line of the event log. The hook script turns what Claude Code sends a hook
 * into this one shape, so the rest of the extension never sees the payloads.
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
  /** The session's transcript file, which every hook payload names. */
  transcript?: string
  /** A subagent's own transcript file, on its stop. */
  agentTranscript?: string
  /** How long the tool itself ran, on a call's result: the person's wait is not in it. */
  durationMs?: number
  /** On a tool call's start: what it touched. */
  touch?: Touch
}
