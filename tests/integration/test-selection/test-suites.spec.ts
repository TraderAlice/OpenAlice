import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  areaSuiteNames, collectRepositorySpecFiles, collectTestCommands,
  collectWorkspacePackages, laneSuiteNames, ownerSuiteNames,
  ownersForTestFile, lanesForTestFile, selectTestFiles,
} from '../../../scripts/test-lanes.mjs'
import { registeredTestDefinitions, testSuites, validateTestSuites } from '../../../scripts/test-suites.mjs'
import { isTestCommandName, validateTestCommands } from '../../../scripts/test-commands.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const specs = collectRepositorySpecFiles(repoRoot)
const commands = collectTestCommands(repoRoot)
const taxonomy = {
  owners: ownerSuiteNames, lanes: laneSuiteNames, areas: areaSuiteNames,
  packages: collectWorkspacePackages(repoRoot).map((entry) => entry.name),
}
const validate = (groups = testSuites) => validateTestSuites(
  repoRoot, groups, specs, commands, taxonomy,
)
const selector = (...args: string[]) => spawnSync(process.execPath, ['scripts/run-tests.mjs', ...args], {
  cwd: repoRoot, encoding: 'utf8',
})

describe('registered integration and E2E suites', () => {
  it('resolves every registered suite file and owner', () => {
    expect(() => validate()).not.toThrow()
    const packages = collectWorkspacePackages(repoRoot).map((entry) => entry.name)
    for (const test of registeredTestDefinitions) {
      expect(ownersForTestFile(test.path)).toEqual([test.owner])
      expect(lanesForTestFile(test.path)).toEqual([test.lane])
      expect(test.areas.every((area: string) => areaSuiteNames.includes(area))).toBe(true)
      if (test.package) expect(packages).toContain(test.package)
    }
  })

  it('rejects stale suite paths rather than implying coverage', () => {
    const suites = structuredClone(testSuites)
    suites.find((suite: { files?: string[] }) => suite.files?.length).files[0] = '../outside.spec.ts'
    expect(() => validate(suites)).toThrow(/unknown or misplaced spec/)
  })

  it('rejects a deleted command, duplicate central ownership, and an unowned central spec', () => {
    const groups = structuredClone(testSuites)
    groups.find((suite: { commands?: string[] }) => suite.commands?.length).commands[0] = 'removed#acceptance'
    expect(() => validate(groups)).toThrow(/unknown\/non-dedicated command/)

    const duplicate = structuredClone(testSuites)
    const group = duplicate.find((entry: { files?: string[] }) => entry.files?.length)
    group.files.push(group.files[0])
    expect(() => validate(duplicate)).toThrow(/Duplicate suite registration/)

    const unowned = structuredClone(testSuites)
    unowned.splice(unowned.findIndex((entry: { files?: string[] }) => entry.files?.length), 1)
    expect(() => validate(unowned)).toThrow(/Higher-tier spec lacks registration/)
  })

  it('rejects central metadata that loses package/area selection', () => {
    for (const [field, value] of [['package', '@missing/package'], ['areas', ['unknown-area']]] as const) {
      const groups = structuredClone(testSuites)
      groups.find((group: { files?: string[] }) => group.files?.length)[field] = value
      expect(() => validate(groups)).toThrow(/invalid package|invalid area/)
    }
  })


})

describe('suite selection through the existing lane/owner/package selector', () => {
  it('ORs suites and intersects tier, owner, lane, and package dimensions', () => {
    expect(selectTestFiles(repoRoot, {
      suites: ['first-run', 'trading-approval'], owners: ['alice'], tiers: ['integration'], lanes: ['integration'],
    })).toEqual(['tests/integration/first-run/broker-free-chat.spec.ts'])
    expect(selectTestFiles(repoRoot, {
      suites: ['trading-approval', 'alice-uta'], lanes: ['integration'], packages: ['@traderalice/uta-service'],
    })).toEqual(['tests/integration/alice-uta/approval-http.spec.ts', 'tests/integration/trading-approval/uta-lifecycle.spec.ts'])
    expect(selectTestFiles(repoRoot, {
      suites: ['workspace-creation', 'trading-approval'], lanes: ['integration'],
    })).toHaveLength(2)
  })

  it('runs only hermetic specs by default and explains separate acceptance', () => {
    const result = selector('--suite', 'startup-project-selection', '--json')
    expect(result.status).toBe(0)
    const plan = JSON.parse(result.stdout)
    expect(plan.executed).toBe(false)
    expect(plan.files).toHaveLength(4)
    expect(plan.invocations.every((entry: { lane: string }) => entry.lane === 'hermetic')).toBe(true)
  })

  it('retains changed-file forwarding for suite intersections', () => {
    const result = selector('--suite=startup-project-selection', '--tier=e2e', '--changed', 'origin/dev', '--json')
    expect(result.status).toBe(0)
    const plan = JSON.parse(result.stdout)
    expect(plan.selectors.tiers).toEqual(['e2e'])
    expect(plan.invocations[0].args).toEqual(expect.arrayContaining(['--changed', 'origin/dev']))
  })

  it('fails closed for misspelled suites and an empty executable selection', () => {
    expect(selector('--suite', 'desktop-lifecyle', '--json').stderr).toContain('Unknown test suite')
    const empty = selector('--suite', 'startup-project-selection', '--lane', 'integration', '--json')
    expect(empty.status).toBe(2)
    expect(empty.stderr).toContain('selection matched zero catalogued tests')
    expect(selector('--suite', 'trading-approval', '--lane', 'live-paper').status).toBe(2)
  })

  it('inspects risky command metadata without running it', () => {
    const result = selector('--suites', '--suite', 'desktop-acceptance', '--json')
    expect(result.status).toBe(0)
    const plan = JSON.parse(result.stdout)
    expect(plan.executed).toBe(false)
    expect(plan.suites).toHaveLength(1)
    expect(plan.suites[0].dedicatedCommands.every((command: { executed: boolean }) => command.executed === false)).toBe(true)
    const explanation = selector('--suites', '--suite', 'desktop-acceptance', '--explain')
    expect(explanation.stdout).toContain('never auto-run')
    expect(explanation.stdout).toContain('scope:')
    expect(selector('--suites', '--lane', 'live-paper').status).toBe(2)
  })
})

describe('complete data-only task inventory', () => {
  it('discovers every named test/smoke/verify manifest command without copying command strings', () => {
    expect(() => validateTestCommands(repoRoot, commands, ownerSuiteNames, laneSuiteNames)).not.toThrow()
    for (const workspace of [{ root: '.', name: 'open-alice' }, ...collectWorkspacePackages(repoRoot)]) {
      const manifest = JSON.parse(readFileSync(resolve(repoRoot, workspace.root, 'package.json'), 'utf8'))
      for (const [name, command] of Object.entries(manifest.scripts ?? {})) {
        if (isTestCommandName(name)) {
          expect(commands).toContainEqual(expect.objectContaining({ id: `${workspace.name}#${name}`, command }))
        }
      }
    }
    expect(commands).toContainEqual(expect.objectContaining({ id: 'cli-package-manager', lane: 'system', executed: false }))
    expect(commands).toContainEqual(expect.objectContaining({ id: 'open-alice#electron:smoke:workspace', owner: 'desktop', kind: 'artifact-acceptance' }))
  })

  it('accounts for every spec exactly once and leaves unit tests unregistered', () => {
    const result = selector('--inventory', '--json')
    expect(result.status).toBe(0)
    const inventory = JSON.parse(result.stdout)
    expect(inventory.executed).toBe(false)
    expect(inventory.files.map((file: { path: string }) => file.path)).toEqual(specs)
    expect(new Set(inventory.files.map((file: { path: string }) => file.path)).size).toBe(specs.length)
    expect(inventory.commands).toHaveLength(commands.length)
    expect(inventory.unitCount).toBeGreaterThan(0)
    for (const file of inventory.files) {
      expect(file.owner).toHaveLength(1)
      expect(file.lane).toHaveLength(1)
      if (file.suite) expect(testSuites.some((suite: { files?: string[] }) => suite.files?.includes(file.path))).toBe(true)
    }
    expect(selector('--inventory', '--suite', 'first-run').status).toBe(2)
  })
})


it('reports only the platforms supported by packaged macOS smoke modes', () => {
  for (const id of ['open-alice#electron:smoke:packaged', 'open-alice#electron:smoke:trading-mode']) {
    expect(commands.find(command => command.id === id)?.platforms).toEqual(['macOS-arm64', 'macOS-x64'])
  }
  for (const id of ['open-alice#electron:smoke:credential-pi', 'open-alice#electron:smoke:onboarding']) {
    expect(commands.find(command => command.id === id)?.platforms).toEqual(['macOS-arm64', 'macOS-x64', 'Windows-x64', 'Linux-x64'])
  }
  expect(commands.find(command => command.id === 'open-alice#electron:smoke:workspace')?.platforms).toContain('Windows-x64')
})
