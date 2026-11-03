# UTA Live Testing — the self-bootstrapped scenario catalog

This guide owns live broker/demo acceptance. Architecture and delivery
context: [[docs/project-structure.md]] and [[docs/development-workflow.md]].

**The method**: an AI session walks REAL trading workflows end-to-end on
demo accounts, exclusively through the agent surface (`alice-uta`), fixing
what it hits and adding a regression spec per fix. Early dogfood rounds
surfaced ~20 real bugs no unit test or human UI session would catch (SDK
shape drift, attached TP/SL the exchange never received, float-truncated
19-digit order ids, split-process-only crashes). Run the relevant scenarios
after any change to trading paths, and the full catalog as the acceptance
gate for new broker integrations.

## Verification layers

Do not jump from a unit change to an account-trading sweep; start at the
lowest layer that can disprove the change:

```bash
pnpm test:integration              # ordinary product E2E: never submits orders
pnpm test:external:readonly        # public providers, local keys, read-only TWS
OPENALICE_UTA_LIVE_PAPER=1 pnpm test:live:bybit-paper   # one provider
OPENALICE_UTA_LIVE_PAPER=1 pnpm test:live:uta-paper     # full demo/paper sweep
OPENALICE_UTA_LIVE_PAPER=1 pnpm test:live:bybit-diagnostic  # market buy + close
```

- Ledger/commit/reconciliation changes: unit specs then
  `pnpm test:integration:uta` (MockBroker); live-paper only when venue
  behavior is part of the claim.
- Broker account parsing, order ids, status mapping, modify/cancel,
  permissions, TP/SL, venue parameters: targeted broker spec against one
  verified demo/paper account — these semantics cannot be proven by
  MockBroker.
- Protocol/`alice-uta` CLI changes: protocol specs then the relevant
  scenario through a real Workspace CLI; live required if the command
  reaches an order write or approval boundary.
- New broker or traded market type: full applicable S1–S14 catalog, always.
- CCXT public K-line changes: the gated keyless freshness acceptance
  (`tests/integration/broker-market-data/CcxtBroker.spec.ts` under
  `vitest.external.config.ts`) asserting Binance/OKX/Bybit latest bars
  across 1m–1d. Keep it outside CI (DNS/geo/rate limits are external
  failure modes); deterministic specs must model first-page pagination
  offline.

The environment variable is an acknowledgement, not proof of safety:
inspect the account configuration and confirm a paper/demo/sandbox preset
before setting it; never print credentials during that inspection.

## Run record and cleanup

Record per run: account id, venue, resolved mode, scenario, commit; pre-run
positions/open orders (cleanup baseline, never assume empty); submitted
order ids as strings; relevant logs; post-run state vs baseline. Automated
cancellation is not a safety boundary — after success AND failure, query the
venue again, cancel new open orders, close only test-created positions,
reject leftover staging, and confirm baseline; otherwise stop and report the
account as needing manual cleanup. IBKR smoke appends a JSONL record under
ignored `data/uta-live-paper-runs/` (`OPENALICE_UTA_LIVE_RECORD_DIR` to
relocate); the record excludes account ids, balances, credentials, and
position payloads. Never let a live test overwrite tracked fixtures.

## Ground rules

- **Demo/paper accounts only** — verify `mode` first, every time.
- **Agent surface only** (`alice-uta`; `alice` for pre-trade data). The
  tool-level `wallet/push` deliberately refuses approval — that wall is a
  feature; the HTTP wallet/push path stands in for "user clicked approve".
- **Never trust the ledger over the venue** — after any order that matters,
  verify on the exchange side (a probe script via `createBroker()` + raw
  ccxt calls is legitimate and doubles as the external actor for S7).
- **ccxt is an SDK, not a semantic layer**: identical calls behave
  differently per venue (bybit's unscoped open-orders listing hides spot;
  okx rejects `reduceOnly` on spot; conditional orders live in separate
  namespaces; hyperliquid's unscoped `fetchBalance()` reads the perp
  clearinghouse). Anything verified on one venue is UNVERIFIED on the next.
- **Balance routing stays authoritative**: mode-query failures or unknown
  modes must fail the account read, not fall back to a partial ledger;
  exercise mode changes with real CCXT routing (cached
  `enableUnifiedMargin` can override an explicit `type: swap`).
- **A zero balance is a finding, not a pass** — compare against the venue
  UI's portfolio value before accepting a balance read.
- **Leave accounts flat**: sell back fills, cancel hangers, `git reject`
  stray staging; finish at 0 open orders, clean `git status`, baseline
  positions.
- **Price bands**: venues reject limits far from market (okx 51138/…, bybit
  170193/170194). Marketable orders at quote ±0.3%; hangers ~15–30% away;
  re-quote right before pushing.
- Every bug: fix in scope or file a GitHub issue with scenario, venue,
  evidence, suspected path. Every fix gets a regression spec before the
  round continues.

## Setup

Inside a Workspace the launcher injects `OPENALICE_TOOL_URL`/`SOCKET` plus
`AQ_WS_ID`. Outside, use `openalice exec --project <key> alice-uta …` (add
`--machine <id-or-label>` for a saved remote target). A manual source-shim
invocation must supply the discovered routing environment and Workspace id
from that AliceProject, then execute
`src/workspaces/cli/bin/alice-uta` directly (a shell launcher, not `node`);
never infer endpoints from historical ports or another project's default
home. Approval stays a human action (UI or the explicit wallet/push HTTP
path against the verified endpoint with the exact pending hash). Probe
scripts live as throwaway gitignored `.mts` files under `data/`, run with
`NODE_OPTIONS='--conditions=openalice-source' npx tsx`, importing
`readUTAsConfig` + `createBroker`; delete after use.

## IBKR acceptance

- **Canonical contracts**: `conId` is not a complete routing contract. Quote
  and order paths resolve through a clean `{ conId }` details request;
  caller-supplied symbols/exchanges/currencies must not poison the lookup;
  `STK / SMART / USD` defaults apply only to symbol-form stocks without a
  conId. Offline coverage: `IbkrBroker.spec.ts` with the
  `contract-resolution.v1.json` fixture; paper acceptance via
  `ibkr-paper.e2e.spec.ts` (what-if validation) and
  `uta-ibkr.e2e.spec.ts` (FX identity/stage/commit/reject without push).
- **Silent half-open recovery** (read-only): freeze the Gateway without
  closing its socket (`docker pause`; trap guaranteed unpause). UTA must
  move to `offline/down` within heartbeat+timeout (~50s) without requiring
  six caller-driven cache failures; reads refuse rather than serve stale
  cache; unpause recovery passes a private read before `healthy/readable`.
  The write boundary proves place/modify/cancel performs `reqCurrentTime`
  before the send and never sends when that probe times out — do not submit
  a live order to test this gate.
- **Option position mark overlay** (read-only): positive snapshot bid+ask
  produces midpoint; `marketValue`/`unrealizedPnL` recompute through
  `derivePositionMath` (qty, side, multiplier); the broker-owned
  `updatePortfolio()` cache is not mutated; missing entitlement/incomplete
  quote/timeout returns the cached row without failing the portfolio read;
  requests use `regulatorySnapshot=false` (never opt into paid snapshots).
- Venue facts: modify keeps the SAME orderId; stops sit `PreSubmitted`;
  paper quotes need delayed data; multi-currency books blind-sum at the
  broker layer.

## Scenario catalog

Run the relevant S1–S14 per trading-path change; the full applicable catalog
per new venue (S13/S14 only for venues with those surfaces).

**S1 — Read-state agreement.** `account info`, `account portfolio`,
`/equity`: account unrealizedPnL equals the positions sum; rows carry
`secType` + `aliceId` (same-symbol spot vs perp distinguishable AND
actionable). *Guards: PnL aggregation drift, ambiguous rows.*

**S2 — Simple lifecycle.** Marketable limit (quote×1.003) → fill as a
`[sync]` commit within ~15s with execution price+qty → `order trades` →
sell back. *Guards: fill-awareness, execution data loss.*

**S3 — Hanger stability.** Deep limit left ≥3 poller passes (~40s): stays
`Submitted`, no spurious transitions or per-pass cost explosion → cancel
with `cancelled` recorded. *Guards: absence-as-terminal, poller churn.*

**S4 — Amendment.** Hanger → `order modify` (price AND qty) → `order list`
shows new values with the SAME full-precision string orderId → cancel.
*Guards: editOrder quirks, id truncation.*

**S5 — Attached TP/SL.** `--takeProfit`/`--stopLoss`. On a ccxt venue
without a verified `placeOrderWithTpSl` override this must REFUSE loudly
(never a naked entry). On a verified venue confirm BOTH legs exist on the
exchange — including the trigger/algo namespace — before calling it working.
On a native-bracket venue (Alpaca) the push result carries `legs` ids and
`order list` tracks both; a held SL leg never appears in the venue listing,
so place-time is the ONLY moment to learn it — a listing diff cannot
recover a missed leg. *Guards: silent unprotected positions and the naked
ledger — both fatal to "trust the log".*

**S6 — Standalone stop.** `STP` with far trigger → tracked `submitted`
across passes though invisible to the regular listing (the
absence-confirm must find it via the `{stop:true}` fallback, not
mis-terminal it) → cancel through Alice.

**S7 — External order observation.** Order via direct broker probe (git
never sees it) → `[observed]` commit within the observation cadence
(`trading.json observeExternalOrdersEvery`; drop to `1m` via
`PUT /api/config/trading`, restore after) → pending takeover → cancel
through Alice.

**S8 — Restart survival.** With a hanger pending, restart UTA → the order
stays tracked, syncable, cancellable (persisted localSymbol must rebuild the
id→symbol cache). *Guards: in-memory cache dependence.*

**S9 — Partial close.** `position close --qty <half>` on SPOT (must NOT
send reduceOnly) and on perp where present (must send it). *Guards:
derivatives params leaking onto spot.*

**S10 — Notional entry.** `--orderType MKT --cashQty 30` → fill qty ≈
cash/price, trade value ≈ cash. *Guards: amount-vs-cost semantics.*

**S11 — Error ergonomics.** Deliberately bad aliceId, unknown `--source`,
out-of-band limit price, modify of a nonexistent id — every error actionable
for an agent (expected format, available accounts, the venue's own message —
never a bare HTTP code).

**S12 — Staging undo.** Stage → `git reject --reason …` → clean status,
`user-rejected` history; a `--commitMessage` one-step ends in
`awaitingApproval` and rejects cleanly.

**S13 — Hub/leaf identity** (directory-style search venues). Classify rows:
LEAVES carry a tradeable aliceId; DIRECTORIES are `expandable: true` and
must REFUSE quote/trade pointing at `contract expand`. Expand each hub kind
(FX family → pairs; bond issuer → bonds; underlying+expiry → options;
underlying alone → parameter grid). Every leaf round-trips aliceId → quote
(or a LOUD entitlement error) → place/track/cancel.

**S14 — Derivative position signs & units.** Open all four option combos
the venue allows; per leg verify on every surface: `side`; `avgCost` and
`marketPrice` in the SAME unit (venue averageCost is often multiplier-baked
— IBKR reports 103 for an option bought at 1.03); `unrealizedPnL` sign;
equity direction. Then `sim price-change` on the UNDERLYING: derivative rows
must be excluded loudly, never re-marked with the stock's price (symbol
collision once produced +23,000% "moves"). *Guards: unit-mismatched basis,
symbol-collision re-marking, sign inversion.*

## New-broker checklist (beyond core scenarios)

- `getOpenOrders` must SEE a real open order — empty-without-error is the
  silent failure mode; sweep every market type; throw on partial listings.
- Order ids round-trip as STRINGS end-to-end.
- In-kind fees appear as `reconcile` trades, not corrupt cost basis.
- Document conditional-order namespaces in the venue's
  `exchanges/<name>.ts` override — the canonical home for every quirk.
- Bracket venues: `placeOrder` returns child ids via `PlaceOrderResult.legs`
  so the ledger tracks them from birth; verify a venue-hidden leg (Alpaca's
  held stop) still shows in `order list` and syncs.
- Amendment identity: if modify mints a new id (Alpaca replaceOrder does),
  the NEW id must be tracked and the OLD must resolve — no ghost pending.
- Venue error messages reach the user (no swallowed bodies — the Alpaca
  opaque-422 and IBKR >=2000 blanket lessons).
- Directory search rows wire through nativeKey grammar + `expandContract`.
- Read the adapter BEFORE connecting — pre-located findings are cheap.
