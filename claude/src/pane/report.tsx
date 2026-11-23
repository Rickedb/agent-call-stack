import type { Node } from '../../types'
import { clip, dur, tokCount } from '../format'
import { reportOf, type Report } from '../stats'
import type { Pane } from './context'
import { tint } from './theme'

const MAX_KINDS = 8
const pct = (a: number, b: number) => (b > 0 ? Math.min(100, Math.round((a / b) * 100)) : 0)
const named = (n: Node) => `${n.name}${n.arg ? ` ${n.arg}` : ''}`

// What a finished prompt did, under its rows: the calls by tool, the slowest and
// the heaviest, and the tokens (estimates). Nothing while it runs, or for a
// prompt read back from history.
export function report(c: Pane, top: Node) {
  const { Box, Text } = c.els
  const r: Report | undefined = reportOf(top, c.below(top), c.now)
  if (!r) return null

  // The room inside the border and its padding.
  const room = Math.max(10, c.cols - 4)
  const line = (label: string, text: string) => (
    <Text mono wrap="truncate">
      <Text dimColor>{label.padEnd(10)}</Text>
      {clip(text, room - 10)}
    </Text>
  )

  // The tools as a table; the name column takes what the numbers leave.
  const shown = r.kinds.slice(0, MAX_KINDS)
  const cell = (k: (typeof shown)[number]) => ({
    calls: `${k.count}`,
    avg: k.done ? dur(Math.round(k.avg)) : '—',
    total: k.done ? dur(k.ms) : '—',
    tok: k.tokens > 0 ? tokCount(k.tokens) : '—',
  })
  const cells = shown.map(cell)
  const w = {
    calls: Math.max(5, ...cells.map(x => x.calls.length)),
    avg: Math.max(3, ...cells.map(x => x.avg.length)),
    total: Math.max(5, ...cells.map(x => x.total.length)),
    tok: Math.max(3, ...cells.map(x => x.tok.length)),
  }
  const numbers = w.calls + w.avg + w.total + w.tok + 4 * 2
  const nameW = Math.max(4, Math.min(Math.max(...shown.map(k => k.name.length), 4), room - numbers))
  const head = `${'tool'.padEnd(nameW)}  ${'calls'.padStart(w.calls)}  ${'avg'.padStart(w.avg)}  ${'total'.padStart(w.total)}  ${'tokens'.padStart(w.tok)}`

  const verdict = r.failed ? `${r.calls} tool calls · ${r.failed} failed` : `${r.calls} tool calls`
  const facts = [
    r.agents.count
      ? `${r.agents.count} ${r.agents.count === 1 ? 'subagent' : 'subagents'}${r.agents.failed ? ` (${r.agents.failed} failed)` : ''}${r.agents.longest ? ` · longest ${named(r.agents.longest)} ${dur(r.agents.longest.end! - r.agents.longest.start)}` : ''}`
      : '',
  ].filter(Boolean)

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={tint(top)} paddingX={1} marginTop={1}>
      <Text bold wrap="truncate">
        Summary
        <Text dimColor>{` · ${verdict} · took ${dur(r.wall)} · ${pct(r.busy, r.wall)}% of it in calls`}</Text>
      </Text>
      {r.kinds.length ? (
        <Box flexDirection="column" marginTop={1}>
          <Text mono dimColor wrap="truncate">
            {head}
          </Text>
          {shown.map((k, i) => (
            <Box>
              <Text mono wrap="truncate">
                {`${clip(k.name, nameW).padEnd(nameW)}  ${cells[i]!.calls.padStart(w.calls)}  ${cells[i]!.avg.padStart(w.avg)}  ${cells[i]!.total.padStart(w.total)}  ${cells[i]!.tok.padStart(w.tok)}`}
              </Text>
              {k.failed ? <Text color="error">{` ✗${k.failed}`}</Text> : null}
            </Box>
          ))}
          {r.kinds.length > shown.length ? (
            <Text dimColor>{`+${r.kinds.length - shown.length} more tools`}</Text>
          ) : null}
        </Box>
      ) : null}
      <Box flexDirection="column" marginTop={1}>
        {r.slowest ? line('Average', `${dur(Math.round(r.avg))} a tool call`) : null}
        {r.slowest ? line('Slowest', `${named(r.slowest)}  ${dur(r.slowest.end! - r.slowest.start)}`) : null}
        {r.heaviest ? line('Heaviest', `${named(r.heaviest)}  ${tokCount(r.heavy)}`) : null}
        {line('Tokens', `in ${tokCount(r.input)} · out ${tokCount(r.output)} · total ${tokCount(r.input + r.output)} (estimated)`)}
        {facts.map(f => line('Subagents', f))}
      </Box>
    </Box>
  )
}
