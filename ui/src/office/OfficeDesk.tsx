import { useTranslation } from 'react-i18next'

import type { OfficeBubble, OfficeFloorEmployee } from '../api/office'
import { officeCoworkerLabel } from './label'
import { OfficeEmployeeSprite } from './OfficeEmployeeSprite'
import { OFFICE_FURNITURE, officePixelImg } from './furniture'
import { officeStationComposition } from './station'

function OfficeBubbleText({ bubble }: { bubble: OfficeBubble }) {
  const { t } = useTranslation()
  if (bubble.kind === 'text' || bubble.kind === 'error') return bubble.text
  if (bubble.kind === 'tool') return String(t('office.bubbleTool', { name: bubble.name }))
  return String(t('office.bubbleRejected'))
}

export function OfficeDesk({
  employee,
  roomName,
  selected,
  reducedMotion,
  onSelect,
  onOpen,
}: {
  employee: OfficeFloorEmployee | null
  roomName: string
  selected: boolean
  reducedMotion: boolean
  onSelect: () => void
  onOpen?: () => void
}) {
  const { t } = useTranslation()
  const station = officeStationComposition()
  const label = employee
    ? t('office.employeeLabel', {
      name: officeCoworkerLabel(employee),
      resumeId: employee.resumeId,
      mood: t(`office.mood.${employee.mood}`),
    })
    : t('office.emptyDesk', { name: roomName })

  return (
    <li>
      <button
        type="button"
        data-testid={employee ? `office-desk-${employee.resumeId}` : 'office-desk-empty'}
        aria-label={label}
        aria-pressed={employee ? selected : undefined}
        disabled={!employee}
        onClick={onSelect}
        onDoubleClick={() => employee && onOpen?.()}
        className={`oa-pressable relative block rounded-sm text-center ${
          selected ? 'ring-2 ring-primary ring-offset-0' : ''
        } ${employee ? '' : 'cursor-default'}`}
        style={{ width: station.widthPx, height: station.heightPx }}
      >
        {employee?.bubble && (
          <span
            className="absolute left-1/2 max-w-[92%] -translate-x-1/2 truncate rounded-sm border border-office-trim-shadow/40 bg-office-label px-1.5 py-0.5 text-[10px] text-office-label-foreground"
            style={{ top: station.bubble.topPx, zIndex: station.bubble.zIndex }}
          >
            <OfficeBubbleText bubble={employee.bubble} />
          </span>
        )}
        {employee && (
          <span
            className="absolute left-1/2 max-w-[92%] -translate-x-1/2 truncate text-[11px] font-semibold text-office-label-foreground"
            style={{ top: station.name.topPx, zIndex: station.name.zIndex }}
          >
            {officeCoworkerLabel(employee)}
          </span>
        )}
        {!employee && (
          <img
            src={OFFICE_FURNITURE.chair}
            alt=""
            data-slot="office-chair-prop"
            className="pointer-events-none absolute left-1/2 -translate-x-1/2"
            style={{
              ...officePixelImg,
              bottom: station.sprite.bottomPx - 16,
              zIndex: station.sprite.zIndex,
              width: 52,
            }}
          />
        )}
        {employee && (
          <span
            data-slot="office-sprite"
            className="pointer-events-none absolute left-1/2 -translate-x-1/2"
            style={{
              bottom: station.sprite.bottomPx,
              zIndex: station.sprite.zIndex,
            }}
          >
            <OfficeEmployeeSprite
              mood={employee.mood}
              reducedMotion={reducedMotion}
              label={label}
              scale={station.sprite.scale}
            />
          </span>
        )}
        <img
          src={OFFICE_FURNITURE.desk}
          alt=""
          data-slot="office-desk-prop"
          className="pointer-events-none absolute left-1/2 -translate-x-1/2"
          style={{
            ...officePixelImg,
            bottom: station.desk.bottomPx,
            zIndex: station.desk.zIndex,
            width: station.desk.widthPx,
          }}
        />
      </button>
    </li>
  )
}
