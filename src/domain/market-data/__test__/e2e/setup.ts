/**
 * Market-data e2e setup — shared, lazily-initialized Hono app + executor.
 *
 * Mirrors src/domain/trading/__test__/e2e/setup.ts:62-71's lazy-singleton
 * pattern but for the read-only market-data surface. Builds a minimal
 * Hono app that mounts the same routes the real webui plugin mounts, so
 * specs can hit them via app.request() — reproducing the path that
 * "前端点 Test Connection" / "AI 调 fred_search 工具" actually walks
 * (webui route → bbEngine → fetcher → live API), not just the inner
 * fetcher slice that bbProvider specs cover.
 *
 * Read-only by construction; no isPaper() guard is needed (unlike trading
 * e2e where MockBroker / paper account safety is critical).
 */

import { Hono } from 'hono'
import { loadConfig, type Config } from '@/core/config.js'
import { buildSDKCredentials } from '@/domain/market-data/credential-map.js'
import { createExecutor, type QueryExecutor } from '@traderalice/opentypebb'
import { mountMarketDataCompat } from '@/server/market-data-compat.js'
import { createMarketDataRoutes } from '@/webui/routes/config.js'
import type { EngineContext } from '@/core/types.js'

export interface TestApp {
  app: Hono
  config: Config
  executor: QueryExecutor
  /** SDK-shaped credentials (after buildSDKCredentials transform). */
  credentials: Record<string, string>
}

let cached: Promise<TestApp> | null = null

/** Get the shared TestApp. First call loads config + mounts routes. */
export function getTestApp(): Promise<TestApp> {
  if (!cached) cached = init()
  return cached
}

async function init(): Promise<TestApp> {
  const config = await loadConfig()
  const executor = createExecutor()
  const credentials = buildSDKCredentials(config.marketData.providerKeys)

  // createMarketDataRoutes only reads ctx.bbEngine — pass a partial ctx
  // shape with only the fields it needs.
  const ctx = { bbEngine: executor, config } as unknown as EngineContext

  const app = new Hono()
  app.route('/api/market-data', createMarketDataRoutes(ctx))
  mountMarketDataCompat(app, executor, {
    basePath: '/api/market-data-v1',
    defaultCredentials: () => credentials,
    defaultProviders: () => config.marketData.providers,
  })

  return { app, config, executor, credentials }
}

/**
 * Check whether OpenAlice config has a key configured for a given user-key
 * provider name (`fred`, `fmp`, …) — i.e. the field as the user types it
 * in the Settings UI, not the SDK-prefixed form.
 */
export function hasProviderKey(config: Config, userKey: string): boolean {
  const keys = config.marketData.providerKeys as Record<string, string | undefined> | undefined
  return !!keys?.[userKey]
}

// ==================== Hono app.request helpers ====================

/**
 * GET an embedded compatibility route and unwrap its legacy envelope.
 */
export async function getJson(app: Hono, path: string): Promise<any[]> {
  const res = await app.request(path)
  if (res.status !== 200) {
    const body = await res.text()
    throw new Error(`GET ${path} → ${res.status}: ${body}`)
  }
  const body = await res.json() as { results?: unknown[]; error?: string }
  if (body.error) throw new Error(`GET ${path} → 200 with error: ${body.error}`)
  return (body.results ?? []) as any[]
}

/** POST a JSON body, return { status, data }. */
export async function postJson(
  app: Hono,
  path: string,
  body: unknown,
): Promise<{ status: number; data: any }> {
  const res = await app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, data: await res.json() }
}
