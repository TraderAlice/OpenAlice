/**
 * Declaration merge: adds `aliceId` to IBKR Contract class.
 *
 * aliceId is Alice's system-level unique asset identifier:
 *   "{utaId}|{nativeKey}"
 * e.g. "alpaca-paper|META", "bybit-main|ETH/USDT:USDT", "ibkr|265598" (conId)
 *
 * Constructed by the UTA layer via `stampAliceId`. The `nativeKey` half
 * comes from `broker.getNativeKey(contract)` — each broker chooses its
 * own uniqueness primitive there:
 *
 *   - IBKR:   `conId` (numeric — the only reliably unique key, since
 *             symbol/localSymbol collide across the option-chain fanout)
 *   - CCXT:   the unified wire symbol (`BTC/USDT:USDT`) — encodes
 *             base+quote+settle, which CCXT considers structural
 *   - Alpaca: ticker symbol (flat US-equities universe)
 *   - Mock:   per-config nativeKey (tester-defined)
 *
 * `Contract.localSymbol` is **not** the system uniqueness primitive —
 * each broker writes whatever its native data model dictates, no
 * normalization across brokers. What matters is that getNativeKey
 * returns the broker's actual primary key.
 */

import '@traderalice/ibkr'

declare module '@traderalice/ibkr' {
  interface Contract {
    aliceId?: string
  }
}
