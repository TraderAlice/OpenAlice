# IbkrBroker — Interactive Brokers TWS/Gateway Adapter

IBroker implementation for Interactive Brokers via `@traderalice/ibkr` (Node port of the official Python TWS API).

## Architecture

```
IbkrBroker  →  EClient (TCP)  →  TWS/Gateway  →  IBKR Servers
     ↑
RequestBridge (callback → Promise adapter)
```

- **EClient**: TCP socket to TWS, multiplexes requests via numeric `reqId`
- **RequestBridge**: EWrapper implementation that converts callbacks into Promises
- **No API keys**: Authentication is handled by TWS/Gateway GUI login

## TWS Market Data Channels

TWS has multiple independent data channels with different characteristics.
Understanding which channel we use (and don't use) is critical for debugging price issues.

### `reqAccountUpdates` → `updatePortfolio()` (what we use)

- **Subscribe**: `reqAccountUpdates(true, accountId)` — one-time subscription
- **Callback**: `updatePortfolio(contract, position, marketPrice, marketValue, avgCost, unrealizedPnL, realizedPnL, accountName)`
- **Behavior**: TWS internally decides when to push updates. During regular trading hours, updates come every few seconds. During after-hours and overnight, updates slow down or stop entirely.
- **Coverage**: Only positions in the account. No quote data for contracts you don't hold.
- **Current usage**: This is the durable position cache. `getPositions()` overlays short-lived snapshot midpoints for `OPT`/`FOP` rows when bid+ask are available; all other rows and failed snapshots retain these broker values. `getAccount()` uses the account-level `NetLiquidation` tag whenever IBKR supplied it.

### `reqMktData` — snapshot mode (what `getQuote()` uses)

- **Call**: `reqMktData(reqId, contract, '', true, false, [])` — `snapshot=true`
- **Callbacks**: `tickPrice()`, `tickSize()`, `tickString()`, then `tickSnapshotEnd()`
- **Behavior**: One-time batch of current market data. Auto-cancels after `tickSnapshotEnd`.
- **Coverage**: Any contract, including ones you don't hold. Includes overnight session data from Blue Ocean ATS.
- **Limitation**: Counts against TWS market data line limit (~100 concurrent). Snapshot mode is short-lived so typically not a problem.
- **Entitlement boundary**: OpenAlice always sends `regulatorySnapshot=false`; it never opts the account into per-request paid US regulatory snapshots. Ordinary live snapshots still need the corresponding market-data entitlement. Free delayed data may be returned after `reqMarketDataType(3)`; otherwise the option overlay falls back to `updatePortfolio()` without failing the account read.
- **Timing**: IBKR documents `tickSnapshotEnd()` at about 11 seconds. Ordinary quotes wait for that end marker with a 12.5 second timeout. Option mark refreshes may resolve earlier once both positive bid and ask ticks arrive.

### `reqMktData` — streaming mode (not currently used)

- **Call**: `reqMktData(reqId, contract, '', false, false, [])` — `snapshot=false`
- **Callbacks**: Continuous `tickPrice()`, `tickSize()` updates
- **Behavior**: Real-time tick-level updates. This is what TWS front-end uses for its price display.
- **Coverage**: Same as snapshot mode, but continuous. Includes overnight session data.
- **Limitation**: Each active subscription counts against the 100-line limit until explicitly cancelled via `cancelMktData()`.

### `reqTickByTickData` (not currently used)

- **Behavior**: Granular tick-by-tick data (Last, BidAsk, AllLast)
- **Use case**: Algo trading, tape reading
- **Not needed** for portfolio snapshots

## US Equity Trading Sessions

All times in US/Eastern (ET):

| Session | Hours (ET) | Hours (UTC+8) | Venue |
|---------|-----------|---------------|-------|
| Pre-market | 04:00 - 09:30 | 16:00 - 21:30 | ECN (ARCA, BATS) |
| Regular | 09:30 - 16:00 | 21:30 - 04:00+1 | NYSE, NASDAQ |
| After-hours | 16:00 - 20:00 | 04:00 - 08:00 | ECN |
| Overnight | 20:00 - 04:00+1 | 08:00 - 16:00 | Blue Ocean ATS (dark pool) |

**Key insight**: "Total Available Hours" shown in TWS (04:00 - 20:00 ET) does NOT include overnight trading. Overnight trading is a separate session via Blue Ocean ATS, available for select contracts (flagged as "Overnight Trading is available" in TWS).

### Impact on data channels

- **`updatePortfolio()`**: Stops refreshing around 20:00 ET. Does NOT push overnight session prices. This is why snapshot equity curves flatten after UTC+8 08:00.
- **`reqMktData` (snapshot/streaming)**: CAN return overnight session prices if the contract supports overnight trading. This is why TWS front-end still shows last price changes after 20:00 ET.
- **Conclusion**: If we need accurate overnight prices for snapshots, we must use `reqMktData` instead of relying on `updatePortfolio()` cached prices.

## Socket Error Handling

The `@traderalice/ibkr` Connection class is a Node port of Python's `Connection`.

**Python behavior**: `recvMsg()` catches `socket.error` inline → calls `self.disconnect()` → reader thread exits naturally. No error propagation.

**Our adaptation** (`packages/ibkr/src/connection.ts`): Socket `error` events call `this.disconnect()` directly (matching Python). The `disconnect()` method:
1. Sets `this.socket = null` first (prevents double cleanup)
2. Calls `socket.destroy()`
3. Calls `wrapper.connectionClosed()`

The `close` event handler checks `if (this.socket === null) return` to avoid double-calling `connectionClosed()` when `disconnect()` already handled cleanup.

Known-dead transport state reaches UTA through an explicit connection-state listener:

1. `connectionClosed()`, connectivity error 1100, or a failed 45-second heartbeat marks the bridge dead.
2. UTA moves directly to `offline` and starts recovery instead of waiting for passive cached-read failures.
3. Error 1101/1102 nudges recovery immediately but does not mark the account alive; reconnect plus a private account read must still pass.
4. Place/modify/cancel performs a coalesced `reqCurrentTime` round-trip on the same socket immediately before transmission. A timeout marks the bridge dead and no order bytes are sent.

## Known Limitations

1. **Non-option position price staleness**: Stocks, futures, FX, warrants, and bonds still use `updatePortfolio()` marks. Only `OPT`/`FOP` rows receive the bounded snapshot-midpoint overlay.

2. **Option market-data entitlement**: Without a live or delayed quote permission, option positions deliberately keep the cached `updatePortfolio()` mark. A short negative cache prevents polling loops from repeatedly issuing a request that the account cannot satisfy.

3. **Single account**: Current implementation assumes one account per TWS connection. Multi-account setups (Financial Advisor accounts) would need `reqAccountUpdatesMulti` instead.

4. **Market clock**: Hardcoded to NYSE regular hours (9:30-16:00 ET, Mon-Fri). Does not account for holidays, half-days, or per-contract trading schedules. Should use `ContractDetails.tradingHours` in the future.
