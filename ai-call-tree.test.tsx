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
    await ui.press({ key: row?.key ?? '' })

    expect(await ui.find({ type: 'Text', text: /file two/ })).toBeDefined()

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
