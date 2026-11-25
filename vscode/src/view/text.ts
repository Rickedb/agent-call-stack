import type { Session } from '../model'
import { toolArg, toolName } from '../names'
import { MAX_RESOURCES, resourcesOf } from '../resources'
import { reportOf } from '../stats'
import type { Node } from '../types'
import { index } from './context'
import { clip, dur, icon, mark, modelName, RES_GLYPH, sizeOf, span, tokCount, tokText } from './format'

/**
 * The tree as plain text, for a chat reply (`@callstack`): the stack of what runs
 * now, innermost first, then the latest prompt as a tree.
 */
export const renderText = (s: Session | undefined, now: number): string => {
  if (!s) return 'No calls yet.'
  const prompts = s.nodes.filter(n => n.kind === 'prompt')
  const top = prompts[prompts.length - 1]
  if (!top) return 'No calls yet.'

  const { kids, below } = index(s.nodes)
  const line = (n: Node) => {
    const name = n.kind === 'prompt' ? `Prompt ${prompts.indexOf(n) + 1}` : toolName(n)
    const arg = toolArg(n) && n.kind !== 'prompt' ? `(${clip(toolArg(n), 60)})` : n.kind === 'prompt' ? ` ${clip(n.arg, 60)}` : ''
    const why = (n.kind === 'prompt' || n.kind === 'agent') && n.why ? ` [${clip(n.why, 40)}]` : ''
    return `${icon(n)} ${mark(n)} ${name}${n.model ? ` [${modelName(n.model)}]` : ''}${why}${arg}`
  }
  const size = (n: Node) => (sizeOf(n, 'output') > 0 ? `  ${tokText(n, 'output')}` : '')

  const out: string[] = []
  const live = below(top).filter(n => n.status === 'run')
  if (live.length) {
    out.push('Stack (innermost first)')
    for (const n of [...live].reverse()) out.push(`  at ${icon(n)} ${toolName(n)}${toolArg(n) ? `(${clip(toolArg(n), 60)})` : ''}  ${dur(span(n, now))}`)
    out.push('')
  }

  out.push(`${line(top)}   ${dur(span(top, now))}${size(top)}`)
  const walk = (n: Node, prefix: string) => {
    const children = kids.get(n.id) ?? []
    children.forEach((c, i) => {
      const last = i === children.length - 1
      out.push(`${prefix}${last ? '└─' : '├─'} ${line(c)}   ${dur(span(c, now))}${size(c)}`)
      const inner = prefix + (last ? '   ' : '│  ')
      // What the call involved: its files by name, the addresses it fetched, the command it ran.
      const res = resourcesOf(c)
      const rest = (kids.get(c.id) ?? []).length > 0
      const shown = res.slice(0, MAX_RESOURCES)
      const items = [
        ...shown.map(r => {
          const lines = r.added || r.removed ? ` +${r.added} −${r.removed}` : ''
          return `${RES_GLYPH[r.kind]} ${clip(r.label, 80)} ${r.op}${lines}`
        }),
        ...(res.length > shown.length ? [`+${res.length - shown.length} more`] : []),
      ]
      items.forEach((t, j) => out.push(`${inner}${j === items.length - 1 && !rest ? '└─' : '├─'} ${t}`))
      walk(c, inner)
    })
  }
  walk(top, '')

  // A prompt that has finished ends with its summary.
  const r = reportOf(top, below(top), now)
  if (r) {
    const took = (n: Node) => dur((n.end ?? now) - n.start)
    const named = (n: Node) => `${n.name}${n.arg ? ` ${clip(n.arg, 40)}` : ''}`
    out.push('', `Summary: ${r.calls} tool calls${r.failed ? `, ${r.failed} failed` : ''}, took ${dur(r.wall)}`)
    for (const k of r.kinds.slice(0, 8)) {
      out.push(`  ${k.name}  ${k.count}x${k.done ? `  avg ${dur(k.avg)}  total ${dur(k.ms)}` : ''}${k.failed ? `  ${k.failed} failed` : ''}`)
    }
    if (r.slowest) out.push(`  average ${dur(r.avg)} a tool call, slowest ${named(r.slowest)} ${took(r.slowest)}`)
    if (r.heaviest) out.push(`  heaviest ${named(r.heaviest)} ${tokCount(r.heavy)}`)
    if (r.compacts) out.push(`  compactions: ${r.compacts.count}`)
    for (const f of r.errors.slice(0, 5)) {
      out.push(`  error: ${f.node.kind === 'prompt' ? 'the prompt' : named(f.node)} — ${f.why}`)
    }
    if (r.errors.length > 5) out.push(`  …and ${r.errors.length - 5} more errors`)
    out.push(`  tokens (estimated): in ${tokCount(r.input)}, out ${tokCount(r.output)}, total ${tokCount(r.input + r.output)}`)
  }
  return out.join('\n')
}
