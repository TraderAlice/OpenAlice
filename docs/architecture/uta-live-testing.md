# UTA Trading, Broker Packs, and Live Acceptance

This guide owns the Unified Trading Authority (UTA) boundary, optional Broker
Pack packaging and runtime loading, the IBKR wire framing contract, and the live
paper/demo acceptance catalog. Market-data routing belongs to
[[docs/market-data-architecture.md]].

---

## 1. UTA Core and Broker Pack Boundary

The installed core ships Alice, UTA Core, and the Mock simulator only. Live
broker integrations (`ccxt`, `alpaca`, `ibkr`, `leverup`, `longbridge`) ship as
versioned, platform-specific **Broker Packs** installed on demand:

1. **UTA Core** (`services/uta/`) owns account orchestration, staged/committed
   Git-style trading approvals, snapshots, FX, and the `IBroker` boundary. It
   must start without any live Pack.
2. **Broker Packs** (`packages/uta-broker-*`) export `BROKER_PACK_API_VERSION: 1`,
   `BROKER_ENGINE`, `configSchema`, and `createBroker(config): IBroker`. Third-party
   SDKs stay external inside each deployed Pack except Alpaca, whose pure-JS
   closure is bundled for compiled Bun compatibility. Core code must use
   structural checks (`Decimal.isDecimal`) and stable error codes rather than
   cross-package `instanceof`.
3. **Market-data vendor routing** is separate from Pack installation: installing
   a Pack does not enable a K-line source, and disabling `asVendor` does not
   uninstall a Pack.

### Pack installation layout and transaction

```text
<OPENALICE_HOME>/runtime/broker-packs/<engine>/
├── active.json
└── releases/<openalice-version>-<content-id>/{broker-pack.json,dist/index.js,package.json,node_modules/}
```

Alice owns Pack installation; UTA never runs a package manager. Installation
streams the version/OS/arch asset into private staging, verifies its published
SHA-256 and manifest, writes an immutable release, atomically updates
`active.json`, requests a serialized UTA restart, and verifies loaded module
identity via `GET /__uta/broker-packs/:engine`. A pointer change alone never
proves a cached SDK was replaced. Missing or broken Packs stay visible as
`needs-install` or `needs-repair` in `GET /api/trading/config/broker-packs`
without blocking Alice, Chat, or other engines. `canTrade` additionally requires
configured-on, writable, `pro` mode, and a healthy trading-tier UTA.

### Release assets and verification

```bash
pnpm broker-packs:build
pnpm broker-packs:upgrade-smoke
pnpm exec tsx scripts/verify-broker-packs.ts --compiled
```

Desktop package assertions reject `ccxt`, `longbridge`, and
`@alpacahq/alpaca-trade-api` under packaged `node_modules`. Bun standalone
builds must keep `autoloadPackageJson` enabled (`scripts/bun-compile-options.ts`)
so the compiled UTA role resolves Pack-local `node_modules`.

---

## 2. IBKR Wire Protocol and Decoder Boundary

`packages/ibkr/src/client/base.ts` owns inbound TWS/IB Gateway framing:

- Before server version 201, consume the leading NUL-delimited text `msgId`;
  from version 201+, consume the leading 4-byte big-endian `msgId`.
- If the wire id selects protobuf, pass the remaining bytes unchanged; otherwise
  split only the remaining text payload into fields.
- `Decoder.interpret(msgId, fields)` is strictly **payload-only**: handlers
  start at the first payload field and must never consume or reconstruct an
  envelope message id, guess account patterns, or shift fields on error.

### Failure containment

A missing or invalid field is unrecoverable on that connection:

1. Report safe framing metadata (`msgId` and field count) without logging raw
   account or position payloads.
2. Discard all successor frames already buffered in that socket read.
3. Disconnect only the affected IBKR connection so UTA marks that account
   `offline/down` and reconnects cleanly without crashing the UTA process or
   disturbing other accounts.

The same containment applies during the initial `nextValidId` handshake if the
socket closes early.

### Venue-specific invariants (IBKR & Alpaca)

- **IBKR canonical contracts**: `conId` alone is not a complete routing
  contract; quote and order paths resolve through a clean `{ conId }` details
  lookup without letting caller-supplied symbol/exchange/currency poison it.
  `STK / SMART / USD` defaults apply only to symbol-form stocks without a
  `conId`.
- **IBKR silent half-open recovery**:UTA must transition a frozen Gateway
  (`docker pause`) to `offline/down` within heartbeat+timeout (~50s), refuse
  stale reads, and require `reqCurrentTime` before any place/modify/cancel send.
- **IBKR option mark overlay**: Positive snapshot bid+ask computes midpoint and
  recomputes `marketValue`/`unrealizedPnL` via `derivePositionMath` without
  mutating the `updatePortfolio()` cache, using `regulatorySnapshot=false`.
- **Alpaca multi-asset**: Spot crypto keeps `CRYPTO` identity with slash pairs
  (`BTC/USD`) except the upstream positions path which requires compact symbols
  (`BTCUSD`). Single-leg options require positive `options_trading_level`, whole
  contracts, per-unit premium prices, MKT/LMT/STP/STP LMT, and DAY/GTC; short
  quantities remain positive counts with direction in `side`.

---

## 3. Live Paper/Demo Testing & Scenario Catalog

An AI session walks real trading workflows end-to-end on demo/paper accounts
exclusively through `alice-uta`, fixing defects and adding a regression spec per
fix.

### Verification layers

```bash
pnpm test:integration                                        # MockBroker product E2E
pnpm test:external:readonly                                  # public providers, read-only TWS
OPENALICE_UTA_LIVE_PAPER=1 pnpm test:live:bybit-paper        # single venue paper sweep
OPENALICE_UTA_LIVE_PAPER=1 pnpm test:live:uta-paper          # full demo/paper sweep
```

### Ground rules

- **Demo/paper accounts only** — inspect config and verify `mode` before setting
  `OPENALICE_UTA_LIVE_PAPER=1`; never print credentials or overwrite tracked
  fixtures.
- **Agent surface only (`alice-uta`)** — tool-level `wallet/push` refuses
  self-approval by design; the explicit HTTP `wallet/push` endpoint stands in
  for human approval.
- **Never trust the ledger over the venue** — verify orders/positions on the
  exchange side. `ccxt` is an SDK, not a semantic layer: behavior verified on
  one venue is unverified on the next.
- **Leave accounts flat** — after both success and failure, cancel open hangers,
  close test-created positions, `git reject` leftover staging, and confirm
  pre-run baseline.

### Scenario catalog (S1–S14)

- **S1 — Read-state agreement**: `account info`, `account portfolio`, `/equity`
  agree on `unrealizedPnL`; rows carry distinguishable, actionable `secType` +
  `aliceId`.
- **S2 — Simple lifecycle**: Marketable limit (`quote × 1.003`) → `[sync]` fill
  commit within ~15s with price+qty → `order trades` → sell back.
- **S3 — Hanger stability**: Deep limit (`~15–30%` away) survives ≥3 poller
  passes (~40s) as `Submitted` without churn → cancel records `cancelled`.
- **S4 — Amendment**: `order modify` (price and qty) preserves full-precision
  string `orderId` (or tracks replacement ID and resolves old ID on venues like
  Alpaca) → cancel.
- **S5 — Attached TP/SL**: Refuses loudly on unsupported venues (never places a
  naked entry); on supported venues, confirms both legs exist on the exchange
  (and tracks `PlaceOrderResult.legs` from birth).
- **S6 — Standalone stop**: `STP` with far trigger stays tracked across passes
  via `{ stop: true }` fallback rather than false terminal state → cancel.
- **S7 — External order observation**: Direct venue order outside Alice →
  `[observed]` commit within cadence → takeover and cancel through Alice.
- **S8 — Restart survival**: Pending hanger survives a UTA restart and remains
  syncable and cancellable from persisted `localSymbol`.
- **S9 — Partial close**: `position close --qty <half>` omits `reduceOnly` on
  spot and includes it on perps.
- **S10 — Notional entry**: `--orderType MKT --cashQty 30` fills `qty ≈ cash/price`.
- **S11 — Error ergonomics**: Bad `aliceId`, unknown `--source`, out-of-band
  price, or missing order ID return actionable agent errors including venue
  messages.
- **S12 — Staging undo**: Stage → `git reject --reason …` restores clean status
  and `user-rejected` history.
- **S13 — Hub/leaf contract discovery**: Directory rows (`expandable: true`)
  refuse direct quote/trade and point to `contract expand`; leaf `aliceId` rows
  round-trip quote → place → cancel.
- **S14 — Derivative position signs & units**: Option legs preserve consistent
  per-unit `avgCost` vs `marketPrice`, `side`, and `unrealizedPnL` sign;
  underlying `sim price-change` excludes derivative rows loudly.
