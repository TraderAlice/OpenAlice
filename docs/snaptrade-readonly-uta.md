# SnapTrade read-only UTA design

## Goal

Connect a SnapTrade Personal account to OpenAlice as one or more **read-only**
UTAs. The integration is intended for portfolio monitoring and research; it
must never submit, amend, cancel, or stage a brokerage order.

## Why a dedicated broker pack

SnapTrade is a brokerage-account aggregation API. A single Personal API key
can expose several brokerage connections and several accounts under each
connection. OpenAlice's UTA model is intentionally one account per UTA, so the
adapter must make account identity explicit instead of treating a Personal key
as one aggregate trading account.

The integration belongs in `services/uta/` and an optional `snaptrade` Broker
Pack. Credentials remain in UTA's sealed account configuration; workspace
skills and scheduled agents receive only the normalized read surface exposed by
`alice-uta`.

## Account setup

1. The user enters a SnapTrade Personal `clientId` and `consumerKey` through a
   sensitive Trading UI form. Both fields are write-only and sealed at rest.
2. UTA signs a read-only request to enumerate SnapTrade connections and their
   accounts.
3. The UI displays only `INVESTMENT` accounts and asks the user which accounts
   to add. Each selected SnapTrade account becomes a separate UTA with its
   immutable SnapTrade `accountId` in its fingerprint.
4. A connection that is disabled, degraded, or missing is not silently
   retained as healthy. The user receives a reconnect action that opens the
   provider's Connection Portal.

The first release must not auto-create UTAs from every discovered account:
the user must explicitly select them. This prevents a linked cash, line of
credit, retirement, or crypto account from unexpectedly entering a trading
workflow.

## Read contract

The pack maps these SnapTrade reads into `IBroker`:

- account balances and buying power;
- stock-like equity positions (stocks, ETFs, ADRs, CEFs, and mutual funds),
  including fractional quantity, cost basis, price, and currency. Options,
  futures, crypto, and cash-equivalent instruments loud-refuse until their
  dedicated contract mappings are implemented;
- recent/open orders and single-order lookup;
- connection status and `data_freshness_mode`.

`getCapabilities()` declares US securities and no order types. Every mutation
method (`placeOrder`, `modifyOrder`, `cancelOrder`, and `closePosition`) returns
a permanent `BrokerError('CONFIG', 'SnapTrade accounts are read-only')` before
making any network request. The Trading UI must render these accounts as
read-only and omit staging controls.

## Freshness and monitoring policy

Each successful account read records both the connection state and
`data_freshness_mode` supplied by SnapTrade.

- `realtime`: eligible for the configured intraday monitor after a successful
  independent scheduled preflight.
- `delayed`, missing, or stale: research/daily-review only; never eligible for
  a 15-minute risk alert claiming current broker coverage.
- disabled connection or failed read: mark the UTA degraded and publish a
  Chinese alert that names the excluded account.

The monitor reports its covered account IDs in every alert. It must not combine
Robinhood and OKX values when either source is degraded.

## Security and validation

- Never log or serialize `consumerKey`, OAuth tokens, raw request signatures,
  or full account numbers.
- Use SnapTrade Personal authentication only; do not register a commercial
  SnapTrade user or store a `userSecret`.
- Unit-test request signing, response mapping, read-only mutation rejection,
  multi-account identity, disabled-connection handling, and freshness gating.
- Acceptance uses a dedicated read-only Personal key and validates one
  `realtime` account without placing any order.

## Rollout

1. Land the protocol, pack, and UI account-selection work behind the optional
   Broker Pack installation boundary.
2. Validate on a user-authorized read-only Robinhood connection.
3. Enable unattended monitoring only after the scheduled preflight can read
   the configured UTA without interactive MCP confirmation.
