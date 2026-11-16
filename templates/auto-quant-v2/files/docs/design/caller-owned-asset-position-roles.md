# Caller-owned asset position roles

Status: implemented.

Related: [[docs/design/request-bound-portfolio-mandates]],
[[docs/design/caller-owned-asset-position-caps]],
[[docs/design/signal-policy-and-attribution]],
[[docs/design/rl-factor-policy-lab]], and
[[docs/design/program-research-dossiers]].

## Purpose

The collaborating workbench owns which assets may become historical research
positions. AutoQuant owns one reproducible factor-to-position mechanism inside
those permissions.

```text
Research Request.assets[].positionRole
→ complete content-addressed Portfolio Mandate role vector
→ shared Portfolio / governed-RL state and sizing constraints
→ immutable role, signal, target, and handoff evidence
```

This is a research-position contract. It is not a Broker permission, UTA
authorization, order instruction, or recommendation to establish a hedge.

## Request contract

Each requested asset may optionally add exactly one `positionRole`:

- `long-only`: may be flat or long;
- `short-only`: may be flat or short;
- `two-sided`: may be flat, long, or short;
- `context-only`: participates in research inputs but must stay flat.

If any requested asset declares a role, every requested asset must declare
one. This avoids silently filling a missing permission. If none declares a
role, Core derives the current behavior from global `request.direction`.

At least one explicitly declared asset must be position-capable. Global
direction remains a description of the question; it does not silently widen
an explicit role.

## Mandate contract

`construction.assetPositionRoles` is complete over the dataset research
universe. Requested assets receive their explicit or direction-derived roles.
Unrequested dataset assets always receive `context-only`.

`source.assetPositionRoles` records `caller-supplied` or
`direction-derived`. An explicit role vector uses construction family
`asset-role` and net rule `bounded-by-side-limits`.

Core derives immutable side limits:

- only long-capable assets: `longGrossLimit = grossLimit`,
  `shortGrossLimit = 0`;
- only short-capable assets: `longGrossLimit = 0`,
  `shortGrossLimit = grossLimit`;
- both capabilities: each side limit is `grossLimit / 2`.

The two limits are maximums, not targets. Each active side allocates only up
to its own limit and caller-owned per-asset caps. Missing signals or cap
capacity remain cash. The contract does not force a hedge or claim net
neutrality.

When the caller omits `benchmarkPolicy`, explicit `long` and `short` requests
use an equal-weight benchmark over only the assets capable of that sign.
Explicit `long-short` and `relative-value` requests use cash. This prevents a
short-only hedge asset from silently entering an equal-weight long reference.
An explicit caller benchmark still changes evaluation only.

The fixed Allocation Lab may use a requested `context-only` asset in its
separately funded fixed-weight reference. That reference role does not admit
the asset to ERC candidate covariance targets, caps, positions, or component
risk contributions.

Direction-derived `long-cash`, `short-cash`, and `dollar-neutral` families
retain their existing exact semantics. Their complete role vector merely makes
the already-existing permissions explicit.

## Mechanical construction

Signal transition is selected per asset:

- `long-only` uses long entry/exit hysteresis;
- `short-only` uses short entry/exit hysteresis;
- `two-sided` uses the existing long/short reversal state machine;
- `context-only` stays flat with `signal_event=context_only`.

For `asset-role`, positive and negative active strengths are independently
water-filled up to their immutable side limits and per-asset caps. One side
may remain partly or completely unused without flattening the other side.

The covariance governor remains one-sided and may only scale a compliant
target down. Drift, no-trade, final-book repair, accounting, and costs retain
their existing contracts.

## Governed RL and evidence

Every fixed factor sleeve is constructed through the same Mandate before RL
can select it. RL cannot choose a forbidden sign, activate a context-only
asset, alter side limits, or infer a hedge.

The complete Mandate, signal ledger, constraint audit, Explorer, Reports,
Dossiers, CLI, and Studio disclose:

- role source and complete role vector;
- long and short gross-side limits;
- each asset's role, signal event, cap, and historical research target;
- unused capacity and `tradingAuthority: none`.

## Invariants

1. Partial explicit role declarations are invalid.
2. Unrequested dataset assets are always context-only.
3. A role never grants a sign beyond its exact enum.
4. Explicit side limits are immutable Core derivations, not candidate knobs.
5. Unused side capacity remains cash; no position or hedge is forced.
6. Portfolio and governed RL consume the same complete role vector.
7. Candidate code cannot edit, infer, or optimize roles.
8. No role represents live account, borrow, margin, or order authority.
9. Fixed-reference membership never upgrades `context-only` candidate
   authority.

## Known limits

- There is no beta-neutral, factor-neutral, sector-neutral, currency-neutral,
  duration-neutral, or delta-neutral hedge ratio.
- There are no minimum allocations, forced positions, group limits, borrow
  checks, financing, margin, or derivative contract semantics.
- Global direction and explicit roles may describe a nuanced question, but
  AutoQuant does not judge whether the caller's hedge specification is
  economically sufficient.
