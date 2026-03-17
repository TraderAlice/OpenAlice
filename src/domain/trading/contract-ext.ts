/**
 * Declaration merge: adds `aliceId` to IBKR Contract class.
 *
 * aliceId is Alice's multi-broker routing identifier ("{provider}-{nativeId}"),
 * e.g. "alpaca-AAPL", "bybit-BTCUSDT", "ibkr-265598".
 *
 * The @traderalice/ibkr package stays a pure IBKR replica.
 * This extension lives in the trading extension (consumer side).
 */

import '@traderalice/ibkr'

declare module '@traderalice/ibkr' {
  interface Contract {
    aliceId?: string
  }
}
