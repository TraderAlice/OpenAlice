import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  areaSuiteNames,
  areasForTestFile,
  assertLivePaperAcknowledgement,
  collectRepositorySpecFiles,
  externalReadonlyIncludes,
  integrationIncludes,
  laneSuiteNames,
  lanesForTestFile,
  livePaperIncludes,
  ownerSuiteCommand,
  ownerSuiteNames,
  ownersForTestFile,
  selectTestFiles,
  systemCommandSuites,
} from './test-lanes.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const allSpecs = collectRepositorySpecFiles(repoRoot)

function readJson(path: string): Record<string, any> {
  return JSON.parse(readFileSync(resolve(repoRoot, path), 'utf8')) as Record<string, any>
}

function runSelector(args: string[]) {
  return spawnSync(process.execPath, ['scripts/run-tests.mjs', ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
}

describe('test catalog ownership contract', () => {
  it('assigns every repository spec to exactly one owner and one risk lane', () => {
    const assignments = allSpecs.map((file) => ({
      file,
      owners: ownersForTestFile(file),
      lanes: lanesForTestFile(file),
    }))

    expect(assignments.filter(({ owners }) => owners.length !== 1)).toEqual([])
    expect(assignments.filter(({ lanes }) => lanes.length !== 1)).toEqual([])
    for (const owner of ownerSuiteNames) {
      expect(assignments.filter(({ owners }) => owners.includes(owner)).length).toBeGreaterThan(0)
    }
    for (const lane of laneSuiteNames) {
      expect(assignments.filter(({ lanes }) => lanes.includes(lane)).length).toBeGreaterThan(0)
    }
  })

  it('keeps root owner commands synchronized with the ownership map', () => {
    const scripts = readJson('package.json').scripts as Record<string, string>
    for (const owner of ownerSuiteNames) {
      expect(scripts[`test:owner:${owner}`]).toBe(ownerSuiteCommand(owner))
    }
    for (const [name, suite] of Object.entries(systemCommandSuites)) {
      expect(scripts[`test:system:${name}`]).toBe(suite.command)
    }
  })

  it('keeps areas optional and intentionally composable', () => {
    expect(areaSuiteNames).toEqual(expect.arrayContaining([
      'workspace',
      'uta',
      'workflow',
      'platform',
      'connector-replay',
      'market-data',
      'ibkr',
      'bybit-diagnostic',
    ]))
    expect(areasForTestFile('src/workspaces/workspace-creator.spec.ts')).toEqual(
      expect.arrayContaining(['workspace', 'platform']),
    )

    const neutralInputs = 'scripts/prepare-cli-neutral-inputs.spec.mjs'
    expect(ownersForTestFile(neutralInputs)).toEqual(['repo-tooling'])
    expect(lanesForTestFile(neutralInputs)).toEqual(['hermetic'])
    expect(areasForTestFile(neutralInputs)).toContain('workflow')
  })

  it('keeps the workflow contract area hermetic and free of system/integration specs', () => {
    const workflow = selectTestFiles(repoRoot, { lanes: ['hermetic'], areas: ['workflow'] })
    expect(workflow.length).toBeGreaterThan(0)
    expect(workflow.every((file) => lanesForTestFile(file).includes('hermetic'))).toBe(true)
    expect(workflow.some((file) => file.includes('railway-'))).toBe(false)
    expect(workflow.some((file) => file.includes('.e2e.spec.'))).toBe(false)
  })
})

describe('composable selection contract', () => {
  it('ORs values within one dimension and ANDs dimensions with each other', () => {
    const aliceOrUi = selectTestFiles(repoRoot, {
      lanes: ['hermetic'],
      owners: ['alice', 'ui'],
    })
    expect(aliceOrUi.length).toBeGreaterThan(300)
    expect(aliceOrUi.every((file) => {
      const owners = ownersForTestFile(file)
      return owners.includes('alice') || owners.includes('ui')
    })).toBe(true)

    const externalUta = selectTestFiles(repoRoot, {
      lanes: ['external-readonly'],
      owners: ['uta'],
      areas: ['market-data', 'ibkr'],
    })
    expect(externalUta).toEqual([
      'packages/ibkr/tests/e2e/connect.e2e.spec.ts',
      'packages/ibkr/tests/e2e/contract-details.e2e.spec.ts',
      'services/uta/src/domain/trading/__test__/e2e/ccxt-hyperliquid-markets.e2e.spec.ts',
      'services/uta/src/domain/trading/brokers/ccxt/CcxtBroker.e2e.spec.ts',
    ])
  })

  it('supports precise package and repo-relative path filters', () => {
    const service = selectTestFiles(repoRoot, {
      lanes: ['hermetic'],
      packages: ['@traderalice/uta-service'],
    })
    expect(service.length).toBeGreaterThan(0)
    expect(service.every((file) => file.startsWith('services/uta/'))).toBe(true)

    expect(selectTestFiles(repoRoot, {
      lanes: ['hermetic'],
      paths: ['services/connector/src/core'],
    })).toEqual(expect.arrayContaining([
      'services/connector/src/core/io-replay.spec.ts',
      'services/connector/src/core/work-queue.spec.ts',
    ]))
    expect(selectTestFiles(repoRoot, {
      lanes: ['hermetic'],
      paths: ['scripts/**/*.spec.ts'],
    })).toContain('scripts/test-lanes.spec.ts')
  })

  it('forwards changed selection to Vitest without pretending to resolve its import graph', () => {
    const result = runSelector(['--owner', 'alice', '--changed', 'origin/dev', '--json'])
    expect(result.status).toBe(0)
    const plan = JSON.parse(result.stdout) as {
      selectors: { changed: string; changedSemantics: string }
      invocations: Array<{ args: string[] }>
    }
    expect(plan.selectors.changed).toBe('origin/dev')
    expect(plan.selectors.changedSemantics).toContain('Vitest static import analysis')
    expect(plan.invocations.every(({ args }) => (
      args.includes('--changed') && args.includes('origin/dev')
    ))).toBe(true)
  })

  it('fails closed when a CLI selection resolves to zero files', () => {
    const result = runSelector(['--path', 'definitely/not/a/test', '--list'])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('selection matched zero catalogued tests')
  })

  it('keeps the complete UI owner invocation below Windows command limits', () => {
    const result = runSelector(['--owner', 'ui', '--json'])
    expect(result.status).toBe(0)
    const plan = JSON.parse(result.stdout) as {
      candidateCount: number
      files: Array<{ path: string }>
      invocations: Array<{ project: string; files: string[]; argumentCharacters: number }>
    }
    expect(plan.candidateCount).toBeGreaterThan(250)
    expect(plan.files.every(({ path }) => !path.startsWith('/'))).toBe(true)
    expect(plan.invocations).toEqual([
      expect.objectContaining({ project: 'ui', files: [], argumentCharacters: expect.any(Number) }),
    ])
    expect(plan.invocations[0].argumentCharacters).toBeLessThan(8_000)
  })
})

describe('risk and side-effect boundary contract', () => {
  it('keeps deterministic, external read-only, live-paper, and system specs distinct', () => {
    expect(integrationIncludes).toHaveLength(2)
    expect(externalReadonlyIncludes.length).toBeGreaterThan(2)
    expect(livePaperIncludes.length).toBeGreaterThan(0)

    const scripts = readJson('package.json').scripts as Record<string, string>
    expect(scripts['test:integration']).toBe('node scripts/run-tests.mjs --lane integration')
    expect(scripts['test:external:readonly']).toBe(
      'node scripts/run-tests.mjs --lane external-readonly',
    )
    expect(scripts['test:live:uta-paper']).toBe(
      'node scripts/run-tests.mjs --lane live-paper --area uta-paper',
    )
  })

  it('loads the hermetic setup only for deterministic integration', () => {
    const deterministic = readFileSync(resolve(repoRoot, 'vitest.e2e.config.ts'), 'utf8')
    const external = readFileSync(resolve(repoRoot, 'vitest.external.config.ts'), 'utf8')
    const live = readFileSync(resolve(repoRoot, 'vitest.uta-live.config.ts'), 'utf8')
    expect(deterministic).toContain("setupFiles: ['./vitest.setup.ts']")
    expect(external).not.toMatch(/setupFiles\s*:/)
    expect(live).not.toMatch(/setupFiles\s*:/)
  })

  it('puts every order-capable IBKR test behind the shared acknowledgement', () => {
    const orderPrecision = 'packages/ibkr/tests/e2e/order-precision.e2e.spec.ts'
    expect(lanesForTestFile(orderPrecision)).toEqual(['live-paper'])
    expect(() => assertLivePaperAcknowledgement({})).toThrow(/OPENALICE_UTA_LIVE_PAPER=1/)
    expect(() => assertLivePaperAcknowledgement({ OPENALICE_UTA_LIVE_PAPER: '1' })).not.toThrow()
  })

  it('keeps the market-buy raw diagnostic out of the aggregate paper sweep', () => {
    const raw = 'services/uta/src/domain/trading/__test__/e2e/ccxt-raw-diagnostic.e2e.spec.ts'
    const aggregate = selectTestFiles(repoRoot, {
      lanes: ['live-paper'],
      areas: ['uta-paper'],
    })
    expect(aggregate).not.toContain(raw)
    expect(selectTestFiles(repoRoot, {
      lanes: ['live-paper'],
      areas: ['bybit-diagnostic'],
    })).toEqual([raw])

    const broadRun = runSelector(['--lane', 'live-paper'])
    expect(broadRun.status).toBe(2)
    expect(broadRun.stderr).toContain('must be selected explicitly with --area bybit-diagnostic')
  })

  it('explains external/live prerequisites without probing or running them', () => {
    const result = runSelector(['--lane', 'live-paper', '--area', 'ibkr', '--explain'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('dry-run: no tests ran')
    expect(result.stdout).toContain('OPENALICE_UTA_LIVE_PAPER=1')
    expect(result.stdout).toContain('all-skipped run is not acceptance evidence')
  })

  it('keeps package-local suites precise and removes the old mixed IBKR config', () => {
    const ibkrScripts = readJson('packages/ibkr/package.json').scripts as Record<string, string>
    const utaScripts = readJson('services/uta/package.json').scripts as Record<string, string>
    expect(existsSync(resolve(repoRoot, 'packages/ibkr/vitest.e2e.config.ts'))).toBe(false)
    expect(ibkrScripts['test:external:readonly']).toContain('--package @traderalice/ibkr')
    expect(ibkrScripts['test:live-paper']).toContain('--package @traderalice/ibkr')
    expect(utaScripts.test).toBe(
      'node ../../scripts/run-tests.mjs --package @traderalice/uta-service',
    )
    expect(utaScripts.test).not.toMatch(/owner uta|no tests/i)
  })
})
