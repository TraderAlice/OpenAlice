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
    <div className="flex shrink-0 flex-wrap items-center gap-3">
      <label htmlFor="office-replay" className="text-sm text-muted-foreground">
        {t('office.replay')}
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
        aria-valuetext={live ? String(t('office.replayLive')) : String(t('office.replayAt', { seq: value }))}
        onChange={(event) => {
          const next = Number(event.target.value)
          onAsOfSeq(next >= lastSeq ? null : next)
        }}
        className="h-10 min-w-48 flex-1 accent-primary"
      />
      <button
        type="button"
        className="oa-pressable rounded-md border border-border px-2 py-1 text-xs disabled:opacity-50"
        disabled={live}
        onClick={() => onAsOfSeq(null)}
      >
        {t('office.replayLive')}
      </button>
      <span className="font-mono text-[11px] text-muted-foreground">
        {live ? t('office.replayLive') : t('office.replayAt', { seq: value })}
      </span>
    </div>
  )
}
