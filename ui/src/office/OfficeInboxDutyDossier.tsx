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
  onOpenInbox,
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
  onOpenInbox: (duty: OfficeInboxDutyCandidate) => void
  onConfirm: () => Promise<OfficeDutyAcknowledgementResult>
  onConfirmed: () => void
  onContinue: () => void
  onLater?: () => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const changed = Boolean(latestDuty
    && latestDuty.receipt.fingerprint !== duty.receipt.fingerprint)
  const resolved = !latestDuty && sourceStatus === 'ready'
  const sourceReady = sourceStatus === 'ready'
  const backlogCount = currentBacklogCount ?? duty.count
  const documents = duty.delivery.entry.docs ?? []
  const visibleDocuments = documents.slice(0, 4)

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true })
  }, [])

  const confirm = async () => {
    if (submitting || !sourceReady || changed || resolved) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const result = await onConfirm()
      if (result === 'already-resolved') onContinue()
      else onConfirmed()
    } catch {
      setSubmitting(false)
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
      className="oa-office-window oa-office-cadence oa-office-inbox-duty"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          if (!submitting) onClose()
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
        <button type="button" aria-label={t('common.close')} disabled={submitting} onClick={onClose}>
          <OfficeWindowControlGlyph kind="close" />
        </button>
      </header>

      <div className="oa-office-cadence__panel">
        <h2
          ref={headingRef}
          className="oa-office-cadence__step"
          tabIndex={-1}
          aria-label={t('office.inboxBacklogConfirmStep')}
        >
          <span>02</span>
          <strong>{t('office.inboxBacklogConfirm')}</strong>
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
        {submitError && (
          <p className="oa-office-cadence__notice" data-tone="warning" role="alert">
            {submitError}
          </p>
        )}

        {!resolved && !changed && (
          <p className="oa-office-cadence__receipt-note">
            {t('office.inboxBacklogReceiptNote')}
          </p>
        )}

        <div className="oa-office-cadence__actions">
          <button type="button" className="oa-office-cadence__back" disabled={submitting} onClick={onLater}>
            {t('office.inboxBacklogLater')}
          </button>
          <button
            type="button"
            className="oa-office-cadence__open"
            disabled={submitting}
            onClick={() => onOpenInbox(changed && latestDuty ? latestDuty : duty)}
          >
            <img src={OFFICE_HUD_ASSETS.sessionPortal} alt="" aria-hidden style={officePixelImg} />
            {t(changed ? 'office.inboxBacklogOpenLatest' : 'office.inboxBacklogOpenAgain')}
          </button>
          {resolved ? (
            <button type="button" className="oa-office-cadence__stamp" onClick={onContinue}>
              {t('office.cadenceContinue')}
            </button>
          ) : changed ? (
            <button
              type="button"
              className="oa-office-cadence__stamp"
              onClick={() => latestDuty && onOpenInbox(latestDuty)}
            >
              {t('office.inboxBacklogOpenLatest')}
            </button>
          ) : (
            <button
              type="button"
              className="oa-office-cadence__stamp"
              disabled={!sourceReady || submitting}
              onClick={() => void confirm()}
            >
              {submitting ? t('office.inboxBacklogSaving') : t('office.inboxBacklogStamp')}
            </button>
          )}
        </div>
      </div>
    </section>
  )
}
