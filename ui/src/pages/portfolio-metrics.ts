export type CurvePointSummary = {
  values: number[]
  firstAtCutoff: number | null
  latest: number | null
}

export type TodayDelta = {
  delta: number
  pct: number
  sign: 'up' | 'down' | 'flat'
}

export function computeTodayDelta(curve: Pick<CurvePointSummary, 'firstAtCutoff' | 'latest'> | null): TodayDelta | null {
  if (!curve || curve.latest == null || curve.firstAtCutoff == null) return null
  const latest = Number(curve.latest)
  const baseline = Number(curve.firstAtCutoff)
  if (!Number.isFinite(latest) || !Number.isFinite(baseline) || baseline <= 0) return null

  const delta = latest - baseline
  return {
    delta,
    pct: (delta / baseline) * 100,
    sign: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat',
  }
}
