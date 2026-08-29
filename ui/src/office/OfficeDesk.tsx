import { useTranslation } from 'react-i18next'

import type { OfficeFloorEmployee } from '../api/office'
import { officeCoworkerLabel } from './label'
import { OfficeCoworkerSprite } from './OfficeCoworkerSprite'
import { OFFICE_COWORKER_EMOTES } from './coworker-sprites'
import { OFFICE_FURNITURE, officePixelImg } from './furniture'
import { officeStationComposition } from './station'

export function OfficeDesk({
  employee,
  roomName,
  selected,
  nearby,
  targeted,
  depth,
  reducedMotion,
  interactionDisabled = false,
  spriteScale,
  onSelect,
  onOpen,
}: {
  employee: OfficeFloorEmployee | null
  roomName: string
  selected: boolean
  nearby?: boolean
  targeted?: boolean
  depth: number
  reducedMotion: boolean
  interactionDisabled?: boolean
  spriteScale?: number
  onSelect: () => void
  onOpen?: () => void
}) {
  const { t } = useTranslation()
  const station = officeStationComposition()
  const emote = employee && (employee.mood === 'waiting' || employee.mood === 'failed')
    ? { mood: employee.mood, src: OFFICE_COWORKER_EMOTES[employee.mood] }
    : null
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
        disabled={!employee || interactionDisabled}
        title={interactionDisabled ? t('office.replayLockedHint') : undefined}
        onClick={onSelect}
        onDoubleClick={() => employee && onOpen?.()}
        className="oa-office-desk"
        data-selected={selected}
        data-nearby={nearby}
        data-route={targeted}
        data-occupied={Boolean(employee)}
        data-mood={employee?.mood}
        style={{ width: station.widthPx, height: station.heightPx, zIndex: depth }}
      >
        <span className="oa-office-topdown-station" aria-hidden>
          <img
            src={employee
              ? OFFICE_FURNITURE.generated.workstation
              : OFFICE_FURNITURE.generated.vacantWorkstation}
            alt=""
            className="oa-office-topdown-station__asset"
            style={officePixelImg}
          />
        </span>
        {emote && (
          <span
            className="oa-office-mood-emote"
            data-mood={emote.mood}
            data-reduced-motion={reducedMotion || undefined}
            data-testid={`office-emote-${emote.mood}`}
            aria-hidden
          >
            <img src={emote.src} alt="" style={officePixelImg} />
          </span>
        )}
        {employee && (
          <span
            className="oa-office-nameplate"
            style={{
              top: station.name.topPx,
              zIndex: station.name.zIndex,
            }}
          >
            <span className="oa-office-nameplate__dot" aria-hidden />
            {employee.name}
          </span>
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
              identity={employee.resumeId}
              mood={employee.mood}
              reducedMotion={reducedMotion}
              label={label}
              scale={spriteScale ?? station.sprite.scale}
              pose="desk"
            />
          </span>
        )}
      </button>
    </li>
  )
}
