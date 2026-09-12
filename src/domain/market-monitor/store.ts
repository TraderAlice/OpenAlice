import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { dataPath } from '../../core/paths.js'
import type {
  MarketMonitorAlert,
  MarketMonitorAsset,
  MarketMonitorReceipt,
  MarketMonitorSettings,
  MarketMonitorSnapshot,
} from './types.js'
import { DEFAULT_MARKET_MONITOR_SETTINGS } from './types.js'

const ROOT = dataPath('market-monitor')
const SETTINGS_FILE = `${ROOT}/settings.json`
const SNAPSHOTS_FILE = `${ROOT}/observations.jsonl`
const ALERTS_FILE = `${ROOT}/alerts.jsonl`
const RECEIPTS_FILE = `${ROOT}/receipts.jsonl`

async function ensureParent(file: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
}

async function appendJsonLine(file: string, value: unknown): Promise<void> {
  await ensureParent(file)
  await appendFile(file, `${JSON.stringify(value)}\n`, 'utf8')
}

async function readJsonLines<T>(file: string): Promise<T[]> {
  try {
    const text = await readFile(file, 'utf8')
    return text.split('\n').filter(Boolean).flatMap((line) => {
      try { return [JSON.parse(line) as T] } catch { return [] }
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

export interface MarketMonitorStore {
  settings(): Promise<MarketMonitorSettings>
  saveSettings(settings: MarketMonitorSettings): Promise<void>
  snapshots(asset?: MarketMonitorAsset, limit?: number): Promise<MarketMonitorSnapshot[]>
  appendSnapshot(snapshot: MarketMonitorSnapshot): Promise<void>
  alerts(asset?: MarketMonitorAsset, limit?: number): Promise<MarketMonitorAlert[]>
  appendAlert(alert: MarketMonitorAlert): Promise<void>
  receipts(asset?: MarketMonitorAsset, limit?: number): Promise<MarketMonitorReceipt[]>
  appendReceipt(receipt: MarketMonitorReceipt): Promise<void>
  latestSeries(asset: MarketMonitorAsset): Promise<MarketMonitorSnapshot['chart'] | null>
  saveLatestSeries(asset: MarketMonitorAsset, chart: MarketMonitorSnapshot['chart']): Promise<void>
}

export function createMarketMonitorStore(): MarketMonitorStore {
  return {
    async settings() {
      try {
        const saved = JSON.parse(await readFile(SETTINGS_FILE, 'utf8')) as Partial<MarketMonitorSettings>
        return { ...DEFAULT_MARKET_MONITOR_SETTINGS, ...saved }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) {
          return { ...DEFAULT_MARKET_MONITOR_SETTINGS }
        }
        throw error
      }
    },
    async saveSettings(settings) {
      await ensureParent(SETTINGS_FILE)
      const temp = `${SETTINGS_FILE}.${process.pid}.tmp`
      await writeFile(temp, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
      await rename(temp, SETTINGS_FILE)
    },
    async snapshots(asset, limit = 100) {
      const rows = await readJsonLines<MarketMonitorSnapshot>(SNAPSHOTS_FILE)
      return rows.filter((row) => !asset || row.asset === asset).slice(-Math.max(1, Math.min(1000, limit)))
    },
    appendSnapshot: (snapshot) => appendJsonLine(SNAPSHOTS_FILE, snapshot),
    async alerts(asset, limit = 100) {
      const rows = await readJsonLines<MarketMonitorAlert>(ALERTS_FILE)
      return rows.filter((row) => !asset || row.asset === asset).slice(-Math.max(1, Math.min(1000, limit)))
    },
    appendAlert: (alert) => appendJsonLine(ALERTS_FILE, alert),
    async receipts(asset, limit = 100) {
      const rows = await readJsonLines<MarketMonitorReceipt>(RECEIPTS_FILE)
      return rows.filter((row) => !asset || row.asset === asset).slice(-Math.max(1, Math.min(1000, limit)))
    },
    appendReceipt: (receipt) => appendJsonLine(RECEIPTS_FILE, receipt),
    async latestSeries(asset) {
      try { return JSON.parse(await readFile(`${ROOT}/series-${asset.toLowerCase()}.json`, 'utf8')) as MarketMonitorSnapshot['chart'] }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return null
        throw error
      }
    },
    async saveLatestSeries(asset, chart) {
      const file = `${ROOT}/series-${asset.toLowerCase()}.json`
      await ensureParent(file)
      const temp = `${file}.${process.pid}.tmp`
      await writeFile(temp, `${JSON.stringify(chart)}\n`, 'utf8')
      await rename(temp, file)
    },
  }
}
