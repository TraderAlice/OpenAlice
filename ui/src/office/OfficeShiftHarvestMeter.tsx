import type { OfficeShiftState } from './useOfficeShift'

const OFFICE_SHIFT_SLOT_LIMIT = 4

function boundedSlotCount(value: number, maximum: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(maximum, Math.max(0, Math.trunc(value)))
}

export function OfficeShiftHarvestMeter({
  total,
  completed,
  state,
  acknowledgementToken,
  reducedMotion = false,
  variant,
}: {
  total: number
  completed: number
  state: OfficeShiftState
  acknowledgementToken?: number | undefined
  reducedMotion?: boolean
  variant: 'hud' | 'board' | 'ledger'
}) {
  const visibleTotal = boundedSlotCount(total, OFFICE_SHIFT_SLOT_LIMIT)
  if (visibleTotal === 0) return null

  const visibleCompleted = boundedSlotCount(completed, visibleTotal)

  return (
    <span
      className={`oa-office-shift-harvest oa-office-shift-harvest--${variant}`}
      data-testid={`office-shift-harvest-${variant}`}
      data-state={state}
      data-total={visibleTotal}
      data-completed={visibleCompleted}
      data-reduced-motion={reducedMotion || undefined}
      aria-hidden="true"
    >
      {Array.from({ length: visibleTotal }, (_, index) => {
        const slotState = index < visibleCompleted
          ? 'completed'
          : index === visibleCompleted && state === 'active'
            ? 'current'
            : index === visibleCompleted && (state === 'planning' || state === 'degraded')
              ? 'unknown'
              : 'pending'
        const acknowledged = acknowledgementToken != null
          && index === visibleCompleted - 1

        return (
          <i
            key={acknowledged ? `${index}:${acknowledgementToken}` : index}
            className="oa-office-shift-harvest__slot"
            data-slot-state={slotState}
            data-acknowledged={acknowledged || undefined}
          />
        )
      })}
    </span>
  )
}
