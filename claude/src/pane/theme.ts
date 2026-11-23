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

// What a node is: an icon per kind. Emoji take no color, so the status
// stays beside it as a small tinted mark.
const KIND_ICON: Record<Node['kind'], string> = { prompt: '💬', agent: '🤖', tool: '🔧' }
export const icon = (n: Node) => KIND_ICON[n.kind]

export const mark = (n: Node) => (n.status === 'run' ? '●' : n.status === 'ok' ? '✓' : '✗')
