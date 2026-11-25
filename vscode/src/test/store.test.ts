import * as assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { test } from 'node:test'

import { withLauncher, runtime, buildHookConfig, EVENTS, hookFile, installHookFile, installRecorder, removeHookFile } from '../hooks'
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

test('on Windows the Electron runtime goes through a record.cmd launcher that the hook names alone', () => {
  const dir = tmp()
  const rt = withLauncher({ exe: 'C:\\Program Files\\Code\\Code.exe', electron: true }, 'C:\\Users\\me\\data\\record.cjs', dir, 'win32')
  const launcher = rt.launcher as string
  assert.equal(launcher, path.join(dir, 'record.cmd'))
  const cmd = fs.readFileSync(launcher, 'utf8')
  assert.equal(cmd, '@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"C:\\Program Files\\Code\\Code.exe" "C:\\Users\\me\\data\\record.cjs" %*\r\n')
  assert.equal(buildHookConfig('C:\\Users\\me\\data\\record.cjs', rt).hooks.Stop?.[0]?.command, `${launcher.replace(/\\/g, '/')} Stop`)
})

test('a data folder with a space puts the launcher in ProgramData, which a bare path can name', () => {
  const dir = tmp()
  const spaced = path.join(dir, 'John Smith', 'agent-call-stack')
  const before = process.env.ProgramData
  process.env.ProgramData = path.join(dir, 'ProgramData')
  try {
    const rt = withLauncher({ exe: 'Code.exe', electron: true }, 'r.cjs', spaced, 'win32')
    assert.equal(rt.launcher, path.join(dir, 'ProgramData', 'agent-call-stack', 'record.cmd'))
    assert.ok(fs.existsSync(rt.launcher as string))
  } finally {
    if (before === undefined) delete process.env.ProgramData
    else process.env.ProgramData = before
  }
})

test('the launcher is only for Electron on Windows, and a % in a path is doubled for the batch file', () => {
  const dir = tmp()
  const node = { exe: 'node' }
  assert.equal(withLauncher(node, 'r.cjs', dir, 'win32'), node)
  const electron = { exe: '/usr/bin/code', electron: true }
  assert.equal(withLauncher(electron, 'r.cjs', dir, 'linux'), electron)
  const rt = withLauncher({ exe: 'C:\\100%\\Code.exe', electron: true }, 'r.cjs', dir, 'win32')
  assert.match(fs.readFileSync(rt.launcher as string, 'utf8'), /"C:\\100%%\\Code\.exe"/)
})

test('on Windows a node on PATH is used bare, and with none the Electron runtime is', () => {
  const dir = tmp()
  const before = process.env.PATH
  try {
    process.env.PATH = dir
    assert.equal(runtime(false, 'win32').electron, true)
    fs.writeFileSync(path.join(dir, 'node.exe'), '')
    assert.deepEqual(runtime(false, 'win32'), { exe: 'node' })
    assert.equal(runtime(true, 'win32').electron, true)
  } finally {
    process.env.PATH = before
  }
})
