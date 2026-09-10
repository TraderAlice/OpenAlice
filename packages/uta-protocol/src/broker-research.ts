import { z } from 'zod'
import type { Contract } from '@traderalice/ibkr'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
export const optionResearchSchema = z.object({
  aliceId: z.string().min(1).describe('Underlying stock aliceId from contract search'),
  expiration: date.optional(), expirationFrom: date.optional(), expirationTo: date.optional(),
  right: z.enum(['call', 'put']).optional(),
  strikeMin: z.number().nonnegative().optional(), strikeMax: z.number().nonnegative().optional(),
  limit: z.number().int().min(1).max(1000).optional(),
  pageToken: z.string().optional().describe('Continue with the returned nextPageToken and the same filters'),
  feed: z.enum(['indicative', 'opra']).optional().describe('Snapshots only; defaults to indicative (modified quotes, delayed trades). OPRA needs entitlement.'),
})
export const orderBookSchema = z.object({
  aliceId: z.string().min(1), limit: z.number().int().min(1).max(100).optional(),
})
export type OptionResearchRequest = z.infer<typeof optionResearchSchema>
export type OptionResearchFilters = Omit<OptionResearchRequest, 'aliceId'>

/** Optional structural capabilities: old broker packs continue to load. */
export interface BrokerResearch {
  getOptionContracts?(underlying: string, filters: OptionResearchFilters): Promise<Record<string, unknown>>
  getOptionChain?(underlying: string, filters: OptionResearchFilters): Promise<Record<string, unknown>>
  getOrderBook?(contract: Contract, limit?: number): Promise<unknown>
}
