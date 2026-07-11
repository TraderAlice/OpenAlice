export function linearInterpolatedQuantile(values: number[], quantile: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  const position = (sorted.length - 1) * quantile
  const lowerIndex = Math.floor(position)
  const upperIndex = Math.ceil(position)
  const lower = sorted[lowerIndex]!
  const upper = sorted[upperIndex]!
  return lower + (upper - lower) * (position - lowerIndex)
}
