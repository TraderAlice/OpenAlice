# CN Local Paper

This guide owns the product contract for the built-in `cn-local-paper`
preset: what the local A-share paper account is, what it deliberately is
not, and how **账务调整 (bookkeeping adjustment)** behaves.

Related code: [`CnLocalPaperBroker`](../services/uta/src/domain/trading/brokers/mock/CnLocalPaperBroker.ts),
[`MockBroker`](../services/uta/src/domain/trading/brokers/mock/MockBroker.ts),
preset [`CN_LOCAL_PAPER_PRESET`](../packages/uta-protocol/src/brokers/preset-catalog.ts).
Related testing: [[docs/uta-live-testing.md]]. Implementation plan:
[[plans/cn-paper-bookkeeping.md]].

## What it is

CN Local Paper is a **free, in-process A-share paper** for OpenAlice closed-loop
dry runs. Marks come from public Tencent L1 (delayed). Matching and account
state live inside UTA's mock engine. It is **not** a broker virtual account and
must not be treated as market-quality evidence.

Enforced today (when the matching flags are on): lot size 100, settlement-aware
sell lock (T+1 for A-share stocks / equity ETFs; T+0 for verified and
heuristic same-day instruments — see [`cn-settlement.ts`](../services/uta/src/domain/trading/brokers/mock/cn-settlement.ts)),
±10% limit band, session hours, commission and stamp-tax cash debits on fill.

## Persistence and product surface

Preset config persists starting `cash` in `accounts.json`. Runtime cash,
positions, avg cost, and today's buy lock (`boughtToday`) persist under
`data/trading/<utaId>/cn-paper-book.json` and reload on UTA init. Pending
LMT orders and their cash freezes remain in-memory and clear on restart
(same as the underlying MockBroker open-order map).

Mock simulator HTTP (`/api/simulator/*`) only accepts `instanceof MockBroker`.
`CnLocalPaperBroker` wraps MockBroker, so the `/dev/simulator` control panel
does **not** drive CN paper. Product bookkeeping uses UTA-owned
`/api/trading/uta/:id/paper/*` routes and the UTA detail **调整账面** dialog.

## Product name and scope

| Term | Meaning |
|---|---|
| 账务调整 / bookkeeping adjustment | Auditable correction of the paper book to match an external truth the user already knows |
| Not | God-mode simulator (force fill, tick marks, bypass limit band / session) |

**Applies to:** `cn-local-paper` only (and future peers that are the same class
of local paper). Real brokers and broker-hosted virtual accounts stay
broker-authoritative; OpenAlice must not invent a parallel write path there.

**Purpose:** Local matching is a simplified model. Real accounts see deposits,
bonus shares, IPO allotment, commission differences, and sellable ≠ total
quantity. The user records the **net effect** on the paper book — not a fake
market order through the place→commit→push pipeline.

## Locked decisions (v1)

These decisions are accepted for the first implementation increment. Changing
them requires updating this guide and [[plans/cn-paper-bookkeeping.md]] in the
same change.

### 1. First-cut operation set: single adjustments **and** whole-book snapshot

v1 ships both:

1. **Cash** — deposit / withdraw; fee or interest correction (commission /
   stamp-tax / interest delta). No full sell-settlement cash calendar in v1.
2. **Position** — add / remove shares (bonus, transfer, allotment). Optional
   avg-cost edit. Default for inbound: user-supplied cost or current mark.
   Bonus-style inbound may leave cost un-diluted when the user chooses that.
   Never routed through the order pipeline.
3. **T+1 / sellable** — expose total, locked (bought today), sellable. User may
   reclassify shares as “prior-day sellable” or “today locked”. Invariant after
   every adjustment: `sellable + locked = total`, and open sell orders must not
   oversell.
4. **Whole-book snapshot** — one submit of cash + position list + per-symbol
   sellable. Used to seed or realign against a broker App. Distinct from
   “reset to create-time cash” (experiment wipe).

Every adjustment requires a short reason, a confirmation summary of fields that
will change, and a paper-only warning.

### 2. Authority: paper is truth after adjustment

After a successful adjustment, the CN paper broker state **is** the account
truth for portfolio, equity, and subsequent matching. v1 does **not** keep a
parallel “external broker balance” comparison field. Dual-track display is a
later product if needed.

### 3. Persistence is a hard prerequisite

Runtime cash, positions, avg cost, and `boughtToday` persist under
`data/trading/<utaId>/cn-paper-book.json` and reload on UTA init. Adjustment
events land in Trading-as-Git (`commit.json`) via dedicated paper ops.
Pending LMT orders still do not survive restart.

### 4. Journal shape: dedicated paper ops, never fake fills

Do **not** reuse `placeOrder` or dress adjustments as fills. Prefer dedicated
Trading-as-Git operation actions, for example:

- `paperAdjustCash`
- `paperAdjustPosition`
- `paperSetSnapshot`

(Exact action names may be refined at implementation time; the discriminant
must remain paper-bookkeeping, not order lifecycle.)

`reconcileBalance` remains the wallet/external-observation path for generic
mock/CCXT-style gaps. CN paper bookkeeping is an explicit human correction with
reason text, not an observed mark-price synthesis.

Order history stays “what the simulated venue did.” Adjustment history stays
“what the human aligned to an external book.” Portfolio and equity curves read
the broker state **after** adjustments.

## Explicitly out of v1

- Corporate-action calendar (auto ex-dividend / split math)
- IPO subscription in-flight, convertible bond, on-exchange fund subscribe/redeem
  full flows
- Changing marks, forcing fills, or toggling T+1 / limit band / session (those
  are broker/config switches or simulator god-mode, not bookkeeping)
- Agent-default write access (any future tool must be explicit and confirmation-
  gated UTA write)
- Surfacing `/dev/simulator` god-mode on the product UTA account page

## Interaction placement (definition only)

Show **调整账面** only on the CN Local Paper UTA detail / account summary.
Keep it out of the shared order-entry dialog. Leave `/dev/simulator` for pure
`MockBroker` instances.

## Verification expectations (when implementing)

- Hermetic broker/unit specs for each adjustment invariant (cash, qty, cost,
  sellable/locked, open-sell guard).
- Persistence round-trip: adjust → restart UTA → state and journal agree.
- UI: only `cn-local-paper` shows the surface; real brokers never get the write
  path.
- Do not treat Tencent marks or paper fills as live-broker acceptance evidence;
  see [[docs/uta-live-testing.md]].
