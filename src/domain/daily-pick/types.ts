/**
 * Daily-pick feature: types.
 *
 * One stock picked per trading day. Hourly StrategyCouncil deliberation
 * appends to the same file. After 5 trading days, a wrap-up summarizes
 * lessons learned which feed the next pick's RAG context.
 */

export type PickAction = 'BUY' | 'HOLD' | 'EXIT'
export type PickStatus = 'open' | 'closed'
export type HardRule = 'stop-loss' | 'take-profit' | null

export interface PickCandidate {
  symbol: string
  name?: string
  source: 'watchlist' | 'top-foreign-holdings'
  /** Free-form context string supplied to the picker prompt. */
  context?: string
}

export interface CouncilVerdicts {
  trend: string
  signal: string
  risk: string
}

export interface HourlyEntry {
  /** ISO-8601. */
  timestamp: string
  /** Local trading-time label, e.g. "09:00", "13:00". */
  hour: string
  /** Current price, decimal-as-string for precision. */
  price: string
  /** P&L since entry, percentage as string e.g. "+2.34". null until entryPrice set. */
  pnlPct: string | null
  /** Council's recommended action. */
  action: PickAction
  /** 0–100, council's combined confidence. */
  confidence: number
  /** Short rationale, 1–2 sentences. */
  reason: string
  /** Per-role verdicts from StrategyCouncil. */
  verdicts: CouncilVerdicts
  /** Non-null when a hard rule overrode the council. */
  hardRuleTriggered: HardRule
}

export interface DailyPick {
  /** Trading date in YYYY-MM-DD (Taipei timezone). */
  date: string
  symbol: string
  symbolName?: string
  /** ISO-8601 timestamp of the pick decision. */
  pickedAt: string
  /** Agent's narrative reason for choosing this stock. */
  pickReason: string
  /** All candidates the picker considered. */
  candidates: PickCandidate[]
  /** Lesson IDs from the RAG store consulted during picking. */
  pastLessonsConsulted: string[]
  /** Hourly council deliberations + hard-rule overrides. */
  hourly: HourlyEntry[]
  /** Set when first BUY action recommended. */
  entryPrice: string | null
  entryAt: string | null
  /** Set when EXIT action recommended (or hard rule fires). */
  exitPrice: string | null
  exitAt: string | null
  status: PickStatus
}

export interface Lesson {
  /** Stable ID — `${date}-${symbol}-${index}`. */
  id: string
  /** Date the lesson was extracted. */
  date: string
  symbol: string
  /** One-sentence takeaway. */
  lesson: string
  /** Tags for lexical retrieval. */
  tags: string[]
  /** Free-form supporting context (price action, decisions made). */
  context: string
  /** ISO-8601. */
  createdAt: string
}

export interface WrapInput {
  /** The 5 daily-pick records being summarized. */
  picks: DailyPick[]
  /** Inclusive start date (first pick). */
  startDate: string
  /** Inclusive end date (last pick). */
  endDate: string
}

export interface WrapResult {
  /** Markdown body persisted to disk. */
  markdown: string
  /** Extracted lessons appended to the RAG store. */
  lessons: Lesson[]
}
