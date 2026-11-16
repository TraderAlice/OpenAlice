---
name: package-autoquant-ohlcv
description: Audit provider-acquired OHLCV, choose the narrowest truthful AutoQuant V1-V6 package contract, materialize exact exchange-calendar daily closes from date-only V4 into V5, compose complete compatible V5 packages from distinct providers into V6, create a confined provenance-honest dataset manifest, and complete strict Project intake and validation. Use after any market-data provider acquisition, for cross-market or multi-provider packaging, or when repairing an external dataset package before AutoQuant research.
---

# Package AutoQuant OHLCV

Convert acquired evidence into a strict AutoQuant input without promoting
provider claims into authenticated facts.

## Inspect before packaging

1. Read [package-contracts.md](references/package-contracts.md).
2. Keep the manifest at the common ancestor of its relative asset files.
3. Run:

```bash
aq-python scripts/audit_ohlcv_package.py \
  --package /absolute/path/dataset-package.json \
  --write-audit /absolute/path/package-audit.json
```

4. Resolve every error. Do not forward-fill, change adjustment, align away
   observations, or rename venues merely to satisfy intake.
5. Inspect the exact public schema when creating or repairing a manifest:

```bash
aq schema ohlcv-dataset-package --json
```

When two independent routes cover the same assets, compare them before
selection:

```bash
aq-python scripts/compare_ohlcv_packages.py \
  --left /absolute/path/source-a/dataset-package.json \
  --right /absolute/path/source-b/dataset-package.json \
  --write-audit /absolute/path/source-comparison.json
```

Require the same price-adjustment claim for a numerical comparison. Inspect
date coverage, latest common observation, price differences, volume ratios,
and each provider's raw audit before choosing a route. Agreement does not turn
two unofficial sources into venue authority.

When adjustment claims differ, compare coverage only and preserve the
incompatibility explicitly:

```bash
aq-python scripts/compare_ohlcv_packages.py \
  --left /absolute/path/raw/dataset-package.json \
  --right /absolute/path/adjusted/dataset-package.json \
  --mode coverage-only \
  --write-audit /absolute/path/coverage-comparison.json
```

Coverage-only reports dates, row counts, overlap, freshness, and zero-volume
counts. It deliberately emits no price or volume comparison.

## Choose the contract

- V1: aligned completed daily session panel.
- V2: continuous UTC 1h base with deterministic completed higher intervals.
- V3: configurable continuous or XNYS regular-session base interval.
- V4: observed-only ragged daily Factor input.
- V5: close-time-aware observed base-bar Factor input through `1d`, with one
  temporal target and optional mixed-class asynchronous context.
- V6: the same observed Factor semantics with each asset bound to one of at
  least two content-addressed V5 source packages and distinct provider claims.

Choose the narrowest contract that describes the acquired bytes. A provider
claiming an interval or calendar does not prove the corresponding AutoQuant
contract.

## Materialize exact daily close times

When one V4 package contains date-only observed daily rows from multiple
session markets, do not append a nominal hour or write a private conversion
program. First obtain explicit per-asset calendar authority, then use the
bundled deterministic procedure:

```bash
aq-python scripts/materialize_daily_close_time.py \
  --source-package /absolute/path/v4/dataset-package.json \
  --authority /absolute/path/daily-close-time-authority.json \
  --output /absolute/path/v5-close-time
```

Read the complete authority format and constraints in
[package-contracts.md](references/package-contracts.md). The authority must
bind the exact source package id, version, and SHA-256; name every asset's
canonical `exchange_calendars` calendar and exact timezone; pin the installed
calendar-library version; and declare truthful V5 volume semantics. Do not
infer those fields from a symbol or venue.

The output directory must be absent. On success, inspect both
`dataset-package.json` and `close-time-audit.json`. The audit binds every
source/output hash, scheduled-close transition, row count, and OHLCV
preservation claim. The procedure never aligns, fills, drops, repairs, or
changes an OHLCV value. Unknown calendars, timezone mismatches, non-session
dates, inventory drift, unsafe paths, or an occupied output fail without a
partial package.

This route treats the pinned calendar schedule as explicit research authority,
not an authenticated exchange record. It does not reconstruct unscheduled
halts or provider corrections. Run `audit_ohlcv_package.py` again on the V5
output, then complete strict Factor intake.

## Compose distinct observed sources

When one Factor question needs assets acquired from distinct providers, do not
rewrite several provider claims as one top-level provider and do not hand-edit
a merged manifest. First make every source a complete, independently audited,
strict V5 package. Then bind the exact source manifests in one composition
authority and run:

```bash
aq-python scripts/compose_observed_packages.py \
  --authority /absolute/path/observed-package-composition.json \
  --output /absolute/path/v6-multi-source
```

Read the exact authority in
[package-contracts.md](references/package-contracts.md). Sources must have
disjoint symbol inventories, distinct manifest hashes and at least two
distinct provider claims. Their base interval, completed-close semantics,
panel policy, observed UTC market, and price-adjustment claim must match.

The procedure includes every asset from every source and copies asset bytes
unchanged. It never subsets, aligns, fills, transforms, resolves symbol
conflicts, or changes adjustment. Inspect `composition-audit.json`, run
`audit_ohlcv_package.py` on the V6 output, and complete strict Factor intake.
Any incompatibility, unsafe path, symlink, hash drift, or occupied output fails
without a partial package.

## Preserve provenance

- Use the original known provider retrieval timestamp or JSON `null`.
- Keep provider, source URI, terms claim, market, venue, currency, adjustment,
  volume, and timestamp semantics explicit.
- Use per-asset classes on every asset or omit them from every asset.
- Keep paths POSIX-relative descendants; reject absolute paths, `..`, and
  symlinks.
- Preserve acquisition and package audits beside staging bytes.

## Intake

Only after the English research brief and strict Research Request agree:

For a new research body, create its Project-root authority:

```bash
aq project intake <workspace> <project-id> \
  --request /absolute/path/research-request.json \
  --dataset /absolute/path/dataset-package.json \
  --json
aq validate <workspace> --project <project-id> --json
aq orient <workspace> --project <project-id> --json
```

For a distinct fixed question that belongs inside an existing Project, keep a
complete task-local package and create one Study-owned authority in the same
operation:

```bash
aq study create <workspace> <study-id> \
  --project <project-id> \
  --subject-kind research \
  --judge <project-relative-judge.py> \
  --judge-path '<project-relative-judge-closure>' \
  --no-editable \
  --metric <primary-metric> \
  --request /absolute/path/research-request.json \
  --dataset /absolute/path/dataset-package.json \
  --json
aq validate <workspace> --project <project-id> --json
```

Add fixed method files with repeatable `--dependency`. Add prior immutable
evidence only with an exact `--upstream-run` plus repeatable
`--upstream-artifact`. Do not pass manual dataset identity flags with external
`--request/--dataset`, impersonate a specialized template, inspect installed
AutoQuant source, or write a private materialization script. This generic route
accepts aligned V1-V3 packages; V4-V6 remain Factor-only.

Return the Project id, content-locked snapshot identity, source hashes,
coverage, unresolved provider limitations, and no trading authority. A valid
package proves structural admission, not provider correctness.
