import type { EngineInterface } from 'claude-code'

import type { Node } from '../../types'
import { clip, dur, fmtTokens, modelName, tokCount, tokExact } from '../format'
import { reportOf, type Report } from '../stats'
import { toggleShut } from '../state'
import type { Pane } from './context'
import { reportMarkdown } from './markdown'
import { tint } from './theme'

const MAX_KINDS = 8
const MAX_ERRORS = 5
const pct = (a: number, b: number) => (b > 0 ? Math.min(100, Math.round((a / b) * 100)) : 0)
const named = (n: Node) => `${n.name}${n.arg ? ` ${n.arg}` : ''}`

// What a finished prompt did, under its rows: the calls by tool, the slowest and
// the heaviest, and the tokens (estimates). Nothing while it runs, or for a
// prompt read back from history.
export function report($: EngineInterface, c: Pane, top: Node) {
  const { Box, Text, Button } = c.els
  const r: Report | undefined = reportOf(top, c.below(top), c.now)
  if (!r) return null

  const isShut = c.shut.has(top.id)

  // What went into the model, cached or not: the API counts the three apart.
  const sent = r.usage ? r.usage.input + r.usage.cacheRead + r.usage.cacheWrite : 0

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
  const who = (n: Node) => (n.kind === 'prompt' ? 'the prompt' : named(n))
  const shownErrors = r.errors.slice(0, MAX_ERRORS)

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={tint(top)} paddingX={1} marginTop={1}>
      <Box justifyContent="space-between">
        <Box flexShrink={1} overflow="hidden">
          <Button key={`shut:${top.id}`} plain onPress={() => void toggleShut($, top.id)}>
            <Text bold wrap="truncate-end">{`${isShut ? '▸' : '▾'} Summary`}</Text>
            <Text dimColor wrap="truncate-end">{` · ${verdict} · took ${dur(r.wall)} · ${pct(r.busy, r.wall)}% of it in calls`}</Text>
          </Button>
        </Box>
        <Box flexShrink={0} paddingLeft={1}>
          <Button
            key={`copy-summary:${top.id}`}
            plain
            onPress={p => void $.ui.copy({ text: reportMarkdown(`Prompt ${c.promptNo.get(top.id)}`, top, r), surface: p.surface })}
          >
            Copy
          </Button>
        </Box>
      </Box>
      {isShut ? null : r.kinds.length ? (
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
      {isShut ? null : (
      <Box flexDirection="column" marginTop={1}>
        {r.slowest ? line('Average', `${dur(Math.round(r.avg))} a tool call`) : null}
        {r.slowest ? line('Slowest', `${named(r.slowest)}  ${dur(r.slowest.end! - r.slowest.start)}`) : null}
        {r.heaviest ? line('Heaviest', `${named(r.heaviest)}  ${tokCount(r.heavy)}`) : null}
        {r.models.length
          ? line(
              'Models',
              r.models
                .map(m => {
                  const who = [m.main ? 'prompt' : '', m.agents ? `${m.agents} ${m.agents === 1 ? 'subagent' : 'subagents'}` : ''].filter(Boolean)
                  return `${modelName(m.model)} (${who.join(', ')})`
                })
                .join(' · '),
            )
          : null}
        {r.usage
          ? line(
              'Tokens',
              `in ${tokExact(sent)} · out ${tokExact(r.usage.output)} · total ${tokExact(sent + r.usage.output)} (reported)`,
            )
          : line('Tokens', `in ${tokCount(r.input)} · out ${tokCount(r.output)} · total ${tokCount(r.input + r.output)} (estimated)`)}
        {r.usage && sent > 0
          ? line(
              'Cache',
              `${pct(r.usage.cacheRead, sent)}% of input from cache · ${tokExact(r.usage.cacheRead)} read · ${tokExact(r.usage.cacheWrite)} written`,
            )
          : null}
        {r.usage ? line('Call text', `in ${tokCount(r.input)} · out ${tokCount(r.output)} (estimated, what the calls were given and returned)`) : null}
        {facts.map(f => line('Subagents', f))}
        {r.perms
          ? line(
              'Approvals',
              `${r.perms.allowed} allowed · ${r.perms.asked} asked you${r.perms.waited ? ` (waited ${dur(r.perms.waited)})` : ''}${r.perms.denied ? ` · ${r.perms.denied} not allowed` : ''}`,
            )
          : null}
        {r.compacts
          ? line(
              'Compacts',
              `${r.compacts.count}${r.compacts.manual || r.compacts.auto ? ` (${[r.compacts.manual ? `${r.compacts.manual} manual` : '', r.compacts.auto ? `${r.compacts.auto} auto` : ''].filter(Boolean).join(', ')})` : ''}${r.compacts.before !== undefined && r.compacts.after !== undefined ? ` · ${fmtTokens(r.compacts.before)} → ${fmtTokens(r.compacts.after)} tok` : ''}${r.compacts.saved ? ` · ${fmtTokens(r.compacts.saved)} tok saved` : ''} · took ${dur(r.compacts.ms)}`,
            )
          : null}
        {shownErrors.map(f => (
          <Text mono wrap="truncate">
            <Text color="error">{'Error'.padEnd(10)}</Text>
            {clip(`${who(f.node)} — ${f.why}`, room - 10)}
          </Text>
        ))}
        {r.errors.length > shownErrors.length ? <Text dimColor>{`+${r.errors.length - shownErrors.length} more errors`}</Text> : null}
      </Box>
      )}
    </Box>
  )
}
