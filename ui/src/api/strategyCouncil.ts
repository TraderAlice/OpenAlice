import type { EventLogEntry } from './types'

// ==================== Types ====================

export type VerdictLabel =
  | 'bullish' | 'bearish' | 'neutral'
  | 'long' | 'short' | 'hold'
  | 'allow' | 'reduce' | 'block'

export type FinalAction = 'long' | 'short' | 'hold' | 'blocked'

export interface RoleVerdict {
  role: 'trend' | 'signal' | 'risk'
  verdict: VerdictLabel
  confidence: number
  reasoning: string
  symbols?: string[]
  positionFactor?: number
  rawText: string
  elapsedMs: number
  parseError?: string
}

export interface StrategyDecision {
  id: string
  timestamp: string
  input: string
  verdicts: RoleVerdict[]
  finalAction: FinalAction
  rationale: string
  positionFactor: number
  elapsedMs: number
}

export interface RolePreview {
  name: 'trend' | 'signal' | 'risk'
  label: string
  allowedToolGroups: string[]
  extraDisabledTools: string[]
  systemPromptPreview: string
}

// ==================== API ====================

export const strategyCouncilApi = {
  async deliberate(
    input: string,
    profileByRole?: Record<string, string>,
  ): Promise<StrategyDecision> {
    const res = await fetch('/api/strategy-council/deliberate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input, profileByRole }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error(err.error || 'Deliberation failed')
    }
    const json = await res.json()
    return json.decision as StrategyDecision
  },

  async recent(limit = 50): Promise<EventLogEntry[]> {
    const res = await fetch(`/api/strategy-council/recent?limit=${limit}`)
    if (!res.ok) throw new Error('Failed to load recent decisions')
    const json = await res.json()
    return json.entries as EventLogEntry[]
  },

  async roles(): Promise<RolePreview[]> {
    const res = await fetch('/api/strategy-council/roles')
    if (!res.ok) throw new Error('Failed to load roles')
    const json = await res.json()
    return json.roles as RolePreview[]
  },

  connectSSE(onEvent: (entry: EventLogEntry) => void): EventSource {
    const es = new EventSource('/api/strategy-council/stream')
    es.onmessage = (event) => {
      try {
        onEvent(JSON.parse(event.data))
      } catch { /* ignore */ }
    }
    return es
  },
}
