import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { IssuePriority } from '../api/issues'
import type {
  OfficeRoutineDecisionInput,
  OfficeRoutineDecisionOutcome,
  OfficeRoutineFollowUp,
} from '../api/office'
import { formatRelativeTime } from '../lib/intl'
import type { OfficeDutySourceStatus } from './duty-registry'
import { OFFICE_FURNITURE, officePixelImg } from './furniture'
import { OFFICE_HUD_ASSETS } from './hud-assets'
import { trapOfficeDialogTab } from './office-dialog-focus'
import { OfficeWindowControlGlyph } from './OfficeWindowControlGlyph'

export type OfficeRoutineEvidenceState = 'available' | 'missing' | 'unknown'

export function classifyOfficeRoutineEvidence(
  sourceStatus: OfficeDutySourceStatus,
  exactEvidenceAvailable: boolean,
): OfficeRoutineEvidenceState {
  if (sourceStatus !== 'ready') return 'unknown'
  return exactEvidenceAvailable ? 'available' : 'missing'
}

export interface OfficeRoutineDecisionItem {
  readonly followUp: OfficeRoutineFollowUp
  readonly reportTitle: string
  readonly reportExcerpt?: string
  readonly reportWorkspaceLabel: string
  /** Unknown keeps source failure/loading distinct from an authoritative absence. */
  readonly reportState: OfficeRoutineEvidenceState
  readonly issueTitle: string
  readonly workspaceLabel: string
  readonly priority: IssuePriority | null
  /** Missing requires a successful source snapshot that does not contain the route. */
  readonly issueState: OfficeRoutineEvidenceState
}

const MAX_DECISION_NOTE_LENGTH = 280

export function OfficeRoutineDecisionDesk({
  items,
  sourceStatus,
  onOpenReport,
  onOpenIssue,
  onDecide,
  onClose,
}: {
  readonly items: readonly OfficeRoutineDecisionItem[]
  readonly sourceStatus: OfficeDutySourceStatus
  readonly onOpenReport: (item: OfficeRoutineDecisionItem) => void
  readonly onOpenIssue: (item: OfficeRoutineDecisionItem) => void
  readonly onDecide: (
    item: OfficeRoutineDecisionItem,
    decision: OfficeRoutineDecisionInput,
  ) => Promise<void>
  readonly onClose: () => void
}) {
  const { t } = useTranslation()
  const panelRef = useRef<HTMLDivElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const reviseButtonRef = useRef<HTMLButtonElement>(null)
  const noteRef = useRef<HTMLTextAreaElement>(null)
  const restoreReviseFocusRef = useRef(false)
  const [selectedId, setSelectedId] = useState<string | null>(
    () => items[0]?.followUp.inboxEntryId ?? null,
  )
  const [decisionMode, setDecisionMode] = useState<'choose' | 'revise'>('choose')
  const [revisionNote, setRevisionNote] = useState('')
  const [submittingOutcome, setSubmittingOutcome] = useState<OfficeRoutineDecisionOutcome | null>(null)
  const [decisionError, setDecisionError] = useState(false)
  const selectedIndex = Math.max(0, items.findIndex(
    (item) => item.followUp.inboxEntryId === selectedId,
  ))
  const current = items[selectedIndex] ?? null
  const submitting = submittingOutcome !== null
  const evidenceState: OfficeRoutineEvidenceState = !current
    || current.reportState === 'unknown'
    || current.issueState === 'unknown'
    ? 'unknown'
    : current.reportState === 'available' && current.issueState === 'available'
      ? 'available'
      : 'missing'
  const evidenceAvailable = evidenceState === 'available'
  const trimmedRevisionNote = revisionNote.trim()
  const revisionNoteValid = trimmedRevisionNote.length >= 1
    && trimmedRevisionNote.length <= MAX_DECISION_NOTE_LENGTH

  useEffect(() => {
    if (items.length === 0) {
      setSelectedId(null)
      return
    }
    if (!items.some((item) => item.followUp.inboxEntryId === selectedId)) {
      setSelectedId(items[Math.min(selectedIndex, items.length - 1)]!.followUp.inboxEntryId)
    }
  }, [items, selectedId, selectedIndex])

  useEffect(() => {
    if (panelRef.current) panelRef.current.scrollTop = 0
    restoreReviseFocusRef.current = false
    setDecisionMode('choose')
    setRevisionNote('')
    setDecisionError(false)
    headingRef.current?.focus({ preventScroll: true })
  }, [current?.followUp.inboxEntryId])

  useEffect(() => {
    if (decisionMode === 'revise') {
      noteRef.current?.focus({ preventScroll: true })
      return
    }
    if (restoreReviseFocusRef.current) {
      restoreReviseFocusRef.current = false
      reviseButtonRef.current?.focus({ preventScroll: true })
    }
  }, [decisionMode])

  useEffect(() => {
    if (evidenceAvailable) return
    restoreReviseFocusRef.current = false
    setDecisionMode('choose')
    setRevisionNote('')
  }, [evidenceAvailable])

  const select = (index: number) => {
    const next = items[index]
    if (!next || submitting || decisionMode === 'revise') return
    setDecisionError(false)
    setSelectedId(next.followUp.inboxEntryId)
  }

  const cancelRevision = () => {
    if (submitting) return
    restoreReviseFocusRef.current = true
    setDecisionMode('choose')
    setRevisionNote('')
    setDecisionError(false)
  }

  const decide = async (decision: OfficeRoutineDecisionInput) => {
    if (!current || submitting) return
    if (decision.outcome === 'evidence-unavailable') {
      if (evidenceState !== 'missing') return
    } else if (evidenceState !== 'available') {
      return
    }
    if (decision.outcome === 'revise-plan'
      && (!decision.note || decision.note.length < 1 || decision.note.length > MAX_DECISION_NOTE_LENGTH)) return

    setSubmittingOutcome(decision.outcome)
    setDecisionError(false)
    try {
      await onDecide(current, decision)
      const next = items[selectedIndex + 1] ?? items[selectedIndex - 1]
      setDecisionMode('choose')
      setRevisionNote('')
      setSelectedId(next?.followUp.inboxEntryId ?? null)
    } catch {
      setDecisionError(true)
    } finally {
      setSubmittingOutcome(null)
    }
  }

  return (
    <section
      role="dialog"
      aria-modal="true"
      aria-labelledby="office-decision-desk-title"
      aria-busy={submitting}
      tabIndex={-1}
      className="oa-office-window oa-office-cadence oa-office-decision-desk"
      data-source-status={sourceStatus}
      data-decision-mode={decisionMode}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          if (submitting) return
          onClose()
          return
        }
        if (event.key === 'Tab') trapOfficeDialogTab(event)
      }}
    >
      <header className="oa-office-window__header">
        <div className="oa-office-window__title">
          <img src={OFFICE_HUD_ASSETS.drawerRecord} alt="" aria-hidden style={officePixelImg} />
          <span className="oa-office-window__title-copy">
            <span className="oa-office-window__title-room">{t('office.decisionDeskTitle')}</span>
            <span className="oa-office-window__title-separator" aria-hidden>·</span>
            <span className="oa-office-window__title-kind">04</span>
          </span>
        </div>
        <button type="button" aria-label={t('common.close')} disabled={submitting} onClick={onClose}>
          <OfficeWindowControlGlyph kind="close" />
        </button>
      </header>

      <div ref={panelRef} className="oa-office-cadence__panel">
        <h2
          ref={headingRef}
          className="oa-office-cadence__step"
          id="office-decision-desk-title"
          tabIndex={-1}
          aria-label={t('office.decisionDeskStep')}
        >
          <span aria-hidden>04</span>
          <strong>{t('office.decisionDeskStep')}</strong>
        </h2>

        {current ? (
          <>
            <div className="oa-office-cadence__subject" aria-live="polite">
              <span className="oa-office-inbox-duty__queue">
                <i aria-hidden />
                {t('office.decisionDeskQueue', {
                  position: selectedIndex + 1,
                  count: items.length,
                })}
              </span>
              <p className="oa-office-decision-desk__intro">{t('office.decisionDeskIntro')}</p>
              <small className="oa-office-decision-desk__evidence-label">
                {t('office.decisionDeskReportLabel')}
              </small>
              <h2 title={current.reportTitle}>{current.reportTitle}</h2>
              <p>{current.reportExcerpt ?? t('office.decisionDeskReportNoPreview')}</p>
            </div>

            <dl className="oa-office-cadence__facts">
              <div>
                <dt>{t('office.decisionDeskReportWorkspace')}</dt>
                <dd>{current.reportWorkspaceLabel}</dd>
              </div>
              <div>
                <dt>{t('office.decisionDeskReportReceived')}</dt>
                <dd>{formatRelativeTime(current.followUp.reportTs)}</dd>
              </div>
              <div>
                <dt>{t('office.decisionDeskCarriedAt')}</dt>
                <dd>{formatRelativeTime(current.followUp.createdAt)}</dd>
              </div>
            </dl>

            <section
              className="oa-office-decision-desk__issue"
              aria-label={t('office.routineScheduledIssue')}
            >
              <header>
                <span>{t('office.routineScheduledIssue')}</span>
                <strong title={current.issueTitle}>{current.issueTitle}</strong>
              </header>
              <dl>
                <div>
                  <dt>{t('office.cadenceWorkspace')}</dt>
                  <dd>{current.workspaceLabel}</dd>
                </div>
                <div>
                  <dt>{t('office.routinePriority')}</dt>
                  <dd>{current.priority
                    ? t(`issues.priority.${current.priority}`)
                    : t('office.decisionDeskUnavailableShort')}</dd>
                </div>
              </dl>
            </section>

            {sourceStatus !== 'ready' && (
              <p className="oa-office-cadence__notice" data-tone="warning" role="status">
                {t(sourceStatus === 'loading'
                  ? 'office.decisionDeskSyncing'
                  : 'office.decisionDeskSignalLost')}
              </p>
            )}
            {current.issueState === 'missing' && (
              <p className="oa-office-cadence__notice" data-tone="warning" role="status">
                {t('office.decisionDeskIssueUnavailable')}
              </p>
            )}
            {current.issueState === 'unknown' && (
              <p className="oa-office-cadence__notice" data-tone="warning" role="status">
                {t('office.decisionDeskIssueUnknown')}
              </p>
            )}
            {current.reportState === 'missing' && (
              <p className="oa-office-cadence__notice" data-tone="warning" role="status">
                {t('office.decisionDeskReportUnavailable')}
              </p>
            )}
            {current.reportState === 'unknown' && (
              <p className="oa-office-cadence__notice" data-tone="warning" role="status">
                {t('office.decisionDeskReportUnknown')}
              </p>
            )}
            {decisionError && (
              <p className="oa-office-cadence__notice" data-tone="warning" role="alert">
                {t('office.decisionDeskResolveFailed')}
              </p>
            )}

            <p className="oa-office-cadence__receipt-note">
              {t('office.decisionDeskReceiptNote')}
            </p>

            <div className="oa-office-cadence__actions oa-office-cadence__actions--decision-desk">
              <button
                type="button"
                className="oa-office-cadence__back"
                disabled={submitting}
                onClick={onClose}
              >
                {t('office.decisionDeskKeep')}
              </button>
              <button
                type="button"
                className="oa-office-cadence__stamp"
                disabled={current.reportState !== 'available' || submitting}
                onClick={() => onOpenReport(current)}
              >
                <img
                  src={OFFICE_FURNITURE.generated.inboxTerminal}
                  alt=""
                  aria-hidden
                  style={officePixelImg}
                />
                {t('office.decisionDeskOpenReport')}
              </button>
              <button
                type="button"
                className="oa-office-cadence__open"
                disabled={current.issueState !== 'available' || submitting}
                onClick={() => onOpenIssue(current)}
              >
                <img src={OFFICE_HUD_ASSETS.sessionPortal} alt="" aria-hidden style={officePixelImg} />
                {t('office.decisionDeskOpenIssue')}
              </button>
            </div>

            <section
              className="oa-office-decision-desk__judgment"
              aria-labelledby="office-decision-desk-judgment-title"
              data-evidence={evidenceState}
            >
              <header>
                <span aria-hidden>{evidenceState === 'available' ? '◆' : evidenceState === 'missing' ? '?' : '…'}</span>
                <div>
                  <h3 id="office-decision-desk-judgment-title">
                    {t(evidenceState === 'available'
                      ? 'office.decisionDeskJudgmentTitle'
                      : evidenceState === 'missing'
                        ? 'office.decisionDeskEvidenceUnavailableTitle'
                        : 'office.decisionDeskEvidenceUnknownTitle')}
                  </h3>
                  <p>{t(evidenceState === 'available'
                    ? 'office.decisionDeskJudgmentHint'
                    : evidenceState === 'missing'
                      ? 'office.decisionDeskEvidenceUnavailableHint'
                      : 'office.decisionDeskEvidenceUnknownHint')}</p>
                </div>
              </header>

              {evidenceState === 'available' ? decisionMode === 'revise' ? (
                <div className="oa-office-decision-desk__revision">
                  <label htmlFor="office-decision-desk-note">
                    {t('office.decisionDeskRevisionLabel')}
                  </label>
                  <textarea
                    ref={noteRef}
                    id="office-decision-desk-note"
                    value={revisionNote}
                    rows={4}
                    maxLength={MAX_DECISION_NOTE_LENGTH}
                    disabled={submitting}
                    aria-describedby="office-decision-desk-note-help office-decision-desk-note-count"
                    aria-invalid={revisionNote.length > 0 && !revisionNoteValid}
                    onChange={(event) => {
                      setRevisionNote(event.currentTarget.value)
                      setDecisionError(false)
                    }}
                  />
                  <div className="oa-office-decision-desk__revision-meta">
                    <small id="office-decision-desk-note-help">
                      {t('office.decisionDeskRevisionHelp')}
                    </small>
                    <output id="office-decision-desk-note-count" htmlFor="office-decision-desk-note">
                      {t('office.decisionDeskRevisionCount', {
                        count: revisionNote.length,
                        max: MAX_DECISION_NOTE_LENGTH,
                      })}
                    </output>
                  </div>
                  <div className="oa-office-decision-desk__revision-actions">
                    <button type="button" disabled={submitting} onClick={cancelRevision}>
                      {t('office.decisionDeskRevisionCancel')}
                    </button>
                    <button
                      type="button"
                      disabled={!revisionNoteValid || submitting}
                      onClick={() => void decide({
                        outcome: 'revise-plan',
                        note: trimmedRevisionNote,
                      })}
                    >
                      {submittingOutcome === 'revise-plan'
                        ? t('office.decisionDeskSaving')
                        : t('office.decisionDeskRevisionSave')}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="oa-office-decision-desk__judgment-actions">
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => void decide({ outcome: 'maintain-plan' })}
                  >
                    {submittingOutcome === 'maintain-plan'
                      ? t('office.decisionDeskSaving')
                      : t('office.decisionDeskMaintainPlan')}
                  </button>
                  <button
                    ref={reviseButtonRef}
                    type="button"
                    disabled={submitting}
                    onClick={() => {
                      setDecisionError(false)
                      setDecisionMode('revise')
                    }}
                  >
                    {t('office.decisionDeskRevisePlan')}
                  </button>
                </div>
              ) : evidenceState === 'missing' ? (
                <div className="oa-office-decision-desk__unavailable">
                  <p>{t('office.decisionDeskEvidenceUnavailableReceipt')}</p>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => void decide({ outcome: 'evidence-unavailable' })}
                  >
                    {submittingOutcome === 'evidence-unavailable'
                      ? t('office.decisionDeskSavingUnavailable')
                      : t('office.decisionDeskRemoveUnavailable')}
                  </button>
                </div>
              ) : (
                <div className="oa-office-decision-desk__unavailable">
                  <p>{t('office.decisionDeskEvidenceUnknownReceipt')}</p>
                </div>
              )}
            </section>

            <div className="oa-office-decision-desk__pager" aria-label={t('office.decisionDeskQueueLabel')}>
              <button
                type="button"
                disabled={selectedIndex === 0 || submitting || decisionMode === 'revise'}
                aria-label={t('office.decisionDeskPrevious')}
                onClick={() => select(selectedIndex - 1)}
              >
                <img src={OFFICE_HUD_ASSETS.windowBack} alt="" aria-hidden style={officePixelImg} />
                <span>{t('office.decisionDeskPrevious')}</span>
              </button>
              <span aria-hidden>{selectedIndex + 1} / {items.length}</span>
              <button
                type="button"
                disabled={selectedIndex >= items.length - 1 || submitting || decisionMode === 'revise'}
                aria-label={t('office.decisionDeskNext')}
                onClick={() => select(selectedIndex + 1)}
              >
                <span>{t('office.decisionDeskNext')}</span>
                <img
                  className="oa-office-decision-desk__next-icon"
                  src={OFFICE_HUD_ASSETS.windowBack}
                  alt=""
                  aria-hidden
                  style={officePixelImg}
                />
              </button>
            </div>

          </>
        ) : (
          <div className="oa-office-decision-desk__empty">
            <div className="oa-office-decision-desk__empty-copy" role="status">
              <img src={OFFICE_HUD_ASSETS.drawerRecord} alt="" aria-hidden style={officePixelImg} />
              <strong>{t(sourceStatus === 'ready'
                ? 'office.decisionDeskEmpty'
                : sourceStatus === 'loading'
                  ? 'office.decisionDeskSyncing'
                  : 'office.decisionDeskSignalLost')}</strong>
              <p>{t(sourceStatus === 'ready'
                ? 'office.decisionDeskEmptyHint'
                : 'office.decisionDeskSourceHint')}</p>
            </div>
            <button type="button" onClick={onClose}>{t('office.decisionDeskReturn')}</button>
          </div>
        )}
      </div>
    </section>
  )
}
