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
import { getIntlLocale } from '../lib/intl'
import { Spinner, EmptyState } from '../components/StateViews'
import { useSimulatorState } from './simulator/useSimulatorState'
import { CreateSimulatorSection } from './simulator/CreateSimulatorSection'
import { MarkPrices } from './simulator/MarkPrices'
import { Positions } from './simulator/Positions'
import { PendingOrders } from './simulator/PendingOrders'
import { ActionPanel } from './simulator/ActionPanel'
import { EventLog } from './simulator/EventLog'
import { Button } from '../components/ui/button'
import { SegmentedControl } from '../components/SegmentedControl'

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
          description="Create an in-memory MockBroker UTA to start a scenario."
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
      <SegmentedControl
        value={selectedId}
        options={utas.map((uta) => ({
          value: uta.id,
          label: uta.label,
          ariaLabel: `${uta.label}: ${uta.id}`,
        }))}
        onChange={onSelect}
        ariaLabel="Simulator accounts"
      />

      <Button
        onClick={onRefresh}
        variant="outline"
        size="sm"
      >
        Refresh
      </Button>

      {cash !== undefined && (
        <span className="ml-auto text-[12px] font-medium text-muted-foreground">
          Cash <span className="ml-1.5 font-mono text-sm text-foreground">
            ${Number(cash).toLocaleString(getIntlLocale(), { minimumFractionDigits: 2 })}
          </span>
        </span>
      )}
    </div>
  )
}
