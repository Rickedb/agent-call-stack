import { reportOf } from '../stats'
import type { Node } from '../types'
import { button, clip, dur, esc, modelName, tint, tokCount } from './format'
import type { Ctx } from './types'

const MAX_KINDS = 8
const pct = (a: number, b: number) => (b > 0 ? Math.min(100, Math.round((a / b) * 100)) : 0)
const named = (n: Node) => `${n.name}${n.arg ? ` ${n.arg}` : ''}`

// What a finished prompt did, under its rows: the calls by tool, the slowest and
// the heaviest, and the tokens (estimates). Nothing while it runs, or if it made no call.
export const report = (c: Ctx, top: Node): string => {
  const r = reportOf(top, c.below(top), c.v.now)
  if (!r) return ''

  const isShut = c.v.shut.has(top.id)
  const shown = r.kinds.slice(0, MAX_KINDS)
  const table = shown.length
    ? `<table class="kinds">
        <thead><tr><th>tool</th><th>calls</th><th>avg</th><th>total</th><th>tokens</th></tr></thead>
        <tbody>${shown
          .map(
            k => `<tr>
          <td class="name">${esc(clip(k.name, 60))}${k.failed ? ` <span class="tint-err">✗${k.failed}</span>` : ''}</td>
          <td>${k.count}</td><td>${k.done ? dur(k.avg) : '—'}</td><td>${k.done ? dur(k.ms) : '—'}</td>
          <td>${k.tokens > 0 ? tokCount(k.tokens) : '—'}</td></tr>`,
          )
          .join('')}</tbody>
      </table>
      ${r.kinds.length > shown.length ? `<div class="dim">+${r.kinds.length - shown.length} more tools</div>` : ''}`
    : ''

  const fact = (label: string, text: string, extra = '') =>
    `<div class="fact"><span class="dim">${label}</span><span class="val" title="${esc(text)}">${esc(clip(text, 160))}</span>${extra}</div>`
  const took = (n: Node) => (n.end ?? c.v.now) - n.start
  const a = r.agents

  const facts = [
    r.slowest ? fact('Average', `${dur(r.avg)} a tool call`) : '',
    r.slowest ? fact('Slowest', `${named(r.slowest)}  ${dur(took(r.slowest))}`) : '',
    r.heaviest ? fact('Heaviest', `${named(r.heaviest)}  ${tokCount(r.heavy)}`) : '',
    r.models.length ? fact('Models', r.models.map(m => modelName(m.model)).join(' · ')) : '',
    fact('Tokens', `in ${tokCount(r.input)} · out ${tokCount(r.output)} · total ${tokCount(r.input + r.output)} (estimated)`),
    a.count
      ? fact(
          'Subagents',
          `${a.count} ${a.count === 1 ? 'subagent' : 'subagents'}${a.failed ? ` (${a.failed} failed)` : ''}${a.longest ? ` · longest ${named(a.longest)} ${dur(took(a.longest))}` : ''}`,
        )
      : '',
  ].join('')

  return `<div class="report tint-${tint(top)}-border">
      <div class="report-head">
        <button class="head-text head-toggle" data-act="shut" data-id="${esc(top.id)}" aria-expanded="${!isShut}" title="${isShut ? 'Show' : 'Hide'} the summary"><span class="fold">${isShut ? '▸' : '▾'}</span><b>Summary</b>
          <span class="dim"> · ${r.calls} tool calls${r.failed ? ` · ${r.failed} failed` : ''} · took ${dur(r.wall)} · ${pct(r.busy, r.wall)}% of it in calls</span></button>
        ${button('copySummary', 'Copy', `data-id="${esc(top.id)}" title="Copy the summary as markdown"`, 'plain')}
      </div>
      ${isShut ? '' : `${table}
      <div class="facts">${facts}</div>`}
    </div>`
}
