/**
 * 0009_seal_broker_credentials — seal the plaintext accounts.json at rest.
 *
 * Broker credentials lived as plaintext JSON in data/config/accounts.json.
 * The store is now sealed (AES-256-GCM envelope, machine-bound key at
 * <userDataHome>/sealing.key — see src/core/sealing.ts). The read/write
 * path already handles both shapes; this migration makes sealing EAGER at
 * first boot after upgrade, so plaintext credentials don't linger on disk
 * until the next config change happens to rewrite the file.
 *
 * Also tightens the file to owner-only (0600), matching every future write.
 *
 * Idempotent: a sealed envelope (or a missing file) is a no-op. Non-array
 * non-envelope content is left untouched for a human to look at — sealing
 * unrecognized bytes would just bury the problem.
 */

import { writeFile, chmod } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Migration } from '../types.js'
import { isSealedEnvelope, seal } from '@/core/sealing.js'

const FILENAME = 'accounts.json'

export const migration: Migration = {
  id: '0009_seal_broker_credentials',
  appVersion: '0.41.0-beta.2',
  introducedAt: '2026-06-11',
  affects: ['accounts.json'],
  summary: 'Seal broker credentials at rest (AES-256-GCM envelope + 0600), replacing plaintext accounts.json',
  up: async (ctx) => {
    const raw = await ctx.readJson(FILENAME)
    if (raw === undefined) return // fresh install — read path seeds sealed
    if (isSealedEnvelope(raw)) return // already at target shape
    if (!Array.isArray(raw)) return // unrecognized — leave for a human

    const path = resolve(ctx.configDir(), FILENAME)
    await writeFile(path, JSON.stringify(await seal(raw), null, 2) + '\n', { mode: 0o600 })
    await chmod(path, 0o600).catch(() => { /* noop — platform without chmod */ })
  },
}
