import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { OfficeDrawerItem, OfficeFloorEmployee, OfficeRoomSnapshot } from '../api/office'
import { OfficeDesk } from './OfficeDesk'
import { deskSlotsForOffice } from './desk-slots'
import { OFFICE_FURNITURE, officePixelImg } from './furniture'

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduced(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])
  return reduced
}

export function OfficeFloor({
  floor,
  title,
  selectedResumeId,
  onSelectEmployee,
  onOpenEmployee,
  onOpenFiles,
}: {
  floor: OfficeRoomSnapshot
  title?: string
  selectedResumeId?: string | null
  onSelectEmployee: (employee: OfficeFloorEmployee) => void
  onOpenEmployee: (employee: OfficeFloorEmployee) => void
  onOpenFiles: () => void
  onOpenDrawer?: (employee: OfficeFloorEmployee, item: OfficeDrawerItem) => void
}) {
  const { t } = useTranslation()
  const reducedMotion = useReducedMotion()
  const roomName = title || floor.workspace.tag
  const slots = deskSlotsForOffice(floor.employees)

  return (
    <section
      data-testid={`office-room-${floor.workspace.id}`}
      className="flex flex-col items-center justify-end"
    >
      <h3 className="mb-1 rounded-sm bg-office-trim px-2 py-0.5 text-center text-[10px] font-semibold tracking-wide text-office-label">
        {t('office.roomTitle', { name: roomName })}
      </h3>
      <div className="flex items-end">
        <button
          type="button"
          onClick={onOpenFiles}
          aria-label={`${t('office.cabinet')} · ${roomName}`}
          className="oa-pressable mb-0 h-[108px] w-[68px] shrink-0"
        >
          <img
            src={OFFICE_FURNITURE.cabinet}
            alt=""
            className="h-full w-full object-contain object-bottom"
            style={officePixelImg}
          />
        </button>
        <ul className="flex items-end">
          {slots.map((employee, index) => (
            <OfficeDesk
              key={employee?.resumeId ?? `empty-${floor.workspace.id}-${index}`}
              employee={employee}
              roomName={roomName}
              selected={Boolean(employee && employee.resumeId === selectedResumeId)}
              reducedMotion={reducedMotion}
              onSelect={() => employee && onSelectEmployee(employee)}
              onOpen={() => employee && onOpenEmployee(employee)}
            />
          ))}
        </ul>
      </div>
    </section>
  )
}
