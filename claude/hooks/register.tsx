import type { Register } from 'claude-code'

import { lifecycle } from '../src/lifecycle'
import { pane } from '../src/pane'
import { recording } from '../src/recording'

// Three parts, each a function that hooks what it needs:
//   lifecycle: opening the pane, `/call-tree`, the button that reopens it
//   recording: turns, subagents and tool calls into rows of the state
//   pane:      drawing the rows
export const register: Register = on => {
  lifecycle(on)
  recording(on)
  pane(on)
}
