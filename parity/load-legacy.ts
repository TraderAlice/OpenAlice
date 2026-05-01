/**
 * parity/load-legacy.ts — Phase 0 legacy-path loader test.
 *
 * Verifies the legacy-path fallback at git-persistence.ts:18-22:
 *   bybit-main    → data/crypto-trading/commit.json
 *   alpaca-paper  → data/securities-trading/commit.json
 *   alpaca-live   → data/securities-trading/commit.json
 *
 * Strategy (per PHASE0_PLAN.md §5):
 *   1. Build a tmp directory.
 *   2. process.chdir() into it (in a try/finally that always restores).
 *   3. Place the fixture at the legacy path.
 *   4. Call loadGitState(accountId) — assert it returns the legacy content.
 *   5. Place a *different* state at the primary path. Call loadGitState
 *      again — assert it now returns the primary (proving primary preference).
 *   6. For alpaca-paper + alpaca-live with one shared legacy file, both
 *      account ids return identical content.
 *   7. Restore cwd.
 *
 * Never touches the user's data/ directory.
 *
 * Usage:
 *   pnpm tsx parity/load-legacy.ts
 *
 * Exit 0 on success; 1 on first assertion failure.
 */

import assert from 'node:assert/strict'
import {
  mkdirSync, mkdtempSync, copyFileSync, writeFileSync, readFileSync, rmSync,
} from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import type { GitExportState } from '../src/domain/trading/git/types.js'

// NOTE: git-persistence.ts captures the legacy LEGACY_GIT_PATHS at module
// load time via `resolve('data/...')` against process.cwd(). We import it
// dynamically *after* the chdir below so the captured paths point at the
// tmp dir, not the user's real working directory. The primary path is
// resolved per-call (gitFilePath function) so it doesn't suffer this.

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE_ROOT = resolve(__dirname, 'fixtures/legacy-paths')

interface Case {
  accountId: string
  fixturePath: string
  legacySubdir: 'crypto-trading' | 'securities-trading'
  legacyFilename: 'commit.json'
}

const CASES: Case[] = [
  {
    accountId: 'bybit-main',
    fixturePath: resolve(FIXTURE_ROOT, 'bybit-main/crypto-trading_commit.json'),
    legacySubdir: 'crypto-trading',
    legacyFilename: 'commit.json',
  },
  {
    accountId: 'alpaca-paper',
    fixturePath: resolve(FIXTURE_ROOT, 'alpaca-paper/securities-trading_commit.json'),
    legacySubdir: 'securities-trading',
    legacyFilename: 'commit.json',
  },
  {
    accountId: 'alpaca-live',
    fixturePath: resolve(FIXTURE_ROOT, 'alpaca-live/securities-trading_commit.json'),
    legacySubdir: 'securities-trading',
    legacyFilename: 'commit.json',
  },
]

let passes = 0
let failures = 0

function pass(label: string): void {
  passes += 1
  process.stdout.write(`  ok  ${label}\n`)
}

function fail(label: string, err: unknown): void {
  failures += 1
  const msg = err instanceof Error ? err.message : String(err)
  process.stdout.write(`  FAIL ${label}: ${msg}\n`)
}

function makePrimaryDifferentFrom(legacy: GitExportState): GitExportState {
  // Construct a state that is *clearly* not the legacy one so that
  // when both files exist, loadGitState's preference for primary is
  // unambiguous.
  return {
    head: 'PRIMARY00',
    commits: [
      {
        hash: 'PRIMARY00',
        parentHash: null,
        message: `primary-only marker (legacy head was ${legacy.head})`,
        operations: [],
        results: [],
        stateAfter: {
          netLiquidation: '0',
          totalCashValue: '0',
          unrealizedPnL: '0',
          realizedPnL: '0',
          positions: [],
          pendingOrders: [],
        },
        timestamp: '2026-05-02T00:00:00.000Z',
      },
    ],
  }
}

async function main(): Promise<void> {
  const originalCwd = process.cwd()
  const tmpRoot = mkdtempSync(resolve(tmpdir(), 'parity-load-legacy-'))
  let abortReason: string | null = null

  try {
    process.chdir(tmpRoot)

    // Dynamic import AFTER chdir so the legacy paths inside
    // git-persistence.ts resolve against tmpRoot.
    const persistenceUrl = new URL('../src/domain/trading/git-persistence.js', import.meta.url)
    const { loadGitState } = await import(persistenceUrl.href)

    // ---- Phase 1: legacy-only loads ----
    for (const c of CASES) {
      try {
        const legacyDir = resolve(tmpRoot, 'data', c.legacySubdir)
        mkdirSync(legacyDir, { recursive: true })
        copyFileSync(c.fixturePath, resolve(legacyDir, c.legacyFilename))

        const fixtureContent = JSON.parse(readFileSync(c.fixturePath, 'utf-8')) as GitExportState
        const loaded = await loadGitState(c.accountId)
        assert.ok(loaded !== undefined, `loadGitState(${c.accountId}) must return a state from legacy path`)
        assert.deepStrictEqual(loaded, fixtureContent, `loaded state must equal legacy fixture for ${c.accountId}`)
        pass(`legacy fallback works for accountId=${c.accountId}`)
      } catch (err) {
        fail(`legacy fallback for ${c.accountId}`, err)
      }
    }

    // ---- Phase 2: primary preference when both exist ----
    for (const c of CASES) {
      try {
        const primaryDir = resolve(tmpRoot, 'data', 'trading', c.accountId)
        mkdirSync(primaryDir, { recursive: true })
        const fixtureContent = JSON.parse(readFileSync(c.fixturePath, 'utf-8')) as GitExportState
        const primaryContent = makePrimaryDifferentFrom(fixtureContent)
        writeFileSync(resolve(primaryDir, 'commit.json'), JSON.stringify(primaryContent, null, 2))

        const loaded = await loadGitState(c.accountId)
        assert.ok(loaded !== undefined, `loadGitState(${c.accountId}) must return a state when primary exists`)
        assert.strictEqual(loaded.head, 'PRIMARY00', `primary preference: head must be PRIMARY00 for ${c.accountId}`)
        pass(`primary preferred over legacy for accountId=${c.accountId}`)
      } catch (err) {
        fail(`primary preference for ${c.accountId}`, err)
      }
    }

    // ---- Phase 3: alpaca-paper and alpaca-live share the same legacy file ----
    try {
      const sharedDir = resolve(tmpRoot, 'shared-legacy-test', 'data', 'securities-trading')
      mkdirSync(sharedDir, { recursive: true })
      // Use the alpaca-paper fixture (any of the two would do).
      const sharedSrc = resolve(FIXTURE_ROOT, 'alpaca-paper/securities-trading_commit.json')
      copyFileSync(sharedSrc, resolve(sharedDir, 'commit.json'))

      // Move into the shared-legacy-test directory so neither account
      // has a primary file at this cwd.
      process.chdir(resolve(tmpRoot, 'shared-legacy-test'))
      const paper = await loadGitState('alpaca-paper')
      const live  = await loadGitState('alpaca-live')
      assert.ok(paper, 'alpaca-paper must load')
      assert.ok(live, 'alpaca-live must load')
      assert.deepStrictEqual(paper, live, 'paper and live must return identical content from the shared legacy path')
      pass('alpaca-paper and alpaca-live both resolve to the same legacy file')
    } catch (err) {
      fail('shared legacy resolution', err)
    } finally {
      process.chdir(tmpRoot)
    }

    // Note on Phase 4 (missing-file behavior): not asserted here because
    // git-persistence.ts captures LEGACY_GIT_PATHS at module load via
    // resolve('data/...') against process.cwd() — once the module is
    // imported, those paths cannot be retargeted in-process without a
    // module-cache reset. PHASE0_PLAN.md §5 only requires the three
    // positive cases above; missing-file fallback is exercised by
    // existing unit tests in src/domain/trading/.
  } catch (err) {
    abortReason = err instanceof Error ? err.message : String(err)
  } finally {
    process.chdir(originalCwd)
    rmSync(tmpRoot, { recursive: true, force: true })
  }

  if (abortReason) {
    process.stdout.write(`aborted: ${abortReason}\n`)
    process.exit(1)
  }

  process.stdout.write(`\nresult: ${passes} passed, ${failures} failed\n`)
  process.exit(failures === 0 ? 0 : 1)
}

main()
