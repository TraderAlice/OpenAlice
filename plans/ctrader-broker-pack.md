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
  broker's first listed symbol is reported. Each symbol's own hours are in
  its contract details: `tradingHours` in IBKR's format for the coming week,
  wall-clock in the symbol's `timeZoneId`.
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
  is reported in `message`. After a full close, pending orders still linked
  to the closed position are cancelled so they cannot fire later.
- **Position protection as legs:** cTrader keeps SL/TP on the position (an
  internal STOP_LOSS_TAKE_PROFIT order). UTA moves stops by modifying
  orders, so each protected position is exposed as synthetic orders
  `sl-<positionId>` (STP, `auxPrice`) and `tp-<positionId>` (LMT,
  `lmtPrice`) in `getOpenOrders`, returned as `legs` from a protected market
  order, and routed by `modifyOrder` / `cancelOrder` to
  AMEND_POSITION_SLTP (the other level is always re-sent). A leg of a closed
  position settles as Filled when the protection order fired nearer its
  level, otherwise Cancelled. Found during dogfooding: without this an agent
  could not move a stop to break-even.
- **Hedged accounts reduce like netting:** on a HEDGED account an opposite
  order opens a second position instead of reducing (IBKR habit: a separate
  protective SELL STP after a buy would open a hedge). Orders against an
  open position are linked to it with `positionId` (oldest position that
  can absorb the volume); orders that would flip, straddle several
  positions, face both sides, or carry their own SL/TP are refused with an
  explanation. NETTED accounts are left to the venue.
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
   `closePosition` closes oldest first and refuses mixed sides. Settled
   2026-10-13: no UTA consumer keys positions by aliceId (the snapshot builder
   lists rows, the UI keys rows by index), and UTA's close-quantity check
   takes the first matching row while the adapter refuses mixed sides, so a
   long and a short row of one symbol do not collide.

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
- [x] Re-run the pending-order amend on the demo after the expiry fix
      (2026-10-13, user-approved): the amend now carries the expiry, the
      venue answers REPLACED with GOOD_TILL_DATE and the same expiry; order
      cancelled, account flat
- [x] Demo check of protection legs and hedged linking (2026-10-13,
      user-approved, two runs, account flat after each): see findings below

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
  Contract details left `tradingHours` empty, so an agent could not tell when
  a symbol trades; they now list the coming week. Read back on the demo
  (2026-10-14): XAUUSD and XTIUSD 22:01–20:59 UTC daily, US 30 / US 500 /
  US TECH 100 18:00–16:59 New York, BTCUSD and ETHUSD every day including
  the weekend.
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
- A fired take-profit (2026-10-15, user-approved, minimum EURUSD with 2-pip
  SL/TP; flat afterwards) closes the position through the
  STOP_LOSS_TAKE_PROFIT order, which carries the stop-loss as `stopPrice`
  and the take-profit as `limitPrice` — not `stopLoss`/`takeProfit`, so the
  old settle logic reported a fired leg as cancelled. The order list by
  position leaves that order out; the closing deal points to it. Settled
  legs now come from the position's deals, with the real exit price and
  volume, which UTA needs to list the fill. Filled orders also report
  `executedVolume` as their filled quantity.
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

Protection and hedged-linking findings (Spotware demo, 2026-10-13):

- A protected market order returns `sl-`/`tp-` legs; both are listed by
  `getOpenOrders` and moved by `modifyOrder` (AMEND_POSITION_SLTP answers
  REPLACED on the position's STOP_LOSS_TAKE_PROFIT order).
- **AMEND_POSITION_SLTP drops a level that is omitted**: sending only
  `stopLoss` removed the take-profit. Re-sending the other level on every
  amend (already the design) is required; cancelling a leg is "send only the
  other one".
- A pending SELL STOP sent with the long's `positionId` is accepted, stays
  attached (`positionId` set) but reports `closingOrder: false`. When it
  triggered (11 s, stop 1 point below the bid) it **closed the long and
  opened no short**: linking reduces as intended. Amending it keeps the link.
- Closing a position cancels only the venue's own protection order; a
  linked pending order **stays active** with the position gone. The
  adapter's post-close cancellation of linked orders is therefore required.
- After a manual close both legs settle as Cancelled.

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
- [x] Confirm encodings and limits on the real demo (spike, 2026-10-13)
- [x] Symbol specs re-read after SYMBOL_CHANGED events and after reconnects
      (pre-submission review)

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
- [x] Confirm on the real demo: execution event sequence, relative
      protection rounding, amend keeps SL/TP (re-sent) and expiry (fixed);
      partial fills were not observed (demo market orders filled whole)
- [x] A stop-only amend keeps a stop-limit's limit price (the venue stores
      the limit as a distance from the stop; pre-submission review)
- [x] Every amend re-sends the entry price: the venue rejects a stop or
      stop-limit amend without its stop price ("Stop price should be
      defined"), found by the demo re-check below
- [x] Demo re-check (2026-10-14, user-approved, two runs): one SELL STOP
      LIMIT 500 pips below the market, amended stop-only, volume-only and
      limit-only, then cancelled. First run: the stop-only amend kept the
      limit and the GTD expiry; the other two were rejected for the missing
      stop price. After the fix all eight checks passed. Account back at its
      baseline (0 positions, 0 orders) after both runs

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
- [x] Owner guide: uta-live-testing venue facts and round record for cTrader

### 6. Verification and acceptance

- [x] Package typecheck, root `npx tsc --noEmit`, `cd ui && npx tsc -b`
- [x] `pnpm test` complete (2026-10-14, Windows x64, branch rebased on `dev`
      5da8dfcc): 7752 passed; the 14 failures in 11 files reproduce
      identically on clean `dev` 5da8dfcc (symlink EPERM and CLI environment
      on this host); one load timeout (presets/LeverUp) passes on rerun.
      After the entry-price fix, `pnpm test:changed`: 7755 passed, the
      same 14 baseline failures
- [x] `pnpm test:integration:uta` (291 passed, 2026-10-14)
- [x] `pnpm broker-packs:build` + Node verification on win32-x64: six archives
      verified, ctrader 2.4 MiB
- [x] `--compiled` verification with the pinned Bun 1.4.2 on win32-x64
      (2026-10-14): all six packs import and construct in the compiled probe
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
