import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionMessage } from 'claude-code'

import type { Node } from '../types'

const PANE = 'ai-call-tree'
const MAX_NODES = 300
// What the state keeps of one text. Longer text goes whole to a file.
const KEEP = 8000
// History is kept shorter still: it can be a hundred calls at once.
const HIST_KEEP = 1500
// What a file keeps: the engine reads and writes up to 4 MiB.
const FILE_MAX = 1_000_000
// Lines of a text drawn before "Show all".
const LINES = 20

// Change a tag when the fields of what it holds change: it declines what an
// earlier version stored, which outlives a reload.
const nodes = atom({ plugin: 'ai-call-tree', key: 'nodes' } as const, [], {
  shape: 'nodes-5',
})
const root = atom({ plugin: 'ai-call-tree', key: 'root' } as const, '', {
  shape: 'root-1',
})
const mode = atom({ plugin: 'ai-call-tree', key: 'mode' } as const, 'waterfall', {
  shape: 'mode-2',
})
const isClosed = atom({ plugin: 'ai-call-tree', key: 'isClosed' } as const, false, {
  shape: 'isClosed-1',
})
const filled = atom({ plugin: 'ai-call-tree', key: 'filled' } as const, false, {
  shape: 'filled-1',
})
const selected = atom({ plugin: 'ai-call-tree', key: 'selected' } as const, '', {
  shape: 'selected-1',
})
const folded = atom({ plugin: 'ai-call-tree', key: 'folded' } as const, [], {
  shape: 'folded-1',
})
const shown = atom({ plugin: 'ai-call-tree', key: 'shown' } as const, [], {
  shape: 'shown-1',
})

const clip = (s: string, n: number) => {
  const one = s.replace(/\s+/g, ' ').trim()
  if (n <= 0) return ''
  return one.length > n ? one.slice(0, Math.max(1, n - 1)) + '…' : one
}

// The most telling argument of a tool call, whatever the tool.
const KEYS = ['command', 'file_path', 'pattern', 'url', 'query', 'path', 'description', 'prompt']
const summarize = (e: Record<string, unknown>): string => {
  for (const k of KEYS) {
    const v = e[k]
    if (typeof v === 'string' && v) return clip(v, 160)
  }
  return ''
}

const RESERVED = new Set(['tool', 'tool_use_id', 'agentId', 'requestMeta'])
// A call's arguments as a person reads them: `key: value`, and a long or
// multi-line value on lines of its own, as it is, not as an escaped string.
const describe = (e: Record<string, unknown>): string =>
  Object.keys(e)
    .filter(k => !RESERVED.has(k) && e[k] !== undefined)
    .map(k => {
      const v = e[k]
      if (typeof v === 'string' && (v.includes('\n') || v.length > 80)) return `${k}:\n${v}`
      return `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`
    })
    .join('\n')

const dur = (ms: number) => {
  const m = Math.max(0, ms)
  if (m < 1000) return `${m}ms`
  if (m < 60000) return `${(m / 1000).toFixed(1)}s`
  return `${Math.floor(m / 60000)}m ${Math.round((m % 60000) / 1000)}s`
}

// A text's size in tokens. The engine gives no count per call (only per model
// response), so every row is estimated alike, at four characters a token, and
// drawn with a "~". The length is the whole text's, not the cut one the state keeps.
const sizeOf = (n: Node, which: 'input' | 'output') =>
  (which === 'input' ? n.inputLen ?? n.input?.length : n.outputLen ?? n.output?.length) ?? 0

const fmtTokens = (n: number) =>
  n < 1000
    ? `${n}`
    : n < 10_000
      ? `${(n / 1000).toFixed(1)}k`
      : n < 1_000_000
        ? `${Math.round(n / 1000)}k`
        : `${(n / 1_000_000).toFixed(1)}M`

/** `~340 tok`, or `—` for a text there is none of (yet). */
const tokText = (n: Node, which: 'input' | 'output') => {
  const len = sizeOf(n, which)
  return len > 0 ? `~${fmtTokens(Math.ceil(len / 4))} tok` : '—'
}

const upsert = (list: Node[], node: Node): Node[] => {
  const i = list.findIndex(n => n.id === node.id)
  const next =
    i < 0 ? [...list, node] : list.map((n, j) => (j === i ? { ...n, ...node, start: n.start } : n))
  return next.slice(-MAX_NODES)
}

const patch = (list: Node[], id: string, fields: Partial<Node>): Node[] =>
  list.map(n => (n.id === id ? { ...n, ...fields } : n))

// Keeps a text in the state up to KEEP characters; a longer one is also
// written whole to a file, whose path the node carries. A file that cannot be
// written leaves the cut text, which says so.
const keep = async (
  $: EngineInterface,
  id: string,
  which: 'input' | 'output',
  text: string,
  limit = KEEP,
): Promise<Partial<Node>> => {
  if (text.length <= limit) return { [which]: text, [`${which}Len`]: text.length }
  const fields: Partial<Node> = {
    [which]: text.slice(0, limit),
    [`${which}Len`]: text.length,
  }
  try {
    const home = await $.env.get('HOME')
    if (home) {
      const path = `${home}/.claude/ai-call-tree/${id.replace(/[^\w.-]/g, '_')}.${which}.txt`
      await $.fs.write(path, text.slice(0, FILE_MAX))
      fields[`${which}File`] = path
    }
  } catch {
    // The cut text stands.
  }
  return fields
}

// The user's own words in a message: what the app adds around them (system
// reminders) is not a prompt.
const userText = (t: string) =>
  t.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim()

// Reads the chat's history once into the nodes: every prompt before the first
// one this mod saw live, with its tool calls and subagents. History has no
// start or end times, so those rows draw without bars; an agent's duration is
// the one time the transcript keeps.
const backfill = async ($: EngineInterface) => {
  if (await read($, filled)) return
  const msgs = await $.session.messages()
  await update($, filled, () => true)

  const existing = await read($, nodes)
  const firstLive = existing.find(n => n.kind === 'prompt' && !n.hist)
  let end = msgs.length
  if (firstLive?.input) {
    // History stops where the first prompt seen live begins.
    const probe = firstLive.input.trim().slice(0, 200)
    let at = -1
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i]
      if (m && m.role === 'user' && userText(m.text).startsWith(probe)) {
        at = i
        break
      }
    }
    if (at < 0) return
    end = at
  } else if (existing.length > 0) {
    return
  }

  const have = new Set(existing.map(n => n.id))
  const out: Node[] = []
  const finalText = new Map<string, string>()

  const addUses = async (
    uses: SessionMessage['toolUses'],
    parent: string,
    depth: number,
  ): Promise<void> => {
    for (const u of uses) {
      const isAgent = u.tool === 'Agent'
      const id = isAgent ? `a:${u.agentId ?? u.tool_use_id}` : u.tool_use_id
      if (have.has(id)) continue
      have.add(id)
      const input = isAgent ? String(u.input.prompt ?? '') : describe(u.input)
      out.push({
        id,
        parent,
        kind: isAgent ? 'agent' : 'tool',
        name: isAgent ? String(u.input.subagent_type ?? 'Agent') : u.tool,
        arg: isAgent ? clip(String(u.input.description ?? ''), 160) : summarize(u.input),
        status: u.isError ? 'err' : 'ok',
        start: 0,
        hist: true,
        ...(u.durationMs !== undefined ? { ms: u.durationMs } : {}),
        ...(await keep($, id, 'input', input, HIST_KEEP)),
        ...(u.text ? await keep($, id, 'output', u.text, HIST_KEEP) : {}),
      })
      if (isAgent && u.agentId && depth < 3) {
        const inner = await $.session.messages({ agentId: u.agentId })
        if (Array.isArray(inner)) {
          await addUses(
            inner.flatMap(m => m.toolUses),
            id,
            depth + 1,
          )
        }
      }
    }
  }

  let current = ''
  for (let i = 0; i < end; i++) {
    const m = msgs[i]
    if (!m) continue
    if (m.role === 'user') {
      const text = userText(m.text)
      if (!text) continue
      current = `h:${i}`
      out.push({
        id: current,
        kind: 'prompt',
        name: 'Prompt',
        arg: clip(text, 160),
        status: 'ok',
        start: 0,
        hist: true,
        ...(await keep($, current, 'input', text, HIST_KEEP)),
      })
    } else {
      if (!current) {
        current = 'h:start'
        out.push({
          id: current,
          kind: 'prompt',
          name: 'Prompt',
          arg: '(earlier activity)',
          status: 'ok',
          start: 0,
          hist: true,
        })
      }
      if (m.text) finalText.set(current, m.text)
      await addUses(m.toolUses, current, 0)
    }
  }
  for (const n of out) {
    const text = n.kind === 'prompt' ? finalText.get(n.id) : undefined
    if (text) Object.assign(n, await keep($, n.id, 'output', text, HIST_KEEP))
  }

  await update($, nodes, list =>
    [...out, ...list.filter(n => !out.some(o => o.id === n.id))].slice(-MAX_NODES),
  )
}

// Recording must never get in the way of the work: a failure is said in a
// toast, and the call goes on.
const guard = async ($: EngineInterface, what: string, fn: () => Promise<void>) => {
  try {
    await fn()
  } catch (err) {
    $.ui.toast(`Call tree: ${what}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

// Theme keys, so the pane follows the app's colors in light and dark.
const tint = (n: Node) =>
  n.status === 'err'
    ? 'error'
    : n.status === 'run'
      ? 'warning'
      : n.kind === 'prompt'
        ? 'claude'
        : n.kind === 'agent'
          ? 'permission'
          : 'success'

// What a node is: an icon per kind. Emoji take no color, so the status
// stays beside it as a small tinted mark.
const KIND_ICON: Record<Node['kind'], string> = { prompt: '💬', agent: '🤖', tool: '🔧' }
const icon = (n: Node) => KIND_ICON[n.kind]

const mark = (n: Node) => (n.status === 'run' ? '●' : n.status === 'ok' ? '✓' : '✗')

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'call-tree',
      description: 'Show the calling tree of this session in a pane',
    })
    await update($, isClosed, () => false)
    void $.ui.open({ id: PANE, title: 'Call tree' })

    // Running bars grow with the clock: redraw once a second while any runs.
    $.clock.every(1000, async () => {
      if ((await read($, nodes)).some(n => n.status === 'run')) $.ui.invalidate('ui.render')
    })

    const out = await next(e)
    // The chat's earlier prompts, read back from its history.
    await backfill($).catch(() => {})
    return out
  })

  on('command.run', { command: 'call-tree' }, async $ => {
    await update($, isClosed, () => false)
    await $.ui.open({ id: PANE, title: 'Call tree' })
    return { text: 'Call tree pane opened.' }
  })

  // A pane the person closed leaves a button above the prompt to open it again.
  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) await update($, isClosed, () => true)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await read($, isClosed))) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const running = (await read($, nodes)).filter(n => n.status === 'run' && n.kind !== 'prompt')

    return (
      <Box gap={1}>
        <Button
          key="open-call-tree"
          onPress={async () => {
            await update($, isClosed, () => false)
            await $.ui.open({ id: PANE, title: 'Call tree' })
          }}
        >
          Open call tree
        </Button>
        {running.length ? <Text color="warning">● {running.length} running</Text> : null}
      </Box>
    )
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      await guard($, 'prompt', async () => {
        const text = await keep($, e.turnId, 'input', e.text)
        await update($, root, () => e.turnId)
        await update($, nodes, list =>
          upsert(list, {
            id: e.turnId,
            kind: 'prompt',
            name: 'Prompt',
            arg: clip(e.text || '(continued turn)', 160),
            status: 'run',
            start: Date.now(),
            ...text,
          }),
        )
      })
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await guard($, 'turn end', async () => {
      const id = e.agentId === undefined ? e.turnId : `a:${e.agentId}`
      const status = e.reason === 'answer' ? 'ok' : 'err'
      const text = await keep($, id, 'output', e.answer || `(${e.reason})`)
      await update($, nodes, list => patch(list, id, { status, end: Date.now(), ...text }))
    })
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const out = await next(e)
    if ('agentId' in out && out.agentId) {
      await guard($, 'subagent', async () => {
        const id = `a:${out.agentId}`
        const parent = e.parentAgentId ? `a:${e.parentAgentId}` : await read($, root)
        const text = await keep($, id, 'input', e.prompt)
        await update($, nodes, list =>
          upsert(list, {
            id,
            parent: parent || undefined,
            kind: 'agent',
            name: e.subagentType,
            arg: clip(e.description, 160),
            status: 'run',
            start: Date.now(),
            ...text,
          }),
        )
      })
    }
    return out
  })

  on('tool.call', async ($, e, next) => {
    // The Agent call is drawn as the subagent it starts.
    if (e.tool === 'Agent') return next(e)

    const id = e.tool_use_id
    await guard($, 'tool call', async () => {
      const rootId = await read($, root)
      const parent = e.agentId ? `a:${e.agentId}` : rootId
      const args = e as unknown as Record<string, unknown>
      const given = await keep($, id, 'input', describe(args))
      await update($, nodes, list => {
        // A subagent's call may arrive before its spawn settles.
        const withAgent =
          e.agentId && !list.some(n => n.id === `a:${e.agentId}`)
            ? upsert(list, {
                id: `a:${e.agentId}`,
                parent: rootId || undefined,
                kind: 'agent',
                name: 'subagent',
                arg: '',
                status: 'run',
                start: Date.now(),
              })
            : list
        return upsert(withAgent, {
          id,
          parent: parent || undefined,
          kind: 'tool',
          name: e.tool,
          arg: summarize(args),
          status: 'run',
          start: Date.now(),
          ...given,
        })
      })
    })
    const ran = await next(e)
    await guard($, 'tool result', async () => {
      const isDenied = 'deny' in ran && ran.deny !== undefined
      const failed = isDenied || ('isError' in ran && ran.isError === true)
      const text = isDenied ? `denied: ${ran.deny}` : 'text' in ran && ran.text ? ran.text : ''
      const got = await keep($, id, 'output', text)
      await update($, nodes, list =>
        patch(list, id, { status: failed ? 'err' : 'ok', end: Date.now(), ...got }),
      )
    })
    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    try {
    const list = await read($, nodes)
    const pick = await read($, selected)
    const isWaterfall = (await read($, mode)) === 'waterfall'
    const fold = new Set(await read($, folded))
    const whole = new Set(await read($, shown))
    const cols = Math.max(24, e.props.bodyColumns)
    const now = Date.now()

    const prompts = list.filter(n => n.kind === 'prompt')
    if (prompts.length === 0) {
      return (
        <Box flexDirection="column" gap={1} paddingY={1}>
          <Text bold>No calls yet</Text>
          <Text dimColor>Send a prompt and what Claude does shows up here, as a tree.</Text>
        </Box>
      )
    }

    const ids = new Set(list.map(n => n.id))
    const kids = new Map<string, Node[]>()
    for (const n of list) {
      if (n.parent && ids.has(n.parent)) kids.set(n.parent, [...(kids.get(n.parent) ?? []), n])
    }
    const below = (n: Node): Node[] => (kids.get(n.id) ?? []).flatMap(c => [c, ...below(c)])
    const span = (n: Node) => (n.hist ? (n.ms ?? 0) : (n.end ?? now) - n.start)

    const gutter = 2
    const barW = Math.max(10, cols - gutter)
    const promptNo = new Map(prompts.map((n, i) => [n.id, i + 1]))

    // A small seat: what runs now, at a glance.
    if (e.props.placement === 'widget') {
      const last = prompts[prompts.length - 1] as Node
      const live = [last, ...below(last)].filter(n => n.status === 'run' && n.kind !== 'prompt')
      const inner = live[live.length - 1] ?? last
      return (
        <Box flexDirection="column">
          <Text bold color={tint(inner)}>
            {icon(inner)} {mark(inner)} {clip(inner.name + (inner.arg ? ` ${inner.arg}` : ''), cols - 5)}
          </Text>
          <Text dimColor>
            {live.length} running · {dur(span(last))}
          </Text>
        </Box>
      )
    }

    const everyCall = prompts.flatMap(p => below(p))
    const total = {
      ok: everyCall.filter(n => n.status === 'ok').length,
      err: everyCall.filter(n => n.status === 'err').length,
      run: everyCall.filter(n => n.status === 'run').length,
    }
    const foldable = list.filter(n => (kids.get(n.id) ?? []).length > 0).map(n => n.id)
    const isAllFolded = foldable.length > 0 && foldable.every(id => fold.has(id))

    // One text of a call, drawn whole and wrapped; the first lines until
    // "Show all". A cut text says so, and where the whole is.
    const block = (n: Node, which: 'input' | 'output') => {
      const text = which === 'input' ? n.input : n.output
      if (!text) return null
      const len = (which === 'input' ? n.inputLen : n.outputLen) ?? text.length
      const file = which === 'input' ? n.inputFile : n.outputFile
      const key = `${n.id}:${which}`
      const split = text.split('\n')
      const isOpen = whole.has(key)
      const visible = isOpen ? split : split.slice(0, LINES)
      const isCut = len > text.length
      return (
        <Box flexDirection="column">
          <Text dimColor>
            {which === 'input' ? 'INPUT' : 'OUTPUT'}
            {isCut ? ` · first ${text.length.toLocaleString()} of ${len.toLocaleString()} characters` : ''}
          </Text>
          <Box backgroundColor="subtle" paddingX={1}>
            <Text mono>{visible.join('\n')}</Text>
          </Box>
          <Box gap={2}>
            {split.length > LINES ? (
              <Button
                key={`more:${key}`}
                plain
                onPress={() =>
                  void update($, shown, s => (s.includes(key) ? s.filter(x => x !== key) : [...s, key]))
                }
              >
                {isOpen ? 'Show less' : `Show all ${split.length} lines`}
              </Button>
            ) : null}
            <Button
              key={`copy:${key}`}
              plain
              onPress={async p => {
                // The whole text: from its file when the state kept only a cut.
                const full = file ? await $.fs.read(file).catch(() => text) : text
                void $.ui.copy({ text: full, surface: p.surface })
              }}
            >
              {file ? 'Copy all' : 'Copy'}
            </Button>
            {file ? (
              <Button
                key={`path:${key}`}
                plain
                onPress={p => void $.ui.copy({ text: file, surface: p.surface })}
              >
                Copy file path
              </Button>
            ) : null}
          </Box>
          {isCut ? (
            <Text dimColor>{file ? `Whole text: ${file}` : 'The rest could not be saved.'}</Text>
          ) : null}
        </Box>
      )
    }

    const details = (n: Node, t0: number, t1: number) => (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={tint(n)}
        paddingX={1}
        marginLeft={gutter}
        marginY={1}
        gap={1}
      >
        <Box flexDirection="column">
          <Text>
            <Text color={tint(n)} bold>
              {icon(n)} {mark(n)} {n.status === 'run' ? 'Running' : n.status === 'ok' ? 'Done' : 'Failed'}
            </Text>
            <Text dimColor> · {n.kind}</Text>
          </Text>
          {n.hist ? (
            <Text dimColor>
              From earlier in the chat{n.ms !== undefined ? ` · took ${dur(n.ms)}` : ' · timing was not recorded'}
            </Text>
          ) : (
            <Text dimColor>
              started +{dur(n.start - t0)} · took {dur(span(n))} ·{' '}
              {Math.min(100, Math.round((span(n) / t1) * 100))}% of prompt
            </Text>
          )}
          <Text dimColor>{`input ${tokText(n, 'input')} · output ${tokText(n, 'output')}`}</Text>
        </Box>
        {block(n, 'input')}
        {block(n, 'output')}
        <Button key="close" role="dismiss" onPress={() => void update($, selected, () => '')}>
          Close
        </Button>
      </Box>
    )

    // One prompt: its own time axis and its rows, honoring folds.
    const section = (top: Node) => {
      const all = [top, ...below(top)]
      const t0 = top.start
      const t1 = Math.max(1000, ...all.map(n => (n.hist ? span(n) : (n.end ?? now) - t0)))
      const slowest = all
        .filter(n => n.kind !== 'prompt' && n.status !== 'run')
        .sort((a, b) => span(b) - span(a))[0]

      const rows: { node: Node; depth: number; hidden: number }[] = []
      const walk = (n: Node, depth: number) => {
        rows.push({ node: n, depth, hidden: fold.has(n.id) ? below(n).length : 0 })
        if (!fold.has(n.id)) (kids.get(n.id) ?? []).forEach(c => walk(c, depth + 1))
      }
      walk(top, 0)

      const bar = (n: Node) => {
        // History has no start time, and most of it no duration: the track alone.
        const isTimed = !n.hist || n.ms !== undefined
        const off =
          isWaterfall && !n.hist ? Math.min(barW - 1, Math.floor(((n.start - t0) / t1) * barW)) : 0
        const wide = Math.max(1, Math.min(barW - off, Math.ceil((span(n) / t1) * barW)))
        return (
          <Box marginLeft={gutter} width={barW} flexShrink={0} backgroundColor="subtle">
            {isTimed ? (
              <Box marginLeft={off} width={wide} backgroundColor={tint(n)}>
                <Text> </Text>
              </Box>
            ) : (
              <Text> </Text>
            )}
          </Box>
        )
      }

      const row = ({ node, depth, hidden }: { node: Node; depth: number; hidden: number }) => {
        const hasKids = (kids.get(node.id) ?? []).length > 0
        const ms = span(node)
        const right = node.hist
          ? node.ms !== undefined
            ? dur(ms)
            : '—'
          : isWaterfall
            ? `+${dur(node.start - t0)}  ${dur(ms)}`
            : dur(ms)
        const lead = depth * 2 + 2
        const name = node.kind === 'prompt' ? `Prompt ${promptNo.get(node.id)}` : node.name
        // The output's size beside the time; nothing until there is an output.
        const out = sizeOf(node, 'output') > 0 ? tokText(node, 'output') : ''
        const room = cols - lead - right.length - (out ? out.length + 2 : 0) - 7 // kind icon + status mark
        const arg = clip(node.arg, room - name.length - 1)
        return (
          <Box flexDirection="column">
            <Box key={`row:${node.id}`} flexDirection="column" hover={{ backgroundColor: 'subtle' }}>
              <Box>
                <Box width={lead} flexShrink={0}>
                  {hasKids ? (
                    <Button
                      key={`fold:${node.id}`}
                      plain
                      dimColor
                      onPress={() =>
                        void update($, folded, f =>
                          f.includes(node.id) ? f.filter(x => x !== node.id) : [...f, node.id],
                        )
                      }
                    >
                      {`${' '.repeat(depth * 2)}${fold.has(node.id) ? '▸' : '▾'} `}
                    </Button>
                  ) : (
                    <Text> </Text>
                  )}
                </Box>
                <Box flexGrow={1}>
                  <Button
                    key={`open:${node.id}`}
                    plain
                    onPress={() => void update($, selected, cur => (cur === node.id ? '' : node.id))}
                  >
                    <Text>{icon(node)} </Text>
                    <Text color={tint(node)}>{mark(node)} </Text>
                    <Text bold={node.id === pick || node.kind !== 'tool'}>{name}</Text>
                    {arg ? <Text dimColor> {arg}</Text> : null}
                    {hidden ? <Text dimColor> +{hidden}</Text> : null}
                  </Button>
                </Box>
                {node === slowest && rows.length > 3 ? <Text color="warning">slowest </Text> : null}
                {out ? <Text dimColor>{`${out}  `}</Text> : null}
                <Text dimColor>{right}</Text>
              </Box>
              {isWaterfall ? bar(node) : null}
            </Box>
            {node.id === pick ? details(node, t0, t1) : null}
          </Box>
        )
      }

      return (
        // The tree is one line per call; only the waterfall needs air for its bars.
        <Box flexDirection="column" gap={isWaterfall ? 1 : 0}>
          {top.hist ? (
            <Text dimColor>Earlier in this chat · only subagent durations were recorded</Text>
          ) : null}
          {isWaterfall && !top.hist ? (
            <Box marginLeft={gutter} width={barW} justifyContent="space-between">
              <Text dimColor>0</Text>
              <Text dimColor>{dur(Math.round(t1 / 2))}</Text>
              <Text dimColor>{dur(t1)}</Text>
            </Box>
          ) : null}
          {rows.map(row)}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        <Box justifyContent="space-between">
          <Box gap={1}>
            <Button
              key="view-tree"
              variant={isWaterfall ? 'secondary' : 'primary'}
              onPress={() => void update($, mode, () => 'tree')}
            >
              Tree
            </Button>
            <Button
              key="view-waterfall"
              variant={isWaterfall ? 'primary' : 'secondary'}
              onPress={() => void update($, mode, () => 'waterfall')}
            >
              Waterfall
            </Button>
          </Box>
          {foldable.length ? (
            <Button
              key="fold-all"
              plain
              dimColor
              onPress={() => void update($, folded, () => (isAllFolded ? [] : foldable))}
            >
              {isAllFolded ? 'unfold all' : 'fold all'}
            </Button>
          ) : null}
        </Box>
        <Box gap={2}>
          <Text dimColor>
            {prompts.length} {prompts.length === 1 ? 'prompt' : 'prompts'}
          </Text>
          {total.run ? <Text color="warning">● {total.run} running</Text> : null}
          <Text color="success">✓ {total.ok}</Text>
          {total.err ? <Text color="error">✗ {total.err} failed</Text> : null}
        </Box>

        {prompts.map((top, i) => (
          <Box flexDirection="column" gap={1}>
            {i > 0 ? <Text dimColor>{'─'.repeat(cols)}</Text> : null}
            {section(top)}
          </Box>
        ))}
      </Box>
    )
    } catch (err) {
      // Say what went wrong where the tree would be, instead of an empty pane.
      return (
        <Box flexDirection="column" gap={1}>
          <Text color="error" bold>
            The call tree could not be drawn
          </Text>
          <Text dimColor>{err instanceof Error ? err.message : String(err)}</Text>
        </Box>
      )
    }
  })
}
