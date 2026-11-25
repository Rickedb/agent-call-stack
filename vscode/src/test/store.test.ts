import * as assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { test } from 'node:test'

import { runtime, buildHookConfig, EVENTS, hookFile, installHookFile, installRecorder, removeHookFile } from '../hooks'
import { EventStore } from '../store'
import type { Ev } from '../types'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'call-stack-'))
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

test('the hook config has one command per event, with paths safe for any shell', () => {
  const config = buildHookConfig('C:\\Users\\me\\.copilot\\agent-call-stack\\record.cjs')
  assert.equal(config.version, 1)
  assert.deepEqual(Object.keys(config.hooks), [...EVENTS])
  const entry = config.hooks.PreToolUse?.[0]
  assert.equal(entry?.type, 'command')
  assert.equal(entry?.command, 'node "C:/Users/me/.copilot/agent-call-stack/record.cjs" PreToolUse')
  assert.equal(entry?.timeoutSec, 5)
})

test('the installer copies the recorder and writes and removes the hook file', () => {
  const dir = tmp()
  const source = path.join(dir, 'record.js')
  fs.writeFileSync(source, '// recorder')
  const recorder = installRecorder(source, path.join(dir, 'data'))
  assert.equal(fs.readFileSync(recorder, 'utf8'), '// recorder')

  const file = hookFile('workspace', dir) as string
  assert.equal(file, path.join(dir, '.github', 'hooks', 'agent-call-stack.json'))
  installHookFile(file, recorder)
  const written = JSON.parse(fs.readFileSync(file, 'utf8')) as ReturnType<typeof buildHookConfig>
  assert.match(written.hooks.Stop?.[0]?.command ?? '', /record\.cjs" Stop$/)

  assert.equal(removeHookFile(file), true)
  assert.equal(removeHookFile(file), false)
  assert.equal(hookFile('workspace'), undefined)
})

test('the hook command runs the node it is given, quoted, so a shell without a version manager finds it', () => {
  const config = buildHookConfig('/r/record.cjs', { exe: '/home/me/.local/share/mise/shims/node' })
  assert.equal(config.hooks.Stop?.[0]?.command, '"/home/me/.local/share/mise/shims/node" "/r/record.cjs" Stop')
})

test('the hooks run VS Code as node when asked, and node by its full path otherwise', () => {
  const electron = runtime(true)
  assert.equal(electron.electron, true)
  assert.equal(electron.exe, process.execPath)
  const node = runtime(false)
  assert.ok(node.electron || path.isAbsolute(node.exe))
})

test('an electron runtime sets ELECTRON_RUN_AS_NODE in the command', () => {
  assert.equal(
    buildHookConfig('/r/record.cjs', { exe: '/usr/share/code/code', electron: true }).hooks.Stop?.[0]?.command,
    'ELECTRON_RUN_AS_NODE=1 "/usr/share/code/code" "/r/record.cjs" Stop',
  )
})
