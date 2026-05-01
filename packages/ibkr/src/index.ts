/**
 * @traderalice/ibkr — re-export shim.
 *
 * The original package was split in Phase 1a (RUST_MIGRATION_PLAN.v3.md §5):
 *   - Pure data models, enums, and sentinels live in @traderalice/ibkr-types.
 *   - Wire protocol, connection, decoder, and client live in @traderalice/ibkr-client.
 *
 * This shim re-exports both to preserve `import { Order, EClient } from
 * '@traderalice/ibkr'` for the duration of one minor release. Do NOT add any
 * code to this file other than re-exports.
 */

export * from '@traderalice/ibkr-types'
export * from '@traderalice/ibkr-client'
