/**
 * pi-dash — Live TUI dashboard widget for Pi
 *
 * Persistent widget above the editor showing real-time session stats:
 * tokens, context %, uptime, messages, tool calls, model.
 *
 * Uses ctx.ui.setWidget() for a live-updating display.
 * Uses ctx.ui.setStatus() for footer status.
 *
 * /dash        — toggle dashboard on/off
 * /dash expand — show detailed stats
 * /dash reset  — reset counters
 */

import type { ExtensionAPI, ExtensionContext, TurnEndEvent, MessageEndEvent, ToolExecutionEndEvent } from '@mariozechner/pi-coding-agent'

interface DashState {
  enabled: boolean
  expanded: boolean
  startedAt: number
  messages: number
  turns: number
  toolCalls: number
  errors: number
  inputTokens: number
  outputTokens: number
  toolBreakdown: Map<string, number>
  lastModel: string
}

const state: DashState = {
  enabled: true,
  expanded: false,
  startedAt: Date.now(),
  messages: 0,
  turns: 0,
  toolCalls: 0,
  errors: 0,
  inputTokens: 0,
  outputTokens: 0,
  toolBreakdown: new Map(),
  lastModel: '',
}

function uptimeStr(): string {
  const s = Math.round((Date.now() - state.startedAt) / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function buildDashLine(ctx: ExtensionContext): string[] {
  const usage = ctx.getContextUsage?.()
  const pct = usage?.percent ?? null
  const total = state.inputTokens + state.outputTokens

  // Bar
  const barLen = 15
  const filled = pct !== null ? Math.round((pct / 100) * barLen) : 0
  const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled)
  const pctStr = pct !== null ? `${Math.round(pct)}%` : '?%'

  // Color based on usage
  const pctIcon = pct !== null ? (pct > 90 ? '🔴' : pct > 70 ? '🟡' : '🟢') : '⚪'

  const line1 = `${pctIcon} ${bar} ${pctStr}  │  ⏱ ${uptimeStr()}  │  💬 ${state.messages}  │  🔧 ${state.toolCalls}  │  📊 ${fmtNum(total)} tok`

  if (!state.expanded) return [line1]

  // Expanded view
  const lines = [line1]
  lines.push(`   In: ${fmtNum(state.inputTokens)}  Out: ${fmtNum(state.outputTokens)}  Turns: ${state.turns}  Errors: ${state.errors}  Model: ${state.lastModel || '?'}`)

  if (state.toolBreakdown.size > 0) {
    const top3 = Array.from(state.toolBreakdown.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => `${name}:${count}`)
      .join('  ')
    lines.push(`   Top tools: ${top3}`)
  }

  return lines
}

function updateWidget(ctx: ExtensionContext) {
  if (!state.enabled) {
    ctx.ui.setWidget('pi-dash', undefined)
    return
  }
  const lines = buildDashLine(ctx)
  ctx.ui.setWidget('pi-dash', lines, { placement: 'aboveEditor' })
}

export default function init(pi: ExtensionAPI) {

  // Track turns
  pi.on('turn_end', (event: TurnEndEvent, ctx: ExtensionContext) => {
    state.turns++
    updateWidget(ctx)
  })

  // Track messages + tokens
  pi.on('message_end', (event: MessageEndEvent, ctx: ExtensionContext) => {
    state.messages++
    const msg = event.message as any
    if (msg?.usage) {
      state.inputTokens += msg.usage.input_tokens || 0
      state.outputTokens += msg.usage.output_tokens || 0
    }
    updateWidget(ctx)
  })

  // Track tool calls
  pi.on('tool_execution_end', (event: ToolExecutionEndEvent, ctx: ExtensionContext) => {
    state.toolCalls++
    if (event.isError) state.errors++
    const current = state.toolBreakdown.get(event.toolName) || 0
    state.toolBreakdown.set(event.toolName, current + 1)
    updateWidget(ctx)
  })

  // Track model changes
  pi.on('model_select', (event: any, ctx: ExtensionContext) => {
    state.lastModel = event.model?.id || event.model?.name || '?'
    updateWidget(ctx)
  })

  // Init widget on session start
  pi.on('session_start', (_event: any, ctx: ExtensionContext) => {
    state.startedAt = Date.now()
    if (state.enabled) updateWidget(ctx)
  })

  // Status bar
  pi.on('turn_end', (_event: TurnEndEvent, ctx: ExtensionContext) => {
    const usage = ctx.getContextUsage?.()
    const pct = usage?.percent
    if (pct !== null && pct !== undefined) {
      ctx.ui.setStatus('ctx', `ctx:${Math.round(pct)}%`)
    }
  })

  // Command
  pi.registerCommand('dash', {
    description: 'Toggle live dashboard widget',
    handler: async (args: string, ctx) => {
      const sub = args.trim().toLowerCase()

      if (sub === 'off' || sub === 'hide') {
        state.enabled = false
        ctx.ui.setWidget('pi-dash', undefined)
        ctx.ui.notify('Dashboard hidden', 'info')
        return
      }
      if (sub === 'on' || sub === 'show') {
        state.enabled = true
        updateWidget(ctx)
        ctx.ui.notify('Dashboard shown', 'info')
        return
      }
      if (sub === 'expand') {
        state.expanded = !state.expanded
        updateWidget(ctx)
        return
      }
      if (sub === 'reset') {
        state.messages = 0; state.turns = 0; state.toolCalls = 0
        state.errors = 0; state.inputTokens = 0; state.outputTokens = 0
        state.toolBreakdown.clear(); state.startedAt = Date.now()
        updateWidget(ctx)
        ctx.ui.notify('Dashboard reset', 'info')
        return
      }

      // Toggle
      state.enabled = !state.enabled
      if (state.enabled) updateWidget(ctx)
      else ctx.ui.setWidget('pi-dash', undefined)
      ctx.ui.notify(state.enabled ? 'Dashboard ON' : 'Dashboard OFF', 'info')
    },
  })
}
