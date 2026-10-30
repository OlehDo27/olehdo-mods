import { expect, mock, test } from 'claude-code/testing'
import type { On, SessionUsage } from 'claude-code'

const HOME = 'C:/Users/me'
const SETTINGS = `${HOME}/.claude/settings.json`
const CONFIG = `${HOME}/.codex/config.toml`
const SESSION_DIR = `${HOME}/.codex/sessions/2026/10/25`
const COMPANION_BASE = `${HOME}/.claude/plugins/cache/openai-codex/codex`

const PANE = {
  plugin: 'pult',
  component: 'Pane',
  requestId: 'pult',
  props: {
    title: 'Пульт',
    isFocused: false,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 60 },
    view: {},
  },
} as const

const typed = (command: string, args: string) => ({
  command,
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: false, columns: 100 },
})

const ROLLOUT =
  '{"type":"session_meta"}\n' +
  '{"type":"event_msg","payload":{"type":"token_count","rate_limits":{"limit_id":"codex","primary":{"used_percent":12.0,"window_minutes":10080,"resets_at":1893531877},"secondary":null,"plan_type":"prolite"}}}\n'

// The engine beneath the mod: files in memory, a 1M window with a 33K
// reserve (or the window settings.json names), one finished Codex job.
const norm = (path: string) => path.replace(/\\/g, '/')

const engine = (on: On, files: Record<string, string>) => {
  const settings = () => JSON.parse(files[SETTINGS] ?? '{}') as Record<string, unknown>
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('env.get', (_, e) => ({
    value: e.name === 'USERPROFILE' ? HOME : e.name === 'CLAUDE_EFFORT' ? 'high' : undefined,
  }))
  on('fs.exists', (_, e) => ({ value: norm(e.path) in files }))
  on('fs.read', (_, e) => {
    const text = files[norm(e.path)]
    if (text === undefined) throw new Error('ENOENT')

    return { value: text }
  })
  on('fs.write', (_, e) => {
    files[norm(e.path)] = e.text

    return { value: undefined }
  })
  on('fs.list', (_, e) => {
    const dirs: Record<string, string[]> = {
      [`${HOME}/.codex/sessions`]: ['2026'],
      [`${HOME}/.codex/sessions/2026`]: ['10'],
      [`${HOME}/.codex/sessions/2026/10`]: ['25'],
      [SESSION_DIR]: ['rollout-1.jsonl'],
      [COMPANION_BASE]: ['1.0.6'],
    }
    const names = dirs[norm(e.path)] ?? []

    return {
      value: names.map(name => ({ name, kind: 'file' as const, size: 1, mtimeMs: 1_790_000_000_000, isLink: false })),
    }
  })
  on('process.run', () => ({
    value: {
      exitCode: 0,
      stdout: JSON.stringify({
        running: [],
        latestFinished: { id: 'task-1', kindLabel: 'rescue', phase: 'done', summary: 'CODEX_OK' },
      }),
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  on('session.cwd', () => ({ value: '/work' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('clock.sleep', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('settings.read', () => ({ value: settings() }))
  on('session.usage', () => {
    const window = (settings().autoCompactWindow as number | undefined) ?? 1_000_000
    const usage = {
      startedAt: 0,
      rateLimits: [
        { kind: 'five_hour', percentUsed: 3 },
        { kind: 'seven_day', percentUsed: 48 },
      ],
      context: {
        tokens: 120_000,
        window: 1_000_000,
        breakdown: {
          categories: [
            { name: 'Messages', tokens: 120_000, color: 'x', isDeferred: false, kind: 'used' },
            { name: 'Autocompact buffer', tokens: 33_000, color: 'x', isDeferred: false, kind: 'buffer' },
          ],
          totalTokens: 120_000,
          maxTokens: window,
          rawMaxTokens: window,
          autocompactSource: 'settings',
          percentage: 12,
        },
      },
    }

    return { value: usage as unknown as SessionUsage }
  })
  on('tool.call', () => ({ result: {} }))
}

const freshFiles = (): Record<string, string> => ({
  [SETTINGS]: '{ "theme": "dark", "autoCompactWindow": 433000 }',
  [CONFIG]: 'model = "gpt-6.1-sol"\nmodel_reasoning_effort = "medium"\n',
  [`${SESSION_DIR}/rollout-1.jsonl`]: ROLLOUT,
})

test('/compact-at 300k writes the window and keeps the rest', async ($, on) => {
  const files = freshFiles()
  engine(on, files)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })

  const ran = await $.command.run(typed('compact-at', '300k'))

  expect(JSON.parse(files[SETTINGS]!)).toEqual({ theme: 'dark', autoCompactWindow: 333_000 })
  expect(ran.text).toMatch(/300K/)
})

test('/compact-at default drops the key', async ($, on) => {
  const files = freshFiles()
  engine(on, files)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })

  await $.command.run(typed('compact-at', 'default'))

  expect(JSON.parse(files[SETTINGS]!)).toEqual({ theme: 'dark' })
})

test('a shell call that names gpt-6-astra is refused, others run', async ($, on) => {
  engine(on, freshFiles())
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })

  const banned = await $.tool.call({ tool: 'Bash', command: 'codex exec -m gpt-6-astra "hi"' })
  const allowed = await $.tool.call({ tool: 'Bash', command: 'codex exec -m gpt-6.1-sol "hi"' })

  expect(JSON.stringify(banned)).toMatch(/запрещена/)
  expect(JSON.stringify(allowed)).not.toMatch(/запрещена/)
})

test('the pane shows Claude and Codex and its buttons act, on every surface', async ($, on) => {
  const files = freshFiles()
  engine(on, files)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    Object.assign(files, freshFiles())
    await $.command.run(typed('pult', ''))
    const ui = await $.ui.mount({ ...PANE, surface })

    // a list where the surface draws one, its fallback buttons on the phone
    const lists = ui as { select?: (target: { plugin: string; key: string; value: string }) => Promise<unknown> }
    const pick = async (key: string, value: string) =>
      surface === 'mobile' || lists.select === undefined
        ? ui.press({ key: `${key}-${value}` })
        : lists.select({ plugin: 'pult', key, value })

    expect(await ui.find({ type: 'Text', text: /120K \/ 400K/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Еженедельно · все модели/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^48%$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Сброс через .* 12%$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /rescue · done/ })).toBeDefined()
    expect(await ui.find({ key: 'codex-model' })).toBeUndefined()

    await pick('threshold', '500000')
    expect(JSON.parse(files[SETTINGS]!).autoCompactWindow).toBe(533_000)

    await pick('codex-effort', 'high')
    expect(files[CONFIG]).toMatch(/^model_reasoning_effort = "high"$/m)

    await pick('codex-enabled', 'off')
    expect(JSON.parse(files[SETTINGS]!).enabledPlugins).toEqual({ 'codex@openai-codex': false })
    await ui.unmount()
  }
})

test('«Сжать сейчас» runs /compact and says what came of it', async ($, on) => {
  engine(on, freshFiles())
  let compacted = 0
  on('command.run', { command: 'compact' }, () => {
    compacted++

    return { text: 'Compacted. ctrl+o to see full summary' }
  })
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await $.command.run(typed('pult', ''))

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'compact-now' })

  expect(compacted).toBe(1)
  expect(await ui.find({ type: 'Text', text: /Compacted/ })).toBeDefined()
  await ui.unmount()
})

const spawn = { prompt: 'p', description: 'd' }

test('a subagent runs on its kind of work, and the call may name its own model', async ($, on) => {
  engine(on, freshFiles())
  mock.store(on)
  const models: Record<string, string | undefined> = {}
  on('agent.spawn', (_, e) => {
    models[e.description] = e.model

    return { model: e.model ?? 'parent', agentId: e.description }
  })
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })

  await $.agent.spawn({ ...spawn, subagentType: 'Explore', description: 'scout' })
  await $.agent.spawn({ ...spawn, subagentType: 'general-purpose', description: 'code' })
  await $.agent.spawn({ ...spawn, subagentType: 'pult:review', description: 'review' })
  await $.agent.spawn({ ...spawn, subagentType: 'codex:codex-rescue', description: 'plugin' })
  await $.agent.spawn({ ...spawn, subagentType: 'Explore', description: 'named', model: 'opus' })

  expect(models).toEqual({ scout: 'sonnet', code: 'sonnet', review: 'opus', plugin: undefined, named: 'opus' })
})

test('a subagent asks for its rule effort, the main loop and a fork keep theirs', async ($, on) => {
  engine(on, freshFiles())
  mock.store(on)
  const efforts: Record<string, unknown> = {}
  on('turn.step', async function* (_, e) {
    efforts[e.agentId ?? 'main'] = e.effort

    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [] } as never
  })
  on('agent.list', () => ({
    value: [
      { id: 'listed', description: 'd', type: 'Explore', status: 'running' },
      { id: 'forked', description: 'd', type: 'fork', status: 'running' },
    ],
  }))
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })

  const step = { turnId: 't', index: 0, model: 'm', effort: 'xhigh', messageCount: 1 } as const
  for (const agentId of [undefined, 'listed', 'forked', 'unknown']) {
    for await (const _ of $.turn.step({ ...step, agentId })) void _
  }

  expect(efforts).toEqual({ main: 'xhigh', listed: 'low', forked: 'xhigh', unknown: 'xhigh' })
})

test('the pane changes a rule, the store keeps it and /subagents off lifts them all', async ($, on) => {
  const stored: Record<string, unknown> = {}
  on('store.get', (_, e) => ({ value: stored[e.key] }))
  on('store.set', (_, e) => {
    stored[e.key] = e.value

    return { value: undefined }
  })
  engine(on, freshFiles())
  const models: (string | undefined)[] = []
  on('agent.spawn', (_, e) => {
    models.push(e.model)

    return { model: e.model ?? 'parent', agentId: 'a1' }
  })
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await $.command.run(typed('pult', ''))

  const ui = await $.ui.mount({ ...PANE, surface: 'mobile' })
  await ui.press({ key: 'sub-model-scout-haiku' })
  await ui.unmount()
  expect(stored.subagents).toMatchObject({ rules: { scout: { model: 'haiku', effort: 'low' } } })

  await $.agent.spawn({ ...spawn, subagentType: 'Explore' })
  const summary = await $.command.run(typed('subagents', 'off'))
  await $.agent.spawn({ ...spawn, subagentType: 'Explore' })

  expect(summary.text).toMatch(/выключены/)
  expect(models).toEqual(['haiku', undefined])
})

test('/subagents sets a rule, resets them and refuses what it cannot read', async ($, on) => {
  engine(on, freshFiles())
  mock.store(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })

  expect((await $.command.run(typed('subagents', 'mech sonnet medium'))).text).toMatch(/mech · Механика: sonnet · medium/)
  expect((await $.command.run(typed('subagents', 'default'))).text).toMatch(/mech · Механика: haiku · low/)
  expect((await $.command.run(typed('subagents', 'mech gpt'))).text).toMatch(/Не понял/)
})

test('a new session takes the rule unless the call says otherwise or takes no model', async ($, on) => {
  const seen: Record<string, unknown>[] = []
  on('tool.call', { tool: 'mcp__ccd_session__start_session' }, (_, e) => {
    seen.push(e as unknown as Record<string, unknown>)

    return { result: {} }
  })
  engine(on, freshFiles())
  mock.store(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await $.command.run(typed('compact-at', ''))
  const call = { tool: 'mcp__ccd_session__start_session', title: 't' } as const

  await $.tool.call({ ...call, prompt: 'brief', initiation: 'user_asked' })
  await $.tool.call({ ...call, prompt: 'brief', initiation: 'user_asked', model: 'claude-haiku-5-5' })
  await $.tool.call({ ...call, prompt: 'brief', context: 'fork' })
  await $.tool.call({ ...call, initiation: 'offer' })

  expect(seen[0]).toMatchObject({ model: 'claude-sonnet-5-5', effort: 'high' })
  expect(seen[1]).toMatchObject({ model: 'claude-haiku-5-5' })
  expect(seen[2]?.model).toBeUndefined()
  expect(seen[3]?.model).toBeUndefined()
})

test('a wrong Codex model is shown and put back to gpt-6.1-sol', async ($, on) => {
  const files = freshFiles()
  files[CONFIG] = 'model = "other-model"\n'
  engine(on, files)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await $.command.run(typed('pult', ''))

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'codex-model' })

  expect(files[CONFIG]).toMatch(/^model = "gpt-6.1-sol"$/m)
  await ui.unmount()
})
