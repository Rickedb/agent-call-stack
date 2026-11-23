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
  /** Where the whole text went when it was cut: a file the mod wrote. */
  inputFile?: string
  outputFile?: string
  /** Read back from the chat's history: it has no start or end time. */
  hist?: true
  /** A duration the history did record, in milliseconds (an agent's). */
  ms?: number
}

declare module 'claude-code' {
  interface PluginState {
    'ai-call-tree': {
      nodes: Shaped<Node[]>
      /** The id of the prompt now running (or last run). */
      root: Shaped<string>
      /** How the rows draw: a tree of duration bars, or a waterfall on a time axis. */
      mode: Shaped<'tree' | 'waterfall'>
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
    }
  }
}
