import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'

import type { OfficeBuildingSnapshot, OfficeDrawerItem, OfficeFloorEmployee } from '../api/office'
import { OfficeFloor } from './OfficeFloor'
import { OFFICE_FURNITURE, officePixelImg } from './furniture'

export function OfficeBuilding({
  building,
  roomTitle,
  selected,
  onSelectEmployee,
  onOpenEmployee,
  onOpenFiles,
}: {
  building: OfficeBuildingSnapshot
  roomTitle?: (workspaceId: string, tag: string) => string
  selected?: { workspaceId: string; resumeId: string } | null
  onSelectEmployee: (workspaceId: string, employee: OfficeFloorEmployee) => void
  onOpenEmployee: (workspaceId: string, employee: OfficeFloorEmployee) => void
  onOpenFiles: (workspaceId: string) => void
  onOpenDrawer?: (workspaceId: string, employee: OfficeFloorEmployee, item: OfficeDrawerItem) => void
}) {
  const { t } = useTranslation()

  return (
    <div
      data-testid="office-building"
      className="flex min-h-[26rem] min-w-0 flex-1 flex-col overflow-hidden"
    >
      <div
        data-testid="office-wall"
        className="relative h-[88px] shrink-0 bg-office-wall"
        style={{
          backgroundImage: [
            'repeating-linear-gradient(90deg, var(--office-wall-grain) 0 2px, transparent 2px 16px)',
            'linear-gradient(var(--office-wall-crown) 0 10px, transparent 10px)',
          ].join(', '),
        }}
      >
        <div className="absolute inset-x-0 bottom-0 h-3 bg-office-trim" />
      </div>

      <div
        data-testid="office-floor"
        className="relative flex min-h-0 flex-1 items-end justify-center overflow-auto bg-office-floor px-3 pb-3 pt-2"
        style={{
          backgroundImage: [
            'repeating-linear-gradient(90deg, transparent 0 31px, var(--office-floor-plank) 31px 32px)',
            'repeating-linear-gradient(0deg, var(--office-floor-sheen) 0 7px, transparent 7px 16px)',
          ].join(', '),
        }}
      >
        <figure className="pointer-events-none mb-1 hidden w-[80px] shrink-0 sm:block">
          <img
            src={OFFICE_FURNITURE.coffee}
            alt=""
            className="h-[72px] w-full object-contain object-bottom"
            style={officePixelImg}
          />
          <figcaption className="sr-only">{t('office.amenityCoffee')}</figcaption>
        </figure>

        <div className="flex min-h-0 min-w-0 flex-1 items-end justify-center">
          {building.offices.map((office, index) => (
            <Fragment key={office.workspace.id}>
              {index > 0 && (
                <div
                  data-testid="office-partition"
                  className="mx-1 mb-0 hidden h-[210px] w-2 shrink-0 rounded-sm bg-office-trim sm:block"
                  style={{ boxShadow: 'inset 1px 0 var(--office-trim-shadow)' }}
                />
              )}
              <OfficeFloor
                floor={office}
                title={roomTitle?.(office.workspace.id, office.workspace.tag) ?? office.workspace.tag}
                selectedResumeId={selected?.workspaceId === office.workspace.id ? selected.resumeId : null}
                onSelectEmployee={(employee) => onSelectEmployee(office.workspace.id, employee)}
                onOpenEmployee={(employee) => onOpenEmployee(office.workspace.id, employee)}
                onOpenFiles={() => onOpenFiles(office.workspace.id)}
              />
            </Fragment>
          ))}
        </div>

        <figure className="pointer-events-none mb-1 hidden w-[64px] shrink-0 sm:block">
          <img
            src={OFFICE_FURNITURE.plant}
            alt=""
            className="h-[72px] w-full object-contain object-bottom"
            style={officePixelImg}
          />
          <figcaption className="sr-only">{t('office.amenityPlant')}</figcaption>
        </figure>
      </div>
    </div>
  )
}
