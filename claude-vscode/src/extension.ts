import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as vscode from 'vscode'

import { collapseOlder } from './collapse'
import {
  hooksDisabled,
  hooksInstalledIn,
  installHookFile,
  installRecorder,
  refreshHookFile,
  removeHookFile,
  settingsFile,
  type Scope,
} from './hooks'
import type { Session } from './model'
import { dataDir } from './record'
import { foldableIds, isRunning, renderBody, summaryMarkdown } from './render'
import { EventStore } from './store'
import { TranscriptReader } from './transcript'

const VIEW = 'aiCallStackClaude.view'

const workspaceFolders = () => (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath)

const hasPrompt = (s: Session) => s.nodes.some(n => n.kind === 'prompt')

const toggle = <T>(set: Set<T>, v: T) => void (set.has(v) ? set.delete(v) : set.add(v))

// The settings files that may hold our hooks: the user's, and each open folder's local one.
const settingsFiles = (): string[] =>
  [settingsFile('user'), ...workspaceFolders().map(w => settingsFile('workspace', w))].filter((f): f is string => !!f)

const hooksInstalled = () => settingsFiles().some(hooksInstalledIn)

class CallTreeView implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView
  private timer?: NodeJS.Timeout
  private mode: 'tree' | 'waterfall'
  private selected = ''
  private picked = ''
  private folded = new Set<string>()
  private shown = new Set<string>()
  /** The prompts whose summary is collapsed to its header. */
  private shut = new Set<string>()
  /** The prompts already seen, so that only a new one folds the rest. */
  private seen = new Set<string>()

  constructor(
    private ctx: vscode.ExtensionContext,
    private store: EventStore,
  ) {
    // A mode saved by an earlier version (the Touched view, now gone) is not one of the two.
    const saved = ctx.globalState.get<string>('mode')
    this.mode =
      saved === 'tree' || saved === 'waterfall'
        ? saved
        : vscode.workspace.getConfiguration('aiCallStackClaude').get<string>('defaultView') === 'tree'
          ? 'tree'
          : 'waterfall'
    // A new prompt folds the ones before it; what history there is, folds but the latest.
    collapseOlder(store.model.sessions.values(), this.seen, this.folded)
    ctx.subscriptions.push(
      store.onChange(() => {
        collapseOlder(store.model.sessions.values(), this.seen, this.folded)
        this.render()
      }),
    )
  }

  /** Reads the model and the usage of each prompt from Claude Code's transcripts, which the hooks do not carry. */
  private transcripts = new TranscriptReader()

  /** The session drawn: the one picked, else the newest of this workspace. */
  current(): Session | undefined {
    const list = this.store.model.list(workspaceFolders())
    // By default the newest one that has a prompt: one that only started has nothing to show.
    const s = (this.picked && list.find(s => s.id === this.picked)) || list.find(hasPrompt) || list[0]
    this.transcripts.apply(s)
    // What was read back from the transcript folds like the older prompts of a chat.
    if (s) collapseOlder([s], this.seen, this.folded)
    return s
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view
    const media = vscode.Uri.joinPath(this.ctx.extensionUri, 'media')
    view.webview.options = { enableScripts: true, localResourceRoots: [media] }
    const nonce = crypto.randomBytes(16).toString('base64')
    const uri = (f: string) => view.webview.asWebviewUri(vscode.Uri.joinPath(media, f))
    view.webview.html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${view.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${uri('style.css')}">
<title>Call tree</title></head>
<body><div id="root"></div><script nonce="${nonce}" src="${uri('main.js')}"></script></body></html>`

    view.webview.onDidReceiveMessage(m => void this.onMessage(m))
    view.onDidChangeVisibility(() => this.render())

    // Running bars grow with the clock: redraw once a second while any runs.
    this.timer = setInterval(() => {
      if (isRunning(this.current())) this.render(true)
    }, 1000)
    view.onDidDispose(() => {
      if (this.timer) clearInterval(this.timer)
      this.view = undefined
    })
    this.render()
  }

  render(tick = false): void {
    const view = this.view
    if (!view?.visible) return
    const list = this.store.model.list(workspaceFolders())
    const html = renderBody(this.current(), {
      mode: this.mode,
      selected: this.selected,
      folded: this.folded,
      shown: this.shown,
      shut: this.shut,
      now: Date.now(),
      hooksInstalled: hooksInstalled(),
      hooksOff: settingsFiles().some(hooksDisabled),
      hasWorkspace: workspaceFolders().length > 0,
      // Sessions with no prompt are noise, unless it is the one picked.
      sessions: list.filter(s => hasPrompt(s) || s.id === this.picked).map(s => ({ id: s.id, label: s.label })),
      picked: this.picked,
    })
    void view.webview.postMessage({ type: 'render', html, tick })
  }

  private async onMessage(m: { act: string; id?: string; which?: 'input' | 'output'; v?: string }) {
    const s = this.current()
    const node = m.id ? s?.get(m.id) : undefined
    switch (m.act) {
      case 'ready':
        break
      case 'mode':
        this.mode = m.v === 'tree' ? 'tree' : 'waterfall'
        void this.ctx.globalState.update('mode', this.mode)
        break
      case 'select':
        this.selected = this.selected === m.id ? '' : (m.id ?? '')
        break
      case 'close':
        this.selected = ''
        break
      case 'fold':
        if (m.id) toggle(this.folded, m.id)
        break
      case 'foldAll': {
        const ids = foldableIds(s)
        this.folded = ids.every(id => this.folded.has(id)) ? new Set() : new Set(ids)
        break
      }
      case 'shut':
        if (m.id) toggle(this.shut, m.id)
        break
      case 'more':
        if (m.id && m.which) toggle(this.shown, `${m.id}:${m.which}`)
        break
      case 'pick':
        this.picked = m.v ?? ''
        this.selected = ''
        break
      case 'install':
        await vscode.commands.executeCommand('aiCallStackClaude.installHooks')
        break
      case 'installUser':
        await vscode.commands.executeCommand('aiCallStackClaude.installHooks', 'user')
        break
      case 'installWorkspace':
        await vscode.commands.executeCommand('aiCallStackClaude.installHooks', 'workspace')
        break
      case 'openSettings':
        {
          const file = settingsFile('user')
          if (file) await vscode.window.showTextDocument(vscode.Uri.file(file))
        }
        break
      case 'copySummary': {
        const md = summaryMarkdown(s, m.id ?? '', Date.now())
        if (md) {
          await vscode.env.clipboard.writeText(md)
          void vscode.window.setStatusBarMessage('Call tree: summary copied as markdown', 2000)
        }
        return
      }
      case 'copyTranscript': {
        if (!node?.transcript) return
        await vscode.env.clipboard.writeText(node.transcript)
        void vscode.window.setStatusBarMessage('Call tree: transcript path copied', 2000)
        return
      }
      case 'copy':
      case 'copyPath': {
        if (!node || !m.which) break
        const file = m.which === 'input' ? node.inputFile : node.outputFile
        let text = (m.which === 'input' ? node.input : node.output) ?? ''
        if (m.act === 'copyPath') text = file ?? ''
        // The whole text: from its file when the log kept only a cut.
        else if (file) text = await fs.promises.readFile(file, 'utf8').catch(() => text)
        await vscode.env.clipboard.writeText(text)
        void vscode.window.setStatusBarMessage('Call tree: copied', 2000)
        // Nothing changed on screen but the icon, which the page flips itself: no redraw.
        return
      }
    }
    this.render()
  }
}

export function activate(ctx: vscode.ExtensionContext): void {
  const store = new EventStore(dataDir())
  store.start()
  ctx.subscriptions.push({ dispose: () => store.stop() })

  const provider = new CallTreeView(ctx, store)
  const recorderSource = ctx.asAbsolutePath(path.join('out', 'record.js'))

  // The recorder the hooks run is a copy; keep it as new as the extension.
  if (hooksInstalled()) {
    try {
      const recorder = installRecorder(recorderSource, dataDir())
      // ...and the settings list every event it records.
      for (const f of settingsFiles()) refreshHookFile(f, recorder)
    } catch {
      // The copy there keeps working.
    }
  }

  const askScope = async (folder: string | undefined): Promise<Scope | undefined> => {
    const pick = await vscode.window.showQuickPick(
      [
        { label: 'All workspaces', description: '~/.claude/settings.json', scope: 'user' as Scope },
        ...(folder
          ? [
              {
                label: 'This workspace',
                description: '.claude/settings.local.json (Claude Code keeps it out of git: it holds a path on your machine)',
                scope: 'workspace' as Scope,
              },
            ]
          : []),
      ],
      { title: 'Where should the call tree hooks be added to Claude Code settings?' },
    )
    return pick?.scope
  }

  // The panel's buttons say where; from the command palette or the view's menu nothing does, so it asks.
  const installHooks = async (asked?: unknown) => {
    const folder = workspaceFolders()[0]
    const given: Scope | undefined = asked === 'user' || asked === 'workspace' ? asked : undefined
    if (given === 'workspace' && !folder) {
      void vscode.window.showErrorMessage('Call tree: open a folder to install the hooks for this workspace.')
      return
    }
    const scope = given ?? (await askScope(folder))
    if (!scope) return
    const file = settingsFile(scope, folder)
    if (!file) return
    try {
      const recorder = installRecorder(recorderSource, dataDir())
      installHookFile(file, recorder)
    } catch (err) {
      void vscode.window.showErrorMessage(`Call tree: could not add the hooks to ${file}: ${String(err)}`)
      return
    }

    // The same hooks twice would record every call twice.
    const other = settingsFile(scope === 'user' ? 'workspace' : 'user', folder)
    if (other && hooksInstalledIn(other)) {
      const answer = await vscode.window.showWarningMessage(
        `Call tree hooks are also in ${other}. Both would run and record every call twice.`,
        'Remove them there',
      )
      if (answer === 'Remove them there') removeHookFile(other)
    }
    void vscode.window.showInformationMessage(
      `Call tree hooks added to ${file}. Send a prompt to Claude Code (a session already open picks them up on its next start). If nothing shows up, check that node is on your PATH and that settings do not turn hooks off (disableAllHooks).`,
    )
    provider.render()
  }

  const uninstallHooks = () => {
    const removed = settingsFiles().filter(f => {
      try {
        return removeHookFile(f)
      } catch {
        return false
      }
    })
    void vscode.window.showInformationMessage(
      removed.length ? `Call tree hooks removed: ${removed.join(', ')}` : 'No call tree hooks were installed.',
    )
    provider.render()
  }

  ctx.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand('aiCallStackClaude.open', () => vscode.commands.executeCommand(`${VIEW}.focus`)),
    vscode.commands.registerCommand('aiCallStackClaude.installHooks', installHooks),
    vscode.commands.registerCommand('aiCallStackClaude.uninstallHooks', uninstallHooks),
    vscode.commands.registerCommand('aiCallStackClaude.clear', () => {
      store.clear(store.model.list(workspaceFolders()).map(s => s.id))
    }),
  )

  // Not set up: say so once, with the button, rather than leave it to the command palette.
  const PROMPTED = 'hooksPromptDismissed'
  if (!hooksInstalled() && !ctx.globalState.get<boolean>(PROMPTED)) {
    void vscode.window
      .showInformationMessage(
        'Call Tree needs its hooks added to Claude Code settings to record what the agent does.',
        'Install hooks',
        "Don't ask again",
      )
      .then(answer => {
        if (answer === 'Install hooks') void vscode.commands.executeCommand('aiCallStackClaude.installHooks')
        if (answer === "Don't ask again") void ctx.globalState.update(PROMPTED, true)
      })
  }
}

export function deactivate(): void {}
