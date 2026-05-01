/**
 * @traderalice/ibkr-client — TypeScript IBKR TWS API: wire layer.
 *
 * See ../README.md for what lives here vs. in @traderalice/ibkr-types.
 */

// Re-export every type that wire-layer callers may need so a single import
// keeps working through the shim. The shim re-exports both packages, and
// this convenience re-export means `import { Order, EClient } from
// '@traderalice/ibkr-client'` also works.
export * from '@traderalice/ibkr-types'

// Protocol
export { makeField, makeFieldHandleEmpty, makeMsg, readMsg, readFields } from './comm.js'
export { Connection } from './connection.js'
export { EReader } from './reader.js'
export { Decoder } from './decoder/index.js'

// Client
export { EClient } from './client/index.js'
