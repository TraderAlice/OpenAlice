import type { Config, UTAConfig } from '@/core/config.js'
import { readUTAsConfig } from '@/core/config.js'
import { isUTADisabled } from './uta-supervisor/url.js'

export const TRADING_MODES = ['lite', 'readonly', 'pro'] as const
export type TradingMode = typeof TRADING_MODES[number]
export type TradingModeSource = 'env' | 'config' | 'auto'

export interface TradingModePolicy {
  mode: TradingMode
  source: TradingModeSource
  envLocked: boolean
  hasUTAConfig: boolean
}

export function parseTradingMode(raw: unknown): TradingMode | null {
  if (typeof raw !== 'string') return null
  const normalized = raw.trim().toLowerCase()
  return (TRADING_MODES as readonly string[]).includes(normalized)
    ? normalized as TradingMode
    : null
}

export function parseTradingModeEnv(env: NodeJS.ProcessEnv = process.env): TradingMode | null {
  const explicit = parseTradingMode(env['OPENALICE_TRADING_MODE'])
  if (explicit) return explicit
  return isUTADisabled(env) ? 'lite' : null
}

export async function resolveTradingModePolicy(
  config: Pick<Config, 'trading'>,
  opts: {
    env?: NodeJS.ProcessEnv
    readUTAs?: () => Promise<UTAConfig[]>
  } = {},
): Promise<TradingModePolicy> {
  const env = opts.env ?? process.env
  const readUTAs = opts.readUTAs ?? readUTAsConfig
  const configuredMode = parseTradingMode(config.trading.mode)
  const envMode = parseTradingModeEnv(env)
  const utas = await readUTAs().catch(() => [])
  const hasUTAConfig = utas.length > 0

  if (envMode) {
    return { mode: envMode, source: 'env', envLocked: true, hasUTAConfig }
  }
  if (configuredMode) {
    return { mode: configuredMode, source: 'config', envLocked: false, hasUTAConfig }
  }
  return { mode: hasUTAConfig ? 'pro' : 'lite', source: 'auto', envLocked: false, hasUTAConfig }
}

export function describeTradingMode(mode: TradingMode): string {
  switch (mode) {
    case 'lite':
      return 'Lite mode keeps UTA disconnected. Switch to readonly or pro to use broker-backed trading surfaces.'
    case 'readonly':
      return 'Readonly mode connects UTA for account analysis but blocks venue-mutating broker writes.'
    case 'pro':
      return 'Pro mode enables UTA with per-account permissions.'
  }
}

export function liteUnavailableReason(policy: Pick<TradingModePolicy, 'mode'>): string | undefined {
  return policy.mode === 'lite'
    ? 'Trading mode is lite; UTA is disabled until the mode is switched to readonly or pro.'
    : undefined
}

export function readonlyMutationReason(policy: Pick<TradingModePolicy, 'mode'>): string | undefined {
  return policy.mode === 'readonly'
    ? 'Trading mode is readonly; venue-mutating broker writes are disabled.'
    : undefined
}
