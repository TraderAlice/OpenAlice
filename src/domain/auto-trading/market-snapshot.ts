import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'

const signalRowSchema = z
  .object({
    all_clear: z.boolean().optional(),
    suggested_stop_loss: z.number().optional(),
    price: z.number().optional(),
  })
  .passthrough()

const looseSchema = z
  .object({
    updated_at: z.string().optional(),
    CIRCUIT_BREAKER: z.string().optional(),
    signals: z.record(z.string(), signalRowSchema).optional(),
    market_context: z
      .object({
        fear_greed_index: z
          .object({
            value: z.number().nullable().optional(),
            label: z.string().nullable().optional(),
          })
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()

export type MarketSnapshotSlice = z.infer<typeof looseSchema>
export type MarketSnapshotSignalRow = z.infer<typeof signalRowSchema>

/** Writer runs every 5 minutes; 15 minutes allows one missed cycle plus delay. */
export const MARKET_SNAPSHOT_MAX_AGE_MS = 15 * 60 * 1000

/**
 * Returns true when updated_at is present and older than maxAgeMs.
 * Missing updated_at is treated as fresh (unknown-age snapshots are not blocked).
 */
export function isSnapshotStale(snap: MarketSnapshotSlice, maxAgeMs: number): boolean {
  if (!snap.updated_at) return false
  const ts = Date.parse(snap.updated_at)
  if (Number.isNaN(ts)) return false
  return Date.now() - ts > maxAgeMs
}

export async function readMarketSnapshotFile(
  pathFromCwd: string,
): Promise<MarketSnapshotSlice | undefined> {
  const abs = resolve(pathFromCwd)
  try {
    const raw = JSON.parse(await readFile(abs, 'utf-8')) as unknown
    const parsed = looseSchema.safeParse(raw)
    return parsed.success ? parsed.data : undefined
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      'code' in err &&
      (err as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      return undefined
    }
    throw err
  }
}
