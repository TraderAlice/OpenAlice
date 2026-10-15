import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// Suite registration is data only. Reading it never imports tests or probes a host.
export function readTestSuites(root = repoRoot) {
  return JSON.parse(readFileSync(resolve(root, 'tests/suites.json'), 'utf8'))
}

export const testSuites = readTestSuites()
export const testTiers = ['unit', 'integration', 'e2e']
export const registeredTestDefinitions = testSuites.flatMap(suite =>
  (suite.files ?? []).map(path => ({ ...suite, path })))

export function suiteForTestFile(path) {
  return testSuites.find(suite => suite.files?.includes(path))
}

export function tierForTestFile(path) {
  return path.startsWith('tests/integration/') ? 'integration'
    : path.startsWith('tests/e2e/') ? 'e2e' : 'unit'
}

export function selectTestSuites(selectors = {}) {
  for (const id of selectors.suites ?? []) {
    if (!testSuites.some(suite => suite.id === id)) throw new Error(`Unknown test suite: ${id}`)
  }
  for (const tier of selectors.tiers ?? []) {
    if (!testTiers.includes(tier)) throw new Error(`Unknown test tier: ${tier}`)
  }
  return testSuites.filter(suite =>
    (!selectors.suites?.length || selectors.suites.includes(suite.id))
    && (!selectors.tiers?.length || selectors.tiers.includes(suite.tier)))
}

export function validateTestSuites(root, suites, specs, commands, catalog) {
  const require = (condition, message) => { if (!condition) throw new Error(message) }
  const safePath = path => typeof path === 'string' && path.length > 0
    && !path.startsWith('/') && !path.includes('\\') && !path.includes(':') && !path.split('/').includes('..')
  const ids = new Set(), registered = new Set(), runners = new Set()
  for (const suite of suites) {
    require(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(suite.id) && !ids.has(suite.id), `Invalid/duplicate suite: ${suite.id}`)
    ids.add(suite.id)
    require(['integration', 'e2e'].includes(suite.tier), `${suite.id}: only integration/E2E suites are registered`)
    require(typeof suite.title === 'string' && suite.title.length && typeof suite.scope === 'string' && suite.scope.length, `${suite.id}: purpose and scope required`)
    require(catalog.owners.includes(suite.owner) && catalog.lanes.includes(suite.lane), `${suite.id}: invalid owner/lane`)
    require(Array.isArray(suite.areas) && suite.areas.every(area => catalog.areas.includes(area)), `${suite.id}: invalid area`)
    require(!suite.package || catalog.packages.includes(suite.package), `${suite.id}: invalid package`)
    require((suite.files?.length ?? 0) + (suite.commands?.length ?? 0) > 0, `${suite.id}: executable entry required`)
    for (const path of suite.files ?? []) {
      require(safePath(path) && path.startsWith(`tests/${suite.tier}/${suite.id}/`) && specs.includes(path), `${suite.id}: unknown or misplaced spec ${path}`)
      require(!registered.has(path), `Duplicate suite registration: ${path}`)
      registered.add(path)
      require(suite.lane !== 'hermetic' || !/\.(?:e2e|bbProvider|live)\.spec\./.test(path), `${suite.id}: filename excluded from hermetic collection`)
    }
    for (const id of suite.commands ?? []) {
      const command = commands.find(command => command.id === id)
      require(command && !['spec-selection', 'inventory'].includes(command.kind), `${suite.id}: unknown/non-dedicated command ${id}`)
      require(command.owner === suite.owner && command.lane === suite.lane, `${suite.id}: command owner/lane mismatch`)
      require(!runners.has(id), `Duplicate runner registration: ${id}`)
      runners.add(id)
    }
  }
  for (const command of commands.filter(command => ['process-acceptance', 'host-acceptance', 'artifact-acceptance'].includes(command.kind))) {
    require(runners.has(command.id), `Acceptance runner lacks suite registration: ${command.id}`)
  }
  for (const path of specs.filter(path => path.startsWith('tests/'))) {
    require(registered.has(path), `Higher-tier spec lacks registration: ${path}`)
  }
}
