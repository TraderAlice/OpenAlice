import { useTranslation } from 'react-i18next'

import type { OfficeFloorEmployee } from '../api/office'
import { officeCoworkerCallsign } from './label'
import { OfficeCoworkerSprite } from './OfficeCoworkerSprite'
import { OFFICE_COWORKER_EMOTES, type OfficeCoworkerSpriteAsset } from './coworker-sprites'
import { OFFICE_FURNITURE, officePixelImg } from './furniture'
import { officeStationComposition } from './station'

export function OfficeDesk({
  employee,
  roomName,
  selected,
  nearby,
  targeted,
  acknowledged = false,
  replayFocused = false,
  depth,
  reducedMotion,
  interactionDisabled = false,
  spriteScale,
  coworkerAsset,
  onSelect,
  onOpen,
}: {
  employee: OfficeFloorEmployee | null
  roomName: string
  selected: boolean
  nearby?: boolean
  targeted?: boolean
  acknowledged?: boolean
  replayFocused?: boolean
  depth: number
  reducedMotion: boolean
  interactionDisabled?: boolean
  spriteScale?: number
  coworkerAsset?: OfficeCoworkerSpriteAsset
  onSelect: () => void
  onOpen?: () => void
}) {
  const { t } = useTranslation()
  const station = officeStationComposition()
  const moodEmote = employee && (
    employee.mood === 'working'
    || employee.mood === 'waiting'
    || employee.mood === 'failed'
    || employee.mood === 'review'
  )
    ? { kind: employee.mood, src: OFFICE_COWORKER_EMOTES[employee.mood] }
    : null
  const sleepingCue = employee && !employee.awake && (
    selected || nearby || targeted || replayFocused
  )
    ? { kind: 'sleeping' as const, src: OFFICE_COWORKER_EMOTES.sleeping }
    : null
  const poweredDownOutcome = moodEmote && moodEmote.kind !== 'working'
    ? moodEmote
    : null
  const emote = replayFocused && moodEmote
    ? moodEmote
    : employee && !employee.awake
      ? poweredDownOutcome ?? sleepingCue
      : moodEmote
  const label = employee
    ? t('office.employeeLabel', {
      name: officeCoworkerCallsign(employee, coworkerAsset),
      resumeId: employee.resumeId,
      mood: t(`office.mood.${employee.mood}`),
      power: t(replayFocused
        ? 'office.power.replayActive'
        : employee.awake
          ? 'office.power.awake'
          : 'office.power.asleep'),
    })
    : t('office.emptyDesk', { name: roomName })

  return (
    <li>
      <button
        type="button"
        tabIndex={-1}
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
        data-acknowledged={acknowledged || undefined}
        data-replay-focus={replayFocused || undefined}
        data-occupied={Boolean(employee)}
        data-awake={employee?.awake}
        data-mood={employee?.mood}
        style={{ width: station.widthPx, height: station.heightPx, zIndex: depth }}
      >
        <span className="oa-office-topdown-station" aria-hidden>
          <img
            src={employee?.awake
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
            data-kind={emote.kind}
            data-reduced-motion={reducedMotion || undefined}
            data-testid={`office-emote-${emote.kind}`}
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
              asset={coworkerAsset}
              mood={employee.mood}
              reducedMotion={reducedMotion}
              label={label}
              scale={spriteScale ?? station.sprite.scale}
              pose="desk"
            />
          </span>
        )}
        {acknowledged && (
          <span className="oa-office-landmark-ack" aria-hidden>OK</span>
        )}
      </button>
    </li>
  )
}
