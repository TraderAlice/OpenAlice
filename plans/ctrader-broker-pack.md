# cTrader Broker Pack

**Status:** active — increments 2–4 done in code (transport, session, reads, writes); real-demo spike pending app approval; OpenAlice integration (increment 5) next

**Owner guides:** [[docs/broker-packs.md]], [[docs/uta-live-testing.md]],
[[docs/project-structure.md]]

**Related issues:** none yet. A proposal issue is opened once the spike
confirms feasibility.

**Delivery:** one owned feature branch `feat/uta-broker-ctrader` off `dev`.
Increments are commits on that branch; no PR until the branch owner accepts
it.

## Goal

Add a `ctrader` broker engine that lets any cTrader-enabled broker account,
demo or live, in any country, trade through UTA. The engine must be
venue-neutral: every symbol the account can see (FX, metals, indices,
commodities, equities CFDs, crypto CFDs) is discoverable, quotable and
tradeable. Nothing is hard-coded per broker or per symbol.

Why cTrader: its Open API is a cloud endpoint reached over TCP/WebSocket, so
the engine is pure Node, runs on every platform OpenAlice supports, and needs
no local terminal process. This matches the existing Broker Pack shape
(`packages/uta-broker-*`).

## Upstream facts (verify again during the spike)

- Endpoints: `demo.ctraderapi.com` / `live.ctraderapi.com`; port 5035 is
  Protobuf, 5036 is JSON; both accept TCP and WebSocket. Demo and live are
  separate connections.
- Application auth: `ProtoOAApplicationAuthReq` (clientId, clientSecret).
- Account auth: OAuth 2.0. Authorize at
  `https://id.ctrader.com/my/settings/openapi/grantingaccess/` with scope
  `accounts` (read-only) or `trading`. Code lives about one minute; exchange
  at `https://openapi.ctrader.com/apps/token`.
- Access token lifetime about 30 days (`expiresIn` 2628000).
- Refresh tokens **rotate**: each refresh returns a new refresh token and
  invalidates the old one. The refresh token itself does not expire.
- Account discovery: `ProtoOAGetAccountListByAccessTokenReq`, then
  `ProtoOAAccountAuthReq` per `ctidTraderAccountId`.
- Each integrator registers an application in the Open API portal; Spotware
  approves it before custom redirect URIs can be added.

- Rate limits (Open API overview): 50 requests/s per connection for
  non-historical data, 5 requests/s for historical data.
- JSON mode sends enums as their numeric proto values and int64 as JSON
  numbers (Spotware's JSON sample app, `Open-API-Example-mobile-trader`).
- Encodings (proto comments): volume in cents of base units; spot and
  trendbar prices as 1/100000 integers; order/position prices as doubles;
  money scaled by `moneyDigits`.

Unconfirmed, to measure in the spike: trendbar range limits per period,
whether a spot subscription on a closed market yields an initial tick,
error codes seen in practice.

## Decisions

- **Engine id** `ctrader`; wrapper workspace `packages/uta-broker-ctrader`;
  adapter source under `services/uta/src/domain/trading/brokers/ctrader/`.
  Longbridge is the integration template (same touchpoints).
- **Transport:** JSON over WebSocket on port 5036. No protobuf toolchain in
  the Pack. Message payload types and enums are a small hand-written,
  spec-covered table derived from the official proto definitions.
- **Credentials model:** bring-your-own application. Each user supplies
  their own `clientId` / `clientSecret`; the project ships no shared secret.
- **Venue neutrality:** contract metadata (digits, lot size, min/step
  volume, stop distance, trading hours, asset class) is read from the
  account's symbol catalog at runtime.
- **Units:** all volume and price conversion goes through `decimal.js`.
- **Reconnect owner:** UTA. Its recovery loop already retries `init()` with
  backoff after a `dead` signal, so the session never reconnects by itself;
  `ensureConnected()` shares one in-flight attempt (no parallel handshakes,
  cf. #1762). `alive` is emitted only after a full re-handshake.
- **Account selection:** by the login shown in cTrader apps (`traderLogin`)
  or by `ctidTraderAccountId`; the session resolves it through the token's
  account list and refuses a demo/live environment mismatch.
- **Rate limits:** documented 50 req/s general and 5 req/s historical per
  connection; the transport queues FIFO at 45 and 4.
- **Contract identity:** nativeKey = the broker's symbol name, `conId` =
  symbolId, secType `CFD` for every instrument, exchange `CTRADER`,
  currency = quote asset. `assetClassFor` classifies the broker's own asset
  class / category names (forex, metals, indices, crypto…), not a
  per-broker table.
- **Quantities:** base units (volume / 100), never lots. Contract details
  expose min size and increment in units.
- **Positions:** one UTA row per (symbol, side) with a volume-weighted
  average cost; hedged accounts keep long and short as separate rows. Marks
  use the close-out side (bid for long, ask for short) in the quote
  currency; account totals use the deposit currency.
- **Quotes:** spot stream first; without a tick within the timeout, the last
  1-minute bar close; otherwise `MARKET_CLOSED`.
- **Market clock:** cTrader has no venue-wide clock; the schedule of the
  broker's first listed symbol is reported.
- **Time in force:** cTrader has no DAY; UTA's default `DAY` becomes, for a
  pending order, GOOD_TILL_DATE at the symbol's next session close (from its
  own schedule). Market orders send no time in force unless IOC/FOK/OPG.
- **Market-order protection:** the venue refuses absolute SL/TP on market
  orders, so the order carries fill-relative distances (protected from
  birth); after the fill the position is amended to the exact prices. A
  failed amend is reported in `message` with the active levels.
- **Lost replies:** every order carries a generated `clientOrderId`; when the
  reply never arrives the adapter looks the order up before answering, and
  otherwise reports an explicit "outcome unknown" instead of a rejection.
  The user's `orderRef` travels as the order label.
- **closePosition:** closes hedged positions of one symbol oldest first;
  refuses when both long and short are open on the symbol; partial progress
  is reported in `message`.
- **Safety:** acceptance uses demo accounts only; every live-paper run ends
  with a flat-account check.

## Open questions (must be settled before increment 2)

1. **Rotating refresh token persistence.** Account credentials live in
   Alice's sealed `accounts.json`; UTA brokers cannot write it today. A
   rotated refresh token that is not persisted breaks the account on the
   next UTA restart. Candidates:
   - a. UTA → Alice credential write-back channel that re-seals
     `accounts.json` (cross-owner; needs maintainer agreement);
   - b. a UTA-owned sealed token store per account (needs the sealing
     primitive available to UTA);
   - c. Alice owns the OAuth/refresh lifecycle and hands UTA a current
     access token.
   Unsealed token files are not an option. The session already implements
   the mechanics (refresh once per attempt, keep the new pair in memory
   first, hand it to `onTokensRefreshed`, re-handshake on a new socket); only
   the persistence target is open.
2. **First authorization UX.** A local redirect URI on the OpenAlice UI
   versus pasting tokens generated in the Open API playground. Depends on
   whether Spotware accepts loopback redirect URIs.
3. **Hedging vs netting accounts.** Reads merge per (symbol, side);
   `closePosition` closes oldest first and refuses mixed sides. Still open:
   whether a UTA consumer collides on two rows with the same aliceId (long
   and short of one symbol) — check against UTA position consumers.

## Increments

### 0. Prerequisites (branch owner)

- [x] cTID and a demo account at any cTrader broker
- [x] Open API application registered 2026-10-10, active 2026-10-13 (review
      took three days; Spotware's review mails come from a no-reply address,
      the KYC contact is review@ctraderapi.com); clientId/secret kept outside
      the repository
- [x] `pnpm install` in this worktree; baseline `pnpm test:changed`

### 1. Feasibility spike (outside the repo tree)

The spike drives the real `CtraderBroker` against Spotware's demo, with a
redacting wire log; it is not committed.

- [x] App auth → account list → account auth → trader info (2026-10-13)
- [x] Symbol catalog: FX, metals and share CFDs resolve with categories;
      full specs for EURUSD and XAUUSD
- [x] Spot subscription, 1m/1h/1d trendbars; encodings recorded below
- [x] Place/amend/cancel a pending order; open/close the minimum market
      position; observe execution events; account left flat (2026-10-13,
      Spotware demo account, user-approved; final check 0 positions / 0 orders)
- [x] Record write-side findings (below)
- [ ] Re-run the pending-order amend on the demo after the expiry fix

Read-side findings (Spotware demo, 2026-10-13):

- Enums are numeric on the JSON wire (`permissionScope: 1`, `accountType: 0`);
  unknown extra fields (e.g. `accountLifetimeType`) appear and are ignored.
- The first SPOT_EVENT can arrive **before** SUBSCRIBE_SPOTS_RES; the spot
  cache must accept it (it does). Spot events can carry one side only, and a
  zero spread (bid = ask) does occur on the demo.
- `moneyDigits` 2 on the trader; EURUSD lot 100 000 units, min/step 1 000;
  XAUUSD lot 100 oz, min/step 1 oz; `distanceSetIn` 1 (points).
- Schedules use the symbol's own time zone (EURUSD `America/New_York` with a
  daily 16:29:55–17:00:05 break; XAUUSD `UTC`). The market clock rounded
  session edges with the current milliseconds — fixed, covered by a spec.
- Daily bars open at 21:00 UTC; the in-progress bar is not returned.
- The demo account is HEDGED (`accountType` 0).
- First authorization (Q2): the portal's Sandbox page issues access and
  refresh tokens for the developer's own accounts with the trading scope;
  that is enough for bring-your-own-application users.

Write-side findings (Spotware demo, 2026-10-13):

- Pending DAY order → GOOD_TILL_DATE at the session close (20:29:55 UTC for
  EURUSD), as designed.
- **An amend without `expirationTimestamp` silently turns a GOOD_TILL_DATE
  order into GOOD_TILL_CANCEL.** Fixed: the amend re-sends the current
  expiry (as it already re-sends SL/TP); the fake venue now reproduces the
  venue behaviour and a broker spec guards it.
- Market order: ORDER_ACCEPTED (settles the request) then ORDER_FILLED, both
  with the request's clientMsgId; default time in force IOC.
- Fill-relative protection lands one point off when the fill differs from
  the quote (requested 1.10966/1.12966, venue set 1.10965/1.12965); the
  follow-up AMEND_POSITION_SLTP moved it to the exact prices.
- Protection is a separate STOP_LOSS_TAKE_PROFIT order (type 4) owned by the
  position; its events can carry the **order's clientOrderId** in the
  `clientMsgId` field. Request ids (`oa-<n>`) and order ids
  (`oa-<24 hex>`) never collide, and unmatched ids are treated as events.
- AMEND_POSITION_SLTP answers ORDER_ACCEPTED (protection order) and then
  ORDER_REPLACED with the request id.
- CLOSE_POSITION (partial and full): ACCEPTED → FILLED, then the protection
  order is REPLACED (partial) or CANCELLED (flat).
- Round-trip cost of 2 000 EURUSD units on the demo: 0.21 EUR.

### 2. Transport and session

- [x] WebSocket JSON transport (`ctrader-transport.ts`): clientMsgId
      correlation, connect/request timeouts, heartbeat, error envelopes,
      event fan-out; execution replies both settle and broadcast
- [x] Payload type table from the official proto (`ctrader-protocol.ts`)
- [x] Transport specs against a fake socket
- [x] Rate limiter (`rate-limiter.ts`) with separate historical budget
- [x] Session (`ctrader-session.ts`): app auth, account discovery, account
      auth, in-flight guard, dead/alive signals, server disconnect and token
      invalidation events, BrokerError mapping
- [x] Token refresh mechanics with a persistence hook
- [x] Session specs against `__test__/fake-ctrader-server.ts`
- [ ] Token persistence target per the answer to Q1

### 3. Read surface (`IBroker`)

- [x] init/close, connection state (`CtraderBroker.ts`)
- [x] Catalog (`ctrader-catalog.ts`): symbols, assets, categories, asset
      classes, cached specs; searchContracts, getContractDetails, nativeKey
- [x] getAccount, getPositions, getOrders/getOrder/getOpenOrders
- [x] Spot cache (`ctrader-spots.ts`) with replay after reconnect; getQuote
      with bar fallback
- [x] getMarketClock, getHistorical (windowed paging, range back-off),
      getCapabilities, assetClassFor
- [x] Pure encodings (`ctrader-mapping.ts`) and specs; broker specs against
      a multi-asset fixture account
- [ ] Confirm encodings and limits on the real demo (spike)

### 4. Write surface

- [x] Order builder (`ctrader-order-builder.ts`): MKT/LMT/STP/STP LMT, volume
      and price grid validation with lot-size hints, time in force, SL/TP
      side checks, amend payloads
- [x] Execution tracker (`ctrader-executions.ts`) for fills/cancels that
      follow the first reply
- [x] placeOrder, modifyOrder (id preserved), cancelOrder, closePosition
      (full and partial, FIFO across hedged positions)
- [x] Venue rejection text preserved in `PlaceOrderResult.error`
- [x] Write specs against a stateful fake venue (`__test__/fake-trading-venue.ts`)
- [ ] Confirm on the real demo: execution event sequence, whether amend
      without SL/TP clears them, relative protection rounding, partial fills

### 5. OpenAlice integration

- [x] `BrokerEngine` union and `CTRADER_PRESET` in `@traderalice/uta-protocol`
      (Recommended section, `securities` guard set, mode demo/live, login +
      Client ID/Secret + access/refresh tokens; secrets write-only)
- [x] Pack wrapper `packages/uta-broker-ctrader` (no third-party SDK: the
      runtime's global WebSocket is enough on Node ≥ 22 and Bun)
- [x] Registry, installable engines, supported platforms, build/verify
      scripts, dev binding, test lanes, CLI dev-asset spec, lockfile importer
- [x] Desktop package assertion: nothing to add (no SDK). Release workflows
      carry no engine lists. Dev upgrade-rehearsal asset list extended.
- [x] UI engine type, demo preset and pack row; Connect-broker card and form
      walked in `dev:demo` (card in Recommended, install step, six fields,
      secrets masked, no console errors)
- [x] Owner guide: broker-packs
- [ ] Owner guide: uta-live-testing scenarios for cTrader (after the spike)

### 6. Verification and acceptance

- [x] Package typecheck, root `npx tsc --noEmit`, `cd ui && npx tsc -b`
- [x] `pnpm test` complete (2026-10-10, Windows x64 at a22a1b3e): 7722 passed;
      the 14 failures in 11 files reproduce identically on clean `dev`
      d2914227 (symlink EPERM and CLI lifecycle on this host); two load
      timeouts (presets/Hyperliquid, web-relay) pass on rerun
- [x] `pnpm test:integration:uta` (291 passed)
- [x] `pnpm broker-packs:build` + Node verification on win32-x64: six archives
      verified, ctrader 2.4 MiB
- [ ] `--compiled` verification (needs Bun; not installed on this host)
- [ ] Live-paper scenarios plus the new-broker checklist on demo; flat
      afterwards
- [ ] Real browser route: connect, view, place/cancel from the UI
- [ ] Multi-day soak on demo

### 7. Upstream

- [ ] Proposal issue (design, Q1 decision request)
- [ ] PR to `dev` once the branch owner accepts the branch

## Completion

The plan is complete when the engine is merged into `dev` with its owner-guide
updates and demo acceptance recorded; delete this file in that change.
