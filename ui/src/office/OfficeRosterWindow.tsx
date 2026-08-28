import { Users, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { OfficeFloorEmployee, OfficeRoomSnapshot } from '../api/office'
import { employeesForOffice } from './desk-slots'
import { OfficeEmployeeSprite } from './OfficeEmployeeSprite'
import { officeCoworkerLabel } from './label'
import { useReducedMotion } from './use-reduced-motion'

export function OfficeRosterWindow({
  group,
  roomName,
  onSelect,
  onClose,
}: {
  group: OfficeRoomSnapshot
  roomName: string
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
        <div>
          <Users size={15} />
          <span>{roomName} · {t('office.roster')}</span>
        </div>
        <button type="button" autoFocus aria-label={t('common.close')} onClick={onClose}>
          <X size={15} />
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
              <button type="button" onClick={() => onSelect(employee)}>
                <span className="oa-office-roster__portrait" aria-hidden>
                  <OfficeEmployeeSprite
                    mood={employee.mood}
                    reducedMotion={reducedMotion}
                    label={officeCoworkerLabel(employee)}
                    scale={0.22}
                  />
                </span>
                <span className="oa-office-roster__identity">
                  <strong>{officeCoworkerLabel(employee)}</strong>
                  <small>{employee.agent} · {employee.name}</small>
                </span>
                <span className="oa-office-roster__status" data-mood={employee.mood}>
                  <i aria-hidden />
                  {t(`office.mood.${employee.mood}`)}
                </span>
                <span className="oa-office-roster__arrow" aria-hidden>▶</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
