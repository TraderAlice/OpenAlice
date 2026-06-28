/**
 * Market-vendor catalog — the agent-facing "what data sources do I have, and
 * how do I drive them" surface.
 *
 * Each vendor OWNS its self-description: the prose (coverage + howToUse) lives on
 * the opentypebb Provider's `vendorMeta`, so adding a vendor carries its own
 * usage note — there is no outer table to forget to update. This module only
 * JOINS that self-description to runtime state read fresh from market-data.json:
 *
 *   - alwaysOn  — is this the primary equity vendor (yfinance)? can't be toggled.
 *   - enabled   — always-on, or present in extraVendors.
 *   - keyless   — derived from the provider's declared credentials.
 *
 * `setMarketVendor` flips extraVendors; because the resolver re-reads config per
 * request, an agent that enables a vendor here can search it on the very next
 * call — no restart. This is the discoverability loop: list → read the usage
 * note → enable the one you need → query.
 */

import type { QueryExecutor } from '@traderalice/opentypebb'
import { readMarketDataConfig, updateExtraVendors } from '@/core/config.js'

export interface MarketVendorInfo {
  /** Vendor id used everywhere (search sourceId, setMarketVendor arg). */
  id: string
  /** Human display name. */
  name: string
  /** On right now — searches will fan out to it. */
  enabled: boolean
  /** The primary equity vendor: always on, cannot be toggled off. */
  alwaysOn: boolean
  /** No API key required. */
  keyless: boolean
  /** What markets / instruments it covers. */
  coverage: string
  /** How to drive it (symbol convention, search-language quirks). */
  howToUse: string
  website?: string
}

/** Every provider that has opted into the vendor picker (declared `vendorMeta`),
 *  joined to current on/off state. Always-on first, then enabled, then the rest. */
export async function listMarketVendors(executor: QueryExecutor): Promise<MarketVendorInfo[]> {
  const md = await readMarketDataConfig()
  const primary = md.providers.equity
  const extra = new Set(md.extraVendors)

  return executor
    .listProviders()
    .filter((p) => p.vendorMeta)
    .map((p): MarketVendorInfo => {
      const alwaysOn = p.name === primary
      return {
        id: p.name,
        name: p.reprName ?? p.name,
        alwaysOn,
        enabled: alwaysOn || extra.has(p.name),
        keyless: p.credentials.length === 0,
        coverage: p.vendorMeta!.coverage,
        howToUse: p.vendorMeta!.howToUse,
        website: p.website,
      }
    })
    .sort(
      (a, b) =>
        Number(b.alwaysOn) - Number(a.alwaysOn) ||
        Number(b.enabled) - Number(a.enabled) ||
        a.id.localeCompare(b.id),
    )
}

export interface SetVendorResult {
  id: string
  enabled: boolean
  /** The full catalog after the change, so the caller sees the new state. */
  vendors: MarketVendorInfo[]
}

/**
 * Turn a vendor on/off and persist it. Takes effect on the next search (no
 * restart). Rejects unknown ids and the always-on primary.
 */
export async function setMarketVendor(
  executor: QueryExecutor,
  id: string,
  enabled: boolean,
): Promise<SetVendorResult> {
  const known = executor.listProviders().filter((p) => p.vendorMeta)
  const target = known.find((p) => p.name.toLowerCase() === id.trim().toLowerCase())
  if (!target) {
    const names = known.map((p) => p.name).join(', ')
    throw new Error(`Unknown market vendor "${id}". Available vendors: ${names}.`)
  }

  const md = await readMarketDataConfig()
  if (target.name === md.providers.equity) {
    throw new Error(
      `"${target.name}" is the always-on primary equity vendor and cannot be toggled.`,
    )
  }

  await updateExtraVendors((current) =>
    enabled ? [...current, target.name] : current.filter((v) => v !== target.name),
  )

  return { id: target.name, enabled, vendors: await listMarketVendors(executor) }
}
