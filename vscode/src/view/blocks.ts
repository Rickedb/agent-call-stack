import type { Node } from '../types'
import { button, esc } from './format'
import { LINES, type Ctx } from './types'

// One text of a call, drawn whole and wrapped; the first lines until
// "Show all". A cut text says so, and where the whole is.
// The icons of the copy button on a code block: copy, and the check shown for a moment after a press.
const COPY_ICON =
  '<svg class="i-copy" viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M4 4V2.5A1.5 1.5 0 0 1 5.5 1h8A1.5 1.5 0 0 1 15 2.5v8a1.5 1.5 0 0 1-1.5 1.5H12v-1h1.5a.5.5 0 0 0 .5-.5v-8a.5.5 0 0 0-.5-.5h-8a.5.5 0 0 0-.5.5V4H4z"/><path d="M2.5 5A1.5 1.5 0 0 0 1 6.5v7A1.5 1.5 0 0 0 2.5 15h7a1.5 1.5 0 0 0 1.5-1.5v-7A1.5 1.5 0 0 0 9.5 5h-7zM2 6.5a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-.5.5h-7a.5.5 0 0 1-.5-.5v-7z"/></svg>'
const CHECK_ICON =
  '<svg class="i-check" viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M6.4 11.6 3 8.2l.9-.9 2.5 2.5 5.7-5.7.9.9z"/></svg>'

export const block = (c: Ctx, n: Node, which: 'input' | 'output'): string => {
  const text = which === 'input' ? n.input : n.output
  if (!text) return ''
  const len = (which === 'input' ? n.inputLen : n.outputLen) ?? text.length
  const file = which === 'input' ? n.inputFile : n.outputFile
  const key = `${n.id}:${which}`
  const split = text.split('\n')
  const isOpen = c.v.shown.has(key)
  const visible = isOpen ? split : split.slice(0, LINES)
  const isCut = len > text.length
  // A compaction's input is what it was told to keep.
  const label = n.kind === 'event' && n.name === 'Compact' && which === 'input' ? 'INSTRUCTIONS' : which === 'input' ? 'INPUT' : 'OUTPUT'
  const attrs = `data-id="${esc(n.id)}" data-which="${which}"`
  return `<div class="block">
      <div class="dim">${label}${
        isCut ? ` · first ${text.length.toLocaleString('en-US')} of ${len.toLocaleString('en-US')} characters` : ''
      }</div>
      <div class="code">
        <pre>${esc(visible.join('\n'))}</pre>
        <button class="copy-icon" data-act="copy" ${attrs} title="${file ? 'Copy the whole text' : 'Copy'}" aria-label="${file ? 'Copy the whole text' : 'Copy'}">${COPY_ICON}${CHECK_ICON}</button>
      </div>
      <div class="actions">
        ${split.length > LINES ? button('more', isOpen ? 'Show less' : `Show all ${split.length} lines`, attrs, 'plain') : ''}
        ${file ? button('copyPath', 'Copy file path', attrs, 'plain') : ''}
      </div>
      ${isCut ? `<div class="dim">${file ? `Whole text: ${esc(file)}` : 'The rest could not be saved.'}</div>` : ''}
    </div>`
}
