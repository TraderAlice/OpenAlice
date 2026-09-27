/**
 * End-of-day signal table contract for cn-paper / UTA closed-loop dry runs.
 *
 * Research rules stay outside UTA; this is the hand-off shape:
 *   signal table → (script or manual) → placeOrder on cn-paper → reconcile.
 *
 * Sleeve note: when the operator chooses a ¥70_000 sleeve on a ¥1_000_000
 * paper account, `sleeveCny` records that choice — it is not enforced here.
 */

import { z } from 'zod'

export const CN_EOD_SIGNAL_SCHEMA_VERSION = 1 as const

export const cnEodSignalActionSchema = z.enum(['BUY', 'SELL', 'HOLD', 'TARGET'])

export const cnEodSignalRowSchema = z.object({
  /** Asia/Shanghai trading day the signal applies to (YYYY-MM-DD). */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** UTA account id or display name (e.g. cn-paper). */
  account: z.string().min(1),
  /** Nominal sleeve in CNY (operator choice; e.g. 70000). */
  sleeveCny: z.number().positive(),
  /** Bare 6-digit or dotted CN symbol (e.g. 600036 / 513100.SH). */
  symbol: z.string().min(1),
  action: cnEodSignalActionSchema,
  /**
   * Absolute share qty for BUY/SELL.
   * For TARGET, preferred over weight when both set.
   */
  qty: z.number().nonnegative().optional(),
  /** Target shares for action=TARGET (rounded to lot on buy by the bridge). */
  targetQty: z.number().nonnegative().optional(),
  /** Target weight of sleeve in [0, 1] when targetQty omitted. */
  targetWeight: z.number().min(0).max(1).optional(),
  /** Optional limit; omit for MKT on paper. */
  limitPrice: z.number().positive().optional(),
  /** Short human reason (also fine as UTA commit message seed). */
  reason: z.string().min(1),
  /** Idempotency key — same signalId must not double-fire. */
  signalId: z.string().min(1),
}).superRefine((row, ctx) => {
  if (row.action === 'BUY' || row.action === 'SELL') {
    if (row.qty == null || row.qty <= 0) {
      ctx.addIssue({ code: 'custom', message: `${row.action} requires qty > 0`, path: ['qty'] })
    }
  }
  if (row.action === 'TARGET' && row.targetQty == null && row.targetWeight == null) {
    ctx.addIssue({
      code: 'custom',
      message: 'TARGET requires targetQty or targetWeight',
      path: ['targetQty'],
    })
  }
})

export const cnEodSignalTableSchema = z.object({
  schemaVersion: z.literal(CN_EOD_SIGNAL_SCHEMA_VERSION),
  /** When the table was produced (ISO). */
  generatedAt: z.string().min(1),
  rows: z.array(cnEodSignalRowSchema).min(1),
})

export type CnEodSignalRow = z.infer<typeof cnEodSignalRowSchema>
export type CnEodSignalTable = z.infer<typeof cnEodSignalTableSchema>

/** Example table for the 600036 + 513100 sleeve dry-run (illustrative only). */
export const CN_EOD_SIGNAL_EXAMPLE: CnEodSignalTable = {
  schemaVersion: 1,
  generatedAt: '2026-09-29T07:05:00.000Z',
  rows: [
    {
      date: '2026-09-29',
      account: 'cn-paper',
      sleeveCny: 70_000,
      symbol: '600036',
      action: 'TARGET',
      targetWeight: 0.6,
      reason: 'layer-2 add CMB',
      signalId: '2026-09-29:600036:target-0.6',
    },
    {
      date: '2026-09-29',
      account: 'cn-paper',
      sleeveCny: 70_000,
      symbol: '513100',
      action: 'TARGET',
      targetWeight: 0.4,
      reason: 'park idle in NDX ETF',
      signalId: '2026-09-29:513100:target-0.4',
    },
  ],
}
