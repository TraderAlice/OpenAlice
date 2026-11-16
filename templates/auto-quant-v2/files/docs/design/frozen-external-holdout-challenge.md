# Frozen external holdout challenge

Status: V2 implemented in `0.9.11`.

Related: [[docs/design/research-selection-integrity]],
[[docs/design/evidence-driven-research-agenda]],
[[docs/design/research-intake-and-dataset-snapshots]],
[[docs/design/program-research-dossiers]],
[[docs/design/study-run-evidence]], and
[[docs/design/quant-research-lifecycle]].

## Purpose

A positive validation result is not the end of research. After an Agent has
iterated against validation and repeatedly seen the Project's visible test
audit, the next credible question is whether the exact frozen research object
survives a later period that did not participate in those choices.

AutoQuant V1 already states that requirement but has no governed operation for
it. The external holdout challenge makes it a real Core object. It is not a
new strategy-search Project and not a live-trading approval.

## Lifecycle

```text
Source Project
  current immutable Dossier
  exact leader Run source closures
             │
             │ aq holdout create-target
             ▼
Target Project
  new compatible intake
  strictly later dataset
  no Runs / Sessions / Reports
  imported frozen candidate sources
  immutable holdout binding
             │
             │ aq holdout run
             ▼
  existing fixed Judges execute once
  immutable per-lane Runs
  immutable holdout result
             │
             │ aq holdout show / assess
             ▼
  verified bounded comparative evidence
  immutable Agent-authored Assessment
```

The preferred Agent path is one explicit atomic `aq holdout create-target`
operation. It takes a target Workspace/id and caller-supplied later dataset,
but derives request and lane authority from the current source Dossier. It
creates an ordinary research-desk target and binding together; it never
downloads data. The original two-step `project intake` plus `holdout bind`
route remains available for an already-created full-length target.

## Source authority

Binding accepts one source Project and one current completed Dossier. Core
loads and verifies the Dossier against its Reports and leader Runs. Included
lanes determine the challenge:

- Factor imports the exact frozen `factors/**` bytes from the Factor leader
  Run.
- Portfolio must name the same factor source identity as Factor. It receives
  no independent mutable copy.
- Governed RL, when included, imports exact frozen `models/**` bytes from the
  RL leader Run and requires the same frozen factor dependency.

The target binding stores a portable projection of source Dossier identity,
source dataset identity, per-lane Run/result/source/dependency hashes, and the
exact imported bytes with hashes. Later verification does not depend on the
source Project remaining mounted.

## Target compatibility

V1 fails closed unless:

- target template is the coordinated `ohlcv-research-desk`;
- target canonical request content exactly equals the source request;
- target asset class, universe, base interval, feature intervals, timestamp
  semantics, market clock, calendar, timezone, and aggregation contract match;
- target dataset starts strictly after the source dataset ends;
- dataset id/version/hash differ;
- the target has no Runs, Sessions, Reports, Dossiers, or prior binding;
- expected Factor/Portfolio and optional RL Study/Judge authority is current.

The exact-universe rule makes V1 a temporal stability challenge. Cross-universe
transfer, universe drift, and mixed-calendar research need different
interpretation and remain separate work.

Atomic target creation validates only the Dossier-included lane requirements:
Factor-only uses a 120-row floor and requires at least 20 fixed validation
observations after the primary horizon; Portfolio and governed RL raise the
floor to 180 and 240 rows respectively. Ordinary research-desk intake keeps
its 240-row/all-diagnostic-horizon policy. This distinction does not weaken a
new mining Project: the shorter target is bound before publication and cannot
start a Session or generic Run.

## Frozen behavior

After binding:

- editable source files are operationally frozen even though existing Study
  identity still calls them the subject source closure;
- `session start`, external Campaign creation, promotion, and candidate
  preflight/evaluation are unavailable;
- ordinary Project validation and read-only exploration remain available;
- any source, request, dataset, Study, Judge, dependency, or binding mutation
  invalidates the challenge before a Run starts.

The generic Run primitive remains the underlying evidence publisher, but the
public holdout operation owns the permitted lane set and one-shot result.
Repeated invocation returns the verified terminal result; it never creates a
new trial.

## Result

Every authorized later Run records
`execution.evaluationRole=external-temporal-audit`; ordinary Runs record
`research-selection`. A secondary diagnostic with fewer than 20 observations
is retained with `sufficient=false`, while target creation still requires the
exact primary objective to have at least 20 fixed validation observations.
Atomic creation writes this rule into the bound target's fixed Factor Judge
closure before any Run exists. It does not change the ordinary research
template or source Judge, and the holdout Run freezes the actual target Judge
bytes for reproduction.

The immutable result records:

- source Dossier and request identity;
- source and target dataset identity and non-overlap proof;
- binding hash and per-lane source/holdout Harness identity;
- for each lane, source Run/result/source identity, holdout Run/result/input
  identity, objective value and delta;
- terminal lane status and errors;
- authority:
  `evaluationRole=external-temporal-audit`,
  `candidateFrozen=true`,
  `selectionAllowed=false`,
  `automaticPromotion=false`,
  `tradingAuthority=none`.

Core does not manufacture a universal pass threshold. Factor IC, Portfolio
Sharpe, and RL aggregate objectives have different uncertainty and baseline
semantics. The terminal result therefore advances the target only to
`completed`, not to a finished research handoff.

`aq holdout show` builds one bounded verified comparison from the portable
source Dossier support and the exact later Runs. It preserves objective values
and deltas while also exposing the diagnostics needed to interpret them:
Factor primary/diagnostic horizon evidence and Portfolio post-cost/target-
translation context. An Agent should not need to reverse-engineer raw Judge
artifact shapes to answer the caller.

The Agent then publishes one immutable Assessment with `aq holdout assess`.
Its small analysis contract declares an overall `persists`, `mixed`,
`weakens`, or `inconclusive` interpretation and one ordered lane-specific
`strengthened`, `persisted`, `weakened`, or `inconclusive` judgment. Free-text
summaries, cross-lane interpretation, limitations, and recommendations remain
Agent-authored. Core validates shape and exact lane coverage; it does not claim
the judgment was mathematically derived.

The Assessment freezes normalized analysis, the Core-generated comparative
evidence, a deterministic Markdown handoff, and their hashes against the exact
result and binding. Only then does state become `assessed` and Orientation call
the required research handoff complete. Any later mutation of analysis,
evidence, Markdown, result, or binding fails verification. The Assessment
retains `universalPassThreshold=null`, disables selection and automatic
promotion, and grants no trading authority.

## Caller boundary

A local operator or collaborating Agent supplies the later dataset and target
Project identity, then receives the immutable challenge result as quantitative
decision support. OpenAlice is one possible host for that exchange. AutoQuant
does not authenticate the caller, place a live order, choose position size in
an authenticated account, or treat external-period survival as permission to
trade.

## Compatibility

Existing Projects, Runs, Reports, and Dossiers without holdout state remain
unchanged. A target becomes governed only when the binding file exists.
Malformed or partially written bindings, results, or Assessments are structured
validation failures, never silently ignored. A pre-`0.9.11` terminal result is
valid but remains `completed` until a current Agent publishes its Assessment.

## Known limits

- V1 is a same-request, same-universe, strictly later-period challenge.
- There is no hidden test server, encryption, or one-time secret reveal.
- Provider/corporate-action/point-in-time-universe truth remains caller
  authority.
- Cross-Project Report and model registries beyond this narrow Dossier import
  remain future work.
