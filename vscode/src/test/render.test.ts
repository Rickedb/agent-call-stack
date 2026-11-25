import * as assert from 'node:assert/strict'
import { test } from 'node:test'

import { Session } from '../model'
import { renderBody, renderText, summaryMarkdown, tokText, type View } from '../render'
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
  shut: new Set(),
  now: t + 500,
  hooksInstalled: true,
  hooksOff: false,
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
  assert.match(html, /Agent Call Stack is not set up yet/)
  assert.match(html, /data-act="installUser"[^>]*>Install for all workspaces</)
  assert.match(html, /data-act="installWorkspace"[^>]*>This workspace only</)
  // And where to look if it still does not work.
  assert.match(html, /data-act="openSettings"/)
  assert.match(html, /or with VS Code itself when there is none/)
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
  // Hooks are set up and on: no button to a setting that is not the problem.
  assert.doesNotMatch(html, /data-act="openSettings"/)
})

test('the settings button shows only when VS Code has agent hooks turned off', () => {
  const html = renderBody(undefined, view({ hooksOff: true }))
  assert.match(html, /Agent hooks are turned off in VS Code/)
  assert.match(html, /data-act="openSettings"/)
})

test('a session with no prompt keeps the drop-down, so another can be picked', () => {
  const sessions = [
    { id: 'a', label: '(no prompt yet)' },
    { id: 'b', label: 'work' },
  ]
  const html = renderBody(new Session('a'), view({ sessions, picked: 'a' }))
  assert.match(html, /No calls yet/)
  assert.match(html, /<select data-act="pick"/)
  assert.match(html, /<option value="a" selected>/)
  assert.doesNotMatch(renderBody(new Session('a'), view()), /<select/)
})

test('a row shows what the call itself took, never a start offset; only the waterfall has the bar', () => {
  const s = basic()
  const wf = renderBody(s, view())
  assert.match(wf, /list the files/)
  assert.match(wf, /Bash/)
  // The time badge: the call's own, not the time elapsed before it. The bar says where it started.
  assert.match(wf, /<span class="badge time">\d+ms<\/span>/)
  assert.doesNotMatch(wf, /<span class="badge time">\+/)
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
  // The copy is an icon on the code block's corner, and says it copies the whole text.
  assert.match(html, /<button class="copy-icon" data-act="copy"[^>]*title="Copy the whole text"/)
  assert.doesNotMatch(html, />Copy all</)
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
    assert.equal(html.match(/class="badge tok"/g)?.length, 1)
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

test('guide lines show the nesting: a line goes on past a branch that has more after it', () => {
  const html = renderBody(nested(), view({ mode: 'tree' }))
  // Before (not last, at depth 1) gets a tee; Explore (last) an elbow; and the calls
  // inside Explore see no line from Explore, as it is the last of its level.
  assert.match(html, /class="lane t"/)
  assert.match(html, /class="lane l"/)
})

test('the text tree draws plain connectors, and marks nothing as parallel', () => {
  const text = renderText(nested(), t + 1000)
  assert.match(text, /├─ .*Before/)
  assert.match(text, /└─ .*Explore/)
  assert.doesNotMatch(text, /∥|╞|╘|║/)
})

const finished = () =>
  session(
    ev({ kind: 'prompt', arg: 'work', input: 'work' }),
    ev({ kind: 'tool_pre', tool: 'Read', arg: 'a.ts', toolUseId: 'r1', input: 'x'.repeat(40) }),
    ev({ kind: 'tool_post', tool: 'Read', toolUseId: 'r1', output: 'y'.repeat(4000) }),
    ev({ kind: 'tool_pre', tool: 'Read', arg: 'b.ts', toolUseId: 'r2' }),
    ev({ kind: 'tool_post', tool: 'Read', toolUseId: 'r2', output: 'ok' }),
    ev({ kind: 'tool_pre', tool: 'Bash', arg: 'ls', toolUseId: 'b1' }),
    ev({ kind: 'tool_post', tool: 'Bash', toolUseId: 'b1', output: 'z' }),
    ev({ kind: 'stop', output: 'done' }),
  )

test('a finished prompt ends with its summary; a running one has none', () => {
  const html = renderBody(finished(), view())
  assert.match(html, /class="report /)
  assert.match(html, /3 tool calls/)
  // By tool: Read twice, Bash once.
  assert.match(html, /<td class="name">Read<\/td>\s*<td>2<\/td>/)
  assert.match(html, /<td class="name">Bash<\/td>\s*<td>1<\/td>/)
  assert.match(html, /Slowest/)
  assert.match(html, /Heaviest<\/span><span class="val"[^>]*>Read a\.ts ~1\.0k tok/)
  assert.match(html, /in ~\d+ tok · out ~[\d.]+k tok · total ~[\d.]+k tok \(estimated\)/)
  assert.doesNotMatch(renderBody(basic(), view()), /class="report /)
})

test('a folded prompt hides its summary', () => {
  const s = finished()
  const top = s.nodes.find(n => n.kind === 'prompt')
  assert.doesNotMatch(renderBody(s, view({ folded: new Set([top?.id ?? '']) })), /class="report /)
})

test('the text tree ends with the summary of a finished prompt', () => {
  const text = renderText(finished(), t + 500)
  assert.match(text, /Summary: 3 tool calls/)
  assert.match(text, /Read {2}2x/)
  assert.match(text, /tokens \(estimated\): in ~\d+ tok, out ~[\d.]+k tok, total/)
  assert.doesNotMatch(renderText(basic(), t + 500), /Summary:/)
})

test('the summary has a copy button, and copies as markdown', () => {
  const s = finished()
  const top = s.nodes.find(n => n.kind === 'prompt')
  assert.match(renderBody(s, view()), new RegExp(`data-act="copySummary" data-id="${top?.id}"`))
  const md = summaryMarkdown(s, top?.id ?? '', t + 500) ?? ''
  assert.match(md, /^## Prompt 1 summary\n\n> work\n/)
  assert.match(md, /- \*\*Tool calls:\*\* 3 · took /)
  assert.match(md, /- \*\*Heaviest call:\*\* Read `a\.ts` ~1\.0k tok/)
  assert.match(md, /\| Tool \| Calls \| Avg \| Total \| Tokens \(est\.\) \|\n\| --- \| ---: \| ---: \| ---: \| ---: \|\n\| Read \| 2 \|/)
  // Nothing while it runs, or for an id that is not a prompt.
  assert.equal(summaryMarkdown(basic(), basic().nodes[0]?.id ?? '', t), undefined)
  assert.equal(summaryMarkdown(s, 'nope', t), undefined)
})

test('what a call says cannot break the markdown table or its code', () => {
  const s = session(
    ev({ kind: 'prompt', arg: 'p' }),
    ev({ kind: 'tool_pre', tool: 'Bash', arg: 'echo a | b `x`', toolUseId: 'u' }),
    ev({ kind: 'tool_post', tool: 'Bash', toolUseId: 'u', output: 'y'.repeat(400) }),
    ev({ kind: 'stop', output: 'done' }),
  )
  const md = summaryMarkdown(s, s.nodes[0]?.id ?? '', t + 500) ?? ''
  assert.match(md, /Heaviest call:\*\* Bash `echo a \| b 'x'`/)
})

test('the waterfall marks only a failure; the tree marks every status', () => {
  const s = session(
    ev({ kind: 'prompt', arg: 'p' }),
    ev({ kind: 'tool_pre', tool: 'Ok', toolUseId: 'a' }),
    ev({ kind: 'tool_post', tool: 'Ok', toolUseId: 'a', output: 'x' }),
    ev({ kind: 'tool_pre', tool: 'Denied', toolUseId: 'b' }),
    ev({ kind: 'tool_pre', tool: 'Slow', toolUseId: 'c' }),
    ev({ kind: 'tool_fail', tool: 'Denied', toolUseId: 'b', output: 'no' }),
  )
  const wf = renderBody(s, view({ mode: 'waterfall' }))
  // The bar's color says done and running; the failure keeps its glyph.
  assert.doesNotMatch(wf, /<span class="tint-tool">✓<\/span>/)
  assert.doesNotMatch(wf, /<span class="tint-run">●<\/span>/)
  assert.equal(wf.match(/<span class="tint-err"[^>]*>✗<\/span>/g)?.length, 1)
  const tree = renderBody(s, view({ mode: 'tree' }))
  assert.match(tree, /<span class="tint-tool">✓<\/span>/)
  assert.match(tree, /<span class="tint-run">●<\/span>/)
  assert.match(tree, /<span class="tint-err">✗<\/span>/)
})

test('the summary collapses to its header', () => {
  const s = finished()
  const top = s.nodes.find(n => n.kind === 'prompt')
  const open = renderBody(s, view())
  assert.match(open, /data-act="shut"[^>]*aria-expanded="true"/)
  assert.match(open, /class="kinds"/)
  const shut = renderBody(s, view({ shut: new Set([top?.id ?? '']) }))
  assert.match(shut, /aria-expanded="false"/)
  assert.match(shut, /▸/)
  assert.doesNotMatch(shut, /class="kinds"|class="facts"/)
  // The header, and with it the copy button, stay.
  assert.match(shut, /Summary/)
  assert.match(shut, /data-act="copySummary"/)
})

test('the output size and the time of a row are badges', () => {
  const html = renderBody(basic(), view())
  assert.match(html, /<span class="badge tok"[^>]*>~\d+ tok<\/span>/)
  assert.match(html, /<span class="badge time">/)
})

test('each text has a copy icon on its code block, and the summary a short Copy', () => {
  const s = finished()
  const call = s.nodes.find(n => n.name === 'Read')
  const html = renderBody(s, view({ selected: call?.id ?? '' }))
  // The input and the output: an icon each, inside the block, not a text button after it.
  assert.equal(html.match(/<div class="code">/g)?.length, 2)
  assert.equal(html.match(/class="copy-icon"/g)?.length, 2)
  assert.match(html, /<div class="code">\s*<pre>[\s\S]*?<\/pre>\s*<button class="copy-icon" data-act="copy" data-id="[^"]*" data-which="output" title="Copy"/)
  assert.match(html, /class="i-copy"[\s\S]*class="i-check"/)
  assert.match(renderBody(s, view()), /data-act="copySummary"[^>]*>Copy<\/button>/)
})
