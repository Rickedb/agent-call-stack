import * as assert from 'node:assert/strict'
import { test } from 'node:test'

import { Session } from '../model'
import { renderBody, renderText, type View } from '../render'
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
  sessions: [],
  picked: '',
  ...over,
})

const basic = () =>
  session(
    ev({ kind: 'prompt', arg: 'list the files' }),
    ev({ kind: 'tool_pre', tool: 'Bash', arg: 'ls', toolUseId: 'u1', input: 'command: ls' }),
    ev({ kind: 'tool_post', tool: 'Bash', toolUseId: 'u1', output: 'file one\nfile two' }),
  )

test('an empty session says so, and offers the hooks when they are missing', () => {
  assert.match(renderBody(undefined, view()), /No calls yet/)
  assert.doesNotMatch(renderBody(undefined, view()), /Install hooks/)
  assert.match(renderBody(undefined, view({ hooksInstalled: false })), /data-act="install"/)
})

test('the waterfall lists each call with its start; the tree has no start offsets', () => {
  const s = basic()
  const wf = renderBody(s, view())
  assert.match(wf, /list the files/)
  assert.match(wf, /Bash/)
  assert.match(wf, /\+\d+ms/)
  assert.match(wf, /class="track"/)

  const tree = renderBody(s, view({ mode: 'tree' }))
  assert.doesNotMatch(tree, /\+\d+ms/)
  assert.doesNotMatch(tree, /class="track"/)
})

test('selecting a row shows its input and output', () => {
  const s = basic()
  const call = s.nodes.find(n => n.name === 'Bash')
  assert.doesNotMatch(renderBody(s, view()), /file two/)
  const open = renderBody(s, view({ selected: call?.id ?? '' }))
  assert.match(open, /file two/)
  assert.match(open, /command: ls/)
  assert.match(open, /% of prompt/)
})

test('text from a call cannot add markup to the pane', () => {
  const s = session(
    ev({ kind: 'prompt', arg: '<img src=x onerror=alert(1)>' }),
    ev({ kind: 'tool_pre', tool: 'Bash', toolUseId: 'u', arg: '"><script>alert(1)</script>', input: '<b>x</b>' }),
    ev({ kind: 'tool_post', tool: 'Bash', toolUseId: 'u', output: '</pre><script>bad()</script>' }),
  )
  const call = s.nodes.find(n => n.name === 'Bash')
  const html = renderBody(s, view({ selected: call?.id ?? '' }))
  assert.doesNotMatch(html, /<script/i)
  assert.doesNotMatch(html, /<img/i)
  assert.doesNotMatch(html, /<b>x/)
})

test('a cut text says so and offers the whole', () => {
  const s = session(
    ev({ kind: 'prompt', arg: 'big' }),
    ev({ kind: 'tool_pre', tool: 'Bash', toolUseId: 'u' }),
    ev({ kind: 'tool_post', tool: 'Bash', toolUseId: 'u', output: 'x'.repeat(8000), outputLen: 50000, outputFile: '/tmp/whole.txt' }),
  )
  const call = s.nodes.find(n => n.name === 'Bash')
  const html = renderBody(s, view({ selected: call?.id ?? '' }))
  assert.match(html, /first 8,000 of 50,000 characters/)
  assert.match(html, /Copy all/)
  assert.match(html, /Whole text: \/tmp\/whole\.txt/)
})

test('a long text shows 20 lines until "Show all"', () => {
  const lines = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n')
  const s = session(
    ev({ kind: 'prompt', arg: 'p' }),
    ev({ kind: 'tool_pre', tool: 'Bash', toolUseId: 'u' }),
    ev({ kind: 'tool_post', tool: 'Bash', toolUseId: 'u', output: lines }),
  )
  const call = s.nodes.find(n => n.name === 'Bash')
  const closed = renderBody(s, view({ selected: call?.id ?? '' }))
  assert.match(closed, /Show all 50 lines/)
  assert.doesNotMatch(closed, /line 30/)
  const open = renderBody(s, view({ selected: call?.id ?? '', shown: new Set([`${call?.id}:output`]) }))
  assert.match(open, /line 49/)
  assert.match(open, /Show less/)
})

test('a folded row hides its children and counts them', () => {
  const s = session(
    ev({ kind: 'prompt', arg: 'p' }),
    ev({ kind: 'tool_pre', tool: 'Bash', toolUseId: 'u', arg: 'ls' }),
  )
  const prompt = s.nodes[0]
  const html = renderBody(s, view({ folded: new Set([prompt?.id ?? '']) }))
  assert.doesNotMatch(html, /Bash/)
  assert.match(html, /\+1/)
})

test('the stack lists what runs, innermost first, above the tree', () => {
  const s = session(
    ev({ kind: 'prompt', arg: 'fix it' }),
    ev({ kind: 'agent_start', agentId: 'a', agentType: 'Explore' }),
    ev({ kind: 'tool_pre', tool: 'Grep', agentId: 'a', toolUseId: 'u', arg: 'auth' }),
  )
  const text = renderText(s, t + 1000)
  assert.match(text, /Stack \(innermost first\)\n  at 🔧 Grep\(auth\)/)
  assert.ok(text.indexOf('Grep(auth)') < text.indexOf('Explore'))
  assert.match(text, /💬 ● Prompt 1/)
  assert.match(text, /└─ 🔧 ● Grep\(auth\)/)
})
