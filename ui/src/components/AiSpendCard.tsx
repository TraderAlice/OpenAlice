import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import type { AiSpendStatus } from '../api/config'
import { Field, inputClass } from './form'

const usd = (cents: number) => `$${(Math.max(0, cents) / 100).toFixed(2)}`

/**
 * Daily AI-spend cap: today's spend vs the ceiling, plus editable ceiling ($)
 * and mode (block = hard stop at the ceiling, alert = never stop, just warn).
 * Backed by GET/PUT /api/config/ai-spend (admin-token gated like all /api/config).
 */
export function AiSpendCard() {
  const [status, setStatus] = useState<AiSpendStatus | null>(null)
  const [ceiling, setCeiling] = useState('')
  const [mode, setMode] = useState<'block' | 'alert'>('block')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const adopt = useCallback((s: AiSpendStatus) => {
    setStatus(s)
    setCeiling((s.ceilingCents / 100).toFixed(2))
    setMode(s.mode)
  }, [])

  useEffect(() => {
    api.config.getAiSpend().then(adopt).catch(() => setMsg({ ok: false, text: 'Could not load AI spend.' }))
  }, [adopt])

  const save = async () => {
    const dollars = Number(ceiling)
    if (!Number.isFinite(dollars) || dollars < 0) return setMsg({ ok: false, text: 'Ceiling must be a dollar amount of 0 or more.' })
    setBusy(true)
    try {
      adopt(await api.config.updateAiSpend({ ceilingDollars: dollars, mode }))
      setMsg({ ok: true, text: 'Saved.' })
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Save failed' })
    } finally {
      setBusy(false)
    }
  }

  if (!status) return <p className="text-sm text-text-muted">{msg ? msg.text : 'Loading…'}</p>

  const used = status.spentCents + status.reservedCents
  const pct = status.ceilingCents > 0 ? Math.min(100, Math.round((used / status.ceilingCents) * 100)) : 100
  const bar = status.level === 'over' ? 'bg-red' : status.level === 'approaching' ? 'bg-yellow-500' : 'bg-accent'

  return (
    <>
      <div className="mb-4">
        <div className="flex items-baseline justify-between text-sm">
          <span className="text-text font-medium">{usd(used)} of {usd(status.ceilingCents)} today</span>
          <span className="text-text-muted text-[12px]">{pct}% · resets midnight New York time</span>
        </div>
        <div className="h-2 mt-2 rounded-full bg-border/60 overflow-hidden">
          <div className={`h-full ${bar}`} style={{ width: `${pct}%` }} />
        </div>
        {status.hitAt && (
          <p className="text-[12px] text-red mt-2">
            Ceiling hit today{status.mode === 'block' ? ' - new AI calls are refused until it resets or is raised.' : '.'}
          </p>
        )}
      </div>
      <Field label="Daily ceiling (USD)">
        <input className={inputClass} type="number" min={0} step={1} value={ceiling} onChange={(e) => setCeiling(e.target.value)} />
      </Field>
      <Field label="When the ceiling is reached">
        <select className={inputClass} value={mode} onChange={(e) => setMode(e.target.value === 'alert' ? 'alert' : 'block')}>
          <option value="block">Block - refuse new AI calls (recommended)</option>
          <option value="alert">Alert only - keep running, just email</option>
        </select>
      </Field>
      <p className="text-[12px] text-text-muted mb-3 leading-relaxed">
        Covers key tests and headless/cron workspace runs (flat per-run estimate). Interactive terminal sessions are not metered.
        Email alerts at 80% and 100% need RESEND_API_KEY and AI_SPEND_ALERT_EMAIL_TO in the server environment.
      </p>
      <div className="flex items-center gap-3">
        <button onClick={save} disabled={busy} className="px-4 py-2 rounded-lg bg-accent text-bg text-sm font-medium disabled:opacity-50">
          {busy ? 'Saving…' : 'Save'}
        </button>
        {msg && <span className={`text-[12px] ${msg.ok ? 'text-text-muted' : 'text-red'}`}>{msg.text}</span>}
      </div>
    </>
  )
}
