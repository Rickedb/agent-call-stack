import type { Node } from '../types'
import { toolName } from '../names'
import { callsOn, type Resource } from '../resources'
import { block } from './blocks'
import { sequenceHtml } from './sequence'
import { promptOf, timesOf } from './context'
import { modelOf } from '../stats'
import { button, delta, dur, esc, icon, mark, modelName, RES_GLYPH, span, statusWord, tint, tokText } from './format'
import type { Ctx } from './types'

/**
 * A row's details, in a modal over the view: its state, timing, sizes, then its input and output. A click on the backdrop, the close
 * buttons or Esc (media/main.js) closes it. The view can be short, so the body
 * scrolls inside the dialog and not the page behind.
 */
export const modal = (c: Ctx, n: Node): string => {
  const { t0, t1 } = timesOf(c, promptOf(c, n))
  const took = span(n, c.v.now)
  const model = modelOf(c.list, n)
  const title = n.kind === 'prompt' ? `Prompt ${c.promptNo.get(n.id)}` : toolName(n)
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
        ${model && n.kind !== 'event' ? `<div class="dim">${n.model ? 'model' : 'called by'} ${esc(modelName(model))}</div>` : ''}
        ${n.why && n.kind !== 'event' ? `<div class="tint-err">why: ${esc(n.why)}</div>` : ''}
        ${n.compact ? `<div class="dim">${esc(n.compact.trigger || 'compaction')} · the host reports no size, length or summary for it</div>` : ''}
        ${
          n.transcript
            ? `<div class="dim transcript"><span title="${esc(n.transcript)}">transcript ${esc(n.transcript)}</span> ${button('copyTranscript', 'Copy transcript path', `data-id="${esc(n.id)}"`, 'plain')}</div>`
            : ''
        }
        ${sequenceHtml(n)}
        ${block(c, n, 'input')}
        ${block(c, n, 'output')}
      </div>
      <div class="modal-foot">${button('close', 'Close', '', '')}</div>
    </div>
  </div>`
}

const KIND = { file: 'file', link: 'address', command: 'command', query: 'search', more: '' } as const

/**
 * The details of something a call involved, in a modal: the whole path, address or command, what the
 * call did with it, and every call of the prompt that involved the same one, each a button that opens
 * that call's details.
 */
export const resourceModal = (c: Ctx, call: Node, r: Resource): string => {
  const same = callsOn(c.below(promptOf(c, call)), r)
  const added = same.reduce((n, x) => n + x.added, 0)
  const removed = same.reduce((n, x) => n + x.removed, 0)
  const title = `${RES_GLYPH[r.kind]} ${r.label}`
  return `<div class="overlay">
    <div class="backdrop" data-act="close"></div>
    <div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}" tabindex="-1">
      <div class="modal-head">
        <div class="modal-title">
          <b>${esc(title)}</b>
          <span class="dim"> · ${KIND[r.kind]} · ${esc(r.op)} by ${esc(toolName(call))} ${dur(span(call, c.v.now))}</span>
        </div>
        ${button('close', '✕', 'title="Close (Esc)" aria-label="Close"', 'plain')}
      </div>
      <div class="modal-body">
        <div class="modal-arg${r.kind === 'command' ? ' mono' : ''}">${esc(r.full)}</div>
        ${r.kind === 'command' ? sequenceHtml(call) : ''}
        ${r.added || r.removed ? `<div class="dim">this call ${delta(r.added, r.removed)}</div>` : ''}
        ${
          same.length > 1 || added || removed
            ? `<div class="dim">${same.length} ${same.length === 1 ? 'call' : 'calls'} in this prompt${added || removed ? ` · in all ${delta(added, removed)}` : ''}</div>
        <div class="tv-calls">${same
          .map(
            x =>
              `<button class="tv-call ${x.node.status === 'err' ? 'tint-err' : 'dim'}${x.node.id === call.id ? ' sel' : ''}" data-act="select" data-id="${esc(x.node.id)}">${esc(toolName(x.node))} ${dur(span(x.node, c.v.now))}${x.node.status === 'err' ? ' ✗' : ''}${x.node.status === 'ok' ? delta(x.added, x.removed) : ''}</button>`,
          )
          .join('')}</div>`
            : ''
        }
      </div>
      <div class="modal-foot">${button('select', 'Open the call', `data-id="${esc(call.id)}"`, '')}${button('close', 'Close', '', '')}</div>
    </div>
  </div>`
}
