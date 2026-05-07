/**
 * Simulator dev tab — manual control panel for MockBroker UTAs.
 *
 * Layout:
 *   ┌─ Top bar ───────────────────────────────────────────────┐
 *   │ [Sim 1][Sim 2][+ New]              Cash: $X    Refresh  │
 *   ├─────────────────────────────────────────────────────────┤
 *   │ [ Mark Prices ]   [ Positions ]                         │  observation
 *   │ [ Pending Orders ]                                      │  (read-only)
 *   ├─────────────────────────────────────────────────────────┤
 *   │ [ ActionPanel — sticky bottom dock with tabbed actions ]│  control
 *   ├─────────────────────────────────────────────────────────┤
 *   │ [ Event Log ]                                           │  history
 *   └─────────────────────────────────────────────────────────┘
 *
 * Observation lives above; controls dock at the bottom (sticky); event
 * log at the very bottom for audit. Mark Prices ↔ Positions are
 * deliberately side-by-side so price→PnL feedback is one glance.
 */

import { useCallback } from 'react'
import { Spinner, EmptyState } from '../components/StateViews'
import { useSimulatorState } from './simulator/useSimulatorState'
import { CreateSimulatorSection } from './simulator/CreateSimulatorSection'
import { MarkPrices } from './simulator/MarkPrices'
import { Positions } from './simulator/Positions'
import { PendingOrders } from './simulator/PendingOrders'
import { ActionPanel } from './simulator/ActionPanel'
import { EventLog } from './simulator/EventLog'

export function SimulatorPage() {
  const sim = useSimulatorState()

  const onCreated = useCallback(async (newId: string) => {
    const list = await sim.refreshUtaList()
    if (list.some(u => u.id === newId)) sim.setSelectedId(newId)
  }, [sim])

  return (
    <div className="px-4 md:px-6 py-5 max-w-[1200px] space-y-5">
      <TopBar
        utas={sim.utas}
        selectedId={sim.selectedId}
        onSelect={sim.setSelectedId}
        cash={sim.state?.cash}
        onRefresh={sim.refresh}
      />

      <CreateSimulatorSection onCreated={onCreated} />

      {sim.utas.length === 0 ? (
        <EmptyState
          title="No simulator account yet."
          description='Click "+ New simulator account" to create one. Each sim is a fresh in-memory MockBroker UTA — wiped on dev server restart.'
        />
      ) : !sim.selectedId ? null : !sim.state ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : (
        <>
          {/* Observation row: prices + positions side-by-side. */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
            <MarkPrices utaId={sim.selectedId} state={sim.state} run={sim.run} loading={sim.loading} />
            <Positions state={sim.state} />
          </div>

          <PendingOrders utaId={sim.selectedId} state={sim.state} run={sim.run} loading={sim.loading} />

          <ActionPanel utaId={sim.selectedId} state={sim.state} run={sim.run} loading={sim.loading} />

          <EventLog events={sim.events} />
        </>
      )}
    </div>
  )
}

// ==================== Top Bar ====================

function TopBar({ utas, selectedId, onSelect, cash, onRefresh }: {
  utas: ReturnType<typeof useSimulatorState>['utas']
  selectedId: string
  onSelect: (id: string) => void
  cash: string | undefined
  onRefresh: () => void
}) {
  if (utas.length === 0) {
    return null
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-1 flex-wrap" role="tablist" aria-label="Simulator accounts">
        {utas.map((u) => {
          const active = u.id === selectedId
          return (
            <button
              key={u.id}
              role="tab"
              aria-selected={active}
              onClick={() => onSelect(u.id)}
              title={u.id}
              className={`px-2.5 py-1 text-sm rounded transition-colors ${
                active
                  ? 'bg-accent/15 text-accent font-medium border border-accent/30'
                  : 'text-text-muted hover:text-text border border-transparent hover:bg-bg-tertiary/50'
              }`}
            >
              {u.label}
            </button>
          )
        })}
      </div>

      <button
        onClick={onRefresh}
        className="px-2.5 py-1 text-xs bg-bg-tertiary text-text-muted rounded hover:text-text transition-colors"
      >
        Refresh
      </button>

      {cash !== undefined && (
        <span className="ml-auto text-[12px] text-text-muted uppercase tracking-wide">
          Cash <span className="font-mono text-text text-sm normal-case ml-1.5">
            ${Number(cash).toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </span>
        </span>
      )}
    </div>
  )
}
