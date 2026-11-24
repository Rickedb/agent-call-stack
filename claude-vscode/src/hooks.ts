import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

/** The hook events the call tree listens to. */
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
export const MARK = 'ai-call-stack-vscode'

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
  isRec(h) && typeof h.command === 'string' && /ai-call-stack-vscode[\\/]record\.cjs/.test(h.command)

/** The command a hook runs: the recorder, told which event it is. Forward slashes work in bash, PowerShell and cmd alike. */
export const commandFor = (recorder: string, event: string): string =>
  `node "${recorder.replace(/\\/g, '/')}" ${event}`

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
export const withHooks = (settings: Settings, recorder: string): Settings => {
  const hooks: Record<string, unknown> = isRec(settings.hooks) ? { ...settings.hooks } : {}
  for (const event of Object.keys(hooks)) {
    const rest = withoutOurs(hooks[event])
    if (rest.length) hooks[event] = rest
    else delete hooks[event]
  }
  for (const event of EVENTS) {
    const rest = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : []
    hooks[event] = [...rest, { hooks: [{ type: 'command', command: commandFor(recorder, event), timeout: 5 }] }]
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
  const backup = `${file}.ai-call-stack.bak`
  if (fs.existsSync(file) && !fs.existsSync(backup)) fs.copyFileSync(file, backup)
  const tmp = `${file}.ai-call-stack.tmp`
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n')
  fs.renameSync(tmp, file)
}

export const installHookFile = (file: string, recorder: string): void => {
  write(file, withHooks(readSettings(file), recorder))
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
export const refreshHookFile = (file: string, recorder: string): boolean => {
  if (!hooksInstalledIn(file)) return false
  const before = readSettings(file)
  const after = withHooks(before, recorder)
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
