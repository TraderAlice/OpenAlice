/**
 * Migration framework types.
 *
 * A Migration is a versioned, idempotent transformation of the user's
 * config directory. The runner applies pending migrations in registry
 * order and records each in the journal at data/config/_meta.json.
 *
 * Two-layer idempotency:
 *   1. Journal — runner never re-applies a recorded id.
 *   2. In-body self-check — each up() must be a no-op when data is
 *      already at target shape, in case the journal is corrupted /
 *      hand-edited / a previous run partially completed.
 */

export interface MigrationContext {
  /** Read a JSON file from the config dir. Returns undefined if missing. */
  readJson<T = unknown>(filename: string): Promise<T | undefined>
  /** Write a JSON file to the config dir, creating dirs as needed. */
  writeJson(filename: string, data: unknown): Promise<void>
  /** Remove a JSON file from the config dir. No-op if missing. */
  removeJson(filename: string): Promise<void>
  /** Absolute path to the config directory. */
  configDir(): string
  /** Complete home that owns this journal. */
  userDataHome(): string
  /** Workspace root paired with this journal, including an explicit split-root override. */
  launcherRoot(): string
}

export interface Migration {
  /** Stable identifier with sequential prefix, e.g. '0002_extract_credentials'. */
  id: string
  /** Semver of the release that ships this migration. */
  appVersion: string
  /** ISO date (YYYY-MM-DD) when this migration was added. */
  introducedAt: string
  /** Config filenames touched. Use ['*'] for cross-cutting migrations. */
  affects: string[]
  /** One-line semantic summary, used by INDEX.md generator. */
  summary: string
  /** Optional pointer to a design doc. */
  rationale?: string
  /**
   * Apply the migration. Body MUST be idempotent — return as a no-op
   * when data is already at target shape.
   */
  up: (ctx: MigrationContext) => Promise<void>
}

export interface AppliedMigration {
  id: string
  appliedAt: string
  appVersion: string
}

/** Shape of data/config/_meta.json. */
export interface ConfigMeta {
  appVersion: string
  appliedMigrations: AppliedMigration[]
}
