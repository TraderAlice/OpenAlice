import { create } from 'zustand'
import { api } from '../api'
import type { AppConfig, TradingMode } from '../api/types'
import type { TradingServiceStatus } from '../api/trading'
import { reloadOnHotUpdate } from '../lib/hmr'

reloadOnHotUpdate('live/trading-mode')

const FALLBACK_STATUS: TradingServiceStatus = {
  available: false,
  state: 'unavailable',
  mode: 'lite',
  modeSource: 'auto',
  envLocked: false,
  hasUTAConfig: false,
  reason: 'status_unreachable',
  hint: 'Trading service status is not reachable.',
}

interface TradingModeState {
  status: TradingServiceStatus
  loading: boolean
  saving: TradingMode | null
  error: string | null
  refresh: () => Promise<void>
  setMode: (mode: TradingMode) => Promise<void>
}

export const useTradingMode = create<TradingModeState>((set, get) => ({
  status: FALLBACK_STATUS,
  loading: true,
  saving: null,
  error: null,

  refresh: async () => {
    try {
      const status = await api.trading.status()
      set({ status, loading: false, error: null })
    } catch (err) {
      set({
        status: FALLBACK_STATUS,
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load trading mode',
      })
    }
  },

  setMode: async (mode) => {
    const { status } = get()
    if (status.envLocked) return
    set({ saving: mode, error: null })
    try {
      const config = await api.config.load()
      await api.config.updateSection('trading', {
        ...tradingConfig(config),
        mode,
      })
      await get().refresh()
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to save trading mode' })
      throw err
    } finally {
      set({ saving: null })
    }
  },
}))

function tradingConfig(config: AppConfig): AppConfig['trading'] {
  return config.trading ?? { observeExternalOrdersEvery: '15m', keylessDataSources: [] }
}

let started = false

export function ensureTradingModePolling(): void {
  if (started) return
  started = true
  void useTradingMode.getState().refresh()
  window.setInterval(() => {
    void useTradingMode.getState().refresh()
  }, 15_000)
}
