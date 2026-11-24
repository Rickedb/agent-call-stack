import { toolName } from '../names'
import { callLines, changeIn, commonDir, touchedOf, type FileTouch } from '../touched'
import type { Node } from '../types'
import { clip, dur, esc, span, tokCount } from './format'
import type { Ctx } from './types'

const MAX_CALLS = 40
const MAX_FILES = 30

// What one prompt touched, short: a tree of its tool calls in the order they ran, each with the files
// it touched under it and the lines it added and took out; then a summary of each file (what was done
// to it, the lines in all) and the total. The commands run and the things looked up are calls too, and
// the time the calls took shows against the prompt's own. A call is a button that opens its details in
// the modal, as a row does in the other views.
export const touchedView = (c: Ctx, top: Node): string => {
  const { v } = c
  const t = touchedOf(top, c.below(top), v.now)
  const isFolded = v.folded.has(top.id)
  const root = commonDir(t.files.map(f => f.path))
  const rel = (p: string) => (root && p.startsWith(`${root}/`) ? p.slice(root.length + 1) : p)

  // Lines added and taken out: nothing when neither.
  const delta = (added: number, removed: number): string =>
    added || removed
      ? `<span class="tv-delta" title="Lines added and taken out, from the calls' arguments"><span class="tv-add">+${added}</span> <span class="tv-del">−${removed}</span></span>`
      : ''

  const badge = (cls: string, text: string, title = '') =>
    `<span class="badge ${cls}"${title ? ` title="${esc(title)}"` : ''}>${text}</span>`
  const tokBadge = (n: number) => (n > 0 ? badge('tok', tokCount(n), 'Estimated tokens in and out of these calls') : '')

  // One call: its tool as a button (the time, a mark if it failed), what it ran or looked for, and the
  // files it touched under it, each with the lines of that call.
  const callHtml = (n: Node): string => {
    const touch = n.touch!
    const cls = n.status === 'err' ? 'tint-err' : n.status === 'run' ? 'tint-run' : 'dim'
    const isFiles = touch.op !== 'run' && touch.op !== 'search' && touch.op !== 'web'
    const what = isFiles ? '' : (touch.what || touch.paths.join(' ')).replace(/\s+/g, ' ').trim()
    const sum = callLines(n)
    const paths = isFiles ? touch.paths : []
    const files = paths
      .map(p => {
        const ch = changeIn(n, p)
        return `<div class="tv-line"><span class="tv-name" title="${esc(p)}"><bdi>${esc(rel(p))}</bdi></span><span class="dim">${touch.op === 'other' ? '·' : touch.op}</span>${ch ? delta(ch.added, ch.removed) : ''}</div>`
      })
      .join('')
    return `<div class="tv-node">
        <div class="tv-line">
          <button class="tv-call ${cls}${n.id === v.selected ? ' sel' : ''}" data-act="select" data-id="${esc(n.id)}" title="${esc(clip(n.arg, 200))}">${esc(toolName(n))} ${dur(span(n, v.now))}${n.status === 'err' ? ' ✗' : ''}</button>
          ${what ? `<span class="tv-name dim${touch.op === 'run' ? ' mono' : ''}" title="${esc(what)}">${esc(what)}</span>` : ''}
          ${paths.length > 1 ? delta(sum.added, sum.removed) : ''}
        </div>
        ${files ? `<div class="tv-kids">${files}</div>` : ''}
      </div>`
  }

  // One file, in the summary: what was done to it, the lines in all, the time of its calls.
  const fileHtml = (f: FileTouch): string => {
    const isChanged = f.edits + f.writes > 0
    const ops = [f.reads ? `R${f.reads}` : '', f.edits ? `E${f.edits}` : '', f.writes ? `W${f.writes}` : '', f.others ? `·${f.others}` : '']
      .filter(Boolean)
      .join(' ')
    const flags = [f.rereads ? `re-read ${f.rereads}×` : '', f.retries ? `retried ${f.retries}×` : ''].filter(Boolean).join(' · ')
    return `<div class="tv-line">
          <span class="tv-name${isChanged ? ' strong tint-prompt' : ''}" title="${esc(f.path)}"><bdi>${esc(rel(f.path))}</bdi></span>
          ${flags ? `<span class="warn" title="Read again with nothing written in between, or tried again right after a failure">${flags}</span>` : ''}
          ${f.failed ? `<span class="tint-err">✗${f.failed}</span>` : ''}
          <span class="dim" title="R read · E edit · W write">${ops}</span>
          ${delta(f.added, f.removed)}
          ${tokBadge(f.tokens)}
          ${badge('time', dur(f.ms), 'The time of its calls added up')}
        </div>`
  }

  const under = root ? ` · under …${esc(root.slice(-60))}` : ''
  const callsBlock = (): string =>
    t.calls.length
      ? `<div class="tv-block"><div class="dim tv-title">CALLS${under}</div>
        <div class="tv-tree">${t.calls.slice(0, MAX_CALLS).map(callHtml).join('')}</div>
        ${t.calls.length > MAX_CALLS ? `<div class="dim">+${t.calls.length - MAX_CALLS} more calls</div>` : ''}
      </div>`
      : ''

  const filesBlock = (): string =>
    t.files.length
      ? `<div class="tv-block"><div class="dim tv-title">FILES${under}</div>
        ${t.files.slice(0, MAX_FILES).map(fileHtml).join('')}
        ${t.files.length > MAX_FILES ? `<div class="dim">+${t.files.length - MAX_FILES} more files</div>` : ''}
        <div class="tv-line tv-total"><b>Total</b><span class="tv-name dim">${t.files.length} ${t.files.length === 1 ? 'file' : 'files'} · ${t.edited} changed</span>${delta(t.added, t.removed)}</div>
      </div>`
      : ''

  const runs = t.commands.reduce((n, g) => n + g.calls.length, 0)
  const looks = t.lookups.reduce((n, g) => n + g.calls.length, 0)
  const isEmpty = t.calls.length === 0
  const idle = Math.max(0, t.wall - t.busy)
  const counts = [
    t.files.length ? `${t.files.length} ${t.files.length === 1 ? 'file' : 'files'} (${t.edited} changed, ${t.readOnly} read only)` : '',
    t.added || t.removed ? `+${t.added} −${t.removed} lines` : '',
    runs ? `${runs} ${runs === 1 ? 'command' : 'commands'}${t.commands.length !== runs ? ` (${t.commands.length} distinct)` : ''}` : '',
    looks ? `${looks} ${looks === 1 ? 'lookup' : 'lookups'}` : '',
  ].filter(Boolean)

  return `<div class="section tv">
      <div class="tv-head">
        <button class="fold" data-act="fold" data-id="${esc(top.id)}" title="Fold">${isFolded ? '▸' : '▾'}</button>
        <b>Prompt ${c.promptNo.get(top.id)}</b>
        <span class="dim tv-arg">${esc(clip(top.arg, 160))}</span>
      </div>
      ${
        isFolded
          ? ''
          : `<div class="dim">${isEmpty ? 'nothing touched: no file, command or lookup' : esc(counts.join(' · '))}</div>
      ${isEmpty ? '' : `<div class="dim">calls ran ${dur(t.busy)} of ${dur(t.wall)} · model and other time ${dur(idle)}</div>`}
      ${callsBlock()}
      ${filesBlock()}`
      }
    </div>`
}
