import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { formatRelativeTime } from '../lib/intl'
import type {
  OfficeDutyAcknowledgementResult,
  OfficeDutySourceStatus,
  OfficeInboxDutyCandidate,
} from './duty-registry'
import { OFFICE_FURNITURE, officePixelImg } from './furniture'
import { OFFICE_HUD_ASSETS } from './hud-assets'
import { trapOfficeDialogTab } from './office-dialog-focus'
import { OfficeWindowControlGlyph } from './OfficeWindowControlGlyph'

function fileName(path: string): string {
  return path.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? path
}

export function OfficeInboxDutyDossier({
  duty,
  latestDuty,
  currentBacklogCount,
  sourceStatus,
  followUpSourceStatus = 'loading',
  issueSourceStatus = 'loading',
  carrySaved = false,
  onOpenInbox,
  onCarry,
  onCarried,
  onConfirm,
  onConfirmed,
  onContinue,
  onClose,
  onLater = onClose,
}: {
  duty: OfficeInboxDutyCandidate
  latestDuty: OfficeInboxDutyCandidate | null
  currentBacklogCount: number | null
  sourceStatus: OfficeDutySourceStatus
  /** Readiness of the durable Decision Desk sidecar. */
  followUpSourceStatus?: OfficeDutySourceStatus
  /** Readiness of the live Scheduled-Issue projection used to authorize a fresh carry. */
  issueSourceStatus?: OfficeDutySourceStatus
  /** The durable decision carry already exists, but this exact Inbox receipt may still be pending. */
  carrySaved?: boolean
  onOpenInbox: (duty: OfficeInboxDutyCandidate) => void
  onCarry: () => Promise<OfficeDutyAcknowledgementResult>
  onCarried: () => void
  onConfirm: () => Promise<OfficeDutyAcknowledgementResult>
  onConfirmed: () => void
  onContinue: () => void
  onLater?: () => void | Promise<void>
  onClose: () => void
}) {
  const { t } = useTranslation()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const carryRef = useRef<HTMLButtonElement>(null)
  const [submittingAction, setSubmittingAction] = useState<'carry' | 'confirm' | 'later' | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const submitting = submittingAction !== null
  const changed = Boolean(latestDuty
    && latestDuty.receipt.fingerprint !== duty.receipt.fingerprint)
  const resolved = !latestDuty && sourceStatus === 'ready'
  const sourceReady = sourceStatus === 'ready'
  const backlogCount = currentBacklogCount ?? duty.count
  const documents = duty.delivery.entry.docs ?? []
  const visibleDocuments = documents.slice(0, 4)
  // The durable Inbox row is the captured review subject, while Scheduled
  // Issue metadata is live control-plane data. Reuse the latest safe join for
  // the same row so a deleted or re-homed Issue cannot leave a stale route in
  // the decision menu.
  const capturedRoutine = duty.delivery.declaredIssue
  const matchingLatestDuty = latestDuty?.receipt.fingerprint === duty.receipt.fingerprint
    ? latestDuty
    : null
  const routine = matchingLatestDuty
    ? matchingLatestDuty.delivery.declaredIssue
      ?? (carrySaved || issueSourceStatus !== 'ready' ? capturedRoutine : undefined)
    : capturedRoutine
  const followUpSourceReady = followUpSourceStatus === 'ready'
  const issueSourceReady = issueSourceStatus === 'ready'
  const [decisionOpen, setDecisionOpen] = useState(false)
  const showDecision = Boolean((routine || carrySaved) && decisionOpen && !changed && !resolved)
  const routineNextRun = routine
    ? routine.nextDueAtMs == null
      ? t('office.routineNextRunNone')
      : formatRelativeTime(routine.nextDueAtMs)
    : null

  useEffect(() => {
    if (showDecision && carryRef.current && !carryRef.current.disabled) {
      carryRef.current.focus({ preventScroll: true })
      return
    }
    headingRef.current?.focus({ preventScroll: true })
  }, [showDecision])

  const carry = async () => {
    if (submitting
      || (!routine && !carrySaved)
      || !sourceReady
      || !followUpSourceReady
      || (!carrySaved && !issueSourceReady)
      || changed
      || resolved) return
    setSubmittingAction('carry')
    setSubmitError(null)
    try {
      // The caller persists the carry before writing the exact Inbox receipt.
      // Even if another tab won that receipt race, the Decision Desk item now
      // exists and must be announced instead of being treated as a plain skip.
      await onCarry()
      onCarried()
    } catch {
      setSubmittingAction(null)
      setSubmitError(t('office.routineCarryFailed'))
    }
  }

  const confirm = async () => {
    if (submitting
      || !sourceReady
      || carrySaved
      || changed
      || resolved) return
    setSubmittingAction('confirm')
    setSubmitError(null)
    try {
      const result = await onConfirm()
      if (result === 'already-resolved') onContinue()
      else onConfirmed()
    } catch {
      setSubmittingAction(null)
      setSubmitError(t('office.inboxBacklogSaveFailed'))
    }
  }

  const later = async () => {
    if (submitting) return
    setSubmittingAction('later')
    setSubmitError(null)
    try {
      await onLater()
      setSubmittingAction(null)
    } catch {
      setSubmittingAction(null)
      setSubmitError(t('office.inboxBacklogSaveFailed'))
    }
  }

  return (
    <section
      role="dialog"
      aria-modal="true"
      aria-labelledby="office-inbox-duty-title"
      aria-describedby="office-inbox-duty-description"
      data-testid="office-inbox-duty"
      data-source-status={sourceStatus}
      aria-busy={submitting || undefined}
      className="oa-office-window oa-office-cadence oa-office-inbox-duty"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          if (!submitting) {
            if (showDecision) setDecisionOpen(false)
            else onClose()
          }
          return
        }
        if (event.key === 'Tab') trapOfficeDialogTab(event)
      }}
    >
      <header className="oa-office-window__header">
        <div className="oa-office-window__title">
          <img src={OFFICE_FURNITURE.generated.inboxTerminal} alt="" aria-hidden style={officePixelImg} />
          <span className="oa-office-window__title-copy">
            <span className="oa-office-window__title-room">{t('office.inboxBacklogReview')}</span>
            <span className="oa-office-window__title-separator" aria-hidden>·</span>
            <span className="oa-office-window__title-kind">02</span>
          </span>
        </div>
        <button
          type="button"
          aria-label={t('common.close')}
          disabled={submitting}
          onClick={() => onClose()}
        >
          <OfficeWindowControlGlyph kind="close" />
        </button>
      </header>

      <div className="oa-office-cadence__panel">
        <h2
          ref={headingRef}
          className="oa-office-cadence__step"
          tabIndex={-1}
          aria-label={t(showDecision
            ? 'office.routineDecisionStep'
            : 'office.inboxBacklogConfirmStep')}
        >
          <span>{showDecision ? '03' : '02'}</span>
          <strong>{t(showDecision
            ? 'office.routineDecision'
            : 'office.inboxBacklogConfirm')}</strong>
        </h2>

        <div className="oa-office-cadence__subject">
          <span className="oa-office-inbox-duty__queue">
            <i aria-hidden />
            {t('office.inboxBacklogRemaining', { count: backlogCount })}
          </span>
          <h2 id="office-inbox-duty-title">{duty.delivery.title}</h2>
          <p id="office-inbox-duty-description">
            {duty.delivery.excerpt ?? t('office.inboxBacklogReturnHint')}
          </p>
        </div>

        {routine && (
          <section
            className="oa-office-inbox-duty__routine"
            aria-label={t('office.routineReportDetails')}
          >
            <header>
              <span>{t('office.routineReport')}</span>
              <div>
                <small>{t('office.routineScheduledIssue')}</small>
                <strong>{routine.title}</strong>
              </div>
            </header>
            <dl>
              <div>
                <dt>{t('office.routinePriority')}</dt>
                <dd>{t(`issues.priority.${routine.priority}`)}</dd>
              </div>
              <div>
                <dt>{t('office.routineNextRun')}</dt>
                <dd>{routineNextRun}</dd>
              </div>
            </dl>
            {routine.olderUnreadCount > 0 && (
              <p>{t('office.routineOlderUnread', { count: routine.olderUnreadCount })}</p>
            )}
          </section>
        )}

        <dl className="oa-office-cadence__facts">
          <div>
            <dt>{t('office.cadenceWorkspace')}</dt>
            <dd>{duty.delivery.entry.workspaceLabel ?? duty.delivery.entry.workspaceId}</dd>
          </div>
          <div>
            <dt>{t('office.inboxBacklogReceived')}</dt>
            <dd>{formatRelativeTime(duty.delivery.entry.ts)}</dd>
          </div>
          <div>
            <dt>{t('office.inboxBacklogDocuments')}</dt>
            <dd>{documents.length}</dd>
          </div>
        </dl>

        {documents.length > 0 && (
          <div className="oa-office-inbox-duty__documents">
            <span>{t('office.inboxBacklogDocuments')}</span>
            <ul>
              {visibleDocuments.map((document) => (
                <li key={`${document.path}:${document.revision ?? ''}`}>
                  <img src={OFFICE_HUD_ASSETS.drawerRecord} alt="" aria-hidden style={officePixelImg} />
                  <strong title={document.path}>{fileName(document.path)}</strong>
                  {document.revision && <small>{document.revision.slice(0, 8)}</small>}
                </li>
              ))}
            </ul>
            {documents.length > visibleDocuments.length && (
              <small>{t('office.inboxBacklogMoreDocuments', {
                count: documents.length - visibleDocuments.length,
              })}</small>
            )}
          </div>
        )}

        {sourceStatus !== 'ready' && (
          <p className="oa-office-cadence__notice" data-tone="warning" role="status">
            {t(sourceStatus === 'loading'
              ? 'office.dutySyncing'
              : 'office.inboxBacklogSignalLost')}
          </p>
        )}
        {routine && !carrySaved && !resolved && issueSourceStatus !== 'ready' && (
          <p className="oa-office-cadence__notice" data-tone="warning" role="status">
            {t(issueSourceStatus === 'loading'
              ? 'office.routineIssueSyncing'
              : 'office.routineIssueSignalLost')}
          </p>
        )}
        {(routine || carrySaved) && !resolved && followUpSourceStatus !== 'ready' && (
          <p className="oa-office-cadence__notice" data-tone="warning" role="status">
            {t(followUpSourceStatus === 'loading'
              ? 'office.routineFollowUpSyncing'
              : 'office.routineFollowUpSignalLost')}
          </p>
        )}
        {changed && (
          <p className="oa-office-cadence__notice" data-tone="warning" role="alert">
            {t('office.inboxBacklogChanged')}
          </p>
        )}
        {resolved && (
          <p className="oa-office-cadence__notice" data-tone="success" role="status">
            {t('office.inboxBacklogAlreadyRead')}
          </p>
        )}
        {carrySaved && !resolved && !changed && (
          <p className="oa-office-cadence__notice" data-tone="success" role="status">
            {t('office.routineCarrySaved')}
          </p>
        )}
        {submitError && (
          <p className="oa-office-cadence__notice" data-tone="warning" role="alert">
            {submitError}
          </p>
        )}

        {!resolved && !changed && (
          <p className="oa-office-cadence__receipt-note">
            {t(routine
              ? showDecision
                ? carrySaved
                  ? 'office.routineCarryRecoveryPrompt'
                  : 'office.routineDecisionPrompt'
                : 'office.routineDecisionSummaryHint'
              : 'office.inboxBacklogReceiptNote')}
          </p>
        )}

        <div className={`oa-office-cadence__actions${showDecision
          ? ' oa-office-cadence__actions--decision'
          : ''}`}>
          {showDecision ? (
            <>
              <button
                type="button"
                className="oa-office-cadence__back"
                disabled={submitting}
                onClick={() => setDecisionOpen(false)}
              >
                {t('office.routineDecisionBack')}
              </button>
              <button
                ref={carryRef}
                type="button"
                className="oa-office-cadence__open"
                disabled={!sourceReady
                  || !followUpSourceReady
                  || (!carrySaved && !issueSourceReady)
                  || submitting}
                onClick={() => void carry()}
              >
                <img src={OFFICE_HUD_ASSETS.sessionPortal} alt="" aria-hidden style={officePixelImg} />
                {submittingAction === 'carry'
                  ? t('office.routineCarrySaving')
                  : t(carrySaved
                    ? 'office.routineCarryFinish'
                    : 'office.routineCarryToDecisionDesk')}
              </button>
              {!carrySaved && (
                <button
                  type="button"
                  className="oa-office-cadence__stamp"
                  disabled={!sourceReady || submitting}
                  onClick={() => void confirm()}
                >
                  {submittingAction === 'confirm'
                    ? t('office.inboxBacklogSaving')
                    : t('office.routineNoChange')}
                </button>
              )}
            </>
          ) : (
            <>
              <button
                type="button"
                className="oa-office-cadence__back"
                disabled={submitting}
                onClick={() => void later()}
              >
                {t('office.inboxBacklogLater')}
              </button>
              <button
                type="button"
                className="oa-office-cadence__open"
                disabled={submitting}
                onClick={() => onOpenInbox(changed && latestDuty ? latestDuty : duty)}
              >
                <img src={OFFICE_HUD_ASSETS.sessionPortal} alt="" aria-hidden style={officePixelImg} />
                {t(changed
                  ? 'office.inboxBacklogOpenLatest'
                  : routine
                    ? 'office.routineOpenReport'
                    : 'office.inboxBacklogOpenAgain')}
              </button>
              {resolved ? (
                <button
                  type="button"
                  className="oa-office-cadence__stamp"
                  disabled={submitting}
                  onClick={onContinue}
                >
                  {t('office.cadenceContinue')}
                </button>
              ) : changed ? (
                <button
                  type="button"
                  className="oa-office-cadence__stamp"
                  disabled={submitting}
                  onClick={() => latestDuty && onOpenInbox(latestDuty)}
                >
                  {t('office.inboxBacklogOpenLatest')}
                </button>
              ) : routine ? (
                <button
                  type="button"
                  className="oa-office-cadence__stamp"
                  disabled={submitting}
                  onClick={() => setDecisionOpen(true)}
                >
                  {t(carrySaved
                    ? 'office.routineCarryFinish'
                    : 'office.routineDecideNextStep')}
                </button>
              ) : (
                <button
                  type="button"
                  className="oa-office-cadence__stamp"
                  disabled={!sourceReady || submitting}
                  onClick={() => void confirm()}
                >
                  {submittingAction === 'confirm'
                    ? t('office.inboxBacklogSaving')
                    : t('office.inboxBacklogStamp')}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  )
}
