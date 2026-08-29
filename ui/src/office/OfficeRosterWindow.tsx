import { useTranslation } from 'react-i18next'

import type { OfficeFloorEmployee, OfficeRoomSnapshot } from '../api/office'
import { employeesForOffice } from './desk-slots'
import { OfficeCoworkerSprite } from './OfficeCoworkerSprite'
import { officePixelImg } from './furniture'
import { OFFICE_HUD_ASSETS } from './hud-assets'
import { officeCoworkerLabel } from './label'
import { useReducedMotion } from './use-reduced-motion'

export function OfficeRosterWindow({
  group,
  roomName,
  focusResumeId,
  onSelect,
  onClose,
}: {
  group: OfficeRoomSnapshot
  roomName: string
  focusResumeId?: string | null
  onSelect: (employee: OfficeFloorEmployee) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const reducedMotion = useReducedMotion()
  const employees = employeesForOffice(group.employees)

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
        <button type="button" autoFocus={!focusResumeId} aria-label={t('common.close')} onClick={onClose}>
          <img src={OFFICE_HUD_ASSETS.windowClose} alt="" aria-hidden style={officePixelImg} />
        </button>
      </header>
      <div className="oa-office-roster__body">
        <div className="oa-office-roster__summary">
          <span>{t('office.rosterCount', { count: employees.length })}</span>
          <small>{t('office.rosterSelectHint')}</small>
        </div>
        <ul>
          {employees.map((employee) => (
            <li key={employee.resumeId}>
              <button
                type="button"
                autoFocus={employee.resumeId === focusResumeId}
                data-resume-id={employee.resumeId}
                onClick={() => onSelect(employee)}
              >
                <span className="oa-office-roster__portrait" aria-hidden>
                  <OfficeCoworkerSprite
                    agent={employee.agent}
                    mood={employee.mood}
                    reducedMotion={reducedMotion}
                    label={officeCoworkerLabel(employee)}
                    scale={0.22}
                  />
                </span>
                <strong className="oa-office-roster__title">{officeCoworkerLabel(employee)}</strong>
                <small className="oa-office-roster__meta">{employee.agent} · {employee.name}</small>
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
          ))}
        </ul>
      </div>
    </section>
  )
}
