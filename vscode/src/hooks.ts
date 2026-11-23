import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

/** The hook events the call tree listens to: the PascalCase names, whose payloads are snake_case. */
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

export const HOOK_FILE = 'ai-call-tree.json'

/** The hook config for a recorder script: one command per event. */
export const buildHookConfig = (script: string) => {
  // Forward slashes work in bash, PowerShell and cmd alike, and need no escaping.
  const s = script.replace(/\\/g, '/')
  return {
    version: 1,
    hooks: Object.fromEntries(
      EVENTS.map(e => [
        e,
        // `timeout` for the VS Code harness, `timeoutSec` for the Copilot one.
        [{ type: 'command', command: `node "${s}" ${e}`, timeout: 5, timeoutSec: 5 }],
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

export const installHookFile = (file: string, recorder: string): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(buildHookConfig(recorder), null, 2) + '\n')
}

/**
 * Brings a hook file this extension wrote up to the events it listens to now, so that an update
 * that listens to more (a compaction, an error) needs no reinstall. Says whether it changed one.
 */
export const refreshHookFile = (file: string, recorder: string): boolean => {
  if (!fs.existsSync(file)) return false
  const next = JSON.stringify(buildHookConfig(recorder), null, 2) + '\n'
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
