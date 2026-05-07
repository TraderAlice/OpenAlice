/**
 * Declaration merge: adds `aliceId` to IBKR Contract class.
 *
 * aliceId is Alice's unique asset identifier: "{utaId}|{nativeKey}"
 * e.g. "alpaca-paper|META", "bybit-main|ETH-PERP"
 *
 * Constructed by UTA layer (not broker). Broker uses symbol/localSymbol for resolution.
 * The @traderalice/ibkr package stays a pure IBKR replica.
 *
 * localSymbol semantics — canonical (broker-agnostic) post-Phase-3 of the
 * IBKR-as-truth refactor:
 * - IBKR: exchange-native symbol (e.g., "AAPL", "ESZ4")
 * - Alpaca: ticker symbol (e.g., "AAPL")
 * - CCXT: canonical (e.g., "ETH" spot, "ETH-PERP" perp, "BTC-FUT-202609" dated future).
 *         CCXT's wire format ("ETH/USDT:USDT") stays a CcxtBroker-internal concern,
 *         derived on demand via `contractToCcxt`.
 * UTA uses localSymbol as nativeKey in aliceId: "{utaId}|{nativeKey}"
 */

import '@traderalice/ibkr'

declare module '@traderalice/ibkr' {
  interface Contract {
    aliceId?: string
  }
}
