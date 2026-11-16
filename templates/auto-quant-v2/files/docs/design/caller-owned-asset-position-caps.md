# Caller-owned per-asset position caps

Status: implemented.

Related: [[docs/design/caller-owned-portfolio-research-policy]],
[[docs/design/request-bound-portfolio-mandates]],
[[docs/design/portfolio-construction-lab]],
[[docs/design/portfolio-decision-explorer]],
[[docs/design/rl-factor-policy-lab]], and
[[docs/design/program-research-dossiers]].

## Purpose

The collaborating workbench owns intended research exposure constraints;
AutoQuant owns reproducible signal-to-position mechanics.

```text
Research Request.portfolioPolicy.assetMaxAbsWeights
→ complete content-addressed Portfolio Mandate cap vector
→ shared Portfolio / governed-RL capped water-fill
→ immutable target, constraint, sizing, Report, and Dossier evidence
```

Candidate factor and encoder code cannot edit this chain.

## Request contract

A supplied complete `portfolioPolicy` adds:

```json
{
  "grossLimit": 0.8,
  "maxAbsWeight": 0.25,
  "assetMaxAbsWeights": {
    "AAPL": 0.12,
    "NVDA": 0.08,
    "SPY": 0.25
  },
  "annualizedVolatilityCeiling": 0.12,
  "baseCostBps": 15.0,
  "noTradeOneWay": 0.04,
  "referenceNav": 250000.0,
  "decisionSchedule": {
    "kind": "every-bars",
    "bars": 4,
    "anchor": "dataset-start"
  }
}
```

The map may be empty. Every key must be one of `request.assets`; every value
must be a finite non-boolean number in `(0, maxAbsWeight]`. An asset without an
override uses the global cap.

When `portfolioPolicy` is omitted, the reference default remains global
`0.30` with no overrides.

## Mandate contract

`construction.assetMaxAbsWeights` is a complete object keyed in exact research
universe order:

- each tradable asset receives its caller override or the global cap;
- each context-only asset receives `0.0`;
- no unknown or missing asset is allowed.

The scalar `construction.maxAbsWeight` remains the fallback and maximum
permitted value. The complete map, request hash, Mandate id, dependency hash,
Study input, Session authority, and Run identity all change together.

## Mechanical allocation

For one active side with positive strengths `s_i`, target budget `B`, and
individual caps `c_i`, the fixed allocator repeatedly assigns proportional
weights and freezes every name whose proposed weight exceeds its own cap:

```text
remaining proposal_i = s_i / Σs × remaining budget
if proposal_i > c_i:
    weight_i = c_i
    remove i
    remaining budget -= c_i
repeat
```

Directional families allocate up to `min(B, Σ active c_i)` and retain the
unfunded amount as cash. Dollar-neutral families require each side to fund its
exact fixed side budget; if either side's active cap capacity is insufficient,
the complete target stays flat.

The covariance risk governor remains one-sided and may only scale these
already-cap-compliant raw targets down. Drift may move a pretrade weight above
its cap, but the shared executed-book compliance step repairs the chosen book
even when no-trade or decision cadence would otherwise retain it. That repair
is included in exact turnover and cost accounting. Caps constrain both
proposed and final historical research weights, not live UTA holdings.

## Evidence

Portfolio and governed RL freeze:

- the complete cap vector inside the Portfolio Mandate;
- per-asset target cap and maximum excess in constraint evidence;
- active-side aggregate cap capacity and binding assets;
- each current asset's own cap, proportional pre-cap weight, raw target,
  covariance-governed target, executed historical research weight, and
  at-cap/cap-applied status.

Reports, Dossiers, CLI, and Studio must distinguish the global fallback from
named overrides. They retain `quantitative-decision-support` and
`tradingAuthority: none`.

## Invariants

1. Overrides name requested assets only.
2. Every tradable universe asset has one positive cap no greater than the
   global cap; every context-only asset has cap zero.
3. Water-filling uses the exact per-asset vector for every Portfolio and RL
   sleeve.
4. Proposed and final executed research weights never exceed named caps.
5. Directional unused capacity remains cash; dollar-neutral side underfunding
   remains flat.
6. Candidate code cannot tune caps or reinterpret zero as tradable authority.
7. Risk scaling may reduce but never increase a cap-compliant target.
8. A cap repair may override no-trade or cadence but may never add exposure.
9. Current executed weights remain historical research evidence, never a live
   holdings or order claim.

## Known limits

- This contract does not express minimum allocations, forced positions,
  hedge ratios, sector/factor exposure, or correlated group limits. Named sign
  permissions are separately owned by
  [[docs/design/caller-owned-asset-position-roles]].
- Caps are caller constraints, not estimates of optimal Kelly size, liquidity,
  expected return, or confidence.
- Any live-trading authority still owns account authorization and
  reconciliation against actual positions.
