/**
 * Global test hermeticity: pin the complete OpenAlice home and every supported
 * split-root override to one per-worker temp tree. Module-level path constants,
 * migration journals, Workspace stores, and provider-key stores must never
 * resolve into the developer's real data.
 *
 * Runs before each test file's module graph is imported (vitest setupFiles
 * semantics). Specs that need a
 * specific home (paths.spec, global-provider-keys.spec) still override via
 * vi.resetModules() + their own env handling.
 *
 * Deliberately NOT wired into vitest.e2e.config.ts: the e2e suite reads real
 * broker credentials from the real store by design.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Unit tests must never inherit either half of a live split-root setup. In
// particular, pinning OPENALICE_HOME while retaining a real AQ_LAUNCHER_ROOT
// lets a migration journal in the temporary home rewrite real Workspaces.
const testHome = process.env['OPENALICE_TEST_HOME']
  ?? mkdtempSync(join(tmpdir(), 'oa-vitest-'))
process.env['OPENALICE_HOME'] = testHome
process.env['AQ_LAUNCHER_ROOT'] = join(testHome, 'workspaces')
process.env['OPENALICE_GLOBAL_DIR'] = join(testHome, 'global')
