import type { Session } from '../model'
import { reportOf, type Report } from '../stats'
import type { Node } from '../types'
import { index } from './context'
import { clip, dur, tokCount } from './format'
import { approvalsText, cacheText, compactsText, modelsText, tokensText } from './tags'

// Table cells and inline code must not break the markdown around them.
const cell = (s: string): string => s.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()
const code = (s: string): string => `\`${s.replace(/`/g, "'").replace(/\s+/g, ' ').trim()}\``
const call = (n: Node): string => (n.arg ? `${n.name} ${code(clip(n.arg, 80))}` : n.name)
const pct = (a: number, b: number): number => (b > 0 ? Math.min(100, Math.round((a / b) * 100)) : 0)

/** The summary of a finished prompt as markdown, to paste into a ticket, a PR or a chat. */
export const reportMarkdown = (title: string, top: Node, r: Report, now: number): string => {
  const took = (n: Node) => dur((n.end ?? now) - n.start)
  const out: string[] = [`## ${title} summary`, '']
  if (top.arg) out.push(`> ${clip(top.arg, 160)}`, '')

  out.push(
    `- **Tool calls:** ${r.calls}${r.failed ? ` (${r.failed} failed)` : ''} · took ${dur(r.wall)} · ${pct(r.busy, r.wall)}% of it in calls`,
  )
  if (r.slowest) out.push(`- **Average call:** ${dur(r.avg)} · **slowest:** ${call(r.slowest)} ${took(r.slowest)}`)
  if (r.heaviest) out.push(`- **Heaviest call:** ${call(r.heaviest)} ${tokCount(r.heavy)}`)
  if (r.models.length) out.push(`- **Models:** ${modelsText(r.models)}`)
  if (r.usage) {
    out.push(`- **Tokens:** ${tokensText(r.usage)}`, `- **Cache:** ${cacheText(r.usage)}`, `- **Call text (estimated):** in ${tokCount(r.input)} · out ${tokCount(r.output)}`)
  } else {
    out.push(`- **Tokens (estimated):** in ${tokCount(r.input)} · out ${tokCount(r.output)} · total ${tokCount(r.input + r.output)}`)
  }
  if (r.perms) out.push(`- **Approvals:** ${approvalsText(r.perms)}`)
  if (r.agents.count) {
    const a = r.agents
    out.push(
      `- **Subagents:** ${a.count}${a.failed ? ` (${a.failed} failed)` : ''}${a.longest ? ` · longest ${call(a.longest)} ${took(a.longest)}` : ''}`,
    )
  }

  if (r.compacts) out.push(`- **Compactions:** ${compactsText(r.compacts)}`)
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
        `| ${cell(k.name)}${k.failed ? ` (${k.failed} failed)` : ''} | ${k.count} | ${k.done ? dur(k.avg) : '—'} | ${k.done ? dur(k.ms) : '—'} | ${k.tokens > 0 ? tokCount(k.tokens) : '—'} |`,
      )
    }
  }
  return out.join('\n') + '\n'
}

/** The markdown of one prompt's summary, or undefined when it has none (running, no calls, gone). */
export const summaryMarkdown = (s: Session | undefined, promptId: string, now: number): string | undefined => {
  const top = s?.get(promptId)
  if (!s || !top || top.kind !== 'prompt') return undefined
  const r = reportOf(top, index(s.nodes).below(top), now)
  const no = s.nodes.filter(n => n.kind === 'prompt').indexOf(top) + 1
  return r ? reportMarkdown(`Prompt ${no}`, top, r, now) : undefined
}
