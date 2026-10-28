import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { CodexJob, CodexState, Limit, Snapshot } from '../types'

const PANE = 'pult'
// panes get no toolbar icon of their own; the glyph marks the tab instead
const TITLE = '🎛 Пульт'
const CODEX_PLUGIN = 'codex@openai-codex'
// the one model Codex may run on; anything else is refused or put back
const CODEX_MODEL = 'gpt-6.1-sol'
const BANNED_MODEL = /gpt-6-astra/i
const CODEX_EFFORTS = ['low', 'medium', 'high', 'xhigh']
// autoCompactWindow is accepted between these two
const MIN_WINDOW = 100_000
const MAX_WINDOW = 1_000_000
// the reserve under the window when no breakdown has been read yet
const FALLBACK_BUFFER = 33_000
const PRESETS = [200_000, 300_000, 400_000, 500_000, 700_000]
const DEFAULT_WORDS = ['default', 'off', 'reset', 'auto', 'сброс', 'поумолчанию']
const BRIEF_PROMPT =
  'Сделай короткий бриф для продолжения этой работы в новой сессии: цель, что сделано, ' +
  'текущее состояние, решения и почему, открытые вопросы, следующие шаги, ключевые файлы. ' +
  'Без пересказа переписки, до 40 строк.'

const snap = atom({ plugin: 'pult', key: 'snap' } as const, {
  configured: null,
  window: null,
  buffer: null,
  used: null,
  source: null,
  limits: [],
  model: null,
  effort: null,
  note: null,
} as Snapshot)
const codex = atom({ plugin: 'pult', key: 'codex' } as const, {
  enabled: true,
  model: null,
  effort: null,
  plan: null,
  limits: [],
  limitsAt: null,
  jobs: [],
  result: null,
  note: null,
} as CodexState)
const isBandHidden = atom({ plugin: 'pult', key: 'isBandHidden' } as const, false)
const warned = atom({ plugin: 'pult', key: 'warned' } as const, [] as string[])

const fmt = (n: number | null) => {
  if (n === null) return '—'
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(2)}M`

  return `${Math.round(n / 1000)}K`
}

const pct = (n: number) => `${Math.round(n)}%`

const triggerOf = (s: Snapshot) =>
  s.window === null ? null : s.window - (s.buffer ?? FALLBACK_BUFFER)

const untilText = (iso: string | null) => {
  if (iso === null) return ''
  const ms = Date.parse(iso) - Date.now()
  if (!(ms > 0)) return ''
  const hours = Math.floor(ms / 3_600_000)
  if (hours >= 24) return `Сброс через ${Math.floor(hours / 24)} д ${hours % 24} ч`

  return `Сброс через ${hours} ч ${Math.floor((ms % 3_600_000) / 60_000)} мин`
}

const CLAUDE_LIMIT_LABELS: Record<string, string> = {
  five_hour: 'Лимит сессии',
  seven_day: 'Еженедельно · все модели',
  seven_day_opus: 'Еженедельно · Opus',
  seven_day_sonnet: 'Еженедельно · Sonnet',
  seven_day_fable: 'Еженедельно · Fable',
}

const windowLabel = (minutes: number) => {
  if (minutes === 300) return 'Лимит сессии'
  if (minutes === 10_080) return 'Еженедельно'
  if (minutes % 1440 === 0) return `${minutes / 1440} дн`

  return `${Math.round(minutes / 60)} ч`
}

// "400k", "0.4m", "400000", "400" (read as thousands); null is "back to default"
const parse = (text: string): number | null | undefined => {
  const t = text.trim().toLowerCase().replace(/[\s_]/g, '').replace(',', '.')
  if (DEFAULT_WORDS.includes(t)) return null
  const m = /^(\d+(?:\.\d+)?)(k|к|m|м)?$/.exec(t)
  if (!m) return undefined
  const n = Number(m[1])
  if (m[2] === 'k' || m[2] === 'к') return Math.round(n * 1000)
  if (m[2] === 'm' || m[2] === 'м') return Math.round(n * 1_000_000)

  return n < 2000 ? Math.round(n * 1000) : Math.round(n)
}

const homeDir = async ($: EngineInterface) =>
  (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''

const claudeDir = async ($: EngineInterface) =>
  (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${await homeDir($)}/.claude`

const codexDir = async ($: EngineInterface) =>
  (await $.env.get('CODEX_HOME')) ?? `${await homeDir($)}/.codex`

const settingsPath = async ($: EngineInterface) => `${await claudeDir($)}/settings.json`

// Read-modify-write of ~/.claude/settings.json; refuses a file it cannot parse.
const editSettings = async (
  $: EngineInterface,
  edit: (settings: Record<string, unknown>) => void,
) => {
  const path = await settingsPath($)
  let settings: Record<string, unknown> = {}
  if (await $.fs.exists(path)) {
    try {
      settings = JSON.parse(await $.fs.read(path))
    } catch {
      return `Не смог разобрать ${path} как JSON, ничего не менял.`
    }
  }
  edit(settings)
  await $.fs.write(path, `${JSON.stringify(settings, null, 2)}\n`)

  return null
}

// ---- Claude side --------------------------------------------------------

const refreshClaude = async ($: EngineInterface, note?: string | null) => {
  const configured = await $.settings
    .read({ key: 'autoCompactWindow' })
    .catch(() => undefined)
  const usage = await $.session
    .usage({ breakdown: 'summary' })
    .catch(() => undefined)
  const model = await $.session.model().catch(() => null)
  const effort = (await $.env.get('CLAUDE_EFFORT').catch(() => undefined)) ?? null
  const breakdown = usage?.context.breakdown
  const buffer = breakdown?.categories.find(c => c.kind === 'buffer')?.tokens
  const limits: Limit[] = (usage?.rateLimits ?? []).map(l => ({
    label: CLAUDE_LIMIT_LABELS[l.kind] ?? l.kind,
    percent: l.percentUsed,
    resetsAt: l.resetsAt ?? null,
  }))

  return update($, snap, prev => ({
    configured: typeof configured === 'number' ? configured : null,
    window: breakdown?.rawMaxTokens ?? prev.window,
    buffer: buffer ?? prev.buffer,
    used: usage?.context.tokens ?? breakdown?.totalTokens ?? prev.used,
    source: breakdown?.autocompactSource ?? prev.source,
    limits: limits.length > 0 ? limits : prev.limits,
    model,
    effort,
    note: note === undefined ? prev.note : note,
  }))
}

// Writes the window that puts the trigger at `target` (null drops the key).
const applyCompact = async ($: EngineInterface, target: number | null) => {
  const buffer = (await read($, snap)).buffer ?? FALLBACK_BUFFER
  const window =
    target === null ? null : Math.min(MAX_WINDOW, Math.max(MIN_WINDOW, target + buffer))
  const refused = await editSettings($, settings => {
    if (window === null) delete settings.autoCompactWindow
    else settings.autoCompactWindow = window
  })
  const note =
    refused ??
    (window === null
      ? 'Порог сброшен: компакт по умолчанию (≈97% окна модели).'
      : `autoCompactWindow = ${window}: компакт ≈ на ${fmt(window - buffer)}. Для новых сессий точно, для текущей — если движок подхватит.`)
  await refreshClaude($, note)
  // the engine picks the file up on its own watch; read again once it has
  void $.clock
    .sleep(1500)
    .then(() => refreshClaude($))
    .catch(() => undefined)

  return note
}

// The same run as typing /compact: queued until the answer in progress ends,
// with its own lines in the chat. $.session.compact() rejects mid-turn instead.
const compactNow = async ($: EngineInterface) => {
  await refreshClaude($, 'Сжимаю контекст… если идёт ответ — сразу после него.')
  try {
    const ran = await $.command.run({ command: 'compact' })
    await refreshClaude($, ran.text?.trim() || 'Контекст сжат.')
  } catch (err) {
    await refreshClaude($, `Не удалось запустить /compact: ${err instanceof Error ? err.message : String(err)}`)
  }
}

// ---- Codex side ---------------------------------------------------------

const companionScript = async ($: EngineInterface) => {
  const base = `${await claudeDir($)}/plugins/cache/openai-codex/codex`
  const versions = await $.fs.list(base).catch(() => [])
  const latest = versions
    .map(v => v.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .at(-1)

  return latest === undefined ? null : `${base}/${latest}/scripts/codex-companion.mjs`
}

const runCompanion = async ($: EngineInterface, args: string[]) => {
  const script = await companionScript($)
  if (script === null) return null
  const cwd = await $.session.cwd()
  const ran = await $.process.run(['node', script, ...args], { cwd, timeoutMs: 20_000 })

  return ran.exitCode === 0 ? ran.stdout : null
}

// The object that follows `"key":` at `from`, cut out by its braces.
const objectAfter = (text: string, from: number) => {
  const start = text.indexOf('{', from)
  if (start < 0) return null
  let depth = 0
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}' && --depth === 0) return text.slice(start, i + 1)
  }

  return null
}

type CodexWindow = { used_percent?: number; window_minutes?: number; resets_at?: number }
type CodexRateLimits = {
  primary?: CodexWindow | null
  secondary?: CodexWindow | null
  plan_type?: string | null
}

// The newest rate limits a Codex run wrote into ~/.codex/sessions/<y>/<m>/<d>/*.jsonl.
const readCodexLimits = async ($: EngineInterface) => {
  const sessions = `${await codexDir($)}/sessions`
  const newest = async (dir: string) =>
    (await $.fs.list(dir).catch(() => []))
      .map(e => e.name)
      .sort()
      .reverse()

  const files: { path: string; mtimeMs: number }[] = []
  for (const year of await newest(sessions)) {
    for (const month of await newest(`${sessions}/${year}`)) {
      for (const day of await newest(`${sessions}/${year}/${month}`)) {
        const dir = `${sessions}/${year}/${month}/${day}`
        const entries = await $.fs.list(dir).catch(() => [])
        for (const e of entries) {
          if (e.name.endsWith('.jsonl')) files.push({ path: `${dir}/${e.name}`, mtimeMs: e.mtimeMs })
        }
        if (files.length >= 5) break
      }
      if (files.length >= 5) break
    }
    if (files.length >= 5) break
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs)

  for (const file of files.slice(0, 5)) {
    const text = await $.fs.read(file.path).catch(() => null)
    if (text === null) continue
    const at = text.lastIndexOf('"rate_limits":')
    if (at < 0) continue
    const raw = objectAfter(text, at)
    if (raw === null) continue
    try {
      const rl = JSON.parse(raw) as CodexRateLimits
      const limits: Limit[] = [rl.primary, rl.secondary]
        .filter((w): w is CodexWindow => !!w && typeof w.used_percent === 'number')
        .map(w => ({
          label: windowLabel(w.window_minutes ?? 0),
          percent: w.used_percent ?? 0,
          resetsAt: w.resets_at ? new Date(w.resets_at * 1000).toISOString() : null,
        }))

      return { limits, plan: rl.plan_type ?? null, at: file.mtimeMs }
    } catch {
      continue
    }
  }

  return null
}

const readCodexConfig = async ($: EngineInterface) => {
  const text = await $.fs.read(`${await codexDir($)}/config.toml`).catch(() => '')

  return {
    text,
    model: /^model\s*=\s*"([^"]*)"/m.exec(text)?.[1] ?? null,
    effort: /^model_reasoning_effort\s*=\s*"([^"]*)"/m.exec(text)?.[1] ?? null,
  }
}

// Sets one top-level `key = "value"` line of config.toml, adding it at the top.
const setCodexConfig = async ($: EngineInterface, key: string, value: string) => {
  const path = `${await codexDir($)}/config.toml`
  const { text } = await readCodexConfig($)
  const line = `${key} = "${value}"`
  const pattern = new RegExp(`^${key}\\s*=.*$`, 'm')
  await $.fs.write(path, pattern.test(text) ? text.replace(pattern, line) : `${line}\n${text}`)
}

type CompanionJob = {
  id?: string
  title?: string
  kindLabel?: string
  status?: string
  phase?: string
  summary?: string | null
}

const toJob = (j: CompanionJob): CodexJob => ({
  id: j.id ?? '',
  title: j.kindLabel ?? j.title ?? 'задача',
  status: j.phase ?? j.status ?? '',
  summary: j.summary ?? null,
})

const refreshCodex = async ($: EngineInterface, note?: string | null) => {
  const enabledPlugins = await $.settings
    .read({ key: 'enabledPlugins' })
    .catch(() => undefined)
  const enabled =
    (enabledPlugins as Record<string, boolean> | undefined)?.[CODEX_PLUGIN] !== false
  const config = await readCodexConfig($)
  const limits = await readCodexLimits($).catch(() => null)
  const status = await runCompanion($, ['status', '--json']).catch(() => null)
  let jobs: CodexJob[] = []
  if (status !== null) {
    try {
      const parsed = JSON.parse(status) as {
        running?: CompanionJob[]
        latestFinished?: CompanionJob | null
      }
      jobs = [...(parsed.running ?? []), ...(parsed.latestFinished ? [parsed.latestFinished] : [])]
        .filter(j => j.id)
        .map(toJob)
    } catch {
      jobs = []
    }
  }

  return update($, codex, prev => ({
    ...prev,
    enabled,
    model: config.model,
    effort: config.effort,
    plan: limits?.plan ?? prev.plan,
    limits: limits?.limits ?? prev.limits,
    limitsAt: limits?.at ?? prev.limitsAt,
    jobs,
    note: note === undefined ? prev.note : note,
  }))
}

const setCodexEnabled = async ($: EngineInterface, on: boolean) => {
  const refused = await editSettings($, settings => {
    const plugins = (settings.enabledPlugins ?? {}) as Record<string, boolean>
    settings.enabledPlugins = { ...plugins, [CODEX_PLUGIN]: on }
  })
  await refreshCodex(
    $,
    refused ?? (on ? 'Codex включён — команды /codex:* появятся в новых сессиях.' : 'Codex выключен для новых сессий.'),
  )
}

const jobAction = async ($: EngineInterface, action: 'result' | 'cancel', id: string) => {
  const out = await runCompanion($, [action, id]).catch(() => null)
  if (action === 'result') {
    await update($, codex, prev => ({
      ...prev,
      result: out === null ? 'Не удалось получить результат.' : out.slice(0, 6000),
    }))
  }
  await refreshCodex($, action === 'cancel' ? (out === null ? 'Не удалось отменить.' : 'Задача отменена.') : undefined)
}

// ---- warnings -----------------------------------------------------------

const warnOnce = async ($: EngineInterface, key: string, text: string) => {
  if ((await read($, warned)).includes(key)) return
  await update($, warned, list => [...list, key])
  $.ui.toast(text)
}

const checkWarnings = async ($: EngineInterface) => {
  const s = await read($, snap)
  const c = await read($, codex)
  const trigger = triggerOf(s)
  if (s.used !== null && trigger !== null && s.used >= trigger * 0.85) {
    await warnOnce(
      $,
      'context',
      `Контекст ${fmt(s.used)} из ${fmt(trigger)} — скоро компакт. Можно попросить бриф (кнопка в Пульте) и начать новую сессию.`,
    )
  }
  for (const l of s.limits) {
    if (l.percent >= 90) await warnOnce($, `claude-${l.label}`, `Claude, ${l.label}: израсходовано ${pct(l.percent)}.`)
  }
  for (const l of c.limits) {
    if (l.percent >= 90) await warnOnce($, `codex-${l.label}`, `Codex, ${l.label}: израсходовано ${pct(l.percent)}.`)
  }
  if (s.effort === 'xhigh' || s.effort === 'max') {
    await warnOnce($, 'effort', `Сессия идёт на усилии ${s.effort} — это дорого по лимитам; для рутины хватит high.`)
  }
  if (c.model !== null && c.model !== CODEX_MODEL) {
    await warnOnce($, 'codex-model', `Модель Codex в config.toml — ${c.model}, а должна быть ${CODEX_MODEL}. Исправить можно в Пульте.`)
  }
}

const refreshAll = async ($: EngineInterface) => {
  await refreshClaude($)
  await refreshCodex($).catch(() => undefined)
  const s = await read($, snap)
  $.ui.status(`автокомпакт ≈ ${fmt(triggerOf(s))}`)
  await checkWarnings($)
}

const summaryText = (s: Snapshot) =>
  [
    `Автокомпакт сработает ≈ на ${fmt(triggerOf(s))} (окно ${fmt(s.window)}, резерв ${fmt(s.buffer)}).`,
    `В контексте сейчас: ${fmt(s.used)}. В settings.json: ${s.configured === null ? 'не задано' : s.configured}. Источник: ${s.source ?? '—'}.`,
    'Сменить: /compact-at 400k · /compact-at 0.3m · /compact-at default · панель: /pult',
  ].join('\n')

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'pult',
      description: 'Открыть Пульт: компакт, лимиты Claude и Codex, модель и задачи Codex',
    })
    await $.command.register({
      name: 'compact-at',
      description: 'Порог автокомпакта: без аргумента — сводка, с числом ставит порог',
      argumentHint: '[400k | 0.3m | default]',
    })
    void $.ui.open({ id: PANE, title: TITLE }).catch(() => undefined)
    void refreshAll($).catch(() => undefined)

    return started
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    void refreshAll($).catch(() => undefined)

    return done
  })

  // Codex runs on gpt-6.1-sol only: a call that names Astra is refused.
  on('tool.call', async ($, e, next) => {
    const isShell = e.tool === 'Bash' || e.tool === 'PowerShell' || e.tool === 'Agent'
    const isCodexFile =
      (e.tool === 'Write' || e.tool === 'Edit') && /[\\/]\.codex[\\/]/.test(e.file_path)
    if ((isShell || isCodexFile) && BANNED_MODEL.test(JSON.stringify(e))) {
      return { deny: `Пульт: модель gpt-6-astra запрещена, Codex работает только на ${CODEX_MODEL}.` }
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'pult' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    void refreshAll($).catch(() => undefined)

    return { text: 'Пульт открыт.' }
  }).catch(($, e, next) => (next.called ? next(e) : { text: 'Пульт не открылся.' }))

  on('command.run', { command: 'compact-at' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === '') return { text: summaryText(await refreshClaude($)) }
    const target = parse(arg)
    if (target === undefined) {
      return { text: `Не понял «${arg}». Примеры: /compact-at 400k, /compact-at 0.3m, /compact-at default` }
    }

    return { text: await applyCompact($, target) }
  }).catch(($, e, next) =>
    next.called ? next(e) : { text: '/compact-at: не получилось, порог не менял.' },
  )

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, isBandHidden))) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const s = await read($, snap)
    const c = await read($, codex)
    const parts = [
      `ctx ${fmt(s.used)}/${fmt(triggerOf(s))}`,
      ...s.limits.map(l => `${l.label} ${pct(l.percent)}`),
      ...(c.enabled ? c.limits.map(l => `Codex ${l.label} ${pct(l.percent)}`) : ['Codex выкл']),
    ]

    return (
      <Box flexDirection="row" columnGap={1}>
        <Text dimColor>{parts.join(' · ')}</Text>
        <Button key="band-open" label="Пульт" onPress={() => $.ui.open({ id: PANE, title: TITLE })} />
        <Button key="band-hide" label="Скрыть" onPress={() => update($, isBandHidden, () => true)} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Button, Text } = elements
    // desktop draws pictures and lists; the terminal and phone fall back to text and buttons
    // the phone's table may list a Select or Input it does not draw
    const isPhone = e.surface === 'mobile'
    const Svg = 'Svg' in elements ? elements.Svg : undefined
    const Picker = !isPhone && 'Select' in elements ? elements.Select : undefined
    const Field = !isPhone && 'Input' in elements ? elements.Input : undefined
    const s = await read($, snap)
    const c = await read($, codex)
    const bandHidden = await read($, isBandHidden)
    const buffer = s.buffer ?? FALLBACK_BUFFER
    const trigger = triggerOf(s)
    const barColumns = Math.max(10, Math.min(40, (e.props.bodyColumns ?? 40) - 4))

    const bar = (key: string, percent: number) => {
      const p = Math.max(0, Math.min(100, percent))
      const fill = p >= 90 ? '#e5484d' : p >= 75 ? '#e8a33d' : '#3b82f6'
      if (Svg !== undefined) {
        const source =
          '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="4" viewBox="0 0 100 4" preserveAspectRatio="none">' +
          '<rect width="100" height="4" rx="2" fill="#8a8a8a" fill-opacity="0.25"/>' +
          `<rect width="${p}" height="4" rx="2" fill="${fill}"/></svg>`

        return <Svg key={key} source={source} alt={`${Math.round(p)}%`} height={4} />
      }
      const filled = Math.round((p / 100) * barColumns)

      return (
        <Text color={p >= 90 ? 'error' : p >= 75 ? 'warning' : 'suggestion'}>
          {'━'.repeat(filled)}
          <Text dimColor>{'━'.repeat(barColumns - filled)}</Text>
        </Text>
      )
    }

    const row = (label: string, value: string, isStrong = false) => (
      <Box flexDirection="row" justifyContent="space-between" columnGap={1}>
        <Text weight={isStrong ? 'medium' : 'regular'}>{label}</Text>
        <Text dimColor tabular>
          {value}
        </Text>
      </Box>
    )

    const limit = (key: string, l: Limit) => (
      <Box flexDirection="column" gap="xs">
        {row(l.label, [untilText(l.resetsAt), pct(l.percent)].filter(Boolean).join('   '), true)}
        {bar(key, l.percent)}
      </Box>
    )

    const card = (title: string, children: RenderChildren[]) => (
      <Box flexDirection="column" gap="sm" paddingX={1} paddingY={1} borderStyle="round" borderDimColor>
        <Text weight="semibold">{title}</Text>
        {children}
      </Box>
    )

    const choose = (
      key: string,
      label: string,
      options: { value: string; label: string }[],
      value: string,
      pick: (value: string) => unknown,
    ) =>
      Picker !== undefined ? (
        <Picker key={key} label={label} options={options} value={value} onSelect={v => void pick(v)} />
      ) : (
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          <Text dimColor>{label}</Text>
          {options.map(o => (
            <Button
              key={`${key}-${o.value}`}
              label={o.value === value ? `● ${o.label}` : o.label}
              onPress={() => void pick(o.value)}
            />
          ))}
        </Box>
      )

    const thresholdValue =
      s.configured === null
        ? 'default'
        : String(PRESETS.find(p => Math.abs((s.configured ?? 0) - buffer - p) < 2000) ?? 'custom')
    const thresholdOptions = [
      ...PRESETS.map(p => ({ value: String(p), label: fmt(p) })),
      { value: 'default', label: 'По умолчанию' },
      ...(thresholdValue === 'custom' ? [{ value: 'custom', label: `свой: ${fmt(trigger)}` }] : []),
    ]
    const usedPercent = s.used !== null && trigger ? (s.used / trigger) * 100 : 0

    return (
      <Box flexDirection="column" gap="md">
        {card('Контекст', [
          row(`Использовано: ${pct(usedPercent)} до компакта`, `${fmt(s.used)} / ${fmt(trigger)}`, true),
          bar('ctx-bar', usedPercent),
          <Text size="caption" dimColor>
            окно {fmt(s.window)} · резерв {fmt(s.buffer)} · источник {s.source ?? '—'}
          </Text>,
          choose('threshold', 'Компакт при', thresholdOptions, thresholdValue, v => {
            if (v === 'custom') return undefined

            return applyCompact($, v === 'default' ? null : Number(v))
          }),
          Field !== undefined ? (
            <Field
              key="custom"
              label="Свой порог"
              placeholder="например 350k"
              submitLabel="применить"
              onSubmit={(value: string) => {
                const target = parse(value)
                if (target === undefined) {
                  void refreshClaude($, `Не понял «${value}». Пример: 350k или 0.35m`)

                  return
                }
                void applyCompact($, target)
              }}
            />
          ) : null,
          <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
            <Button key="compact-now" variant="secondary" label="Сжать сейчас" onPress={() => compactNow($)} />
            <Button
              key="brief"
              variant="secondary"
              label="Бриф для новой сессии"
              onPress={() => $.prompt.submit({ text: BRIEF_PROMPT })}
            />
          </Box>,
          s.note !== null ? (
            <Text size="caption" dimColor>
              {s.note}
            </Text>
          ) : null,
        ])}

        {card('Лимиты Claude', [
          <Text size="caption" dimColor>
            {s.model ?? '—'} · усилие {s.effort ?? '—'}
          </Text>,
          ...(s.limits.length === 0
            ? [
                <Text size="caption" dimColor>
                  Появятся после первого ответа модели.
                </Text>,
              ]
            : s.limits.map((l, i) => limit(`claude-${i}`, l))),
        ])}

        {card('Codex', [
          choose(
            'codex-enabled',
            'Плагин',
            [
              { value: 'on', label: 'Включён' },
              { value: 'off', label: 'Выключен' },
            ],
            c.enabled ? 'on' : 'off',
            v => setCodexEnabled($, v === 'on'),
          ),
          row(
            'Модель',
            c.model === CODEX_MODEL ? `${CODEX_MODEL} ✓` : `${c.model ?? '—'} — нужна ${CODEX_MODEL}`,
            true,
          ),
          c.model !== CODEX_MODEL ? (
            <Button
              key="codex-model"
              variant="primary"
              label={`Вернуть ${CODEX_MODEL}`}
              onPress={async () => {
                await setCodexConfig($, 'model', CODEX_MODEL)
                await refreshCodex($, `Модель Codex: ${CODEX_MODEL}.`)
              }}
            />
          ) : null,
          choose(
            'codex-effort',
            'Усилие',
            CODEX_EFFORTS.map(level => ({ value: level, label: level })),
            c.effort ?? '',
            async v => {
              await setCodexConfig($, 'model_reasoning_effort', v)
              await refreshCodex($, `Усилие Codex: ${v}.`)
            },
          ),
          ...(c.limits.length === 0
            ? [
                <Text size="caption" dimColor>
                  Лимиты появятся после первого запуска Codex.
                </Text>,
              ]
            : c.limits.map((l, i) => limit(`codex-${i}`, l))),
          <Text size="caption" dimColor>
            тариф {c.plan ?? '—'}
            {c.limitsAt !== null ? ` · данные от ${new Date(c.limitsAt).toLocaleString('ru-RU')}` : ''}
          </Text>,
          <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
            <Button
              key="codex-review"
              variant="secondary"
              label="Codex-ревью диффа"
              onPress={async () => {
                await $.prompt.fill({ text: '/codex:review --background' })
                await refreshCodex($, 'Команда ревью в поле ввода — нажмите Enter.')
              }}
            />
          </Box>,
          ...(c.jobs.length === 0
            ? [
                <Text size="caption" dimColor>
                  Задач Codex в этой папке нет.
                </Text>,
              ]
            : c.jobs.map(job => (
                <Box flexDirection="column">
                  {row(`${job.title} · ${job.status}`, '')}
                  {job.summary ? (
                    <Text size="caption" dimColor wrap="truncate-end">
                      {job.summary}
                    </Text>
                  ) : null}
                  <Box flexDirection="row" columnGap={1}>
                    <Button
                      key={`result-${job.id}`}
                      variant="secondary"
                      label="Результат"
                      onPress={() => jobAction($, 'result', job.id)}
                    />
                    {job.status !== 'done' ? (
                      <Button
                        key={`cancel-${job.id}`}
                        variant="secondary"
                        label="Отменить"
                        onPress={() => jobAction($, 'cancel', job.id)}
                      />
                    ) : null}
                  </Box>
                </Box>
              ))),
          c.result !== null ? (
            <Box flexDirection="column" gap="xs">
              <Text size="caption" dimColor>
                {c.result}
              </Text>
              <Button
                key="result-close"
                variant="secondary"
                label="Скрыть результат"
                onPress={() => update($, codex, prev => ({ ...prev, result: null }))}
              />
            </Box>
          ) : null,
          c.note !== null ? (
            <Text size="caption" dimColor>
              {c.note}
            </Text>
          ) : null,
        ])}

        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          <Button key="refresh" variant="secondary" label="Обновить" onPress={() => refreshAll($)} />
          <Button
            key="band"
            variant="secondary"
            label={bandHidden ? 'Показать строку над вводом' : 'Скрыть строку над вводом'}
            onPress={() => update($, isBandHidden, v => !v)}
          />
        </Box>
      </Box>
    )
  })
}
