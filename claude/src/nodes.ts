import type { EngineInterface } from 'claude-code'

import type { Node, Perm, Usage } from '../types'
import { FILE_MAX, KEEP, MAX_NODES } from './config'

export const upsert = (list: Node[], node: Node): Node[] => {
  const i = list.findIndex(n => n.id === node.id)
  const next =
    i < 0 ? [...list, node] : list.map((n, j) => (j === i ? { ...n, ...node, start: n.start } : n))
  return next.slice(-MAX_NODES)
}

// A loop's reported usage, summed over its turns (a subagent is woken more than once).
export const addUsage = (
  was: Usage | undefined,
  u: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number },
): Usage => ({
  input: (was?.input ?? 0) + u.input_tokens,
  output: (was?.output ?? 0) + u.output_tokens,
  cacheRead: (was?.cacheRead ?? 0) + u.cache_read_input_tokens,
  cacheWrite: (was?.cacheWrite ?? 0) + u.cache_creation_input_tokens,
})

// Adds to what is known of a call's permission; with none known yet, it was asked unless said otherwise.
export const patchPerm = (list: Node[], id: string, fields: Partial<Perm>): Node[] =>
  list.map(n => (n.id === id ? { ...n, perm: { decision: 'ask', ...n.perm, ...fields } } : n))

// What a finished call changes about its row beyond its status and text. A call the person was
// asked about waited for the answer, and that wait is not the tool's time: the row is drawn from
// when the tool ran (`perm.ran`, which the engine reports), and says how long it waited. An ask
// that ended in failure with no run was not allowed.
export const settle = (was: Node | undefined, failed: boolean, end: number): Partial<Node> => {
  const perm = was?.perm
  if (!was || perm?.decision !== 'ask') return {}
  if (perm.ran !== undefined) {
    return {
      start: Math.max(was.start, end - perm.ran),
      perm: { ...perm, waited: Math.max(0, end - was.start - perm.ran) },
    }
  }
  return failed ? { perm: { ...perm, refused: true } } : {}
}

export const patch = (list: Node[], id: string, fields: Partial<Node>): Node[] =>
  list.map(n => (n.id === id ? { ...n, ...fields } : n))

// Keeps a text in the state up to KEEP characters; a longer one is also
// written whole to a file, whose path the node carries. A file that cannot be
// written leaves the cut text, which says so.
export async function keep(
  $: EngineInterface,
  id: string,
  which: 'input' | 'output',
  text: string,
  limit = KEEP,
): Promise<Partial<Node>> {
  if (text.length <= limit) return { [which]: text, [`${which}Len`]: text.length }
  const fields: Partial<Node> = {
    [which]: text.slice(0, limit),
    [`${which}Len`]: text.length,
  }
  try {
    const home = await $.env.get('HOME')
    if (home) {
      const path = `${home}/.claude/ai-call-tree/${id.replace(/[^\w.-]/g, '_')}.${which}.txt`
      await $.fs.write(path, text.slice(0, FILE_MAX))
      fields[`${which}File`] = path
    }
  } catch {
    // The cut text stands.
  }
  return fields
}

// Recording must never get in the way of the work: a failure is said in a
// toast, and the call goes on.
export async function guard($: EngineInterface, what: string, fn: () => Promise<unknown>) {
  try {
    await fn()
  } catch (err) {
    $.ui.toast(`Call tree: ${what}: ${err instanceof Error ? err.message : String(err)}`)
  }
}
