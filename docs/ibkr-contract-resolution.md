# IBKR conId Contract Resolution

Status: completed

Started: 2026-07-17

Related contribution: [PR #345](https://github.com/TraderAlice/OpenAlice/pull/345)

## Why this work exists

UTA uses an IBKR `conId` as the broker-native identity for a tradeable leaf.
That is the correct uniqueness primitive for answering "which instrument is
this?", but it is not by itself a complete contract for every TWS request.
Quotation and order-routing requests may also require the instrument's
canonical `secType`, `exchange`, `currency`, `localSymbol`, or related fields.

Two earlier changes combined into a latent bug:

1. IBKR native-key resolution was simplified so a numeric Alice ID rebuilds a
   `Contract` containing only its `conId`. The assumption was that TWS could
   resolve the remaining contract fields from that identity.
2. The order path added `SMART` and `USD` as unconditional defaults for thin
   contracts. Those defaults are useful for hand-written US stock symbols but
   are not valid cross-asset defaults.

The combination did not send a bare conId to TWS. It sent a conId plus routing
metadata that could contradict the instrument identified by that conId.

The issue became user-visible after IBKR FX families were made discoverable as
conId-addressed leaves. The quote path had already gained a one-off
`reqContractDetails` enrichment, but the order path had not, so quote and order
behavior diverged.

## Live evidence

The failure was reproduced against IBKR paper TWS with the USD.CHF cash
contract (`conId=12087820`) using read-only contract-details probes:

| Request shape | TWS result |
| --- | --- |
| `{ conId: 12087820 }` | Resolves to `USD.CHF / CASH / IDEALPRO / CHF` |
| `{ conId, symbol: "USDCHF" }` | Resolves successfully |
| `{ conId, exchange: "SMART", currency: "USD" }` | Error 200: no security definition |
| Full canonical contract | Resolves successfully |

This shows that the display symbol is not the direct cause. The decisive fault
is attaching stock-routing defaults to a conId whose canonical contract is an
FX instrument on IDEALPRO.

No order was staged or submitted while establishing this evidence.

## Design invariant

The repair establishes this boundary inside `IbkrBroker`:

- `conId` identifies the instrument.
- A canonical IBKR `Contract` addresses that instrument for quotation or
  execution.
- When a conId is present, TWS contract details are authoritative. Resolution
  must query with a clean `{ conId }`; caller-supplied symbol, exchange,
  currency, and secType must not narrow or poison that lookup.
- `STK / SMART / USD` remains a convenience default only for a symbol-form
  stock request without a conId.
- Missing routing fields for other no-conId asset classes must not be guessed.

The resolver should cache canonical contracts by conId, deduplicate concurrent
lookups, discard failed cache entries so they can be retried, and return clones
so downstream code cannot mutate the cached canonical value.

## Implementation boundary

The same canonical resolver will be used by every IBKR path that sends a
contract to a TWS operation where routing fields matter:

- `placeOrder`
- `modifyOrder`
- `getQuote`
- `closePosition` through `placeOrder`

`closePosition` must stop overwriting the position contract's exchange with
`SMART`. A venue-returned position contract is already stronger evidence than
a generic stock default.

UTA may continue carrying the optional tool `symbol` for display in staged
operations during this repair. The IBKR boundary must treat it as
non-authoritative whenever a conId is present. Separating display metadata from
execution contracts across every broker is a larger model change and is not
required to close this defect safely.

## Non-goals

- Do not replace or broadly redesign the UTA abstraction in this change.
- Do not change Alice ID grammar or remove conId as IBKR's canonical leaf key.
- Do not add general pricing or market-selection policy to UTA.
- Do not merge or cherry-pick PR #345 as-is; it contains an unrelated
  Dockerfile commit and does not cover close-position or contradictory typed
  contracts.
- Do not use a real-money account for validation.

The architecture may deserve a separate review, but the current priority is to
restore a correct broker boundary and protect it with reproducible evidence.

## Regression and acceptance matrix

### Unit tests

- conId-only FX resolves to its canonical CASH contract before quote/order.
- conId plus display symbol follows the same path.
- contradictory SMART/USD fields are discarded before the clean conId lookup.
- symbol-form AAPL retains the STK/SMART/USD convenience path.
- quote and order share the conId cache; concurrent lookups are deduplicated.
- resolver inputs and cached canonical contracts are not mutated.
- a failed lookup is actionable and can be retried.
- FX close preserves IDEALPRO rather than forcing SMART.

### Non-trading E2E

The ordinary UTA lifecycle suite must continue to cover staging, commit, push,
ledger, and cleanup without configured broker accounts or external orders.

### IBKR paper E2E

The explicit live-paper lane will cover both layers that previously diverged:

1. Broker-level contract resolution and order validation, preferring an IBKR
   what-if order where it gives the same contract validation without
   transmission.
2. The real UTA identity path from FX search leaf through Alice ID, stage, and
   commit, followed by reject before push. Existing AAPL live-paper coverage
   owns the generic UTA push dispatcher; the broker what-if call proves that
   the FX contract accepted at the write boundary is canonical without
   transmitting an FX order.

The live run must record the pre-run position and open-order baseline, clean up
in `finally`, and prove the post-run state returned to that baseline. A failure
to prove cleanup stops the delivery lane.

## Smoke evidence and reusable fixtures

Live-paper smoke output is split into two forms:

1. An untracked per-run JSONL record under
   `data/uta-live-paper-runs/`, containing the Git commit, scenario, safe input
   fields, canonical contract fields, venue result/error, and cleanup result.
2. A reviewed tracked fixture containing only stable, non-account data for
   offline regression tests.

The reviewed fixture contains a US SMART/USD stock control, USD.CHF CASH on
IDEALPRO, and a SEHK/HKD equity. Volatile prices, timestamps, account
identifiers, balances, positions, credentials, and expiring derivative
identities do not enter tracked fixtures.

## Validation safety finding

An initial attempt to select only the new live-paper scenarios passed its file
arguments through the package script incorrectly and started the broader
live-paper catalog. It was interrupted before continuing across venues. The
existing broker-level IBKR fill tests had already exposed a separate safety
bug: two tests added shares independently and a later test called an
unqualified full-position close, so the suite could close a position that
existed before the run.

TWS execution records made the test-created quantity and the pre-run baseline
distinguishable. The paper account was restored to its exact pre-run positions
and zero open orders. The broker-level fill coverage is now one self-contained
scenario: it records the starting quantity and open-order ids, cancels any
introduced hanger in `finally`, closes only the positive quantity delta created
by the test, and asserts the exact baseline afterward.

Targeted live runs must invoke Vitest directly when selecting files or test
names; do not put an extra `--` between the live-paper config and the filters.

## Verification completed

- Canonical resolver unit suite: 20 passing tests, including the three recorded
  TWS contract fixtures.
- Full repository unit suite: 3,114 passing tests and 8 intentional skips.
- Non-trading UTA lifecycle E2E: 15 passing tests.
- IBKR paper USD.CHF polluted-contract what-if: accepted as canonical
  `CASH / IDEALPRO / CHF`, with exact position and open-order baseline restored.
- IBKR paper FX search/Alice ID/stage/commit/reject path: passed without push.
- IBKR paper AAPL write lifecycle: bought and closed only the test-created
  quantity, with the exact starting position and open-order set restored.
- Full non-trading E2E reached 32 passing tests; its only failure was an
  unrelated TLS `ECONNRESET` reaching `api.bls.gov`, explicitly classified by
  the provider layer as external network unreachability.

## Completion criteria

- The targeted regression tests fail before the repair and pass afterward.
- `npx tsc --noEmit`, `pnpm test`, and `pnpm test:e2e` pass.
- Targeted IBKR paper broker and UTA scenarios pass against a verified paper
  account.
- The live-paper run leaves no new open orders or position delta.
- The smoke record is written and a stable sanitized fixture is reviewed.
- The change is delivered to `dev` as a focused internal repair with the
  contribution in PR #345 credited in the final history or PR discussion.
