import type { Session } from '../model'
import { parallelGroups } from '../parallel'
import type { Node } from '../types'
import { index } from './context'
import { clip, dur, icon, mark, sizeOf, span, tokText } from './format'

/**
 * The tree as plain text, for a chat reply (`@calltree`): the stack of what runs
 * now, innermost first, then the latest prompt as a tree.
 */
export const renderText = (s: Session | undefined, now: number): string => {
  if (!s) return 'No calls yet.'
  const prompts = s.nodes.filter(n => n.kind === 'prompt')
  const top = prompts[prompts.length - 1]
  if (!top) return 'No calls yet.'

  const { kids, below } = index(s.nodes)
  const line = (n: Node) => {
    const name = n.kind === 'prompt' ? `Prompt ${prompts.indexOf(n) + 1}` : n.name
    const arg = n.arg && n.kind !== 'prompt' ? `(${clip(n.arg, 60)})` : n.kind === 'prompt' ? ` ${clip(n.arg, 60)}` : ''
    return `${icon(n)} ${mark(n)} ${name}${arg}`
  }
  const size = (n: Node) => (sizeOf(n, 'output') > 0 ? `  ${tokText(n, 'output')}` : '')

  const out: string[] = []
  const live = below(top).filter(n => n.status === 'run')
  if (live.length) {
    out.push('Stack (innermost first)')
    for (const n of [...live].reverse()) out.push(`  at ${icon(n)} ${n.name}${n.arg ? `(${clip(n.arg, 60)})` : ''}  ${dur(span(n, now))}`)
    out.push('')
  }

  out.push(`${line(top)}   ${dur(span(top, now))}${size(top)}`)
  // A branch that ran at the same time as its siblings is drawn double: ╞═ ╘═ ║.
  const walk = (n: Node, prefix: string) => {
    const children = kids.get(n.id) ?? []
    const together = parallelGroups(children, now)
    children.forEach((c, i) => {
      const last = i === children.length - 1
      const group = together.get(c.id)
      const connector = group ? (last ? '╘═' : '╞═') : last ? '└─' : '├─'
      const tag = group ? `  ∥ ×${group.members.length}` : ''
      out.push(`${prefix}${connector} ${line(c)}   ${dur(span(c, now))}${size(c)}${tag}`)
      walk(c, prefix + (last ? '   ' : group ? '║  ' : '│  '))
    })
  }
  walk(top, '')
  return out.join('\n')
}
