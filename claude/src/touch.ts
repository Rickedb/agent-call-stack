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

/**
 * What a tool call touched, read from its arguments: the files it was given, the command it ran,
 * the address it fetched, what it searched for. By the tool's name and the shape of its arguments,
 * so that it works for tools it has not seen. Undefined for a call that touched nothing of these.
 */
export const touchOf = (tool: string, args: Record<string, unknown>): Touch | undefined => {
  const name = tool.toLowerCase()
  if (typeof args.command === 'string' && args.command.trim()) return { op: 'run', paths: [], what: args.command }
  if (/web_?fetch|web_?search|fetch_webpage/.test(name) || typeof args.url === 'string' || Array.isArray(args.urls)) {
    return { op: 'web', paths: [], what: whatOf(args) }
  }
  if (/grep|glob|search|find|(^|_)ls$|list/.test(name)) return { op: 'search', paths: pathsIn(args), what: whatOf(args) }
  const paths = pathsIn(args)
  if (!paths.length) return undefined
  if (/(^|[_-])(read|view|open|cat)([_-]|$)/.test(name)) return { op: 'read', paths }
  if (/create|write|new_file/.test(name)) return { op: 'write', paths }
  if (/edit|replace|insert|patch|apply|notebook|rename|move|delete|remove/.test(name)) return { op: 'edit', paths }
  return { op: 'other', paths }
}
