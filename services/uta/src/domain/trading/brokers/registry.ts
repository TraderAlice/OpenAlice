/**
 * Broker engine loader.
 *
 * Live engines are optional runtime packs. Mock is the only built-in engine,
 * so UTA startup never evaluates an unused vendor SDK.
 */

import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import type { z } from 'zod'
import type { IBroker } from './types.js'
import { MockBroker } from './mock/MockBroker.js'
import type { BrokerEngine } from '@traderalice/uta-protocol'
import {
  BROKER_PACK_API_VERSION,
  isInstallableBrokerEngine,
  resolveActiveBrokerPack,
  type ResolvedBrokerPack,
  type InstallableBrokerEngine,
} from '@/core/broker-packs.js'
import { appResourcesHome } from '@/core/paths.js'

export interface BrokerEngineEntry {
  configSchema: z.ZodType
  createBroker: (config: { id: string; label?: string; brokerConfig: Record<string, unknown> }) => IBroker
}

interface BrokerPackModule {
  BROKER_PACK_API_VERSION: number
  BROKER_ENGINE: string
  configSchema: z.ZodType
  createBroker: BrokerEngineEntry['createBroker']
}

export class BrokerPackUnavailableError extends Error {
  readonly code = 'BROKER_PACK_UNAVAILABLE'

  constructor(readonly engine: InstallableBrokerEngine, detail?: string) {
    super(detail ?? `Broker support for "${engine}" is not installed. Install it from the Trading screen.`)
    this.name = 'BrokerPackUnavailableError'
  }
}

const workspaceEntries: Record<InstallableBrokerEngine, string> = {
  ccxt: 'packages/uta-broker-ccxt/src/index.ts',
  alpaca: 'packages/uta-broker-alpaca/src/index.ts',
  ibkr: 'packages/uta-broker-ibkr/src/index.ts',
  leverup: 'packages/uta-broker-leverup/src/index.ts',
  longbridge: 'packages/uta-broker-longbridge/src/index.ts',
  snaptrade: 'packages/uta-broker-snaptrade/src/index.ts',
}

const cache = new Map<BrokerEngine, Promise<BrokerEngineEntry>>()

export function clearBrokerEngineCache(): void {
  cache.clear()
}

export function loadBrokerEngine(engine: BrokerEngine): Promise<BrokerEngineEntry> {
  const cached = cache.get(engine)
  if (cached) return cached
  const loading = loadBrokerEngineUncached(engine).catch((err) => {
    cache.delete(engine)
    throw err
  })
  cache.set(engine, loading)
  return loading
}

async function loadBrokerEngineUncached(engine: BrokerEngine): Promise<BrokerEngineEntry> {
  if (engine === 'mock') {
    return {
      configSchema: MockBroker.configSchema,
      createBroker: (config) => Object.assign(MockBroker.fromConfig(config), { brokerEngine: 'mock' }),
    }
  }
  if (!isInstallableBrokerEngine(engine)) throw new Error(`Unknown broker engine "${engine}"`)

  let installed: ResolvedBrokerPack | null
  try {
    installed = await resolveActiveBrokerPack(engine)
  } catch (err) {
    throw new BrokerPackUnavailableError(
      engine,
      `Installed broker pack "${engine}" is invalid: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  if (installed) {
    try {
      return validateModule(engine, await import(pathToFileURL(installed.entry).href))
    } catch (err) {
      throw new BrokerPackUnavailableError(
        engine,
        `Installed broker pack "${engine}" failed to load: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  if (workspacePacksAllowed()) {
    try {
      const entry = resolve(appResourcesHome, workspaceEntries[engine])
      return validateModule(engine, await import(pathToFileURL(entry).href))
    } catch (err) {
      throw new BrokerPackUnavailableError(
        engine,
        `Workspace broker pack "${engine}" failed to load: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  throw new BrokerPackUnavailableError(engine)
}

function validateModule(engine: InstallableBrokerEngine, raw: unknown): BrokerEngineEntry {
  if (!raw || typeof raw !== 'object') throw new Error('module did not export a broker pack')
  const module = raw as Partial<BrokerPackModule>
  if (module.BROKER_PACK_API_VERSION !== BROKER_PACK_API_VERSION) {
    throw new Error(`API version mismatch (expected ${BROKER_PACK_API_VERSION})`)
  }
  if (module.BROKER_ENGINE !== engine) throw new Error(`engine mismatch (got ${String(module.BROKER_ENGINE)})`)
  if (!module.configSchema || typeof module.createBroker !== 'function') {
    throw new Error('missing configSchema/createBroker exports')
  }
  return { configSchema: module.configSchema, createBroker: module.createBroker }
}

function workspacePacksAllowed(): boolean {
  if (process.env['OPENALICE_BROKER_PACK_ALLOW_WORKSPACE'] === '1') return true
  if (process.env['OPENALICE_BROKER_PACK_ALLOW_WORKSPACE'] === '0') return false
  return process.env['NODE_ENV'] === 'test'
    || process.env['OPENALICE_LAUNCHER'] === 'dev'
}
