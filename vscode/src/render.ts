import type { Session } from './model'
import type { Node } from './types'

export type View = {
  mode: 'tree' | 'waterfall'
  /** The row whose details show; '' for none. */
  selected: string
  /** The ids of the rows whose children are folded away. */
  folded: Set<string>
  /** The texts shown whole, as `<id>:input` or `<id>:output`. */
  shown: Set<string>
  now: number
  hooksInstalled: boolean
  /** Every session of the workspace, newest first, and the one drawn. */
  sessions: { id: string; label: string }[]
  picked: string
}

/** Lines of a text drawn before "Show all". */
export const LINES = 20

export const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

export const clip = (s: string, n: number): string => {
  const one = s.replace(/\s+/g, ' ').trim()
  if (n <= 0) return ''
  return one.length > n ? one.slice(0, Math.max(1, n - 1)) + '…' : one
}

export const dur = (ms: number): string => {
  const m = Math.max(0, ms)
  if (m < 1000) return `${Math.round(m)}ms`
  if (m < 60000) return `${(m / 1000).toFixed(1)}s`
  return `${Math.floor(m / 60000)}m ${Math.round((m % 60000) / 1000)}s`
}

const KIND_ICON: Record<Node['kind'], string> = { prompt: '💬', agent: '🤖', tool: '🔧' }
const icon = (n: Node) => KIND_ICON[n.kind]
const mark = (n: Node) => (n.status === 'run' ? '●' : n.status === 'ok' ? '✓' : '✗')

// A class per tint; the stylesheet maps each to the editor theme's colors.
const tint = (n: Node) =>
  n.status === 'err'
    ? 'err'
    : n.status === 'run'
      ? 'run'
      : n.kind === 'prompt'
        ? 'prompt'
        : n.kind === 'agent'
          ? 'agent'
          : 'tool'

const span = (n: Node, now: number) => (n.end ?? now) - n.start

/** Children by parent; a node whose parent is gone has none above it. */
const index = (list: Node[]) => {
  const ids = new Set(list.map(n => n.id))
  const kids = new Map<string, Node[]>()
  for (const n of list) {
    if (n.parent && ids.has(n.parent)) kids.set(n.parent, [...(kids.get(n.parent) ?? []), n])
  }
  const below = (n: Node): Node[] => (kids.get(n.id) ?? []).flatMap(c => [c, ...below(c)])
  return { kids, below }
}

const button = (act: string, label: string, attrs = '', cls = '') =>
  `<button class="btn ${cls}" data-act="${act}" ${attrs}>${label}</button>`

const empty = (v: View): string =>
  v.hooksInstalled
    ? `<div class="empty"><b>No calls yet</b><p>Send a prompt to Copilot in agent mode and what it does shows up here, as a tree.</p></div>`
    : `<div class="empty"><b>No calls yet</b>
        <p>The call tree is filled by Copilot hooks, which are not installed yet.</p>
        ${button('install', 'Install hooks', '', 'primary')}</div>`

export const renderBody = (s: Session | undefined, v: View): string => {
  const list = s?.nodes ?? []
  const prompts = list.filter(n => n.kind === 'prompt')
  if (!s || prompts.length === 0) return empty(v)

  const { kids, below } = index(list)
  const isWaterfall = v.mode === 'waterfall'
  const promptNo = new Map(prompts.map((n, i) => [n.id, i + 1]))

  const everyCall = prompts.flatMap(p => below(p))
  const total = {
    ok: everyCall.filter(n => n.status === 'ok').length,
    err: everyCall.filter(n => n.status === 'err').length,
    run: everyCall.filter(n => n.status === 'run').length,
  }
  const foldable = list.filter(n => (kids.get(n.id) ?? []).length > 0).map(n => n.id)
  const isAllFolded = foldable.length > 0 && foldable.every(id => v.folded.has(id))

  // One text of a call, drawn whole and wrapped; the first lines until
  // "Show all". A cut text says so, and where the whole is.
  const block = (n: Node, which: 'input' | 'output'): string => {
    const text = which === 'input' ? n.input : n.output
    if (!text) return ''
    const len = (which === 'input' ? n.inputLen : n.outputLen) ?? text.length
    const file = which === 'input' ? n.inputFile : n.outputFile
    const key = `${n.id}:${which}`
    const split = text.split('\n')
    const isOpen = v.shown.has(key)
    const visible = isOpen ? split : split.slice(0, LINES)
    const isCut = len > text.length
    const attrs = `data-id="${esc(n.id)}" data-which="${which}"`
    return `<div class="block">
      <div class="dim">${which === 'input' ? 'INPUT' : 'OUTPUT'}${
        isCut ? ` · first ${text.length.toLocaleString('en-US')} of ${len.toLocaleString('en-US')} characters` : ''
      }</div>
      <pre>${esc(visible.join('\n'))}</pre>
      <div class="actions">
        ${split.length > LINES ? button('more', isOpen ? 'Show less' : `Show all ${split.length} lines`, attrs, 'plain') : ''}
        ${button('copy', file ? 'Copy all' : 'Copy', attrs, 'plain')}
        ${file ? button('copyPath', 'Copy file path', attrs, 'plain') : ''}
      </div>
      ${isCut ? `<div class="dim">${file ? `Whole text: ${esc(file)}` : 'The rest could not be saved.'}</div>` : ''}
    </div>`
  }

  const details = (n: Node, t0: number, t1: number): string => `
    <div class="details tint-${tint(n)}-border">
      <div>
        <b class="tint-${tint(n)}">${icon(n)} ${mark(n)} ${n.status === 'run' ? 'Running' : n.status === 'ok' ? 'Done' : 'Failed'}</b>
        <span class="dim"> · ${n.kind}</span>
        <div class="dim">started +${dur(n.start - t0)} · took ${dur(span(n, v.now))} · ${Math.min(
          100,
          Math.round((span(n, v.now) / t1) * 100),
        )}% of prompt</div>
      </div>
      ${block(n, 'input')}
      ${block(n, 'output')}
      ${button('close', 'Close', '', 'plain')}
    </div>`

  // One prompt: its own time axis and its rows, honoring folds.
  const section = (top: Node): string => {
    const all = [top, ...below(top)]
    const t0 = top.start
    const t1 = Math.max(1000, ...all.map(n => (n.end ?? v.now) - t0))
    const slowest = all
      .filter(n => n.kind !== 'prompt' && n.status !== 'run')
      .sort((a, b) => span(b, v.now) - span(a, v.now))[0]

    const rows: { node: Node; depth: number; hidden: number }[] = []
    const walk = (n: Node, depth: number) => {
      const isFolded = v.folded.has(n.id)
      rows.push({ node: n, depth, hidden: isFolded ? below(n).length : 0 })
      if (!isFolded) (kids.get(n.id) ?? []).forEach(c => walk(c, depth + 1))
    }
    walk(top, 0)

    const bar = (n: Node): string => {
      const off = Math.min(99, ((n.start - t0) / t1) * 100)
      const wide = Math.max(0.6, Math.min(100 - off, (span(n, v.now) / t1) * 100))
      return `<div class="track"><div class="fill tint-${tint(n)}-bg" style="margin-left:${off.toFixed(2)}%;width:${wide.toFixed(2)}%"></div></div>`
    }

    const row = ({ node, depth, hidden }: { node: Node; depth: number; hidden: number }): string => {
      const hasKids = (kids.get(node.id) ?? []).length > 0
      const ms = span(node, v.now)
      const right = isWaterfall ? `+${dur(node.start - t0)}  ${dur(ms)}` : dur(ms)
      const name = node.kind === 'prompt' ? `Prompt ${promptNo.get(node.id)}` : node.name
      const id = esc(node.id)
      return `<div class="item">
        <div class="row${node.id === v.selected ? ' sel' : ''}">
          <span class="indent" style="width:${depth * 14}px"></span>
          ${
            hasKids
              ? `<button class="fold" data-act="fold" data-id="${id}" title="Fold">${v.folded.has(node.id) ? '▸' : '▾'}</button>`
              : '<span class="fold"></span>'
          }
          <button class="label" data-act="select" data-id="${id}" title="${esc(clip(node.arg, 400))}">
            <span>${icon(node)}</span>
            <span class="tint-${tint(node)}">${mark(node)}</span>
            <span class="${node.kind === 'tool' ? '' : 'strong'}">${esc(name)}</span>
            ${node.arg ? `<span class="dim arg">${esc(clip(node.arg, 160))}</span>` : ''}
            ${hidden ? `<span class="dim">+${hidden}</span>` : ''}
          </button>
          ${node === slowest && rows.length > 3 ? '<span class="warn">slowest</span>' : ''}
          <span class="dim time">${right}</span>
        </div>
        ${isWaterfall ? bar(node) : ''}
        ${node.id === v.selected ? details(node, t0, t1) : ''}
      </div>`
    }

    return `<div class="section${isWaterfall ? ' wf' : ''}">
      ${
        isWaterfall
          ? `<div class="axis dim"><span>0</span><span>${dur(Math.round(t1 / 2))}</span><span>${dur(t1)}</span></div>`
          : ''
      }
      ${rows.map(row).join('')}
    </div>`
  }

  const picker =
    v.sessions.length > 1
      ? `<select data-act="pick" title="Chat session">
          <option value=""${v.picked === '' ? ' selected' : ''}>Latest session</option>
          ${v.sessions
            .map(x => `<option value="${esc(x.id)}"${x.id === v.picked ? ' selected' : ''}>${esc(clip(x.label, 50))}</option>`)
            .join('')}
        </select>`
      : ''

  return `
    <div class="bar">
      <div class="seg">
        ${button('mode', 'Tree', 'data-v="tree"', isWaterfall ? '' : 'primary')}
        ${button('mode', 'Waterfall', 'data-v="waterfall"', isWaterfall ? 'primary' : '')}
      </div>
      ${picker}
      ${foldable.length ? button('foldAll', isAllFolded ? 'unfold all' : 'fold all', '', 'plain') : ''}
    </div>
    <div class="summary">
      <span class="dim">${prompts.length} ${prompts.length === 1 ? 'prompt' : 'prompts'}</span>
      ${total.run ? `<span class="warn">● ${total.run} running</span>` : ''}
      <span class="tint-tool">✓ ${total.ok}</span>
      ${total.err ? `<span class="tint-err">✗ ${total.err} failed</span>` : ''}
    </div>
    ${prompts.map((top, i) => `${i > 0 ? '<hr>' : ''}${section(top)}`).join('')}`
}

/** The ids of the rows that have children, so that "fold all" knows them. */
export const foldableIds = (s: Session | undefined): string[] => {
  const list = s?.nodes ?? []
  const { kids } = index(list)
  return list.filter(n => (kids.get(n.id) ?? []).length > 0).map(n => n.id)
}

/** True when any call is still running: the bars grow with the clock. */
export const isRunning = (s: Session | undefined): boolean => !!s?.nodes.some(n => n.status === 'run')

/**
 * The tree as plain text, for a chat reply: the stack of what runs now,
 * innermost first, then the latest prompt as a tree.
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

  const out: string[] = []
  const live = below(top).filter(n => n.status === 'run')
  if (live.length) {
    out.push('Stack (innermost first)')
    for (const n of [...live].reverse()) out.push(`  at ${icon(n)} ${n.name}${n.arg ? `(${clip(n.arg, 60)})` : ''}  ${dur(span(n, now))}`)
    out.push('')
  }

  out.push(`${line(top)}   ${dur(span(top, now))}`)
  const walk = (n: Node, prefix: string) => {
    const children = kids.get(n.id) ?? []
    children.forEach((c, i) => {
      const last = i === children.length - 1
      out.push(`${prefix}${last ? '└─' : '├─'} ${line(c)}   ${dur(span(c, now))}`)
      walk(c, prefix + (last ? '   ' : '│  '))
    })
  }
  walk(top, '')
  return out.join('\n')
}
