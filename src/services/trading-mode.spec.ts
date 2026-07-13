import { describe, expect, it } from 'vitest'
import { parseTradingModeEnv, resolveTradingModePolicy } from './trading-mode.js'
import type { Config, UTAConfig } from '@/core/config.js'

const config = (mode?: 'lite' | 'readonly' | 'pro'): Pick<Config, 'trading'> => ({
  trading: {
    ...(mode ? { mode } : {}),
    observeExternalOrdersEvery: '15m',
    keylessDataSources: [],
  },
})

const readUTAs = (utas: Partial<UTAConfig>[] = []) => async () => utas as UTAConfig[]

describe('trading mode policy', () => {
  it('env OPENALICE_TRADING_MODE wins over persisted config and accounts', async () => {
    const policy = await resolveTradingModePolicy(config('pro'), {
      env: { OPENALICE_TRADING_MODE: 'readonly' },
      readUTAs: readUTAs([{ id: 'alpaca' }]),
    })
    expect(policy).toMatchObject({ mode: 'readonly', source: 'env', envLocked: true, hasUTAConfig: true })
  })

  it('legacy lite env flags still force lite', () => {
    expect(parseTradingModeEnv({ OPENALICE_LITE_MODE: '1' })).toBe('lite')
    expect(parseTradingModeEnv({ OPENALICE_UTA_DISABLED: 'true' })).toBe('lite')
  })

  it('uses persisted mode when env is absent', async () => {
    await expect(resolveTradingModePolicy(config('readonly'), {
      env: {},
      readUTAs: readUTAs([]),
    })).resolves.toMatchObject({ mode: 'readonly', source: 'config', envLocked: false })
  })

  it('auto defaults to pro only when UTA config exists', async () => {
    await expect(resolveTradingModePolicy(config(), {
      env: {},
      readUTAs: readUTAs([{ id: 'okx' }]),
    })).resolves.toMatchObject({ mode: 'pro', source: 'auto', hasUTAConfig: true })
    await expect(resolveTradingModePolicy(config(), {
      env: {},
      readUTAs: readUTAs([]),
    })).resolves.toMatchObject({ mode: 'lite', source: 'auto', hasUTAConfig: false })
  })
})
