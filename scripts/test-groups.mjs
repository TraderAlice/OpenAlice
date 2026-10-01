import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const kinds = { scenario: 'scenarios', contract: 'contracts' }

// Read data only. Neither browsing groups nor selecting evidence imports a
// test module, probes a credential, or starts a dedicated acceptance runner.
export function readCoverageGroups(root = repoRoot) {
  return Object.entries(kinds).flatMap(([kind, directory]) => {
    const parent = resolve(root, 'tests', directory)
    if (!existsSync(parent)) return []
    return readdirSync(parent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((entry) => {
        const path = `tests/${directory}/${entry.name}/coverage.json`
        const data = JSON.parse(readFileSync(resolve(root, path), 'utf8'))
        return { ...data, kind, name: entry.name, path }
      })
  })
}

export const coverageGroups = readCoverageGroups()
export const scenarioSuiteNames = coverageGroups.filter((group) => group.kind === 'scenario').map((group) => group.name)
export const contractSuiteNames = coverageGroups.filter((group) => group.kind === 'contract').map((group) => group.name)
export const centralTestDefinitions = coverageGroups.flatMap((group) => group.centralTests ?? [])

export function groupSpecFiles(group) {
  return [...new Set(group.requirements.flatMap((requirement) => (
    requirement.evidence.flatMap((evidence) => evidence.spec ? [evidence.spec] : [])
  )))].sort()
}

export function groupCommandIds(group) {
  return [...new Set(group.requirements.flatMap((requirement) => (
    requirement.evidence.flatMap((evidence) => evidence.command ? [evidence.command] : [])
  )))].sort()
}

export function selectCoverageGroups(selectors = {}) {
  for (const [kind, values] of [['scenario', selectors.scenarios ?? []], ['contract', selectors.contracts ?? []]]) {
    for (const name of values) {
      if (!coverageGroups.some((group) => group.kind === kind && group.name === name)) {
        throw new Error(`Unknown test ${kind}: ${name}`)
      }
    }
  }
  if (!(selectors.scenarios?.length || selectors.contracts?.length)) return coverageGroups
  return coverageGroups.filter((group) => (
    group.kind === 'scenario' ? selectors.scenarios?.includes(group.name) : selectors.contracts?.includes(group.name)
  ))
}

export function groupsForTestFile(file) {
  return coverageGroups.filter((group) => groupSpecFiles(group).includes(file))
    .map((group) => `${group.kind}:${group.name}`)
}

export function requirementStatus(requirement) {
  if (requirement.review === 'unreviewed') return 'unreviewed'
  if (requirement.evidence.length === 0) return 'missing'
  return requirement.gap ? 'partial' : 'mapped'
}

export function coverageSummary(group) {
  const counts = { mapped: 0, partial: 0, missing: 0, unreviewed: 0 }
  for (const requirement of group.requirements) counts[requirementStatus(requirement)] += 1
  return counts
}

export function validateCoverageGroups(root, groups, specs, commands, catalog) {
  const { owners, lanes, areas, packages } = catalog
  const specSet = new Set(specs)
  const commandSet = new Set(commands.map((command) => command.id))
  const groupIds = new Set()
  const centralPaths = new Set()
  const levels = ['unit', 'component', 'contract', 'integration', 'acceptance']
  function require(condition, message) {
    if (!condition) throw new Error(message)
  }
  function safePath(path) {
    return typeof path === 'string' && path.length > 0 && !path.startsWith('/')
      && !path.includes('\\') && !path.split('/').includes('..') && !path.includes(':')
  }
  for (const group of groups) {
    const id = `${group.kind}:${group.name}`
    require(kinds[group.kind] && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(group.name), `Invalid group: ${id}`)
    require(!groupIds.has(id), `Duplicate group: ${id}`)
    groupIds.add(id)
    require(typeof group.title === 'string' && group.title.length > 0, `${id}: title required`)
    require(owners.includes(group.owner), `${id}: unknown owner ${group.owner}`)
    require(safePath(group.guide) && existsSync(resolve(root, group.guide)), `${id}: missing owner guide`)
    require(Array.isArray(group.requirements) && group.requirements.length > 0, `${id}: requirements required`)
    const requirementIds = new Set()
    for (const requirement of group.requirements) {
      const context = `${id}/${requirement.id}`
      require(typeof requirement.id === 'string' && requirement.id.length > 0 && !requirementIds.has(requirement.id), `${context}: duplicate/empty requirement`)
      requirementIds.add(requirement.id)
      for (const field of ['initial', 'action', 'expected']) {
        require(typeof requirement[field] === 'string' && requirement[field].length > 0, `${context}: ${field} required`)
      }
      require(['P0', 'P1', 'P2'].includes(requirement.priority), `${context}: priority required`)
      require(['reviewed', 'unreviewed'].includes(requirement.review), `${context}: review state required`)
      require(Array.isArray(requirement.evidence), `${context}: evidence must be an array`)
      require(typeof requirement.gap === 'string', `${context}: explicit gap required (empty when none identified)`)
      require(requirement.evidence.length > 0 || requirement.gap.length > 0, `${context}: missing evidence needs a gap`)
      for (const evidence of requirement.evidence) {
        require(Boolean(evidence.spec) !== Boolean(evidence.command), `${context}: evidence needs exactly one spec or command`)
        require(levels.includes(evidence.level), `${context}: invalid fidelity ${evidence.level}`)
        require(typeof evidence.scope === 'string' && evidence.scope.length > 0, `${context}: evidence scope required`)
        require(typeof evidence.assertion === 'string' && evidence.assertion.length > 0, `${context}: assertion required`)
        if (evidence.spec) {
          require(safePath(evidence.spec) && specSet.has(evidence.spec), `${context}: unknown spec ${evidence.spec}`)
          // A stale test name is a broken evidence reference, not proof of coverage.
          require(readFileSync(resolve(root, evidence.spec), 'utf8').includes(evidence.assertion), `${context}: assertion reference drifted in ${evidence.spec}`)
        } else {
          require(commandSet.has(evidence.command), `${context}: unknown command ${evidence.command}`)
        }
      }
    }
    for (const test of group.centralTests ?? []) {
      const prefixes = [
        `tests/integration/${group.name}/`,
        `tests/e2e/${group.name}/`,
        // Existing PTY groups move after their actual test scope is reviewed.
        `tests/${kinds[group.kind]}/${group.name}/`,
      ]
      require(safePath(test.path) && prefixes.some((prefix) => test.path.startsWith(prefix)) && specSet.has(test.path), `${id}: central test must exist inside its topic`)
      require(!centralPaths.has(test.path), `${id}: duplicate central ownership ${test.path}`)
      centralPaths.add(test.path)
      require(owners.includes(test.owner) && lanes.includes(test.lane), `${id}: invalid central owner/lane`)
      require(Array.isArray(test.areas) && test.areas.every((area) => areas.includes(area)), `${id}: invalid central area`)
      require(test.package == null || packages.includes(test.package), `${id}: invalid central package`)
      require(test.lane !== 'hermetic' || !/\.(?:e2e|bbProvider|live)\.spec\./.test(test.path), `${id}: hermetic central filename is excluded by the default config`)
      require(groupSpecFiles(group).includes(test.path), `${id}: central test lacks an evidence row`)
    }
  }
  for (const spec of specs.filter((path) => path.startsWith('tests/'))) {
    require(centralPaths.has(spec), `Central spec lacks explicit ownership: ${spec}`)
  }
}
