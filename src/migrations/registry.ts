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
 */

import type { Migration } from './types.js'
import { migration as migration_0001_initial_unified } from './0001_initial_unified/index.js'
import { migration as migration_0002_extract_credentials } from './0002_extract_credentials/index.js'
import { migration as migration_0003_backfill_credentials } from './0003_backfill_credentials/index.js'
import { migration as migration_0004_prune_internal_cron_jobs } from './0004_prune_internal_cron_jobs/index.js'
import { migration as migration_0005_extract_mcp_from_connectors } from './0005_extract_mcp_from_connectors/index.js'
import { migration as migration_0006_retire_brain } from './0006_retire_brain/index.js'

export const REGISTRY: Migration[] = [
  migration_0001_initial_unified,
  migration_0002_extract_credentials,
  migration_0003_backfill_credentials,
  migration_0004_prune_internal_cron_jobs,
  migration_0005_extract_mcp_from_connectors,
  migration_0006_retire_brain,
]
