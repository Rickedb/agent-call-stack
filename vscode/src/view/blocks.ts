import type { Node } from '../types'
import { button, esc } from './format'
import { LINES, type Ctx } from './types'

// One text of a call, drawn whole and wrapped; the first lines until
// "Show all". A cut text says so, and where the whole is.
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
