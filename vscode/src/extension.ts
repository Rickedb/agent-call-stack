import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vscode from 'vscode'

import { hookFile, installHookFile, installRecorder, removeHookFile } from './hooks'
import type { Session } from './model'
import { foldableIds, isRunning, renderBody, renderText } from './render'
import { EventStore } from './store'

const VIEW = 'aiCallTree.view'
const dataDir = () => process.env.AI_CALL_TREE_DIR || path.join(os.homedir(), '.copilot', 'ai-call-tree')

const workspaceFolders = () => (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath)

const toggle = <T>(set: Set<T>, v: T) => void (set.has(v) ? set.delete(v) : set.add(v))

const hooksInstalled = () =>
  [hookFile('user'), ...workspaceFolders().map(w => hookFile('workspace', w))].some(
    f => !!f && fs.existsSync(f),
  )

class CallTreeView implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView
  private timer?: NodeJS.Timeout
  private mode: 'tree' | 'waterfall'
  private selected = ''
  private picked = ''
  private folded = new Set<string>()
  private shown = new Set<string>()

  constructor(
    private ctx: vscode.ExtensionContext,
    private store: EventStore,
  ) {
    this.mode =
      ctx.globalState.get<'tree' | 'waterfall'>('mode') ??
      vscode.workspace.getConfiguration('aiCallTree').get<'tree' | 'waterfall'>('defaultView', 'waterfall')
    ctx.subscriptions.push(store.onChange(() => this.render()))
  }

  /** The session drawn: the one picked, else the newest of this workspace. */
  current(): Session | undefined {
    const list = this.store.model.list(workspaceFolders())
    return (this.picked && list.find(s => s.id === this.picked)) || list[0]
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
      now: Date.now(),
      hooksInstalled: hooksInstalled(),
      sessions: list.map(s => ({ id: s.id, label: s.label })),
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
      case 'more':
        if (m.id && m.which) toggle(this.shown, `${m.id}:${m.which}`)
        break
      case 'pick':
        this.picked = m.v ?? ''
        this.selected = ''
        break
      case 'install':
        await vscode.commands.executeCommand('aiCallTree.installHooks')
        break
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
        break
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
      installRecorder(recorderSource, dataDir())
    } catch {
      // The copy there keeps working.
    }
  }

  const installHooks = async () => {
    const folder = workspaceFolders()[0]
    const pick = await vscode.window.showQuickPick(
      [
        {
          label: 'All workspaces',
          description: '~/.copilot/hooks',
          scope: 'user' as const,
        },
        ...(folder
          ? [
              {
                label: 'This workspace',
                description: '.github/hooks (holds an absolute path to your machine: do not commit it)',
                scope: 'workspace' as const,
              },
            ]
          : []),
      ],
      { title: 'Where should the call tree hooks be installed?' },
    )
    if (!pick) return
    const file = hookFile(pick.scope, folder)
    if (!file) return
    try {
      const recorder = installRecorder(recorderSource, dataDir())
      installHookFile(file, recorder)
    } catch (err) {
      void vscode.window.showErrorMessage(`Call tree: could not install hooks: ${String(err)}`)
      return
    }

    // The same hooks twice would record every call twice.
    const other = hookFile(pick.scope === 'user' ? 'workspace' : 'user', folder)
    if (other && fs.existsSync(other)) {
      const answer = await vscode.window.showWarningMessage(
        `Call tree hooks are also installed in ${other}. Both would run and record every call twice.`,
        'Remove it',
      )
      if (answer === 'Remove it') removeHookFile(other)
    }
    void vscode.window.showInformationMessage(
      `Call tree hooks installed in ${file}. Start a new Copilot agent chat. If nothing shows up, check that agent hooks are enabled in VS Code (setting chat.useHooks) and that node is on your PATH.`,
    )
    provider.render()
  }

  const uninstallHooks = () => {
    const files = [hookFile('user'), ...workspaceFolders().map(w => hookFile('workspace', w))]
    const removed = files.filter((f): f is string => !!f && removeHookFile(f))
    void vscode.window.showInformationMessage(
      removed.length ? `Call tree hooks removed: ${removed.join(', ')}` : 'No call tree hooks were installed.',
    )
    provider.render()
  }

  ctx.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand('aiCallTree.open', () => vscode.commands.executeCommand(`${VIEW}.focus`)),
    vscode.commands.registerCommand('aiCallTree.installHooks', installHooks),
    vscode.commands.registerCommand('aiCallTree.uninstallHooks', uninstallHooks),
    vscode.commands.registerCommand('aiCallTree.clear', () => {
      store.clear(store.model.list(workspaceFolders()).map(s => s.id))
    }),
  )

  // `@calltree` in the chat: the tree as text, the counterpart of the original's `/call-tree`.
  if (vscode.chat?.createChatParticipant) {
    const participant = vscode.chat.createChatParticipant('ai-call-tree.calltree', async (_req, _chat, stream) => {
      stream.markdown('```text\n' + renderText(provider.current(), Date.now()) + '\n```')
      stream.button({ command: 'aiCallTree.open', title: 'Open the call tree pane' })
    })
    participant.iconPath = new vscode.ThemeIcon('type-hierarchy')
    ctx.subscriptions.push(participant)
  }
}

export function deactivate(): void {}
