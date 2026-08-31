import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { OfficeFloorEmployee, OfficeRoomSnapshot } from '../api/office'
import { employeesForOffice } from './desk-slots'
import { officeCoworkerCast, type OfficeCoworkerSpriteAsset } from './coworker-sprites'
import { OfficeCoworkerSprite } from './OfficeCoworkerSprite'
import { OfficeWindowControlGlyph } from './OfficeWindowControlGlyph'
import { officePixelImg } from './furniture'
import { OFFICE_HUD_ASSETS } from './hud-assets'
import { officeCoworkerAssignment, officeCoworkerCallsign, officeCoworkerStatusKey } from './label'
import { nextOfficeGridIndex, nextOfficeGridPageIndex } from './grid-navigation'
import { isOfficeConfirmKey } from './input'
import { useReducedMotion } from './use-reduced-motion'

export function OfficeRosterWindow({
  group,
  roomName,
  focusResumeId,
  replayFocusResumeId,
  onSelect,
  onClose,
  coworkerAssets,
}: {
  group: OfficeRoomSnapshot
  roomName: string
  focusResumeId?: string | null
  replayFocusResumeId?: string | null
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
  const focusedIndex = Math.max(0, employees.findIndex((employee) => employee.resumeId === focusedResumeId))
  const positionWidth = Math.max(2, String(employees.length).length)
  const positionLabel = employees.length > 0
    ? `${String(focusedIndex + 1).padStart(positionWidth, '0')}/${String(employees.length).padStart(positionWidth, '0')}`
    : '00/00'
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
        <span
          className="oa-office-window__title-count"
          aria-label={employees.length > 0
            ? t('office.rosterPosition', { index: focusedIndex + 1, count: employees.length })
            : t('office.rosterCount', { count: employees.length })}
        >
          {positionLabel}
        </span>
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
          aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown PageUp PageDown Home End Enter Space"
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
            } else if (event.key === 'PageUp' || event.key === 'PageDown') {
              nextIndex = nextOfficeGridPageIndex(
                buttons.map((button) => button.getBoundingClientRect()),
                currentIndex,
                event.key === 'PageUp' ? 'up' : 'down',
                event.currentTarget.clientHeight,
              )
            } else if (event.key === 'Home') {
              nextIndex = 0
            } else if (event.key === 'End') {
              nextIndex = buttons.length - 1
            } else {
              return
            }
            event.preventDefault()
            const nextButton = buttons[nextIndex]
            nextButton?.focus({ preventScroll: true })
            nextButton?.scrollIntoView?.({ block: 'nearest' })
          }}
        >
          {employees.map((employee) => {
            const asset = coworkerAssets?.get(employee.resumeId) ?? coworkerCast.get(employee.resumeId)
            const callsign = officeCoworkerCallsign(employee, asset)
            const assignment = officeCoworkerAssignment(employee)
            const replayFocused = employee.resumeId === replayFocusResumeId
            return (
            <li key={employee.resumeId}>
              <button
                type="button"
                autoFocus={employee.resumeId === initialFocusResumeId}
                data-resume-id={employee.resumeId}
                data-awake={employee.awake}
                data-replay-focus={replayFocused || undefined}
                tabIndex={employee.resumeId === focusedResumeId ? 0 : -1}
                onFocus={() => setFocusedResumeId(employee.resumeId)}
                onClick={() => onSelect(employee)}
                onKeyDown={(event) => {
                  if (!isOfficeConfirmKey(event.key)) return
                  event.preventDefault()
                  onSelect(employee)
                }}
              >
                <span className="oa-office-roster__portrait" aria-hidden>
                  <OfficeCoworkerSprite
                    agent={employee.agent}
                    identity={employee.resumeId}
                    asset={asset}
                    mood={employee.mood}
                    reducedMotion={reducedMotion}
                    label={callsign}
                    scale={0.27}
                  />
                </span>
                <span className="oa-office-roster__identity">
                  <strong className="oa-office-roster__title">
                    <span className="oa-office-roster__callsign">{callsign}</span>
                    <span className="oa-office-roster__session"> · {employee.name}</span>
                  </strong>
                  <span
                    className="oa-office-roster__status"
                    data-mood={employee.mood}
                    data-power={replayFocused ? 'replay' : employee.awake ? 'awake' : 'asleep'}
                    aria-label={replayFocused ? t('office.power.replayActive') : undefined}
                  >
                    <i aria-hidden />
                    {t(replayFocused ? 'office.replay' : officeCoworkerStatusKey(employee))}
                  </span>
                </span>
                <small className="oa-office-roster__meta">
                  {assignment ?? `${employee.agent} · ${employee.name}`}
                </small>
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
