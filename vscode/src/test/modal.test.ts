import * as assert from 'node:assert/strict'
import { test } from 'node:test'

import { Session } from '../model'
import { renderBody, type View } from '../render'
import type { Ev } from '../types'

let t = 1000
const ev = (e: Partial<Ev> & Pick<Ev, 'kind'>): Ev => ({ v: 1, t: (t += 100), sid: 's', ...e })
const session = (...events: Ev[]) => {
  const s = new Session('s')
  events.forEach(e => s.apply(e))
  return s
}
const view = (over: Partial<View> = {}): View => ({
  mode: 'waterfall',
  selected: '',
  folded: new Set(),
  shown: new Set(),
  now: t + 500,
  hooksInstalled: true,
  hooksOff: false,
  hasWorkspace: true,
  sessions: [],
  picked: '',
  ...over,
})

const demo = () =>
  session(
    ev({ kind: 'prompt', arg: 'first ask', input: 'first ask' }),
    ev({ kind: 'tool_pre', tool: 'Old', toolUseId: 'o', arg: 'old arg', input: 'command: old' }),
    ev({ kind: 'tool_post', tool: 'Old', toolUseId: 'o', output: 'old out' }),
    ev({ kind: 'prompt', arg: 'second ask', input: 'second ask' }),
    ev({ kind: 'tool_pre', tool: 'Bash', toolUseId: 'b', arg: 'npm test', input: 'command: npm test', inputLen: 17 }),
    ev({ kind: 'tool_post', tool: 'Bash', toolUseId: 'b', output: 'file one\nfile two', outputLen: 17 }),
  )
const find = (s: Session, name: string) => s.nodes.find(n => n.name === name)?.id ?? ''

test('nothing is selected, no modal; a selected row opens one, as a dialog', () => {
  const s = demo()
  assert.doesNotMatch(renderBody(s, view()), /class="modal /)
  const html = renderBody(s, view({ selected: find(s, 'Bash') }))
  assert.equal(html.match(/class="modal /g)?.length, 1)
  assert.match(html, /role="dialog" aria-modal="true" aria-label="Bash"/)
})

test('details do not open inline: the row stays one line and the modal holds the text', () => {
  const s = demo()
  const html = renderBody(s, view({ selected: find(s, 'Bash') }))
  assert.doesNotMatch(html, /class="details/)
  // The text of the call is in the modal, after every row, and not among them.
  const rows = html.indexOf('class="section')
  const dialog = html.indexOf('class="modal ')
  const output = html.indexOf('file two')
  assert.ok(rows < dialog && dialog < output)
  assert.match(html, /command: npm test/)
  assert.match(html, /input ~5 tok · output ~5 tok/)
})

test('the modal says what the call is: kind, state, full argument and timing', () => {
  const s = demo()
  const html = renderBody(s, view({ selected: find(s, 'Bash') }))
  assert.match(html, /tool · Done/)
  assert.match(html, /class="modal-arg">npm test</)
  assert.match(html, /started \+\d+(ms|\.\ds) · took \d+/)
  assert.match(html, /% of prompt/)
})

test('it can be closed by the backdrop, the cross and the button', () => {
  const s = demo()
  const html = renderBody(s, view({ selected: find(s, 'Bash') }))
  assert.match(html, /class="backdrop" data-act="close"/)
  assert.equal(html.match(/data-act="close"/g)?.length, 3)
})

test('a row of an older prompt is timed against its own prompt', () => {
  const s = demo()
  const old = find(s, 'Old')
  const html = renderBody(s, view({ selected: old }))
  // 100 ms after its prompt, not after the newer one.
  assert.match(html, /started \+100ms/)
})

test('a prompt opens in the modal too, with its whole text', () => {
  const s = demo()
  const prompt = s.nodes.filter(n => n.kind === 'prompt')[1]
  const html = renderBody(s, view({ selected: prompt?.id ?? '' }))
  assert.match(html, /aria-label="Prompt 2"/)
  assert.match(html, /<pre>second ask<\/pre>/)
})

test('a selected id that is gone opens nothing; the picked row is highlighted', () => {
  const s = demo()
  assert.doesNotMatch(renderBody(s, view({ selected: 'nope' })), /class="modal /)
  assert.match(renderBody(s, view({ selected: find(s, 'Bash') })), /class="row sel"/)
})

test('what a call says cannot add markup to the modal', () => {
  const s = session(
    ev({ kind: 'prompt', arg: 'p' }),
    ev({ kind: 'tool_pre', tool: '<b>x</b>', toolUseId: 'a', arg: '"><script>bad()</script>', input: '<img src=x onerror=1>' }),
    ev({ kind: 'tool_post', tool: '<b>x</b>', toolUseId: 'a', output: '</pre><script>bad()</script>' }),
  )
  const html = renderBody(s, view({ selected: s.nodes.find(n => n.kind === 'tool')?.id ?? '' }))
  assert.doesNotMatch(html, /<script/i)
  assert.doesNotMatch(html, /<img/i)
  assert.doesNotMatch(html, /<b>x/)
})

test('"Show all" still works inside the modal', () => {
  const lines = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n')
  const s = session(
    ev({ kind: 'prompt', arg: 'p' }),
    ev({ kind: 'tool_pre', tool: 'Bash', toolUseId: 'a' }),
    ev({ kind: 'tool_post', tool: 'Bash', toolUseId: 'a', output: lines }),
  )
  const id = find(s, 'Bash')
  assert.match(renderBody(s, view({ selected: id })), /Show all 50 lines/)
  assert.match(renderBody(s, view({ selected: id, shown: new Set([`${id}:output`]) })), /line 49/)
})
