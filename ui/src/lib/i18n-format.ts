import i18n from '../i18n'

export const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$', HKD: 'HK$', EUR: '€', GBP: '£', JPY: 'JP¥',
  CNY: '¥', CNH: '¥', CAD: 'C$', AUD: 'A$', CHF: 'CHF',
  SGD: 'S$', KRW: '₩', INR: '₹', TWD: 'NT$', BRL: 'R$',
}

export function currencySymbol(currency?: string): string {
  if (!currency) return '$'
  return CURRENCY_SYMBOLS[currency.toUpperCase()] ?? `${currency} `
}

export const UNSET_DECIMAL_STR = '1.70141183460469231731687303715884105727e+38'

export function isUnsetDecimal(v: number | string | undefined | null): boolean {
  return v === UNSET_DECIMAL_STR || v === Number(UNSET_DECIMAL_STR)
}

function toFiniteNumber(input: number | string | undefined | null): number | null {
  if (input == null) return null
  const n = typeof input === 'number' ? input : Number(input)
  return Number.isFinite(n) ? n : null
}

export function getCurrentLocale(): string {
  const lng = i18n.language
  if (lng.startsWith('zh')) return 'zh-CN'
  return 'en-US'
}

export function isZhLocale(): boolean {
  return getCurrentLocale().startsWith('zh')
}

export function fmt(input: number | string | undefined | null, currency?: string): string {
  const n = toFiniteNumber(input)
  if (n == null) return '—'
  const sym = currencySymbol(currency)
  const locale = getCurrentLocale()
  return `${sym}${n.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function fmtPnl(input: number | string | undefined | null, currency?: string): string {
  const n = toFiniteNumber(input)
  if (n == null) return '—'
  const sym = currencySymbol(currency)
  const sign = n >= 0 ? '+' : '-'
  const abs = Math.abs(n)
  const locale = getCurrentLocale()
  return `${sign}${sym}${abs.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function fmtNum(input: number | string | undefined | null): string {
  const n = toFiniteNumber(input)
  if (n == null) return '—'
  const locale = getCurrentLocale()
  return Math.abs(n) >= 1
    ? n.toLocaleString(locale, { maximumFractionDigits: 4 })
    : n.toPrecision(4)
}

export function fmtPctSigned(pct: number | undefined | null, digits = 2): string {
  if (pct == null || !Number.isFinite(pct)) return '—'
  const sign = pct >= 0 ? '+' : ''
  return `${sign}${pct.toFixed(digits)}%`
}

export function fmtNumber(n: unknown, digits = 2): string {
  if (n == null || typeof n !== 'number' || !Number.isFinite(n)) return '—'
  const locale = getCurrentLocale()
  return n.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export function fmtInt(n: unknown): string {
  if (n == null || typeof n !== 'number' || !Number.isFinite(n)) return '—'
  const locale = getCurrentLocale()
  return Math.round(n).toLocaleString(locale)
}

export function fmtMoneyShort(n: unknown): string {
  if (n == null || typeof n !== 'number' || !Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (isZhLocale()) {
    if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(2)}万亿`
    if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(2)}亿`
    if (abs >= 1e4) return `${sign}${(abs / 1e4).toFixed(2)}万`
    return `${sign}${abs.toFixed(2)}`
  }
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(2)}T`
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}K`
  return `${sign}${abs.toFixed(2)}`
}

export function fmtPercent(n: unknown, digits = 2): string {
  if (n == null || typeof n !== 'number' || !Number.isFinite(n)) return '—'
  const locale = getCurrentLocale()
  const pct = n * 100
  return `${pct.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`
}

export function fmtDate(date: Date | string | number): string {
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date
  const locale = getCurrentLocale()
  return d.toLocaleString(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

export function fmtDateShort(date: Date | string | number): string {
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date
  const locale = getCurrentLocale()
  return d.toLocaleDateString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function fmtTime(date: Date | string | number): string {
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date
  const locale = getCurrentLocale()
  return d.toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}
