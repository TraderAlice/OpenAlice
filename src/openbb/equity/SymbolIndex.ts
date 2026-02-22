/**
 * Equity Symbol Index — 本地正则搜索
 *
 * 为了让 AI 能用正则/关键词搜索 equity symbol，我们在启动时从 OpenBB API
 * 拉取全量 symbol 列表并缓存到 data/cache/equity/symbols.json。
 * 搜索在本地内存中进行，不依赖 API 的搜索能力。
 *
 * 当前缓存的数据源（免费，不需要 API key）：
 * - SEC (sec): ~10,000 美股上市公司，来自 SEC EDGAR
 * - TMX (tmx): ~3,600 加拿大上市公司，来自多伦多交易所
 *
 * 扩展方法：在 SOURCES 数组中添加新的 provider 即可。
 * 需要 API key 的 provider（intrinio, nasdaq, tradier）暂未接入。
 */

import { readFile, writeFile, mkdir } from 'fs/promises'
import { resolve, dirname } from 'path'
import type { OpenBBEquityClient } from './client'

// ==================== Types ====================

export interface SymbolEntry {
  symbol: string
  name: string
  source: string  // 来源 provider，如 "sec"、"tmx"
  [key: string]: unknown
}

interface CacheEnvelope {
  cachedAt: string
  sources: string[]
  count: number
  entries: SymbolEntry[]
}

// ==================== Config ====================

/** 免费 provider 列表 — 扩展时在这里加 */
const SOURCES = ['sec', 'tmx'] as const

const CACHE_FILE = resolve('data/cache/equity/symbols.json')
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

// ==================== SymbolIndex ====================

export class SymbolIndex {
  private entries: SymbolEntry[] = []

  /** 索引大小 */
  get size(): number {
    return this.entries.length
  }

  /**
   * 加载 symbol 索引。
   *
   * 优先从磁盘缓存加载（<24h），否则从 OpenBB API 拉取全量列表。
   * API 失败时降级到过期缓存。全部失败则以空索引启动（不中断）。
   */
  async load(client: OpenBBEquityClient): Promise<void> {
    // 1. 尝试读缓存
    const cached = await this.readCache()
    if (cached && !this.isExpired(cached.cachedAt)) {
      this.entries = cached.entries
      console.log(`equity: loaded ${this.entries.length} symbols from cache (${cached.sources.join(', ')})`)
      return
    }

    // 2. 从 API 拉取
    try {
      const entries = await this.fetchFromApi(client)
      this.entries = entries
      await this.writeCache(entries)
      console.log(`equity: fetched ${entries.length} symbols from API (${SOURCES.join(', ')})`)
      return
    } catch (err) {
      console.warn('equity: API fetch failed:', err)
    }

    // 3. 降级到过期缓存
    if (cached) {
      this.entries = cached.entries
      console.warn(`equity: using expired cache (${cached.cachedAt}), ${this.entries.length} symbols`)
      return
    }

    // 4. 无缓存可用
    console.warn('equity: no symbol data available, starting with empty index')
  }

  /**
   * 用正则表达式搜索 symbol 和公司名称。
   *
   * - pattern 作为 RegExp（case-insensitive）同时匹配 symbol 和 name
   * - 正则编译失败时降级为子串匹配
   */
  search(pattern: string, limit = 20): SymbolEntry[] {
    let test: (s: string) => boolean

    try {
      const re = new RegExp(pattern, 'i')
      test = (s) => re.test(s)
    } catch {
      // 正则语法错误 → 降级为 case-insensitive 子串匹配
      const lower = pattern.toLowerCase()
      test = (s) => s.toLowerCase().includes(lower)
    }

    const results: SymbolEntry[] = []
    for (const entry of this.entries) {
      if (test(entry.symbol) || test(entry.name)) {
        results.push(entry)
        if (results.length >= limit) break
      }
    }
    return results
  }

  /** 精确匹配 symbol（case-insensitive） */
  resolve(symbol: string): SymbolEntry | undefined {
    const upper = symbol.toUpperCase()
    return this.entries.find((e) => e.symbol.toUpperCase() === upper)
  }

  // ==================== Internal ====================

  private async fetchFromApi(client: OpenBBEquityClient): Promise<SymbolEntry[]> {
    const allEntries: SymbolEntry[] = []
    const seen = new Set<string>()

    for (const source of SOURCES) {
      try {
        const results = await client.search({ query: '', provider: source })
        for (const r of results) {
          const symbol = (r as Record<string, unknown>).symbol as string | undefined
          if (symbol && !seen.has(symbol)) {
            seen.add(symbol)
            allEntries.push({
              ...(r as Record<string, unknown>),
              symbol,
              name: ((r as Record<string, unknown>).name as string) ?? '',
              source,
            })
          }
        }
        console.log(`equity: ${source} → ${results.length} symbols`)
      } catch (err) {
        console.warn(`equity: failed to fetch from ${source}:`, err)
      }
    }

    if (allEntries.length === 0) {
      throw new Error('All sources returned empty')
    }

    return allEntries
  }

  private async readCache(): Promise<CacheEnvelope | null> {
    try {
      const raw = await readFile(CACHE_FILE, 'utf-8')
      return JSON.parse(raw) as CacheEnvelope
    } catch {
      return null
    }
  }

  private async writeCache(entries: SymbolEntry[]): Promise<void> {
    try {
      await mkdir(dirname(CACHE_FILE), { recursive: true })
      const envelope: CacheEnvelope = {
        cachedAt: new Date().toISOString(),
        sources: [...SOURCES],
        count: entries.length,
        entries,
      }
      await writeFile(CACHE_FILE, JSON.stringify(envelope))
    } catch {
      // 缓存写入失败不中断
    }
  }

  private isExpired(cachedAt: string): boolean {
    return Date.now() - new Date(cachedAt).getTime() > CACHE_TTL_MS
  }
}
