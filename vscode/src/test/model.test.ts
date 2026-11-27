import * as assert from 'node:assert/strict'
import { test } from 'node:test'

import { MAX_NODES, Model, Session } from '../model'
import type { Ev } from '../types'

let t = 0
const ev = (e: Partial<Ev> & Pick<Ev, 'kind'>): Ev => ({ v: 1, t: (t += 10), sid: 's', ...e })
const run = (...events: Ev[]) => {
  const s = new Session('s')
  for (const e of events) s.apply(e)
  return s
}
const byName = (s: Session, name: string) => s.nodes.find(n => n.name === name)

test('a prompt, a tool call and its result make a tree of two rows', () => {
  const s = run(
    ev({ kind: 'prompt', arg: 'list files', input: 'list files' }),
    ev({ kind: 'tool_pre', tool: 'Bash', arg: 'ls', toolUseId: 'u1', input: 'command: ls' }),
    ev({ kind: 'tool_post', tool: 'Bash', toolUseId: 'u1', output: 'a\nb' }),
    ev({ kind: 'stop', output: 'Two files.' }),
  )
  assert.equal(s.nodes.length, 2)
  const [prompt, tool] = s.nodes
  assert.equal(prompt?.status, 'ok')
  assert.equal(prompt?.output, 'Two files.')
  assert.equal(tool?.parent, prompt?.id)
  assert.equal(tool?.status, 'ok')
  assert.equal(tool?.output, 'a\nb')
  assert.ok((tool?.end ?? 0) > (tool?.start ?? 1))
})

test('without call ids, equal calls pair with their results oldest first', () => {
  const s = run(
    ev({ kind: 'prompt', arg: 'p' }),
    ev({ kind: 'tool_pre', tool: 'read', fp: 'same', arg: 'first' }),
    ev({ kind: 'tool_pre', tool: 'read', fp: 'same', arg: 'second' }),
    ev({ kind: 'tool_post', tool: 'read', fp: 'same', output: 'one' }),
    ev({ kind: 'tool_fail', tool: 'read', fp: 'same', output: 'two' }),
  )
  const calls = s.nodes.filter(n => n.kind === 'tool')
  assert.deepEqual(calls.map(n => [n.status, n.output]), [['ok', 'one'], ['err', 'two']])
})

test('a call that never got a result is failed when the prompt ends', () => {
  const s = run(
    ev({ kind: 'prompt', arg: 'p' }),
    ev({ kind: 'tool_pre', tool: 'rm', toolUseId: 'u9' }),
    ev({ kind: 'stop' }),
  )
  const call = byName(s, 'rm')
  assert.equal(call?.status, 'err')
  assert.match(call?.output ?? '', /no result recorded/)
})

test('a subagent started with an id gets the calls made inside it', () => {
  const s = run(
    ev({ kind: 'prompt', arg: 'p' }),
    ev({ kind: 'tool_pre', tool: 'runSubagent', arg: 'find auth', input: 'look for login' }),
    ev({ kind: 'agent_start', agentId: 'ag1', agentType: 'Explore' }),
    ev({ kind: 'tool_pre', tool: 'grep', agentId: 'ag1', toolUseId: 'u1', arg: 'auth' }),
    ev({ kind: 'tool_post', tool: 'grep', agentId: 'ag1', toolUseId: 'u1', output: 'hit' }),
    ev({ kind: 'agent_stop', agentId: 'ag1', agentType: 'Explore', output: 'found it' }),
  )
  const agent = byName(s, 'Explore')
  assert.equal(agent?.kind, 'agent')
  assert.equal(agent?.arg, 'find auth')
  assert.equal(agent?.input, 'look for login')
  assert.equal(agent?.status, 'ok')
  assert.equal(agent?.output, 'found it')
  assert.equal(byName(s, 'grep')?.parent, agent?.id)
  // The spawn call itself is not a row: the subagent is.
  assert.equal(byName(s, 'runSubagent'), undefined)
})

test('a subagent started without an id is bound by its first call and its stop', () => {
  const s = run(
    ev({ kind: 'prompt', arg: 'p' }),
    ev({ kind: 'agent_start', agentType: 'Explore' }),
    ev({ kind: 'tool_pre', tool: 'grep', agentId: 'late-id', toolUseId: 'u1' }),
    ev({ kind: 'agent_stop', agentId: 'late-id', agentType: 'Explore' }),
  )
  const agents = s.nodes.filter(n => n.kind === 'agent')
  assert.equal(agents.length, 1)
  assert.equal(agents[0]?.status, 'ok')
  assert.equal(byName(s, 'grep')?.parent, agents[0]?.id)
})

test('two waiting subagents are bound oldest first', () => {
  const s = run(
    ev({ kind: 'prompt', arg: 'p' }),
    ev({ kind: 'agent_start', agentType: 'A' }),
    ev({ kind: 'agent_start', agentType: 'B' }),
    ev({ kind: 'agent_stop', agentId: 'x', agentType: 'B' }),
  )
  assert.equal(byName(s, 'B')?.status, 'ok')
  assert.equal(byName(s, 'A')?.status, 'run')
})

test('a subagent spawned by a subagent hangs under it', () => {
  const s = run(
    ev({ kind: 'prompt', arg: 'p' }),
    ev({ kind: 'agent_start', agentId: 'outer', agentType: 'Outer' }),
    ev({ kind: 'tool_pre', tool: 'runSubagent', agentId: 'outer', arg: 'inner job' }),
    ev({ kind: 'agent_start', agentId: 'inner', agentType: 'Inner' }),
  )
  assert.equal(byName(s, 'Inner')?.parent, byName(s, 'Outer')?.id)
})

test('hooks installed mid-chat still draw: a result with no call, a call with no prompt', () => {
  const s = run(ev({ kind: 'tool_post', tool: 'Bash', output: 'x' }), ev({ kind: 'tool_pre', tool: 'Read', toolUseId: 'r' }))
  assert.equal(s.nodes[0]?.kind, 'prompt')
  assert.equal(s.nodes[0]?.arg, '(earlier activity)')
  assert.equal(byName(s, 'Bash')?.status, 'ok')
  assert.equal(byName(s, 'Read')?.status, 'run')
})

test('a new prompt ends the one before it', () => {
  const s = run(ev({ kind: 'prompt', arg: 'one' }), ev({ kind: 'prompt', arg: 'two' }))
  assert.deepEqual(s.nodes.map(n => n.status), ['ok', 'run'])
})

test('the oldest prompts are dropped past the limit, the running one kept', () => {
  const s = new Session('s')
  for (let i = 0; i < MAX_NODES; i++) {
    s.apply(ev({ kind: 'prompt', arg: `p${i}` }))
    s.apply(ev({ kind: 'tool_pre', tool: 'x', toolUseId: `u${i}` }))
  }
  assert.ok(s.nodes.length <= MAX_NODES)
  assert.equal(s.nodes.filter(n => n.kind === 'prompt').at(-1)?.arg, `p${MAX_NODES - 1}`)
  assert.ok(!s.nodes.some(n => n.arg === 'p0'))
})

test('sessions are told apart and filtered by folder', () => {
  const m = new Model()
  m.apply({ v: 1, t: 1, sid: 'a', cwd: '/w/one', kind: 'prompt', arg: 'a' })
  m.apply({ v: 1, t: 2, sid: 'b', cwd: '/w/two', kind: 'prompt', arg: 'b' })
  assert.deepEqual(m.list().map(s => s.id), ['b', 'a'])
  assert.deepEqual(m.list(['/w/one']).map(s => s.id), ['a'])
  assert.deepEqual(m.list(['/w']).map(s => s.id), ['b', 'a'])
})

test('a cancel ends the running prompt and what runs under it, as interrupted, at the moment of the cancel', () => {
  const s = run(
    ev({ kind: 'prompt', arg: 'long job' }),
    ev({ kind: 'tool_pre', tool: 'Bash', arg: 'sleep', toolUseId: 'u1' }),
  )
  const prompt = s.nodes[0] as NonNullable<(typeof s.nodes)[0]>
  s.interrupt(prompt.start + 500)
  assert.deepEqual([prompt.status, prompt.why, prompt.end], ['err', 'interrupted', prompt.start + 500])
  const call = byName(s, 'Bash')
  assert.deepEqual([call?.status, call?.end, call?.output], ['err', prompt.start + 500, '(no result recorded)'])
})

test('a cancel that is read after the next prompt began still ends the prompt at the cancel, not at the next prompt', () => {
  const s = run(
    ev({ kind: 'prompt', arg: 'first' }),
    ev({ kind: 'tool_pre', tool: 'Bash', arg: 'sleep', toolUseId: 'u1' }),
    ev({ kind: 'prompt', arg: 'second' }),
  )
  const [first, , second] = s.nodes as [NonNullable<(typeof s.nodes)[0]>, NonNullable<(typeof s.nodes)[0]>, NonNullable<(typeof s.nodes)[0]>]
  // The next prompt closed the first as done, at its own start.
  assert.equal(first.status, 'ok')
  const cancelAt = first.start + 15
  s.interrupt(cancelAt)
  assert.deepEqual([first.status, first.why, first.end], ['err', 'interrupted', cancelAt])
  assert.deepEqual([byName(s, 'Bash')?.status, byName(s, 'Bash')?.end], ['err', cancelAt])
  // The prompt that followed is not touched.
  assert.deepEqual([second.status, second.why], ['run', undefined])
})

test('a prompt that was stopped normally is not marked by a cancel in the log, and a cancel is told once', () => {
  const s = run(ev({ kind: 'prompt', arg: 'done' }), ev({ kind: 'stop', output: 'ok' }))
  const prompt = s.nodes[0] as NonNullable<(typeof s.nodes)[0]>
  s.interrupt(prompt.start + 1)
  assert.deepEqual([prompt.status, prompt.why], ['ok', undefined])

  const c = run(ev({ kind: 'prompt', arg: 'cancelled' }))
  const p = c.nodes[0] as NonNullable<(typeof c.nodes)[0]>
  c.interrupt(p.start + 3)
  c.interrupt(p.start + 3)
  c.interrupt(p.start + 9)
  assert.deepEqual([p.status, p.why, p.end], ['err', 'interrupted', p.start + 3])
  // Nothing began before it: nothing to mark.
  run(ev({ kind: 'prompt', arg: 'late' })).interrupt(1)
})
