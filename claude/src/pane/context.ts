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
  /** The room left of a row, and the width of a bar. */
  gutter: number
  barW: number
  promptNo: Map<string, number>
}

/** What a prompt's section works out once for its rows. */
export type Section = {
  t0: number
  t1: number
  slowest: Node | undefined
  rowCount: number
}
