import * as assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { test } from 'node:test'

import { EventStore } from '../store'
import type { Ev } from '../types'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'call-tree-'))
const line = (e: Partial<Ev>) => JSON.stringify({ v: 1, t: 1, sid: 's', kind: 'prompt', arg: 'hi', ...e }) + '\n'

test('the store reads what grows, and waits for the end of a half-written line', () => {
  const dir = tmp()
  const store = new EventStore(dir)
  fs.mkdirSync(store.eventsDir, { recursive: true })
  const file = path.join(store.eventsDir, 's.jsonl')

  fs.writeFileSync(file, line({ arg: 'one' }))
  assert.equal(store.scan(), true)
  assert.equal(store.model.sessions.get('s')?.nodes.length, 1)

  const second = line({ kind: 'tool_pre', tool: 'Bash', toolUseId: 'u' })
  fs.appendFileSync(file, second.slice(0, 20))
  assert.equal(store.scan(), false)
  fs.appendFileSync(file, second.slice(20))
  assert.equal(store.scan(), true)
  assert.equal(store.model.sessions.get('s')?.nodes.length, 2)

  assert.equal(store.scan(), false)
})

test('a multi-byte character split across reads is whole when read', () => {
  const dir = tmp()
  const store = new EventStore(dir)
  fs.mkdirSync(store.eventsDir, { recursive: true })
  const file = path.join(store.eventsDir, 's.jsonl')
  const bytes = Buffer.from(line({ arg: 'café ✓' }))
  const cut = bytes.indexOf(0xc3) + 1
  fs.writeFileSync(file, bytes.subarray(0, cut))
  store.scan()
  fs.appendFileSync(file, bytes.subarray(cut))
  store.scan()
  assert.equal(store.model.sessions.get('s')?.nodes[0]?.arg, 'café ✓')
})

test('a torn or foreign line is skipped, the rest read', () => {
  const dir = tmp()
  const store = new EventStore(dir)
  fs.mkdirSync(store.eventsDir, { recursive: true })
  fs.writeFileSync(path.join(store.eventsDir, 's.jsonl'), 'not json\n{"x":1}\n' + line({ arg: 'ok' }))
  store.scan()
  assert.equal(store.model.sessions.get('s')?.nodes[0]?.arg, 'ok')
})

test('clearing deletes the logs of the sessions given', () => {
  const dir = tmp()
  const store = new EventStore(dir)
  fs.mkdirSync(store.eventsDir, { recursive: true })
  const file = path.join(store.eventsDir, 's.jsonl')
  fs.writeFileSync(file, line({}))
  store.scan()
  store.clear(['s'])
  assert.equal(fs.existsSync(file), false)
  assert.equal(store.model.sessions.size, 0)
})


