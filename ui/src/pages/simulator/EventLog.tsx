/**
 * EventLog — chronological list of every action driven through `run()`.
 *
 * Client-side ring buffer (capped in the hook). Newest first. Default
 * collapsed-to-5; toggle to expand. ok/err coloring; error detail
 * expands inline on hover so the row stays terse.
 */

import { useState } from 'react'
import { Section } from '../../components/form'
import type { SimulatorEvent } from './useSimulatorState'

const COLLAPSED_COUNT = 5

function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.toTimeString().slice(0, 8)
}

function relativeTime(ts: number, now: number): string {
  const sec = Math.max(0, Math.round((now - ts) / 1000))
  if (sec < 60) return `${sec}s ago`
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`
  return `${Math.round(sec / 3600)}h ago`
}

export function EventLog({ events }: { events: SimulatorEvent[] }) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? events : events.slice(0, COLLAPSED_COUNT)
  const now = Date.now()

  return (
    <Section
      title="Event Log"
      description="Every simulator action issued through this panel, newest first. Useful for retracing steps after a surprising state change."
    >
      {events.length === 0 ? (
        <p className="text-xs text-text-muted">No actions yet.</p>
      ) : (
        <>
          <table className="w-full text-sm">
            <tbody>
              {visible.map((ev) => (
                <tr key={ev.id} className="text-text">
                  <td className="py-0.5 pr-3 font-mono text-[11px] text-text-muted/80 w-20">{formatTime(ev.ts)}</td>
                  <td className="py-0.5 pr-3 text-text-muted/60 text-[11px] w-20">{relativeTime(ev.ts, now)}</td>
                  <td className="py-0.5 pr-3">
                    <span className={ev.status === 'err' ? 'text-red' : 'text-text'}>{ev.label}</span>
                    {ev.detail && (
                      <span className="ml-2 text-[11px] text-red/80" title={ev.detail}>
                        {ev.detail.slice(0, 60)}{ev.detail.length > 60 ? '…' : ''}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {events.length > COLLAPSED_COUNT && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="mt-2 text-[11px] text-text-muted hover:text-text transition-colors"
            >
              {expanded ? `Collapse (${COLLAPSED_COUNT})` : `Show all (${events.length})`}
            </button>
          )}
        </>
      )}
    </Section>
  )
}
