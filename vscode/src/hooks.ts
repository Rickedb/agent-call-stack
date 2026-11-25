import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

/** The hook events the call stack listens to: the PascalCase names, whose payloads are snake_case. */
export const EVENTS = [
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'SubagentStart',
  'SubagentStop',
  'Stop',
  'PreCompact',
  'ErrorOccurred',
] as const

export const HOOK_FILE = 'agent-call-stack.json'

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

/** The hook config for a recorder script: one command per event. */
export const buildHookConfig = (script: string, rt: Runtime = NODE) => {
  // Forward slashes work in bash, PowerShell and cmd alike, and need no escaping.
  const s = script.replace(/\\/g, '/')
  return {
    version: 1,
    hooks: Object.fromEntries(
      EVENTS.map(e => [
        e,
        // `timeout` for the VS Code harness, `timeoutSec` for the Copilot one.
        [{ type: 'command', command: `${runWord(rt)} "${s}" ${e}`, timeout: 5, timeoutSec: 5 }],
      ]),
    ),
  }
}

export const copilotHome = (): string => process.env.COPILOT_HOME || path.join(os.homedir(), '.copilot')

/** Where a hook file goes: this workspace's `.github/hooks`, or the user's `~/.copilot/hooks`. */
export const hookFile = (scope: 'workspace' | 'user', workspace?: string): string | undefined =>
  scope === 'user'
    ? path.join(copilotHome(), 'hooks', HOOK_FILE)
    : workspace
      ? path.join(workspace, '.github', 'hooks', HOOK_FILE)
      : undefined

export const recorderPath = (dataDir: string): string => path.join(dataDir, 'record.cjs')

/** Puts the recorder script where the hooks run it from; the same place whatever the extension's version. */
export const installRecorder = (source: string, dataDir: string): string => {
  const target = recorderPath(dataDir)
  fs.mkdirSync(dataDir, { recursive: true })
  fs.copyFileSync(source, target)
  return target
}

export const installHookFile = (file: string, recorder: string, rt: Runtime = NODE): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(buildHookConfig(recorder, rt), null, 2) + '\n')
}

/**
 * Brings a hook file this extension wrote up to the events it listens to now, so that an update
 * that listens to more (a compaction, an error) needs no reinstall. Says whether it changed one.
 */
export const refreshHookFile = (file: string, recorder: string, rt: Runtime = NODE): boolean => {
  if (!fs.existsSync(file)) return false
  const next = JSON.stringify(buildHookConfig(recorder, rt), null, 2) + '\n'
  if (fs.readFileSync(file, 'utf8') === next) return false
  fs.writeFileSync(file, next)
  return true
}

/** Removes a hook file this extension wrote; says whether there was one. */
export const removeHookFile = (file: string): boolean => {
  if (!fs.existsSync(file)) return false
  fs.rmSync(file)
  return true
}
