/**
 * Daily picker — chooses one stock for the trading day.
 *
 * Strategy:
 *   1. Build candidate pool: watchlist ∪ top foreign holdings (up to 30).
 *   2. Query lessons RAG with today's market context for "past mistakes".
 *   3. Ask agent to pick 1 with structured rationale.
 *   4. Persist to daily file.
 */

import type { AgentCenter } from '../../core/agent-center.js'
import type { TwstockMcpClient } from '../twstock/client.js'
import type { DailyPick, PickCandidate } from './types.js'
import { readWatchlist, writeDailyPick, searchLessons } from './store.js'
import { todayInTaipei, nowIso } from './time.js'

export interface PickerDeps {
  agentCenter: AgentCenter
  /** Optional: when missing, falls back to watchlist-only candidate pool. */
  twstockClient?: TwstockMcpClient | null
}

export class DailyPicker {
  constructor(private deps: PickerDeps) {}

  async pick(): Promise<DailyPick> {
    const date = todayInTaipei()
    const candidates = await this.buildCandidatePool()

    if (candidates.length === 0) {
      throw new Error('Daily picker: no candidates — add to watchlist or check twstock connection')
    }

    const lessons = await searchLessons('TWSE 台股 進場 退場 風險', 5)

    const prompt = this.buildPrompt(candidates, lessons)
    const result = await this.deps.agentCenter.ask(prompt)
    const parsed = parsePickerResponse(result.text, candidates)

    const pick: DailyPick = {
      date,
      symbol: parsed.symbol,
      symbolName: candidates.find((c) => c.symbol === parsed.symbol)?.name,
      pickedAt: nowIso(),
      pickReason: parsed.reason,
      candidates,
      pastLessonsConsulted: lessons.map((l) => l.id),
      hourly: [],
      entryPrice: null,
      entryAt: null,
      exitPrice: null,
      exitAt: null,
      status: 'open',
    }

    await writeDailyPick(pick)
    return pick
  }

  private async buildCandidatePool(): Promise<PickCandidate[]> {
    const watchlist = await readWatchlist()
    const fromWatchlist: PickCandidate[] = watchlist.map((w) => ({
      symbol: w.symbol,
      name: w.name,
      source: 'watchlist',
      context: w.note,
    }))

    const fromHoldings = await this.fetchTopForeignHoldings()

    // Dedupe: prefer watchlist entry over holdings entry for the same symbol.
    const seen = new Set<string>()
    const pool: PickCandidate[] = []
    for (const c of [...fromWatchlist, ...fromHoldings]) {
      if (seen.has(c.symbol)) continue
      seen.add(c.symbol)
      pool.push(c)
    }
    return pool.slice(0, 30)
  }

  private async fetchTopForeignHoldings(): Promise<PickCandidate[]> {
    const client = this.deps.twstockClient
    if (!client) return []
    try {
      const raw = await client.callTool('get_top_foreign_holdings', {})
      return parseTopForeignHoldings(raw)
    } catch (err) {
      console.warn('[daily-picker] top foreign holdings fetch failed:', err instanceof Error ? err.message : err)
      return []
    }
  }

  private buildPrompt(candidates: PickCandidate[], lessons: Awaited<ReturnType<typeof searchLessons>>): string {
    const candidateLines = candidates
      .map((c, i) => {
        const tag = c.source === 'watchlist' ? '[WL]' : '[FH]'
        const note = c.context ? ` — ${c.context}` : ''
        return `${i + 1}. ${tag} ${c.symbol}${c.name ? ` ${c.name}` : ''}${note}`
      })
      .join('\n')

    const lessonsBlock =
      lessons.length === 0
        ? '(no prior lessons recorded yet)'
        : lessons.map((l) => `- [${l.date} ${l.symbol}] ${l.lesson} (tags: ${l.tags.join(', ')})`).join('\n')

    return [
      'You are an experienced TWSE day-trader picking ONE stock to focus on for today.',
      '',
      `Date: ${todayInTaipei()} (Taipei trading day)`,
      '',
      'Candidate pool (WL = watchlist, FH = top-foreign-holdings):',
      candidateLines,
      '',
      'Past lessons from prior 5-day wraps (most relevant first):',
      lessonsBlock,
      '',
      'Pick exactly ONE symbol from the pool. Avoid repeating mistakes called out above.',
      '',
      'Reply STRICTLY in this format and nothing else:',
      '',
      'SYMBOL: <stock_code>',
      'REASON: <one paragraph, 2-4 sentences, in Traditional Chinese>',
    ].join('\n')
  }
}

// ==================== Helpers ====================

interface ParsedPick {
  symbol: string
  reason: string
}

function parsePickerResponse(text: string, candidates: PickCandidate[]): ParsedPick {
  const symbolMatch = text.match(/SYMBOL:\s*([A-Za-z0-9]+)/i)
  const reasonMatch = text.match(/REASON:\s*([\s\S]+?)$/i)

  const valid = new Set(candidates.map((c) => c.symbol))
  const symbol = symbolMatch?.[1]?.trim() ?? ''
  if (!symbol || !valid.has(symbol)) {
    // Fall back to first candidate; caller's history shows the raw response.
    return {
      symbol: candidates[0].symbol,
      reason: `Picker response could not be parsed cleanly; defaulted to first candidate. Raw: ${text.slice(0, 200)}`,
    }
  }

  return {
    symbol,
    reason: reasonMatch?.[1]?.trim() || '(no reason provided)',
  }
}

/**
 * The twstock MCP returns various shapes depending on tool — best effort
 * extract a list of `{symbol, name?}`. Unknown shapes return an empty list.
 */
function parseTopForeignHoldings(raw: unknown): PickCandidate[] {
  if (!raw || typeof raw !== 'object') return []
  const obj = raw as Record<string, unknown>
  const data = (obj['data'] ?? obj['content'] ?? raw) as unknown
  const arr = Array.isArray(data) ? data : []

  const out: PickCandidate[] = []
  for (const row of arr) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    const symbol = String(r['SecuritiesCompanyCode'] ?? r['StockCode'] ?? r['Code'] ?? r['symbol'] ?? '').trim()
    const name = String(r['CompanyName'] ?? r['Name'] ?? r['name'] ?? '').trim() || undefined
    if (!symbol) continue
    out.push({ symbol, name, source: 'top-foreign-holdings' })
  }
  return out
}
