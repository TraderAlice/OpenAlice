import type { GuardianTradingMode } from '@traderalice/guardian-runtime'

export type UTATransition = 'none' | 'start' | 'stop' | 'restart'

export function planUTATransition(
  mode: GuardianTradingMode,
  running: boolean,
): UTATransition {
  if (mode === 'lite') return running ? 'stop' : 'none'
  return running ? 'restart' : 'start'
}
