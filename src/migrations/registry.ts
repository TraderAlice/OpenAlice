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
 * (next: 0013) — never reuse a retired id, since existing installs' journals
 * recorded the old ones.
 */

import type { Migration } from './types.js'
import { migration as migration_0008_disable_targetless_cron_jobs } from './0008_disable_targetless_cron_jobs/index.js'
import { migration as migration_0009_seal_broker_credentials } from './0009_seal_broker_credentials/index.js'
import { migration as migration_0010_workspace_issues_to_markdown } from './0010_workspace_issues_to_markdown/index.js'
import { migration as migration_0011_workspace_issue_assignee_defaults } from './0011_workspace_issue_assignee_defaults/index.js'
import { migration as migration_0012_recent_chat_workspace_preference } from './0012_recent_chat_workspace_preference/index.js'
import { migration as migration_0013_session_run_source } from './0013_session_run_source/index.js'
import { migration as migration_0014_headless_resume_identity } from './0014_headless_resume_identity/index.js'
import { migration as migration_0015_resume_identity_registry } from './0015_resume_identity_registry/index.js'

export const REGISTRY: Migration[] = [
  migration_0008_disable_targetless_cron_jobs,
  migration_0009_seal_broker_credentials,
  migration_0010_workspace_issues_to_markdown,
  migration_0011_workspace_issue_assignee_defaults,
  migration_0012_recent_chat_workspace_preference,
  migration_0013_session_run_source,
  migration_0014_headless_resume_identity,
  migration_0015_resume_identity_registry,
]
