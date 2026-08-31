import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { IssuePriority } from '../api/issues'
import type { OfficeRoutineFollowUp } from '../api/office'
import { formatRelativeTime } from '../lib/intl'
import type { OfficeDutySourceStatus } from './duty-registry'
import { OFFICE_FURNITURE, officePixelImg } from './furniture'
import { OFFICE_HUD_ASSETS } from './hud-assets'
import { trapOfficeDialogTab } from './office-dialog-focus'
import { OfficeWindowControlGlyph } from './OfficeWindowControlGlyph'

export interface OfficeRoutineDecisionItem {
  readonly followUp: OfficeRoutineFollowUp
  readonly reportTitle: string
  readonly reportExcerpt?: string
  readonly reportWorkspaceLabel: string
  /** False when the exact historical Inbox row cannot currently be addressed. */
  readonly reportAvailable: boolean
  readonly issueTitle: string
  readonly workspaceLabel: string
  readonly priority: IssuePriority | null
  /** False when the current Issue projection no longer proves this route. */
  readonly issueAvailable: boolean
}

export function OfficeRoutineDecisionDesk({
  items,
  sourceStatus,
  onOpenReport,
  onOpenIssue,
  onResolve,
  onClose,
}: {
  readonly items: readonly OfficeRoutineDecisionItem[]
  readonly sourceStatus: OfficeDutySourceStatus
  readonly onOpenReport: (item: OfficeRoutineDecisionItem) => void
  readonly onOpenIssue: (item: OfficeRoutineDecisionItem) => void
  readonly onResolve: (item: OfficeRoutineDecisionItem) => Promise<void>
  readonly onClose: () => void
}) {
  const { t } = useTranslation()
  const panelRef = useRef<HTMLDivElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [selectedId, setSelectedId] = useState<string | null>(
    () => items[0]?.followUp.inboxEntryId ?? null,
  )
  const [resolving, setResolving] = useState(false)
  const [resolveError, setResolveError] = useState(false)
  const selectedIndex = Math.max(0, items.findIndex(
    (item) => item.followUp.inboxEntryId === selectedId,
  ))
  const current = items[selectedIndex] ?? null

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
    headingRef.current?.focus({ preventScroll: true })
  }, [current?.followUp.inboxEntryId])

  const select = (index: number) => {
    const next = items[index]
    if (!next || resolving) return
    setResolveError(false)
    setSelectedId(next.followUp.inboxEntryId)
  }

  const resolve = async () => {
    if (!current || resolving) return
    setResolving(true)
    setResolveError(false)
    try {
      await onResolve(current)
      const next = items[selectedIndex + 1] ?? items[selectedIndex - 1]
      setSelectedId(next?.followUp.inboxEntryId ?? null)
    } catch {
      setResolveError(true)
    } finally {
      setResolving(false)
    }
  }

  return (
    <section
      role="dialog"
      aria-modal="true"
      aria-labelledby="office-decision-desk-title"
      aria-busy={resolving}
      className="oa-office-window oa-office-cadence oa-office-decision-desk"
      data-source-status={sourceStatus}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          if (!resolving) onClose()
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
        <button type="button" aria-label={t('common.close')} disabled={resolving} onClick={onClose}>
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
            {!current.issueAvailable && (
              <p className="oa-office-cadence__notice" data-tone="warning" role="status">
                {t('office.decisionDeskIssueUnavailable')}
              </p>
            )}
            {!current.reportAvailable && (
              <p className="oa-office-cadence__notice" data-tone="warning" role="status">
                {t('office.decisionDeskReportUnavailable')}
              </p>
            )}
            {resolveError && (
              <p className="oa-office-cadence__notice" data-tone="warning" role="alert">
                {t('office.decisionDeskResolveFailed')}
              </p>
            )}

            <p className="oa-office-cadence__receipt-note">
              {t('office.decisionDeskReceiptNote')}
            </p>

            <div className="oa-office-decision-desk__pager" aria-label={t('office.decisionDeskQueueLabel')}>
              <button
                type="button"
                disabled={selectedIndex === 0 || resolving}
                aria-label={t('office.decisionDeskPrevious')}
                onClick={() => select(selectedIndex - 1)}
              >
                <img src={OFFICE_HUD_ASSETS.windowBack} alt="" aria-hidden style={officePixelImg} />
                <span>{t('office.decisionDeskPrevious')}</span>
              </button>
              <span aria-hidden>{selectedIndex + 1} / {items.length}</span>
              <button
                type="button"
                disabled={selectedIndex >= items.length - 1 || resolving}
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

            <div className="oa-office-cadence__actions oa-office-cadence__actions--decision-desk">
              <button
                type="button"
                className="oa-office-cadence__back"
                disabled={resolving}
                onClick={onClose}
              >
                {t('office.decisionDeskKeep')}
              </button>
              <button
                type="button"
                className="oa-office-cadence__stamp"
                disabled={!current.reportAvailable || resolving}
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
                disabled={!current.issueAvailable || resolving}
                onClick={() => onOpenIssue(current)}
              >
                <img src={OFFICE_HUD_ASSETS.sessionPortal} alt="" aria-hidden style={officePixelImg} />
                {t('office.decisionDeskOpenIssue')}
              </button>
              <button
                type="button"
                className="oa-office-decision-desk__resolve"
                disabled={resolving}
                onClick={() => void resolve()}
              >
                {resolving ? t('office.decisionDeskResolving') : t('office.decisionDeskResolved')}
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
