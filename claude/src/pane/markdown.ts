import type { Node } from '../../types'
import { clip, dur, fmtTokens, modelName, tokCount, tokExact } from '../format'
import type { Report } from '../stats'

// Table cells and inline code must not break the markdown around them.
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()
const code = (s: string) => `\`${s.replace(/`/g, "'").replace(/\s+/g, ' ').trim()}\``
const call = (n: Node) => (n.arg ? `${n.name} ${code(clip(n.arg, 80))}` : n.name)
const pct = (a: number, b: number) => (b > 0 ? Math.min(100, Math.round((a / b) * 100)) : 0)

/** The summary of a finished prompt as markdown, to paste into a ticket, a PR or a chat. */
export const reportMarkdown = (title: string, top: Node, r: Report): string => {
  const took = (n: Node) => dur((n.end ?? 0) - n.start)
  const sent = r.usage ? r.usage.input + r.usage.cacheRead + r.usage.cacheWrite : 0
  const out: string[] = [`## ${title} summary`, '']
  if (top.arg) out.push(`> ${clip(top.arg, 160)}`, '')

  out.push(
    `- **Tool calls:** ${r.calls}${r.failed ? ` (${r.failed} failed)` : ''} · took ${dur(r.wall)} · ${pct(r.busy, r.wall)}% of it in calls`,
  )
  if (r.slowest) {
    out.push(`- **Average call:** ${dur(Math.round(r.avg))} · **slowest:** ${call(r.slowest)} ${took(r.slowest)}`)
  }
  if (r.heaviest) out.push(`- **Heaviest call:** ${call(r.heaviest)} ${tokCount(r.heavy)}`)
  if (r.usage) {
    out.push(
      `- **Tokens (reported):** in ${tokExact(sent)} · out ${tokExact(r.usage.output)} · total ${tokExact(sent + r.usage.output)}`,
      `- **Cache:** ${pct(r.usage.cacheRead, sent)}% of input from cache (${tokExact(r.usage.cacheRead)} read, ${tokExact(r.usage.cacheWrite)} written)`,
      `- **Call text (estimated):** in ${tokCount(r.input)} · out ${tokCount(r.output)}`,
    )
  } else {
    out.push(`- **Tokens (estimated):** in ${tokCount(r.input)} · out ${tokCount(r.output)} · total ${tokCount(r.input + r.output)}`)
  }
  if (r.models.length) {
    out.push(
      `- **Models:** ${r.models
        .map(m => {
          const who = [m.main ? 'prompt' : '', m.agents ? `${m.agents} ${m.agents === 1 ? 'subagent' : 'subagents'}` : ''].filter(Boolean)
          return `${modelName(m.model)} (${who.join(', ')})`
        })
        .join(' · ')}`,
    )
  }
  if (r.agents.count) {
    const a = r.agents
    out.push(
      `- **Subagents:** ${a.count}${a.failed ? ` (${a.failed} failed)` : ''}${a.longest ? ` · longest ${call(a.longest)} ${took(a.longest)}` : ''}`,
    )
  }

  if (r.perms) {
    const p = r.perms
    out.push(
      `- **Approvals:** ${p.allowed} allowed · ${p.asked} asked the person${p.waited ? ` (waited ${dur(p.waited)})` : ''}${p.denied ? ` · ${p.denied} not allowed` : ''}`,
    )
  }
  if (r.compacts) {
    const k = r.compacts
    out.push(
      `- **Compactions:** ${k.count}${k.manual || k.auto ? ` (${[k.manual ? `${k.manual} manual` : '', k.auto ? `${k.auto} auto` : ''].filter(Boolean).join(', ')})` : ''}${k.before !== undefined && k.after !== undefined ? ` · ${fmtTokens(k.before)} → ${fmtTokens(k.after)} tok` : ''}${k.saved ? ` · ${fmtTokens(k.saved)} tok saved` : ''} · took ${dur(k.ms)}`,
    )
  }
  if (r.errors.length) {
    out.push(`- **Errors:** ${r.errors.length}`)
    for (const f of r.errors.slice(0, 10)) {
      out.push(`  - ${f.node.kind === 'prompt' ? 'the prompt' : call(f.node)} — ${cell(f.why)}`)
    }
    if (r.errors.length > 10) out.push(`  - …and ${r.errors.length - 10} more`)
  }

  if (r.kinds.length) {
    out.push('', '| Tool | Calls | Avg | Total | Tokens (est.) |', '| --- | ---: | ---: | ---: | ---: |')
    for (const k of r.kinds) {
      out.push(
        `| ${cell(k.name)}${k.failed ? ` (${k.failed} failed)` : ''} | ${k.count} | ${k.done ? dur(Math.round(k.avg)) : '—'} | ${k.done ? dur(k.ms) : '—'} | ${k.tokens > 0 ? tokCount(k.tokens) : '—'} |`,
      )
    }
  }
  return out.join('\n') + '\n'
}
