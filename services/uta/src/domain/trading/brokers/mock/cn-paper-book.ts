/**
 * Durable CN Local Paper book snapshot — cash, positions, T+1 locks, marks.
 *
 * Pending LMT freezes are intentionally omitted: open orders are still
 * in-memory on MockBroker and do not survive UTA restart (same as today).
 * Restoring freezes without the matching orders would understate buying power.
 */

import { z } from 'zod'

export const CN_PAPER_BOOK_VERSION = 1 as const

const decimalString = z.union([z.string().min(1), z.number()]).transform((v) => String(v))

export const cnPaperPositionSchema = z.object({
  nativeKey: z.string().min(1),
  quantity: decimalString,
  avgCost: decimalString,
  avgCostSource: z.enum(['broker', 'wallet']).optional(),
  market: z.enum(['sh', 'sz', 'bj']).optional(),
  name: z.string().optional(),
})

export const cnPaperBoughtTodaySchema = z.object({
  nativeKey: z.string().min(1),
  day: z.string().min(1),
  qty: decimalString,
})

export const cnPaperMarkSchema = z.object({
  nativeKey: z.string().min(1),
  price: decimalString,
})

export const cnPaperBookStateSchema = z.object({
  version: z.literal(CN_PAPER_BOOK_VERSION).default(CN_PAPER_BOOK_VERSION),
  cash: decimalString,
  positions: z.array(cnPaperPositionSchema).default([]),
  boughtToday: z.array(cnPaperBoughtTodaySchema).default([]),
  markPrices: z.array(cnPaperMarkSchema).default([]),
  updatedAt: z.string().optional(),
})

export type CnPaperBookState = z.infer<typeof cnPaperBookStateSchema>
export type CnPaperPositionRow = z.infer<typeof cnPaperPositionSchema>

/** Parse unknown JSON into a book state; throws ZodError on invalid shape. */
export function parseCnPaperBookState(raw: unknown): CnPaperBookState {
  return cnPaperBookStateSchema.parse(raw)
}
