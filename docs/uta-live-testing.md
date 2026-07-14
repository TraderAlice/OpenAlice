# UTA Live Testing — the self-bootstrapped scenario catalog

This guide owns live broker/demo acceptance. Architecture and delivery context:
[[docs/project-structure.md]] and [[docs/development-workflow.md]].

This guide exists because five dogfood rounds (2026-06-12) surfaced ~20 real
bugs that **no unit test and no human UI session would ever catch** — they
only appear on the real usage path, through the agent surface, against real
venue behavior. Examples of the species: contract search returning a false
"not tradeable" (SDK shape drift), an attached TP/SL that the ledger showed
but the exchange never received, 19-digit order ids silently float-truncated
so every later cancel-by-id would miss, `getOrders` crashing only in the
split-process path.

**The method**: an AI session walks REAL trading workflows end-to-end on the
demo accounts, exclusively through the agent surface (`alice-uta` CLI),
fixing what it hits and adding a regression spec per fix. Run it after any
change to trading paths, and as the acceptance gate for new broker
integrations.

The automated account-trading suite is deliberately separate from ordinary
product E2E. It will not start unless both its explicit script and acknowledgement
are present:

```bash
OPENALICE_UTA_LIVE_PAPER=1 pnpm test:uta:live-paper
```

`pnpm test:e2e` never submits broker orders. It contains only local product
integration tests and read-only network/provider checks.

## Choose the verification layer

Do not jump from a unit change straight to an account-trading sweep. Start at
the lowest layer that can disprove the change, then move outward only when the
touched contract requires it.

| Change surface | Minimum verification | When live-paper is required |
|---|---|---|
| UTA staging, commit, ledger, reconciliation, or state transitions | Targeted unit specs, then `pnpm test:e2e` (`uta-lifecycle` uses `MockBroker`) | Only when venue behavior or a real execution response is part of the claim |
| Public market loading or read-only provider integration | Targeted read-only E2E; failures from DNS/TLS/provider downtime must be reported separately from product failures | Not required when no configured account or private endpoint is used |
| Broker account parsing, order ids, status mapping, modify/cancel, permissions, TP/SL, or venue-specific parameters | Targeted broker spec against one verified demo/paper account | Required: these semantics cannot be proven by `MockBroker` |
| Alice-to-UTA protocol or `alice-uta` CLI changes | Protocol/unit specs, then the relevant scenario through a real Workspace CLI | Required if the changed command reaches an order write or approval boundary |
| New broker or new traded market type | Full applicable S1-S14 catalog for that venue | Always required before claiming support |
| UTA health/restart/supervision without trading changes | Health and restart smoke with a broker disabled or read-only | Only if recovery of pending/open orders is part of the change |

The commands are intentionally asymmetric:

```bash
# Ordinary product E2E: safe for routine local development and CI.
pnpm test:e2e

# One explicitly selected account-trading spec.
OPENALICE_UTA_LIVE_PAPER=1 pnpm test:uta:live-paper -- \
  services/uta/src/domain/trading/__test__/e2e/uta-bybit.e2e.spec.ts

# Full configured demo/paper account suite. Use only for a deliberate sweep.
OPENALICE_UTA_LIVE_PAPER=1 pnpm test:uta:live-paper
```

The environment variable is an acknowledgement, not proof that an account is
safe. Before setting it, inspect the selected account configuration and confirm
its resolved preset is paper/demo/sandbox. Never print credentials while doing
that inspection.

## Live-paper run record and cleanup

For every live-paper run, record enough evidence to distinguish a product bug
from venue or network behavior:

1. Account id, provider/venue, resolved paper/demo mode, scenario/spec, and
   current Git commit.
2. Pre-run positions and open orders. These are the cleanup baseline, not an
   assumption that the account starts empty.
3. Submitted order ids as strings, relevant Alice/UTA logs, and raw venue
   status for any disputed transition.
4. Post-run positions and open orders compared with the baseline.

Automated cancellation is helpful but not a safety boundary: a process can be
interrupted between submit and cleanup. After success **and after failure**,
query the venue again, cancel new open orders, close only positions created by
the test, reject leftover Alice staging, and confirm the account returned to
its baseline. If that cannot be proven, stop the development lane and report
the account as requiring manual cleanup.

## Ground rules

- **Demo/paper accounts only.** Verify `mode` in the account config before
  starting. No real funds, ever.
- **Agent surface only** — drive everything through `alice-uta` (and `alice`
  for pre-trade data). The HTTP routes and UI are tested by humans; the CLI/
  tool path is where agent-only bugs hide. Exception: `wallet/push` over
  HTTP stands in for "the user clicked approve" (the tool-level push
  deliberately refuses — that wall is a feature, don't bypass it via tools).
- **Never trust the ledger over the venue.** After any order that matters
  (especially anything conditional), verify on the exchange side — a probe
  script via `createBroker()` + raw ccxt calls is legitimate (and doubles as
  the "external actor" for observation tests). The TP/SL-that-never-existed
  bug looked perfect in git.
- **ccxt is an SDK, not a semantic layer.** Identical calls behave
  differently per venue (bybit's unscoped open-orders listing silently hides
  spot; okx rejects `reduceOnly` on spot; conditional orders live in
  separate API namespaces). Anything that works on one venue is UNVERIFIED
  on the next until tested there.
- **Leave accounts flat.** Sell back fills, cancel hangers, `git reject`
  stray staging. Finish with: 0 open orders per account, `git status`
  clean, position quantities at their pre-session baseline.
- **Price bands**: venues reject limits too far from market (okx 51138/…,
  bybit 170193/170194). For marketable orders use quote ±0.3%; for hangers
  use deep prices the band allows (~15-30% away worked on okx/bybit demo).
  Re-quote right before pushing — the band moves with the market.
- Every bug found: fix in place if in scope, otherwise file a GitHub issue with
  the scenario, venue, evidence, and suspected path. Every fix gets a
  regression spec before the round continues.

## Setup

```bash
export OPENALICE_TOOL_URL=http://127.0.0.1:47331/cli
export AQ_WS_ID=<any live workspace id>     # from ~/.openalice/workspaces/workspaces.json
BIN=src/workspaces/cli/bin/alice-uta
node $BIN                                    # discover groups/verbs
node $BIN order place --help                 # flags come from the manifest
# "user approves": curl -s -X POST http://127.0.0.1:47333/api/trading/uta/<id>/wallet/push
```

Running inside a real OpenAlice Workspace is preferred: the launcher injects
`OPENALICE_TOOL_URL` or `OPENALICE_TOOL_SOCKET` plus `AQ_WS_ID` automatically.
For a manual repo-root run, use Guardian's printed Alice web port rather than
assuming 47331 if `data/config/ports.json` overrides it.

Probe scripts (external orders, raw venue checks) live as throwaway `.mts`
files under `data/` (gitignored), run with
`NODE_OPTIONS='--conditions=openalice-source' npx tsx data/<file>.mts`,
importing `readUTAsConfig` + `createBroker` by absolute/relative path.
Delete after use.

## Scenario catalog

Run the relevant S1–S14 scenarios for a trading-path change; run the full
applicable catalog per venue for a new broker integration. S13/S14 apply only
to venues with the corresponding directory/derivatives surfaces. Each scenario
names the bug class it guards against.

**S1 — Read-state agreement.** `account info`, `account portfolio`,
`/equity`: account-level unrealizedPnL must equal the positions sum;
portfolio rows must carry `secType` + `aliceId` (same-symbol spot vs perp
must be distinguishable AND actionable). *Guards: PnL aggregation drift,
ambiguous rows.*

**S2 — Simple lifecycle.** Marketable limit (quote×1.003) → fill appears as
a `[sync]` commit within ~15s with execution price+qty → `order trades`
shows it → sell back. *Guards: fill-awareness, execution data loss.*

**S3 — Hanger stability.** Deep limit order, leave it ≥3 poller passes
(~40s): must stay `Submitted`, no spurious transitions, no per-pass cost
explosion (listing mode) → cancel, verify `cancelled` recorded. *Guards:
absence-as-terminal false positives, poller churn.*

**S4 — Amendment.** Hanger → `order modify` (price AND qty) → `order list`
must show the new values with the SAME full-precision string orderId →
cancel. *Guards: editOrder venue quirks, id truncation.*

**S5 — Attached TP/SL.** `order place … --takeProfit '{"price":…}'
--stopLoss '{"price":…}'`. On a ccxt venue WITHOUT a verified
`placeOrderWithTpSl` override this must REFUSE loudly (never place a naked
entry). On a verified venue: after fill, confirm BOTH protective legs exist
on the exchange — including the trigger/algo namespace — before calling it
working. On a native-bracket venue (Alpaca): the push result must carry
`legs` ids, and after the entry fills `order list` must show BOTH legs as
tracked orders. The held SL leg never appears in the venue's open-orders
listing (Alpaca holds it while the TP works) — place-time is the ONLY
moment Alice can learn it exists, so a venue listing diff can NOT recover
a missed leg. *Guards: the silent unprotected-position failure (okx,
ledger lied protected) and its mirror, the naked ledger (alpaca, ledger
blind to real protection) — both fatal to "trust the log".*

**S6 — Standalone stop.** `STP` with a far trigger → accepted → tracked as
`submitted` across passes even though algo orders are invisible to the
regular listing (the absence-confirm must find it via the `{stop:true}`
fallback, NOT mis-terminal it) → cancel through Alice. *Guards: conditional
order type mapping, algo-namespace tracking.*

**S7 — External order observation.** Place an order via a direct broker
probe script (git never sees it) → `[observed]` commit within the
observation cadence (`trading.json observeExternalOrdersEvery`; drop to
`1m` for the test via `PUT /api/config/trading`, restore after) → pending
takeover → cancel it through Alice. *Guards: narrative holes, listing
namespace blindness (bybit defaultType lesson).*

**S8 — Restart survival.** With a hanger pending: restart UTA (`touch
services/uta/src/main.ts` under tsx watch) → after recovery the order is
still tracked, syncable and cancellable (persisted localSymbol must rebuild
the broker's id→symbol cache). *Guards: in-memory cache dependence.*

**S9 — Partial close.** `position close --qty <half>` on a SPOT position
(must NOT send reduceOnly) and, where a perp position exists, on the perp
(must send it) → fill recorded, remaining qty correct. *Guards: derivatives
params leaking onto spot.*

**S10 — Notional entry.** `order place --orderType MKT --cashQty 30` →
fill qty ≈ cash/price and trade value ≈ cash. *Guards: amount-vs-cost
semantics (bybit market-buy), conversion drift.*

**S11 — Error ergonomics.** Deliberately: bad aliceId format, unknown
`--source`, an out-of-band limit price, modify of a nonexistent id. Every
error must be actionable for an agent: state the expected format / list the
available accounts / carry the venue's own message (not a bare HTTP code).
*Guards: stranded-agent errors.*

**S12 — Staging undo.** Stage → `git reject --reason …` → status clean,
history shows `user-rejected` with the reason; a `--commitMessage` one-step
ends in `awaitingApproval` and rejects cleanly too. *Guards: approval-flow
dead ends.*

## New-broker acceptance checklist (beyond the core lifecycle scenarios)

- `getOpenOrders` must SEE a real open order you placed — empty-without-
  error is the silent failure mode (bybit returned [] for spot under
  defaultType 'swap'). Sweep every market type the account trades; throw on
  partial listings.
- Order ids round-trip as STRINGS end-to-end (place → list → modify →
  cancel → history).
- Fees: an in-kind-fee venue (buy ETH, fee in ETH) must show the dust as a
  `reconcile` trade, not corrupt cost basis.
- Conditional orders: where do they live (regular vs trigger namespace)?
  Document it in the venue's `exchanges/<name>.ts` override file — that
  file is the canonical home for every quirk you find.
- Bracket/attached orders: if the venue creates child orders, `placeOrder`
  must return their ids via `PlaceOrderResult.legs` so the ledger tracks
  them from birth. Verify a leg the venue HIDES from its open-orders
  listing (Alpaca's held stop) still shows in `order list` and syncs.
- Amendment identity: does modify keep the order id or mint a new one
  (Alpaca replaceOrder does)? After modify, the NEW id must be tracked and
  the OLD id must resolve — no ghost pending.
- Error messages from the venue must reach the user (no swallowed response
  bodies — the Alpaca opaque-422 lesson; IBKR's >=2000 "informational"
  blanket that swallowed 10xxx real errors).
- Hub/leaf: if the venue's search returns directory rows (see S13), wire
  them through the nativeKey grammar + expandContract rather than letting
  them mis-resolve or vanish.

**S13 — Hub/leaf identity (venues with directory-style search results).**
Search must classify rows: LEAVES carry a tradeable aliceId; DIRECTORIES
(bond issuers, FX families) are marked `expandable: true` and their aliceId
must REFUSE quote/trade with a message pointing at `contract expand`.
Expand each hub kind: FX family → concrete pairs (auto, at search); bond
issuer → individual bonds; underlying + expiry → concrete option contracts;
underlying without expiry → option parameter grid. Every leaf that comes out
must round-trip: aliceId → quote (or a LOUD entitlement error) → place/track/
cancel. *Guards: the symbol-key-assumes-STK mis-resolution, directory rows
dying as unaddressable search noise.*

**S14 — Derivative position signs & units (the four-combo matrix).** Open
all four option combos the venue allows (long/short × call/put; deep-ITM
entries fill blind off intrinsic, shorts fill by selling under fair). For
EACH leg verify on EVERY surface (portfolio tool, UI, simulator):
`side` correct; `avgCost` and `marketPrice` in the SAME unit (venue
averageCost is often multiplier-baked — IBKR reports 103 for an option
bought at 1.03); `unrealizedPnL` sign matches reality for the side; account
equity moves the right direction. Then run `sim price-change` on the
UNDERLYING's symbol: derivative rows must be excluded loudly, never
re-marked with the stock's price (symbol collision produced +23,000%
"moves" and sign-inverted PnL — the community "option direction is
flipped" report). *Guards: unit-mismatched cost basis, symbol-collision
re-marking, sign inversion on recompute surfaces.*

## Scoreboard so far

Rounds 1–5 (2026-06-12, okx + bybit + alpaca demo): ~20 bugs found and
fixed across PRs #325–#333 — fill-awareness paralysis, cost-basis at wrong
prices, search false negatives, unprotected TP/SL, id truncation, spot
reduceOnly, getOrders crash, and friends. Round 5 (bybit sweep) found zero
new product bugs — the venue-quirk fixes generalized. That's the signal the
catalog converges; keep it that way.

Round 6 (2026-06-12, alpaca market-open): 3 bugs. CLI gateway silently
stripped unknown flags (a typo'd `--quantity` staged a quantity-less LMT
order that committed clean) → strictObject + stage-time per-orderType
required-field gate. Bracket TP/SL legs were untracked from birth — the
ledger was blind to real protection on the exchange, and the held SL leg
is unrecoverable from listings → `PlaceOrderResult.legs` tracked through
the ledger. Plus sync-commit log rows now attribute per-update symbols
(was `unknown`). S2/S3/S4/S5/S6 all green after fixes; OCO leg-cancel
behavior (cancel one → venue kills both) verified and synced faithfully.

Round 7 (2026-06-12, IBKR paper first acceptance run): 5 findings, 2
pre-located by reading the adapter BEFORE connecting (do this for every
new broker). (1) `placeOrder(_tpsl)` silently ignored TP/SL — the okx
naked-entry species, gated with a loud refusal pre-test (native bracket =
parent/child + `legs`). (2) `getOpenOrders` unwired despite
the bridge primitive existing — 5-line wire-up; NOTE reqOpenOrders only
sees THIS clientId's orders, manual TWS-UI orders need reqAllOpenOrders +
permId identity (deferred). (3) By-conId quote → TWS error 321: reqMktData
won't resolve a bare conId even though the wire carries it — enrich via
reqContractDetails once + cache. (4) Account-cache delta semantics: TWS
pushes position DELTAS between accountDownloadEnd markers; the
swap-on-end cache showed a filled sell as still-held for minutes, zero-qty
(closed) updates were dropped entirely, and repeated updates duplicated
rows — upsert-by-conId into live cache + pending. Found by S8's restart
then cross-checking venue truth with an independent-clientId probe.
(5) `decodeContractProto` had an EMPTY `if (cp.secType !== undefined)`
body — a dropped assignment; every portfolio row violated the
IBKR-superset row contract with secType ''.
IBKR venue facts: modify keeps the SAME orderId (assert the inverse of
Alpaca); stops sit `PreSubmitted` (not terminal); paper quotes need
delayed data — full-protobuf REQ_MARKET_DATA_TYPE(3) + REQ_MKT_DATA still
got 10089 (entitlement question parked, price oracle = Alpaca AAPL quote
meanwhile); multi-currency books (HKD+USD) blind-sum at the BROKER layer
(`getAccount` + `aggregateAccountFromPositions`) remained a deferred
follow-up. S2/S4/S6/S8/S9/S11/S12 green; restart survival incl. TWS
reconnect verified.
