import type { UTASummary } from '../api/types'

type UTAAccountCandidate = Pick<UTASummary, 'health'>

export function isAccountTierUTA(uta: UTAAccountCandidate): boolean {
  return uta.health.tier !== 'data'
}

export function filterAccountTierUTAs<T extends UTAAccountCandidate>(utas: readonly T[]): T[] {
  return utas.filter(isAccountTierUTA)
}

export function displayProviderForUTA(uta: { id: string; provider?: string }): string {
  if (uta.provider) return uta.provider
  const id = uta.id.toLowerCase()
  if (id.startsWith('alpaca')) return 'alpaca'
  if (id.startsWith('ibkr')) return 'ibkr'
  if (id.includes('binance') || id.includes('okx') || id.includes('bybit') || id.includes('bitget') || id.includes('ccxt')) return 'ccxt'
  return ''
}
