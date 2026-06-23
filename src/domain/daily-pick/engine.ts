/**
 * DailyPickEngine — public façade that bundles picker, analyzer, and wrap.
 *
 * Exposed so HTTP routes (manual run-now buttons) and the cron listener
 * can both invoke the same logic.
 */

import type { AgentCenter } from '../../core/agent-center.js'
import type { StrategyCouncil } from '../../core/strategy-council/index.js'
import type { TwstockMcpClient } from '../twstock/client.js'
import { DailyPicker } from './picker.js'
import { HourlyAnalyzer } from './analyzer.js'
import { WrapWriter } from './wrap.js'
import {
  readDailyPick,
  listRecentPicks,
  readWatchlist,
  writeWatchlist,
  readAllLessons,
  searchLessons,
  listWraps,
  readWrap,
  type WatchlistEntry,
} from './store.js'
import type { DailyPick, Lesson, WrapResult } from './types.js'
import { todayInTaipei } from './time.js'

export interface DailyPickEngineDeps {
  agentCenter: AgentCenter
  strategyCouncil: StrategyCouncil
  twstockClient?: TwstockMcpClient | null
  fugleClient?: TwstockMcpClient | null
}

export class DailyPickEngine {
  private picker: DailyPicker
  private analyzer: HourlyAnalyzer
  private wrap: WrapWriter

  constructor(private deps: DailyPickEngineDeps) {
    this.picker = new DailyPicker({
      agentCenter: deps.agentCenter,
      twstockClient: deps.twstockClient ?? null,
    })
    this.analyzer = new HourlyAnalyzer({
      strategyCouncil: deps.strategyCouncil,
      // Prefer fugle for live quotes; fall back to twstock.
      quoteClient: deps.fugleClient ?? deps.twstockClient ?? null,
    })
    this.wrap = new WrapWriter({ agentCenter: deps.agentCenter })
  }

  // ==================== Pick lifecycle ====================

  /** Pick today's stock if not already picked. Returns the pick (existing or new). */
  async pickToday(): Promise<DailyPick> {
    const existing = await readDailyPick(todayInTaipei())
    if (existing) return existing
    return this.picker.pick()
  }

  /**
   * Override the agent's pick (or seed today's pick) with a user-chosen symbol.
   * Existing hourly entries are kept if the symbol is unchanged; otherwise
   * the slot is reset since the new symbol has its own price/decisions.
   */
  async overridePick(symbol: string, name: string | undefined, reason: string): Promise<DailyPick> {
    const date = todayInTaipei()
    const existing = await readDailyPick(date)
    const sameSymbol = existing?.symbol === symbol

    const pick: DailyPick = {
      date,
      symbol,
      symbolName: name ?? existing?.symbolName,
      pickedAt: new Date().toISOString(),
      pickReason: reason,
      candidates: existing?.candidates ?? [{ symbol, name, source: 'watchlist' }],
      pastLessonsConsulted: existing?.pastLessonsConsulted ?? [],
      hourly: sameSymbol ? existing!.hourly : [],
      entryPrice: sameSymbol ? existing!.entryPrice : null,
      entryAt: sameSymbol ? existing!.entryAt : null,
      exitPrice: sameSymbol ? existing!.exitPrice : null,
      exitAt: sameSymbol ? existing!.exitAt : null,
      status: sameSymbol ? existing!.status : 'open',
    }

    const { writeDailyPick } = await import('./store.js')
    await writeDailyPick(pick)
    return pick
  }

  async runHourly(): Promise<DailyPick | null> {
    await this.analyzer.runOnce()
    return readDailyPick(todayInTaipei())
  }

  async runWrap(): Promise<WrapResult | null> {
    return this.wrap.writeForLast5()
  }

  // ==================== Read-side (used by HTTP routes / UI) ====================

  async getToday(): Promise<DailyPick | null> {
    return readDailyPick(todayInTaipei())
  }

  async getRecent(limit = 10): Promise<DailyPick[]> {
    return listRecentPicks(limit)
  }

  async getWatchlist(): Promise<WatchlistEntry[]> {
    return readWatchlist()
  }

  async setWatchlist(entries: WatchlistEntry[]): Promise<void> {
    return writeWatchlist(entries)
  }

  async getLessons(): Promise<Lesson[]> {
    return readAllLessons()
  }

  async searchLessons(query: string, limit?: number): Promise<Lesson[]> {
    return searchLessons(query, limit)
  }

  async listWrapFiles(): Promise<string[]> {
    return listWraps()
  }

  async readWrapFile(endDate: string): Promise<string | null> {
    return readWrap(endDate)
  }
}
