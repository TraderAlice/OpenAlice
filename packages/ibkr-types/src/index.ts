/**
 * @traderalice/ibkr-types — TypeScript IBKR TWS API: pure data models, enums, sentinels.
 *
 * No I/O. See ../README.md for the rationale and the Phase 1a plan
 * (RUST_MIGRATION_PLAN.v3.md §5).
 */

// Constants
export * from './const.js'
export * from './errors.js'
export * from './server-versions.js'
export * from './message.js'
export * from './news.js'

// Simple types
export { TagValue, type TagValueList } from './tag-value.js'
export { SoftDollarTier } from './softdollartier.js'
export { type TickType, TickTypeEnum, tickTypeToString } from './tick-type.js'
export { AccountSummaryTags, AllTags } from './account-summary-tags.js'
export { IneligibilityReason } from './ineligibility-reason.js'

// Data models — full file re-export so the wire-layer package and any future
// consumer can pull every symbol (e.g. OrderCondition subclasses, FundAssetType,
// COMPETE_AGAINST_BEST_OFFSET_UP_TO_MID, OptionExerciseType, etc.) without
// chasing per-file named lists. The original @traderalice/ibkr package's
// public surface was named-only, but those names suffice because consumers
// (the OpenAlice host) never imported the auxiliary symbols. The wire-layer
// package does need them, so widen the surface here.
export * from './contract.js'
export * from './order.js'
export * from './order-state.js'
export * from './order-cancel.js'
export * from './order-condition.js'
export * from './execution.js'
export * from './commission-and-fees-report.js'
export * from './scanner.js'
export * from './common.js'

// EWrapper interface (callback contract — no I/O implementation)
export { type EWrapper, DefaultEWrapper } from './wrapper.js'
