#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { collectOwnerTestFiles, ownerSuiteNames, ownerSuites } from './test-lanes.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..')
const [owner, ...unexpected] = process.argv.slice(2)

if (!owner || !ownerSuites[owner] || unexpected.length > 0) {
  console.error(`Usage: node scripts/run-owner-tests.mjs <${ownerSuiteNames.join('|')}>`)
  console.error('Owner suites are complete by definition; use Vitest directly for a targeted file.')
  process.exit(2)
}

const files = collectOwnerTestFiles(repoRoot, owner)
if (files.length === 0) {
  console.error(`No hermetic tests are assigned to owner ${owner}.`)
  process.exit(1)
}

const vitest = resolve(repoRoot, 'node_modules/vitest/vitest.mjs')
const result = spawnSync(process.execPath, [
  vitest,
  'run',
  '--project',
  ownerSuites[owner].project,
  ...files.map((file) => resolve(repoRoot, file)),
], {
  cwd: repoRoot,
  env: process.env,
  stdio: 'inherit',
})

if (result.error) throw result.error
process.exit(result.status ?? 1)
