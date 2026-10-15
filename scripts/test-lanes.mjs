import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'

import { registeredTestDefinitions, selectTestSuites, tierForTestFile } from './test-suites.mjs'
import { collectTestCommands as collectCommands } from './test-commands.mjs'
export { systemCommandSuites } from './test-commands.mjs'

const slash = (value) => value.replaceAll('\\', '/')

export const ownerSuites = {
  alice: {
    project: 'node',
    roots: [
      'src/ai-providers',
      'src/core',
      'src/domain',
      'src/migrations',
      'src/server',
      'src/services',
      'src/tool',
      'src/webui',
      'packages/opentypebb',
      'packages/update-lifecycle',
    ],
  },
  ui: {
    project: 'ui',
    roots: ['ui'],
  },
  uta: {
    project: 'node',
    roots: [
      'services/uta',
      'packages/uta-protocol',
      'packages/ibkr',
      'packages/uta-broker-alpaca',
      'packages/uta-broker-ccxt',
      'packages/uta-broker-ibkr',
      'packages/uta-broker-leverup',
      'packages/uta-broker-longbridge',
    ],
  },
  connector: {
    project: 'node',
    roots: ['services/connector', 'packages/connector-protocol'],
  },
  'runtime-cli': {
    project: 'node',
    roots: ['src/workspaces', 'packages/cli', 'packages/guardian-runtime'],
  },
  desktop: {
    project: 'node',
    roots: ['apps/desktop'],
  },
  'repo-tooling': {
    project: 'node',
    roots: ['scripts'],
  },
}

export const ownerSuiteNames = Object.freeze(Object.keys(ownerSuites))

export const integrationIncludes = registeredTestDefinitions.filter((test) => test.lane === 'integration').map((test) => test.path)

export const externalReadonlyIncludes = registeredTestDefinitions.filter(test => test.lane === 'external-readonly').map(test => test.path)
export const livePaperIncludes = registeredTestDefinitions.filter(test => test.lane === 'live-paper').map(test => test.path)

export const laneSuites = {
  hermetic: {
    config: 'vitest.config.ts',
    description: 'Repository specs isolated from real OpenAlice state and external services.',
    sideEffects: 'temporary local files and test-owned subprocesses only',
    prerequisites: ['workspace dependencies installed'],
    runnable: true,
  },
  integration: {
    config: 'vitest.integration.config.ts',
    description: 'Deterministic local product integration with hermetic state.',
    sideEffects: 'temporary local files and test-owned local processes only',
    prerequisites: ['workspace dependencies installed'],
    runnable: true,
  },
  'external-readonly': {
    config: 'vitest.external.config.ts',
    description: 'Read-only checks against public APIs, configured providers, or local TWS.',
    sideEffects: 'network reads; may read local provider configuration; never submits orders',
    prerequisites: [
      'required network/provider/TWS access is configured by the selected spec',
      'an all-skipped run is not acceptance evidence',
    ],
    runnable: true,
  },
  'live-paper': {
    config: 'vitest.uta-live.config.ts',
    description: 'Broker acceptance that can submit, cancel, or close demo/paper orders.',
    sideEffects: 'network and configured demo/paper account writes',
    prerequisites: [
      'verify every selected account is demo/paper and record its pre-run state',
      'set OPENALICE_UTA_LIVE_PAPER=1 to acknowledge order writes',
      'restore positions and open orders to the pre-run baseline after success or failure',
      'an all-skipped run is not acceptance evidence',
    ],
    runnable: true,
  },
  system: {
    config: null,
    description: 'Operator/artifact acceptance owned by dedicated system runners.',
    sideEffects: 'varies by command; may use Docker, local processes, or generated artifacts',
    prerequisites: ['use the matching test:system:* command'],
    runnable: false,
  },
}

export const laneSuiteNames = Object.freeze(Object.keys(laneSuites))

const workflowContractIncludes = [
  'scripts/classify-beta-release-prep.spec.mjs',
  'scripts/prepare-cli-neutral-inputs.spec.mjs',
  'scripts/ci-workflow.spec.ts',
  'scripts/beta-release-prep-workflow.spec.ts',
  'scripts/cli-channel-authority-workflow.spec.ts',
  'scripts/cli-installer-workflow.spec.ts',
  'scripts/desktop-package-workflow.spec.ts',
  'scripts/release-workflow.spec.ts',
]

const platformContractIncludes = [
  'scripts/guardian/shared.spec.ts',
  'scripts/pnpm-command.spec.ts',
  'services/connector/src/core/io-journal.spec.ts',
  'src/core/windows-workspace-shell.spec.ts',
  'src/services/auth/session-store.spec.ts',
  'src/services/auth/token-store.spec.ts',
  'src/workspaces/adapters/shell.spec.ts',
  'src/workspaces/agent-conversation-log.spec.ts',
  'src/workspaces/agent-detect.spec.ts',
  'src/workspaces/headless-task-win-shim.spec.ts',
  'src/workspaces/spawn-env.spec.ts',
  'src/workspaces/workspace-creator.spec.ts',
]

export const areaSuites = {
  workspace: {
    description: 'Workspace creation and Runtime/CLI behavior.',
    roots: ['src/workspaces'],
  },
  uta: {
    description: 'UTA service, protocol, broker packages, and broker acceptance.',
    roots: ownerSuites.uta.roots,
  },
  workflow: {
    description: 'Repository automation and release workflow contracts.',
    includes: workflowContractIncludes,
  },
  platform: {
    description: 'Native CLI, Guardian, shell, auth, and startup contracts.',
    roots: ['packages/cli/src', 'packages/guardian-runtime/src'],
    includes: platformContractIncludes,
  },
  'connector-replay': {
    description: 'Connector journal replay and adapter-neutral event fixtures.',
    includes: [
      'services/connector/src/core/io-replay.spec.ts',
      'services/connector/src/core/io-events.spec.ts',
      'services/connector/src/adapters/shared.spec.ts',
    ],
  },
  'market-data': {
    description: 'Alice/UTA public market-data and provider reads.',
    roots: ['src/domain/market-data', 'packages/opentypebb'],
  },
  ibkr: {
    description: 'IBKR package, adapter, and paper-account acceptance.',
    roots: ['packages/ibkr', 'packages/uta-broker-ibkr', 'services/uta/src/domain/trading/brokers/ibkr'],
  },
  bybit: {
    description: 'Bybit demo-account acceptance.',
  },
  okx: {
    description: 'OKX demo-account acceptance.',
  },
  alpaca: {
    description: 'Alpaca paper-account acceptance.',
  },
  hyperliquid: {
    description: 'Hyperliquid read-only or demo-account acceptance.',
  },
  'bybit-diagnostic': {
    description: 'Manual raw broker diagnostic that market-buys and best-effort closes.',
  },
  'uta-paper': {
    description: 'Configured UTA paper sweep, excluding the raw market-buy diagnostic.',
    roots: ownerSuites.uta.roots,
  },
}

export const areaSuiteNames = Object.freeze(Object.keys(areaSuites))

const collectionRoots = ['src', 'packages', 'services', 'apps', 'scripts', 'ui', 'tests']

function isWithin(file, root) {
  return file === root || file.startsWith(`${root}/`)
}

export function matchesTestPattern(file, pattern) {
  let source = '^'
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]
    if (char === '*') {
      if (pattern[index + 1] === '*') {
        if (pattern[index + 2] === '/') {
          source += '(?:.*/)?'
          index += 2
        } else {
          source += '.*'
          index += 1
        }
      } else {
        source += '[^/]*'
      }
    } else {
      source += char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
    }
  }
  return new RegExp(`${source}$`).test(slash(file))
}

function matchesAny(file, patterns = []) {
  return patterns.some((pattern) => matchesTestPattern(file, pattern))
}

function matchesSuiteDefinition(file, suite) {
  const normalized = slash(file)
  const included = suite.roots?.some((root) => isWithin(normalized, root))
    || matchesAny(normalized, suite.includes)
  return Boolean(included) && !matchesAny(normalized, suite.excludes)
}

export function isRiskLaneTest(file) {
  const normalized = slash(file)
  const central = registeredTestDefinitions.find((test) => test.path === normalized)
  if (central) return central.lane !== 'hermetic'
  return normalized.includes('.e2e.spec.')
    || normalized.includes('.bbProvider.spec.')
    || normalized.includes('.live.spec.')
}

export function isHermeticDefaultTest(file) {
  const normalized = slash(file)
  return normalized.includes('.spec.') && !isRiskLaneTest(normalized)
}

export function lanesForTestFile(file) {
  const normalized = slash(file)
  const central = registeredTestDefinitions.find((test) => test.path === normalized)
  if (central) return [central.lane]
  return isHermeticDefaultTest(normalized) ? ['hermetic'] : []
}

export function ownersForTestFile(file) {
  const normalized = slash(file)
  const central = registeredTestDefinitions.find((test) => test.path === normalized)
  if (central) return [central.owner]
  return ownerSuiteNames.filter((owner) => (
    ownerSuites[owner].roots.some((root) => isWithin(normalized, root))
  ))
}

export function areasForTestFile(file) {
  const central = registeredTestDefinitions.find((test) => test.path === slash(file))
  return [...new Set([
    ...areaSuiteNames.filter((area) => matchesSuiteDefinition(file, areaSuites[area])),
    ...(central?.areas ?? []),
  ])]
}

export function centralHermeticIncludes(project) {
  return registeredTestDefinitions.filter((test) => (
    test.lane === 'hermetic' && ownerSuites[test.owner]?.project === project
  )).map((test) => test.path)
}

export function collectTestCommands(repoRoot) {
  return collectCommands(repoRoot, collectWorkspacePackages(repoRoot), (root) => ownersForTestFile(`${root}/catalog.spec.ts`)[0])
}

function walk(directory, output) {
  if (!existsSync(directory)) return
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) walk(path, output)
    else output.push(path)
  }
}

export function collectRepositorySpecFiles(repoRoot) {
  const absolute = []
  for (const root of collectionRoots) walk(resolve(repoRoot, root), absolute)
  return absolute
    .map((file) => slash(relative(repoRoot, file)))
    .filter((file) => file.includes('.spec.'))
    .sort()
}

export function collectWorkspacePackages(repoRoot) {
  const roots = []
  for (const parent of ['apps', 'packages', 'services']) {
    const directory = resolve(repoRoot, parent)
    if (!existsSync(directory)) continue
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) roots.push(`${parent}/${entry.name}`)
    }
  }
  roots.push('ui')

  return roots.flatMap((root) => {
    const manifestPath = resolve(repoRoot, root, 'package.json')
    if (!existsSync(manifestPath)) return []
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    return typeof manifest.name === 'string' ? [{ name: manifest.name, root }] : []
  }).sort((left, right) => left.name.localeCompare(right.name))
}

function normalizePathSelector(value) {
  const normalized = slash(value).replace(/^\.\//, '').replace(/\/$/, '')
  if (!normalized || isAbsolute(value) || normalized.split('/').includes('..')) {
    throw new Error(`Test paths must be non-empty repo-relative paths: ${value}`)
  }
  return normalized
}

function matchesPathSelector(file, selector) {
  if (selector.includes('*')) return matchesTestPattern(file, selector)
  return isWithin(file, selector)
}

export function selectTestFiles(repoRoot, selectors = {}) {
  const files = collectRepositorySpecFiles(repoRoot)
  const lanes = selectors.lanes ?? []
  const owners = selectors.owners ?? []
  const areas = selectors.areas ?? []
  const packages = selectors.packages ?? []
  const paths = (selectors.paths ?? []).map(normalizePathSelector)
  const suites = selectTestSuites(selectors)
  const suitePaths = new Set(suites.flatMap(suite => suite.files ?? []))

  for (const lane of lanes) {
    if (!laneSuites[lane]) throw new Error(`Unknown test lane: ${lane}`)
  }
  for (const owner of owners) {
    if (!ownerSuites[owner]) throw new Error(`Unknown test owner: ${owner}`)
  }
  for (const area of areas) {
    if (!areaSuites[area]) throw new Error(`Unknown test area: ${area}`)
  }

  const workspacePackages = collectWorkspacePackages(repoRoot)
  const packageRoots = packages.map((name) => {
    const entry = workspacePackages.find((candidate) => candidate.name === name)
    if (!entry) throw new Error(`Unknown workspace package: ${name}`)
    return entry.root
  })

  return files.filter((file) => (
    (lanes.length === 0 || lanesForTestFile(file).some((lane) => lanes.includes(lane)))
    && (owners.length === 0 || ownersForTestFile(file).some((owner) => owners.includes(owner)))
    && (areas.length === 0 || areasForTestFile(file).some((area) => areas.includes(area)))
    && (packageRoots.length === 0 || packageRoots.some((root) => isWithin(file, root))
      || packages.includes(registeredTestDefinitions.find((test) => test.path === file)?.package))
    && (paths.length === 0 || paths.some((path) => matchesPathSelector(file, path)))
    && (!selectors.suites?.length || suitePaths.has(file))
    && (!selectors.tiers?.length || selectors.tiers.includes(tierForTestFile(file)))
  ))
}

export function collectOwnerTestFiles(repoRoot, owner) {
  if (!ownerSuites[owner]) throw new Error(`Unknown test owner: ${owner}`)
  return selectTestFiles(repoRoot, { lanes: ['hermetic'], owners: [owner] })
}

export function ownerSuiteCommand(owner) {
  if (!ownerSuites[owner]) throw new Error(`Unknown test owner: ${owner}`)
  return `node scripts/run-tests.mjs --owner ${owner}`
}

export function assertLivePaperAcknowledgement(env = process.env) {
  if (env.OPENALICE_UTA_LIVE_PAPER === '1') return
  throw new Error([
    'UTA live-paper tests submit real orders to configured demo/paper accounts.',
    'Run only after verifying the selected accounts.',
    'Set OPENALICE_UTA_LIVE_PAPER=1 on the selected provider-specific test:live:* command.',
  ].join('\n'))
}
