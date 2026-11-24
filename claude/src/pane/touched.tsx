import type { EngineInterface } from 'claude-code'

import type { Node } from '../../types'
import { clip, dur, tokCount } from '../format'
import { toggleFolded, toggleSelected } from '../state'
import { toolName } from '../names'
import { callLines, changeIn, commonDir, touchedOf, type FileTouch } from '../touched'
import type { Pane } from './context'
import { details } from './details'
import { tagOf } from './tags'

const MAX_CALLS = 40
const MAX_FILES = 30

// What one prompt touched, short: a tree of its tool calls in the order they ran, each with the files
// it touched under it and the lines it added and took out; then a summary of each file (what was done
// to it, the lines in all) and the total. The commands run and the things looked up are calls too, and
// the time the calls took shows against the prompt's own. The rows are the other views' business; here
// a call is a button that opens its details.
export function touched($: EngineInterface, c: Pane, top: Node) {
  const { Box, Text, Button } = c.els
  const t = touchedOf(top, c.below(top), c.now)
  const isFolded = c.fold.has(top.id)
  const root = commonDir(t.files.map(f => f.path))
  const rel = (p: string) => (root && p.startsWith(`${root}/`) ? p.slice(root.length + 1) : p)
  const t0 = top.start
  const t1 = Math.max(1000, ...[top, ...c.below(top)].map(n => (n.end ?? c.now) - t0))

  // The picked call's details open once, under its row.
  let isOpened = false
  const opened = (n: Node) => {
    if (n.id !== c.pick || isOpened) return null
    isOpened = true
    return details($, c, n, t0, t1)
  }

  const badge = (text: string) => <Text backgroundColor="subtle">{` ${text} `}</Text>

  // Lines added and taken out: nothing when neither.
  const delta = (added: number, removed: number) =>
    added || removed ? (
      <Box gap={1}>
        <Text color="success">{`+${added}`}</Text>
        <Text color="error">{`−${removed}`}</Text>
      </Box>
    ) : null

  // One call and the files under it.
  const callRows = (n: Node, isLast: boolean) => {
    const touch = n.touch!
    const tag = tagOf(n)
    const lead = isLast ? '└ ' : '├ '
    const inner = isLast ? '  ' : '│ '
    const isFiles = touch.op !== 'run' && touch.op !== 'search' && touch.op !== 'web'
    const what = isFiles ? '' : (touch.what || touch.paths.join(' ')).replace(/\s+/g, ' ').trim()
    const sum = callLines(n)
    const paths = isFiles ? touch.paths : []
    return (
      <Box key={`call:${n.id}`} flexDirection="column">
        <Box gap={1}>
          <Text dimColor>{lead}</Text>
          <Button key={`pick:${n.id}`} plain onPress={() => void toggleSelected($, n.id)}>
            <Text
              color={n.status === 'err' ? 'error' : n.status === 'run' ? 'warning' : undefined}
              dimColor={n.status === 'ok' && n.id !== c.pick}
              bold={n.id === c.pick}
            >
              {`${toolName(n)} ${dur(c.span(n))}${n.status === 'err' ? ' ✗' : ''}`}
            </Text>
            {tag ? <Text color={tag.color}>{` ${tag.text}`}</Text> : null}
          </Button>
          <Box flexGrow={1} flexShrink={1} overflow="hidden">
            <Text dimColor mono={touch.op === 'run'} wrap="truncate-end">
              {what}
            </Text>
          </Box>
          {paths.length > 1 ? delta(sum.added, sum.removed) : null}
        </Box>
        {opened(n)}
        {paths.map((p, i) => {
          const ch = changeIn(n, p)
          return (
            <Box key={`file:${n.id}:${p}`} gap={1}>
              <Text dimColor>{`${inner}${i === paths.length - 1 ? '└ ' : '├ '}`}</Text>
              <Box flexGrow={1} flexShrink={1} overflow="hidden">
                <Text wrap="truncate-start">{rel(p)}</Text>
              </Box>
              <Text dimColor>{touch.op === 'other' ? '·' : touch.op}</Text>
              {ch ? delta(ch.added, ch.removed) : null}
            </Box>
          )
        })}
      </Box>
    )
  }

  // One file, in the summary: what was done to it, the lines in all, the time of its calls.
  const fileRow = (f: FileTouch) => {
    const isChanged = f.edits + f.writes > 0
    const ops = [f.reads ? `R${f.reads}` : '', f.edits ? `E${f.edits}` : '', f.writes ? `W${f.writes}` : '', f.others ? `·${f.others}` : '']
      .filter(Boolean)
      .join(' ')
    const flags = [f.rereads ? `re-read ${f.rereads}×` : '', f.retries ? `retried ${f.retries}×` : ''].filter(Boolean).join(' · ')
    return (
      <Box key={`sum:${f.path}`} gap={1}>
        <Box flexGrow={1} flexShrink={1} overflow="hidden">
          <Text bold={isChanged} color={isChanged ? 'claude' : undefined} wrap="truncate-start">
            {rel(f.path)}
          </Text>
        </Box>
        {flags ? <Text color="warning">{flags}</Text> : null}
        {f.failed ? <Text color="error">{`✗${f.failed}`}</Text> : null}
        <Text dimColor>{ops}</Text>
        {delta(f.added, f.removed)}
        {f.tokens > 0 ? badge(tokCount(f.tokens)) : null}
        {badge(dur(f.ms))}
      </Box>
    )
  }

  const runs = t.commands.reduce((n, g) => n + g.calls.length, 0)
  const looks = t.lookups.reduce((n, g) => n + g.calls.length, 0)
  const isEmpty = t.calls.length === 0
  const idle = Math.max(0, t.wall - t.busy - t.waited)
  const counts = [
    t.files.length ? `${t.files.length} ${t.files.length === 1 ? 'file' : 'files'} (${t.edited} changed, ${t.readOnly} read only)` : '',
    t.added || t.removed ? `+${t.added} −${t.removed} lines` : '',
    runs ? `${runs} ${runs === 1 ? 'command' : 'commands'}${t.commands.length !== runs ? ` (${t.commands.length} distinct)` : ''}` : '',
    looks ? `${looks} ${looks === 1 ? 'lookup' : 'lookups'}` : '',
  ].filter(Boolean)

  const heading = (text: string, more = '') => (
    <Text dimColor wrap="truncate-start">
      {`${text}${more}`}
    </Text>
  )
  const under = root ? ` · under …${root.slice(-Math.max(10, c.cols - 24))}` : ''
  const shown = t.calls.slice(0, MAX_CALLS)

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Button key={`fold:${top.id}`} plain onPress={() => void toggleFolded($, top.id)}>
          <Text bold>{`${isFolded ? '▸' : '▾'} Prompt ${c.promptNo.get(top.id)}`}</Text>
          <Text dimColor wrap="truncate-end">{` ${clip(top.arg, Math.max(10, c.cols - 14))}`}</Text>
        </Button>
        {isFolded ? null : (
          <Text dimColor wrap="truncate-end">
            {isEmpty ? 'nothing touched: no file, command or lookup' : counts.join(' · ')}
          </Text>
        )}
        {isFolded || isEmpty ? null : (
          <Text dimColor wrap="truncate-end">
            {`calls ran ${dur(t.busy)} of ${dur(t.wall)} · model and other time ${dur(idle)}${t.waited ? ` · waited on you ${dur(t.waited)}` : ''}`}
          </Text>
        )}
      </Box>
      {isFolded || isEmpty ? null : (
        <Box flexDirection="column">
          {heading('CALLS', under)}
          {shown.map((n, i) => callRows(n, i === shown.length - 1 && t.calls.length === shown.length))}
          {t.calls.length > shown.length ? <Text dimColor>{`└ +${t.calls.length - shown.length} more calls`}</Text> : null}
        </Box>
      )}
      {isFolded || t.files.length === 0 ? null : (
        <Box flexDirection="column">
          {heading('FILES', under)}
          {t.files.slice(0, MAX_FILES).map(fileRow)}
          {t.files.length > MAX_FILES ? <Text dimColor>{`+${t.files.length - MAX_FILES} more files`}</Text> : null}
          <Box gap={1}>
            <Text bold>Total</Text>
            <Box flexGrow={1} flexShrink={1} overflow="hidden">
              <Text dimColor wrap="truncate-end">
                {`${t.files.length} ${t.files.length === 1 ? 'file' : 'files'} · ${t.edited} changed`}
              </Text>
            </Box>
            {delta(t.added, t.removed)}
          </Box>
        </Box>
      )}
    </Box>
  )
}
