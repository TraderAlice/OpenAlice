# Program research dossiers

Status: implemented.

Related: [[docs/design/quant-research-lifecycle]],
[[docs/design/agent-native-quant-workbench]],
[[docs/design/research-program-orchestration]],
[[docs/design/request-bound-portfolio-mandates]],
[[docs/design/portfolio-risk-governor]],
[[docs/design/portfolio-liquidity-capacity]],
[[docs/design/research-selection-integrity]],
[[docs/design/studio-observation-surface]], [[docs/PROJECT_FORMAT]], and
[[docs/CLI]].

## Scope

This document owns the immutable Project-level answer produced by a canonical
multi-Study Research Program. A Research Dossier synthesizes lane Reports for
one content-locked Research Request and dataset.

It does not own lane evaluation, candidate selection, Agent research, optional
host delivery, authenticated origin, account state, live orders, or trading
authority.

## Composition boundary

The evidence hierarchy is:

```text
Run / Experiment / Campaign
→ delegated Session Report
→ Project Research Dossier
→ local review or optional host delivery
```

A lane Report already freezes and verifies the request, Brief, Session leader,
Study/Harness/dataset locks, Run metrics and artifacts, Experiment/Campaign
prefix, Project-wide research-family history, selection adjustment, findings,
and limitations. The Dossier cites these Reports and their finding ids. It
never re-evaluates raw Runs, resets search history, or invents a cross-lane
score.

Factor is always required. Portfolio becomes required only when the frozen
Factor Report proves that its exact leader reached
a request-bound claim-positive stage with passing family-wise selection
adjustment. Governed RL is always optional and becomes
admissible only after the frozen Portfolio Report proves
`post-cost-edge-positive`.

This makes an upstream rejection a complete, useful answer. A Factor-only
Dossier can freeze a weak-factor early stop; a Factor-plus-Portfolio Dossier
can freeze a post-cost portfolio rejection without manufacturing an RL
experiment. Gated or optional lanes without current Reports are frozen as
omitted with their admission reason. An already-produced downstream Report can
remain included as optional historical context, but it does not make that lane
required or override the gate.

## Readiness

`aq dossier status` is the Agent discovery surface. Readiness requires:

1. verified request-driven Project intake;
2. the canonical Factor → Portfolio → RL Research Program;
3. no Program identity or shared-source violation;
4. a delegated Session for every dynamically required lane;
5. a verified Report whose frozen leader equals that Session's current leader;
6. a leader Run whose Study input, dataset, source, and fixed dependency
   identities equal the current lane Study;
7. the same content-locked Project request in every included Report.
8. Portfolio and included governed-RL leader Runs use the same fixed Portfolio
   Mandate; RL factor-dependency comparison uses only the `factors/**` subset
   of its multi-input dependency closure.

Required-lane admission is reconstructed from the immutable frozen upstream
Report, not from mutable latest state. Factor is required unconditionally;
Portfolio is required only when the frozen Factor qualification is available
and positive. RL remains optional. This rule lets published early-stop
Dossiers remain verifiable after later research changes the Project.

Readiness is a publication-time condition. A published Dossier is a valid
point-in-time snapshot when later research adds evidence or changes the current
leader, just as an older lane Report remains valid.

When its frozen evidence hash still equals the current publication evidence,
the latest Dossier is also the terminal Agent handoff for that Project state.
This applies equally to full multi-lane synthesis and a gated Factor-only early
stop. `aq orient` does not reinterpret a downstream gate as unfinished work or
require another Session after that handoff; it offers exact Dossier inspection
and labels any later hypothesis as optional. If current evidence changes, the
older Dossier remains verifiable history but no longer suppresses the new
Program lifecycle.

The status object exposes every lane, blockers, omission reasons, the current
Report/finding catalog, latest Dossier, and exact next headless action. It is
read-only and does not author analysis.

## Analysis contract

The Agent supplies `autoquant-research-dossier-analysis`:

- title and executive summary;
- findings with confidence and non-empty Dossier evidence references;
- conditional recommendations;
- limitations and unresolved questions.

Each evidence reference contains:

- canonical `laneId`;
- exact `reportId`;
- optional `findingId`.

The Report id must be the included current Report for that lane. A non-null
finding id must exist in its verified analysis. At least one finding reference
must cover every included lane. Recommendations cannot introduce evidence that
is not part of the frozen lane catalog.

## Immutable artifact

Publication creates:

```text
dossiers/
└── dossier-<timestamp>-<hash>/
    ├── analysis.json
    ├── dossier.json
    ├── dossier.md
    └── manifest.json
```

The Project manifest remains V1-compatible; `dossiers/` is a reserved,
optional, confined Project root created on first publication. Symlinks and
non-file entries are rejected.

`dossier.json` freezes:

- Project identity and publication time;
- authority `quantitative-decision-support` and `tradingAuthority: none`;
- exact request plus request hash;
- dataset snapshot plus manifest/content hashes;
- canonical Research Program manifest plus hash;
- every included lane's Study identity;
- Report id/hash, analysis/evidence hashes, Session id, title, summary,
  findings, selection integrity, Harness, and the Report's exact optional
  leader-decision-support snapshot;
- leader Run id/hash, subject/source/dependency identity, objective, metrics,
  artifacts, and dataset;
- request-derived Portfolio Mandate identity, including its fixed
  covariance/volatility policy, and complete frozen metrics for every
  applicable lane;
- Portfolio leader timestamp, state transitions, next percentile conditions,
  raw/governed/pretrade/executed weights, turnover/risk gate, and decision
  hash when the included Report contains that snapshot;
- Portfolio sizing-anatomy identity, side budgets, conviction/inverse-volatility
  strengths, proportional and cap/water-fill weights, governed/executed
  weights, and diagonal/covariance risk decomposition when the included
  Report contains that snapshot;
- Portfolio diversification-stress identity, effective risk bets, current
  25% / 50% / 100% correlation-breakdown ladder, split ceiling-breach rates,
  and per-asset component/stress-risk shares when the included Report contains
  that snapshot;
- Portfolio strategy-viability identity, validation-only failure stage and
  research focus, gross-to-net wedge, cost break-even/stress, delay
  sensitivity, temporal breadth, best-day dependence, and underwater duration
  when the included Report contains that snapshot;
- Portfolio signal-monetization identity, validation-only transmission outcome,
  largest adverse stage, prediction-mode-aware normalized-intent/sized/
  governed/executed gross/net additive contribution, gate coverage, and exact
  reconciliation when the included Report contains that snapshot;
- Portfolio liquidity-capacity policy, validation envelope, coverage, and
  reference-NAV breach evidence when present;
- Portfolio and governed-RL executed-book forecast coverage, pretrade breach,
  risk-only override, and zero-final-breach evidence when present;
- omitted gated or optional lanes and their admission state;
- normalized cross-lane analysis and its hash;
- optional host-delivery boundary.

The manifest is written last after hashing the other three files. Loading
verifies file hashes, canonical Markdown, normalized analysis, derived id,
intake/program identity, every referenced immutable Report and leader Run,
and exact frozen projections.

The Dossier projection copies this snapshot from the immutable lane Report.
It does not recompute a latest mechanical decision from the Run catalog.
Legacy Reports/Dossiers without the optional snapshot remain verifiable and
are not given synthetic historical evidence.

## Markdown and delivery

`dossier.md` is the human handoff document. It includes:

- caller question, decision context, assets, direction, and horizon;
- authorized positions, context-only research assets, construction family,
  cash/cap, structured benchmark source/asset, and portfolio-risk ceiling from
  the frozen Portfolio Mandate;
- conservative OHLCV participation capacity, coverage, and explicit
  no-impact/no-fill interpretation from the frozen Portfolio evidence;
- executive synthesis;
- a lane evidence table;
- lane Report summaries and selection-integrity warnings;
- frozen candidate-declared Factor component diagnosis when the Factor Report
  contains it, including the component-evidence hash and fixed-blend-only
  ablation disclosure;
- cross-lane findings and conditional recommendations;
- limitations, unresolved questions, and omitted gated or optional lanes;
- reproducibility hashes and publication instructions.

AutoQuant preserves supported caller-supplied OpenAlice
Workspace/Session/document context but cannot authenticate it. A Dossier is
complete and useful without that context. When OpenAlice is the host, it may
publish the exact Markdown through Inbox and stamp its own authoritative
Workspace, Session, and document revision. Another host or a standalone
operator may deliver the same immutable artifact through its own collaboration
surface.

## CLI and Studio

The headless lifecycle is:

```bash
aq dossier status <project> --json
aq schema dossier-analysis --json
aq dossier publish <project> --analysis dossier-analysis.json --json
aq dossier list <project> --json
aq dossier show <project> --dossier ID --json
```

Studio observes the same Core status. It may display blockers, included and
omitted lanes, latest Dossier summary, and copy exact commands. It cannot
author analysis, publish, select evidence, or send an Inbox document.

## Invariants

1. A Dossier cites verified lane Reports, not ungoverned raw claims.
2. Dynamically required-lane coverage is complete; gated and optional-lane
   omission is explicit.
3. Publication uses current evidence; later research does not invalidate the
   immutable point-in-time artifact.
4. Every cross-lane reference resolves to one frozen Report or finding.
5. Browser and CLI consume the same Core readiness/list/load functions.
6. Dossier authority is decision support only; trading authority is always
   none.
7. Host provenance becomes authoritative only when that host publishes or
   attributes the exact artifact.

## Known gaps

- General cross-Project aggregation is not implemented. The narrow frozen
  temporal-challenge import is defined by
  [[docs/design/frozen-external-holdout-challenge]].
- Core does not generate qualitative synthesis.
- Optional host delivery and Inbox publication remain outside AutoQuant.
