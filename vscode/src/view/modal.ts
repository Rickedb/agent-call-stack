import type { Node } from '../types'
import { block } from './blocks'
import { promptOf, timesOf } from './context'
import { button, dur, esc, icon, mark, span, statusWord, tint, tokText } from './format'
import type { Ctx } from './types'

/**
 * A row's details, in a modal over the view: its state, timing, sizes, then its input and output. A click on the backdrop, the close
 * buttons or Esc (media/main.js) closes it. The view can be short, so the body
 * scrolls inside the dialog and not the page behind.
 */
export const modal = (c: Ctx, n: Node): string => {
  const { t0, t1 } = timesOf(c, promptOf(c, n))
  const took = span(n, c.v.now)
  const title = n.kind === 'prompt' ? `Prompt ${c.promptNo.get(n.id)}` : n.name
  return `<div class="overlay">
    <div class="backdrop" data-act="close"></div>
    <div class="modal tint-${tint(n)}-border" role="dialog" aria-modal="true" aria-label="${esc(title)}" tabindex="-1">
      <div class="modal-head">
        <div class="modal-title">
          <b class="tint-${tint(n)}">${icon(n)} ${mark(n)}</b> <b>${esc(title)}</b>
          <span class="dim"> · ${n.kind} · ${statusWord(n)}</span>
        </div>
        ${button('close', '✕', 'title="Close (Esc)" aria-label="Close"', 'plain')}
      </div>
      <div class="modal-body">
        ${n.arg ? `<div class="modal-arg">${esc(n.arg)}</div>` : ''}
        <div class="dim">started +${dur(n.start - t0)} · took ${dur(took)} · ${Math.min(100, Math.round((took / t1) * 100))}% of prompt</div>
        <div class="dim">input ${tokText(n, 'input')} · output ${tokText(n, 'output')}</div>
        ${block(c, n, 'input')}
        ${block(c, n, 'output')}
      </div>
      <div class="modal-foot">${button('close', 'Close', '', '')}</div>
    </div>
  </div>`
}
