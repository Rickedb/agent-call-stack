import type { Node } from '../types'
import { slowestOf, timesOf } from './context'
import { clip, dur, esc, icon, mark, modelName, sizeOf, span, tint, tokText } from './format'
import { report } from './report'
import type { Ctx, Lane, Place } from './types'

// A prompt's section: its own time axis and its rows, honoring folds. A click on
// a row opens its details in the modal (see modal.ts); nothing opens inline.
export const section = (c: Ctx, top: Node): string => {
  const { v, kids, below, isWaterfall } = c
  const { t0, t1 } = timesOf(c, top)
  const slowest = slowestOf(c, top)

  // A row's place in the tree: for each level above it, whether that branch goes
  // on below (a guide line); and whether it is the last of its parent's children.
  const rows: Place[] = []
  const walk = (n: Node, depth: number, trail: Lane[], isLast: boolean) => {
    const isFolded = v.folded.has(n.id)
    rows.push({ node: n, depth, hidden: isFolded ? below(n).length : 0, trail, isLast })
    if (isFolded) return
    const sibs = kids.get(n.id) ?? []
    const next = depth === 0 ? [] : [...trail, { last: isLast }]
    sibs.forEach((k, i) => walk(k, depth + 1, next, i === sibs.length - 1))
  }
  walk(top, 0, [], true)

  // The guide lines of one row, drawn over the whole item (the row and its bar).
  const lanes = (r: Place): string => {
    if (r.depth === 0) return ''
    const at = (level: number) => `left:${(level - 1) * 14 + 6}px`
    const above = r.trail
      .map((l, i) => (l.last ? '' : `<i class="lane v" style="${at(i + 1)}"></i>`))
      .join('')
    return `${above}<i class="lane ${r.isLast ? 'l' : 't'}" style="${at(r.depth)}"></i>`
  }

  const bar = (n: Node): string => {
    const off = Math.min(99, ((n.start - t0) / t1) * 100)
    const wide = Math.max(0.6, Math.min(100 - off, (span(n, v.now) / t1) * 100))
    return `<div class="track"><div class="fill tint-${tint(n)}-bg" style="margin-left:${off.toFixed(2)}%;width:${wide.toFixed(2)}%"></div></div>`
  }

  const row = (r: Place): string => {
    const { node, depth, hidden } = r
    const hasKids = (kids.get(node.id) ?? []).length > 0
    // What the call itself took, not the time before it (the bar shows where it started); a prompt's is its total.
    const right = dur(span(node, v.now))
    const name = node.kind === 'prompt' ? `Prompt ${c.promptNo.get(node.id)}` : node.name
    const id = esc(node.id)
    return `<div class="item">
        ${lanes(r)}
        <div class="row${node.id === v.selected ? ' sel' : ''}">
          <span class="indent" style="width:${depth * 14}px"></span>
          ${
            hasKids
              ? `<button class="fold" data-act="fold" data-id="${id}" title="Fold">${v.folded.has(node.id) ? '▸' : '▾'}</button>`
              : '<span class="fold"></span>'
          }
          <button class="label" data-act="select" data-id="${id}" title="${esc(clip(node.arg, 400))}">
            <span>${icon(node)}</span>
            ${isWaterfall ? '' : `<span class="tint-${tint(node)}">${mark(node)}</span>`}
            <span class="${node.kind === 'tool' || node.kind === 'event' ? '' : 'strong'}">${esc(name)}</span>
            ${isWaterfall && node.status === 'err' ? `<span class="tint-err" title="Failed">${mark(node)}</span>` : ''}
            ${node.model ? `<span class="model" title="The model this prompt was sent to">${esc(modelName(node.model))}</span>` : ''}
            ${(node.kind === 'prompt' || node.kind === 'agent') && node.why ? `<span class="tag err" title="${esc(node.why)}">${esc(clip(node.why, 32))}</span>` : ''}
            ${node.arg ? `<span class="dim arg">${esc(clip(node.arg, 160))}</span>` : ''}
            ${hidden ? `<span class="dim">+${hidden}</span>` : ''}
          </button>
          ${node === slowest && rows.length > 3 ? '<span class="warn">slowest</span>' : ''}
          ${
            sizeOf(node, 'output') > 0
              ? `<span class="badge tok" title="Estimated output tokens (about 4 characters each)">${tokText(node, 'output')}</span>`
              : ''
          }
          <span class="badge time">${right}</span>
        </div>
        ${isWaterfall ? bar(node) : ''}
      </div>`
  }

  return `<div class="section${isWaterfall ? ' wf' : ''}">
      ${
        isWaterfall && !v.folded.has(top.id)
          ? `<div class="axis dim"><span>0</span><span>${dur(Math.round(t1 / 2))}</span><span>${dur(t1)}</span></div>`
          : ''
      }
      ${rows.map(row).join('')}
      ${v.folded.has(top.id) ? '' : report(c, top)}
    </div>`
}
