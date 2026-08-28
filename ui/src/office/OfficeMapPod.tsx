import { useTranslation } from 'react-i18next'

import type { OfficeFloorEmployee, OfficeRoomSnapshot } from '../api/office'
import { OfficeDesk } from './OfficeDesk'
import { deskSlotsForOffice, visibleEmployeesForOffice } from './desk-slots'
import { OFFICE_FURNITURE, officePixelImg } from './furniture'
import { OFFICE_CABINET_CENTER, OFFICE_DESK_CENTERS, OFFICE_ROSTER_CENTER } from './pod-geometry'
import { officeDepthAt } from './scene-depth'

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
  onOpenRoster,
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
  onOpenRoster: (workspaceId: string) => void
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
      <button
        type="button"
        className="oa-office-pod__sign"
        style={{ zIndex: officeDepthAt(layout.y + 62) }}
        onClick={() => onOpenFiles(group.workspace.id)}
        aria-label={t('office.interactFiles', { name: title })}
        title={t('office.cabinetHint')}
      >
        <img
          src={OFFICE_FURNITURE.generated.workspaceSign}
          alt=""
          aria-hidden
          className="oa-office-pod__sign-asset"
          style={officePixelImg}
        />
        <div className="oa-office-pod__sign-content">
          <div className="oa-office-pod__sign-meta">
            <span>{harnessTitle}</span>
            <span className="oa-office-pod__count">
              {t('office.agentCount', { count: group.employees.length })}
            </span>
          </div>
          <h3>{title}</h3>
        </div>
      </button>

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
          style={{
            ...officePixelImg,
            zIndex: officeDepthAt(layout.y + layout.height - 6),
          }}
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
              depth={officeDepthAt(layout.y + OFFICE_DESK_CENTERS[index].y)}
              reducedMotion={reducedMotion}
              spriteScale={0.23}
              onSelect={() => employee && onSelectEmployee(group.workspace.id, employee)}
              onOpen={() => employee && onOpenEmployee(group.workspace.id, employee)}
            />
          ))}
        </ul>
        <button
          type="button"
          className="oa-office-pod__cabinet"
          style={{ zIndex: officeDepthAt(layout.y + OFFICE_CABINET_CENTER.y + 24) }}
          data-nearby={nearbyTargetId === `cabinet:${group.workspace.id}`}
          onClick={() => onOpenFiles(group.workspace.id)}
          aria-label={`${t('office.cabinet')} · ${title}`}
          title={t('office.cabinetHint')}
        >
          <img src={OFFICE_FURNITURE.generated.cabinet} alt="" style={officePixelImg} />
        </button>
        {group.employees.length > 4 && (
          <button
            id={`office-roster-${group.workspace.id}`}
            type="button"
            className="oa-office-pod__roster"
            style={{ zIndex: officeDepthAt(layout.y + OFFICE_ROSTER_CENTER.y + 25) }}
            data-nearby={nearbyTargetId === `roster:${group.workspace.id}`}
            onClick={() => onOpenRoster(group.workspace.id)}
            aria-label={`${t('office.roster')} · ${title}`}
            title={t('office.rosterHint')}
          >
            <img src={OFFICE_FURNITURE.generated.personnelBoard} alt="" style={officePixelImg} />
          </button>
        )}
      </div>
    </section>
  )
}
