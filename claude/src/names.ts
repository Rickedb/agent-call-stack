import type { Node } from '../types'

/** How a command joins to the one before it: `&&` if that succeeded, `||` if it failed, `;` and `&` plainly. */
export type Join = '&&' | '||' | ';' | '&'

/** One command of a shell line, by its program only (no arguments). */
export type Stage = {
  /** The program: a path and a `.exe` are left off. */
  name: string
  /** `|` or `|&` when the command is fed by the one before it in a pipeline. */
  pipe?: '|' | '|&'
  /** Where its word ends in the line, so that what follows it can be told. */
  end: number
  /** A command that only moves, sets or clears something (`cd`, `export`, `Set-Location`): never what a line is called by. */
  isCommon: boolean
}

/** A pipeline: commands joined by `|`, and how it follows the pipeline before it. */
export type Step = { join?: Join; stages: Stage[] }

// The calls that every script starts with, in bash and in PowerShell: they say where or with what,
// not what the line does. Compared in lower case.
const COMMON = new Set([
  'cd', 'chdir', 'pushd', 'popd', 'set-location', 'sl', 'push-location', 'pop-location',
  'export', 'set', 'unset', 'source', '.', 'clear', 'cls', 'true', 'false', ':',
])
// Words of a shell's own grammar: one that opens a command is dropped, the command comes after it.
const LEADING = new Set(['if', 'then', 'else', 'elif', 'do', '!', 'time', '{', '(', 'while', 'until'])
// A line of these only starts or ends a construct: nothing to name.
const SKIPPED = new Set(['fi', 'done', 'esac', '}', ')', 'for', 'case', 'select', 'function'])

const WORD = /^(?:"(?:[^"\\]|\\.)*"|'[^']*'|(?:\\.|[^\s"'\\])+)/

/** Splits a shell line at its operators, outside quotes and `$(...)`; each piece with where it starts. */
const split = (line: string): { op?: '&&' | '||' | ';' | '&' | '|' | '|&'; text: string; start: number }[] => {
  const out: { op?: '&&' | '||' | ';' | '&' | '|' | '|&'; text: string; start: number }[] = []
  let op: '&&' | '||' | ';' | '&' | '|' | '|&' | undefined
  let from = 0
  let quote = ''
  let depth = 0
  const push = (to: number, next: typeof op, skip: number) => {
    out.push({ op, text: line.slice(from, to), start: from })
    op = next
    from = to + skip
  }
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
    if (quote) {
      if (ch === '\\' && quote === '"') i++
      else if (ch === quote) quote = ''
      continue
    }
    if (ch === '\\') {
      i++
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      continue
    }
    if (ch === '$' && line[i + 1] === '(') {
      depth++
      i++
      continue
    }
    if (depth > 0) {
      if (ch === '(') depth++
      else if (ch === ')') depth--
      continue
    }
    const two = line.slice(i, i + 2)
    if (two === '&&' || two === '||') push(i, two, 2), (i += 1)
    else if (two === '|&') push(i, '|&', 2), (i += 1)
    else if (ch === '|') push(i, '|', 1)
    else if (ch === ';' || ch === '\n') push(i, ';', 1)
    else if (ch === '&' && line[i - 1] !== '>' && line[i - 1] !== '<' && line[i + 1] !== '>') push(i, '&', 1)
  }
  out.push({ op, text: line.slice(from), start: from })
  return out
}

// The program of one piece of a line: past what opens a command (`if`, `(`), past `VAR=value` settings
// and `$env:VAR = ...` ones. Undefined for a piece that holds no command.
const stageOf = (text: string, start: number): Omit<Stage, 'pipe'> | undefined => {
  let at = 0
  const rest = () => text.slice(at)
  for (;;) {
    const lead = /^\s*/.exec(rest())![0].length
    at += lead
    const m = WORD.exec(rest())
    if (!m) return undefined
    let word = m[0]
    if (word.startsWith('(') && word.length > 1) {
      at += 1
      continue
    }
    const key = word.toLowerCase()
    if (LEADING.has(key)) {
      at += word.length
      continue
    }
    if (SKIPPED.has(key)) return undefined
    // A setting before the program: `FOO=1`, `FOO="a b"`; one alone is a setting, not a command.
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) {
      const eq = /^[A-Za-z_][A-Za-z0-9_]*=(?:"(?:[^"\\]|\\.)*"|'[^']*'|\S*)/.exec(rest())
      at += eq ? eq[0].length : word.length
      const after = rest().trim()
      if (!after) return { name: word.split('=')[0]!, end: start + at, isCommon: true }
      continue
    }
    if (word.startsWith('$')) return { name: word.replace(/[=:].*$/, '') || word, end: start + at + word.length, isCommon: true }
    word = word.replace(/^["']|["')}]+$/g, '').replace(/\)+$/, '')
    const name = (word.split(/[\\/]/).filter(Boolean).pop() ?? '').replace(/\.exe$/i, '')
    if (!/^[\w.+@:-]+$/.test(name)) return undefined
    return { name, end: start + at + m[0].length, isCommon: COMMON.has(name.toLowerCase()) }
  }
}

/** A shell line as pipelines joined by `&&`, `||`, `;` and `&`, each of commands joined by `|`. Names only. */
export const stepsOf = (line: string): Step[] => {
  const steps: Step[] = []
  for (const piece of split(line)) {
    const stage = stageOf(piece.text, piece.start)
    if (!stage) continue
    if ((piece.op === '|' || piece.op === '|&') && steps.length) {
      steps[steps.length - 1]!.stages.push({ ...stage, pipe: piece.op })
    } else {
      steps.push({ ...(steps.length && piece.op && piece.op !== '|' && piece.op !== '|&' ? { join: piece.op } : {}), stages: [stage] })
    }
  }
  return steps
}

/** The commands of a line in order, `cd` and the like included. */
export const stagesOf = (line: string): Stage[] => stepsOf(line).flatMap(s => s.stages)

/**
 * What a line is called by: its first command that is not a common call (`cd`, `export`...), and what
 * follows that command's name. Undefined when it holds none, so that the caller names the shell.
 */
export const shellOf = (command: string): { program: string; rest: string } | undefined => {
  const first = stagesOf(command).find(s => !s.isCommon)
  return first ? { program: first.name, rest: command.slice(first.end).trim() } : undefined
}

/** `pwsh` for a PowerShell call (by the tool's name, a cmdlet or a `$env:` setting), else `bash`. */
export const shellKind = (tool: string, command: string): 'bash' | 'pwsh' =>
  /power\s*shell|pwsh/i.test(tool) || /(^|[\s;|&(])[A-Z][A-Za-z]+-[A-Z][A-Za-z]+\b|\$env:/.test(command) ? 'pwsh' : 'bash'

const isShell = (n: Node): n is Node & { touch: { op: 'run'; what: string } } =>
  n.kind === 'tool' && n.touch?.op === 'run' && !!n.touch.what

/**
 * What a call is called on a row: the program a shell call runs (`git`, `npm`; `cd` and the like do not
 * count), `bash` or `pwsh` when it runs none, else the tool's own name.
 */
export const toolName = (n: Node): string => {
  if (!isShell(n)) return n.name
  return shellOf(n.touch.what)?.program ?? shellKind(n.name, n.touch.what)
}

/** What follows the name on a row: the rest of the command for a shell call, else what the call was given. */
export const toolArg = (n: Node): string => {
  if (!isShell(n)) return n.arg
  const s = shellOf(n.touch.what)
  return s ? s.rest : n.arg
}

/** What a call did, for its icon: from what it touched, so that it holds for any agent's tools. */
export const toolOp = (n: Node): 'run' | 'read' | 'edit' | 'write' | 'search' | 'web' | 'other' | undefined =>
  n.kind === 'tool' && n.touch ? n.touch.op : undefined

/** The commands of a shell call as a sequence, for its details: none unless the line holds more than one command. */
export const sequenceOf = (n: Node): Step[] => {
  const steps = isShell(n) ? stepsOf(n.touch.what) : []
  return steps.reduce((t, s) => t + s.stages.length, 0) > 1 ? steps : []
}

/** What each operator means, in a few words. */
export const MEANING: Record<string, string> = {
  '&&': 'runs the next only if this succeeded',
  '||': 'runs the next only if this failed',
  ';': 'runs the next after this',
  '&': 'runs this in the background',
  '|': "feeds this one's output to the next",
  '|&': "feeds this one's output and errors to the next",
}
