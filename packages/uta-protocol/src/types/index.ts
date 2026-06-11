/**
 * Wire types — the shapes that travel over the UTA-Alice HTTP boundary.
 *
 * Distinct from in-process domain types (`Contract`, `OpenOrder`, `IBroker`,
 * `TradingGit`) which live inside UTA and never cross the wire. Wire types
 * are intentionally narrower: AI-facing summary objects, not the full
 * broker SDK surface.
 *
 * Files are stubbed during Step 1 of the UTA-split rollout; populated as
 * UTA service (Step 2) wires up each route.
 */

export * from './errors.js'
export * from './broker.js'
export * from './git.js'
export * from './manager.js'
// contract-ext extends the IBKR Contract type via declaration merge —
// importing the package once per process suffices to register the
// `aliceId?` field. Re-export as side-effect so consumers don't need a
// separate import for the augmentation.
import './contract-ext.js'
export * from './history.js'
