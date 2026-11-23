import { button, clip, esc } from './format'
import type { Ctx, View } from './types'

/**
 * What the panel says before there is anything to draw. Not set up: what is
 * missing and the buttons that set it up, so that no command palette is needed.
 * Set up: what to send, and where to look if nothing shows.
 */
export const empty = (v: View): string => {
  const setting = button('openSettings', 'Open your Claude Code settings', '', 'plain')
  if (v.hooksInstalled) {
    // The settings button only when the setting is what is wrong.
    const off = v.hooksOff
      ? `<p class="warn">Hooks are turned off in your Claude Code settings (disableAllHooks), so nothing is recorded. ${setting}</p>`
      : ''
    return `<div class="empty">
        <b>No calls yet</b>
        <p>Send a prompt to Claude Code and what it does shows up here, as a tree.</p>
        ${off}
        <p class="dim">Nothing showing up? A session that was open when the hooks were added picks them up when it starts again. Check that <code>node</code> is on your PATH.</p>
      </div>`
  }
  return `<div class="empty">
        <b>Call Tree is not set up yet</b>
        <p>It reads what Claude Code does through hooks, and they are not in your Claude Code settings yet. Add them once (a backup of the file is kept), then send a prompt.</p>
        <div class="actions">
          ${button('installUser', 'Add to your settings', '', 'primary')}
          ${v.hasWorkspace ? button('installWorkspace', 'This workspace only (local settings)') : ''}
        </div>
        <p class="dim">Needs <code>node</code> on your PATH. ${setting}</p>
      </div>`
}

// The buttons above the rows: Tree or Waterfall, the session drop-down, and fold all.
// The drop-down of chat sessions, when there is more than one. It is drawn even when
// the session picked has nothing to show, so that another can always be picked.
export const picker = (v: View): string =>
  v.sessions.length > 1
    ? `<select data-act="pick" title="Chat session">
          <option value=""${v.picked === '' ? ' selected' : ''}>Latest session</option>
          ${v.sessions
            .map(x => `<option value="${esc(x.id)}"${x.id === v.picked ? ' selected' : ''}>${esc(clip(x.label, 50))}</option>`)
            .join('')}
        </select>`
    : ''

export const toolbar = (c: Ctx): string => {
  const { v, list, kids } = c
  const foldable = list.filter(n => (kids.get(n.id) ?? []).length > 0).map(n => n.id)
  const isAllFolded = foldable.length > 0 && foldable.every(id => v.folded.has(id))
  return `<div class="bar">
      <div class="seg">
        ${button('mode', 'Tree', 'data-v="tree"', c.isWaterfall || c.isFiles ? '' : 'primary')}
        ${button('mode', 'Waterfall', 'data-v="waterfall"', c.isWaterfall ? 'primary' : '')}
        ${button('mode', 'Touched', 'data-v="files" title="The files, commands and lookups of each prompt"', c.isFiles ? 'primary' : '')}
      </div>
      ${picker(v)}
      ${foldable.length && !c.isFiles ? button('foldAll', isAllFolded ? 'unfold all' : 'fold all', '', 'plain') : ''}
    </div>`
}

// How many prompts, and how many calls run, are done or failed.
export const summary = (c: Ctx): string => {
  const everyCall = c.prompts.flatMap(p => c.below(p)).filter(n => n.kind !== 'event')
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
