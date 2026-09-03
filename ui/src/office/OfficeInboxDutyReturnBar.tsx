import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import {
  markOfficeInboxDutyPresented,
  readOfficeInboxDutyExcursion,
  subscribeOfficeInboxDutyExcursion,
  type OfficeInboxDutyExcursion,
} from './inbox-duty-excursion'
import './office.css'

export type OfficeInboxDutyReturnSurface =
  | {
      readonly kind: 'inbox'
      readonly visible: boolean
      readonly workspaceId: string
      readonly inboxEntryId: string
    }
  | {
      readonly kind: 'file'
      readonly workspaceId: string
      readonly path: string
    }

function isExactInboxSurface(
  excursion: OfficeInboxDutyExcursion,
  surface: Extract<OfficeInboxDutyReturnSurface, { kind: 'inbox' }>,
): boolean {
  return surface.visible
    && excursion.duty.destination.workspaceId === surface.workspaceId
    && excursion.duty.destination.inboxEntryId === surface.inboxEntryId
}

function isExactFileSurface(
  excursion: OfficeInboxDutyExcursion,
  surface: Extract<OfficeInboxDutyReturnSurface, { kind: 'file' }>,
): boolean {
  return excursion.phase === 'presented'
    && excursion.duty.destination.workspaceId === surface.workspaceId
    && (excursion.duty.delivery.entry.docs ?? []).some(
      (document) => document.path === surface.path,
    )
}

/**
 * A small Office-owned checkpoint shown while an exact Inbox duty is being
 * reviewed on another product surface. It only restores spatial context: the
 * caller owns navigation, while Inbox read state and Office progress remain
 * untouched until the return dossier records an explicit disposition.
 */
export function OfficeInboxDutyReturnBar({
  surface,
  onReturn,
  fallback = null,
}: {
  readonly surface: OfficeInboxDutyReturnSurface
  readonly onReturn: () => void
  readonly fallback?: ReactNode
}) {
  const { t } = useTranslation()
  const [excursion, setExcursion] = useState<OfficeInboxDutyExcursion | null>(
    readOfficeInboxDutyExcursion,
  )

  useEffect(() => subscribeOfficeInboxDutyExcursion(() => {
    setExcursion(readOfficeInboxDutyExcursion())
  }), [])

  const exactInboxSurface = Boolean(
    excursion
    && surface.kind === 'inbox'
    && isExactInboxSurface(excursion, surface),
  )

  useEffect(() => {
    if (!excursion
      || surface.kind !== 'inbox'
      || excursion.phase !== 'away'
      || !isExactInboxSurface(excursion, surface)) return

    markOfficeInboxDutyPresented({
      workspaceId: surface.workspaceId,
      inboxEntryId: surface.inboxEntryId,
    })
  }, [
    excursion,
    surface.kind,
    surface.kind === 'inbox' ? surface.inboxEntryId : null,
    surface.kind === 'inbox' ? surface.visible : null,
    surface.workspaceId,
  ])

  const exactFileSurface = Boolean(
    excursion
    && surface.kind === 'file'
    && isExactFileSurface(excursion, surface),
  )
  const shouldShow = Boolean(
    excursion
    && excursion.phase !== 'returned'
    && (exactInboxSurface || exactFileSurface),
  )
  const routine = Boolean(excursion?.duty.delivery.declaredIssue)
  const typeLabel = excursion
    ? routine
      ? t('office.routineReport')
      : t('office.excursionInbox')
    : ''
  const title = excursion?.duty.delivery.title ?? ''
  const translationValues = excursion
    ? {
        position: excursion.shift.position,
        total: excursion.shift.total,
        type: typeLabel,
        title,
      }
    : null
  const accessibleLabel = translationValues
    ? t('office.excursionAriaLabel', translationValues)
    : ''
  const [announcement, setAnnouncement] = useState('')

  // Keep the live region mounted before filling it so assistive technology
  // reliably announces a dynamically-created field trip once, rather than
  // relying on a newly inserted labelled region to announce itself.
  useEffect(() => {
    setAnnouncement(shouldShow ? accessibleLabel : '')
  }, [accessibleLabel, shouldShow])

  const announcer = (
    <span
      className="sr-only"
      data-testid="office-excursion-announcer"
      aria-live="polite"
      aria-atomic="true"
    >
      {announcement}
    </span>
  )

  if (!excursion || !shouldShow || !translationValues) {
    return <>{announcer}{fallback}</>
  }

  return (
    <>
      {announcer}
      <section
        className="oa-office-excursion-return"
        data-surface={surface.kind}
        data-duty-type={routine ? 'routine' : 'inbox'}
        aria-label={accessibleLabel}
      >
        <div className="oa-office-excursion-return__copy">
          <div className="oa-office-excursion-return__meta">
            <span className="oa-office-excursion-return__eyebrow">
              {t('office.excursionEyebrow', translationValues)}
            </span>
            <span className="oa-office-excursion-return__type">{typeLabel}</span>
          </div>
          <strong className="oa-office-excursion-return__title" title={title}>
            {title}
          </strong>
        </div>
        <button
          type="button"
          className="oa-office-excursion-return__cta"
          onClick={onReturn}
        >
          <span aria-hidden="true">←</span>
          {t('office.excursionReturn')}
        </button>
      </section>
    </>
  )
}
