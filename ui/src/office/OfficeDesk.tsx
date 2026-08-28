import { useTranslation } from 'react-i18next'

import type { OfficeFloorEmployee } from '../api/office'
import { officeBubbleText } from './bubble-text'
import { officeCoworkerLabel } from './label'
import { OfficeCoworkerSprite } from './OfficeCoworkerSprite'
import { OFFICE_FURNITURE, officePixelImg } from './furniture'
import { officeStationComposition } from './station'

export function OfficeDesk({
  employee,
  roomName,
  selected,
  nearby,
  reducedMotion,
  spriteScale,
  onSelect,
  onOpen,
}: {
  employee: OfficeFloorEmployee | null
  roomName: string
  selected: boolean
  nearby?: boolean
  reducedMotion: boolean
  spriteScale?: number
  onSelect: () => void
  onOpen?: () => void
}) {
  const { t } = useTranslation()
  const station = officeStationComposition()
  const showBubble = Boolean(employee?.bubble && (selected || nearby))
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
        className="oa-office-desk"
        data-selected={selected}
        data-nearby={nearby}
        data-occupied={Boolean(employee)}
        data-mood={employee?.mood}
        style={{ width: station.widthPx, height: station.heightPx }}
      >
        <span className="oa-office-topdown-station" aria-hidden>
          <img
            src={OFFICE_FURNITURE.generated.workstation}
            alt=""
            className="oa-office-topdown-station__asset"
            style={officePixelImg}
          />
        </span>
        {employee?.bubble && showBubble && (
          <span
            className="oa-office-bubble"
            style={{ top: station.bubble.topPx, zIndex: station.bubble.zIndex }}
          >
            {officeBubbleText(employee.bubble, t)}
          </span>
        )}
        {employee && (
          <span
            className="oa-office-nameplate"
            style={{
              top: showBubble ? station.name.topPx + 20 : station.name.topPx,
              zIndex: station.name.zIndex,
            }}
          >
            <span className="oa-office-nameplate__dot" aria-hidden />
            {officeCoworkerLabel(employee)}
          </span>
        )}
        {!employee && (
          <img
            src={OFFICE_FURNITURE.chair}
            alt=""
            data-slot="office-chair-prop"
            className="oa-office-chair"
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
            className="oa-office-sprite"
            style={{
              bottom: station.sprite.bottomPx,
              zIndex: station.sprite.zIndex,
            }}
          >
            <OfficeCoworkerSprite
              agent={employee.agent}
              mood={employee.mood}
              reducedMotion={reducedMotion}
              label={label}
              scale={spriteScale ?? station.sprite.scale}
            />
          </span>
        )}
        <img
          src={OFFICE_FURNITURE.desk}
          alt=""
          data-slot="office-desk-prop"
          className="oa-office-desk-prop"
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
