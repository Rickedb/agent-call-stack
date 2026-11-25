import type { Node } from '../../types'
import { toolOp } from '../names'

// Theme keys, so the pane follows the app's colors in light and dark.
export const tint = (n: Node) =>
  n.status === 'err'
    ? 'error'
    : n.status === 'run'
      ? 'warning'
      : n.kind === 'prompt'
        ? 'claude'
        : n.kind === 'agent'
          ? 'permission'
          : n.kind === 'note'
            ? 'suggestion'
            : 'success'

// One glyph says how a row stands, in the color of its tint; the kind shows in
// the name (a prompt and a subagent in bold) and the tint, not in an emoji,
// whose width the terminals do not agree on and which takes no color.
export const mark = (n: Node) => (n.status === 'run' ? '●' : n.status === 'ok' ? '✓' : '✗')

// What a tool call did, when it is known: a shell command has the terminal's prompt, a file call a
// mark for reading, editing or writing. Narrow characters only, so that the columns hold in every
// terminal (an emoji's width differs between them). Any other call has none.
const TOOL_GLYPH: Record<string, string> = { run: '❯_', read: '≡', edit: '✎', write: '✚', search: '?', web: '↗', mcp: '◈' }
// What the model wrote between calls: its thinking, and its reply.
const NOTE_GLYPH: Record<string, string> = { Thinking: '∴', Reply: '“' }
export const glyph = (n: Node): string => (n.kind === 'note' ? (NOTE_GLYPH[n.name] ?? '') : (TOOL_GLYPH[toolOp(n) ?? ''] ?? ''))
