import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  areaSuiteNames, collectRepositorySpecFiles, collectTestCommands,
  collectWorkspacePackages, laneSuiteNames, ownerSuiteNames,
  ownersForTestFile, lanesForTestFile, selectTestFiles,
} from './test-lanes.mjs'
import {
  centralTestDefinitions, coverageGroups, groupSpecFiles, requirementStatus,
  validateCoverageGroups,
} from './test-groups.mjs'
import { isTestCommandName, validateTestCommands } from './test-commands.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const specs = collectRepositorySpecFiles(repoRoot)
const commands = collectTestCommands(repoRoot)
const taxonomy = {
  owners: ownerSuiteNames, lanes: laneSuiteNames, areas: areaSuiteNames,
  packages: collectWorkspacePackages(repoRoot).map((entry) => entry.name),
}
const validate = (groups = coverageGroups) => validateCoverageGroups(
  repoRoot, groups, specs, commands, taxonomy,
)
const selector = (...args: string[]) => spawnSync(process.execPath, ['scripts/run-tests.mjs', ...args], {
  cwd: repoRoot, encoding: 'utf8',
})

describe('scenario and boundary evidence catalog', () => {
  it('resolves every reviewed assertion, command, central spec, and owner guide', () => {
    expect(() => validate()).not.toThrow()
    const packages = collectWorkspacePackages(repoRoot).map((entry) => entry.name)
    for (const test of centralTestDefinitions) {
      expect(ownersForTestFile(test.path)).toEqual([test.owner])
      expect(lanesForTestFile(test.path)).toEqual([test.lane])
      expect(test.areas.every((area: string) => areaSuiteNames.includes(area))).toBe(true)
      if (test.package) expect(packages).toContain(test.package)
    }
  })

  it('rejects stale assertion names and evidence paths rather than implying coverage', () => {
    for (const field of ['spec', 'assertion']) {
      const groups = structuredClone(coverageGroups)
      const evidence = groups.flatMap((group) => group.requirements).flatMap((row) => row.evidence).find((entry) => entry.spec)
      evidence[field] = field === 'spec' ? '../outside.spec.ts' : 'a removed assertion title'
      expect(() => validate(groups)).toThrow(/unknown spec|assertion reference drifted/)
    }
  })

  it('rejects a deleted command, duplicate central ownership, and an unowned central spec', () => {
    const groups = structuredClone(coverageGroups)
    const evidence = groups.flatMap((group) => group.requirements).flatMap((row) => row.evidence).find((entry) => entry.command)
    evidence.command = 'removed#acceptance'
    expect(() => validate(groups)).toThrow(/unknown command/)

    const duplicate = structuredClone(coverageGroups)
    const group = duplicate.find((entry) => entry.centralTests?.length)
    group.centralTests.push(group.centralTests[0])
    expect(() => validate(duplicate)).toThrow(/duplicate central ownership/)

    const unowned = structuredClone(coverageGroups)
    unowned.find((entry) => entry.centralTests?.length).centralTests = []
    expect(() => validate(unowned)).toThrow(/Central spec lacks explicit ownership/)
  })

  it('rejects central metadata that loses package/area selection', () => {
    for (const [field, value] of [['package', '@missing/package'], ['areas', ['unknown-area']]] as const) {
      const groups = structuredClone(coverageGroups)
      groups.find((group) => group.centralTests?.length).centralTests[0][field] = value
      expect(() => validate(groups)).toThrow(/invalid central package|invalid central area/)
    }
  })

  it('keeps native user journeys partial even with green-looking unit evidence', () => {
    const group = coverageGroups.find((entry) => entry.kind === 'scenario' && entry.name === 'desktop-lifecycle')
    expect(group.requirements.every((row: { review: string; evidence: unknown[]; gap: string }) => requirementStatus(row) === 'partial')).toBe(true)
    expect(group.requirements[0].gap).toContain('Real macOS and Windows')
    expect(group.requirements[0].evidence.every((entry: { level: string }) => entry.level === 'unit')).toBe(true)
    expect(requirementStatus({ review: 'reviewed', evidence: [], gap: 'Missing native journey.' })).toBe('missing')
    expect(requirementStatus({ review: 'unreviewed', evidence: [], gap: 'Needs inspection.' })).toBe('unreviewed')
  })
})

describe('group selection through the existing lane/owner/package selector', () => {
  it('ORs scenarios and intersects contract, owner, lane, and package dimensions', () => {
    const selected = selectTestFiles(repoRoot, {
      scenarios: ['first-run', 'trading-approval'], contracts: ['alice-uta'],
      owners: ['alice'], lanes: ['hermetic'],
    })
    expect(selected).toEqual(['src/services/uta-client/UTAManagerSDK.spec.ts'])
    expect(selectTestFiles(repoRoot, {
      scenarios: ['trading-approval'], lanes: ['integration'], packages: ['@traderalice/uta-service'],
    })).toEqual(['tests/integration/alice-uta/approval-http.spec.ts', 'tests/integration/trading-approval/uta-lifecycle.spec.ts'])
    expect(selectTestFiles(repoRoot, {
      scenarios: ['workspace-creation', 'trading-approval'], lanes: ['integration'],
    })).toHaveLength(3)
  })

  it('runs only hermetic spec evidence by default and explains separate acceptance', () => {
    const result = selector('--scenario', 'trading-approval', '--json')
    expect(result.status).toBe(0)
    const plan = JSON.parse(result.stdout)
    expect(plan.executed).toBe(false)
    expect(plan.files.map((file: { path: string }) => file.path)).toEqual(['src/services/uta-client/UTAManagerSDK.spec.ts'])
    expect(plan.invocations.every((entry: { lane: string }) => entry.lane === 'hermetic')).toBe(true)
    expect(plan.groups[0].dedicatedCommands).toContainEqual(expect.objectContaining({
      id: 'open-alice#test:live:uta-paper', executed: false, lane: 'live-paper',
    }))
  })

  it('retains changed-file forwarding for group intersections', () => {
    const result = selector('--contract=alice-uta', '--scenario=first-run', '--changed', 'origin/dev', '--json')
    expect(result.status).toBe(0)
    const plan = JSON.parse(result.stdout)
    expect(plan.selectors.contracts).toEqual(['alice-uta'])
    expect(plan.invocations[0].args).toEqual(expect.arrayContaining(['--changed', 'origin/dev']))
  })

  it('fails closed for misspelled groups and an empty executable evidence intersection', () => {
    expect(selector('--scenario', 'desktop-lifecyle', '--json').stderr).toContain('Unknown test scenario')
    const empty = selector('--scenario', 'desktop-lifecycle', '--lane', 'integration', '--json')
    expect(empty.status).toBe(2)
    expect(empty.stderr).toContain('selection matched zero catalogued tests')
    expect(selector('--scenario', 'trading-approval', '--lane', 'live-paper').status).toBe(2)
  })

  it('inspects missing requirements and risky command metadata without running them', () => {
    const result = selector('--groups', '--scenario', 'connector-delivery', '--json')
    expect(result.status).toBe(0)
    const plan = JSON.parse(result.stdout)
    expect(plan.executed).toBe(false)
    expect(plan.groups).toHaveLength(1)
    expect(plan.groups[0].requirements).toContainEqual(expect.objectContaining({
      id: 'adapter-recovery', evidenceStatus: 'missing', evidence: [],
    }))
    expect(plan.groups[0].dedicatedCommands.every((command: { executed: boolean }) => command.executed === false)).toBe(true)
    const explanation = selector('--groups', '--scenario', 'desktop-lifecycle', '--explain')
    expect(explanation.stdout).toContain('Fake BrowserWindow/App')
    expect(explanation.stdout).toContain('gap: Real macOS and Windows')
    expect(selector('--groups', '--lane', 'live-paper').status).toBe(2)
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

  it('accounts for every spec exactly once and exposes owner-only mapping honestly', () => {
    const result = selector('--inventory', '--json')
    expect(result.status).toBe(0)
    const inventory = JSON.parse(result.stdout)
    expect(inventory.executed).toBe(false)
    expect(inventory.files.map((file: { path: string }) => file.path)).toEqual(specs)
    expect(new Set(inventory.files.map((file: { path: string }) => file.path)).size).toBe(specs.length)
    expect(inventory.commands).toHaveLength(commands.length)
    expect(inventory.ownerOnlyCount).toBeGreaterThan(0)
    for (const file of inventory.files) {
      expect(file.owner).toHaveLength(1)
      expect(file.lane).toHaveLength(1)
      if (file.mapping === 'group-evidence') expect(coverageGroups.some((group) => groupSpecFiles(group).includes(file.path))).toBe(true)
    }
    expect(selector('--inventory', '--scenario', 'first-run').status).toBe(2)
  })
})


it('reports only the platforms supported by packaged macOS smoke modes', () => {
  for (const id of ['open-alice#electron:smoke:packaged', 'open-alice#electron:smoke:onboarding', 'open-alice#electron:smoke:trading-mode']) {
    expect(commands.find(command => command.id === id)?.platforms).toEqual(['macOS-arm64', 'macOS-x64'])
  }
  expect(commands.find(command => command.id === 'open-alice#electron:smoke:workspace')?.platforms).toContain('Windows-x64')
})
