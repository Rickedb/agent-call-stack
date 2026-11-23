import type { Compact, Node, Perm } from '../../types'
import { clip, dur, fmtTokens, tokExact } from '../format'

/** A short word after a row's name that says what went wrong or what was asked: with its theme color. */
export const tagOf = (n: Node): { text: string; color: 'error' | 'warning' } | undefined => {
  const p = n.perm
  if (n.kind === 'tool' && p) {
    if (p.decision === 'deny') return { text: 'denied', color: 'error' }
    if (p.refused) return { text: 'not allowed', color: 'error' }
    if (p.decision === 'ask') {
      if (p.waited !== undefined) return { text: `asked, waited ${dur(p.waited)}`, color: 'warning' }
      return { text: n.status === 'run' ? 'asking you' : 'asked', color: 'warning' }
    }
  }
  if ((n.kind === 'prompt' || n.kind === 'agent') && n.why) return { text: clip(n.why, 32), color: 'error' }
  return undefined
}

/** What was decided about a call's permission, in a line. */
export const permLine = (p: Perm): string => {
  const said = [p.rule ? `rule ${p.rule}` : '', p.by && !p.rule ? p.by : '', p.reason ? clip(p.reason, 120) : '']
    .filter(Boolean)
    .join(' · ')
  const verdict =
    p.decision === 'deny'
      ? 'denied'
      : p.decision === 'ask'
        ? `asked you${p.refused ? ', not allowed' : p.waited !== undefined ? `, waited ${dur(p.waited)}` : ''}`
        : 'allowed'
  return `permission ${verdict}${said ? ` · ${said}` : ''}`
}

/** What a compaction did, in a line. */
export const compactLine = (c: Compact): string => {
  const parts = [c.trigger]
  if (c.skipped) parts.push(`skipped: ${clip(c.skipped, 120)}`)
  if (c.before !== undefined && c.after !== undefined) {
    const cut = c.before > 0 ? Math.round(((c.before - c.after) / c.before) * 100) : 0
    parts.push(`${fmtTokens(c.before)} → ${fmtTokens(c.after)} tok (−${cut}%)`)
  }
  if (c.messagesBefore !== undefined && c.messagesAfter !== undefined) {
    parts.push(`${c.messagesBefore} → ${c.messagesAfter} messages`)
  }
  if (c.usage) {
    parts.push(`summarizer in ${tokExact(c.usage.input + c.usage.cacheRead + c.usage.cacheWrite)} · out ${tokExact(c.usage.output)} (reported)`)
  }
  return parts.join(' · ')
}
