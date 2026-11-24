import type { Node } from '../types'
import { slowestOf, timesOf } from './context'
import { toolArg, toolName } from '../names'
import { MAX_RESOURCES, openId, resourcesOf, type Resource } from '../resources'
import { clip, delta, dur, esc, icon, mark, modelName, RES_GLYPH, sizeOf, span, tint, tokText } from './format'
import { report } from './report'
import { tagOf } from './tags'
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
    // What a call involved stays shut until the person opens it.
    const res = v.folded.has(openId(n.id)) ? resourcesOf(n) : []
    const shut = res.length === 0 ? resourcesOf(n).length : 0
    rows.push({ node: n, depth, hidden: isFolded ? below(n).length : shut, trail, isLast })
    if (isFolded) return
    const sibs = kids.get(n.id) ?? []
    const next = depth === 0 ? [] : [...trail, { last: isLast }]
    // What the call involved comes first, then what it started.
    const shown: Resource[] = res.slice(0, MAX_RESOURCES)
    if (res.length > shown.length) {
      shown.push({ id: `more:${n.id}`, kind: 'more', label: `+${res.length - shown.length} more`, full: '', op: '', added: 0, removed: 0 })
    }
    shown.forEach((r, i) => rows.push({ node: n, res: r, depth: depth + 1, hidden: 0, trail: next, isLast: sibs.length === 0 && i === shown.length - 1 }))
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

  // A row under a call: a file it involved (the name only), an address it fetched, a command it ran,
  // what it searched for. A click opens its details in the modal. No time and no bar of its own.
  const resRow = (r: Place): string => {
    const res = r.res as Resource
    return `<div class="item">
        ${lanes(r)}
        <div class="row res${res.id === v.selected ? ' sel' : ''}">
          <span class="indent" style="width:${r.depth * 14}px"></span>
          <span class="fold"></span>
          ${
            res.kind === 'more'
              ? `<span class="dim">${esc(res.label)}</span>`
              : `<button class="label" data-act="select" data-id="${esc(res.id)}" title="${esc(clip(res.full, 400))}">
            <span class="dim">${RES_GLYPH[res.kind]}</span>
            <span class="res-name${res.kind === 'command' ? ' mono' : ''}">${esc(res.label)}</span>
            <span class="dim">${esc(res.op)}</span>${delta(res.added, res.removed)}
          </button>`
          }
        </div>
      </div>`
  }

  const row = (r: Place): string => {
    if (r.res) return resRow(r)
    const { node, depth, hidden } = r
    const hasKids = (kids.get(node.id) ?? []).length > 0
    // The arrow folds the call's children; a call with only things it involved opens and shuts those.
    const hasRes = !hasKids && resourcesOf(node).length > 0
    const arrowId = hasRes ? openId(node.id) : node.id
    const isShut = hasRes ? !v.folded.has(arrowId) : v.folded.has(arrowId)
    // What the call itself took, not the time before it (the bar shows where it started); a prompt's is its total.
    const right = dur(span(node, v.now))
    const name = node.kind === 'prompt' ? `Prompt ${c.promptNo.get(node.id)}` : toolName(node)
    const id = esc(node.id)
    return `<div class="item">
        ${lanes(r)}
        <div class="row${node.id === v.selected ? ' sel' : ''}">
          <span class="indent" style="width:${depth * 14}px"></span>
          ${
            hasKids || hasRes
              ? `<button class="fold" data-act="fold" data-id="${esc(arrowId)}" title="${hasRes ? 'Show what it involved' : 'Fold'}">${isShut ? '▸' : '▾'}</button>`
              : '<span class="fold"></span>'
          }
          <button class="label" data-act="select" data-id="${id}" title="${esc(clip(node.arg, 400))}">
            <span>${icon(node)}</span>
            ${isWaterfall ? '' : `<span class="tint-${tint(node)}">${mark(node)}</span>`}
            <span class="${node.kind === 'tool' || node.kind === 'event' ? '' : 'strong'}">${esc(name)}</span>
            ${isWaterfall && node.status === 'err' ? `<span class="tint-err" title="Failed">${mark(node)}</span>` : ''}
            ${node.model ? `<span class="model" title="The model that answered">${esc(modelName(node.model))}</span>` : ''}
            ${(() => {
              const tag = tagOf(node)
              return tag ? `<span class="tag ${tag.cls}" title="${esc(node.why ?? tag.text)}">${esc(tag.text)}</span>` : ''
            })()}
            ${toolArg(node) ? `<span class="dim arg">${esc(clip(toolArg(node), 160))}</span>` : ''}
            ${hidden ? `<span class="dim">+${hidden}</span>` : ''}
          </button>
          ${node === slowest && rows.filter(x => !x.res).length > 3 ? '<span class="warn">slowest</span>' : ''}
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
