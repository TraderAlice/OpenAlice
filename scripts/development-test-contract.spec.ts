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
  it('keeps the hermetic full suite distinct from development feedback lanes', () => {
    const scripts = readRootScripts()

    expect(scripts.test).toBe('vitest run')
    expect(scripts['test:affected']).toBe('vitest run --changed origin/dev')
    expect(scripts['test:node']).toBe('vitest run --project node')
    expect(scripts['test:ui']).toBe('vitest run --project ui')
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
