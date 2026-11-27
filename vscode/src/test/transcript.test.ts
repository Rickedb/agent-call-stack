import * as assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { test } from 'node:test'

import { Session } from '../model'
import { reportOf } from '../stats'
import { NOTE_KEEP, ParsedTranscript, TranscriptReader } from '../transcript'
import type { Ev, Node } from '../types'
import { renderBody, type View } from '../render'

const T = (s: string) => Date.parse(`2026-01-01T00:00:${s}Z`)
const entry = (type: string, timestamp: string, data: object, id = type) =>
  JSON.stringify({ id, type, timestamp: `2026-01-01T00:00:${timestamp}Z`, data })
const lines = (...items: string[]) => items.join('\n') + '\n'

test('Copilot transcript assistant messages become timed thinking and reply notes', () => {
  const parsed = new ParsedTranscript()
  const text = lines(
    entry('user.message', '00.000', { content: 'inspect this' }),
    entry('assistant.turn_start', '01.000', { turnId: '1' }),
    entry('assistant.message', '03.000', { reasoningText: 'I should inspect the file.', content: 'I will read it.' }, 'm1'),
    entry('tool.execution_start', '04.000', { toolName: 'read_file' }),
    entry('assistant.turn_start', '05.000', { turnId: '2' }),
    entry('assistant.message', '07.000', { reasoningText: '', content: 'The file is valid.' }, 'm2'),
    entry('assistant.message', '08.000', { reasoningText: '   ', content: '' }, 'empty'),
  )
  parsed.feed(text.slice(0, 100))
  parsed.feed(text.slice(100, -1))
  assert.equal(parsed.notes.length, 3)
  parsed.feed(text.slice(-1))
  assert.deepEqual(
    parsed.notes.map(n => [n.name, n.text, n.start, n.t]),
    [
      ['Thinking', 'I should inspect the file.', T('01.000'), T('03.000')],
      ['Reply', 'I will read it.', T('01.000'), T('03.000')],
      ['Reply', 'The file is valid.', T('05.000'), T('07.000')],
    ],
  )

  const long = new ParsedTranscript()
  long.feed(lines(entry('assistant.message', '01.000', { content: 'x'.repeat(NOTE_KEEP + 1) }, 'long')))
  assert.equal(long.notes[0]?.text.length, NOTE_KEEP)
  assert.equal(long.notes[0]?.len, NOTE_KEEP + 1)
})

test('notes are attached once to their prompt, ordered with calls, and omitted from call counts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-transcript-'))
  try {
    const transcript = path.join(dir, 'session.jsonl')
    const agentTranscript = path.join(dir, 'agent.jsonl')
    fs.writeFileSync(
      transcript,
      lines(
        entry('user.message', '00.000', { content: 'inspect this' }),
        entry('assistant.turn_start', '01.000', { turnId: '1' }),
        entry('assistant.message', '03.000', { reasoningText: 'Thinking before the read.', content: 'I will read it.' }, 'm1'),
        entry('assistant.turn_start', '05.000', { turnId: '2' }),
        entry('assistant.message', '07.000', { content: 'The file is valid.' }, 'm2'),
        entry('user.message', '10.000', { content: 'another prompt' }),
        entry('assistant.turn_start', '11.000', { turnId: '3' }),
        entry('assistant.message', '12.000', { content: 'Done.' }, 'm3'),
      ),
    )
    fs.writeFileSync(
      agentTranscript,
      lines(
        entry('assistant.turn_start', '10.500', { turnId: 'agent' }),
        entry('assistant.message', '11.500', { reasoningText: 'Check the matching file.', content: 'Found the file.' }, 'agent-message'),
      ),
    )
    let t = 0
    const ev = (kind: Ev['kind'], more: Partial<Ev> = {}): Ev => ({ v: 1, sid: 's', kind, t: (t += 1000), ...more })
    const s = new Session('s')
    s.apply(ev('prompt', { t: T('00.000'), arg: 'inspect this' }))
    s.apply(ev('tool_pre', { tool: 'Read', toolUseId: 'r', arg: 'file.txt', t: T('04.000') }))
    s.apply(ev('tool_post', { tool: 'Read', toolUseId: 'r', t: T('05.000'), output: 'contents' }))
    s.apply(ev('stop', { t: T('09.000'), transcript }))
    s.apply(ev('prompt', { t: T('10.000'), arg: 'another prompt' }))
    s.apply(ev('agent_start', { t: T('10.200'), agentId: 'a', agentType: 'Explore', transcript: agentTranscript }))
    s.apply(ev('agent_stop', { t: T('12.500'), agentId: 'a', agentType: 'Explore', transcript: agentTranscript }))
    s.apply(ev('stop', { t: T('13.000'), transcript }))

    const reader = new TranscriptReader()
    reader.apply(s)
    reader.apply(s)
    const prompts = s.nodes.filter(n => n.kind === 'prompt')
    const notes = s.nodes.filter(n => n.kind === 'note')
    assert.equal(notes.length, 6)
    assert.ok(notes.slice(0, 3).every(n => n.parent === prompts[0]?.id))
    assert.equal(notes[3]?.parent, prompts[1]?.id)
    const agent = s.nodes.find(n => n.kind === 'agent')
    assert.ok(notes.slice(4).every(n => n.parent === agent?.id))
    assert.deepEqual(notes.slice(0, 3).map(n => n.name), ['Thinking', 'Reply', 'Reply'])
    assert.equal(notes[0]?.output, 'Thinking before the read.')

    const html = renderBody(s, view({ now: T('14.000') }))
    const thinkingAt = html.indexOf('Thinking')
    const readAt = html.indexOf('Read')
    const finalAt = html.indexOf('The file is valid.')
    assert.ok(thinkingAt > 0 && thinkingAt < readAt && readAt < finalAt)
    assert.match(renderBody(s, view({ selected: notes[0]?.id ?? '', now: T('14.000') })), /the model's thinking between calls/)
    assert.equal(reportOf(prompts[0] as Node, s.nodes.filter(n => n.parent === prompts[0]?.id), T('14.000'))?.calls, 1)
    assert.match(html, /<span class="tint-tool">✓ 2<\/span>/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

const view = (over: Partial<View> = {}): View => ({
  mode: 'tree',
  selected: '',
  folded: new Set(),
  shown: new Set(),
  shut: new Set(),
  now: T('14.000'),
  hooksInstalled: true,
  hooksOff: false,
  hasWorkspace: true,
  sessions: [],
  picked: '',
  ...over,
})

test('only a cancel the person made is an abort: other reasons and other entries are not', () => {
  const parsed = new ParsedTranscript()
  parsed.feed(
    lines(
      entry('user.message', '00.000', { content: 'go' }),
      entry('abort', '02.500', { reason: 'user_initiated' }, 'a1'),
      entry('abort', '03.000', { reason: 'something_else' }, 'a2'),
      entry('abort', '04.000', {}, 'a3'),
    ),
  )
  assert.deepEqual(parsed.aborts, [T('02.500')])
})

test('a prompt cancelled before any Stop names no log, so the reader finds the session\'s own and marks the prompt', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'call-stack-'))
  const before = process.env.COPILOT_HOME
  process.env.COPILOT_HOME = home
  try {
    const dir = path.join(home, 'session-state', 'sess')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'events.jsonl'),
      lines(entry('user.message', '00.000', { content: 'go' }), entry('abort', '07.000', { reason: 'user_initiated' })),
    )
    const s = new Session('sess')
    const start = T('00.500')
    s.apply({ v: 1, t: start, sid: 'sess', kind: 'prompt', arg: 'go' })
    s.apply({ v: 1, t: start + 1000, sid: 'sess', kind: 'tool_pre', tool: 'Bash', toolUseId: 'u', arg: 'sleep 60' })
    new TranscriptReader().apply(s)
    const prompt = s.nodes.find(n => n.kind === 'prompt') as Node
    assert.deepEqual([prompt.status, prompt.why, prompt.end], ['err', 'interrupted', T('07.000')])
    assert.equal(s.nodes.find(n => n.kind === 'tool')?.status, 'err')
    // The next draw reads nothing new and changes nothing.
    new TranscriptReader().apply(s)
    assert.equal(prompt.end, T('07.000'))
  } finally {
    if (before === undefined) delete process.env.COPILOT_HOME
    else process.env.COPILOT_HOME = before
  }
})
