/**
 * EventLog — chronological list of every action driven through `run()`.
 *
 * Client-side ring buffer (capped in the hook). Newest first. Default
 * collapsed-to-5; toggle to expand. ok/err coloring; error detail
 * expands inline on hover so the row stays terse.
 */

import { useState } from 'react'
import { Section } from '../../components/form'
import { formatRelativeTime } from '../../lib/intl'
import type { SimulatorEvent } from './useSimulatorState'

const COLLAPSED_COUNT = 5

function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.toTimeString().slice(0, 8)
}

export function EventLog({ events }: { events: SimulatorEvent[] }) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? events : events.slice(0, COLLAPSED_COUNT)

  return (
    <Section
      title="Event Log"
      description="Every simulator action issued through this panel, newest first. Useful for retracing steps after a surprising state change."
    >
      {events.length === 0 ? (
        <p className="text-xs text-muted-foreground">No actions yet.</p>
      ) : (
        <>
          <table className="w-full text-sm">
            <tbody>
              {visible.map((ev) => (
                <tr key={ev.id} className="text-foreground">
                  <td className="py-0.5 pr-3 font-mono text-[11px] text-muted-foreground/80 w-20">{formatTime(ev.ts)}</td>
                  <td className="py-0.5 pr-3 text-muted-foreground/60 text-[11px] w-20">{formatRelativeTime(ev.ts)}</td>
                  <td className="py-0.5 pr-3">
                    <span className={ev.status === 'err' ? 'text-destructive' : 'text-foreground'}>{ev.label}</span>
                    {ev.detail && (
                      <span className="ml-2 text-[11px] text-destructive/80" title={ev.detail}>
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
              className="mt-2 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              {expanded ? `Collapse (${COLLAPSED_COUNT})` : `Show all (${events.length})`}
            </button>
          )}
        </>
      )}
    </Section>
  )
}
