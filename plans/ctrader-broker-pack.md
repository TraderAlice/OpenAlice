# cTrader Broker Pack

**Status:** active — increment 0 (design + spike)

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

Unconfirmed, to measure in the spike: rate limits, heartbeat interval,
trendbar/tick history limits, volume and price encodings, error codes.

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
   Unsealed token files are not an option.
2. **First authorization UX.** A local redirect URI on the OpenAlice UI
   versus pasting tokens generated in the Open API playground. Depends on
   whether Spotware accepts loopback redirect URIs.
3. **Hedging vs netting accounts.** Map cTrader positions (position ids,
   possibly several per symbol) onto UTA `Position` without losing identity.
4. **Asset-class mapping** of cTrader symbol categories to
   `assetClassFor` values and `secType`.

## Increments

### 0. Prerequisites (branch owner)

- [ ] cTID and a demo account at any cTrader broker
- [ ] Open API application registered and approved; clientId/secret kept
      outside the repository
- [ ] `pnpm install` in this worktree; baseline `pnpm test:changed`

### 1. Feasibility spike (outside the repo tree)

- [ ] Script: app auth → account list → account auth → trader info
- [ ] Symbol catalog: list, full details for several asset classes
- [ ] Spot subscription, trendbars, ticks; record encodings and limits
- [ ] Place/amend/cancel a pending order; open/close the minimum market
      position; observe execution events; account left flat
- [ ] Record findings and answer open questions 2–4 here

### 2. Transport and session

- [ ] WebSocket JSON client: request/response correlation, timeouts,
      heartbeat, reconnect with backoff, connection-state listener
- [ ] App + account auth; token refresh per the chosen answer to Q1
- [ ] Specs against a fake server

### 3. Read surface (`IBroker`)

- [ ] init/close, connection state
- [ ] searchContracts, getContractDetails, nativeKey grammar
- [ ] getAccount, getPositions, getOrders/getOrder/getOpenOrders
- [ ] getQuote, getMarketClock, getHistorical, getCapabilities, assetClassFor

### 4. Write surface

- [ ] placeOrder (market, limit, stop, stop-limit; attached SL/TP via legs)
- [ ] modifyOrder (identity preserved or remapped), cancelOrder
- [ ] closePosition (full and partial)
- [ ] Error mapping that preserves venue messages

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
