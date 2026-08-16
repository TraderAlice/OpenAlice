import { FolderOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { OfficeFloorEmployee, OfficeRoomSnapshot } from '../api/office'
import { OfficeDesk } from './OfficeDesk'
import { deskSlotsForOffice } from './desk-slots'

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
}) {
  const { t } = useTranslation()
  const visibleEmployees = [...group.employees]
    .sort((a, b) => Number(a.mood === 'idle') - Number(b.mood === 'idle'))
    .slice(0, 4)
  const slots = deskSlotsForOffice(visibleEmployees, 4)
  const active = group.employees.some((employee) => employee.mood !== 'idle')

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
        <button
          type="button"
          onClick={() => onOpenFiles(group.workspace.id)}
          aria-label={`${t('office.cabinet')} · ${title}`}
          title={t('office.cabinetHint')}
        >
          <FolderOpen size={13} />
        </button>
      </header>

      <div className="oa-office-pod__floor">
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
              reducedMotion={reducedMotion}
              spriteScale={0.2}
              onSelect={() => employee && onSelectEmployee(group.workspace.id, employee)}
              onOpen={() => employee && onOpenEmployee(group.workspace.id, employee)}
            />
          ))}
        </ul>
      </div>
    </section>
  )
}
