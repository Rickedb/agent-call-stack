import type { Touch } from '../types'
import { clip } from './format'

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

// The argument names tools use for the files they take, across the tools of both agents.
const PATH_KEYS = new Set([
  'file_path',
  'filePath',
  'notebook_path',
  'notebookPath',
  'path',
  'file',
  'filepath',
  'uri',
  'paths',
  'files',
  'filePaths',
])

const oneLine = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() && !v.includes('\n') && v.length <= 400 ? v.replace(/^file:\/\//, '') : undefined

// Every file path a call was given, however deep the tool nests them (an edit list, a list of files).
const pathsIn = (args: Record<string, unknown>): string[] => {
  const out: string[] = []
  const walk = (v: unknown, named: boolean, depth: number) => {
    if (depth > 3) return
    if (Array.isArray(v)) return v.forEach(x => walk(x, named, depth + 1))
    if (isRec(v)) {
      for (const [k, x] of Object.entries(v)) walk(x, PATH_KEYS.has(k), depth + 1)
      return
    }
    const s = named ? oneLine(v) : undefined
    if (s) out.push(s)
  }
  for (const [k, v] of Object.entries(args)) walk(v, PATH_KEYS.has(k), 0)
  return [...new Set(out)]
}

// The first of these arguments that is a line of text: what a search looked for.
const WHAT = ['pattern', 'query', 'glob', 'includePattern', 'url', 'prompt']
const whatOf = (args: Record<string, unknown>): string => {
  for (const k of WHAT) {
    const v = args[k]
    if (typeof v === 'string' && v.trim()) return clip(v, 200)
    if (Array.isArray(v) && typeof v[0] === 'string') return clip(v.join(' '), 200)
  }
  return ''
}

/** The lines one call added to a file and took out of it, as far as its arguments say. */
export type Change = { path: string; added: number; removed: number }

// A text as lines: no line for an empty text, and a last newline ends a line rather than starting one.
const linesOf = (s: string): string[] => (s === '' ? [] : s.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n'))

// The lines two texts differ by: what they share at the start and at the end is not counted.
const diffCount = (before: string, after: string): { added: number; removed: number } => {
  const a = linesOf(before)
  const b = linesOf(after)
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++
  return { removed: a.length - head - tail, added: b.length - head - tail }
}

// The arguments that hold a text before and after, across the tools of the agents.
const PAIRS: [string, string][] = [
  ['old_string', 'new_string'],
  ['oldString', 'newString'],
  ['old_str', 'new_str'],
  ['oldText', 'newText'],
]
// The arguments that hold a text written whole: a file's content, a notebook cell, the code an edit inserts.
const WRITTEN = ['content', 'file_text', 'new_source', 'newSource', 'code']
// What Copilot's edit tool puts where the file stays as it is.
const KEPT = /^\s*(\/\/|#|\/\*|<!--|--)?\s*\.\.\.\s*existing (code|content)\b/i

const firstPath = (r: Record<string, unknown>): string | undefined => {
  for (const k of PATH_KEYS) {
    const s = oneLine(r[k])
    if (s) return s
  }
  return undefined
}

// A patch in a text: Copilot's `*** Begin Patch` blocks, or a unified diff. Its lines by file.
const patchChanges = (text: string): Change[] => {
  const out = new Map<string, Change>()
  const lines = text.split('\n')
  const isBlocks = lines.some(l => l.startsWith('*** Begin Patch'))
  let cur: Change | undefined
  const open = (path: string) => {
    const p = path.trim().replace(/^[ab]\//, '')
    cur = out.get(p) ?? { path: p, added: 0, removed: 0 }
    out.set(p, cur)
  }
  lines.forEach((line, i) => {
    const block = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/.exec(line)
    if (isBlocks) {
      if (block) return open(block[1]!)
      if (!cur || line.startsWith('***')) return
    } else {
      if (line.startsWith('--- ') && lines[i + 1]?.startsWith('+++ ')) return
      if (line.startsWith('+++ ')) return open(line.slice(4).split('\t')[0]!)
      if (!cur || line.startsWith('@@')) return
    }
    if (line.startsWith('+')) cur.added++
    else if (line.startsWith('-')) cur.removed++
  })
  return [...out.values()].filter(c => c.added || c.removed)
}

// A patch the call carries.
const patchesIn = (args: Record<string, unknown>): Change[] =>
  ['input', 'patch', 'diff'].flatMap(k => {
    const v = args[k]
    return typeof v === 'string' && (v.includes('*** Begin Patch') || /^--- .*\n\+\+\+ /m.test(v)) ? patchChanges(v) : []
  })

/**
 * The lines a call that changes files added and removed, per file, from its arguments: a text and
 * what replaced it (an edit, a list of them), a text written whole, a patch. A text written whole
 * counts as added only: what the file held before is not in the call.
 */
export const changesOf = (args: Record<string, unknown>, paths: string[]): Change[] => {
  const out = new Map<string, Change>()
  const add = (path: string | undefined, added: number, removed: number) => {
    if (!path || (!added && !removed)) return
    const c = out.get(path) ?? { path, added: 0, removed: 0 }
    c.added += added
    c.removed += removed
    out.set(path, c)
  }
  const walk = (v: unknown, inherited: string | undefined, depth: number) => {
    if (depth > 3) return
    if (Array.isArray(v)) return v.forEach(x => walk(x, inherited, depth + 1))
    if (!isRec(v)) return
    const own = firstPath(v) ?? inherited
    for (const [from, to] of PAIRS) {
      const a = v[from]
      const b = v[to]
      if (typeof a === 'string' && typeof b === 'string') {
        const d = diffCount(a, b)
        add(own, d.added, d.removed)
      }
    }
    for (const k of WRITTEN) {
      const s = v[k]
      if (typeof s === 'string') add(own, linesOf(s).filter(l => !KEPT.test(l)).length, 0)
    }
    for (const x of Object.values(v)) walk(x, own, depth + 1)
  }
  walk(args, paths.length === 1 ? paths[0] : undefined, 0)
  for (const p of patchesIn(args)) add(p.path, p.added, p.removed)
  return [...out.values()]
}

// The addresses a call was given to fetch.
const linksIn = (args: Record<string, unknown>): string[] => {
  const out: string[] = []
  const take = (v: unknown) => {
    if (typeof v === 'string' && /^https?:\/\//i.test(v.trim()) && !v.includes('\n') && v.length <= 2000) out.push(v.trim())
  }
  take(args.url)
  if (Array.isArray(args.urls)) args.urls.forEach(take)
  return [...new Set(out)]
}

/**
 * What a tool call touched, read from its arguments: the files it was given, the command it ran,
 * the address it fetched, what it searched for. By the tool's name and the shape of its arguments,
 * so that it works for tools it has not seen. Undefined for a call that touched nothing of these.
 */
export const touchOf = (tool: string, args: Record<string, unknown>): Touch | undefined => {
  const name = tool.toLowerCase()
  if (typeof args.command === 'string' && args.command.trim()) return { op: 'run', paths: [], what: args.command }
  if (/web_?fetch|web_?search|fetch_webpage/.test(name) || typeof args.url === 'string' || Array.isArray(args.urls)) {
    const links = linksIn(args)
    return links.length ? { op: 'web', paths: [], what: whatOf(args), links } : { op: 'web', paths: [], what: whatOf(args) }
  }
  if (/grep|glob|search|find|(^|_)ls$|list/.test(name)) return { op: 'search', paths: pathsIn(args), what: whatOf(args) }
  let paths = pathsIn(args)
  // A patch names its files itself.
  if (!paths.length) paths = patchesIn(args).map(c => c.path)
  if (!paths.length) return undefined
  const op = /(^|[_-])(read|view|open|cat)([_-]|$)/.test(name)
    ? 'read'
    : /create|write|new_file/.test(name)
      ? 'write'
      : /edit|replace|insert|patch|apply|notebook|rename|move|delete|remove/.test(name)
        ? 'edit'
        : 'other'
  if (op !== 'edit' && op !== 'write') return { op, paths }
  const changes = changesOf(args, paths)
  return changes.length ? { op, paths, changes } : { op, paths }
}
