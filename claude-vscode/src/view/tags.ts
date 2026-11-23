import type { Compacts } from '../stats'
import type { Compact, Node, Perm, Usage } from '../types'
import { clip, dur, fmtTokens, modelName, tokExact } from './format'

/** A short word after a row's name that says what went wrong or what was asked, with its tint (`err`, `warn`). */
export const tagOf = (n: Node): { text: string; cls: 'err' | 'warn' } | undefined => {
  const p = n.perm
  if (n.kind === 'tool' && p) {
    if (p.decision === 'deny') return { text: 'denied', cls: 'err' }
    if (p.refused) return { text: 'not allowed', cls: 'err' }
    if (p.decision === 'ask') {
      if (p.waited !== undefined) return { text: `asked, waited ${dur(p.waited)}`, cls: 'warn' }
      return { text: n.status === 'run' ? 'asking you' : 'asked', cls: 'warn' }
    }
  }
  if ((n.kind === 'prompt' || n.kind === 'agent') && n.why) return { text: clip(n.why, 32), cls: 'err' }
  return undefined
}

/** What was decided about a call's permission, in a line. */
export const permLine = (p: Perm): string => {
  const verdict =
    p.decision === 'deny'
      ? 'denied'
      : p.decision === 'ask'
        ? `asked you${p.refused ? ', not allowed' : p.waited !== undefined ? `, waited ${dur(p.waited)}` : ''}`
        : 'allowed'
  return `permission ${verdict}${p.reason ? ` · ${clip(p.reason, 120)}` : ''}`
}

/** What a compaction did, in a line. */
export const compactLine = (c: Compact): string => {
  const parts = [c.trigger || 'compaction']
  if (c.before !== undefined && c.after !== undefined) {
    const cut = c.before > 0 ? Math.round(((c.before - c.after) / c.before) * 100) : 0
    parts.push(`${fmtTokens(c.before)} → ${fmtTokens(c.after)} tok (−${cut}%)`)
  }
  return parts.join(' · ')
}

const pct = (a: number, b: number): number => (b > 0 ? Math.min(100, Math.round((a / b) * 100)) : 0)
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/** The models a prompt and its subagents ran on, and who ran on each. */
export const modelsText = (models: { model: string; main: boolean; agents: number }[]): string =>
  models
    .map(m => {
      const who = [m.main ? 'prompt' : '', m.agents ? plural(m.agents, 'subagent', 'subagents') : ''].filter(Boolean)
      return `${modelName(m.model)} (${who.join(', ')})`
    })
    .join(' · ')

/** What the API reported for the prompt and its subagents: in (cached or not), out, total. */
export const tokensText = (u: Usage): string => {
  const sent = u.input + u.cacheRead + u.cacheWrite
  return `in ${tokExact(sent)} · out ${tokExact(u.output)} · total ${tokExact(sent + u.output)} (reported)`
}

/** How much of the input the cache served. */
export const cacheText = (u: Usage): string => {
  const sent = u.input + u.cacheRead + u.cacheWrite
  return `${pct(u.cacheRead, sent)}% of input from cache · ${tokExact(u.cacheRead)} read · ${tokExact(u.cacheWrite)} written`
}

/** The calls that ran without a question, those put to the person, and those not allowed. */
export const approvalsText = (p: { unasked: number; asked: number; denied: number; waited: number }): string =>
  `${p.unasked} ran unasked · ${p.asked} asked you${p.waited ? ` (waited ${dur(p.waited)})` : ''}${p.denied ? ` · ${p.denied} not allowed` : ''}`

/** The compactions of a prompt, added up. */
export const compactsText = (k: Compacts): string =>
  `${k.count}${k.manual || k.auto ? ` (${[k.manual ? `${k.manual} manual` : '', k.auto ? `${k.auto} auto` : ''].filter(Boolean).join(', ')})` : ''}${k.before !== undefined && k.after !== undefined ? ` · ${fmtTokens(k.before)} → ${fmtTokens(k.after)} tok` : ''}${k.saved ? ` · ${fmtTokens(k.saved)} tok saved` : ''}${k.ms ? ` · took ${dur(k.ms)}` : ''}`
