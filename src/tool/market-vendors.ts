/**
 * Market-vendor AI tools — the discoverability loop for data sources.
 *
 * listMarketVendors: what sources exist, which are on, and how to address each
 *   (symbol convention, search-language quirks).
 * setMarketVendor: flip one on/off — effective on the next search, no restart.
 *
 * Together they let an agent self-serve: a Taiwan-stock search comes up empty →
 * list vendors → see twse is off and wants 繁体中文 → enable it → search again.
 * No dependency on the user remembering to open a settings page.
 */

import { tool } from 'ai'
import { z } from 'zod'
import type { QueryExecutor } from '@traderalice/opentypebb'
import { listMarketVendors, setMarketVendor } from '@/domain/market-data/vendors.js'

export function createVendorTools(executor: QueryExecutor) {
  return {
    listMarketVendors: tool({
      description: `List the market-data vendors available for symbol search, each with its
on/off state and a usage note (what it covers, symbol convention, search-language quirks).

Reach for this FIRST when a marketSearchForResearch / searchBars comes up empty, or before
working a market you haven't queried (CN A-shares, Taiwan, etc.) — it tells you which vendor
covers it and how to address symbols. If the right vendor is off, turn it on with
setMarketVendor; the change is live immediately, no restart.`,
      inputSchema: z.object({}).meta({ examples: [{}] }),
      execute: async () => ({ vendors: await listMarketVendors(executor) }),
    }),

    setMarketVendor: tool({
      description: `Turn a market-data vendor on or off. Effective on the NEXT search — no restart.

Use after listMarketVendors shows the vendor for the market you want is off — e.g. enable
"twse" before searching Taiwan stocks by Chinese name, or "eastmoney" for CN A-shares. The
always-on primary vendor (yfinance) cannot be toggled.`,
      inputSchema: z
        .object({
          vendor: z.string().describe('Vendor id from listMarketVendors, e.g. "twse", "eastmoney"'),
          enabled: z.boolean().describe('true to turn on, false to turn off'),
        })
        .meta({ examples: [{ vendor: 'twse', enabled: true }] }),
      execute: async ({ vendor, enabled }) => setMarketVendor(executor, vendor, enabled),
    }),
  }
}
