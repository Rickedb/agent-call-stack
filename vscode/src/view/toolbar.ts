import { button, clip, esc } from './format'
import type { Ctx, View } from './types'

/**
 * What the panel says before there is anything to draw. Not set up: what is
 * missing and the buttons that set it up, so that no command palette is needed.
 * Set up: what to send, and where to look if nothing shows.
 */
export const empty = (v: View): string => {
  const setting = button('openSettings', 'Open the hooks setting', '', 'plain')
  if (v.hooksInstalled) {
    return `<div class="empty">
        <b>No calls yet</b>
        <p>Send a prompt to Copilot in agent mode and what it does shows up here, as a tree.</p>
        <p class="dim">Nothing showing up? Start a new agent chat, check that <code>node</code> is on your PATH and that agent hooks are enabled in VS Code. ${setting}</p>
      </div>`
  }
  return `<div class="empty">
        <b>Call Tree is not set up yet</b>
        <p>It reads what Copilot's agent does through hooks, and they are not installed. Install them once, then start a new agent chat.</p>
        <div class="actions">
          ${button('installUser', 'Install for all workspaces', '', 'primary')}
          ${v.hasWorkspace ? button('installWorkspace', 'This workspace only') : ''}
        </div>
        <p class="dim">Needs <code>node</code> on your PATH. Agent hooks are a preview feature of VS Code. ${setting}</p>
      </div>`
}

// The buttons above the rows: Tree or Waterfall, the session drop-down, and fold all.
export const toolbar = (c: Ctx): string => {
  const { v, list, kids } = c
  const foldable = list.filter(n => (kids.get(n.id) ?? []).length > 0).map(n => n.id)
  const isAllFolded = foldable.length > 0 && foldable.every(id => v.folded.has(id))
  const picker =
    v.sessions.length > 1
      ? `<select data-act="pick" title="Chat session">
          <option value=""${v.picked === '' ? ' selected' : ''}>Latest session</option>
          ${v.sessions
            .map(x => `<option value="${esc(x.id)}"${x.id === v.picked ? ' selected' : ''}>${esc(clip(x.label, 50))}</option>`)
            .join('')}
        </select>`
      : ''
  return `<div class="bar">
      <div class="seg">
        ${button('mode', 'Tree', 'data-v="tree"', c.isWaterfall ? '' : 'primary')}
        ${button('mode', 'Waterfall', 'data-v="waterfall"', c.isWaterfall ? 'primary' : '')}
      </div>
      ${picker}
      ${foldable.length ? button('foldAll', isAllFolded ? 'unfold all' : 'fold all', '', 'plain') : ''}
    </div>`
}

// How many prompts, and how many calls run, are done or failed.
export const summary = (c: Ctx): string => {
  const everyCall = c.prompts.flatMap(p => c.below(p))
  const total = {
    ok: everyCall.filter(n => n.status === 'ok').length,
    err: everyCall.filter(n => n.status === 'err').length,
    run: everyCall.filter(n => n.status === 'run').length,
  }
  return `<div class="summary">
      <span class="dim">${c.prompts.length} ${c.prompts.length === 1 ? 'prompt' : 'prompts'}</span>
      ${total.run ? `<span class="warn">● ${total.run} running</span>` : ''}
      <span class="tint-tool">✓ ${total.ok}</span>
      ${total.err ? `<span class="tint-err">✗ ${total.err} failed</span>` : ''}
    </div>`
}
