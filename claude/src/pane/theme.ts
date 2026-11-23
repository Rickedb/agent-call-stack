import type { Node } from '../../types'

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
          : 'success'

// One glyph says how a row stands, in the color of its tint; the kind shows in
// the name (a prompt and a subagent in bold) and the tint, not in an emoji,
// whose width the terminals do not agree on and which takes no color.
export const mark = (n: Node) => (n.status === 'run' ? '●' : n.status === 'ok' ? '✓' : '✗')
