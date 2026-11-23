import { commonDir, touchedOf, type FileTouch, type Group } from '../touched'
import type { Node } from '../types'
import { clip, dur, esc, span, tokCount } from './format'
import { tagOf } from './tags'
import type { Ctx } from './types'

const MAX_FILES = 12
const MAX_GROUPS = 8
const MAX_CALLS = 6

// What one prompt touched, short: its files (what was done to each and the calls that did it), the
// commands it ran, and what it looked up, with the time the calls took against the prompt's own.
// A call is a button that opens its details in the modal, as a row does in the other views.
export const touchedView = (c: Ctx, top: Node): string => {
  const { v } = c
  const t = touchedOf(top, c.below(top), v.now)
  const isFolded = v.folded.has(top.id)
  const root = commonDir(t.files.map(f => f.path))
  const rel = (p: string) => (root && p.startsWith(`${root}/`) ? p.slice(root.length + 1) : p)

  const chain = (calls: Node[]): string => {
    const shown = calls.slice(0, MAX_CALLS)
    return `<div class="tv-calls">${shown
      .map(n => {
        const cls = n.status === 'err' ? 'tint-err' : n.status === 'run' ? 'tint-run' : 'dim'
        const tag = tagOf(n)
        return `<button class="tv-call ${cls}${n.id === v.selected ? ' sel' : ''}" data-act="select" data-id="${esc(n.id)}" title="${esc(clip(n.arg, 200))}">${esc(n.name)} ${dur(span(n, v.now))}${n.status === 'err' ? ' ✗' : ''}${tag ? ` <span class="tag ${tag.cls}">${esc(tag.text)}</span>` : ''}</button>`
      })
      .join('')}${calls.length > shown.length ? `<span class="dim">+${calls.length - shown.length}</span>` : ''}</div>`
  }

  const badge = (cls: string, text: string, title = '') =>
    `<span class="badge ${cls}"${title ? ` title="${esc(title)}"` : ''}>${text}</span>`
  const tokBadge = (n: number) => (n > 0 ? badge('tok', tokCount(n), 'Estimated tokens in and out of these calls') : '')

  const fileRow = (f: FileTouch): string => {
    const isChanged = f.edits + f.writes > 0
    const ops = [f.reads ? `R${f.reads}` : '', f.edits ? `E${f.edits}` : '', f.writes ? `W${f.writes}` : '', f.others ? `·${f.others}` : '']
      .filter(Boolean)
      .join(' ')
    const flags = [f.rereads ? `re-read ${f.rereads}×` : '', f.retries ? `retried ${f.retries}×` : ''].filter(Boolean).join(' · ')
    return `<div class="tv-entry">
        <div class="tv-line">
          <span class="tv-name${isChanged ? ' strong tint-prompt' : ''}" title="${esc(f.path)}"><bdi>${esc(rel(f.path))}</bdi></span>
          ${flags ? `<span class="warn" title="Read again with nothing written in between, or tried again right after a failure">${flags}</span>` : ''}
          ${f.failed ? `<span class="tint-err">✗${f.failed}</span>` : ''}
          <span class="dim" title="R read · E edit · W write">${ops}</span>
          ${tokBadge(f.tokens)}
          ${badge('time', dur(f.ms), 'The time of its calls added up')}
        </div>
        ${chain(f.calls)}
      </div>`
  }

  const groupRow = (g: Group): string => `<div class="tv-entry">
        <div class="tv-line">
          <span class="tv-name${g.kind === 'run' ? ' mono' : ''}" title="${esc(g.what)}">${esc(g.kind === 'run' ? g.what : `${g.calls[0]?.name ?? g.kind} ${g.what}`)}</span>
          ${g.calls.length > 1 ? `<span class="warn">×${g.calls.length}</span>` : ''}
          ${g.failed ? `<span class="tint-err">✗${g.failed}</span>` : ''}
          ${tokBadge(g.tokens)}
          ${badge('time', dur(g.ms), 'The time of its calls added up')}
        </div>
        ${chain(g.calls)}
      </div>`

  const block = <T>(title: string, items: T[], max: number, row: (x: T) => string, noun: string, more = ''): string =>
    items.length
      ? `<div class="tv-block"><div class="dim tv-title">${title}${more}</div>${items.slice(0, max).map(row).join('')}${
          items.length > max ? `<div class="dim">+${items.length - max} more ${noun}</div>` : ''
        }</div>`
      : ''

  const runs = t.commands.reduce((n, g) => n + g.calls.length, 0)
  const looks = t.lookups.reduce((n, g) => n + g.calls.length, 0)
  const isEmpty = t.files.length + t.commands.length + t.lookups.length === 0
  const idle = Math.max(0, t.wall - t.busy - t.waited)
  const counts = [
    t.files.length ? `${t.files.length} ${t.files.length === 1 ? 'file' : 'files'} (${t.edited} changed, ${t.readOnly} read only)` : '',
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
      ${isEmpty ? '' : `<div class="dim">calls ran ${dur(t.busy)} of ${dur(t.wall)} · model and other time ${dur(idle)}${t.waited ? ` · waited on you ${dur(t.waited)}` : ''}</div>`}
      ${block('FILES', t.files, MAX_FILES, fileRow, 'files', root ? ` · under …${esc(root.slice(-60))}` : '')}
      ${block('COMMANDS', t.commands, MAX_GROUPS, groupRow, 'commands')}
      ${block('LOOKUPS', t.lookups, MAX_GROUPS, groupRow, 'lookups')}`
      }
    </div>`
}
