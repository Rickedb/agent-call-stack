import * as assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { test } from 'node:test'

import {
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

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'call-tree-'))
const REC = '/home/u/.claude/ai-call-tree-vscode/record.cjs'

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
  const moved = withHooks(once, '/other/.claude/ai-call-tree-vscode/record.cjs') as { hooks: Record<string, unknown[]> }
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
  assert.deepEqual(JSON.parse(fs.readFileSync(`${file}.ai-call-tree.bak`, 'utf8')), { theme: 'dark' })
  installHookFile(file, REC)
  // The backup stays what the person had, not what we wrote first.
  assert.deepEqual(JSON.parse(fs.readFileSync(`${file}.ai-call-tree.bak`, 'utf8')), { theme: 'dark' })
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
  assert.equal(fs.existsSync(`${file}.ai-call-tree.bak`), false)
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
