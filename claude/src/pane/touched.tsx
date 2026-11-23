import type { EngineInterface } from 'claude-code'

import type { Node } from '../../types'
import { clip, dur, tokCount } from '../format'
import { toggleFolded, toggleSelected } from '../state'
import { commonDir, touchedOf, type FileTouch, type Group } from '../touched'
import type { Pane } from './context'
import { details } from './details'
import { tagOf } from './tags'

const MAX_FILES = 12
const MAX_GROUPS = 8
const MAX_CALLS = 6

// What one prompt touched, short: its files (what was done to each and the calls that did it), the
// commands it ran, and what it looked up, with the time the calls took against the prompt's own.
// The rows are the other views' business; here a call is a button that opens its details.
export function touched($: EngineInterface, c: Pane, top: Node) {
  const { Box, Text, Button } = c.els
  const t = touchedOf(top, c.below(top), c.now)
  const isFolded = c.fold.has(top.id)
  const root = commonDir(t.files.map(f => f.path))
  const rel = (p: string) => (root && p.startsWith(`${root}/`) ? p.slice(root.length + 1) : p)
  const t0 = top.start
  const t1 = Math.max(1000, ...[top, ...c.below(top)].map(n => (n.end ?? c.now) - t0))

  // The picked call's details open once, under the first place the call shows.
  let isOpened = false
  const opened = (calls: Node[]) => {
    const picked = calls.find(n => n.id === c.pick)
    if (!picked || isOpened) return null
    isOpened = true
    return details($, c, picked, t0, t1)
  }

  // The calls of one file, command or lookup, each a button: name, time, a mark if it failed, and
  // what was asked of the person.
  const chain = (calls: Node[], at: string) => {
    const shown = calls.slice(0, MAX_CALLS)
    return (
      <Box gap={1} paddingLeft={2} overflow="hidden">
        {shown.map(n => {
          const tag = tagOf(n)
          return (
            <Button key={`pick:${at}:${n.id}`} plain onPress={() => void toggleSelected($, n.id)}>
              <Text
                color={n.status === 'err' ? 'error' : n.status === 'run' ? 'warning' : undefined}
                dimColor={n.status === 'ok' && n.id !== c.pick}
                bold={n.id === c.pick}
              >
                {`${n.name} ${dur(c.span(n))}${n.status === 'err' ? ' ✗' : ''}`}
              </Text>
              {tag ? <Text color={tag.color}>{` ${tag.text}`}</Text> : null}
            </Button>
          )
        })}
        {calls.length > shown.length ? <Text dimColor>{`+${calls.length - shown.length}`}</Text> : null}
      </Box>
    )
  }

  const badge = (text: string) => <Text backgroundColor="subtle">{` ${text} `}</Text>

  const fileRow = (f: FileTouch) => {
    const isChanged = f.edits + f.writes > 0
    const ops = [f.reads ? `R${f.reads}` : '', f.edits ? `E${f.edits}` : '', f.writes ? `W${f.writes}` : '', f.others ? `·${f.others}` : '']
      .filter(Boolean)
      .join(' ')
    const flags = [f.rereads ? `re-read ${f.rereads}×` : '', f.retries ? `retried ${f.retries}×` : ''].filter(Boolean).join(' · ')
    return (
      <Box flexDirection="column">
        <Box gap={1}>
          <Box flexGrow={1} flexShrink={1} overflow="hidden">
            <Text bold={isChanged} color={isChanged ? 'claude' : undefined} wrap="truncate-start">
              {rel(f.path)}
            </Text>
          </Box>
          {flags ? <Text color="warning">{flags}</Text> : null}
          {f.failed ? <Text color="error">{`✗${f.failed}`}</Text> : null}
          <Text dimColor>{ops}</Text>
          {f.tokens > 0 ? badge(tokCount(f.tokens)) : null}
          {badge(dur(f.ms))}
        </Box>
        {chain(f.calls, f.path)}
        {opened(f.calls)}
      </Box>
    )
  }

  const groupRow = (g: Group) => (
    <Box flexDirection="column">
      <Box gap={1}>
        <Box flexGrow={1} flexShrink={1} overflow="hidden">
          <Text mono={g.kind === 'run'} wrap="truncate-end">
            {g.kind === 'run' ? g.what : `${g.calls[0]?.name ?? g.kind} ${g.what}`}
          </Text>
        </Box>
        {g.calls.length > 1 ? <Text color="warning">{`×${g.calls.length}`}</Text> : null}
        {g.failed ? <Text color="error">{`✗${g.failed}`}</Text> : null}
        {g.tokens > 0 ? badge(tokCount(g.tokens)) : null}
        {badge(dur(g.ms))}
      </Box>
      {chain(g.calls, `${g.kind}:${g.what}`)}
      {opened(g.calls)}
    </Box>
  )

  const runs = t.commands.reduce((n, g) => n + g.calls.length, 0)
  const looks = t.lookups.reduce((n, g) => n + g.calls.length, 0)
  const isEmpty = t.files.length + t.commands.length + t.lookups.length === 0
  const idle = Math.max(0, t.wall - t.busy - t.waited)
  const counts = [
    t.files.length ? `${t.files.length} ${t.files.length === 1 ? 'file' : 'files'} (${t.edited} changed, ${t.readOnly} read only)` : '',
    runs ? `${runs} ${runs === 1 ? 'command' : 'commands'}${t.commands.length !== runs ? ` (${t.commands.length} distinct)` : ''}` : '',
    looks ? `${looks} ${looks === 1 ? 'lookup' : 'lookups'}` : '',
  ].filter(Boolean)

  const heading = (text: string, more = '') => (
    <Text dimColor wrap="truncate-start">
      {`${text}${more}`}
    </Text>
  )

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
      {isFolded || t.files.length === 0 ? null : (
        <Box flexDirection="column">
          {heading('FILES', root ? ` · under …${root.slice(-Math.max(10, c.cols - 24))}` : '')}
          {t.files.slice(0, MAX_FILES).map(fileRow)}
          {t.files.length > MAX_FILES ? <Text dimColor>{`+${t.files.length - MAX_FILES} more files`}</Text> : null}
        </Box>
      )}
      {isFolded || t.commands.length === 0 ? null : (
        <Box flexDirection="column">
          {heading('COMMANDS')}
          {t.commands.slice(0, MAX_GROUPS).map(groupRow)}
          {t.commands.length > MAX_GROUPS ? <Text dimColor>{`+${t.commands.length - MAX_GROUPS} more commands`}</Text> : null}
        </Box>
      )}
      {isFolded || t.lookups.length === 0 ? null : (
        <Box flexDirection="column">
          {heading('LOOKUPS')}
          {t.lookups.slice(0, MAX_GROUPS).map(groupRow)}
          {t.lookups.length > MAX_GROUPS ? <Text dimColor>{`+${t.lookups.length - MAX_GROUPS} more lookups`}</Text> : null}
        </Box>
      )}
    </Box>
  )
}
