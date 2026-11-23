/** One row of the tree: a prompt, a subagent, or a tool call. */
export type Node = {
  id: string
  parent?: string
  kind: 'prompt' | 'agent' | 'tool'
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
}
