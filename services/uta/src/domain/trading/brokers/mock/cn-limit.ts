/**
 * Board-aware limit-band heuristics for cn-paper (not ST-aware).
 */

/** Fraction of prevClose: main 10%, ChiNext/STAR 20%, BJ ~30%. */
export function limitPctForBareCode(bare: string): number {
  const code = bare.replace(/^(sh|sz|bj)/i, '').replace(/\.(ss|sh|sz|bj)$/i, '')
  if (/^688\d{3}$/.test(code)) return 0.2
  if (/^300\d{3}$/.test(code) || /^301\d{3}$/.test(code)) return 0.2
  if (/^92\d{4}$/.test(code) || /^8\d{5}$/.test(code) || /^4\d{5}$/.test(code)) return 0.3
  return 0.1
}

export function limitBandFromPrevClose(
  prevClose: number,
  bare: string,
): { limitUp: number; limitDown: number; pct: number } {
  const pct = limitPctForBareCode(bare)
  const prev = prevClose > 0 ? prevClose : 0
  const round2 = (n: number) => Math.round(n * 100) / 100
  return {
    pct,
    limitUp: round2(prev * (1 + pct)),
    limitDown: round2(prev * (1 - pct)),
  }
}
