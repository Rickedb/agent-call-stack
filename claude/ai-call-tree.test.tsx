import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'ai-call-tree',
  component: 'Pane',
  requestId: 'ai-call-tree',
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
    expect(await ui.find({ type: 'Text', text: /^~5 tok/ })).toBeDefined()

    await ui.press({ key: row?.key ?? '' })

    expect(await ui.find({ type: 'Text', text: /file two/ })).toBeDefined()
    // The details show both sizes: "command: ls" is 11 characters, ~3 tokens.
    expect(await ui.find({ type: 'Text', text: /input ~3 tok · output ~5 tok/ })).toBeDefined()

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

  // The waterfall is the default: each row shows where it starts.
  expect(await ui.find({ type: 'Text', text: /^\+\d+ms/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\d+%/ })).toBeUndefined()

  // The tree is compact: a duration per call, no start offset, no percent.
  await ui.press({ key: 'view-tree' })
  expect(await ui.find({ type: 'Text', text: /^\+\d+ms/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /\d+%/ })).toBeUndefined()

  await ui.press({ key: 'view-waterfall' })
  expect(await ui.find({ type: 'Text', text: /^\+\d+ms/ })).toBeDefined()
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
  expect(paths[0]).toMatch(/^\/home\/test\/\.claude\/ai-call-tree\/.*\.output\.txt$/)
  expect(written[paths[0] ?? '']?.length).toBe(50000)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const row = await ui.find({ type: 'Button', text: /Bash/ })
  await ui.press({ key: row?.key ?? '' })
  expect(await ui.find({ type: 'Text', text: /first 8,000 of 50,000 characters/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /Copy all/ })).toBeDefined()
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

test('calls at the same time, and the nesting, are clear in the tree', async ($, on) => {
  const held = injected()
  on('state.get', (_, e) => {
    const one = held[String(e.key)]
    return one ? { value: { value: { shape: one[0], value: one[1] }, version: 1 } } : { value: null }
  })

  for (const mode of ['tree', 'waterfall'] as const) {
    held.mode = ['mode-2', mode]
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

    // Grep and Read overlap: each says so; Bash ran after them and does not.
    expect((await ui.findAll({ type: 'Text', text: /∥ ×2/ })).length).toBe(2)
    // They are drawn with the double connector, the others with the plain one.
    expect((await ui.findAll({ type: 'Text', text: /^╞═$/ })).length).toBe(2)
    expect((await ui.findAll({ type: 'Text', text: /^├─$/ })).length).toBe(1) // Before
    expect((await ui.findAll({ type: 'Text', text: /^└─$/ })).length).toBe(2) // Explore, Bash

    // One line a call, in the waterfall too: the bar is on the row, not under it, so
    // the tree's guide lines are not broken, and nothing is drawn that can wrap.
    for (const id of ['before', 'a:ag', 'g1', 'g2', 'g3']) {
      const rowBox = await ui.find({ type: 'Box', key: `row:${id}` })
      expect(rowBox?.children?.length).toBe(1)
    }

    await ui.unmount()
  }

  // The details of one name the other (the row picked, as a press would leave it).
  held.selected = ['selected-1', 'g1']
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /ran at the same time as 1 other: Read/ })).toBeDefined()
  await ui.unmount()
})

test('a narrow pane keeps the bar, and gives up the start text and the slowest label', async ($, on) => {
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
    // A wide pane also says where each call started, and which was slowest.
    expect((await ui.findAll({ type: 'Text', text: /^\+\d+ms/ })).length > 0).toBe(isWide)
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
    plugin: 'ai-call-tree',
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
