import { MEANING, sequenceOf } from '../names'
import type { Node } from '../types'
import { esc } from './format'

// The class of each operator, so that one reads apart from another (the stylesheet colors them).
const CLASS: Record<string, string> = { '&&': 'op-and', '||': 'op-or', ';': 'op-seq', '&': 'op-seq', '|': 'op-pipe', '|&': 'op-pipe' }

/**
 * The commands of a shell call, as a tree in the order they run (names only, no arguments): the pipelines
 * joined by `&&`, `||`, `;` at the top, each pipeline's later commands below the one that feeds them,
 * after a `|`. Nothing for a line that holds one command.
 */
export const sequenceHtml = (n: Node): string => {
  const steps = sequenceOf(n)
  if (!steps.length) return ''
  const used = new Set<string>()
  const line = (prefix: string, op: string | undefined, name: string, isCommon: boolean): string => {
    if (op) used.add(op)
    return `<div class="seq-line"><span class="dim">${prefix}</span>${op ? `<b class="op ${CLASS[op]}" title="${esc(MEANING[op] ?? '')}">${esc(op)}</b> ` : ''}<span class="${isCommon ? 'dim' : ''}">${esc(name)}</span></div>`
  }
  const rows = steps
    .flatMap((s, i) => {
      const isLast = i === steps.length - 1
      const inner = isLast ? '   ' : '│  '
      return [
        line(isLast ? '└─ ' : '├─ ', s.join, s.stages[0]!.name, s.stages[0]!.isCommon),
        ...s.stages.slice(1).map((st, j) => line(`${inner}${'   '.repeat(j)}└─ `, st.pipe, st.name, st.isCommon)),
      ]
    })
    .join('')
  const legend = [...used].map(op => `<span class="op ${CLASS[op]}">${esc(op)}</span> ${esc(MEANING[op] ?? '')}`).join(' · ')
  return `<div class="seq"><div class="dim">COMMANDS</div>${rows}<div class="dim seq-legend">${legend}</div></div>`
}
