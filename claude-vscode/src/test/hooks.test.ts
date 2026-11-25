import * as assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { test } from 'node:test'

import {
  commandFor,
  runtime,
  withLauncher,
  EVENTS,
  hasHooks,
  hooksDisabled,
  hooksInstalledIn,
  installHookFile,
  installRecorder,
  readSettings,
  recorderPath,
  refreshHookFile,
  removeHookFile,
  settingsFile,
  withHooks,
  withoutHooks,
} from '../hooks'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'call-stack-'))
const REC = '/home/u/.claude/agent-call-stack-vscode/record.cjs'

test('our hooks are added for every event, and what else the settings hold is left alone', () => {
  const mine = {
    model: 'opus',
    permissions: { allow: ['Bash(ls)'] },
    hooks: {
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo guard' }] }],
      Notification: [{ hooks: [{ type: 'command', command: 'notify' }] }],
    },
  }
  const out = withHooks(mine, REC) as typeof mine & { hooks: Record<string, any[]> }
  assert.equal(out.model, 'opus')
  assert.deepEqual(out.permissions, { allow: ['Bash(ls)'] })
  assert.deepEqual(Object.keys(out.hooks).sort(), [...new Set([...EVENTS, 'Notification'])].sort())
  // The person's own hook stays first; ours follows it.
  assert.equal(out.hooks.PreToolUse?.length, 2)
  assert.equal(out.hooks.PreToolUse?.[0]?.hooks?.[0]?.command, 'echo guard')
  assert.deepEqual(out.hooks.PreToolUse?.[1], { hooks: [{ type: 'command', command: `node "${REC}" PreToolUse`, timeout: 5 }] })
  assert.equal(out.hooks.Notification?.length, 1)
  // The input is not changed.
  assert.equal(Object.keys(mine.hooks).length, 2)
})

test('adding twice adds nothing more, and removing leaves the settings as they were', () => {
  const mine = { theme: 'dark', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] } }
  const once = withHooks(mine, REC)
  assert.deepEqual(withHooks(once, REC), once)
  assert.equal(hasHooks(once), true)
  assert.equal(hasHooks(mine), false)
  assert.deepEqual(withoutHooks(once), mine)
  // Only ours: `hooks` goes with them.
  assert.deepEqual(withoutHooks(withHooks({ theme: 'dark' }, REC)), { theme: 'dark' })
  // A moved recorder replaces the old entries, it does not add to them.
  const moved = withHooks(once, '/other/.claude/agent-call-stack-vscode/record.cjs') as { hooks: Record<string, unknown[]> }
  assert.equal(moved.hooks.Stop?.length, 2)
  assert.match(JSON.stringify(moved), /other/)
  assert.doesNotMatch(JSON.stringify(moved), /home\/u/)
})

test('the file is written with a backup of what it was, once, and removed cleanly', () => {
  const dir = tmp()
  const file = path.join(dir, 'settings.json')
  fs.writeFileSync(file, JSON.stringify({ theme: 'dark' }, null, 2))
  installHookFile(file, REC)
  assert.equal(hooksInstalledIn(file), true)
  assert.deepEqual(JSON.parse(fs.readFileSync(`${file}.agent-call-stack.bak`, 'utf8')), { theme: 'dark' })
  installHookFile(file, REC)
  // The backup stays what the person had, not what we wrote first.
  assert.deepEqual(JSON.parse(fs.readFileSync(`${file}.agent-call-stack.bak`, 'utf8')), { theme: 'dark' })
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).theme, 'dark')

  assert.equal(removeHookFile(file), true)
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { theme: 'dark' })
  assert.equal(removeHookFile(file), false)
  assert.equal(hooksInstalledIn(file), false)
  fs.rmSync(dir, { recursive: true })
})

test('a settings file that is not JSON is never overwritten', () => {
  const dir = tmp()
  const file = path.join(dir, 'settings.json')
  fs.writeFileSync(file, '{ "theme": "dark", // a comment\n}')
  assert.throws(() => installHookFile(file, REC))
  assert.equal(fs.readFileSync(file, 'utf8'), '{ "theme": "dark", // a comment\n}')
  assert.equal(hooksInstalledIn(file), false)
  fs.rmSync(dir, { recursive: true })
})

test('a file that is not there is made, with its folder', () => {
  const dir = tmp()
  const file = path.join(dir, '.claude', 'settings.local.json')
  assert.deepEqual(readSettings(file), {})
  installHookFile(file, REC)
  assert.equal(hooksInstalledIn(file), true)
  assert.equal(fs.existsSync(`${file}.agent-call-stack.bak`), false)
  fs.rmSync(dir, { recursive: true })
})

test('an installed file is brought up to the events listened to now, and one that has none is left', () => {
  const dir = tmp()
  const file = path.join(dir, 'settings.json')
  installHookFile(file, REC)
  const old = JSON.parse(fs.readFileSync(file, 'utf8'))
  delete old.hooks.PostCompact
  fs.writeFileSync(file, JSON.stringify(old))
  assert.equal(refreshHookFile(file, REC), true)
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')).hooks).sort(), [...EVENTS].sort())
  assert.equal(refreshHookFile(file, REC), false)

  const bare = path.join(dir, 'bare.json')
  fs.writeFileSync(bare, '{"theme":"dark"}')
  assert.equal(refreshHookFile(bare, REC), false)
  assert.equal(fs.readFileSync(bare, 'utf8'), '{"theme":"dark"}')
  assert.equal(refreshHookFile(path.join(dir, 'none.json'), REC), false)
  fs.rmSync(dir, { recursive: true })
})

test('settings that turn every hook off are told', () => {
  const dir = tmp()
  const file = path.join(dir, 'settings.json')
  fs.writeFileSync(file, '{"disableAllHooks":true}')
  assert.equal(hooksDisabled(file), true)
  fs.writeFileSync(file, '{}')
  assert.equal(hooksDisabled(file), false)
  assert.equal(hooksDisabled(path.join(dir, 'none.json')), false)
  fs.rmSync(dir, { recursive: true })
})

test('the user file and the workspace file, and the recorder copied to a fixed place', () => {
  const home = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = '/cfg'
  assert.equal(settingsFile('user'), path.join('/cfg', 'settings.json'))
  if (home === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = home
  assert.equal(settingsFile('workspace', '/w'), path.join('/w', '.claude', 'settings.local.json'))
  assert.equal(settingsFile('workspace'), undefined)

  const dir = tmp()
  const source = path.join(dir, 'record.js')
  fs.writeFileSync(source, 'console.log(1)')
  const target = installRecorder(source, path.join(dir, 'data'))
  assert.equal(target, recorderPath(path.join(dir, 'data')))
  assert.equal(fs.readFileSync(target, 'utf8'), 'console.log(1)')
  fs.rmSync(dir, { recursive: true })
})

test('the hook command runs the node it is given, quoted, so a shell without a version manager finds it', () => {
  assert.equal(
    commandFor('/r/record.cjs', 'Stop', { exe: '/home/me/.local/share/mise/shims/node' }),
    '"/home/me/.local/share/mise/shims/node" "/r/record.cjs" Stop',
  )
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
    commandFor('/r/record.cjs', 'Stop', { exe: '/usr/share/code/code', electron: true }),
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
  assert.equal(commandFor('C:\\Users\\me\\data\\record.cjs', 'Stop', rt), `${launcher.replace(/\\/g, '/')} Stop`)
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
