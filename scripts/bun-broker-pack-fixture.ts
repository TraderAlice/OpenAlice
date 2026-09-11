import { copyFile, mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const ENGINE = 'ccxt'
const RELEASE = 'bun-external-fixture'
const ACCOUNT_ID = 'binance-readonly'
const SDK_MARKER = 'external-broker-sdk-native-v1'

export interface BunBrokerPackFixture {
  readonly engine: typeof ENGINE
  readonly release: typeof RELEASE
  readonly accountId: typeof ACCOUNT_ID
  readonly sdkMarker: typeof SDK_MARKER
  readonly expectedLabel: string
}

/**
 * Materialize a production-shaped active Broker Pack under OPENALICE_HOME.
 * The Pack entry imports a dependency from its own node_modules tree so the
 * compiled Bun UTA acceptance proves the external module-resolution boundary,
 * not merely a standalone file URL import.
 */
export async function prepareBunBrokerPackFixture(
  home: string,
  productVersion: string,
  repositoryRoot: string,
): Promise<BunBrokerPackFixture> {
  const engineRoot = join(home, 'runtime', 'broker-packs', ENGINE)
  const releaseRoot = join(engineRoot, 'releases', RELEASE)
  const sdkRoot = join(
    releaseRoot,
    'node_modules',
    '@openalice-fixture',
    'broker-sdk',
  )
  await Promise.all([
    mkdir(join(home, 'data', 'config'), { recursive: true }),
    mkdir(join(releaseRoot, 'dist'), { recursive: true }),
    mkdir(sdkRoot, { recursive: true }),
  ])

  await Promise.all([
    writeFile(
      join(home, 'data', 'config', 'trading.json'),
      `${JSON.stringify({ keylessDataSources: ['binance'] }, null, 2)}\n`,
    ),
    writeFile(
      join(engineRoot, 'active.json'),
      `${JSON.stringify({
        schemaVersion: 1,
        engine: ENGINE,
        release: RELEASE,
        activatedAt: '2026-08-29T00:00:00.000Z',
      }, null, 2)}\n`,
    ),
    writeFile(
      join(releaseRoot, 'broker-pack.json'),
      `${JSON.stringify({
        schemaVersion: 1,
        apiVersion: 1,
        engine: ENGINE,
        version: productVersion,
        entry: 'dist/index.js',
        contentId: RELEASE,
        installedAt: '2026-08-29T00:00:00.000Z',
      }, null, 2)}\n`,
    ),
    writeFile(
      join(releaseRoot, 'package.json'),
      `${JSON.stringify({
        name: '@traderalice/uta-broker-ccxt',
        version: productVersion,
        type: 'module',
        dependencies: {
          '@openalice-fixture/broker-sdk': '1.0.0',
        },
      }, null, 2)}\n`,
    ),
    writeFile(join(releaseRoot, 'dist', 'index.js'), brokerPackModuleSource()),
    writeFile(
      join(sdkRoot, 'package.json'),
      `${JSON.stringify({
        name: '@openalice-fixture/broker-sdk',
        version: '1.0.0',
        type: 'module',
        exports: './index.js',
      }, null, 2)}\n`,
    ),
    writeFile(
      join(sdkRoot, 'index.js'),
      nativeSdkModuleSource(),
    ),
    copyFile(
      await resolveNativeFixtureBinary(repositoryRoot),
      join(sdkRoot, 'native-addon.node'),
    ),
  ])

  return {
    engine: ENGINE,
    release: RELEASE,
    accountId: ACCOUNT_ID,
    sdkMarker: SDK_MARKER,
    expectedLabel: `Binance (read-only data) [${SDK_MARKER}]`,
  }
}

async function resolveNativeFixtureBinary(repositoryRoot: string): Promise<string> {
  const pnpmRoot = join(repositoryRoot, 'node_modules', '.pnpm')
  const storeEntry = (await readdir(pnpmRoot))
    .find((name) => name.startsWith('dprint-node@'))
  if (!storeEntry) {
    throw new Error('dprint-node native fixture package is missing from node_modules')
  }
  const suffix = process.platform === 'darwin'
    ? `darwin-${process.arch}`
    : process.platform === 'linux'
      ? `linux-${process.arch}-gnu`
      : null
  if (!suffix) throw new Error(`Bun Broker Pack native fixture does not support ${process.platform}`)
  return join(
    pnpmRoot,
    storeEntry,
    'node_modules',
    'dprint-node',
    `dprint-node.${suffix}.node`,
  )
}

function nativeSdkModuleSource(): string {
  return `import { createRequire } from 'node:module'

const nativeAddon = createRequire(import.meta.url)('./native-addon.node')
if (typeof nativeAddon.format !== 'function') {
  throw new Error('external Broker Pack native SDK did not load')
}

export const externalSdkMarker = ${JSON.stringify(SDK_MARKER)}
`
}

function brokerPackModuleSource(): string {
  return `import { externalSdkMarker } from '@openalice-fixture/broker-sdk'

export const BROKER_PACK_API_VERSION = 1
export const BROKER_ENGINE = 'ccxt'
export const configSchema = {
  parse(value) {
    if (externalSdkMarker !== ${JSON.stringify(SDK_MARKER)}) {
      throw new Error('external Broker Pack SDK did not load')
    }
    return value
  },
}

export function createBroker(config) {
  const unsupported = async () => { throw new Error('fixture broker operation is unavailable') }
  return {
    id: config.id,
    label: \`${'${config.label ?? config.id}'} [${'${externalSdkMarker}'}]\`,
    brokerEngine: BROKER_ENGINE,
    init: async () => {},
    close: async () => {},
    searchContracts: async () => [],
    getContractDetails: async () => null,
    placeOrder: unsupported,
    modifyOrder: unsupported,
    cancelOrder: unsupported,
    closePosition: unsupported,
    getAccount: unsupported,
    getPositions: async () => [],
    getOrders: async () => [],
    getOrder: async () => null,
    getQuote: unsupported,
    getMarketClock: unsupported,
    getCapabilities: () => ({ marketData: true, trading: false }),
    getNativeKey: (contract) => String(contract?.symbol ?? ''),
    resolveNativeKey: (nativeKey) => ({ symbol: nativeKey }),
  }
}
`
}
