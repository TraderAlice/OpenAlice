/**
 * Migration switch (per `_rust-port/02-design.md` §5.4).
 *
 * Reads the `ALICE_RUST_INDICATORS` env var. Syntax:
 *   ""  | "off"           → all TS (default; Rust dormant)
 *   "*"                   → all Rust
 *   "SMA,EMA"             → only those indicators routed to Rust
 *   "*,-MACD"             → all Rust except MACD
 *
 * The flag is read on every call (cheap; just parses an env string).
 * Stage-1 default is opt-in; stage-2 will flip the default to "*".
 */

export type IndicatorName =
  | 'SMA' | 'EMA' | 'STDEV' | 'MAX' | 'MIN' | 'SUM' | 'AVERAGE'
  | 'RSI' | 'BBANDS' | 'MACD' | 'ATR'

function readFlag(): string {
  return (process.env.ALICE_RUST_INDICATORS ?? '').trim()
}

/** True iff the flag enables every indicator passed in. */
export function shouldUseRustForIndicators(names: IndicatorName[]): boolean {
  const flag = readFlag()
  if (flag === '' || flag === 'off') return false

  const tokens = flag.split(',').map((s) => s.trim()).filter(Boolean)
  const hasStar = tokens.includes('*')
  const exclusions = new Set(
    tokens.filter((t) => t.startsWith('-')).map((t) => t.slice(1)),
  )
  const inclusions = new Set(tokens.filter((t) => !t.startsWith('-') && t !== '*'))

  for (const name of names) {
    if (hasStar) {
      if (exclusions.has(name)) return false
    } else if (!inclusions.has(name)) {
      return false
    }
  }
  return true
}

/** Convenience: every supported indicator is enabled. */
export function allRustEnabled(): boolean {
  const flag = readFlag()
  if (flag === '*') return true
  // "*" combined with no exclusions also counts.
  if (flag === '' || flag === 'off') return false
  const tokens = flag.split(',').map((s) => s.trim()).filter(Boolean)
  if (!tokens.includes('*')) return false
  return tokens.every((t) => t === '*' || !t.startsWith('-'))
}
