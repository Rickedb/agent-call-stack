import { expect, test } from 'claude-code/testing'

import { settle } from './src/nodes'
import { modelOf, reportOf } from './src/stats'
import { touchOf } from './src/touch'
import { commonDir, touchedOf } from './src/touched'

const PANE = {
  plugin: 'ai-call-stack',
  component: 'Pane',
  requestId: 'ai-call-stack',
  props: {
    title: 'Call tree',
    isFocused: false,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

test('the waterfall lists a call and a press opens its details', async ($, on) => {
  // Nothing sits beneath the plugin: each hook here stands for the engine.
  on('command.register', () => ({ value: { command: 'call-tree' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('clock.every', () => ({ value: null }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('tool.call', () => ({ result: {}, text: 'file one\nfile two' }))
  const copied: string[] = []
  on('ui.copy', (_, e) => {
    copied.push(e.text)
    return { value: { ok: true } } as never
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'list the files', turnId: 't1' })
  await $.tool.call({ tool: 'Bash', command: 'ls' })

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })

    const prompt = await ui.find({ type: 'Text', text: /list the files/ })
    expect(prompt).toBeDefined()

    // The tool row is a Button keyed by the call's id; find it by its words.
    const row = await ui.find({ type: 'Button', text: /Bash/ })
    expect(row).toBeDefined()

    // The row shows the output's size: "file one\nfile two" is 17 characters, ~5 tokens.
    expect(await ui.find({ type: 'Text', text: /^ ~5 tok $/ })).toBeDefined()

    await ui.press({ key: row?.key ?? '' })

    expect(await ui.find({ type: 'Text', text: /file two/ })).toBeDefined()
    // The details show both sizes: "command: ls" is 11 characters, ~3 tokens.
    expect(await ui.find({ type: 'Text', text: /input ~3 tok · output ~5 tok/ })).toBeDefined()

    // The icon on the output's corner copies the whole output.
    await ui.press({ key: `copy:${row?.key?.replace('open:', '')}:output` })
    expect(copied.at(-1)).toBe('file one\nfile two')

    // The selection is the session's: close it so the next surface starts clean.
    await ui.press({ key: 'close' })
    expect(await ui.find({ type: 'Text', text: /file two/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('the same calls draw as a tree and as a waterfall', async ($, on) => {
  on('command.register', () => ({ value: { command: 'call-tree' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('clock.every', () => ({ value: null }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('tool.call', () => ({ result: {}, text: 'ok' }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'two calls', turnId: 't2' })
  await $.tool.call({ tool: 'Bash', command: 'ls' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  // A row's time is what the call took, never a start offset or a percent: in the waterfall and the tree.
  const times = async () => (await ui.findAll({ type: 'Text', text: /^ \d+ms $/ })).length
  expect(await times()).toBeGreaterThan(0)
  expect(await ui.find({ type: 'Text', text: /\+\d+ms|\d+%/ })).toBeUndefined()

  await ui.press({ key: 'view-tree' })
  expect(await times()).toBeGreaterThan(0)
  expect(await ui.find({ type: 'Text', text: /\+\d+ms|\d+%/ })).toBeUndefined()

  await ui.press({ key: 'view-waterfall' })
  expect(await ui.find({ type: 'Text', text: /\+\d+ms/ })).toBeUndefined()
  await ui.unmount()
})

test('two prompts draw one after the other, with no paging', async ($, on) => {
  on('command.register', () => ({ value: { command: 'call-tree' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('clock.every', () => ({ value: null }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('tool.call', () => ({ result: {}, text: 'ok' }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'first ask', turnId: 'p1' })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.turn.start({ text: 'second ask', turnId: 'p2' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await ui.find({ type: 'Text', text: /first ask/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /second ask/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'prev' })).toBeUndefined()

  // The newest prompt is on top.
  const opens = (await ui.findAll({ type: 'Button' })).map(b => b.key).filter(k => k?.startsWith('open:'))
  expect(opens).toEqual(['open:p2', 'open:p1'])

  // The first prompt folded when the second came: its call is hidden, and says so.
  expect(await ui.find({ type: 'Button', text: /Bash/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /\+1/ })).toBeDefined()

  // The person can open it again.
  await ui.press({ key: 'fold:p1' })
  expect(await ui.find({ type: 'Button', text: /Bash/ })).toBeDefined()
  await ui.unmount()
})

test('a long result is cut in the state and kept whole in a file', async ($, on) => {
  const written: Record<string, string> = {}
  on('command.register', () => ({ value: { command: 'call-tree' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('clock.every', () => ({ value: null }))
  on('env.get', () => ({ value: '/home/test' }))
  on('fs.write', (_, e) => {
    written[e.path] = e.text
    return { value: null }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('tool.call', () => ({ result: {}, text: 'x'.repeat(50000) }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'big', turnId: 'p3' })
  await $.tool.call({ tool: 'Bash', command: 'cat big' })

  const paths = Object.keys(written)
  expect(paths.length).toBe(1)
  expect(paths[0]).toMatch(/^\/home\/test\/\.claude\/ai-call-stack\/.*\.output\.txt$/)
  expect(written[paths[0] ?? '']?.length).toBe(50000)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const row = await ui.find({ type: 'Button', text: /Bash/ })
  await ui.press({ key: row?.key ?? '' })
  expect(await ui.find({ type: 'Text', text: /first 8,000 of 50,000 characters/ })).toBeDefined()
  // A copy icon on the corner of each text; the file path stays a text button.
  expect((await ui.findAll({ type: 'Button', text: /⧉/ })).length).toBe(2)
  expect(await ui.find({ type: 'Button', text: /Copy file path/ })).toBeDefined()
  await ui.unmount()
})

test('the chat before the mod loaded is read back from history', async ($, on) => {
  on('command.register', () => ({ value: { command: 'call-tree' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('clock.every', () => ({ value: null }))
  on('session.messages', () => ({
    value: [
      { role: 'user', text: 'what is here', toolUses: [] },
      {
        role: 'assistant',
        text: 'Two files.',
        toolUses: [
          { tool_use_id: 'u1', tool: 'Bash', input: { command: 'ls' }, text: 'a\nb' },
          { tool_use_id: 'u2', tool: 'Read', input: { file_path: '/x' }, text: 'nope', isError: true },
        ],
      },
      { role: 'user', text: '<system-reminder>noise</system-reminder>', toolUses: [] },
    ],
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /what is here/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /Bash/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /Read/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Earlier in this chat/ })).toBeDefined()
  // The reminder alone is no prompt.
  expect((await ui.findAll({ type: 'Text', text: /noise/ })).length).toBe(0)
  await ui.unmount()
})

test('a live prompt folds the history before it, and sits above it', async ($, on) => {
  on('command.register', () => ({ value: { command: 'call-tree' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('clock.every', () => ({ value: null }))
  on('session.messages', () => ({
    value: [
      { role: 'user', text: 'what is here', toolUses: [] },
      {
        role: 'assistant',
        text: 'Two files.',
        toolUses: [{ tool_use_id: 'u1', tool: 'Bash', input: { command: 'ls' }, text: 'a\nb' }],
      },
    ],
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui0 = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // Alone, the history's one prompt is the latest, so it is open.
  expect(await ui0.find({ type: 'Button', text: /Bash/ })).toBeDefined()
  await ui0.unmount()

  await $.turn.start({ text: 'now this', turnId: 'live1' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Button', text: /Bash/ })).toBeUndefined()
  const opens = (await ui.findAll({ type: 'Button' })).map(b => b.key).filter(k => k?.startsWith('open:'))
  expect(opens[0]).toBe('open:live1')
  expect(opens.length).toBe(2)
  await ui.unmount()
})

// Rows set in the state with fixed times, so that what is drawn does not depend on the clock:
// a prompt; a call before it; a subagent whose three calls are two overlapping, then one alone.
const injected = (): Record<string, [string, unknown]> => {
  const row = (id: string, parent: string | undefined, kind: string, name: string, start: number, end: number) => ({
    id, ...(parent ? { parent } : {}), kind, name, arg: '', status: 'ok', start, end,
  })
  return {
    filled: ['filled-1', true],
    root: ['root-1', 'p1'],
    mode: ['mode-2', 'tree'],
    isClosed: ['isClosed-1', false],
    selected: ['selected-1', ''],
    folded: ['folded-1', []],
    shown: ['shown-1', []],
    shut: ['shut-1', []],
    nodes: [
      'nodes-5',
      [
        row('p1', undefined, 'prompt', 'Prompt', 1000, 3000),
        row('before', 'p1', 'tool', 'Before', 1050, 1090),
        row('a:ag', 'p1', 'agent', 'Explore', 1100, 2900),
        row('g1', 'a:ag', 'tool', 'Grep', 1200, 1800),
        row('g2', 'a:ag', 'tool', 'Read', 1300, 1900),
        row('g3', 'a:ag', 'tool', 'Bash', 2000, 2500),
      ],
    ],
  }
}

test('the nesting is clear in the tree, and nothing is marked as parallel', async ($, on) => {
  const held = injected()
  on('state.get', (_, e) => {
    const one = held[String(e.key)]
    return one ? { value: { value: { shape: one[0], value: one[1] }, version: 1 } } : { value: null }
  })

  for (const mode of ['tree', 'waterfall'] as const) {
    held.mode = ['mode-2', mode]
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

    // Overlapping calls (Grep and Read) say nothing of it: timing alone cannot tell parallel from coincidence.
    expect((await ui.findAll({ type: 'Text', text: /∥|╞|╘|║/ })).length).toBe(0)
    // Every branch has the plain connector; the last of its level an elbow.
    expect((await ui.findAll({ type: 'Text', text: /^├─$/ })).length).toBe(3) // Before, Grep, Read
    expect((await ui.findAll({ type: 'Text', text: /^└─$/ })).length).toBe(2) // Explore, Bash

    // One line a call, in the waterfall too: the bar is on the row, not under it, so
    // the tree's guide lines are not broken, and nothing is drawn that can wrap.
    for (const id of ['before', 'a:ag', 'g1', 'g2', 'g3']) {
      const rowBox = await ui.find({ type: 'Box', key: `row:${id}` })
      expect(rowBox?.children?.length).toBe(1)
    }

    await ui.unmount()
  }
})

test('a narrow pane keeps the bar, and gives up the slowest label', async ($, on) => {
  const held = injected()
  held.mode = ['mode-2', 'waterfall']
  on('state.get', (_, e) => {
    const one = held[String(e.key)]
    return one ? { value: { value: { shape: one[0], value: one[1] }, version: 1 } } : { value: null }
  })

  for (const [cols, barW, isWide] of [[80, 20, true], [48, 12, false], [30, 8, false]] as const) {
    const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: cols }, surface: 'desktop' })
    // The bar column is there at every width, scaled to it: a quarter, at least 8 cells.
    const tracks = (await ui.findAll({ type: 'Box' })).filter(
      b => b.props?.backgroundColor === 'subtle' && b.props?.width === barW,
    )
    expect(tracks.length).toBe(6) // one per row: the prompt, the agent and its calls
    // A wide pane also says which call was slowest; the time is the call's own at every width.
    expect((await ui.findAll({ type: 'Text', text: /\+\d+ms/ })).length).toBe(0)
    expect((await ui.findAll({ type: 'Text', text: /slowest/ })).length > 0).toBe(isWide)
    // Always one line a call.
    expect((await ui.find({ type: 'Box', key: 'row:g1' }))?.children?.length).toBe(1)
    await ui.unmount()
  }
})

test('a closed pane leaves a button to open it again', async ($, on) => {
  let opened = 0
  on('ui.open', () => {
    opened += 1
    return { value: { isPlaced: true } }
  })
  // What the close hook left behind: the pane is closed.
  const held: Record<string, [string, unknown]> = {
    isClosed: ['isClosed-1', true],
    nodes: ['nodes-5', []],
    filled: ['filled-1', true],
  }
  on('state.get', (_, e) => {
    const one = held[String(e.key)]
    return one
      ? { value: { value: { shape: one[0], value: one[1] }, version: 1 } }
      : { value: null }
  })

  const band = {
    plugin: 'ai-call-stack',
    component: 'AbovePrompt',
    requestId: 'band',
    props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 4, scroll: { offset: 0, bodyRows: 4 }, view: {} },
  } as const

  const ui = await $.ui.mount({ ...band, surface: 'desktop' } as never)
  expect(await ui.find({ type: 'Button', key: 'open-call-tree' })).toBeDefined()
  expect(opened).toBe(0)
  await ui.unmount()
})

test('an empty session says so', async ($, on) => {
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect((await ui.find({ type: 'Text' }))?.text).toBe('No calls yet')
  await ui.unmount()
})

test('a finished prompt ends with its summary, a running one has none', async ($, on) => {
  const held = injected()
  const nodes = (held.nodes as [string, any[]])[1]
  // Sizes in characters: a read of 4000 characters is about a thousand tokens.
  Object.assign(nodes.find(n => n.id === 'g1'), { input: 'x'.repeat(40), inputLen: 40, outputLen: 4000 })
  Object.assign(nodes.find(n => n.id === 'g3'), { status: 'err' })
  on('state.get', (_, e) => {
    const one = held[String(e.key)]
    return one ? { value: { value: { shape: one[0], value: one[1] }, version: 1 } } : { value: null }
  })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Summary/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /4 tool calls · 1 failed/ })).toBeDefined()
  // The calls by tool (the subagent is counted apart): Before, Grep, Read and Bash once each.
  for (const name of ['Before', 'Grep', 'Read', 'Bash']) {
    expect(await ui.find({ type: 'Text', text: new RegExp(`^${name}\\s+1 `) })).toBeDefined()
  }
  expect(await ui.find({ type: 'Text', text: /Heaviest\s+Grep\s+~1\.0k tok/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /in ~10 tok · out ~1\.0k tok · total ~1\.0k tok \(estimated\)/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /1 subagent · longest Explore 1\.8s/ })).toBeDefined()
  await ui.unmount()

  // While the prompt runs there is none.
  Object.assign(nodes.find(n => n.id === 'p1'), { status: 'run', end: undefined })
  const ui2 = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui2.find({ type: 'Text', text: /Summary/ })).toBeUndefined()
  await ui2.unmount()
})

test('the summary counts calls by tool, tokens, time in calls, and skips history', () => {
  const n = (id: string, kind: 'tool' | 'agent', name: string, start: number, end: number, over = {}) =>
    ({ id, parent: 'p', kind, name, arg: '', status: 'ok' as const, start, end, ...over })
  const top = { id: 'p', kind: 'prompt' as const, name: 'Prompt', arg: '', status: 'ok' as const, start: 0, end: 10_000, inputLen: 40, outputLen: 80 }
  const below = [
    n('a', 'tool', 'Read', 0, 1000, { inputLen: 20, outputLen: 400 }),
    n('b', 'tool', 'Read', 500, 3000, { inputLen: 20, outputLen: 1200 }),
    n('c', 'tool', 'Bash', 5000, 6000, { status: 'err' as const }),
    n('d', 'agent', 'Explore', 6000, 9000),
  ]
  const r = reportOf(top, below, 20_000)!
  expect(r.calls).toBe(3)
  expect(r.failed).toBe(1)
  expect(r.kinds.map(k => [k.name, k.count])).toEqual([['Read', 2], ['Bash', 1]])
  expect(r.avg).toBe((1000 + 2500 + 1000) / 3)
  expect(r.slowest?.id).toBe('b')
  expect(r.heaviest?.id).toBe('b')
  expect(r.input).toBe(10 + 5 + 5)
  expect(r.output).toBe(20 + 100 + 300)
  // 0-3000 (the two reads overlap), 5000-6000, and the subagent's 6000-9000.
  expect(r.busy).toBe(3000 + 1000 + 3000)
  expect(r.agents.count).toBe(1)
  expect(reportOf({ ...top, status: 'run' as const }, below, 20_000)).toBeUndefined()
  expect(reportOf({ ...top, hist: true as const }, below, 20_000)).toBeUndefined()
  expect(reportOf(top, [], 20_000)).toBeUndefined()
})

test('a prompt and its subagent show the model they ran on', async ($, on) => {
  on('command.register', () => ({ value: { command: 'call-tree' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('clock.every', () => ({ value: null }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null } as never
  })
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5-20260101', agentId: 'ag1' }))
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  on('turn.complete', (_, e) => ({ text: e.answer ?? '', usage: { model: 'claude-opus-5-5' } as never }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'ask', turnId: 'tm' })
  // The step names the model while the prompt still runs.
  const stream = $.turn.step({ turnId: 'tm', index: 0, model: 'claude-opus-5-5' } as never)
  for await (const _ of stream) void _
  let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^ opus-5-5$/ })).toBeDefined()
  await ui.unmount()

  await $.agent.spawn({ prompt: 'look', description: 'look around', subagentType: 'Explore' } as never)
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  const usage = { model: 'claude-opus-5-5', input_tokens: 800, output_tokens: 520, cache_read_input_tokens: 4000, cache_creation_input_tokens: 0 }
  await $.turn.complete({ turnId: 'tm', reason: 'answer', answer: 'done', usage } as never)

  ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // The date a model id carries is dropped.
  expect(await ui.find({ type: 'Text', text: /^ haiku-5-5$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ opus-5-5$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Models\s+opus-5-5 \(prompt\) · haiku-5-5 \(1 subagent\)/ })).toBeDefined()
  // What the API reported replaces the estimate in the summary; the estimate stays for the calls' text.
  expect(await ui.find({ type: 'Text', text: /Tokens\s+in 4\.8k tok · out 520 tok · total 5\.3k tok \(reported\)/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Cache\s+83% of input from cache · 4\.0k tok read · 0 tok written/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Call text\s+in ~\d+ tok · out ~\d+ tok \(estimated/ })).toBeDefined()
  // The prompt's details give its own reported usage.
  await ui.press({ key: 'open:tm' })
  expect(await ui.find({ type: 'Text', text: /reported in 4\.8k tok \(4\.0k tok cached\) · out 520 tok · subagents not included/ })).toBeDefined()
  await ui.unmount()
})

test('a tool call is called by the model of the loop it ran in', () => {
  const row = (id: string, parent: string | undefined, kind: 'prompt' | 'agent' | 'tool', model?: string) =>
    ({ id, parent, kind, name: id, arg: '', status: 'ok' as const, start: 0, end: 1, ...(model ? { model } : {}) })
  const list = [row('p', undefined, 'prompt', 'claude-opus-5-5'), row('a', 'p', 'agent', 'claude-haiku-5-5'), row('t1', 'a', 'tool'), row('t2', 'p', 'tool')]
  expect(modelOf(list, list[2]!)).toBe('claude-haiku-5-5')
  expect(modelOf(list, list[3]!)).toBe('claude-opus-5-5')
  expect(modelOf(list, list[1]!)).toBe('claude-haiku-5-5')
  expect(modelOf([row('x', undefined, 'tool')], row('x', undefined, 'tool'))).toBeUndefined()
})

test('the summary copies as markdown', async ($, on) => {
  const held = injected()
  const nodes = (held.nodes as [string, any[]])[1]
  Object.assign(nodes.find(n => n.id === 'g1'), { name: 'Bash', arg: 'echo a | b `x`', outputLen: 4000 })
  Object.assign(nodes.find(n => n.id === 'g3'), { status: 'err' })
  on('state.get', (_, e) => {
    const one = held[String(e.key)]
    return one ? { value: { value: { shape: one[0], value: one[1] }, version: 1 } } : { value: null }
  })
  const copied: string[] = []
  on('ui.copy', (_, e) => {
    copied.push(e.text)
    return { value: { ok: true } } as never
  })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'copy-summary:p1' })
  expect(copied.length).toBe(1)
  const md = copied[0] ?? ''
  expect(md).toMatch(/^## Prompt 1 summary\n/)
  expect(md).toMatch(/- \*\*Tool calls:\*\* 4 \(1 failed\) · took 2\.0s/)
  expect(md).toMatch(/- \*\*Subagents:\*\* 1 · longest Explore 1\.8s/)
  // The table has a row a tool, and nothing in a name or argument breaks it.
  expect(md).toMatch(/\| Tool \| Calls \| Avg \| Total \| Tokens \(est\.\) \|\n\| --- \| ---: \| ---: \| ---: \| ---: \|\n/)
  expect(md).toMatch(/\| Bash \(1 failed\) \| 2 \|/)
  expect(md).toMatch(/\*\*Heaviest call:\*\* Bash `echo a \| b 'x'` ~1\.0k tok/)
  await ui.unmount()
})

test('the waterfall marks only a failure; the tree marks every status', async ($, on) => {
  const held = injected()
  const nodes = (held.nodes as [string, any[]])[1]
  Object.assign(nodes.find(n => n.id === 'g3'), { status: 'err' })
  Object.assign(nodes.find(n => n.id === 'g2'), { status: 'run', end: undefined })
  on('state.get', (_, e) => {
    const one = held[String(e.key)]
    return one ? { value: { value: { shape: one[0], value: one[1] }, version: 1 } } : { value: null }
  })

  // The bar's color says done and running; only the failure has a glyph, after its name.
  held.mode = ['mode-2', 'waterfall']
  let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.findAll({ type: 'Text', text: /^[✓●] $/ })).length).toBe(0)
  expect((await ui.findAll({ type: 'Text', text: /^ ✗$/ })).length).toBe(1)
  await ui.unmount()

  held.mode = ['mode-2', 'tree']
  ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.findAll({ type: 'Text', text: /^✓ $/ })).length).toBe(4)
  expect((await ui.findAll({ type: 'Text', text: /^● $/ })).length).toBe(1)
  expect((await ui.findAll({ type: 'Text', text: /^✗ $/ })).length).toBe(1)
  await ui.unmount()
})

test('the summary collapses to its header, and opens again', async ($, on) => {
  on('command.register', () => ({ value: { command: 'call-tree' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('clock.every', () => ({ value: null }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  on('turn.complete', (_, e) => ({ text: e.answer ?? '' }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'ask', turnId: 'tc' })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.turn.complete({ turnId: 'tc', reason: 'answer', answer: 'done' } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const body = () => ui.find({ type: 'Text', text: /^Tokens/ })
  expect(await body()).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /▾ Summary/ })).toBeDefined()

  await ui.press({ key: 'shut:tc' })
  expect(await body()).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /▸ Summary/ })).toBeDefined()
  // The header keeps the copy button, so a collapsed summary can still be copied.
  expect(await ui.find({ type: 'Button', text: /^Copy$/ })).toBeDefined()

  await ui.press({ key: 'shut:tc' })
  expect(await body()).toBeDefined()
  await ui.unmount()
})

const quiet = (on: (...a: any[]) => unknown) => {
  on('command.register', () => ({ value: { command: 'call-tree' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('clock.every', () => ({ value: null }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('turn.start', (_: unknown, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', (_: unknown, e: any) => ({ text: e.answer ?? '' }))
  // The classic hooks the engine raises beneath the mod.
  for (const name of ['classic.StopFailure', 'classic.PostCompact', 'classic.PostToolUse', 'classic.PostToolUseFailure', 'classic.PermissionDenied', 'classic.Stop', 'classic.SubagentStop']) {
    on(name, () => ({}))
  }
}

test('a prompt that did not end in an answer says why, and the summary lists every error', async ($, on) => {
  quiet(on)
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'max_tokens', usage: null } as never
  })
  on('tool.call', () => ({ isError: true, result: 'x', text: 'npm ERR! missing script: build\nmore' }) as never)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'build it', turnId: 'er' })
  // The model's reply was cut off.
  for await (const _ of $.turn.step({ turnId: 'er', index: 0, model: 'claude-opus-5-5' } as never)) void _
  await $.tool.call({ tool: 'Bash', command: 'npm run build' })
  // The API said no, and the turn ended.
  await $.classic.StopFailure({ error: 'rate_limit', error_details: 'try again later' } as never)
  await $.turn.complete({ turnId: 'er', reason: 'error', answer: '' } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // The prompt carries why, as a tag after its name.
  expect(await ui.find({ type: 'Text', text: /^ rate limited: try again later$/ })).toBeDefined()
  // The cut-off reply is a row of its own, a failed one.
  expect(await ui.find({ type: 'Button', text: /Error.*the reply hit the output limit/ })).toBeDefined()
  // The summary lists each: the call with the first line of its error, and the prompt with its reason.
  expect(await ui.find({ type: 'Text', text: /Error\s+Bash npm run build — npm ERR! missing script: build/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Error\s+the prompt — rate limited: try again later/ })).toBeDefined()
  await ui.press({ key: 'open:er' })
  expect(await ui.find({ type: 'Text', text: /why: rate limited: try again later/ })).toBeDefined()
  await ui.unmount()
})

test('an interrupted prompt and a refused one say so', async ($, on) => {
  quiet(on)
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'first', turnId: 'i1' })
  await $.turn.complete({ turnId: 'i1', reason: 'aborted', isAborted: true, answer: '' } as never)
  await $.turn.start({ text: 'second', turnId: 'i2' })
  await $.turn.complete({
    turnId: 'i2',
    reason: 'refusal',
    answer: '',
    refusal: { category: 'cyber', explanation: 'not something I can help with' },
  } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^ interrupted$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ refused \(cyber\): not something/ })).toBeDefined()
  await ui.unmount()
})

test('a compaction is a row under the prompt, with what it kept and the summary it left', async ($, on) => {
  quiet(on)
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  on('session.compact', () => ({
    messages: [{ role: 'user', text: 'summary', toolUses: [] }],
    tokensBefore: 180_000,
    tokensAfter: 12_000,
    usage: { input_tokens: 90_000, output_tokens: 3_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'long work', turnId: 'cp' })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  const msg = (text: string) => ({ role: 'user', text, toolUses: [] }) as never
  await $.session.compact({ trigger: 'auto', instructions: 'keep the plan', messages: [msg('a'), msg('b'), msg('c')] } as never)
  await $.classic.PostCompact({ trigger: 'auto', compact_summary: 'The user asked for long work.' } as never)
  await $.turn.complete({ turnId: 'cp', reason: 'answer', answer: 'done' } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Button', text: /Compact.*auto · 180k → 12k tok/ })).toBeDefined()
  // The summary adds it up.
  expect(await ui.find({ type: 'Text', text: /Compacts\s+1 \(1 auto\) · 180k → 12k tok · 168k tok saved/ })).toBeDefined()
  // It is no tool call.
  expect(await ui.find({ type: 'Text', text: /1 tool calls/ })).toBeDefined()

  const row = await ui.find({ type: 'Button', text: /Compact/ })
  await ui.press({ key: row?.key ?? '' })
  expect(await ui.find({ type: 'Text', text: /auto · 180k → 12k tok \(−93%\) · 3 → 1 messages · summarizer in 90k tok · out 3\.0k tok \(reported\)/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^INSTRUCTIONS/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /keep the plan/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^SUMMARY/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /The user asked for long work\./ })).toBeDefined()
  await ui.unmount()
})

test('a precomputed compaction is not a row', async ($, on) => {
  quiet(on)
  on('session.compact', () => ({ messages: [{ role: 'user', text: 'a', toolUses: [] }], tokensBefore: 10, tokensAfter: 5 }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'ask', turnId: 'pc' })
  await $.session.compact({ trigger: 'precompute', messages: [{ role: 'user', text: 'a', toolUses: [] }] } as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Button', text: /Compact/ })).toBeUndefined()
  await ui.unmount()
})

test('a call the engine asks about, with nobody to answer, is not allowed', async ($, on) => {
  quiet(on)
  on('tool.check', () => ({ decision: 'ask', reason: 'Bash needs approval', rule: 'Bash(npm:*)' }))
  on('tool.call', () => ({ result: {}, text: 'ok' }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'ask', turnId: 'pm' })
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await $.turn.complete({ turnId: 'pm', reason: 'answer', answer: 'done' } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^ not allowed$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Approvals\s+0 allowed · 1 asked you · 1 not allowed/ })).toBeDefined()
  const row = await ui.find({ type: 'Button', text: /Bash/ })
  await ui.press({ key: row?.key ?? '' })
  expect(await ui.find({ type: 'Text', text: /permission asked you, not allowed · rule Bash\(npm:\*\) · Bash needs approval/ })).toBeDefined()
  await ui.unmount()
})

test('an allowed ask is drawn from when the tool ran, and says how long it waited', () => {
  const was = { id: 't', kind: 'tool' as const, name: 'Bash', arg: '', status: 'run' as const, start: 1000, perm: { decision: 'ask' as const, ran: 150 } }
  // Asked at 1000, answered, the tool ran 150ms and ended at 6150: it waited 5s.
  expect(settle(was, false, 6150)).toEqual({ start: 6000, perm: { decision: 'ask', ran: 150, waited: 5000 } })
  // A run longer than the whole call (clocks differ) never moves the start back.
  expect(settle(was, false, 1100)).toEqual({ start: 1000, perm: { decision: 'ask', ran: 150, waited: 0 } })
  // An ask that failed without the tool running was not allowed.
  expect(settle({ ...was, perm: { decision: 'ask' as const } }, true, 2000)).toEqual({ perm: { decision: 'ask', refused: true } })
  // A call that was not asked is left as it is.
  expect(settle({ ...was, perm: { decision: 'allow' as const } }, false, 2000)).toEqual({})
  expect(settle(undefined, false, 2000)).toEqual({})
})

test('a call the engine denies is tagged denied', async ($, on) => {
  quiet(on)
  on('tool.check', () => ({ decision: 'deny', reason: 'no pushing', rule: 'Bash(git push:*)' }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'push', turnId: 'pd' })
  await $.tool.call({ tool: 'Bash', command: 'git push' })
  await $.turn.complete({ turnId: 'pd', reason: 'answer', answer: 'done' } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^ denied$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Error\s+Bash git push — / })).toBeDefined()
  await ui.unmount()
})

test('the summary lists errors, compactions and approvals from the rows', () => {
  const top = { id: 'p', kind: 'prompt' as const, name: 'Prompt', arg: '', status: 'err' as const, start: 0, end: 10_000, why: 'interrupted' }
  const row = (id: string, kind: 'tool' | 'event', name: string, over = {}) =>
    ({ id, parent: 'p', kind, name, arg: '', status: 'ok' as const, start: 100, end: 200, ...over })
  const below = [
    row('a', 'tool', 'Bash', { perm: { decision: 'allow' } }),
    row('b', 'tool', 'Bash', { perm: { decision: 'ask', waited: 4000 } }),
    row('c', 'tool', 'Edit', { status: 'err', output: 'no such file\nat line 3', perm: { decision: 'ask', refused: true } }),
    row('d', 'tool', 'Bash', { status: 'err', perm: { decision: 'deny', rule: 'Bash(rm:*)', reason: 'nope' } }),
    row('e', 'event', 'Compact', { compact: { trigger: 'manual', before: 100_000, after: 20_000 }, start: 500, end: 2500 }),
    row('f', 'event', 'Compact', { compact: { trigger: 'auto', before: 90_000, after: 30_000 }, start: 3000, end: 3500 }),
    row('g', 'event', 'Compact', { compact: { trigger: 'auto', skipped: 'a hook said no' } }),
  ]
  const r = reportOf(top, below, 20_000)!
  // Events are no tool calls.
  expect(r.calls).toBe(4)
  expect(r.errors.map(f => [f.node.id, f.why])).toEqual([
    ['p', 'interrupted'],
    ['c', 'not allowed'],
    ['d', 'denied by Bash(rm:*): nope'],
  ])
  expect(r.perms).toEqual({ allowed: 1, asked: 2, denied: 2, waited: 4000 })
  expect(r.compacts).toMatchObject({ count: 2, manual: 1, auto: 1, saved: 140_000, before: 100_000, after: 30_000, ms: 2500 })
  // A prompt that only failed still has a summary.
  expect(reportOf(top, [], 20_000)?.errors).toHaveLength(1)
  expect(reportOf({ ...top, why: undefined, status: 'ok' as const }, [], 20_000)).toBeUndefined()
})

test('a prompt and a subagent say where their transcript is kept, and it copies', async ($, on) => {
  quiet(on)
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'ag1' }))
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  const copied: string[] = []
  on('ui.copy', (_, e) => {
    copied.push(e.text)
    return { value: { ok: true } } as never
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'ask', turnId: 'tp' })
  await $.agent.spawn({ prompt: 'look', description: 'look around', subagentType: 'Explore' } as never)
  await $.classic.SubagentStop({ agent_id: 'ag1', agent_type: 'Explore', agent_transcript_path: '/t/agent-ag1.jsonl' } as never)
  await $.classic.Stop({ transcript_path: '/t/session.jsonl' } as never)
  await $.turn.complete({ turnId: 'tp', reason: 'answer', answer: 'done' } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'open:tp' })
  expect(await ui.find({ type: 'Text', text: /transcript \/t\/session\.jsonl/ })).toBeDefined()
  await ui.press({ key: 'copy-transcript:tp' })
  expect(copied.at(-1)).toBe('/t/session.jsonl')
  await ui.press({ key: 'close' })

  await ui.press({ key: 'open:a:ag1' })
  expect(await ui.find({ type: 'Text', text: /transcript \/t\/agent-ag1\.jsonl/ })).toBeDefined()
  await ui.unmount()
})

test('what a call touched is read from its arguments, whatever the tool is called', () => {
  // Claude Code's tools.
  expect(touchOf('Read', { file_path: '/p/a.ts' })).toEqual({ op: 'read', paths: ['/p/a.ts'] })
  expect(touchOf('Edit', { file_path: '/p/a.ts', old_string: 'x', new_string: 'y' })).toEqual({ op: 'edit', paths: ['/p/a.ts'] })
  expect(touchOf('Write', { file_path: '/p/new.ts', content: 'x' })?.op).toBe('write')
  expect(touchOf('NotebookEdit', { notebook_path: '/p/n.ipynb' })?.op).toBe('edit')
  expect(touchOf('Bash', { command: 'npm test' })).toEqual({ op: 'run', paths: [], what: 'npm test' })
  expect(touchOf('Grep', { pattern: 'login', path: '/p/src' })).toEqual({ op: 'search', paths: ['/p/src'], what: 'login' })
  expect(touchOf('Glob', { pattern: '**/*.ts' })).toEqual({ op: 'search', paths: [], what: '**/*.ts' })
  expect(touchOf('WebFetch', { url: 'https://x.dev/a', prompt: 'summarize' })).toEqual({ op: 'web', paths: [], what: 'https://x.dev/a' })
  expect(touchOf('WebSearch', { query: 'tsc noEmit' })?.op).toBe('web')
  // Copilot's, which name and shape them differently.
  expect(touchOf('read_file', { filePath: '/p/a.ts', startLine: 1 })).toEqual({ op: 'read', paths: ['/p/a.ts'] })
  expect(touchOf('replace_string_in_file', { filePath: '/p/a.ts' })?.op).toBe('edit')
  expect(touchOf('create_file', { filePath: '/p/b.ts' })?.op).toBe('write')
  expect(touchOf('run_in_terminal', { command: 'ls', explanation: 'x' })?.op).toBe('run')
  expect(touchOf('semantic_search', { query: 'where is login' })).toEqual({ op: 'search', paths: [], what: 'where is login' })
  expect(touchOf('list_dir', { path: '/p' })).toEqual({ op: 'search', paths: ['/p'], what: '' })
  expect(touchOf('fetch_webpage', { urls: ['https://a.dev', 'https://b.dev'], query: 'q' })?.op).toBe('web')
  // Files nested in a list, and a file:// address.
  expect(
    touchOf('multi_replace_string_in_file', { replacements: [{ filePath: '/p/a.ts', oldString: 'x' }, { filePath: '/p/b.ts' }, { filePath: '/p/a.ts' }] })?.paths,
  ).toEqual(['/p/a.ts', '/p/b.ts'])
  expect(touchOf('get_errors', { filePaths: ['file:///p/a.ts'] })).toEqual({ op: 'other', paths: ['/p/a.ts'] })
  // Nothing touched: no files, no command.
  expect(touchOf('TodoWrite', { todos: [{ content: 'x' }] })).toBeUndefined()
  expect(touchOf('Read', { file_path: 'a\nb' })).toBeUndefined()
})

test('the files, commands and lookups of a prompt, with re-reads, retries, time and waits', () => {
  const top = { id: 'p', kind: 'prompt' as const, name: 'Prompt', arg: '', status: 'ok' as const, start: 0, end: 20_000 }
  const call = (id: string, name: string, start: number, end: number, touch: any, over: object = {}) =>
    ({ id, parent: 'p', kind: 'tool' as const, name, arg: '', status: 'ok' as const, start, end, inputLen: 40, outputLen: 400, touch, ...over })
  const read = (path: string) => ({ op: 'read', paths: [path] })
  const below = [
    call('1', 'Read', 0, 1000, read('/p/src/a.ts')),
    call('2', 'Read', 1500, 2000, read('/p/src/a.ts')),
    call('3', 'Edit', 2500, 3000, { op: 'edit', paths: ['/p/src/a.ts'] }, { status: 'err' as const }),
    call('4', 'Edit', 3500, 4500, { op: 'edit', paths: ['/p/src/a.ts'] }),
    call('5', 'Read', 5000, 5500, read('/p/src/a.ts')),
    call('6', 'Read', 6000, 6500, read('/p/lib/b.ts')),
    call('7', 'Bash', 7000, 9000, { op: 'run', paths: [], what: 'npm test' }, { perm: { decision: 'ask', waited: 1500 } }),
    call('8', 'Bash', 10_000, 11_000, { op: 'run', paths: [], what: 'npm  test' }, { status: 'err' as const }),
    call('9', 'Grep', 12_000, 12_500, { op: 'search', paths: ['/p'], what: 'login' }),
    call('x', 'TodoWrite', 13_000, 13_100, undefined),
  ]
  const t = touchedOf(top, below, 30_000)
  // The changed file first, then the other.
  expect(t.files.map(f => f.path)).toEqual(['/p/src/a.ts', '/p/lib/b.ts'])
  const a = t.files[0]!
  expect([a.reads, a.edits, a.writes, a.calls.length, a.failed]).toEqual([3, 2, 0, 5, 1])
  // The second read repeats the first (nothing written between); the one after the edits does not.
  expect(a.rereads).toBe(1)
  // The second edit came right after a failed one.
  expect(a.retries).toBe(1)
  expect(a.ms).toBe(1000 + 500 + 500 + 1000 + 500)
  expect([t.edited, t.readOnly]).toEqual([1, 1])
  // Whitespace does not tell two commands apart.
  expect(t.commands.map(g => [g.what, g.calls.length, g.failed, g.ms])).toEqual([['npm test', 2, 1, 3000]])
  expect(t.lookups.map(g => [g.kind, g.what])).toEqual([['search', 'login']])
  expect(t.waited).toBe(1500)
  expect(t.wall).toBe(20_000)
  // A call that touched nothing is not here.
  expect(t.files.flatMap(f => f.calls).some(n => n.id === 'x')).toBe(false)
  expect(commonDir(['/p/src/a.ts', '/p/lib/b.ts'])).toBe('/p')
  expect(commonDir(['/p/src/a.ts'])).toBe('/p/src')
  expect(commonDir([])).toBe('')
})

test('the Touched view lists files, commands and lookups, and a call opens its details', async ($, on) => {
  quiet(on)
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'fix login', turnId: 'tv' })
  await $.tool.call({ tool: 'Read', file_path: '/p/src/login.ts' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/p/src/login.ts', old_string: 'a', new_string: 'b' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/p/src/util.ts' } as never)
  await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
  await $.tool.call({ tool: 'Grep', pattern: 'login', path: '/p' } as never)
  await $.turn.complete({ turnId: 'tv', reason: 'answer', answer: 'done' } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'view-files' })
  expect(await ui.find({ type: 'Text', text: /2 files \(1 changed, 1 read only\) · 1 command · 1 lookup/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /calls ran .* of .* · model and other time/ })).toBeDefined()
  // Paths are shown under the directory they share.
  expect(await ui.find({ type: 'Text', text: /^FILES · under …\/p\/src/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^login\.ts$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^R1 E1$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^util\.ts$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^COMMANDS/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^npm test$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^LOOKUPS/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Grep login$/ })).toBeDefined()

  // The calls that touched login.ts are buttons: Read, then Edit.
  const calls = (await ui.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('pick:'))
  expect(calls.length).toBeGreaterThanOrEqual(5)
  const edit = await ui.find({ type: 'Button', text: /^Edit \d+ms$/ })
  await ui.press({ key: edit?.key ?? '' })
  expect(await ui.find({ type: 'Text', text: /file_path: \/p\/src\/login\.ts/ })).toBeDefined()
  await ui.press({ key: 'close' })

  // The other views are one press away.
  await ui.press({ key: 'view-tree' })
  expect(await ui.find({ type: 'Button', text: /Edit/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^FILES/ })).toBeUndefined()
  await ui.unmount()
})
