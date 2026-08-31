import { useEffect, useRef, useState } from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'

import type { ScheduleWhen } from '../api/schedule'
import { useIssueDetail } from '../hooks/useIssueDetail'
import { formatRelativeTime, getIntlLocale } from '../lib/intl'
import type {
  OfficeCadenceDutyCandidate,
  OfficeDutySourceStatus,
} from './duty-registry'
import { officeScheduledIssueFingerprint } from './duty-registry'
import { officePixelImg } from './furniture'
import { OFFICE_HUD_ASSETS } from './hud-assets'
import { OFFICE_LOG_ASSETS } from './log-assets'
import { OfficeWindowControlGlyph } from './OfficeWindowControlGlyph'
import { trapOfficeDialogTab } from './office-dialog-focus'

function scheduleLabel(when: ScheduleWhen, t: TFunction): string {
  switch (when.kind) {
    case 'at': {
      const time = new Date(when.at)
      return Number.isNaN(time.getTime())
        ? when.at
        : new Intl.DateTimeFormat(getIntlLocale(), {
            dateStyle: 'medium',
            timeStyle: 'short',
          }).format(time)
    }
    case 'every':
      return t('office.cadenceEvery', { cadence: when.every })
    case 'cron':
      return [
        when.cron,
        when.timezone ?? t('issues.cadence.localTime'),
        when.catchUp === false ? t('issues.cadence.calendarOnly') : t('issues.cadence.catchUp'),
      ].join(' · ')
  }
}

function localizedHealthMessage(message: string, t: TFunction): string {
  const deterministic = {
    'Assigned Session does not exist. Choose an active Session or @new-each-run.': t('issues.detail.healthMessage.missingSession'),
    'Assigned Session is retired. Reassign the Issue before its next run.': t('issues.detail.healthMessage.retiredSession'),
    'Assigned Session is deleted. Reassign the Issue before its next run.': t('office.cadenceDeletedSession'),
    'Assigned Session has no resumable runtime conversation yet.': t('issues.detail.healthMessage.unboundSession'),
    'Schedule has no future fire. Check its expression and timestamp.': t('issues.detail.healthMessage.noFutureRun'),
    'OpenAlice stopped while this run was active. It was not automatically retried.': t('office.cadenceInterruptedDefault'),
    'OpenAlice stopped while the latest scheduled run was active. It was not automatically retried.': t('office.cadenceInterruptedDefault'),
    'Latest scheduled run failed. Inspect its Runs entry, then retry when ready.': t('office.cadenceFailedDefault'),
    'Latest scheduled run failed.': t('office.cadenceFailedDefault'),
  } as Record<string, string>
  return deterministic[message] ?? message
}

function runStatusLabel(status: string, t: TFunction): string {
  switch (status) {
    case 'running': return t('issues.detail.runStatus.running')
    case 'done': return t('issues.detail.runStatus.done')
    case 'failed': return t('issues.detail.runStatus.failed')
    case 'interrupted': return t('issues.detail.runStatus.interrupted')
    default: return status
  }
}

function timeLabel(value: number | null | undefined, empty: string): string {
  return value == null ? empty : formatRelativeTime(value)
}

function isCadenceException(state: string | undefined): state is 'blocked' | 'failed' | 'interrupted' {
  return state === 'blocked' || state === 'failed' || state === 'interrupted'
}

function OfficeCadenceEvidence({
  duty,
  changed,
  resolved,
  stale,
  onBack,
  onOpenIssue,
  onConfirm,
  onReviewLatest,
  onContinue,
}: {
  duty: OfficeCadenceDutyCandidate
  changed: boolean
  resolved: boolean
  stale: boolean
  onBack: () => void
  onOpenIssue: () => void
  onConfirm: () => void
  onReviewLatest?: () => void
  onContinue: () => void
}) {
  const { t } = useTranslation()
  const evidenceHeadingRef = useRef<HTMLHeadingElement>(null)
  const [objectiveExpanded, setObjectiveExpanded] = useState(false)
  const { data, error, loading } = useIssueDetail(
    duty.destination.workspaceId,
    duty.destination.issueId,
  )
  useEffect(() => {
    evidenceHeadingRef.current?.focus({ preventScroll: true })
  }, [])
  const taskId = duty.cadence.health.state === 'blocked'
    ? undefined
    : duty.cadence.health.latestTaskId
  const latestRun = taskId ? data?.runs.find((run) => run.taskId === taskId) ?? null : null
  const detailHealthState = data?.issue.automationHealth?.state
  const detailIsException = isCadenceException(detailHealthState) && Boolean(data?.issue.when)
  const detailFingerprint = data && detailIsException && data.issue.when
    ? officeScheduledIssueFingerprint(Date.now(), duty.destination.workspaceId, {
        id: data.issue.id,
        assignee: data.issue.assignee,
        when: data.issue.when,
        automationHealth: data.issue.automationHealth,
        lastFiredAtMs: data.issue.lastFiredAtMs,
        nextDueAtMs: data.issue.nextDueAtMs,
      })
    : null
  const detailChanged = Boolean(data && detailIsException
    && detailFingerprint !== duty.receipt.fingerprint)
  const detailResolved = Boolean(data && !detailIsException)
  const evidenceResolved = resolved || detailResolved
  const evidenceChanged = !evidenceResolved && (changed || detailChanged)
  const canStamp = Boolean(data)
    && !error
    && !stale
    && !evidenceChanged
    && !evidenceResolved
  const evidenceMessage = localizedHealthMessage(duty.cadence.health.state === 'blocked'
    ? duty.cadence.health.message
    : latestRun?.failure?.message
      ?? latestRun?.error
      ?? latestRun?.output?.assistantPreview
      ?? duty.cadence.health.message, t)

  return (
    <div className="oa-office-cadence__panel" data-step="evidence">
      <h2
        ref={evidenceHeadingRef}
        className="oa-office-cadence__step"
        tabIndex={-1}
        aria-label={t('office.cadenceStepEvidence')}
      >
        <span>02</span>
        <strong>{t('office.cadenceEvidence')}</strong>
      </h2>
      <span id="office-cadence-title" className="sr-only">{duty.cadence.title}</span>
      <span id="office-cadence-description" className="sr-only">
        {localizedHealthMessage(duty.cadence.health.message, t)}
      </span>

      {stale && (
        <p className="oa-office-cadence__notice" data-tone="warning" role="status">
          {t('office.cadenceSignalStale')}
        </p>
      )}
      {evidenceChanged && (
        <p className="oa-office-cadence__notice" data-tone="warning" role="alert">
          {t('office.cadenceEvidenceChanged')}
        </p>
      )}
      {evidenceResolved && (
        <p className="oa-office-cadence__notice" data-tone="success" role="status">
          {t('office.cadenceResolved')}
        </p>
      )}
      {loading && (
        <p className="oa-office-cadence__loading" role="status" aria-live="polite">
          {t('office.cadenceLoadingEvidence')}
        </p>
      )}
      {error && (
        <p className="oa-office-cadence__notice" data-tone="warning" role="alert">{error}</p>
      )}

      {data && (
        <div className="oa-office-cadence__evidence">
          <div className="oa-office-cadence__evidence-head">
            <img src={latestRun ? OFFICE_LOG_ASSETS.alert : OFFICE_HUD_ASSETS.drawerRecord} alt="" aria-hidden style={officePixelImg} />
            <div>
              <span>{latestRun
                ? t('office.cadenceRunEvidence')
                : t('office.cadenceScheduleEvidence')}</span>
              <strong>{latestRun?.failure?.title
                ?? (latestRun
                  ? `${latestRun.agent} · ${runStatusLabel(latestRun.status, t)}`
                  : duty.cadence.assignee)}</strong>
            </div>
          </div>
          <p>{evidenceMessage}</p>
          {data.issue.what && (() => {
            const collapsible = data.issue.what.length > 320
            return (
              <div
                className="oa-office-cadence__objective"
                data-collapsible={collapsible || undefined}
                data-expanded={objectiveExpanded || undefined}
              >
                <span>{t('issues.detail.what')}</span>
                <p>{data.issue.what}</p>
                {collapsible && (
                  <button type="button" onClick={() => setObjectiveExpanded((current) => !current)}>
                    {t(objectiveExpanded
                      ? 'office.cadenceCollapseObjective'
                      : 'office.cadenceExpandObjective')}
                  </button>
                )}
              </div>
            )
          })()}
          <dl>
            <div>
              <dt>{t('office.cadenceTask')}</dt>
              <dd>{taskId ?? t('office.cadenceNoRun')}</dd>
            </div>
            <div>
              <dt>{t('office.cadenceIssueStatus')}</dt>
              <dd>{t(`issues.status.${data.issue.status}`)}</dd>
            </div>
            {latestRun && (
              <div>
                <dt>{t('office.cadenceRuntime')}</dt>
                <dd>{latestRun.agent} · {runStatusLabel(latestRun.status, t)}</dd>
              </div>
            )}
          </dl>
        </div>
      )}

      {!evidenceChanged && !evidenceResolved && (
        <p className="oa-office-cadence__receipt-note">
          {t('office.cadenceReceiptNote', {
            state: t(`issues.health.${duty.cadence.health.state}`),
          })}
        </p>
      )}

      <div className="oa-office-cadence__actions">
        <button type="button" className="oa-office-cadence__back" onClick={onBack}>
          {t('office.cadenceBack')}
        </button>
        <button type="button" className="oa-office-cadence__open" onClick={onOpenIssue}>
          <img src={OFFICE_HUD_ASSETS.sessionPortal} alt="" aria-hidden style={officePixelImg} />
          {t('office.cadenceOpenIssue')}
        </button>
        {evidenceResolved ? (
          <button type="button" className="oa-office-cadence__stamp" onClick={onContinue}>
            {t('office.cadenceContinue')}
          </button>
        ) : evidenceChanged && onReviewLatest ? (
          <button type="button" className="oa-office-cadence__stamp" onClick={onReviewLatest}>
            {t('office.cadenceReviewLatest')}
          </button>
        ) : (
          <button
            type="button"
            className="oa-office-cadence__stamp"
            disabled={!canStamp}
            onClick={onConfirm}
          >
            {t('office.cadenceStamp')}
          </button>
        )}
      </div>
    </div>
  )
}

export function OfficeCadenceDutyDossier({
  duty,
  latestDuty,
  sourceStatus,
  initialStep = 'exception',
  onOpenIssue,
  onConfirm,
  onReviewLatest,
  onClose,
  onLater = onClose,
}: {
  duty: OfficeCadenceDutyCandidate
  latestDuty: OfficeCadenceDutyCandidate | null
  sourceStatus: OfficeDutySourceStatus
  initialStep?: 'exception' | 'evidence'
  onOpenIssue: () => void
  onConfirm: () => void
  onReviewLatest: (duty: OfficeCadenceDutyCandidate) => void
  onLater?: () => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [step, setStep] = useState<'exception' | 'evidence'>(initialStep)
  const exceptionHeadingRef = useRef<HTMLHeadingElement>(null)
  const changed = Boolean(latestDuty
    && latestDuty.receipt.fingerprint !== duty.receipt.fingerprint)
  const resolved = !latestDuty && sourceStatus === 'ready'
  const stale = sourceStatus === 'error'
  useEffect(() => {
    if (step === 'exception') exceptionHeadingRef.current?.focus({ preventScroll: true })
  }, [step])

  return (
    <section
      role="dialog"
      aria-modal="true"
      aria-labelledby="office-cadence-title"
      aria-describedby="office-cadence-description"
      data-testid="office-cadence-duty"
      className="oa-office-window oa-office-cadence"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          if (step === 'evidence') setStep('exception')
          else onClose()
          return
        }
        if (event.key === 'Tab') trapOfficeDialogTab(event)
      }}
    >
      <header className="oa-office-window__header">
        <div className="oa-office-window__title">
          <img src={OFFICE_LOG_ASSETS.alert} alt="" aria-hidden style={officePixelImg} />
          <span className="oa-office-window__title-copy">
            <span className="oa-office-window__title-room">{t('office.cadenceReview')}</span>
            <span className="oa-office-window__title-separator" aria-hidden>·</span>
            <span className="oa-office-window__title-kind">{step === 'exception' ? '01' : '02'}</span>
          </span>
        </div>
        <button type="button" aria-label={t('common.close')} onClick={onClose}>
          <OfficeWindowControlGlyph kind="close" />
        </button>
      </header>

      {step === 'exception' ? (
        <div className="oa-office-cadence__panel" data-step="exception">
          <h2
            ref={exceptionHeadingRef}
            className="oa-office-cadence__step"
            tabIndex={-1}
            aria-label={t('office.cadenceStepException')}
          >
            <span>01</span>
            <strong>{t('office.cadenceException')}</strong>
          </h2>
          <div className="oa-office-cadence__subject">
            <span
              className="oa-office-cadence__health"
              data-state={duty.cadence.health.state}
            >
              <i aria-hidden />
              {t(`issues.health.${duty.cadence.health.state}`)}
            </span>
            <h2 id="office-cadence-title">{duty.cadence.title}</h2>
            <p id="office-cadence-description">
              {localizedHealthMessage(duty.cadence.health.message, t)}
            </p>
          </div>
          <dl className="oa-office-cadence__facts">
            <div>
              <dt>{t('office.cadenceWorkspace')}</dt>
              <dd>{duty.cadence.workspaceTag}</dd>
            </div>
            <div>
              <dt>{t('office.cadenceAssignee')}</dt>
              <dd>{duty.cadence.assignee}</dd>
            </div>
            <div>
              <dt>{t('office.cadenceSchedule')}</dt>
              <dd>{scheduleLabel(duty.cadence.when, t)}</dd>
            </div>
            <div>
              <dt>{t('office.cadenceLastRun')}</dt>
              <dd>{timeLabel(duty.cadence.lastFiredAtMs, t('office.cadenceNever'))}</dd>
            </div>
            <div>
              <dt>{t('office.cadenceNextDue')}</dt>
              <dd>{timeLabel(duty.cadence.nextDueAtMs, t('office.cadenceNone'))}</dd>
            </div>
          </dl>
          {stale && (
            <p className="oa-office-cadence__notice" data-tone="warning" role="status">
              {t('office.cadenceSignalStale')}
            </p>
          )}
          <div className="oa-office-cadence__actions oa-office-cadence__actions--entry">
            <button type="button" className="oa-office-cadence__back" onClick={onLater}>
              {t('office.inboxBacklogLater')}
            </button>
            <button
              type="button"
              className="oa-office-cadence__review"
              onClick={() => setStep('evidence')}
            >
              <img src={OFFICE_HUD_ASSETS.occupancyLog} alt="" aria-hidden style={officePixelImg} />
              {t('office.cadenceReviewEvidence')}
            </button>
          </div>
        </div>
      ) : (
        <OfficeCadenceEvidence
          duty={duty}
          changed={changed}
          resolved={resolved}
          stale={stale}
          onBack={() => setStep('exception')}
          onOpenIssue={onOpenIssue}
          onConfirm={onConfirm}
          onReviewLatest={changed && latestDuty
            ? () => onReviewLatest(latestDuty)
            : undefined}
          onContinue={onClose}
        />
      )}
    </section>
  )
}
