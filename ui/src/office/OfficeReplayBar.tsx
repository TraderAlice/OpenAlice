import { useTranslation } from 'react-i18next'

export function OfficeReplayBar({
  firstSeq,
  lastSeq,
  asOfSeq,
  onAsOfSeq,
}: {
  firstSeq: number
  lastSeq: number
  asOfSeq: number | null
  onAsOfSeq: (seq: number | null) => void
}) {
  const { t } = useTranslation()
  const live = asOfSeq == null
  const minSeq = Math.min(Math.max(0, firstSeq), lastSeq)
  const value = Math.min(lastSeq, Math.max(minSeq, asOfSeq ?? lastSeq))
  if (lastSeq <= 0) return null

  return (
    <div className="oa-office-replay">
      <label htmlFor="office-replay" className="oa-office-replay__label">
        <span>{t('office.replay')}</span>
        <strong>{live ? t('office.replayLive') : t('office.replayAt', { seq: value })}</strong>
      </label>
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
        onChange={(event) => {
          const next = Number(event.target.value)
          onAsOfSeq(next >= lastSeq ? null : next)
        }}
        className="oa-office-replay__range"
      />
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
  )
}
