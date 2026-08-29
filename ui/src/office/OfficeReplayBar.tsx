import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

import { officePixelImg } from './furniture'
import { OFFICE_HUD_ASSETS } from './hud-assets'

export function OfficeReplayBar({
  firstSeq,
  lastSeq,
  asOfSeq,
  onAsOfSeq,
  onViewFloor,
}: {
  firstSeq: number
  lastSeq: number
  asOfSeq: number | null
  onAsOfSeq: (seq: number | null) => void
  onViewFloor: () => void
}) {
  const { t } = useTranslation()
  const live = asOfSeq == null
  const minSeq = Math.min(Math.max(0, firstSeq), lastSeq)
  const value = Math.min(lastSeq, Math.max(minSeq, asOfSeq ?? lastSeq))
  if (lastSeq <= 0) return null
  const progress = lastSeq === minSeq ? 100 : ((value - minSeq) / (lastSeq - minSeq)) * 100
  const setReplaySeq = (next: number) => onAsOfSeq(next >= lastSeq ? null : Math.max(minSeq, next))

  return (
    <div className="oa-office-replay">
      <div className="oa-office-replay__transport">
        <button
          type="button"
          className="oa-office-replay__step oa-office-replay__step--previous"
          aria-label={t('office.replayPrevious')}
          disabled={value <= minSeq}
          onClick={() => setReplaySeq(value - 1)}
        >
          <img src={OFFICE_HUD_ASSETS.windowBack} alt="" aria-hidden style={officePixelImg} />
        </button>
        <label htmlFor="office-replay" className="oa-office-replay__label">
          <span>{t('office.replay')}</span>
          <strong>{live ? t('office.replayLive') : t('office.replayAt', { seq: value })}</strong>
        </label>
        <button
          type="button"
          className="oa-office-replay__step oa-office-replay__step--next"
          aria-label={t('office.replayNext')}
          disabled={live}
          onClick={() => setReplaySeq(value + 1)}
        >
          <img src={OFFICE_HUD_ASSETS.windowBack} alt="" aria-hidden style={officePixelImg} />
        </button>
      </div>
      <input
        id="office-replay"
        type="range"
        min={minSeq}
        max={lastSeq}
        value={value}
        aria-valuemin={minSeq}
        aria-valuemax={lastSeq}
        aria-valuenow={value}
        aria-label={t('office.replay')}
        aria-valuetext={live ? String(t('office.replayLive')) : String(t('office.replayAt', { seq: value }))}
        data-live={live}
        style={{ '--office-replay-progress': `${progress}%` } as CSSProperties}
        onChange={(event) => {
          setReplaySeq(Number(event.target.value))
        }}
        className="oa-office-replay__range"
      />
      <div className="oa-office-replay__actions">
        {!live && (
          <button
            type="button"
            className="oa-office-replay__view"
            onClick={onViewFloor}
          >
            {t('office.replayViewFloor')}
          </button>
        )}
        <button
          type="button"
          className="oa-office-replay__live"
          disabled={live}
          onClick={() => onAsOfSeq(null)}
        >
          <span className="oa-office-live-dot" aria-hidden />
          {t('office.replayLive')}
        </button>
      </div>
    </div>
  )
}
