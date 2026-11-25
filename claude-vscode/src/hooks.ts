import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

/** The hook events the call stack listens to. */
export const EVENTS = [
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'PermissionDenied',
  'SubagentStart',
  'SubagentStop',
  'Stop',
  'StopFailure',
  'PreCompact',
  'PostCompact',
] as const

/** The folder the recorder lives in; a hook whose command names it is ours. */
export const MARK = 'agent-call-stack-vscode'

export const claudeHome = (): string => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')

export type Scope = 'user' | 'workspace'

/**
 * Where the hooks go. Claude Code has no folder of hook files: hooks live in its settings, so ours are
 * merged into the user's `~/.claude/settings.json`, or into the workspace's `.claude/settings.local.json`
 * (which Claude Code keeps out of git: the entries hold a path on this machine).
 */
export const settingsFile = (scope: Scope, workspace?: string): string | undefined =>
  scope === 'user'
    ? path.join(claudeHome(), 'settings.json')
    : workspace
      ? path.join(workspace, '.claude', 'settings.local.json')
      : undefined

export const recorderPath = (dataDir: string): string => path.join(dataDir, 'record.cjs')

/** Puts the recorder script where the hooks run it from; the same place whatever the extension's version. */
export const installRecorder = (source: string, dataDir: string): string => {
  const target = recorderPath(dataDir)
  fs.mkdirSync(dataDir, { recursive: true })
  fs.copyFileSync(source, target)
  return target
}

// A settings file is JSON of anything the person put there; only `hooks` is ours to touch.
type Settings = Record<string, unknown>
type Entry = { matcher?: unknown; hooks?: unknown }

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isOurs = (h: unknown): boolean =>
  isRec(h) && typeof h.command === 'string' && /agent-call-stack-vscode[\\/]record\.cjs/.test(h.command)

let nodeFound: string | undefined | null = null

/** What a hook runs the recorder with: a `node`, or VS Code's own executable run as node. */
export type Runtime = { exe: string; electron?: boolean }

const NODE: Runtime = { exe: 'node' }

/**
 * What the hooks run the recorder with. A hook is started by a plain, non-interactive shell, which has
 * not read the person's shell config, so a `node` that a version manager (mise, nvm, fnm, volta) adds to
 * PATH there is not found ("node: command not found"). So node is looked up here and written in full.
 * When `electron` is set, or no node can be found, it is VS Code's own executable run as node
 * (`ELECTRON_RUN_AS_NODE=1`), which needs no install. Windows always gets a bare `node`: the variable
 * is set differently in each of its shells.
 */
export const runtime = (electron = false): Runtime => {
  if (process.platform === 'win32') return NODE
  if (!electron) {
    if (nodeFound === null) nodeFound = findNode()
    if (nodeFound) return { exe: nodeFound }
  }
  return { exe: process.execPath, electron: true }
}

const findNode = (): string | undefined => {
  const isExe = (f: string): boolean => {
    try {
      fs.accessSync(f, fs.constants.X_OK)
      return fs.statSync(f).isFile()
    } catch {
      return false
    }
  }
  const home = os.homedir()
  const dirs = [
    ...(process.env.PATH ?? '').split(path.delimiter),
    path.join(home, '.local', 'share', 'mise', 'shims'),
    path.join(home, '.asdf', 'shims'),
    path.join(home, '.volta', 'bin'),
    path.join(home, '.local', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
  ].filter(Boolean)
  for (const d of dirs) {
    const f = path.join(d, 'node')
    if (isExe(f)) return f
  }
  // Last: ask the person's own shell, which has their version manager set up.
  try {
    const shell = process.env.SHELL || '/bin/sh'
    const out = execFileSync(shell, ['-lic', 'command -v node'], {
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const last = out.trim().split('\n').pop()?.trim() ?? ''
    if (path.isAbsolute(last) && isExe(last)) return last
  } catch {
    // Fall through.
  }
  return undefined
}

/** The command word for a runtime: quoted when it is a path, which may have spaces. */
const runWord = (rt: Runtime): string =>
  rt.exe === 'node' && !rt.electron
    ? 'node'
    : `${rt.electron ? 'ELECTRON_RUN_AS_NODE=1 ' : ''}"${rt.exe.replace(/\\/g, '/')}"`

/** The command a hook runs: the recorder, told which event it is. Forward slashes work in bash, PowerShell and cmd alike. */
export const commandFor = (recorder: string, event: string, rt: Runtime = NODE): string =>
  `${runWord(rt)} "${recorder.replace(/\\/g, '/')}" ${event}`

// Everything of ours out of one event's list, and the entries that were only ours with it.
const withoutOurs = (list: unknown): unknown[] => {
  if (!Array.isArray(list)) return []
  const kept: unknown[] = []
  for (const e of list as Entry[]) {
    if (!isRec(e) || !Array.isArray(e.hooks)) {
      kept.push(e)
      continue
    }
    const rest = e.hooks.filter(h => !isOurs(h))
    if (rest.length === e.hooks.length) kept.push(e)
    else if (rest.length) kept.push({ ...e, hooks: rest })
  }
  return kept
}

/** The settings with our hook for each event, and whatever else was there left alone. */
export const withHooks = (settings: Settings, recorder: string, rt: Runtime = NODE): Settings => {
  const hooks: Record<string, unknown> = isRec(settings.hooks) ? { ...settings.hooks } : {}
  for (const event of Object.keys(hooks)) {
    const rest = withoutOurs(hooks[event])
    if (rest.length) hooks[event] = rest
    else delete hooks[event]
  }
  for (const event of EVENTS) {
    const rest = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : []
    hooks[event] = [...rest, { hooks: [{ type: 'command', command: commandFor(recorder, event, rt), timeout: 5 }] }]
  }
  return { ...settings, hooks }
}

/** The settings without our hooks; `hooks` goes if it was only ours. */
export const withoutHooks = (settings: Settings): Settings => {
  if (!isRec(settings.hooks)) return settings
  const hooks: Record<string, unknown> = {}
  for (const [event, list] of Object.entries(settings.hooks)) {
    const rest = withoutOurs(list)
    if (rest.length) hooks[event] = rest
  }
  const { hooks: _gone, ...others } = settings
  return Object.keys(hooks).length ? { ...others, hooks } : others
}

/** True when any event of the settings runs our recorder. */
export const hasHooks = (settings: Settings): boolean =>
  isRec(settings.hooks) &&
  Object.values(settings.hooks).some(list => Array.isArray(list) && withoutOurs(list).length !== list.length)

/** The settings file as an object; nothing if it is not there. Throws on a file that is not JSON: it is not ours to overwrite. */
export const readSettings = (file: string): Settings => {
  let text: string
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return {}
  }
  if (!text.trim()) return {}
  const parsed: unknown = JSON.parse(text)
  if (!isRec(parsed)) throw new Error(`${file} is not a JSON object`)
  return parsed
}

const write = (file: string, settings: Settings): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  // The first time a file that was there is touched, keep what it was.
  const backup = `${file}.agent-call-stack.bak`
  if (fs.existsSync(file) && !fs.existsSync(backup)) fs.copyFileSync(file, backup)
  const tmp = `${file}.agent-call-stack.tmp`
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n')
  fs.renameSync(tmp, file)
}

export const installHookFile = (file: string, recorder: string, rt: Runtime = NODE): void => {
  write(file, withHooks(readSettings(file), recorder, rt))
}

/** Takes our hooks out of a settings file; says whether there were any. */
export const removeHookFile = (file: string): boolean => {
  const settings = readSettings(file)
  if (!hasHooks(settings)) return false
  write(file, withoutHooks(settings))
  return true
}

/** True when the settings file runs our recorder. A file that cannot be read has none. */
export const hooksInstalledIn = (file: string): boolean => {
  try {
    return hasHooks(readSettings(file))
  } catch {
    return false
  }
}

/**
 * Brings our hooks in a settings file up to the events listened to now, so that an update that listens to
 * more needs no reinstall. Only a file that has them already is touched. Says whether it changed one.
 */
export const refreshHookFile = (file: string, recorder: string, rt: Runtime = NODE): boolean => {
  if (!hooksInstalledIn(file)) return false
  const before = readSettings(file)
  const after = withHooks(before, recorder, rt)
  if (JSON.stringify(before) === JSON.stringify(after)) return false
  write(file, after)
  return true
}

/** True when the user's settings turn every hook off, which would leave this view empty. */
export const hooksDisabled = (file: string): boolean => {
  try {
    return readSettings(file).disableAllHooks === true
  } catch {
    return false
  }
}
