import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  assertLivePaperAcknowledgement,
  collectRepositorySpecFiles,
  deterministicProductE2eIncludes,
  externalReadonlyIncludes,
  isHermeticDefaultTest,
  isRiskLaneTest,
  livePaperExcludes,
  livePaperIncludes,
  ownerSuiteCommand,
  ownerSuiteNames,
  ownersForTestFile,
} from './test-lanes.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const allSpecs = collectRepositorySpecFiles(repoRoot)

function readJson(path: string): Record<string, any> {
  return JSON.parse(readFileSync(resolve(repoRoot, path), 'utf8')) as Record<string, any>
}

function matchesGlob(file: string, pattern: string): boolean {
  let source = '^'
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]
    if (char === '*') {
      if (pattern[index + 1] === '*') {
        source += '.*'
        index += 1
      } else {
        source += '[^/]*'
      }
    } else {
      source += char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
    }
  }
  return new RegExp(`${source}$`).test(file)
}

function matchesAny(file: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchesGlob(file, pattern))
}

describe('test lane ownership contract', () => {
  it('assigns every hermetic default spec to exactly one owner suite', () => {
    const hermetic = allSpecs.filter(isHermeticDefaultTest)
    const assignments = hermetic.map((file) => ({ file, owners: ownersForTestFile(file) }))

    expect(assignments.filter(({ owners }) => owners.length !== 1)).toEqual([])
    for (const owner of ownerSuiteNames) {
      expect(assignments.filter(({ owners }) => owners.includes(owner)).length).toBeGreaterThan(0)
    }
  })

  it('keeps root owner commands synchronized with the ownership map', () => {
    const scripts = readJson('package.json').scripts as Record<string, string>
    for (const owner of ownerSuiteNames) {
      expect(scripts[`test:${owner}`]).toBe(ownerSuiteCommand(owner))
    }
  })
})

describe('test risk lane contract', () => {
  const riskSpecs = allSpecs.filter(isRiskLaneTest)

  it('assigns every integration/live spec to exactly one risk lane', () => {
    const assignments = riskSpecs.map((file) => {
      const lanes = [
        matchesAny(file, deterministicProductE2eIncludes) && 'product-e2e',
        matchesAny(file, externalReadonlyIncludes) && 'external-readonly',
        matchesAny(file, livePaperIncludes)
          && !matchesAny(file, livePaperExcludes)
          && 'live-paper',
      ].filter(Boolean)
      return { file, lanes }
    })

    expect(assignments.filter(({ lanes }) => lanes.length !== 1)).toEqual([])
    expect(riskSpecs.some((file) => isHermeticDefaultTest(file))).toBe(false)
  })

  it('keeps deterministic, external read-only, and live-paper commands distinct', () => {
    const scripts = readJson('package.json').scripts as Record<string, string>
    expect(scripts['test:e2e']).toBe('vitest run --config vitest.e2e.config.ts')
    expect(scripts['test:external:readonly']).toBe('vitest run --config vitest.external.config.ts')
    expect(scripts['test:uta:live-paper']).toBe('vitest run --config vitest.uta-live.config.ts')
  })

  it('puts the write-capable IBKR precision suite behind the shared acknowledgement', () => {
    const orderPrecision = 'packages/ibkr/tests/e2e/order-precision.e2e.spec.ts'
    expect(matchesAny(orderPrecision, livePaperIncludes)).toBe(true)
    expect(matchesAny(orderPrecision, externalReadonlyIncludes)).toBe(false)
    expect(matchesAny(orderPrecision, deterministicProductE2eIncludes)).toBe(false)
    expect(() => assertLivePaperAcknowledgement({})).toThrow(/OPENALICE_UTA_LIVE_PAPER=1/)
    expect(() => assertLivePaperAcknowledgement({ OPENALICE_UTA_LIVE_PAPER: '1' })).not.toThrow()
  })

  it('removes the old mixed-risk IBKR config and exposes explicit package lanes', () => {
    const scripts = readJson('packages/ibkr/package.json').scripts as Record<string, string>
    expect(existsSync(resolve(repoRoot, 'packages/ibkr/vitest.e2e.config.ts'))).toBe(false)
    expect(scripts['test:e2e']).toBeUndefined()
    expect(scripts['test:external:readonly']).toContain('vitest.external.config.ts')
    expect(scripts['test:live-paper']).toContain('vitest.uta-live.config.ts')
  })

  it('runs the real UTA package suite instead of a placeholder', () => {
    const scripts = readJson('services/uta/package.json').scripts as Record<string, string>
    expect(scripts.test).toBe('node ../../scripts/run-owner-tests.mjs uta')
    expect(scripts.test).not.toMatch(/no tests/i)
  })
})
