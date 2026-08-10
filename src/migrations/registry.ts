/**
 * Ordered registry of migrations introduced after the 0.89.2-beta baseline.
 *
 * The development-era 0001–0038 chain is intentionally retired. It accumulated
 * assumptions about obsolete Workspace layouts and could be replayed by an old
 * or isolated process against a newer Workspace root. Fresh 0.89.2-beta homes
 * are seeded directly from current schemas and defaults instead.
 *
 * Keep future entries in numeric order and never reuse a retired id. The next
 * migration id is 0039. `pnpm build:migration-index` regenerates INDEX.md.
 */

import type { Migration } from './types.js'
export const MIGRATION_BASELINE = '0.89.2-beta'
export const NEXT_MIGRATION_NUMBER = 39

export const REGISTRY: Migration[] = []
