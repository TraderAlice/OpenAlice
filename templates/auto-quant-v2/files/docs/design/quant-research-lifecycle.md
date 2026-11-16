# Agent-native quantitative research lifecycle

Status: request-driven Project intake, delegation/report, portfolio, and
governed RL lanes implemented.

Related: [[docs/design/agent-native-quant-workbench]],
[[docs/ARCHITECTURE]], [[docs/PROJECT_FORMAT]], [[docs/CLI]],
[[docs/design/study-run-evidence]], [[docs/design/research-session-loop]],
[[docs/design/external-researcher-driver]],
[[docs/design/studio-observation-surface]],
[[docs/design/research-intake-and-dataset-snapshots]],
[[docs/design/portfolio-construction-lab]],
[[docs/design/request-bound-portfolio-mandates]],
[[docs/design/executed-book-risk-compliance]],
[[docs/design/rl-factor-policy-lab]],
[[docs/design/run-bound-research-reports]],
[[docs/design/research-selection-integrity]], and
[[docs/design/session-decision-matrix]].

## Scope

This document owns the end-to-end quantitative lifecycle inside the AutoQuant
workbench:

- local/delegated request and durable deliverable boundaries;
- the evidence a working quantitative researcher needs;
- the causal translation from factor signals to a portfolio;
- the first governed role for reinforcement learning;
- the division of responsibility between Core, Agent CLI, and Studio.

Detailed executable contracts remain in the subsystem documents linked above.
AutoQuant is a complete Agent-native research desk. It may research portfolio,
order, and protection behavior under fixed historical assumptions, but it does
not own Broker state, live accounts, approvals, or order submission.

## Workbench collaboration

The durable lifecycle is:

```text
local question or delegated coworker request
→ optional strict Research Request
→ self-contained Project and fixed Study
→ immutable Run
→ either direct Run Report or governed Session investigation
→ bounded Experiments and Campaigns when candidate iteration is required
→ immutable lane Research Reports
→ immutable Project Research Dossier
→ local review, Agent-to-Agent delivery, or optional host publication
→ continued research or separately authorized forward execution
```

A Project is the construction site for one evolving research problem. A Study
is one fixed evaluation question inside it. A Run is one immutable execution.
A Session is one active line of candidate research against that fixed
authority and ends by either promoting an improved KEEP or completing against
an exact baseline-retaining Report. A Report is one lane's content-hashed
deliverable over either a current immutable Run or a governed Session evidence
prefix. A frozen reproduction needs no Session; a conclusion based on candidate
search does. A Dossier composes verified current lane Reports into the
Project-level answer without re-evaluating raw Runs. Neither artifact is
required to communicate through a private service protocol; another Agent or
human can read the same files directly.

The request can now create that construction site through strict external
V1 daily or V2 causal multi-interval OHLCV intake. The caller supplies a
package; AutoQuant validates and
normalizes it into Project-local content, records provider/calendar/adjustment
claims, binds request/dataset/Study hashes, and exposes exact baseline and
Session-start actions. Retrieval remains external authority. See
[[docs/design/research-intake-and-dataset-snapshots]].

Host Workspace and Session ids in a request are caller-supplied context.
AutoQuant preserves and hashes supported OpenAlice origin fields but cannot
authenticate them. A host stamps its own authoritative origin and document
revision when it delivers the report through its collaboration surface. This
prevents AutoQuant from forging host provenance while preserving the
request/report chain. Standalone work requires no host origin.

## Request and brief authority

A Research Request carries:

- the question and decision context;
- requested assets and directional hypothesis;
- intended decision horizon;
- hypotheses, constraints, and requested deliverables;
- optional caller-supplied host context; the current schema supports OpenAlice
  Workspace, Session, document path, and document revision fields.

Starting a delegated Session validates and normalizes the request, then derives
a Brief from the exact request plus the selected Project, Study, baseline, and
fixed program/Judge/dataset/Harness locks. The request and brief are copied
into the Session and validated on every load.

The Brief has `research-prioritization` authority. It can tell a Researcher
which hypotheses and deliverables matter. It cannot change the Study, Judge,
dataset, promotion rule, or trading account. Human intent is therefore an
input to research, not a hidden override of quantitative evidence.

## Quantitative evidence stack

No single Sharpe ratio is a sufficient research verdict. AutoQuant should
present evidence in layers so a human or Agent can see where a candidate gains
and where it fails.

### Factor quality

- coverage and missingness;
- Pearson IC and rank IC;
- IC mean, dispersion, and IC information ratio;
- forward-horizon decay;
- quantile monotonicity and top-minus-bottom spread;
- stability by asset, chronological fold, and declared market regime.

The implemented reference Factor Lab now fixes dataset-derived purged
request-bound bar horizons, Newey-West mean-IC inference, tertile
returns/monotonicity,
causal market regimes, two folds per split, per-asset time-series rank
correlation, and overlap with four fixed OHLCV styles. It publishes daily IC
and quantile artifacts while retaining validation primary-horizon mean IC as
the sole promotion objective. An optional explicit component contract adds raw,
nearest-peer residual, redundancy, and fixed diagnostic-blend leave-one-out
evidence without inferring Python column use or changing Portfolio/RL
authority. See [[docs/design/factor-diagnostics]] and
[[docs/design/factor-component-attribution]].

### Portfolio implementation

- gross and net return, CAGR, volatility, Sharpe, and Sortino;
- maximum drawdown, Calmar, tail loss, and expected shortfall;
- benchmark beta, active return, tracking error, and information ratio;
- turnover, estimated cost, cost drag, and rebalance frequency;
- gross exposure, net exposure, leverage, maximum weight, concentration, and
  participation/capacity evidence when volume assumptions exist.

### Robustness and research integrity

- chronological out-of-sample and walk-forward results;
- per-asset, per-regime, and per-fold dispersion rather than only an aggregate;
- delayed-execution, higher-cost, and parameter-neighborhood stress;
- trial count and selection-adjusted evidence when many variants were tried;
- explicit failure, missing-data, and non-finite metric evidence.

The Deflated Sharpe Ratio literature explains why selection bias, multiple
testing, and non-normal returns must temper the best observed backtest:
<https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2460551>. Transaction-cost
research shows that turnover and expected return are inseparable portfolio
trade-offs:
<https://papers.ssrn.com/sol3/papers.cfm?abstract_id=972184>. These sources
motivate evidence fields; they do not grant a candidate permission to compute
its own acceptance rule.

Core must keep alpha, sizing, portfolio construction, and execution assumptions
separate. A candidate can have predictive factor quality and still be
uninvestable after constraints and costs. Conversely, a stable low-turnover
portfolio may be useful without an impressive raw IC.

Reference candidate promotion uses validation only. Test metrics are visible
diagnostic evidence, so Core conservatively marks a Session as requiring a new
external holdout after candidate iteration. Trial/verdict counts and this
warning are derived from immutable history and frozen into Reports; statistical
selection adjustment remains separate until its assumptions are fixed. See
[[docs/design/research-selection-integrity]].

## Mechanical signal-to-portfolio contract

The implemented `ohlcv-portfolio-lab` uses OHLCV bars and target weights, not
a broker order book:

```text
causal factor values at bar t
→ cross-sectional percentile and explicit entry/hold/exit/reversal intent
→ causal conviction and inverse-volatility sizing
→ long-only or long/short budget
→ per-asset, gross, net, leverage, and concentration constraints
→ causal portfolio covariance forecast and one-sided volatility ceiling
→ target weights
→ drift and optional tolerance/no-trade decision
→ final executed-book covariance check
→ minimum proportional risk repair when required
→ rebalance after a declared lag
→ turnover and fixed cost model
→ portfolio return over the next bar
```

Every transform is fixed Judge authority for a comparison. Positions use only
information available at the decision timestamp, and returns are credited only
after the declared execution lag. OHLCV cannot prove queue position, spread
dynamics, or L2 fills, so results must say `bar-target-weight simulation`
rather than imply exchange-level precision.

Target weights are a necessary portfolio research output because they answer
how much exposure the evidence deserves. The current implemented reference
lane realizes them through bar-target-weight simulation. The active
order-native design will add fixed historical Order/TPSL realization so a
Quant Agent can separate prediction, sizing, fills, and protection without
claiming Broker precision. Live balance, venue capability, approval, and
account mutation remain external authority. See
[[docs/design/order-native-portfolio-decisions]].

The first reference contract fixes `0.75/0.25` entry and `0.55/0.45` exit
percentiles, absolute target cap `0.30`, a `0.05` one-way turnover no-trade
band, and full traded-notional cost. A content-locked Portfolio Mandate maps
the caller's direction to requested-assets-only long/cash, short/cash, or
dollar-neutral construction. A complete caller asset-role vector can instead
assign long-only, short-only, two-sided, and context-only duties with fixed
gross-side limits; wider peer data remains context-only. Synthetic
fixtures explicitly retain the historical all-universe research-neutral
contract. The exact ledger connects mandate, tradability, signal intent,
pre-governor/governed target, covariance forecast/scale, pre-trade drift,
executed weight, trade, return, cost, regime, component variance contribution,
causal trailing dollar volume, and participation-capacity binding asset. The
post-drift ledger additionally records the final executed forecast, ceiling,
coverage, proportional repair, and whether risk overrode no-trade. The
capacity layer reports exact 1%/5% OHLCV envelopes and missing-history dates;
it does not claim spread, impact, or fills. The executable details are
[[docs/design/request-bound-portfolio-mandates]],
[[docs/design/portfolio-construction-lab]], and
[[docs/design/signal-policy-and-attribution]],
[[docs/design/portfolio-risk-governor]], and
[[docs/design/executed-book-risk-compliance]], and
[[docs/design/portfolio-liquidity-capacity]].

The current Portfolio read model projects that same ledger as a four-stage
decision chain: state-dependent percentile entry/exit/reversal boundaries,
raw-to-governed target construction, target-to-pretrade turnover versus the
no-trade band, and final historical execution. Per-asset trigger distances are
current cross-sectional percentile-point buffers with peer ranks held fixed;
they are not price targets, probabilities, forward orders, or UTA authority.

It also reconstructs a point-in-time sizing anatomy: signal conviction divided
by causal trailing own volatility, proportional same-side budget, cap and
water-fill redistribution, covariance governor scale, historical executed
weight, and component-risk contribution. Portfolio Reports freeze this exact
Core object beside the mechanical decision, and Project Dossiers copy the
Report snapshot rather than recomputing a newer book. This explains why assets
receive unequal historical research weights while preserving
`tradingAuthority: none`.

The same frozen decision ledger also yields a causal diversification read
model. It verifies the exact covariance component arithmetic, reports
effective risk bets, and blends observed covariance 25%, 50%, and 100% toward
the perfect position-aligned endpoint. Reports and Dossiers freeze this
context-only ladder; it never changes the Judge, progression, weights, or
trading authority. See [[docs/design/portfolio-diversification-stress]].

The next fixed read model diagnoses whether validation evidence stops at
factor prediction, gross portfolio monetization, or trading friction. It
reconciles the daily gross-to-net path, cost curve and break-even, turnover
efficiency, delay sensitivity, monthly breadth, best-day dependence, and
underwater duration. Its iteration focus is research prioritization only.
Visible test evidence remains audit-only and cannot redirect the diagnosis.
Reports and Dossiers freeze the exact point-in-time diagnosis for any later
reviewer or collaborating Agent.

For the `factor-not-monetized` case, the read model further decomposes
prediction-mode-aware normalized signal intent into fixed pre-governor sizing,
governed target, historical executed gross, and historical executed net
additive contribution. The consecutive deltas isolate sizing/caps, risk
governance, execution/no-trade retention, and cost. Normalized intent obeys the
verified Factor Population mode and the separately compatible Portfolio
Mandate: explicit relative value uses its capped complementary pair and Cash,
while ordinary cross-sectional dollar-neutral research retains full-side
breadth. It is a non-compounded
diagnostic, not another candidate or benchmark. Validation alone names the
largest adverse transformation; test is visible audit and the bridge has no
selection or trading authority.

Tolerance bands are a first-class implementation choice: research on
rebalancing frames the problem as tracking-error versus transaction-cost
control rather than blindly trading every calendar interval:
<https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3858951>.

## Governed reinforcement learning

The implemented `ohlcv-rl-factor-lab` is a meta-policy over causal factors,
not an opaque trading bot:

- state: current causal factor vector, volatility/regime features, and previous
  target or position;
- action: one governed stateful factor-mixture sleeve and its constrained
  portfolio target weights;
- transition: the next chronological bar or rebalance interval;
- reward: next-period net portfolio return minus fixed cost, risk, turnover,
  and constraint penalties;
- artifact: exact policy configuration, dependency identity, seed, learned
  parameters, and training history.

The Judge owns state timing, action bounds, reward, costs, constraints,
splits, seeds, budgets, and baselines. Candidate code implements only a pure
row-level causal feature transform inside the declared editable closure. The
current Factor Study candidate, request-derived Factor Population, and
Portfolio Mandate are separate content-locked dependencies: RL can select a
governed factor sleeve but cannot edit the factor input or change which assets
receive Factor scores, which assets may become positions, or which signs,
cash, and benchmark that sleeve may use.

Required evidence includes:

- chronologically isolated test folds or walk-forward windows;
- every declared random seed, not only the best seed;
- mean, dispersion, and failure rate across seeds and folds;
- equal-weight, fixed-factor, and simple linear baselines;
- net turnover/cost/risk metrics from the same portfolio accounting;
- no test-fold training or reward changes during candidate search, plus
  disclosure when visible test evidence has informed later candidates.

Financial RL evidence is fragile. A recent multi-method benchmark reports weak
robustness and rapid degradation for many deep portfolio methods:
<https://arxiv.org/abs/2306.10950>. More generally, reproducibility work on
deep RL emphasizes intrinsic variance and standardized statistical reporting:
<https://ojs.aaai.org/index.php/AAAI/article/view/11694>. AutoQuant therefore
treats RL as a higher-burden candidate lane rather than a privileged source of
truth.

V1 makes the candidate surface smaller than a general training adapter: the
Agent edits a pure deterministic row-level state encoder. The Judge fixes five
factor-mixture actions (candidate, three references, and equal blend), the same
request-bound Portfolio Mandate, linear Q-learning, next-bar costed reward, two
expanding folds, three seeds, portfolio accounting, and fixed/simple-linear
baselines. The promotion objective aggregates validation evidence only. Test
metrics remain visible audit evidence and carry an explicit warning that
repeated inspection consumes holdout value. Exact models, training histories,
and timestamped actions are immutable artifacts. Executable details are in
[[docs/design/rl-factor-policy-lab]].

## Research report

An Agent supplies a strict report-analysis object containing:

- title and executive summary;
- findings with confidence and exact evidence references;
- recommendations with conditions, not broker orders;
- limitations and unresolved questions.

Every evidence reference contains `kind`, exact Session evidence `id`, and
`artifactPath`. For a Run, the path is null or copied byte-for-byte from that
Run's `result.artifacts[].path` (for example
`artifacts/factor-report.json`); it is not a Run-root, Project, or filesystem
path. Experiment and Campaign references use `artifactPath: null`. This
kind-specific contract and complete examples are part of
`aq schema report-analysis --json` so a Coding Agent does not need repository
documentation or validation-error recovery to author the first Report.

Core resolves every reference against the verified Session and freezes an
evidence snapshot: request/brief, Study locks, baseline and current leader,
Runs, Experiments, Campaigns, artifacts, Harness, and dataset. It then
deterministically renders `report.json` and `report.md`, hashes every file, and
writes the manifest last.

A Report normally anchors a successful Run or Session leader. The sole failed
Run exception is an explicitly classified current `scientific-limit` Run: its
Run-bound Report freezes the exact summary, structured errors, disposition,
request, inputs, and selection history as the bounded answer to that fixed
question. `repair-required` failures are inspectable evidence, not reportable
research conclusions. Neither failed class can seed a Session, qualify a
Factor, open Portfolio/RL progression, or grant trading authority.

Every newly published Report also binds `leaderDecisionSupport` to the exact
frozen leader Run id and result hash. Portfolio Reports include Core's exact
point-in-time `mechanicalDecision`: historical timestamp, percentile state
transitions, permitted next-state conditions, raw/governed targets,
pretrade/executed weights, turnover band, risk/final execution gate, and
decision hash. Other Study lanes record an explicit null Portfolio decision.
Legacy Reports without this optional field remain loadable and are never
backfilled from a later Run.

Report authority is `quantitative-decision-support`. A report may recommend
further research, monitoring, avoidance, or a conditional portfolio posture.
It may not claim a live order was placed, that a host approved a trade, or that
caller-supplied origin fields were authenticated.

## Project research dossier

The canonical Research Program returns one Project-level answer by composing
lane Reports:

```text
Run / Experiment / Campaign
→ delegated Session Report
→ Project Research Dossier
→ local review or optional host delivery
```

Factor and Portfolio Reports are required. Governed RL is optional and is
included only when its current Report pins the selected Factor source;
otherwise the Dossier records the omission and reason. Agent-authored
cross-lane findings cite exact included Report and finding ids. Core verifies
coverage, freezes request/dataset/program/Study/Report/leader identities, and
renders immutable JSON and Markdown. A Dossier inherits a Portfolio Report's
exact `leaderDecisionSupport`; it never recomputes the newest Run or calls the
decision explorer during rendering. Later research does not reinterpret an
older Dossier. The complete contract is
[[docs/design/program-research-dossiers]].

When a current Dossier warrants a temporal challenge, AutoQuant can bind its
exact leader Run source closures into a separate, compatible, strictly later
intake Project:

```text
Project Dossier
→ frozen external-holdout binding
→ one existing-Judge Run per included lane
→ immutable external-period result
→ reviewer or coworker decision
```

This transition is self-contained and non-iterative. It prohibits Sessions,
generic Runs, Campaigns, promotion, and any trading authority in the target.
The result reports objective survival or decay but does not invent one
cross-lane production threshold. See
[[docs/design/frozen-external-holdout-challenge]].

## Human-computer interaction

The CLI and JSON schemas are the primary control surface because Agents must be
able to discover, execute, and verify the complete lifecycle without a
browser. Every mutation provides:

- one stable capability id and exact command;
- strict machine input and a versioned JSON envelope;
- affected artifacts and their mutability;
- next actions and failure diagnostics.

Studio is the shared situation room for humans and Agents. It should answer:

- What did the caller ask?
- Which Project, Study, and Session own the work?
- What is mutable now, and what evidence is immutable?
- Which metric layer improved or regressed?
- Which constraints, costs, folds, or seeds failed?
- Are lane Reports ready, is the Project Dossier blocked/current, and what
  exact CLI command advances the work?

The browser may copy exact headless commands, filter, compare, and inspect. It
must never invent a metric, approve a candidate, publish a report, or become a
second evaluator. Human guidance enters through explicit request/analysis
artifacts so AI work remains attributable and reproducible.

An external host may start the Agent Session and carry the final deliverable,
but it does not replace this interface. The same `aq orient`, Project files,
commands, and verified evidence must support a standalone Agent.

The implemented Session Decision Matrix is the first multi-candidate HCI
surface under this rule. Core verifies and normalizes a bounded immutable trial
chain; CLI and Studio present the same metric descriptors, preference
directions, validation-only non-dominance, leader trade-offs, and explicitly
separate test-audit evidence. The browser neither chooses metrics nor changes
the fixed primary-objective verdict. Portfolio capacity, coverage, and
reference-NAV breach fields remain contextual until the caller supplies a
capital mandate.

The implemented Factor Evidence Explorer applies the same rule inside one
Run. Core reconciles full daily IC and quantile artifacts before sampling;
Agents receive the normalized object through `aq run factor`, while humans
switch path, horizon, split, and stability views without browser-side
statistics or selection authority.

## Phased delivery

1. Request-driven Project and market-data intake:
   `plans/request-driven-market-data-intake`.
2. Delegation and report delivery:
   `plans/openalice-research-handoff`.
3. Causal signal-to-portfolio accounting and professional evidence:
   `plans/portfolio-construction-lab`.
4. Governed RL factor/target policy lane:
   `plans/rl-factor-policy-lab`.
5. One-request multi-Study research desk:
   `plans/multi-study-quant-research-desk`.
6. Governed Factor-to-RL content dependency:
   `plans/governed-factor-to-rl-fusion`.

Each phase must produce bounded deterministic evidence and a commit before the
next phase changes its assumptions.

## Invariants

1. Caller intent never overrides fixed evaluation authority.
2. Every published claim points to verified immutable evidence.
3. AutoQuant has no live-trading or authenticated host-provenance authority.
4. Signal timing, portfolio accounting, costs, and RL rewards are causal and
   fixed by the Judge.
5. Aggregate metrics never hide required per-asset, fold, regime, or seed
   evidence.
6. CLI and Studio project the same Core objects; Studio remains read-only.
7. Heavy frameworks are optional adapters. The research contract is owned by
   AutoQuant and testable on small deterministic fixtures.

## Change checklist

- Update the request/report schemas, Session locks, CLI capabilities, Studio
  snapshot, canonical docs, and tests together.
- When adding a portfolio metric, state its timing, benchmark, cost, and
  aggregation semantics in the fixed Judge.
- When adding an RL adapter, freeze seeds, budgets, dependency identity,
  baselines, model artifacts, and failure reporting.
- Never expose a field that could be mistaken for broker confirmation or
  authenticated host origin.
- Keep routine validation bounded; large datasets or training require an
  explicit plan budget.

## Known gaps

- Mixed-asset/multi-calendar Studies, intraday intake, corporate-action
  verification, and point-in-time universe evidence remain future data work.
- Candidate-factor dependencies are Project-local source closures; immutable
  promoted Report artifacts are not yet a general cross-Project model input.
- Cross-Project report aggregation remains future work. Optional host-side
  Workspace creation, coworker assignment, and delivery are separate
  collaboration concerns; AutoQuant owns the exact Project commands and report
  artifacts at its boundary.
