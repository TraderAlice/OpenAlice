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

// Data models
export { Contract, ContractDetails, ComboLeg, DeltaNeutralContract, ContractDescription } from './contract.js'
export { Order, OrderComboLeg } from './order.js'
export { OrderState, OrderAllocation } from './order-state.js'
export { OrderCancel } from './order-cancel.js'
export { Execution, ExecutionFilter } from './execution.js'
export { CommissionAndFeesReport } from './commission-and-fees-report.js'
export { ScannerSubscription, ScanData } from './scanner.js'
export * from './common.js'

// EWrapper interface (callback contract — no I/O implementation)
export { type EWrapper, DefaultEWrapper } from './wrapper.js'
