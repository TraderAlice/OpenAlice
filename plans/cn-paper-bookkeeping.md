# Plan: CN paper bookkeeping adjustment

**Status:** active — definition locked; implementation largely landed

**Owner guide:** [[docs/cn-local-paper.md]]

**Related:** [[docs/uta-live-testing.md]], [[docs/broker-packs.md]],
[`CnLocalPaperBroker`](../services/uta/src/domain/trading/brokers/mock/CnLocalPaperBroker.ts),
[`packages/uta-protocol/src/types/git.ts`](../packages/uta-protocol/src/types/git.ts)

**Delivery:** serial feature branch; target `dev`.
Do not open or merge a PR until the maintainer accepts the increment.

## Goal

Give CN Local Paper an auditable **账务调整** surface so users can align the
local paper book with a real broker App when simplified matching diverges —
without god-mode simulator controls and without fake market fills.

## Locked decisions

Recorded in [[docs/cn-local-paper.md]]. Summary:

| Decision | Choice |
|---|---|
| v1 scope | Single cash / position / T+1 adjustments **and** whole-book snapshot |
| Authority | Paper is truth after adjust; no dual-track external balance field in v1 |
| Persistence | Hard prerequisite before any product UI/API ships |
| Journal | Dedicated `paperAdjust*` / `paperSetSnapshot` ops — never `placeOrder` fills; not a misuse of `reconcileBalance` |
| Surface | UTA detail / account summary only for `cn-local-paper` |
| Agent | No default tool write; any later tool is explicit + confirm |

## Ordered work

### 0. Definition

- [x] Lock v1 scope: single adjustments + whole-book snapshot
- [x] Lock authority: paper is truth after adjustment
- [x] Lock persistence-before-UI prerequisite
- [x] Lock dedicated journal operation shape
- [x] Publish durable contract in [[docs/cn-local-paper.md]]

### 1. Persist CN paper broker runtime state

- [x] Design durable snapshot for cash, positions, avg cost, T+1 locks
      (pending LMT freezes intentionally omitted — open orders remain
      in-memory and do not survive restart)
- [x] Load/save via `data/trading/<utaId>/cn-paper-book.json` from UTAManager
- [x] Specs: export/import round-trip; file persister reload

### 2. Broker APIs for bookkeeping

- [x] Cash adjust (deposit / withdraw / fee-interest correction)
- [x] Position adjust (qty ±, optional avg cost) without order pipeline
- [x] Sellable / locked reclassification with `sellable + locked = total`
- [x] Whole-book `setSnapshot` replace semantics + open-order guard
- [x] Reject adjustments that would invalidate open sells / negative cash

### 3. Trading-as-Git journal

- [x] Add `paperAdjustCash` / `paperAdjustPosition` / `paperSetSnapshot`
- [x] `recordPaperAdjust` commit path with reason + `stateAfter`
- [x] Specs: log distinguishes paper ops; JSON round-trip

### 4. HTTP + UI product surface

- [x] UTA-owned `/uta/:id/paper/*` routes gated to cn-local-paper
- [x] UTA detail **调整账面** dialog (cash / position / sellable / snapshot)
- [ ] Browser acceptance on the real account route (manual residual)

### 5. Verification gate

- [x] UTA typecheck + hermetic bookkeeping / TradingGit specs
- [x] UI typecheck
- [x] Residual risk: browser walk of 调整账面 dialog not run in this increment

## Completion criteria

- Owner guide and this plan agree with shipped behavior
- Restart does not wipe adjusted books
- Adjustments appear as paper ops in the journal, never as synthetic fills
- Real broker UTAs cannot call the write path

## Non-goals (remain deferred)

Corporate-action calendar, IPO/fund full flows, mark/fill god-mode on the
product page, agent-default writes, dual-track external balance fields,
persisting open LMT orders across restart.
