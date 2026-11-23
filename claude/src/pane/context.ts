import type { EngineInterface } from 'claude-code'

import type { Node } from '../../types'

/** The element table of the surface being drawn: `Box`, `Text`, `Button`. */
export type Els = ReturnType<EngineInterface['ui']['resolve']>

/** Everything one draw of the pane needs, read once, so the parts take one argument. */
export type Pane = {
  els: Els
  list: Node[]
  prompts: Node[]
  /** The row whose details show; '' for none. */
  pick: string
  isWaterfall: boolean
  /** The ids of the rows whose children are folded away. */
  fold: Set<string>
  /** The texts shown whole, as `<id>:input` or `<id>:output`. */
  whole: Set<string>
  cols: number
  now: number
  kids: Map<string, Node[]>
  /** Every row under a node, however deep. */
  below: (n: Node) => Node[]
  /** How long a node ran: what history recorded, else start to end (or now). */
  span: (n: Node) => number
  /** The room left of a row's details. */
  gutter: number
  /** The width of the bar column at a row's right end; 0 in the tree. */
  barW: number
  promptNo: Map<string, number>
}

/** One level above a row: does its branch go on below. */
export type Lane = { last: boolean }

/** A row's place in the tree. */
export type Place = {
  node: Node
  depth: number
  hidden: number
  /** For each level above it, from the prompt's children down. */
  trail: Lane[]
  /** Whether it is the last of its parent's children. */
  isLast: boolean
}

/** What a prompt's section works out once for its rows. */
export type Section = {
  t0: number
  t1: number
  slowest: Node | undefined
  rowCount: number
  /** The widest output-size and time cells of its rows, so the columns line up. */
  tokW: number
  timeW: number
}
