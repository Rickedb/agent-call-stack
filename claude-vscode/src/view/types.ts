import type { Resource } from '../resources'
import type { Node } from '../types'

/** What the panel is showing, as the extension host keeps it. */
export type View = {
  mode: 'tree' | 'waterfall'
  /** The row whose details show, in a modal; '' for none. */
  selected: string
  /** The ids of the rows whose children are folded away. */
  folded: Set<string>
  /** The prompts whose summary is collapsed to its header. */
  shut: Set<string>
  /** The texts shown whole, as `<id>:input` or `<id>:output`. */
  shown: Set<string>
  now: number
  hooksInstalled: boolean
  /** True when the Claude Code settings turn every hook off (disableAllHooks). */
  hooksOff: boolean
  /** Whether a folder is open, so that hooks can be installed for it alone. */
  hasWorkspace: boolean
  /** Every session of the workspace, newest first, and the one drawn. */
  sessions: { id: string; label: string }[]
  picked: string
}

/** Everything one draw of the panel needs, worked out once, so the parts take one argument. */
export type Ctx = {
  v: View
  list: Node[]
  prompts: Node[]
  byId: Map<string, Node>
  /** What each call involved, by the id of its row, with the call. */
  resById: Map<string, { res: Resource; node: Node }>
  kids: Map<string, Node[]>
  /** Every row under a node, however deep. */
  below: (n: Node) => Node[]
  promptNo: Map<string, number>
  isWaterfall: boolean
}

/** One level above a row: does its branch go on below. */
export type Lane = { last: boolean }

/** A row's place in the tree. */
export type Place = {
  /** The row's call or prompt; for a resource row, the call it belongs to. */
  node: Node
  /** Set for a row of something the call involved (a file, an address, a command) instead of the call itself. */
  res?: Resource
  depth: number
  hidden: number
  trail: Lane[]
  /** Whether it is the last of its parent's children. */
  isLast: boolean
}

/** Lines of a text drawn before "Show all". */
export const LINES = 20
