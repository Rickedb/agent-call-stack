/** Token counts the API reported for a turn (summed over a loop's turns), not estimated. */
export type Usage = {
  /** Uncached input tokens. */
  input: number
  output: number
  /** Input served from, and written to, the prompt cache. */
  cacheRead: number
  cacheWrite: number
}

/** What the engine decided about letting a tool call run, and what came of it. */
export type Perm = {
  decision: 'allow' | 'ask' | 'deny'
  /** The reason the engine or a hook gave. */
  reason?: string
  /** The settings rule that decided, as written (`Bash(git push:*)`). */
  rule?: string
  /** What else decided: the classic hook event, the setting, or the plugin. */
  by?: string
  /** For an ask: the person did not let it run (or a classifier refused it). */
  refused?: true
  /** For an ask that was answered yes: how long the call waited for the answer, in milliseconds. */
  waited?: number
  /** How long the tool itself ran, as the engine reports it (the wait and the hooks are not in it). Kept for an ask. */
  ran?: number
}

/** One compaction of the conversation: what it was told, what it left. */
export type Compact = {
  /** `manual` (the person's /compact), `auto` (at the threshold) or `plugin`. */
  trigger: string
  /** The conversation's size before and after, in tokens, when the engine says. */
  before?: number
  after?: number
  /** The messages the conversation had before, and after. */
  messagesBefore?: number
  messagesAfter?: number
  /** What the summarizing request cost, as the API reported it. */
  usage?: Usage
  /** Why a mod or the engine skipped it. */
  skipped?: string
}

/** What a tool call touched, read from its arguments. */
export type Touch = {
  /** `read`, `edit` (change a file) and `write` (create or replace one) touch files; `run` a command; `search` and `web` look something up. */
  op: 'read' | 'edit' | 'write' | 'other' | 'run' | 'search' | 'web'
  /** The files it was given (for a search, where it looked). */
  paths: string[]
  /** The command it ran, the address it fetched, what it searched for. */
  what?: string
}

export type Node = {
  id: string
  parent?: string
  /** A row that is neither work nor a loop but something that happened to it: a compaction, an error. */
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
  /** Where the whole text went when it was cut: a file the mod wrote. */
  inputFile?: string
  outputFile?: string
  /** Read back from the chat's history: it has no start or end time. */
  hist?: true
  /** The model a prompt or subagent ran on, as the engine reports it. A tool call has none: it is the loop's. */
  model?: string
  /** What the API reported the turn used: a prompt's, or a subagent's own loop. A tool call has none. */
  usage?: Usage
  /** A duration the history did record, in milliseconds (an agent's). */
  ms?: number
  /** Why a prompt, a subagent or an event ended badly, in a few words (`interrupted`, `rate limited`). */
  why?: string
  /** The engine's permission verdict for a tool call, and what came of it. */
  perm?: Perm
  /** For a compaction row. */
  compact?: Compact
  /** What a tool call touched. */
  touch?: Touch
  /** The file the conversation's transcript is kept in: the session's for a prompt, a subagent's own for it. */
  transcript?: string
}

declare module 'claude-code' {
  interface PluginState {
    'ai-call-tree': {
      nodes: Shaped<Node[]>
      /** The id of the prompt now running (or last run). */
      root: Shaped<string>
      /** How the rows draw: a tree of duration bars, or a waterfall on a time axis. */
      mode: Shaped<'tree' | 'waterfall' | 'files'>
      /** The row whose details show; '' for none. */
      selected: Shaped<string>
      /** The ids of the rows whose children are folded away. */
      folded: Shaped<string[]>
      /** True once the person closed the pane, until it opens again. */
      isClosed: Shaped<boolean>
      /** Whether the chat's history was read once into the nodes. */
      filled: Shaped<boolean>
      /** The texts shown whole, as `<id>:input` or `<id>:output`. */
      shown: Shaped<string[]>
      /** The prompts whose summary is collapsed to its header. */
      shut: Shaped<string[]>
    }
  }
}
