// Draws the READMEs' pictures: a made-up session ("fix the failing login test") put through each extension's own
// model and view code, in a dark and a light VS Code theme, and saved as PNGs by the system Electron.
//
//   (cd vscode && npm run build) && (cd claude-vscode && npm run build)
//   node scripts/screenshots/shots.cjs
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'acs-shots-'))

const THEMES = {
  dark: `--vscode-foreground:#cccccc;--vscode-descriptionForeground:#9d9d9d;--vscode-errorForeground:#f85149;
--vscode-font-family:-apple-system,"Segoe UI",system-ui,sans-serif;--vscode-font-size:13px;
--vscode-editor-font-family:"JetBrains Mono","Fira Code",Consolas,monospace;--vscode-editor-font-size:12px;
--vscode-editorWidget-background:#202020;--vscode-panel-border:#2b2b2b;--vscode-textCodeBlock-background:#2b2b2b;
--vscode-textLink-foreground:#4daafc;--vscode-list-hoverBackground:#2a2d2e;--vscode-list-inactiveSelectionBackground:#37373d;
--vscode-toolbar-hoverBackground:#383a3d;--vscode-tree-indentGuidesStroke:#585858;
--vscode-button-background:#0078d4;--vscode-button-foreground:#ffffff;--vscode-button-hoverBackground:#026ec1;
--vscode-button-secondaryBackground:#313131;--vscode-button-secondaryForeground:#cccccc;--vscode-button-secondaryHoverBackground:#3c3c3c;
--vscode-dropdown-background:#313131;--vscode-dropdown-border:#3c3c3c;--vscode-dropdown-foreground:#cccccc;
--vscode-charts-blue:#3794ff;--vscode-charts-green:#89d185;--vscode-charts-orange:#d18616;--vscode-charts-purple:#b180d7;--vscode-charts-yellow:#cca700;`,
  light: `--vscode-foreground:#3b3b3b;--vscode-descriptionForeground:#717171;--vscode-errorForeground:#c72e0f;
--vscode-font-family:-apple-system,"Segoe UI",system-ui,sans-serif;--vscode-font-size:13px;
--vscode-editor-font-family:"JetBrains Mono","Fira Code",Consolas,monospace;--vscode-editor-font-size:12px;
--vscode-editorWidget-background:#f8f8f8;--vscode-panel-border:#e5e5e5;--vscode-textCodeBlock-background:#f0f0f0;
--vscode-textLink-foreground:#005fb8;--vscode-list-hoverBackground:#f0f0f0;--vscode-list-inactiveSelectionBackground:#e4e6f1;
--vscode-toolbar-hoverBackground:#e0e0e0;--vscode-tree-indentGuidesStroke:#a9a9a9;
--vscode-button-background:#005fb8;--vscode-button-foreground:#ffffff;--vscode-button-hoverBackground:#0258a8;
--vscode-button-secondaryBackground:#e5e5e5;--vscode-button-secondaryForeground:#3b3b3b;--vscode-button-secondaryHoverBackground:#cccccc;
--vscode-dropdown-background:#ffffff;--vscode-dropdown-border:#cecece;--vscode-dropdown-foreground:#3b3b3b;
--vscode-charts-blue:#1a85ff;--vscode-charts-green:#388a34;--vscode-charts-orange:#d18616;--vscode-charts-purple:#652d90;--vscode-charts-yellow:#bf8803;`,
}
const BG = { dark: '#181818', light: '#f8f8f8' }

const T0 = Date.UTC(2026, 10, 24, 15, 0, 0)
let seq = 0
const mk = (sid, rows) => rows.map(r => ({ v: 1, sid, cwd: '/home/dev/shop-api', ...r, t: T0 + r.at }))

// The session, as the events a hook would record. `names` maps the generic call to the agent's own tool name.
const scenario = names => {
  const N = names
  const call = (id, at, end, tool, arg, input, output, touch, extra = {}, fail = false) => [
    { kind: 'tool_pre', at, tool, toolUseId: id, fp: id, arg, input, touch, ...extra },
    { kind: fail ? 'tool_fail' : 'tool_post', at: end, tool, toolUseId: id, fp: id, output, outputLen: output.length, ...extra },
  ]
  const ag = { agentId: 'ag1' }
  const testOut = ok =>
    ok
      ? '> shop-api@2.4.0 test\n> node --test\n\n✔ login accepts a valid token (3ms)\n✔ login rejects an expired token (2ms)\n✔ login rejects a token expiring in the future by mistake (1ms)\n\n# tests 14\n# pass 14\n# fail 0'
      : '> shop-api@2.4.0 test\n> node --test\n\n✖ login rejects an expired token (4ms)\n  AssertionError: expected 401, got 200\n    at tests/login.test.js:41:10\n\n# tests 13\n# pass 12\n# fail 1'
  return [
    { kind: 'session_start', at: 0 },
    { kind: 'prompt', at: 400, arg: 'Fix the failing login test and add a regression test', input: 'Fix the failing login test and add a regression test', inputLen: 52 },
    { kind: 'agent_start', at: 2100, ...ag, agentType: 'Explore', arg: 'find where login tokens expire' },
    ...call('g1', 2600, 2900, N.grep, 'expiresAt', 'query: expiresAt\nincludePattern: src/**', 'src/auth/token.ts:18:  return token.expiresAt < now\nsrc/auth/login.ts:44:  if (isExpired(token)) throw new Unauthorized()', { op: 'search', paths: ['src'], what: 'expiresAt' }, ag),
    ...call('r1', 3300, 3500, N.read, 'src/auth/token.ts', 'path: src/auth/token.ts', "export const isExpired = (token: Token, now = Date.now() / 1000) =>\n  token.expiresAt < now\n", { op: 'read', paths: ['src/auth/token.ts'] }, ag),
    ...call('r2', 3800, 4000, N.read, 'src/auth/login.ts', 'path: src/auth/login.ts', 'import { isExpired } from "./token"\n\nexport async function login(token: Token) { /* … */ }\n', { op: 'read', paths: ['src/auth/login.ts'] }, ag),
    { kind: 'agent_stop', at: 8900, ...ag, agentType: 'Explore' },
    ...call('e1', 11200, 11350, N.edit, 'src/auth/token.ts', 'path: src/auth/token.ts\nold: Date.now() / 1000\nnew: Date.now()', 'Edited src/auth/token.ts', { op: 'edit', paths: ['src/auth/token.ts'], changes: [{ path: 'src/auth/token.ts', added: 2, removed: 1 }] }),
    ...call('w1', 12600, 12750, N.write, 'tests/login.regression.test.js', 'path: tests/login.regression.test.js', 'Created tests/login.regression.test.js', { op: 'write', paths: ['tests/login.regression.test.js'], changes: [{ path: 'tests/login.regression.test.js', added: 14, removed: 0 }] }),
    ...call('t1', 13400, 15600, N.shell, 'npm test', 'command: npm test', testOut(false), { op: 'run', paths: [], what: 'npm test' }, {}, true),
    ...call('e2', 18200, 18330, N.edit, 'tests/login.regression.test.js', 'path: tests/login.regression.test.js\nold: expect(res.status).toBe(401)\nnew: expect(res.status).toBe(401)', 'Edited tests/login.regression.test.js', { op: 'edit', paths: ['tests/login.regression.test.js'], changes: [{ path: 'tests/login.regression.test.js', added: 3, removed: 3 }] }),
    ...call('t2', 19000, 21300, N.shell, 'npm test', 'command: npm test', testOut(true), { op: 'run', paths: [], what: 'npm test' }),
    { kind: 'stop', at: 22400 },
  ]
}

const notes = [
  { at: 1000, end: 2100, name: 'Thinking', text: 'The login test fails on an expired token. The token module is the likely place, so I will have a subagent look at how expiry is checked before I touch anything.' },
  { at: 8900, end: 11200, name: 'Reply', text: 'Found it: `isExpired` compares `expiresAt` in milliseconds against `Date.now() / 1000`, which is in seconds, so a token never looks expired. I will fix the unit and add a regression test.' },
  { at: 15600, end: 18200, name: 'Thinking', text: 'The new test fails for the right reason, but it asserts the wrong status for the fixed code. Correct the expectation, then run the whole suite again.' },
  { at: 21300, end: 22400, name: 'Reply', text: 'Fixed. Tokens are now compared in milliseconds, and `tests/login.regression.test.js` covers an expired token. All 14 tests pass.' },
]
const addNotes = s => {
  const prompt = s.nodes.find(n => n.kind === 'prompt')
  const agent = s.nodes.find(n => n.kind === 'agent')
  s.addNotes(
    notes.map((n, i) => ({
      id: `${prompt.id}:n:${i}`,
      parent: prompt.id,
      kind: 'note',
      name: n.name,
      arg: n.text.replace(/\s+/g, ' ').slice(0, 160),
      status: 'ok',
      start: T0 + n.at,
      end: T0 + n.end,
      output: n.text,
      outputLen: n.text.length,
      hist: undefined,
    })),
  )
  return { prompt, agent }
}

const page = (theme, body, extraCss = '') =>
  `<!doctype html><html><head><meta charset="utf-8"><style>:root{${THEMES[theme]}}html,body{margin:0;overflow:hidden}body{background:${BG[theme]};color:var(--vscode-foreground);font-family:var(--vscode-font-family);font-size:var(--vscode-font-size)}${extraCss}</style>` +
  `<link rel="stylesheet" href="file://${'STYLE'}"></head><body><div id="root">${body}</div></body></html>`

const targets = []
const emit = (ext, name, theme, body, width) => {
  const css = path.join(root, ext, 'media', 'style.css')
  const html = page(theme, body).replace('file://STYLE', 'file://' + css)
  const f = path.join(work, `${ext}-${name}-${theme}.html`)
  fs.writeFileSync(f, html)
  // Each extension keeps its pictures in its own folder: the Marketplace resolves a README's images against it.
  const dir = path.join(root, ext, 'docs', 'images')
  fs.mkdirSync(dir, { recursive: true })
  targets.push(`${f}=${path.join(dir, `${name}-${theme}.png`)}@${width}`)
}

const view = (s, over = {}) => ({
  mode: 'waterfall', selected: '', folded: new Set(), shown: new Set(), shut: new Set(),
  now: T0 + 23000, hooksInstalled: true, hooksOff: false, hasWorkspace: true,
  sessions: [{ id: s.id, label: s.label }], picked: s.id, ...over,
})

// --- Copilot
{
  const { Session } = require(path.join(root, 'vscode/out/model'))
  const { renderBody } = require(path.join(root, 'vscode/out/render'))
  const names = { grep: 'grep_search', read: 'read_file', edit: 'replace_string_in_file', write: 'create_file', shell: 'run_in_terminal' }
  const build = () => {
    const s = new Session('copilot-demo')
    mk('copilot-demo', scenario(names)).forEach(e => s.apply(e))
    addNotes(s)
    return s
  }
  for (const theme of ['dark', 'light']) {
    const s = build()
    const failing = s.nodes.find(n => n.kind === 'tool' && n.status === 'err')
    emit('vscode', 'waterfall', theme, renderBody(s, view(s, { mode: 'waterfall' })), 460)
    emit('vscode', 'tree', theme, renderBody(s, view(s, { mode: 'tree' })), 460)
    emit('vscode', 'details', theme, renderBody(s, view(s, { mode: 'waterfall', selected: failing.id })), 460)
    emit('vscode', 'setup', theme, renderBody(undefined, view(s, { hooksInstalled: false, sessions: [], picked: '' })), 460)
  }
}

// --- Claude Code in VS Code
{
  const { Session } = require(path.join(root, 'claude-vscode/out/model'))
  const { renderBody } = require(path.join(root, 'claude-vscode/out/render'))
  const names = { grep: 'Grep', read: 'Read', edit: 'Edit', write: 'Write', shell: 'Bash' }
  const build = () => {
    const s = new Session('claude-demo')
    const evs = mk('claude-demo', scenario(names))
    // A call that waited for the person's answer: the ask, then the run.
    const at = evs.findIndex(e => e.toolUseId === 't1' && e.kind === 'tool_pre')
    evs.splice(at + 1, 0, { v: 1, sid: 'claude-demo', t: T0 + 13450, kind: 'perm_ask', tool: 'Bash', fp: 't1' })
    // The person said yes after a moment: the tool itself ran for less than the call took.
    const done = evs.find(e => e.toolUseId === 't1' && e.kind !== 'tool_pre')
    done.durationMs = 1500
    evs.forEach(e => s.apply(e))
    const { prompt, agent } = addNotes(s)
    // What the transcript adds: the model and what the API reported.
    prompt.model = 'claude-opus-5-5'
    prompt.usage = { input: 3120, output: 2480, cacheRead: 41800, cacheWrite: 5200 }
    if (agent) {
      agent.model = 'claude-haiku-5-5'
      agent.usage = { input: 820, output: 410, cacheRead: 9100, cacheWrite: 1300 }
    }
    return s
  }
  for (const theme of ['dark', 'light']) {
    const s = build()
    const failing = s.nodes.find(n => n.kind === 'tool' && n.status === 'err')
    emit('claude-vscode', 'waterfall', theme, renderBody(s, view(s, { mode: 'waterfall' })), 460)
    emit('claude-vscode', 'tree', theme, renderBody(s, view(s, { mode: 'tree' })), 460)
    emit('claude-vscode', 'details', theme, renderBody(s, view(s, { mode: 'waterfall', selected: failing.id })), 460)
    emit('claude-vscode', 'setup', theme, renderBody(undefined, view(s, { hooksInstalled: false, sessions: [], picked: '' })), 460)
  }
}

const electron = process.env.ELECTRON || 'electron'
execFileSync(electron, ['--no-sandbox', path.join(__dirname, 'capture.cjs'), ...targets], { stdio: 'inherit', timeout: 180000 })
console.log(`wrote ${targets.length} images to vscode/docs/images and claude-vscode/docs/images`)
