import { readdirSync } from 'node:fs'
import { resolve, relative } from 'node:path'

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

export const deterministicProductE2eIncludes = [
  'src/workspaces/workspace-creation.e2e.spec.ts',
  'services/uta/src/domain/trading/__test__/e2e/uta-lifecycle.e2e.spec.ts',
]

export const externalReadonlyIncludes = [
  'src/domain/market-data/__test__/e2e/market-data.e2e.spec.ts',
  'src/domain/market-data/__tests__/bbProviders/*.bbProvider.spec.ts',
  'services/uta/src/domain/trading/__test__/e2e/ccxt-hyperliquid-markets.e2e.spec.ts',
  'services/uta/src/domain/trading/brokers/ccxt/CcxtBroker.e2e.spec.ts',
  'packages/opentypebb/src/providers/twse/__tests__/twse.live.spec.ts',
  'packages/ibkr/tests/e2e/connect.e2e.spec.ts',
  'packages/ibkr/tests/e2e/contract-details.e2e.spec.ts',
]

export const livePaperIncludes = [
  'services/uta/src/domain/trading/__test__/e2e/*.e2e.spec.ts',
  'packages/ibkr/tests/e2e/order-precision.e2e.spec.ts',
]

export const livePaperExcludes = [
  'services/uta/src/domain/trading/__test__/e2e/uta-lifecycle.e2e.spec.ts',
  'services/uta/src/domain/trading/__test__/e2e/ccxt-hyperliquid-markets.e2e.spec.ts',
]

const collectionRoots = ['src', 'packages', 'services', 'apps', 'scripts', 'ui']
const systemTestFiles = new Set([
  'scripts/railway-entrypoint.spec.ts',
  'scripts/railway-fence-pty.spec.ts',
])

export function isRiskLaneTest(file) {
  const normalized = slash(file)
  return normalized.includes('.e2e.spec.')
    || normalized.includes('.bbProvider.spec.')
    || normalized.includes('.live.spec.')
}

export function isHermeticDefaultTest(file) {
  const normalized = slash(file)
  return normalized.includes('.spec.')
    && !isRiskLaneTest(normalized)
    && !systemTestFiles.has(normalized)
}

function isWithin(file, root) {
  return file === root || file.startsWith(`${root}/`)
}

export function ownersForTestFile(file) {
  const normalized = slash(file)
  return ownerSuiteNames.filter((owner) => (
    ownerSuites[owner].roots.some((root) => isWithin(normalized, root))
  ))
}

function walk(directory, output) {
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

export function collectOwnerTestFiles(repoRoot, owner) {
  if (!ownerSuites[owner]) throw new Error(`Unknown test owner: ${owner}`)
  return collectRepositorySpecFiles(repoRoot).filter((file) => (
    isHermeticDefaultTest(file) && ownersForTestFile(file).includes(owner)
  ))
}

export function ownerSuiteCommand(owner) {
  if (!ownerSuites[owner]) throw new Error(`Unknown test owner: ${owner}`)
  return `node scripts/run-owner-tests.mjs ${owner}`
}

export function assertLivePaperAcknowledgement(env = process.env) {
  if (env.OPENALICE_UTA_LIVE_PAPER === '1') return
  throw new Error([
    'UTA live-paper tests submit real orders to configured demo/paper accounts.',
    'Run only after verifying those accounts, then acknowledge with:',
    'OPENALICE_UTA_LIVE_PAPER=1 pnpm test:uta:live-paper',
  ].join('\n'))
}
