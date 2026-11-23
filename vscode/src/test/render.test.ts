import * as assert from 'node:assert/strict'
import { test } from 'node:test'

import { Session } from '../model'
import { renderBody, renderText, tokText, type View } from '../render'
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
  hasWorkspace: true,
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

test('before the hooks are installed the panel says so and offers the buttons', () => {
  const html = renderBody(undefined, view({ hooksInstalled: false }))
  assert.match(html, /Call Tree is not set up yet/)
  assert.match(html, /data-act="installUser"[^>]*>Install for all workspaces</)
  assert.match(html, /data-act="installWorkspace"[^>]*>This workspace only</)
  // And where to look if it still does not work.
  assert.match(html, /data-act="openSettings"/)
  assert.match(html, /node<\/code> on your PATH/)
})

test('with no folder open there is no workspace button', () => {
  const html = renderBody(undefined, view({ hooksInstalled: false, hasWorkspace: false }))
  assert.match(html, /data-act="installUser"/)
  assert.doesNotMatch(html, /data-act="installWorkspace"/)
})

test('once installed, an empty session says what to do and offers no install', () => {
  const html = renderBody(undefined, view())
  assert.match(html, /No calls yet/)
  assert.match(html, /Send a prompt to Copilot in agent mode/)
  assert.doesNotMatch(html, /data-act="install/)
  assert.match(html, /data-act="openSettings"/)
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

test('each row shows its output tokens, estimated; details show input and output', () => {
  const s = session(
    ev({ kind: 'prompt', arg: 'p' }),
    // "command: ls" is 11 characters, ~3 tokens; "file one\nfile two" is 17, ~5.
    ev({ kind: 'tool_pre', tool: 'Bash', toolUseId: 'u', input: 'command: ls', inputLen: 11 }),
    ev({ kind: 'tool_post', tool: 'Bash', toolUseId: 'u', output: 'file one\nfile two', outputLen: 17 }),
    ev({ kind: 'tool_pre', tool: 'Read', toolUseId: 'r' }),
  )
  const call = s.nodes.find(n => n.name === 'Bash')
  const running = s.nodes.find(n => n.name === 'Read')

  for (const mode of ['tree', 'waterfall'] as const) {
    const html = renderBody(s, view({ mode }))
    assert.match(html, />~5 tok</)
    // The call still running has no output yet, so no figure.
    assert.equal(html.match(/class="dim tok"/g)?.length, 1)
  }

  const details = renderBody(s, view({ selected: call?.id ?? '' }))
  assert.match(details, /input ~3 tok · output ~5 tok/)
  assert.match(renderBody(s, view({ selected: running?.id ?? '' })), /input — · output —/)
})

test('the size comes from the whole text, not the cut one, and reads in k and M', () => {
  const big = (n: number) => tokText({ id: 'x', kind: 'tool', name: 'x', arg: '', status: 'ok', start: 0, output: 'cut', outputLen: n }, 'output')
  assert.equal(big(4), '~1 tok')
  assert.equal(big(50_000), '~13k tok')
  assert.equal(big(6_000), '~1.5k tok')
  assert.equal(big(8_000_000), '~2.0M tok')
})

test('the text tree shows output tokens too', () => {
  const s = session(
    ev({ kind: 'prompt', arg: 'p' }),
    ev({ kind: 'tool_pre', tool: 'Bash', toolUseId: 'u' }),
    ev({ kind: 'tool_post', tool: 'Bash', toolUseId: 'u', output: 'x'.repeat(40), outputLen: 40 }),
  )
  assert.match(renderText(s, t + 1000), /Bash.*~10 tok/)
})

test('the newest prompt is on top, numbered by when it came', () => {
  const s = session(
    ev({ kind: 'prompt', arg: 'first ask' }),
    ev({ kind: 'prompt', arg: 'second ask' }),
    ev({ kind: 'prompt', arg: 'third ask' }),
  )
  const html = renderBody(s, view())
  const at = (text: string) => html.indexOf(text)
  assert.ok(at('third ask') < at('second ask') && at('second ask') < at('first ask'))
  assert.ok(at('Prompt 3') < at('Prompt 2') && at('Prompt 2') < at('Prompt 1'))
})

test('a folded prompt hides its calls and its time axis; the open one keeps them', () => {
  const s = session(
    ev({ kind: 'prompt', arg: 'old ask' }),
    ev({ kind: 'tool_pre', tool: 'OldTool', toolUseId: 'a' }),
    ev({ kind: 'tool_post', tool: 'OldTool', toolUseId: 'a', output: 'x' }),
    ev({ kind: 'prompt', arg: 'new ask' }),
    ev({ kind: 'tool_pre', tool: 'NewTool', toolUseId: 'b' }),
  )
  const old = s.nodes.find(n => n.arg === 'old ask')
  const html = renderBody(s, view({ folded: new Set([old?.id ?? '']) }))
  assert.doesNotMatch(html, /OldTool/)
  assert.match(html, /NewTool/)
  // The old prompt says how many calls it holds; only the open one draws an axis.
  assert.match(html, /\+1/)
  assert.equal(html.match(/class="axis dim"/g)?.length, 1)
})

// A prompt with an agent, a tool before it, and two calls inside it that overlap.
const nested = () =>
  session(
    ev({ kind: 'prompt', arg: 'work' }),
    ev({ kind: 'tool_pre', tool: 'Before', toolUseId: 'b' }),
    ev({ kind: 'tool_post', tool: 'Before', toolUseId: 'b', output: 'x' }),
    ev({ kind: 'agent_start', agentId: 'ag', agentType: 'Explore' }),
    ev({ kind: 'tool_pre', tool: 'Grep', agentId: 'ag', toolUseId: 'g1', arg: 'one' }),
    ev({ kind: 'tool_pre', tool: 'Read', agentId: 'ag', toolUseId: 'g2', arg: 'two' }),
    ev({ kind: 'tool_post', tool: 'Grep', agentId: 'ag', toolUseId: 'g1', output: 'x' }),
    ev({ kind: 'tool_post', tool: 'Read', agentId: 'ag', toolUseId: 'g2', output: 'x' }),
    ev({ kind: 'agent_stop', agentId: 'ag', agentType: 'Explore' }),
  )

test('calls at the same time are marked, in the tree and in the waterfall', () => {
  for (const mode of ['tree', 'waterfall'] as const) {
    const html = renderBody(nested(), view({ mode }))
    // Grep and Read overlap: each says so, and its branch is drawn in the parallel color.
    assert.equal(html.match(/class="par-tag"/g)?.length, 2)
    assert.match(html, /parallel ×2/)
    assert.equal(html.match(/class="lane [lt] par"/g)?.length, 2)
  }
})

test('a call that ran alone has no parallel mark', () => {
  const s = session(
    ev({ kind: 'prompt', arg: 'p' }),
    ev({ kind: 'tool_pre', tool: 'A', toolUseId: 'a' }),
    ev({ kind: 'tool_post', tool: 'A', toolUseId: 'a', output: 'x' }),
    ev({ kind: 'tool_pre', tool: 'B', toolUseId: 'b' }),
    ev({ kind: 'tool_post', tool: 'B', toolUseId: 'b', output: 'x' }),
  )
  const html = renderBody(s, view())
  assert.doesNotMatch(html, /par-tag/)
  assert.doesNotMatch(html, /lane [lt] par/)
})

test('guide lines show the nesting: a line goes on past a branch that has more after it', () => {
  const html = renderBody(nested(), view({ mode: 'tree' }))
  // Before (not last, at depth 1) gets a tee; Explore (last) an elbow; and the calls
  // inside Explore see no line from Explore, as it is the last of its level.
  assert.match(html, /class="lane t"/)
  assert.match(html, /class="lane l"/)
  const s = nested()
  const before = s.nodes.find(n => n.name === 'Before')
  // The details name who a call ran with.
  const grep = s.nodes.find(n => n.name === 'Grep')
  const open = renderBody(s, view({ selected: grep?.id ?? '' }))
  assert.match(open, /class="par-text">Ran at the same time as 1 other: Read two/)
  assert.doesNotMatch(renderBody(s, view({ selected: before?.id ?? '' })), /class="par-text"/)
})

test('the text tree draws a parallel branch double', () => {
  const text = renderText(nested(), t + 1000)
  assert.match(text, /╞═ .*Grep.*∥ ×2/)
  assert.match(text, /╘═ .*Read.*∥ ×2/)
  assert.match(text, /├─ .*Before/)
  assert.match(text, /└─ .*Explore/)
})
