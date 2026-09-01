import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

import type { OfficeDutySourceStatus } from './duty-registry'
import { OfficeShiftHarvestMeter } from './OfficeShiftHarvestMeter'
import { useReducedMotion } from './use-reduced-motion'

export type OfficeShiftCloseoutState = 'complete' | 'clear'
export type OfficeShiftCloseoutStartNextStatus = 'idle' | 'pending' | 'error'

export interface OfficeShiftCloseoutProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  state: OfficeShiftCloseoutState
  sourceStatus: OfficeDutySourceStatus
  total: number
  completed: number
  maintainCount: number
  reviseCount: number
  evidenceUnavailableCount: number
  pendingDecisionCount: number
  cadenceFollowUpCount: number
  backlogCount: number
  canStartNext: boolean
  startNextStatus: OfficeShiftCloseoutStartNextStatus
  onFinish: () => void
  onReviewDecisions?: () => void
  onOpenCadenceFollowUp?: () => void
  onStartNext?: () => void
}

function safeCount(value: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : 0
}

/**
 * A presentation-only ledger for one settled Office shift. Domain truth stays
 * in Office Day, Inbox, Issues, and the Decision Desk; this dialog only names
 * the state and routes the human to an explicit next action.
 */
export function OfficeShiftCloseout({
  open,
  onOpenChange,
  state,
  sourceStatus,
  total,
  completed,
  maintainCount,
  reviseCount,
  evidenceUnavailableCount,
  pendingDecisionCount,
  cadenceFollowUpCount,
  backlogCount,
  canStartNext,
  startNextStatus,
  onFinish,
  onReviewDecisions,
  onOpenCadenceFollowUp,
  onStartNext,
}: OfficeShiftCloseoutProps) {
  const { t } = useTranslation()
  const reducedMotion = useReducedMotion()
  const visibleTotal = safeCount(total)
  const visibleCompleted = Math.min(safeCount(completed), visibleTotal)
  const visibleMaintainCount = safeCount(maintainCount)
  const visibleReviseCount = safeCount(reviseCount)
  const visibleEvidenceUnavailableCount = safeCount(evidenceUnavailableCount)
  const visiblePendingDecisionCount = safeCount(pendingDecisionCount)
  const visibleCadenceFollowUpCount = safeCount(cadenceFollowUpCount)
  const visibleBacklogCount = safeCount(backlogCount)
  const judgmentCount = visibleMaintainCount + visibleReviseCount
  const outstandingCount = visiblePendingDecisionCount
    + visibleCadenceFollowUpCount
    + visibleBacklogCount
  const hasOutstandingWork = outstandingCount > 0
  const sourceReady = sourceStatus === 'ready'
  const honestlyClear = state === 'clear' && sourceReady && !hasOutstandingWork
  const reviewDecisionsPrimary = visiblePendingDecisionCount > 0
    && Boolean(onReviewDecisions)
  const startingNext = startNextStatus === 'pending'

  const titleKey = sourceStatus === 'loading'
    ? 'office.dutySyncing'
    : sourceStatus === 'error'
      ? 'office.dutySignalInterrupted'
      : honestlyClear
        ? 'office.shiftCloseoutClear'
        : 'office.shiftCloseoutReady'
  const descriptionKey = sourceStatus === 'loading'
    ? 'office.shiftCloseoutSourcePendingHint'
    : sourceStatus === 'error'
      ? 'office.shiftCloseoutSourceErrorHint'
      : honestlyClear
        ? 'office.shiftCloseoutFinishedClear'
        : 'office.shiftCloseoutFinishedCarry'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="oa-office-shift-closeout h-[calc(100dvh-1rem)] max-h-[calc(100dvh-1rem)] min-w-0 max-w-[calc(100%-1rem)] grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:h-auto sm:max-h-[min(42rem,calc(100dvh-2rem))] sm:max-w-lg"
        overlayClassName="oa-office-shift-closeout__overlay"
        closeLabel={t('common.close')}
        data-state={state}
        data-source-status={sourceStatus}
        aria-busy={startingNext || undefined}
      >
        <DialogHeader className="oa-office-shift-closeout__header shrink-0 border-b border-border px-5 py-4 pr-12">
          <DialogTitle>{t(titleKey)}</DialogTitle>
          <DialogDescription>
            {t(descriptionKey)}
          </DialogDescription>
        </DialogHeader>

        <div className="oa-office-shift-closeout__body min-h-0 overflow-y-auto px-5 py-4">
          {sourceStatus !== 'ready' && (
            <p
              className="oa-office-shift-closeout__source-status mb-4 rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm"
              role={sourceStatus === 'error' ? 'alert' : 'status'}
            >
              {t(sourceStatus === 'error'
                ? 'office.shiftCloseoutSourceErrorHint'
                : 'office.shiftCloseoutSourcePendingHint')}
            </p>
          )}

          <section
            className="oa-office-shift-closeout__summary"
            aria-label={t('office.shiftCloseoutBoard')}
          >
            <dl className="oa-office-shift-closeout__metrics grid gap-3 sm:grid-cols-2">
              <div className="oa-office-shift-closeout__metric rounded-lg border border-border p-3">
                <dt className="text-xs font-medium text-muted-foreground">
                  {t('office.shiftCloseoutPatrolLabel')}
                </dt>
                <dd className="mt-1 text-base font-semibold tabular-nums">
                  {t('office.shiftCloseoutPatrolValue', {
                    completed: visibleCompleted,
                    total: visibleTotal,
                  })}
                </dd>
                <OfficeShiftHarvestMeter
                  total={visibleTotal}
                  completed={visibleCompleted}
                  state={state}
                  reducedMotion={reducedMotion}
                  variant="ledger"
                />
              </div>
              <div
                className="oa-office-shift-closeout__metric rounded-lg border border-border p-3"
                data-judgment-count={judgmentCount}
              >
                <dt className="text-xs font-medium text-muted-foreground">
                  {t('office.shiftCloseoutJudgmentLabel')}
                </dt>
                <dd className="mt-1 text-base font-semibold tabular-nums">
                  {t('office.shiftCloseoutJudgmentValue', { count: judgmentCount })}
                </dd>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>{t('office.shiftCloseoutMaintainCount', {
                    count: visibleMaintainCount,
                  })}</span>
                  <span>{t('office.shiftCloseoutReviseCount', {
                    count: visibleReviseCount,
                  })}</span>
                </div>
              </div>
            </dl>

            <div
              className="oa-office-shift-closeout__evidence-unavailable mt-3 rounded-lg border border-border p-3"
              data-evidence-unavailable-count={visibleEvidenceUnavailableCount}
            >
              <div className="flex items-baseline justify-between gap-3">
                <strong className="text-sm">
                  {t('office.shiftCloseoutEvidenceUnavailableLabel')}
                </strong>
                <span className="font-semibold tabular-nums">{visibleEvidenceUnavailableCount}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {t('office.shiftCloseoutEvidenceUnavailableHint')}
              </p>
            </div>
          </section>

          {hasOutstandingWork && (
            <section className="oa-office-shift-closeout__outstanding mt-5">
              <h3 className="text-sm font-semibold">{t('office.shiftCloseoutOutstandingTitle')}</h3>
              <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
                {visiblePendingDecisionCount > 0 && (
                  <li className="px-3 py-2">
                    {t('office.shiftCloseoutPendingDecisions', {
                      count: visiblePendingDecisionCount,
                    })}
                  </li>
                )}
                {visibleCadenceFollowUpCount > 0 && (
                  <li className="px-3 py-2">
                    {t('office.shiftCloseoutCadenceFollowUps', {
                      count: visibleCadenceFollowUpCount,
                    })}
                  </li>
                )}
                {visibleBacklogCount > 0 && (
                  <li className="px-3 py-2">
                    {t('office.shiftCloseoutBacklog', {
                      count: visibleBacklogCount,
                    })}
                  </li>
                )}
              </ul>
            </section>
          )}
        </div>

        <DialogFooter className="oa-office-shift-closeout__footer mx-0 mb-0 min-w-0 shrink-0 flex-col items-stretch rounded-none px-4 py-3 sm:flex-row sm:items-center sm:justify-end">
          {visibleCadenceFollowUpCount > 0 && onOpenCadenceFollowUp && (
            <Button type="button" variant="outline" onClick={onOpenCadenceFollowUp}>
              {t('office.cadenceFollowUpAction')}
            </Button>
          )}
          {canStartNext && onStartNext && (
            <Button
              type="button"
              variant="outline"
              disabled={startingNext}
              aria-busy={startingNext || undefined}
              onClick={onStartNext}
            >
              <span role={startNextStatus === 'idle' ? undefined : 'status'} aria-live="polite">
                {t(startNextStatus === 'pending'
                  ? 'office.startingNextShift'
                  : startNextStatus === 'error'
                    ? 'office.startNextShiftFailed'
                    : 'office.startNextShiftShort')}
              </span>
            </Button>
          )}
          <Button
            type="button"
            onClick={reviewDecisionsPrimary ? onReviewDecisions : onFinish}
          >
            {t(reviewDecisionsPrimary
              ? 'office.decisionDeskAction'
              : 'office.shiftCloseoutFinishForNow')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
