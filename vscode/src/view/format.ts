import type { Node } from '../types'
import { toolOp } from '../names'

export const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

export const clip = (s: string, n: number): string => {
  const one = s.replace(/\s+/g, ' ').trim()
  if (n <= 0) return ''
  return one.length > n ? one.slice(0, Math.max(1, n - 1)) + '…' : one
}

export const dur = (ms: number): string => {
  const m = Math.max(0, ms)
  if (m < 1000) return `${Math.round(m)}ms`
  if (m < 60000) return `${(m / 1000).toFixed(1)}s`
  return `${Math.floor(m / 60000)}m ${Math.round((m % 60000) / 1000)}s`
}

// A text's size in tokens. Copilot's hooks give no token counts, so every row is
// estimated alike, at four characters a token, and drawn with a "~". The length
// is the whole text's, not the cut one the log keeps.
export const sizeOf = (n: Node, which: 'input' | 'output'): number =>
  (which === 'input' ? (n.inputLen ?? n.input?.length) : (n.outputLen ?? n.output?.length)) ?? 0

export const fmtTokens = (n: number): string =>
  n < 1000
    ? `${n}`
    : n < 10_000
      ? `${(n / 1000).toFixed(1)}k`
      : n < 1_000_000
        ? `${Math.round(n / 1000)}k`
        : `${(n / 1_000_000).toFixed(1)}M`

/** A model id as a person says it: `copilot/gpt-4.1` is `gpt-4.1`, `claude-opus-5-5-20260101` is `opus-5-5`. */
export const modelName = (m: string): string =>
  m.replace(/^[^/]+\//, '').replace(/^claude-/, '').replace(/-\d{8}(?=\]|$)/, '')

/** `~340 tok` for a count of estimated tokens. */
export const tokCount = (tokens: number): string => `~${fmtTokens(tokens)} tok`

/** `~340 tok`, or `—` for a text there is none of (yet). */
export const tokText = (n: Node, which: 'input' | 'output'): string => {
  const len = sizeOf(n, which)
  return len > 0 ? `~${fmtTokens(Math.ceil(len / 4))} tok` : '—'
}

const KIND_ICON = { prompt: '💬', agent: '🤖', tool: '🔧' } as const
const NOTE_ICON: Record<string, string> = { Thinking: '🧠', Reply: '🗨️' }
// What a tool call did, when it is known: a shell command has the terminal's prompt, a file call the
// icon of reading, editing or writing. Any other call keeps the tool's own.
const TOOL_ICON: Record<string, string> = { run: '❯_', read: '📖', edit: '✏️', write: '📝', search: '🔍', web: '🌐', mcp: '🔌' }
export const icon = (n: Node): string =>
  n.kind === 'event'
    ? n.name === 'Compact'
      ? '🗜️'
      : '⚠️'
    : n.kind === 'note'
      ? (NOTE_ICON[n.name] ?? '💭')
      : n.kind === 'tool'
        ? (TOOL_ICON[toolOp(n) ?? ''] ?? KIND_ICON.tool)
        : KIND_ICON[n.kind]
export const mark = (n: Node): string => (n.status === 'run' ? '●' : n.status === 'ok' ? '✓' : '✗')
export const statusWord = (n: Node): string => (n.status === 'run' ? 'Running' : n.status === 'ok' ? 'Done' : 'Failed')

// A class per tint; the stylesheet maps each to the editor theme's colors.
export const tint = (n: Node): string =>
  n.status === 'err'
    ? 'err'
    : n.status === 'run'
      ? 'run'
      : n.kind === 'prompt'
        ? 'prompt'
        : n.kind === 'agent'
          ? 'agent'
          : n.kind === 'note'
            ? 'note'
            : 'tool'

export const span = (n: Node, now: number): number => (n.end ?? now) - n.start

// Lines added and taken out: nothing when neither.
export const delta = (added: number, removed: number): string =>
  added || removed
    ? `<span class="tv-delta" title="Lines added and taken out, from the call's arguments"><span class="tv-add">+${added}</span> <span class="tv-del">−${removed}</span></span>`
    : ''

// A glyph for each kind of thing a call involved.
export const RES_GLYPH = { file: '◦', link: '↗', command: '$', query: '?', more: '' } as const

export const button = (act: string, label: string, attrs = '', cls = ''): string =>
  `<button class="btn ${cls}" data-act="${act}" ${attrs}>${label}</button>`
