import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { OfficeFloorEmployee, OfficeRoomSnapshot } from '../api/office'
import { employeesForOffice } from './desk-slots'
import { officeCoworkerCast, type OfficeCoworkerSpriteAsset } from './coworker-sprites'
import { OfficeCoworkerSprite } from './OfficeCoworkerSprite'
import { OfficeWindowControlGlyph } from './OfficeWindowControlGlyph'
import { officePixelImg } from './furniture'
import { OFFICE_HUD_ASSETS } from './hud-assets'
import { officeCoworkerAssignment, officeCoworkerCallsign } from './label'
import { nextOfficeGridIndex } from './grid-navigation'
import { useReducedMotion } from './use-reduced-motion'

export function OfficeRosterWindow({
  group,
  roomName,
  focusResumeId,
  onSelect,
  onClose,
  coworkerAssets,
}: {
  group: OfficeRoomSnapshot
  roomName: string
  focusResumeId?: string | null
  onSelect: (employee: OfficeFloorEmployee) => void
  onClose: () => void
  coworkerAssets?: ReadonlyMap<string, OfficeCoworkerSpriteAsset>
}) {
  const { t } = useTranslation()
  const reducedMotion = useReducedMotion()
  const employees = employeesForOffice(group.employees)
  const coworkerCast = useMemo(() => officeCoworkerCast(group.employees), [group.employees])
  const initialFocusResumeId = focusResumeId ?? employees[0]?.resumeId ?? null
  const [focusedResumeId, setFocusedResumeId] = useState(initialFocusResumeId)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  return (
    <section
      role="dialog"
      aria-modal="true"
      aria-label={`${t('office.roster')} · ${roomName}`}
      data-testid="office-roster-window"
      className="oa-office-window oa-office-roster"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose()
      }}
    >
      <header className="oa-office-window__header">
        <div className="oa-office-window__title">
          <img src={OFFICE_HUD_ASSETS.rosterBadge} alt="" aria-hidden style={officePixelImg} />
          <span className="oa-office-window__title-copy">
            <span className="oa-office-window__title-room">{roomName}</span>
            <span className="oa-office-window__title-separator" aria-hidden>·</span>
            <span className="oa-office-window__title-kind">{t('office.roster')}</span>
          </span>
        </div>
        <button
          type="button"
          ref={closeButtonRef}
          autoFocus={employees.length === 0}
          aria-label={t('common.close')}
          onClick={onClose}
          onKeyDown={(event) => {
            if (event.key !== 'Tab' || employees.length === 0) return
            event.preventDefault()
            Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('button[data-resume-id]') ?? [])
              .find((button) => button.dataset.resumeId === focusedResumeId)
              ?.focus()
          }}
        >
          <OfficeWindowControlGlyph kind="close" />
        </button>
      </header>
      <div className="oa-office-roster__body">
        <div className="oa-office-roster__summary">
          <span>{t('office.rosterCount', { count: employees.length })}</span>
          <small className="oa-office-window__input-hint">
            <span data-input="keyboard">{t('office.rosterKeyboardHint')}</span>
            <span data-input="touch">{t('office.rosterSelectHint')}</span>
          </small>
        </div>
        <ul
          ref={listRef}
          aria-label={t('office.roster')}
          onKeyDown={(event) => {
            if (event.key === 'Tab') {
              event.preventDefault()
              closeButtonRef.current?.focus()
              return
            }
            const direction = ({
              ArrowLeft: 'left',
              ArrowRight: 'right',
              ArrowUp: 'up',
              ArrowDown: 'down',
            } as const)[event.key]
            const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-resume-id]'))
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
          {employees.map((employee) => {
            const asset = coworkerAssets?.get(employee.resumeId) ?? coworkerCast.get(employee.resumeId)
            const callsign = officeCoworkerCallsign(employee, asset)
            const assignment = officeCoworkerAssignment(employee)
            return (
            <li key={employee.resumeId}>
              <button
                type="button"
                autoFocus={employee.resumeId === initialFocusResumeId}
                data-resume-id={employee.resumeId}
                tabIndex={employee.resumeId === focusedResumeId ? 0 : -1}
                onFocus={() => setFocusedResumeId(employee.resumeId)}
                onClick={() => onSelect(employee)}
              >
                <span className="oa-office-roster__portrait" aria-hidden>
                  <OfficeCoworkerSprite
                    agent={employee.agent}
                    identity={employee.resumeId}
                    asset={asset}
                    mood={employee.mood}
                    reducedMotion={reducedMotion}
                    label={callsign}
                    scale={0.22}
                  />
                </span>
                <strong className="oa-office-roster__title">
                  {callsign}<span> · {employee.name}</span>
                </strong>
                <small className="oa-office-roster__meta">
                  {assignment ?? `${employee.agent} · ${employee.name}`}
                </small>
                <span className="oa-office-roster__status" data-mood={employee.mood}>
                  <i aria-hidden />
                  {t(`office.mood.${employee.mood}`)}
                </span>
                <img
                  className="oa-office-roster__cursor"
                  src={OFFICE_HUD_ASSETS.journalCursor}
                  alt=""
                  aria-hidden
                  style={officePixelImg}
                />
              </button>
            </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}
