# AutoQuant V2 architecture

Status: active, pre-alpha.

For the concise tested capability and release snapshot, see [[docs/STATUS]].
This document remains the canonical architecture and ownership contract;
the status page records what has been proven at the current milestone.

## Purpose

AutoQuant V2 is an Agent-native quantitative research workbench. It converts
quantitative work into a file-backed, versioned, testable workflow that a
coding Agent can discover, execute, verify, resume, and hand to another Agent
or human.

The workbench is organized as a long-lived Workspace containing
self-contained Projects. When AutoQuant receives a local question or delegated
request, work begins in a Project rather than by cloning and mutating the
Harness itself.

The shipped repository now materializes that model directly:

```text
Auto-Quant-V2/                     # Workspace root and Git history
├── harness.json                   # optional host capability discovery
├── autoquant-workspace.json       # checked-in discovery/default
├── autoquant/                     # Harness runtime, schemas, CLI, Studio
├── projects/
│   ├── sample-research-desk/      # ordinary complete reference Project
│   └── <project-id>/
        ├── research question and configuration
        ├── project-local datasets or dataset identities
        ├── factors, strategies, features, and models
        ├── Studies and Sessions
        └── immutable Runs and artifacts
└── autoquant-workspace.local.json # optional ignored developer override
```

The Workspace is the stable quantitative workbench. A Project is the concrete
construction site for one evolving body of research. A Run is a bounded,
immutable execution under pinned Project and Harness inputs.

The same AutoQuant artifact runs standalone or as a specialized Workspace desk
inside OpenAlice or another host Harness. Hosting may add Agent Session
orchestration, communication, scheduling, provenance, and shared tools around
the desk. It does not create a separate AutoQuant mode or own quantitative
truth. The canonical product model is
[[docs/design/agent-native-quant-workbench]].

The source Workspace owns its runtime preparation through `uv sync --frozen`.
`harness.json` enters that prepared environment with frozen, no-sync `uv run`
and accepts only explicit loopback process authority from a supervisor. Hosting
does not require virtual-environment activation, `PATH` mutation, launch-time
dependency installation, or changes to standalone CLI behavior.

## Current implementation state

The V2 foundation now implements:

- a repository-root checked-in `autoquant-workspace.json`, one complete
  three-lane sample Project, and strict `autoquant.json` manifests;
- one optional ignored complete local Workspace configuration that may point
  development Project discovery outside the repository while the distributed
  base manifest remains confined and self-contained;
- self-contained blank or reference-template Project creation and one-level
  Workspace discovery;
- transactional request-driven Project intake from strict caller-supplied V1
  aligned daily, V2 continuous-UTC hourly, V3 configurable
  continuous/XNYS-session, V4 date-only observed daily Factor, V5
  close-time-aware single-source observed base-bar Factor, or V6
  content-addressed multi-source observed Factor OHLCV packages through `1d`,
  including optional complete per-asset classes for V1–V4 mixed economic
  panels,
  with normalized local bytes, completed higher intervals,
  version-locked calendar authority, explicit provider/adjustment claims,
  source/snapshot hashes, and exact Study identity;
- one packaged canonical market-data Skill bundle that materializes into both
  Agent discovery roots, routes by market semantics, preserves bounded
  provider evidence, requires two independently executable sources per
  accepted market, and hands only truthful V1–V6 packages to provider-neutral
  Core intake, including transactional byte-preserving V5-to-V6 composition;
- one canonical request-driven research desk that coordinates Factor,
  Portfolio, and governed RL Studies over the same dataset, exposes exact lane
  currentness/conflicts/next actions, and keeps method choice inside AutoQuant;
- explicit Workspace construction in an absent/empty target or safe adoption
  of a directory containing only surrounding caller/host files, preserving
  those files while refusing pre-existing configuration or Projects
  ownership;
- default or explicit Project resolution with effective configuration
  disclosure, base-root confinement, explicit external-local authority, and
  symlink rejection;
- a packaged `aq` CLI with versioned JSON envelopes, capability discovery,
  artifacts, next actions, validation, and inspection.
- one Core-authored Agent Work Brief, exposed by read-only `aq orient` and
  Studio, that compresses the current question, scientific blocker, exact
  Session worktree edit authority, protected boundaries, and primary action
  without adding a parallel lifecycle.
- one evidence-driven research agenda inside that hashed brief, translating
  verified Factor, Portfolio, or governed-RL failure layers into at most three
  validation-only experiment briefs with explicit edit targets, evidence,
  checks, and stop conditions but no automatic execution, promotion, or
  trading authority.
- one atomic lane-aware frozen external-holdout transition that reuses the
  current Dossier's canonical request, imports its exact leader sources into a
  separate compatible strictly later Project, disables iterative selection,
  executes each included lane once under explicit external-audit identity, and
  publishes immutable source-versus-later evidence without a production
  threshold.
- strict Project-local Study contracts with separate human program, fixed
  Python Judge closure, Agent-editable strategy/factor/model closure, objective,
  and declarative or content-locked dataset identity;
- bounded isolated Judge execution and atomically published immutable
  RunResults with full-file tamper verification.
- resumable Project-local Research Sessions with disposable candidate
  worktrees, fixed authority locks, immutable KEEP/REVERT/CRASH Experiments,
  exact leader restoration, stale-safe rollback-capable promotion, and
  Report-bound baseline-retaining completion.
- provider-neutral external Researcher Campaigns with strict briefs/responses,
  aggregate and per-turn budgets, failure recovery, and immutable turn
  evidence.
- strict local or delegated Research Requests, Session-derived Briefs, and
  immutable evidence-bound JSON/Markdown Research Reports with no trading
  authority, including an optional exact leader-Run mechanical-decision
  snapshot.
- immutable attached or detached Independent Reviews that classify completed
  Report claims by bound, declared, observed-unbound, or unavailable evidence
  without mutating the research they assess.
- immutable Project Research Dossiers that compose current Factor, Portfolio,
  and compatible optional RL lane Reports into one verified Project
  deliverable without re-evaluating raw Runs or recomputing later mechanical
  decisions.
- one packaged local read-only Studio with a shared versioned snapshot,
  Workspace/Project overview, request → lane Reports → Dossier delivery,
  effective Projects/configuration disclosure, exact copyable CLI commands,
  explicit mutable Campaign progress, defensive HTTP boundary, bounded
  verified Portfolio decision exploration, and responsive research-first
  presentation.
- one repository-root Harness manifest and strict optional Studio launch
  adapter that consumes a host-assigned named loopback port without changing
  standalone defaults, HTTP ownership, or quantitative Core behavior;
- one verified Portfolio sizing-anatomy read model that explains conviction,
  inverse volatility, same-side budget, caps/water-filling, covariance
  governance, historical execution, and component risk without becoming an
  optimizer or acquiring trading authority.
- one causal diversification-stress read model that reconstructs the same
  covariance window, reports absolute component-risk HHI and effective risk
  bets, and blends observed covariance 25%, 50%, and 100% toward the perfect
  position-aligned endpoint without resizing the book.
- one validation-only Portfolio strategy-viability diagnosis that reconciles
  factor, gross portfolio, friction, net performance, cost/delay stress, and
  temporal dependence into a bounded next research focus without altering
  selection or promotion.
- one self-contained OHLCV Factor Lab reference Project with a
  complete-universe long-form pandas factor API, deterministic local data,
  dataset-fixed purged horizons, a professional factor tear sheet, and one
  shared whole-panel no-lookahead runtime used by Factor, Portfolio, governed
  RL, and preflight.
- one bounded Factor evidence projection that reconciles immutable daily IC
  and quantile artifacts before exposing horizon, stability, style, coverage,
  and turnover evidence to CLI and Studio.
- one request-bound Factor claim dependency that distinguishes general
  decision-signal research, novel-factor discovery, and predeclared
  known-style validation before candidate search, and binds forward return or
  fixed forward realized volatility as the evaluated outcome.
- one claim-aware Factor prediction-universe contract: candidate code receives
  the complete research panel, request-specific decision signals are evaluated
  only on Portfolio-Mandate tradable assets, and factor-identity claims retain
  complete-universe evaluation. Research, prediction, and context populations
  are frozen and disclosed separately. One decision asset selects temporal
  evaluation; exactly two symmetric, two-sided, dollar-neutral decision assets
  select temporal factor-spread versus forward-return-spread evaluation only
  for return outcomes; four
  or more select cross-sectional evaluation. Three remain a deliberate
  caller-owned relative-basket-weight boundary.
- one optional explicit factor-component contract that checks declared
  score and timestamp-context components for determinism and causality. Scores
  expose evaluation-mode-correct predictive quality, association, redundancy,
  residual evidence, and fixed-blend leave-one-out. Cross-sectional Runs use
  per-date rank IC; single-asset and two-asset relative-value Runs use
  within-split temporal rank-correlation contributions. Contexts expose
  train-fixed states, occupancy, transitions, and matching conditional
  contribution evidence without source inference or downstream authority.
- one self-contained OHLCV Portfolio Lab reference Project that mechanically
  translates the same causal factor API through explicit signal state into
  capped target weights, drift-aware execution, reconciled contribution/risk
  attribution, causal OHLCV liquidity-capacity envelopes, and
  policy/cost/delay stresses without trading authority.
- one fixed Portfolio-native Allocation Lab that constructs a caller-bound
  long-only equal-risk-contribution book without inventing a predictive
  Factor, compares it with a separately drifted and costed fixed-weight
  reference on the same decision clock, separates validation relative
  performance from train/validation/test ERC construction fidelity, and
  exposes cap-induced parity gaps without opening an optimizer or Session
  surface.
- one request-bound Factor Population shared by Factor, Portfolio, and
  governed RL that fixes prediction/context assets and evaluation mode with
  explicit no-Portfolio and no-trading authority;
- one separate request-bound Portfolio Mandate shared by Portfolio and
  governed RL that derives tradable/context assets,
  direction-default or caller-supplied per-asset position roles, side limits,
  cash, gross/net, cap, benchmark, and one-sided
  covariance risk policy from caller intent and is shared exactly by Portfolio
  and governed RL. Optional caller-owned policy also locks gross, cap,
  volatility ceiling, linear base cost, no-trade band, and reference NAV into
  that same immutable dependency.
- one request-bound Horizon Mandate that binds a human research horizon to one
  exact primary target and a bounded diagnostic set on the locked dataset
  decision clock. Factor selection uses the primary bar; Portfolio and RL
  retain sequential one-bar accounting while sharing the same question
  identity.
- one causal portfolio risk governor that forecasts annualized volatility from
  trailing returns through the decision close, scales exposure down above the
  fixed ceiling, and publishes pre/post sizing evidence without adding
  leverage or trading authority.
- one shared executed-book compliance step that rechecks the final post-drift
  Portfolio or RL sleeve, lets risk outrank the no-trade band, and applies only
  the minimum proportional scale-down required by the same Mandate ceiling.
- one causal liquidity-capacity layer that inverts exact executed trade
  weights against trailing close-times-volume at fixed participation ceilings,
  publishes missing history and binding assets, and makes no impact/fill claim.
- one split-bounded mechanical position-lifecycle layer that reconstructs
  contiguous executed-weight sign episodes, allocates exact transition costs,
  names censored boundaries, and reconciles additive contribution to the
  decision ledger without claiming standalone trade returns.
- one predeclared local mechanical-parameter neighborhood that crosses five
  attainable signal entry/exit profiles with three no-trade bands, preserves
  exact validation/test paths, and has no selection or trading authority.
- one current mechanical-decision read model that reconciles verified
  percentile-state triggers, governed targets, drifted weights, proposed
  turnover, no-trade, final-risk repair, and executed research weights without
  creating price targets or order authority.
- one governed RL Factor-Policy Lab that confines Agent changes to a causal
  state encoder while the Judge fixes factor-mixture actions, Q-learning,
  rewards, portfolio accounting, folds, seeds, baselines, and model evidence.
- one shared research-selection integrity projection that keeps reference
  promotion validation-only and freezes trial/test-reuse disclosure through
  Sessions, Reports, and Studio.
- one bounded Session Decision Matrix that verifies the immutable trial chain,
  applies fixed family-specific metric semantics, and separates validation
  comparison from test audit and contextual evidence.

The canonical contracts are [[docs/PROJECT_FORMAT]] and [[docs/CLI]]. The
boundary designs are [[docs/design/workspace-project-boundaries]] and
[[docs/design/agent-cli-contract]]. Study/Run authority and evidence are defined
in [[docs/design/study-run-evidence]]; governed source research is defined in
[[docs/design/research-session-loop]]; external orchestration is defined in
[[docs/design/external-researcher-driver]]; Studio observation is defined in
[[docs/design/studio-observation-surface]]; the first quantitative reference
Project is defined in [[docs/design/ohlcv-factor-lab]]; causal target-weight
construction is defined in [[docs/design/portfolio-construction-lab]]. The
governed RL lane is defined in [[docs/design/rl-factor-policy-lab]]. The
fixed existing-holdings covariance and reduction-sensitivity route is defined
in [[docs/design/reported-position-book-risk]]. The fixed OHLCV conditional
price-event route is defined in [[docs/design/ohlcv-price-event-study]]. The
fixed Portfolio-native construction route is defined in
[[docs/design/portfolio-native-allocation-lab]]. The
factor tear-sheet protocol is defined in [[docs/design/factor-diagnostics]].
Bounded immutable Factor artifact projection is defined in
[[docs/design/factor-evidence-explorer]].
Caller-owned numerical target semantics are defined in
[[docs/design/request-bound-research-horizon]].
Mechanical signal state and attribution are defined in
[[docs/design/signal-policy-and-attribution]].
Portfolio-level covariance forecasting and scale-down semantics are defined in
[[docs/design/portfolio-risk-governor]].
Executed-book diversification and correlation-breakdown semantics are defined
in [[docs/design/portfolio-diversification-stress]].
Post-drift final-book compliance is defined in
[[docs/design/executed-book-risk-compliance]].
OHLCV participation-capacity semantics are defined in
[[docs/design/portfolio-liquidity-capacity]].
Request-bound position authority is defined in
[[docs/design/request-bound-portfolio-mandates]].
Bounded immutable Portfolio artifact projection is defined in
[[docs/design/portfolio-decision-explorer]].
Predeclared local mechanical-parameter stability is defined in
[[docs/design/portfolio-parameter-neighborhood]].
Predeclared temporal translation-history stability is defined in
[[docs/design/target-translation-robustness]].
Bounded governed RL artifact projection is defined in
[[docs/design/rl-policy-evidence-explorer]].
Exact governed-RL action persistence and chosen-versus-runner-up linear
decision rationale are defined in
[[docs/design/rl-policy-behavior-rationale]].
Session-level professional evidence comparison is defined in
[[docs/design/session-decision-matrix]].
Project-wide strategy-search history and selection-adjusted Factor/Portfolio
evidence are defined in
[[docs/design/selection-adjusted-research-evidence]].
Request-driven construction and external dataset snapshots are defined in
[[docs/design/research-intake-and-dataset-snapshots]].

Fixed descriptive Labs are separate method contracts rather than aliases for
one generic backtest. In particular, Book Risk's covariance and daily
constant-weight path cannot answer a reported-book Path Stress question. The
latter freezes opening units independently for every historical window,
permits within-window drift, ranks terminal loss, and reconciles return
contribution. See [[docs/design/reported-book-historical-path-stress]].
Multi-Study Project coordination and lane currentness are defined in
[[docs/design/research-program-orchestration]].
Scientific admission between Factor, Portfolio, and optional governed RL is
defined in [[docs/design/evidence-gated-research-progression]].
The end-to-end Agent-native research lifecycle, professional evidence stack,
deliverables, and HCI boundary are defined in
[[docs/design/quant-research-lifecycle]].
Project-level lane composition is defined in
[[docs/design/program-research-dossiers]].

The implementation boundary for Session comparison is
`autoquant/decision_matrix.py`; CLI and Studio consume that Core read model
without reimplementing metric choice or verdict semantics.

## Version and release cadence

Patch increments are the default for bounded pre-1.0 improvements; minor and
major increments require meaningfully broader product boundaries. Version
authority, compatibility limits, candidate verification, publish order, and
host pin independence are defined in
[[docs/design/versioning-and-release]]. Every immutable Run separately records
Harness version, commit, source hash, Python version, and dirty state, so a
Project can distinguish a released runtime from an untagged development trial.
Installed wheels and sdists freeze the exact build commit, while runtime
closure hashing covers Python, templates, Studio, and Skills; discovery and
anti-misattribution rules live in
[[docs/design/distribution-build-identity]].

The repository-root V0.5 Freqtrade arena inherited from Auto-Quant Classic is
retired. It is not an alternate execution path, package dependency, or data
location. Git history remains its archive. See
[[docs/design/retired-flat-freqtrade-harness]].

## Ownership boundaries

### AutoQuant repository and Workbench own

- the standalone package, runtime dependencies, schemas, CLI, Studio, and
  repository-root Workspace Template material;
- the checked-in internal Projects default and ordinary sample Project;
- one quantitative Core contract shared by standalone and hosted operation;
- Agent orientation and bounded quantitative operations;
- workbench version identity. Checkout changes remain ordinary visible Git
  work; V2 does not own automatic Workspace migration or compatibility
  reconciliation.

### Workspace and Harness own

- project discovery, identity, and root confinement;
- explicit Project authority for state changes in multi-Project
  Workspaces, while defaults remain disclosed read-only navigation;
- versioned schemas and machine-readable operations;
- data preparation and validation contracts;
- bounded execution and evaluation entry points;
- immutable artifact publication and result identity;
- cross-project inspection surfaces for CLI and the future Studio;
- dependency and runtime versions.

### Project owns

- the research question, hypotheses, and acceptance criteria;
- universe and dataset selection or pinned dataset identity;
- factors, features, strategies, models, and project-local research code;
- Study and Session history;
- immutable Researcher Campaign evidence;
- exact delegated request/Brief context and immutable Run- or Session-bound
  Research Reports;
- immutable Run evidence and reviewed candidates;
- project-specific notebooks, reports, and presentation assets.
- Project-observed reusable Workbench gaps in `framework-needs.md`.

A Workspace discovers Projects but does not provide mutable shared research
assets whose changes silently alter multiple Projects. Disposable caches may
be shared only when their content identity is explicit and Projects remain
reproducible without treating the cache as authoritative state.

Likewise, existing data inventory never governs what research may be asked.
An Agent acquires a task-complete package when required and each Study binds
its exact normalized bytes. Reusing exact Project-local data for a genuinely
same-dataset follow-up is valid; a Workspace-wide catalog or cross-Project
deduplication is only a storage optimization and may not narrow the caller's
universe, clock, interval, or history. See
[[docs/design/research-intake-and-dataset-snapshots]].

### Optional host Harness owns

- materializing or discovering the Workspace desk;
- starting, resuming, and attributing native coding-Agent Sessions;
- cross-Workspace task assignment, scheduling, communication, and delivery;
- capability port allocation, foreground process supervision, readiness, and
  opaque Web Surface routing;
- public browser origin and product chrome without forwarding host Cookie,
  Authorization, or CSRF authority into AutoQuant;
- host-authenticated identity, credentials, Inbox, and shared tool injection.

OpenAlice is the first-party host example. AutoQuant cannot require or
impersonate these capabilities. A standalone Workspace remains complete
without them.

### Live trading authority owns

- Broker credentials and connectivity;
- authenticated accounts, balances, positions, and venue capabilities;
- approval, submission, cancellation, and live reconciliation.

In OpenAlice this authority belongs to UTA. AutoQuant can research portfolios,
orders, and protection under historical assumptions without acquiring any of
these powers.

## Execution flow

The intended public loop is:

```text
local question or delegated request
→ files
→ strict validation
→ pinned Project + Harness identity
→ bounded prepare
→ execute
→ structured metrics and artifacts
→ review
→ either direct Run Report or keep, revert, branch, or promote in a Session
→ evidence-bound lane Report
→ Project Research Dossier
→ local review or optional host delivery
```

Backtesting, factor discovery, and ML experiments are different Project
programs over this same lifecycle. They do not require separate Workspace
models. A domain runtime may later sit behind a fixed Project Judge, but it
cannot own Workspace, Project, or evidence semantics.

## Invariants

- A Run records the exact Harness version, Project inputs, asset universe,
  dataset identity or time range, strategy/factor/model identity, metrics,
  artifacts, status, and errors.
- Completed Run evidence is immutable. A new interpretation produces a new
  Run or derived artifact rather than mutating the old result.
- Project paths are confined to their declared root; symlink or traversal
  escapes must be rejected.
- Evaluation contracts are locked for a comparison. Candidate code cannot
  silently edit its Judge, benchmark, dataset split, costs, or acceptance
  floors.
- CLI and Studio are projections of the same Core operations and evidence.
  The Studio must not become a second evaluator.
- Standalone and hosted Workspaces use the same Core, schemas, CLI, Project
  formats, evaluation semantics, and evidence.
- Exact generic managed authority may change only Studio bind, browser-open,
  and restricted embedding policy; without it, standalone launch and response
  security remain unchanged.
- Project truth remains recoverable from files and immutable artifacts without
  requiring private Agent conversation history.
- Reports and Dossiers are durable deliverables, not mandatory integration
  RPCs.
- The Harness has no live Broker or trading-account authority. Forward
  execution remains outside AutoQuant.
- Routine validation is fast, deterministic, and bounded. Long research loops
  and large backtests require explicit budgets in an active plan.

## Non-goals

- A universal strategy DSL.
- An OpenAlice-only backend or separate hosted edition.
- A private model loop, chat system, cross-Workspace scheduler, or Inbox.
- Choosing a different backtest engine for every asset class.
- Live order routing or replacing OpenAlice's trading-account abstractions.
- A mutable global dataset directory that makes Project results
  non-reproducible.
- A generic plugin marketplace, distributed workflow scheduler, or ML
  platform before concrete Projects require those capabilities.

## Authoritative locations

- Current Harness package and public command: `autoquant/` and `aq`
- Workspace/Project implementation: `autoquant/workspace.py`
- Agent CLI implementation: `autoquant/cli.py`, `autoquant/cli_contract.py`,
  and `autoquant/capabilities.py`
- Study identity and source closures: `autoquant/studies.py`
- Bounded execution and immutable evidence: `autoquant/runs.py`
- Governed Session/Experiment research and promotion:
  `autoquant/sessions.py`
- Bounded external Researcher orchestration and Campaign evidence:
  `autoquant/research.py`
- Delegated request and derived Brief contracts: `autoquant/briefs.py`
- Immutable Session- and Run-bound Research Report publication and
  verification, including append-only Review-governed Run Report correction
  lineage: `autoquant/reports.py` and `autoquant/run_reports.py`
- Immutable Project Research Dossier composition and verification:
  `autoquant/dossiers.py`
- Frozen cross-Project external-period binding and result verification:
  `autoquant/holdouts.py`
- Verified Studio snapshot and local HTTP server: `autoquant/studio.py`
- Verified Portfolio Run diagnostic projection:
  `autoquant/portfolio_explorer.py`
- Price-event authority and strict immutable projection:
  `autoquant/event_studies.py` and `autoquant/event_explorer.py`
- Packaged browser presentation: `autoquant/studio_assets/`
- Project template construction: `autoquant/templates.py` and
  `autoquant/project_templates/`
- Request-driven dataset intake and Project snapshot verification:
  `autoquant/intake.py`
- Canonical Workspace/Project format: [[docs/PROJECT_FORMAT]]
- Canonical CLI contract: [[docs/CLI]]
- Workspace/Project design: [[docs/design/workspace-project-boundaries]]
- Agent CLI design: [[docs/design/agent-cli-contract]]
- Study/Run evidence design: [[docs/design/study-run-evidence]]
- OHLCV Factor Lab design: [[docs/design/ohlcv-factor-lab]]
- Reported-position Book Risk: [[docs/design/reported-position-book-risk]]
- OHLCV Price Event Study: [[docs/design/ohlcv-price-event-study]]
- Portfolio-native Allocation Lab:
  [[docs/design/portfolio-native-allocation-lab]]
- Panel-native shared factor runtime:
  [[docs/design/panel-native-factor-api]]
- Project-derived Workbench needs:
  [[docs/design/project-derived-workbench-needs]]
- Factor evidence explorer design:
  [[docs/design/factor-evidence-explorer]]
- OHLCV Portfolio Lab design: [[docs/design/portfolio-construction-lab]]
- Request-bound Portfolio Mandate design:
  [[docs/design/request-bound-portfolio-mandates]]
- Caller-owned Portfolio research policy design:
  [[docs/design/caller-owned-portfolio-research-policy]]
- Portfolio decision explorer design:
  [[docs/design/portfolio-decision-explorer]]
- Portfolio diversification-stress design:
  [[docs/design/portfolio-diversification-stress]]
- Mechanical position lifecycle design:
  [[docs/design/mechanical-position-lifecycle-evidence]]
- Research intake and dataset snapshot design:
  [[docs/design/research-intake-and-dataset-snapshots]]
- Agent-native market-data acquisition:
  [[docs/design/agent-native-market-data-acquisition]]
- Prediction-mode Factor-to-target translation:
  [[docs/design/prediction-mode-target-weight-translation]]
- Target-translation history-window robustness:
  [[docs/design/target-translation-robustness]]
- Evidence-gated Research Program progression:
  [[docs/design/evidence-gated-research-progression]]
- Governed RL Factor-Policy Lab design:
  [[docs/design/rl-factor-policy-lab]]
- Read-only Study source dependencies and governed Factor-to-RL fusion:
  [[docs/design/cross-study-factor-dependencies]]
- Research selection and visible-test integrity:
  [[docs/design/research-selection-integrity]]
- Project-wide research families and selection adjustment:
  [[docs/design/selection-adjusted-research-evidence]]
- Research Session loop design: [[docs/design/research-session-loop]]
- External Researcher driver design:
  [[docs/design/external-researcher-driver]]
- Studio observation design: [[docs/design/studio-observation-surface]]
- Agent-native workbench product model:
  [[docs/design/agent-native-quant-workbench]]
- Quantitative research lifecycle and durable delivery:
  [[docs/design/quant-research-lifecycle]]
- Direct immutable-Run and governed-Session Report anchors:
  [[docs/design/run-bound-research-reports]]
- Studio operator guide: [[docs/STUDIO]]
- Retired Classic/Freqtrade boundary:
  [[docs/design/retired-flat-freqtrade-harness]]
- Planning and documentation governance:
  [[docs/design/documentation-system]]

As Workspace/Project schemas and CLI contracts are implemented, their
canonical references must be added here and to `AGENTS.md`.

## Verification

Use the bounded repository checks:

```bash
uv run python scripts/check_doc_links.py
uv run python -m unittest discover -s tests -v
uv run aq capabilities --json
```

These commands must not start autonomous research or a long backtest.

## Change checklist

- Update this document when Workspace/Project ownership or execution lifecycle
  changes.
- Check every host-facing change against standalone/hosted parity in
  [[docs/design/agent-native-quant-workbench]].
- Update [[docs/PROJECT_FORMAT]] and [[docs/CLI]] when the current runtime,
  data, or result contract changes.
- Add focused tests for every new schema, confinement rule, identity, or state
  transition.
- Update both CLI and Studio projections when an operation or artifact becomes
  available on both surfaces.
- Preserve or explicitly regenerate affected immutable fixtures and record the
  reason in the active plan.

## Known gaps

- Branching/Pareto search and robust multi-metric promotion gates are not
  implemented.
- Network ingestion, corporate-action computation, exchange-holiday
  verification, and point-in-time universe contracts are not implemented.
- Studio is read-only and does not yet provide confirmed Core operations.
- ML is a supported architectural direction but has no execution contract yet.
- Optional host-side automatic Project creation, coworker assignment, and
  delivery are not implemented here; AutoQuant emits exact report artifacts
  that a host or Agent may carry through its own collaboration surface.
