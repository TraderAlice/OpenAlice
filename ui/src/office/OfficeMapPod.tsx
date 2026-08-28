import { useTranslation } from 'react-i18next'

import type { OfficeFloorEmployee, OfficeRoomSnapshot } from '../api/office'
import { OfficeDesk } from './OfficeDesk'
import { deskSlotsForOffice, visibleEmployeesForOffice } from './desk-slots'
import { OFFICE_FURNITURE, officePixelImg } from './furniture'

export function OfficeMapPod({
  group,
  layout,
  title,
  harnessTitle,
  selected,
  reducedMotion,
  onSelectEmployee,
  onOpenEmployee,
  onOpenFiles,
  nearbyTargetId,
}: {
  group: OfficeRoomSnapshot
  layout: { x: number; y: number; width: number; height: number }
  title: string
  harnessTitle: string
  selected?: { workspaceId: string; resumeId: string } | null
  reducedMotion: boolean
  onSelectEmployee: (workspaceId: string, employee: OfficeFloorEmployee) => void
  onOpenEmployee: (workspaceId: string, employee: OfficeFloorEmployee) => void
  onOpenFiles: (workspaceId: string) => void
  nearbyTargetId?: string | null
}) {
  const { t } = useTranslation()
  const visibleEmployees = visibleEmployeesForOffice(group.employees)
  const slots = deskSlotsForOffice(visibleEmployees, 4)
  const active = group.employees.some((employee) => employee.mood !== 'idle')
  const harnessProp = group.workspace.harness === 'chat'
    ? OFFICE_FURNITURE.generated.coffeeStation
    : group.workspace.harness === 'auto-quant'
      ? OFFICE_FURNITURE.generated.serverRack
      : group.workspace.harness === 'prediction'
        ? OFFICE_FURNITURE.generated.terminal
        : OFFICE_FURNITURE.generated.plant

  return (
    <section
      data-testid={`office-pod-${group.workspace.id}`}
      className="oa-office-pod"
      style={{
        left: layout.x,
        top: layout.y,
        width: layout.width,
        height: layout.height,
      }}
      data-harness={group.workspace.harness}
      data-active={active}
      data-sleeping={group.sleeping}
    >
      <header className="oa-office-pod__sign">
        <div>
          <span>{harnessTitle}</span>
          <h3>{title}</h3>
        </div>
        <span className="oa-office-pod__count">
          {t('office.agentCount', { count: group.employees.length })}
        </span>
      </header>

      <div className="oa-office-pod__floor">
        <img
          src={OFFICE_FURNITURE.generated.workspaceRug}
          alt=""
          aria-hidden
          className="oa-office-pod__rug"
          style={officePixelImg}
        />
        <img
          src={harnessProp}
          alt=""
          aria-hidden
          className="oa-office-pod__harness-prop"
          style={officePixelImg}
        />
        <ul className="oa-office-pod__desks">
          {slots.map((employee, index) => (
            <OfficeDesk
              key={employee?.resumeId ?? `empty-${group.workspace.id}-${index}`}
              employee={employee}
              roomName={title}
              selected={Boolean(
                employee
                && selected?.workspaceId === group.workspace.id
                && employee.resumeId === selected.resumeId,
              )}
              nearby={Boolean(
                employee
                && nearbyTargetId === `employee:${group.workspace.id}:${employee.resumeId}`
              )}
              reducedMotion={reducedMotion}
              spriteScale={0.2}
              onSelect={() => employee && onSelectEmployee(group.workspace.id, employee)}
              onOpen={() => employee && onOpenEmployee(group.workspace.id, employee)}
            />
          ))}
        </ul>
        <button
          type="button"
          className="oa-office-pod__cabinet"
          data-nearby={nearbyTargetId === `cabinet:${group.workspace.id}`}
          onClick={() => onOpenFiles(group.workspace.id)}
          aria-label={`${t('office.cabinet')} · ${title}`}
          title={t('office.cabinetHint')}
        >
          <img src={OFFICE_FURNITURE.generated.cabinet} alt="" style={officePixelImg} />
        </button>
      </div>
    </section>
  )
}
