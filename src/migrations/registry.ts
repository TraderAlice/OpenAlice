/**
 * Ordered registry of all migrations.
 *
 * Order is determined by array position — keep entries in numeric ID
 * order. Never reorder a migration that has already shipped; the
 * journal records ids, so reordering would cause runners to try to
 * apply already-applied work in a different order.
 *
 * Adding a migration: import it here and append. The
 * `pnpm build:migration-index` script regenerates
 * `src/migrations/INDEX.md` from this list at build time.
 *
 * NOTE: migrations 0001–0007 were retired at the 0.40 baseline — the World-B
 * deletion + Workspace pivot turned the pre-0.40 data shapes over completely, so
 * pre-0.40 installs rebuild `data/` rather than migrate. The framework stays for
 * future upgrades. Numbering continues FORWARD from the highest id ever shipped
 * (next: 0009) — never reuse a retired id, since existing installs' journals
 * recorded the old ones.
 */

import type { Migration } from './types.js'
import { migration as migration_0008_disable_targetless_cron_jobs } from './0008_disable_targetless_cron_jobs/index.js'
import { migration as migration_0009_seal_broker_credentials } from './0009_seal_broker_credentials/index.js'

export const REGISTRY: Migration[] = [
  migration_0008_disable_targetless_cron_jobs,
  migration_0009_seal_broker_credentials,
]
