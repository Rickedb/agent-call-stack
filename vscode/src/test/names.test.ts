import * as assert from 'node:assert/strict'
import { test } from 'node:test'

import { sequenceOf, shellKind, shellOf, stepsOf, toolArg, toolName, toolOp } from '../names'
import { icon } from '../view/format'
import type { Node } from '../types'

test('the program a shell command runs, without the cd that only moves to a folder', () => {
  const of = (c: string) => shellOf(c)
  assert.deepEqual(of('cd /a/b && npm test'), { program: 'npm', rest: 'test' })
  assert.deepEqual(of('cd "/a b" && git status; echo done'), { program: 'git', rest: 'status; echo done' })
  assert.deepEqual(of('cd /a && cd b && ./scripts/run.sh --fast'), { program: 'run.sh', rest: '--fast' })
  assert.deepEqual(of('cd /a; ls -la'), { program: 'ls', rest: '-la' })
  assert.deepEqual(of('(cd x && make all)'), { program: 'make', rest: 'all)' })
  assert.deepEqual(of('FOO=1 BAR="x y" node app.js'), { program: 'node', rest: 'app.js' })
  assert.deepEqual(of('/usr/bin/git log'), { program: 'git', rest: 'log' })
  assert.deepEqual(of('ls'), { program: 'ls', rest: '' })
  // Nothing to name: the tool keeps its own.
  assert.equal(of(''), undefined)
  assert.equal(of('# only a comment'), undefined)
  assert.equal(of('if true; then cd /a; fi'), undefined)
  assert.equal(of('cd /a'), undefined)
  assert.equal(of('cd /a && export A=1'), undefined)
})

test('a line is called by its first command that is not a common call', () => {
  const of = (c: string) => shellOf(c)?.program
  assert.equal(of('cd /a/b && sed -n 1p f | grep -E "Test"'), 'sed')
  assert.equal(of('export A=1; cd x; npm test'), 'npm')
  assert.equal(of('source ~/.profile && cd x && make'), 'make')
  assert.equal(of('cd /a && true && node app.js'), 'node')
  // PowerShell's own.
  assert.equal(of('$env:FOO = "x"; Set-Location C:\\p; npm test'), 'npm')
  assert.equal(of('Set-Location C:\\p; Get-ChildItem | Select-Object Name'), 'Get-ChildItem')
})

test('a line is a sequence of pipelines, and each joins to the one before it by its own operator', () => {
  const shape = (c: string) => stepsOf(c).map(s => [s.join ?? '', ...s.stages.map(x => `${x.pipe ?? ''}${x.name}`)])
  assert.deepEqual(shape('cd /a && sed -n 1p f | grep -E "Test"'), [['', 'cd'], ['&&', 'sed', '|grep']])
  assert.deepEqual(shape('a || b; c & d'), [['', 'a'], ['||', 'b'], [';', 'c'], ['&', 'd']])
  assert.deepEqual(shape('make 2>&1 | tee log |& wc'), [['', 'make', '|tee', '|&wc']])
  // Quotes and substitutions hide their operators.
  assert.deepEqual(shape('echo "a && b | c" && grep x $(ls | wc)'), [['', 'echo'], ['&&', 'grep']])
  assert.deepEqual(shape('cd /a'), [['', 'cd']])
  // The common calls are marked, so that they can be shown dim.
  assert.deepEqual(stepsOf('cd /a && npm test').map(s => s.stages[0]!.isCommon), [true, false])
})

test('the shell is named when a line runs no program of its own', () => {
  assert.equal(shellKind('Bash', 'ls'), 'bash')
  assert.equal(shellKind('PowerShell', 'ls'), 'pwsh')
  assert.equal(shellKind('run_in_terminal', 'Get-ChildItem -Recurse'), 'pwsh')
  assert.equal(shellKind('run_in_terminal', '$env:FOO = "x"'), 'pwsh')
  assert.equal(shellKind('run_in_terminal', 'cd /a'), 'bash')
})

const call = (over: Partial<Node>): Node => ({ id: 't', kind: 'tool', name: 'Bash', arg: 'cd /a && npm test', status: 'ok', start: 0, ...over })

test('a shell call is named by its program and shows the rest, the others keep their name', () => {
  const sh = call({ touch: { op: 'run', paths: [], what: 'cd /a && npm test' } })
  assert.equal(toolName(sh), 'npm')
  assert.equal(toolArg(sh), 'test')
  // A line that runs no program of its own is called by its shell, and keeps what it was given.
  const odd = call({ touch: { op: 'run', paths: [], what: 'cd /a && export X=1' } })
  assert.equal(toolName(odd), 'bash')
  assert.equal(toolArg(odd), 'cd /a && npm test')
  assert.equal(toolName(call({ name: 'PowerShell', touch: { op: 'run', paths: [], what: 'Set-Location C:\\p' } })), 'pwsh')
  // A call that is not a command keeps its name.
  const edit = call({ name: 'Edit', arg: '/a/b.ts', touch: { op: 'edit', paths: ['/a/b.ts'] } })
  assert.equal(toolName(edit), 'Edit')
  assert.equal(toolArg(edit), '/a/b.ts')
  assert.equal(toolName(call({ name: 'TodoWrite', touch: undefined })), 'TodoWrite')
  assert.equal(toolOp(edit), 'edit')
})

test('the sequence of a shell call is for a line of more than one command', () => {
  const sh = (what: string) => call({ touch: { op: 'run', paths: [], what } })
  assert.equal(sequenceOf(sh('npm test')).length, 0)
  assert.equal(sequenceOf(sh('cd /a && npm test')).length, 2)
  assert.equal(sequenceOf(sh('ls | wc')).length, 1)
  assert.equal(sequenceOf(call({ name: 'Edit', touch: { op: 'edit', paths: ['/a'] } })).length, 0)
})

test('a call has the icon of what it did, and an unmapped call keeps the tool icon', () => {
  const op = (o: string) => icon(call({ touch: { op: o as never, paths: [] } }))
  assert.equal(op('run'), '❯_')
  assert.equal(op('read'), '📖')
  assert.equal(op('edit'), '✏️')
  assert.equal(op('write'), '📝')
  assert.equal(op('search'), '🔍')
  assert.equal(op('web'), '🌐')
  // Mapped by what the call touched, not by name: an unknown tool and one that touched nothing keep the tool's.
  assert.equal(op('other'), '🔧')
  assert.equal(icon(call({ name: 'TodoWrite', touch: undefined })), '🔧')
  // A tool an MCP server gave the agent has its own, whatever it touched (Claude Code's `mcp__` names, Copilot's `mcp_`).
  assert.equal(icon(call({ name: 'mcp__github__search', touch: undefined })), '🔌')
  assert.equal(icon(call({ name: 'mcp__fs__read', touch: { op: 'read', paths: ['/a'] } })), '🔌')
  assert.equal(icon(call({ name: 'mcp_github_search_issues', touch: undefined })), '🔌')
  assert.equal(icon(call({ name: 'mcpish', touch: undefined })), '🔧')
  assert.equal(icon({ ...call({}), kind: 'prompt' }), '💬')
})
