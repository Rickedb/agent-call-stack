import type { Node } from '../types'

export const clip = (s: string, n: number) => {
  const one = s.replace(/\s+/g, ' ').trim()
  if (n <= 0) return ''
  return one.length > n ? one.slice(0, Math.max(1, n - 1)) + '…' : one
}

// The most telling argument of a tool call, whatever the tool.
const KEYS = ['command', 'file_path', 'pattern', 'url', 'query', 'path', 'description', 'prompt']
export const summarize = (e: Record<string, unknown>): string => {
  for (const k of KEYS) {
    const v = e[k]
    if (typeof v === 'string' && v) return clip(v, 160)
  }
  return ''
}

const RESERVED = new Set(['tool', 'tool_use_id', 'agentId', 'requestMeta'])
// A call's arguments as a person reads them: `key: value`, and a long or
// multi-line value on lines of its own, as it is, not as an escaped string.
export const describe = (e: Record<string, unknown>): string =>
  Object.keys(e)
    .filter(k => !RESERVED.has(k) && e[k] !== undefined)
    .map(k => {
      const v = e[k]
      if (typeof v === 'string' && (v.includes('\n') || v.length > 80)) return `${k}:\n${v}`
      return `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`
    })
    .join('\n')

export const dur = (ms: number) => {
  const m = Math.max(0, ms)
  if (m < 1000) return `${m}ms`
  if (m < 60000) return `${(m / 1000).toFixed(1)}s`
  return `${Math.floor(m / 60000)}m ${Math.round((m % 60000) / 1000)}s`
}

// A text's size in tokens. The engine gives no count per call (only per model
// response), so every row is estimated alike, at four characters a token, and
// drawn with a "~". The length is the whole text's, not the cut one the state keeps.
export const sizeOf = (n: Node, which: 'input' | 'output') =>
  (which === 'input' ? n.inputLen ?? n.input?.length : n.outputLen ?? n.output?.length) ?? 0

export const fmtTokens = (n: number) =>
  n < 1000
    ? `${n}`
    : n < 10_000
      ? `${(n / 1000).toFixed(1)}k`
      : n < 1_000_000
        ? `${Math.round(n / 1000)}k`
        : `${(n / 1_000_000).toFixed(1)}M`

/** `~340 tok` for a count of estimated tokens. */
export const tokCount = (tokens: number) => `~${fmtTokens(tokens)} tok`

/** `~340 tok`, or `—` for a text there is none of (yet). */
export const tokText = (n: Node, which: 'input' | 'output') => {
  const len = sizeOf(n, which)
  return len > 0 ? `~${fmtTokens(Math.ceil(len / 4))} tok` : '—'
}

// The user's own words in a message: what the app adds around them (system
// reminders) is not a prompt.
export const userText = (t: string) =>
  t.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim()
