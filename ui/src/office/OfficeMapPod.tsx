import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import type { OfficeFloorEmployee, OfficeRoomSnapshot } from '../api/office'
import { OfficeDesk } from './OfficeDesk'
import { officeCoworkerCast } from './coworker-sprites'
import { deskSlotsForOffice, visibleEmployeesForOffice } from './desk-slots'
import { OFFICE_FURNITURE, officePixelImg } from './furniture'
import { OFFICE_CABINET_CENTER, OFFICE_DESK_CENTERS, officeRosterCenter } from './pod-geometry'
import { officeDepthAt } from './scene-depth'

export function OfficeMapPod({
  group,
  layout,
  mapWidth,
  title,
  harnessTitle,
  selected,
  reducedMotion,
  interactionDisabled = false,
  onSelectEmployee,
  onOpenEmployee,
  onOpenWorkspace,
  onOpenFiles,
  onOpenRoster,
  nearbyTargetId,
  routeTargetId,
}: {
  group: OfficeRoomSnapshot
  layout: { x: number; y: number; width: number; height: number }
  mapWidth: number
  title: string
  harnessTitle: string
  selected?: { workspaceId: string; resumeId: string } | null
  reducedMotion: boolean
  interactionDisabled?: boolean
  onSelectEmployee: (workspaceId: string, employee: OfficeFloorEmployee) => void
  onOpenEmployee: (workspaceId: string, employee: OfficeFloorEmployee) => void
  onOpenWorkspace: (workspaceId: string) => void
  onOpenFiles: (workspaceId: string) => void
  onOpenRoster: (workspaceId: string) => void
  nearbyTargetId?: string | null
  routeTargetId?: string | null
}) {
  const { t } = useTranslation()
  const coworkerCast = useMemo(() => officeCoworkerCast(group.employees), [group.employees])
  const visibleEmployees = visibleEmployeesForOffice(group.employees)
  const slots = deskSlotsForOffice(visibleEmployees, 4)
  const additionalCount = Math.max(0, group.employees.length - visibleEmployees.length)
  const activeCount = group.employees.filter((employee) => employee.mood !== 'idle').length
  const awakeCount = group.employees.filter((employee) => employee.awake).length
  const statusLabel = interactionDisabled
    ? t('office.roomActiveCount', { active: activeCount, total: group.employees.length })
    : t('office.roomAwakeCount', { awake: awakeCount, total: group.employees.length })
  const rosterCenter = officeRosterCenter(layout, mapWidth)
  const harnessProp = group.workspace.harness === 'chat'
    ? OFFICE_FURNITURE.generated.coffeeStation
    : group.workspace.harness === 'auto-quant'
      ? OFFICE_FURNITURE.generated.serverRack
      : group.workspace.harness === 'prediction'
        ? OFFICE_FURNITURE.generated.predictionConsole
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
      data-active={activeCount > 0}
      data-sleeping={group.sleeping}
      data-replay-locked={interactionDisabled || undefined}
    >
      <button
        id={`office-sign-${group.workspace.id}`}
        type="button"
        className="oa-office-pod__sign"
        style={{ zIndex: officeDepthAt(layout.y + 62) }}
        data-route={routeTargetId === `sign:${group.workspace.id}`}
        data-replay-label={interactionDisabled ? t('office.replaySnapshot') : undefined}
        disabled={interactionDisabled}
        onClick={() => onOpenWorkspace(group.workspace.id)}
        aria-label={`${t('office.interactWorkspace', { name: title })}. ${statusLabel}`}
        title={interactionDisabled ? t('office.replayLockedHint') : t('office.workspaceSignHint')}
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
              {statusLabel}
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
              targeted={Boolean(
                employee
                && routeTargetId === `employee:${group.workspace.id}:${employee.resumeId}`
              )}
              depth={officeDepthAt(layout.y + OFFICE_DESK_CENTERS[index].y)}
              reducedMotion={reducedMotion}
              interactionDisabled={interactionDisabled}
              spriteScale={0.23}
              coworkerAsset={employee ? coworkerCast.get(employee.resumeId) : undefined}
              onSelect={() => employee && onSelectEmployee(group.workspace.id, employee)}
              onOpen={() => employee && onOpenEmployee(group.workspace.id, employee)}
            />
          ))}
        </ul>
        <button
          id={`office-cabinet-${group.workspace.id}`}
          type="button"
          className="oa-office-pod__cabinet"
          style={{ zIndex: officeDepthAt(layout.y + OFFICE_CABINET_CENTER.y + 24) }}
          data-nearby={nearbyTargetId === `cabinet:${group.workspace.id}`}
          data-route={routeTargetId === `cabinet:${group.workspace.id}`}
          disabled={interactionDisabled}
          onClick={() => onOpenFiles(group.workspace.id)}
          aria-label={`${t('office.cabinet')} · ${title}`}
          title={interactionDisabled ? t('office.replayLockedHint') : t('office.cabinetHint')}
        >
          <img src={OFFICE_FURNITURE.generated.cabinet} alt="" style={officePixelImg} />
        </button>
        {additionalCount > 0 && (
          <button
            id={`office-roster-${group.workspace.id}`}
            type="button"
            className="oa-office-pod__roster"
            style={{
              left: rosterCenter.x - 21,
              top: rosterCenter.y - 29,
              zIndex: officeDepthAt(layout.y + rosterCenter.y + 25),
            }}
            data-side={rosterCenter.side}
            data-nearby={nearbyTargetId === `roster:${group.workspace.id}`}
            data-route={routeTargetId === `roster:${group.workspace.id}`}
            disabled={interactionDisabled}
            onClick={() => onOpenRoster(group.workspace.id)}
            aria-label={`${t('office.roster')} · ${title} · ${t('office.rosterAdditional', {
              count: additionalCount,
            })}`}
            title={interactionDisabled
              ? t('office.replayLockedHint')
              : `${t('office.rosterHint')} ${t('office.rosterAdditional', { count: additionalCount })}`}
          >
            <img src={OFFICE_FURNITURE.generated.personnelBoard} alt="" style={officePixelImg} />
            <span className="oa-office-pod__roster-count" aria-hidden>+{additionalCount}</span>
          </button>
        )}
      </div>
    </section>
  )
}
