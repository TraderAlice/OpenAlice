import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import vitestConfig, { collectionWideTestInputs } from '../vitest.config.js'

interface PackageManifest {
  scripts?: Record<string, string>
}

interface TestConfig {
  test?: {
    forceRerunTriggers?: string[]
  }
}

const packageJsonPath = fileURLToPath(new URL('../package.json', import.meta.url))

function readRootScripts(): Record<string, string> {
  const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as PackageManifest
  return manifest.scripts ?? {}
}

describe('development test command contract', () => {
  it('keeps one composable namespace around the hermetic full suite', () => {
    const scripts = readRootScripts()

    expect(scripts.test).toBe('vitest run')
    expect(scripts['test:select']).toBe('node scripts/run-tests.mjs')
    expect(scripts['test:changed']).toBe('node scripts/run-tests.mjs --changed origin/dev')
    for (const owner of [
      'alice',
      'ui',
      'uta',
      'connector',
      'runtime-cli',
      'desktop',
      'repo-tooling',
    ]) {
      expect(scripts[`test:owner:${owner}`]).toBe(`node scripts/run-tests.mjs --owner ${owner}`)
    }
    expect(scripts['test:watch']).toBe('vitest --config vitest.config.ts')
  })

  it('uses production boundaries for integration, contract, external, live, and system tests', () => {
    const scripts = readRootScripts()

    for (const name of ['test:integration', 'test:integration:workspace', 'test:integration:uta']) {
      expect(scripts[name]).toContain('scripts/run-tests.mjs')
    }
    for (const name of [
      'test:contract:workflow',
      'test:contract:platform',
      'test:contract:connector-replay',
    ]) {
      expect(scripts[name]).toContain('scripts/run-tests.mjs')
    }
    expect(scripts['test:external:readonly:market-data']).toContain('--area market-data')
    expect(scripts['test:external:readonly:ibkr']).toContain('--area ibkr')
    expect(scripts['test:live:bybit-diagnostic']).toContain('--area bybit-diagnostic')
    expect(scripts['test:system:dev-stack']).toBe('tsx scripts/guardian/smoke.ts')
    expect(scripts['test:system:package-manager']).toBeUndefined()
  })

  it('removes the ambiguous legacy root test names instead of keeping aliases', () => {
    const scripts = readRootScripts()
    const legacy = [
      'test:affected',
      'test:node',
      'test:ui',
      'test:alice',
      'test:uta',
      'test:connector',
      'test:runtime-cli',
      'test:desktop',
      'test:repo-tooling',
      'test:e2e',
      'test:uta:live-paper',
      'test:smoke',
      'test:guardian-recovery',
      'test:connector-service',
      'test:connector-replay',
      'test:install:docker',
      'test:install:dev-channel',
      'test:remote:docker',
      'test:cli-package-manager',
      'test:workflow-contracts',
      'test:platform-contracts',
      'test:cli',
    ]
    expect(legacy.filter((name) => scripts[name] !== undefined)).toEqual([])
  })

  it('reruns every project when collection-wide inputs change', () => {
    const config = vitestConfig as TestConfig

    expect(config.test?.forceRerunTriggers).toEqual(collectionWideTestInputs)
    expect(collectionWideTestInputs).toHaveLength(2)
    expect(collectionWideTestInputs[0]).toMatch(/\/\*\*\/package\.json$/)
    expect(collectionWideTestInputs[1]).toMatch(/\/\*\*\/\{vitest,vite\}\.config\.\*$/)
    expect(collectionWideTestInputs.every((pattern) => !pattern.includes('\\'))).toBe(true)
  })
})
