/**
 * AI tool factories for CCXT exchanges.
 *
 * Registered dynamically when a CCXT account comes online.
 */

import { tool } from 'ai'
import { z } from 'zod'
import { MAX_ORDER_BOOK_LIMIT } from '@traderalice/uta-protocol'
import type { Contract } from '@traderalice/ibkr'
import type { UnifiedTradingAccount } from '../../UnifiedTradingAccount.js'
import type { UTAManager } from '../../uta-manager.js'
import '../../contract-ext.js'

interface CcxtDataBroker {
  brokerEngine?: string
  getFundingRate(contract: Contract): Promise<Record<string, unknown>>
  getOrderBook(contract: Contract, limit: number): Promise<Record<string, unknown>>
}

export function createCcxtProviderTools(manager: UTAManager) {
  /** Resolve to exactly one CCXT UTA. Returns error object if unable. */
  const resolveCcxtOne = (
    source?: string,
  ): { uta: UnifiedTradingAccount; broker: CcxtDataBroker; id: string } | { error: string } => {
    const targets = manager.resolve(source)
      .filter((uta): uta is typeof uta & { broker: CcxtDataBroker } => (
        uta.broker.brokerEngine === 'ccxt'
        && typeof (uta.broker as Partial<CcxtDataBroker>).getFundingRate === 'function'
        && typeof (uta.broker as Partial<CcxtDataBroker>).getOrderBook === 'function'
      ))
    if (targets.length === 0) return { error: 'No CCXT account available.' }
    if (targets.length > 1) {
      return { error: `Multiple CCXT accounts: ${targets.map(t => t.id).join(', ')}. Specify source.` }
    }
    return { uta: targets[0], broker: targets[0].broker, id: targets[0].id }
  }

  const sourceDesc =
    'Account source — matches account id or provider name. Auto-resolves if only one CCXT account exists.'

  return {
    getFundingRate: tool({
      description: `Query the current funding rate for a perpetual contract (CCXT/crypto accounts only).

Returns:
- fundingRate: current/latest funding rate (e.g. 0.0001 = 0.01%)
- nextFundingTime: when the next funding payment occurs
- previousFundingRate: the previous period's rate

Positive rate = longs pay shorts. Negative rate = shorts pay longs.
Use searchContracts first to get the aliceId.`,
      inputSchema: z.object({
        aliceId: z.string().describe('Contract identifier from searchContracts (format: accountId|nativeKey, e.g. "bybit-main|BTC/USDT:USDT")'),
        source: z.string().optional().describe(sourceDesc),
      }),
      execute: async ({ aliceId, source }) => {
        const resolved = resolveCcxtOne(source)
        if ('error' in resolved) return resolved
        const { uta, broker, id } = resolved
        let contract
        try { contract = uta.contractFromAliceId(aliceId) }
        catch (err) { return { error: (err as Error).message } }
        const result = await broker.getFundingRate(contract)
        return { source: id, ...result }
      },
    }),

    getOrderBook: tool({
      description: `Query the order book (market depth) for a contract (CCXT/crypto accounts only).

Returns bids and asks sorted by price. Each level is [price, amount].
Use this to evaluate liquidity and potential slippage before placing large orders.
Use searchContracts first to get the aliceId.
Requests are capped at ${MAX_ORDER_BOOK_LIMIT} levels per side; a venue may return fewer levels when its own ordinary book is smaller.`,
      inputSchema: z.object({
        aliceId: z.string().describe('Contract identifier from searchContracts (format: accountId|nativeKey, e.g. "bybit-main|BTC/USDT:USDT")'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_ORDER_BOOK_LIMIT)
          .optional()
          .describe(`Number of price levels per side (default: 20; request cap: ${MAX_ORDER_BOOK_LIMIT})`),
        source: z.string().optional().describe(sourceDesc),
      }),
      execute: async ({ aliceId, limit, source }) => {
        const resolved = resolveCcxtOne(source)
        if ('error' in resolved) return resolved
        const { uta, broker, id } = resolved
        let contract
        try { contract = uta.contractFromAliceId(aliceId) }
        catch (err) { return { error: (err as Error).message } }
        const result = await broker.getOrderBook(contract, limit ?? 20)
        return { source: id, ...result }
      },
    }),

  }
}
