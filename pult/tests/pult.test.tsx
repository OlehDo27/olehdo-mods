import { expect, test } from 'claude-code/testing'
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
