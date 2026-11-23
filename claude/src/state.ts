import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Node } from '../types'

// The state of the pane, in one place. The engine reads where each value is
// written by scanning for the atom beside the `update` call, so every atom and
// every read and write of it lives in this file, and the rest of the mod calls
// the functions below (`$` goes to a function declaration, which the scan follows).

// Change a tag when the fields of what it holds change: it declines what an
// earlier version stored, which outlives a reload.
const nodes = atom({ plugin: 'ai-call-tree', key: 'nodes' } as const, [], {
  shape: 'nodes-5',
})
const root = atom({ plugin: 'ai-call-tree', key: 'root' } as const, '', {
  shape: 'root-1',
})
const mode = atom({ plugin: 'ai-call-tree', key: 'mode' } as const, 'waterfall', {
  shape: 'mode-2',
})
const isClosed = atom({ plugin: 'ai-call-tree', key: 'isClosed' } as const, false, {
  shape: 'isClosed-1',
})
const filled = atom({ plugin: 'ai-call-tree', key: 'filled' } as const, false, {
  shape: 'filled-1',
})
const selected = atom({ plugin: 'ai-call-tree', key: 'selected' } as const, '', {
  shape: 'selected-1',
})
const folded = atom({ plugin: 'ai-call-tree', key: 'folded' } as const, [], {
  shape: 'folded-1',
})
const shown = atom({ plugin: 'ai-call-tree', key: 'shown' } as const, [], {
  shape: 'shown-1',
})

// The prompts whose summary is collapsed to its header.
const shut = atom({ plugin: 'ai-call-tree', key: 'shut' } as const, [], {
  shape: 'shut-1',
})

const flip = (list: string[], id: string) =>
  list.includes(id) ? list.filter(x => x !== id) : [...list, id]

// The rows: every prompt, subagent and tool call.
export function readNodes($: EngineInterface) {
  return read($, nodes)
}
export function updateNodes($: EngineInterface, fn: (list: Node[]) => Node[]) {
  return update($, nodes, fn)
}

// The id of the prompt now running (or last run).
export function readRoot($: EngineInterface) {
  return read($, root)
}
export function setRoot($: EngineInterface, id: string) {
  return update($, root, () => id)
}

// How the rows draw: a tree of duration bars, or a waterfall on a time axis.
export function readMode($: EngineInterface) {
  return read($, mode)
}
export function setMode($: EngineInterface, value: 'tree' | 'waterfall') {
  return update($, mode, () => value)
}

// True once the person closed the pane, until it opens again.
export function readClosed($: EngineInterface) {
  return read($, isClosed)
}
export function setClosed($: EngineInterface, value: boolean) {
  return update($, isClosed, () => value)
}

// Whether the chat's history was read once into the rows.
export function readFilled($: EngineInterface) {
  return read($, filled)
}
export function markFilled($: EngineInterface) {
  return update($, filled, () => true)
}

// The row whose details show; '' for none.
export function readSelected($: EngineInterface) {
  return read($, selected)
}
export function toggleSelected($: EngineInterface, id: string) {
  return update($, selected, cur => (cur === id ? '' : id))
}
export function clearSelected($: EngineInterface) {
  return update($, selected, () => '')
}

// The ids of the rows whose children are folded away.
export function readFolded($: EngineInterface) {
  return read($, folded)
}
export function toggleFolded($: EngineInterface, id: string) {
  return update($, folded, list => flip(list, id))
}
export function setFolded($: EngineInterface, ids: string[]) {
  return update($, folded, () => ids)
}
// Folds more rows, leaving what is folded as it is.
export function foldIds($: EngineInterface, ids: string[]) {
  return update($, folded, list => [...list, ...ids.filter(id => !list.includes(id))])
}

// The texts shown whole, as `<id>:input` or `<id>:output`.
export function readShown($: EngineInterface) {
  return read($, shown)
}
export function toggleShown($: EngineInterface, key: string) {
  return update($, shown, list => flip(list, key))
}

// The prompts whose summary is collapsed to its header.
export function readShut($: EngineInterface) {
  return read($, shut)
}
export function toggleShut($: EngineInterface, id: string) {
  return update($, shut, list => flip(list, id))
}
