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
- [ ] Open API application registered (submitted 2026-10-10) and approved; clientId/secret kept
      outside the repository
- [x] `pnpm install` in this worktree; baseline `pnpm test:changed`

### 1. Feasibility spike (outside the repo tree)

- [ ] Script: app auth → account list → account auth → trader info
- [ ] Symbol catalog: list, full details for several asset classes
- [ ] Spot subscription, trendbars, ticks; record encodings and limits
- [ ] Place/amend/cancel a pending order; open/close the minimum market
      position; observe execution events; account left flat
- [ ] Record findings and answer open questions 2–4 here

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

- [ ] `BrokerEngine` union and preset in `@traderalice/uta-protocol`
- [ ] Registry, broker-pack catalog/requirements, build/verify scripts,
      dev binding, test lanes
- [ ] Desktop package assertion, release matrix, upgrade-rehearsal snapshot
- [ ] UI types, Connect-broker card, demo handlers
- [ ] Owner guide updates: broker-packs, uta-live-testing

### 6. Verification and acceptance

- [ ] Package typecheck, root `npx tsc --noEmit`, `cd ui && npx tsc -b`
- [ ] `pnpm test` complete; `pnpm test:integration:uta`
- [ ] `pnpm broker-packs:build` and `--compiled` verification
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
