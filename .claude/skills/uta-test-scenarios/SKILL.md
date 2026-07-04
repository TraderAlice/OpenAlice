---
name: uta-test-scenarios
description: Run the UTA live-testing scenario catalog (S1-S14) on demo accounts via the alice-uta CLI. Use after ANY change to trading paths; run the full catalog plus the acceptance checklist for a new broker integration. Triggers: "UTA live testing", "S1-S12", "S1-S14", "trading-path verification", "broker acceptance".
---

# UTA Live Testing — the self-bootstrapped scenario catalog

> **Canonical source: [docs/uta-live-testing.md](../../../docs/uta-live-testing.md).**
> This skill is the operational digest; when the two diverge, the doc wins —
> update both together when adding scenarios or venue facts.

Five dogfood rounds (2026-06-12) surfaced ~20 real bugs that no unit test and no human UI session would catch — they only appear on the real usage path, through the agent surface, against real venue behavior (SDK shape drift, TP/SL the ledger showed but the exchange never received, 19-digit order ids float-truncated, getOrders crashing only in the split-process path).

**The method**: an AI session walks REAL trading workflows end-to-end on the demo accounts, exclusively through the agent surface (`alice-uta` CLI), fixing what it hits and adding a regression spec per fix.

## Ground rules

- **Demo/paper accounts only.** Verify `mode` in the account config before starting. No real funds, ever.
- **Agent surface only** — drive everything through `alice-uta` (and `alice` for pre-trade data). Exception: `wallet/push` over HTTP stands in for "the user clicked approve" (the tool-level push deliberately refuses — that wall is a feature).
- **Never trust the ledger over the venue.** After any order that matters, verify on the exchange side — a probe script via `createBroker()` + raw ccxt calls is legitimate.
- **ccxt is an SDK, not a semantic layer.** Identical calls behave differently per venue (bybit unscoped open-orders hides spot; okx rejects `reduceOnly` on spot; conditional orders live in separate API namespaces). Working on one venue = UNVERIFIED on the next.
- **Leave accounts flat.** Sell back fills, cancel hangers, `git reject` stray staging. Finish with 0 open orders, `git status` clean, positions at pre-session baseline.
- **Price bands**: for marketable orders use quote ±0.3%; for hangers use deep prices the band allows (~15-30% away on okx/bybit demo). Re-quote right before pushing.
- Every bug found: fix in place if in scope, else Linear (`TODO from AI Code`). Every fix gets a regression spec before the round continues.

## Setup

```bash
export OPENALICE_MCP_URL=http://127.0.0.1:47332/mcp
export AQ_WS_ID=<any live workspace id>     # from ~/.openalice/workspaces/workspaces.json
BIN=src/workspaces/cli/bin/alice-uta
node $BIN                                    # discover groups/verbs
node $BIN order place --help                 # flags come from the manifest
# "user approves": curl -s -X POST http://127.0.0.1:47333/api/trading/uta/<id>/wallet/push
```

Probe scripts (external orders, raw venue checks) live as throwaway `.mts` files under `data/` (gitignored), run with `NODE_OPTIONS='--conditions=openalice-source' npx tsx data/<file>.mts`, importing `readUTAsConfig` + `createBroker`. Delete after use.

## Scenario catalog

Run S1–S12 for a trading-path change; run ALL (S1–S14) per venue for a new broker integration. Each scenario names the bug class it guards against.

**S1 — Read-state agreement.** `account info`, `account portfolio`, `/equity`: account-level unrealizedPnL must equal the positions sum; portfolio rows must carry `secType` + `aliceId` (same-symbol spot vs perp distinguishable AND actionable). *Guards: PnL aggregation drift, ambiguous rows.*

**S2 — Simple lifecycle.** Marketable limit (quote×1.003) → fill appears as a `[sync]` commit within ~15s with execution price+qty → `order trades` shows it → sell back. *Guards: fill-awareness, execution data loss.*

**S3 — Hanger stability.** Deep limit order, leave it ≥3 poller passes (~40s): must stay `Submitted`, no spurious transitions, no per-pass cost explosion → cancel, verify `cancelled` recorded. *Guards: absence-as-terminal false positives, poller churn.*

**S4 — Amendment.** Hanger → `order modify` (price AND qty) → `order list` must show the new values with the SAME full-precision string orderId → cancel. *Guards: editOrder venue quirks, id truncation.*

**S5 — Attached TP/SL.** `order place … --takeProfit '{"price":…}' --stopLoss '{"price":…}'`. On a ccxt venue WITHOUT a verified `placeOrderWithTpSl` override this must REFUSE loudly (never place a naked entry). On a verified venue: after fill, confirm BOTH protective legs exist on the exchange — including the trigger/algo namespace. On a native-bracket venue (Alpaca): the push result must carry `legs` ids and `order list` must show BOTH legs tracked; the held SL leg never appears in the venue's open-orders listing — place-time is the ONLY moment Alice can learn it exists. *Guards: silent unprotected-position (okx) and the naked ledger (alpaca).*

**S6 — Standalone stop.** `STP` with a far trigger → accepted → tracked as `submitted` across passes even though algo orders are invisible to the regular listing (absence-confirm must use the `{stop:true}` fallback, NOT mis-terminal it) → cancel through Alice. *Guards: conditional order type mapping, algo-namespace tracking.*

**S7 — External order observation.** Place an order via a direct broker probe (git never sees it) → `[observed]` commit within the observation cadence (`trading.json observeExternalOrdersEvery`; drop to `1m` for the test via `PUT /api/config/trading`, restore after) → pending takeover → cancel through Alice. *Guards: narrative holes, listing namespace blindness.*

**S8 — Restart survival.** With a hanger pending: restart UTA (`touch services/uta/src/main.ts` under tsx watch) → after recovery the order is still tracked, syncable and cancellable (persisted localSymbol must rebuild the broker's id→symbol cache). *Guards: in-memory cache dependence.*

**S9 — Partial close.** `position close --qty <half>` on a SPOT position (must NOT send reduceOnly) and on a perp (must send it) → fill recorded, remaining qty correct. *Guards: derivatives params leaking onto spot.*

**S10 — Notional entry.** `order place --orderType MKT --cashQty 30` → fill qty ≈ cash/price and trade value ≈ cash. *Guards: amount-vs-cost semantics, conversion drift.*

**S11 — Error ergonomics.** Deliberately: bad aliceId format, unknown `--source`, out-of-band limit price, modify of a nonexistent id. Every error must be actionable for an agent: expected format / available accounts / the venue's own message (not a bare HTTP code). *Guards: stranded-agent errors.*

**S12 — Staging undo.** Stage → `git reject --reason …` → status clean, history shows `user-rejected` with reason; a `--commitMessage` one-step ends in `awaitingApproval` and rejects cleanly too. *Guards: approval-flow dead ends.*

**S13 — Hub/leaf identity (directory-style search venues).** Search must classify rows: LEAVES carry a tradeable aliceId; DIRECTORIES (bond issuers, FX families) are `expandable: true` and their aliceId must REFUSE quote/trade pointing at `contract expand`. Expand each hub kind; every leaf must round-trip aliceId → quote (or a LOUD entitlement error) → place/track/cancel. *Guards: symbol-key-assumes-STK mis-resolution, unaddressable directory rows.*

**S14 — Derivative position signs & units (four-combo matrix).** Open all four option combos the venue allows (long/short × call/put). For EACH leg verify on EVERY surface (portfolio tool, UI, simulator): `side` correct; `avgCost` and `marketPrice` in the SAME unit (IBKR reports 103 for an option bought at 1.03); `unrealizedPnL` sign matches the side; equity moves the right direction. Then `sim price-change` on the UNDERLYING: derivative rows must be excluded loudly, never re-marked with the stock's price. *Guards: unit-mismatched cost basis, symbol-collision re-marking, sign inversion.*

## New-broker acceptance checklist (beyond S1–S14)

- `getOpenOrders` must SEE a real open order you placed — empty-without-error is the silent failure mode. Sweep every market type; throw on partial listings.
- Order ids round-trip as STRINGS end-to-end (place → list → modify → cancel → history).
- Fees: an in-kind-fee venue (buy ETH, fee in ETH) must show the dust as a `reconcile` trade, not corrupt cost basis.
- Conditional orders: document where they live (regular vs trigger namespace) in the venue's `exchanges/<name>.ts` override — the canonical home for every quirk.
- Bracket/attached orders: child order ids must return via `PlaceOrderResult.legs` so the ledger tracks them from birth — including legs the venue HIDES from open-orders listings.
- Amendment identity: does modify keep the order id or mint a new one (Alpaca replaceOrder does)? The NEW id must be tracked and the OLD id must resolve.
- Venue error messages must reach the user (no swallowed response bodies — Alpaca opaque-422; IBKR >=2000 "informational" blanket).
- Read the adapter BEFORE connecting — round 7 pre-located 2 of 5 findings that way.

## Scoreboard (why this method earns its cost)

Rounds 1–5 (okx/bybit/alpaca demo): ~20 bugs across PRs #325–#333. Round 5 found zero new product bugs — the catalog converges. Round 6 (alpaca): CLI gateway silently stripped unknown flags → strictObject + stage-time gate; bracket legs untracked from birth → `PlaceOrderResult.legs`. Round 7 (IBKR paper): TP/SL silently ignored → loud refusal gate; getOpenOrders unwired; by-conId quote error 321 → enrich via reqContractDetails; account-cache delta semantics → upsert-by-conId; empty `if` body dropped secType. IBKR facts: modify keeps the SAME orderId; stops sit `PreSubmitted`; paper quotes need delayed data; multi-currency books blind-sum at the broker layer (ANG-101).
