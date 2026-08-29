import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { OfficeDrawerItem, OfficeFloorEmployee } from '../api/office'
import { officeBubbleText } from './bubble-text'
import { officePixelImg } from './furniture'
import { nextOfficeGridIndex } from './grid-navigation'
import { OFFICE_HUD_ASSETS } from './hud-assets'
import { OfficeCoworkerSprite } from './OfficeCoworkerSprite'
import { OfficeWindowControlGlyph } from './OfficeWindowControlGlyph'
import { officeCoworkerLabel } from './label'
import { useReducedMotion } from './use-reduced-motion'

export function OfficeInspectRail({
  employee,
  roomName,
  onOpen,
  onOpenDrawer,
  onClose,
  returnToRoster = false,
  children,
}: {
  employee: OfficeFloorEmployee | null
  roomName?: string
  onOpen: () => void
  onOpenDrawer: (item: OfficeDrawerItem) => void
  onClose?: () => void
  returnToRoster?: boolean
  children?: ReactNode
}) {
  const { t } = useTranslation()
  const reducedMotion = useReducedMotion()
  const titleId = useId()
  const [titleExpanded, setTitleExpanded] = useState(false)
  const [focusedDrawerId, setFocusedDrawerId] = useState(employee?.drawers[0]?.id ?? null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const profileRef = useRef<HTMLDivElement>(null)
  const titleToggleRef = useRef<HTMLButtonElement>(null)
  const openButtonRef = useRef<HTMLButtonElement>(null)
  const drawerListRef = useRef<HTMLUListElement>(null)
  const drawerButtons = () => Array.from(
    drawerListRef.current?.querySelectorAll<HTMLButtonElement>('button[data-drawer-id]') ?? [],
  )
  const focusedDrawerButton = () => {
    const buttons = drawerButtons()
    return buttons.find((button) => button.dataset.drawerId === focusedDrawerId) ?? buttons[0]
  }

  useEffect(() => {
    setFocusedDrawerId(employee?.drawers[0]?.id ?? null)
    setTitleExpanded(false)
  }, [employee?.resumeId, employee?.drawers])

  useLayoutEffect(() => {
    if (!titleExpanded || !profileRef.current) return
    profileRef.current.scrollTop = 0
  }, [titleExpanded])

  const employeeLabel = employee ? officeCoworkerLabel(employee) : ''
  const titleCanExpand = employeeLabel.length > 72

  return (
    <aside
      role="dialog"
      aria-modal="true"
      aria-label={employee ? employeeLabel : t('office.employeeFile')}
      data-testid="office-inspect"
      className="oa-office-inspect oa-office-window"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose?.()
      }}
    >
      {onClose && (
        <button
          type="button"
          ref={closeButtonRef}
          autoFocus={returnToRoster || !employee}
          className="oa-office-window__close"
          aria-label={returnToRoster ? t('office.backToRoster') : t('common.close')}
          onClick={onClose}
          onKeyDown={(event) => {
            if (event.key !== 'Tab' || !employee) return
            event.preventDefault()
            if (event.shiftKey) (focusedDrawerButton() ?? openButtonRef.current)?.focus()
            else (titleToggleRef.current ?? openButtonRef.current)?.focus()
          }}
        >
          <OfficeWindowControlGlyph kind={returnToRoster ? 'back' : 'close'} />
        </button>
      )}
      <div ref={profileRef} className="oa-office-inspect__profile">
        {employee ? (
          <>
            <div className="oa-office-inspect__portrait" aria-hidden>
              <OfficeCoworkerSprite
                agent={employee.agent}
                identity={employee.resumeId}
                mood={employee.mood}
                reducedMotion={reducedMotion}
                label={officeCoworkerLabel(employee)}
                scale={0.34}
              />
            </div>
            <div className="oa-office-inspect__dialogue">
              <div className="oa-office-inspect__kicker">
                <span className="oa-office-live-dot" aria-hidden />
                {t('office.employeeFile')}
              </div>
              <div className="oa-office-inspect__identity">
                <p id={titleId} data-expanded={titleExpanded || undefined} title={employeeLabel}>
                  {employeeLabel}
                </p>
                {titleCanExpand && (
                  <button
                    type="button"
                    ref={titleToggleRef}
                    className="oa-office-inspect__title-toggle"
                    aria-controls={titleId}
                    aria-expanded={titleExpanded}
                    onClick={() => setTitleExpanded((expanded) => !expanded)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Tab') return
                      event.preventDefault()
                      if (event.shiftKey) closeButtonRef.current?.focus()
                      else openButtonRef.current?.focus()
                    }}
                  >
                    {titleExpanded ? t('office.collapseTitle') : t('office.showFullTitle')}
                  </button>
                )}
                <span>@{employee.resumeId}</span>
              </div>
              <blockquote>
                {employee.bubble
                  ? officeBubbleText(employee.bubble, t)
                  : `${t(`office.mood.${employee.mood}`)} · ${employee.surface || roomName || '—'}`}
              </blockquote>
            </div>
            <dl className="oa-office-inspect__facts">
              <div>
                <dt>{t('office.status')}</dt>
                <dd data-mood={employee.mood}>
                  <span aria-hidden />
                  {t(`office.mood.${employee.mood}`)}
                </dd>
              </div>
              <div>
                <dt>{t('office.location')}</dt>
                <dd>{roomName || '—'}</dd>
              </div>
              <div>
                <dt>{t('office.surface')}</dt>
                <dd>{employee.surface || '—'}</dd>
              </div>
            </dl>
            {employee.drawers.length > 0 && (
              <div className="oa-office-drawers">
                <p>{t('office.deskDrawers')}</p>
                <ul
                  ref={drawerListRef}
                  onKeyDown={(event) => {
                    if (event.key === 'Tab') {
                      event.preventDefault()
                      if (event.shiftKey) openButtonRef.current?.focus()
                      else (closeButtonRef.current ?? openButtonRef.current)?.focus()
                      return
                    }
                    const direction = ({
                      ArrowLeft: 'left',
                      ArrowRight: 'right',
                      ArrowUp: 'up',
                      ArrowDown: 'down',
                    } as const)[event.key]
                    const buttons = drawerButtons()
                    const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement)
                    if (currentIndex < 0) return
                    let nextIndex = currentIndex
                    if (direction) {
                      nextIndex = nextOfficeGridIndex(
                        buttons.map((button) => button.getBoundingClientRect()),
                        currentIndex,
                        direction,
                      )
                    } else if (event.key === 'Home') {
                      nextIndex = 0
                    } else if (event.key === 'End') {
                      nextIndex = buttons.length - 1
                    } else {
                      return
                    }
                    event.preventDefault()
                    buttons[nextIndex]?.focus()
                  }}
                >
                  {employee.drawers.map((item, index) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        data-drawer-id={item.id}
                        tabIndex={item.id === focusedDrawerId || (focusedDrawerId == null && index === 0) ? 0 : -1}
                        className="oa-office-drawer"
                        aria-label={t('office.drawerOpenRecord', { record: item.label })}
                        onFocus={() => setFocusedDrawerId(item.id)}
                        onClick={() => onOpenDrawer(item)}
                      >
                        <img src={OFFICE_HUD_ASSETS.drawerRecord} alt="" aria-hidden style={officePixelImg} />
                        <span className="oa-office-drawer__label">{item.label}</span>
                        <span className="oa-office-drawer__destination" aria-hidden>
                          <img src={OFFICE_HUD_ASSETS.sessionPortal} alt="" style={officePixelImg} />
                          <small>{t('office.drawerRecordAction')}</small>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        ) : (
          <div className="oa-office-inspect__empty">
            <img src={OFFICE_HUD_ASSETS.resetCompass} alt="" aria-hidden style={officePixelImg} />
            <p>{t('office.selectDesk')}</p>
            <span>{t('office.selectDeskHint')}</span>
          </div>
        )}
      </div>
      {employee && (
        <div className="oa-office-inspect__actions">
          <button
            type="button"
            ref={openButtonRef}
            autoFocus={!returnToRoster}
            className="oa-office-inspect__open"
            onClick={onOpen}
            onKeyDown={(event) => {
              if (event.key !== 'Tab' || !onClose) return
              event.preventDefault()
              if (event.shiftKey) (titleToggleRef.current ?? closeButtonRef.current)?.focus()
              else (focusedDrawerButton() ?? closeButtonRef.current)?.focus()
            }}
          >
            {t('office.openSession')}
            <img src={OFFICE_HUD_ASSETS.sessionPortal} alt="" aria-hidden style={officePixelImg} />
          </button>
        </div>
      )}
      {children && (
        <div className="oa-office-inspect__timeline">
          <div className="oa-office-inspect__timeline-title">
            <span>{t('office.timeline')}</span>
            <span className="oa-office-live-dot" aria-hidden />
          </div>
          {children}
        </div>
      )}
    </aside>
  )
}
