// One usage window: Claude's or Codex's.
export type Limit = { label: string; percent: number; resetsAt: string | null }

export type CodexJob = { id: string; title: string; status: string; summary: string | null }

// The Claude side: the context, the compaction window and the plan limits.
export type Snapshot = {
  // autoCompactWindow from the merged settings, null when unset
  configured: number | null
  // the compaction window the engine measures against (rawMaxTokens)
  window: number | null
  // the compaction reserve below that window
  buffer: number | null
  // tokens in the context right now
  used: number | null
  // who settled the window: settings, env, model-default, ...
  source: string | null
  limits: Limit[]
  model: string | null
  effort: string | null
  note: string | null
}

// The Codex side: the plugin switch, ~/.codex/config.toml, limits and jobs.
export type CodexState = {
  enabled: boolean
  model: string | null
  effort: string | null
  plan: string | null
  limits: Limit[]
  // when the limits were last reported by a Codex run
  limitsAt: number | null
  jobs: CodexJob[]
  // the text of the last result asked for
  result: string | null
  note: string | null
}

declare module 'claude-code' {
  interface PluginState {
    pult: {
      snap: Snapshot
      codex: CodexState
      isBandHidden: boolean
      warned: string[]
    }
  }
}
