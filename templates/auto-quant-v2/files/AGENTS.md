# AutoQuant V2 contributor guide

AutoQuant V2 is a pre-alpha, Agent-native quantitative research workbench. Its
job is to turn quantitative research into a file-backed, versioned, testable
workflow that coding Agents can operate and humans can inspect.

The same repository must work independently and unchanged as a specialized
Workspace desk inside OpenAlice or another Agent Harness. Host-specific
Session orchestration, communication, provenance, and live trading are optional
surrounding capabilities; they do not define AutoQuant Core.

Domain correctness, reproducible evidence, Agent operability, and a coherent
project model take priority over backward compatibility while V2 is taking
shape. Auto-Quant Classic files were retired from the current tree; Git history
is their archive and current code must not load or reinterpret them under V2
semantics.

Use Python 3.11 and `uv` for repository code and scripts. Keep projects
self-contained: a Workspace owns project discovery and a standardized Harness,
while each Project owns its research question, source inputs, strategies or
models, Runs, and durable artifacts.

The repository root is the default Workspace. Start with `aq project list .`
and `aq orient .`, then create or continue Projects in the root `projects/`
(for example with `aq project create . <project-id>`). A framework
developer may have an ignored `autoquant-workspace.local.json` that explicitly
redirects effective Project discovery outside the repository; inspect CLI or
Studio configuration-source output before assuming which Projects are active.

For a new standalone desk, `aq workspace init <directory>` owns an absent or
empty target by default. Keep request/dataset packaging in a sibling staging
directory, or pass `--adopt-existing` explicitly when caller/host files are
already inside the intended desk. Adoption preserves those surrounding files
but refuses any existing Workspace manifest, local override, or `projects`
entry; never move or delete caller material merely to satisfy initialization.
Dataset asset paths resolve from the directory containing the package
manifest. When raw files already live under `staging/raw-ohlcv/`, put
`dataset-package.json` at `staging/` and use paths such as
`raw-ohlcv/AAPL.csv`; do not copy the raw bytes beside a deeper manifest.
Core still creates the intentional Project-local normalized, content-locked
snapshot. Never use `..`, absolute paths, or symlinks to bypass the manifest
root. In the strict Research Request `source`, set both `artifactPath` and
`artifactRevision` when an exact caller artifact is known, or set both to JSON
`null`; never fill only one. A local immutable artifact may use an explicit
content digest as its revision claim.

Workspace staging and Project `data/`/cache are persistent local working
evidence, not ordinary Git research state. The repository desk ignores
`staging/`, and every Project ignores its normalized data/cache by default.
Do not use `git add -f` to copy normal market data into history merely because
the checked-in teaching Project tracks its small deterministic fixture; that
sample is the explicit exception. Commit briefs, request/Study contracts,
candidate source, Runs, Sessions, Reports, Reviews, Dossiers, and other durable
research records. Track market bytes only when the caller explicitly requests
a distributable fixture and its source terms permit it.

Before adding a host integration or public surface, ask:

1. Can a coding Agent use the same capability in a standalone Workspace?
2. Is durable truth recoverable from files, manifests, Git, and immutable
   evidence rather than private conversation context?
3. Does the change preserve one Core contract across CLI, JSON, Studio, and
   any host projection?

## Read before changing the repository

Route work to the document that owns it; do not append every discovery to
README:

- product orientation and five-minute entry: [[README]];
- end-to-end standalone/hosted Workspace operation, from Project creation
  through data, research, evidence, and Studio: [[docs/OPERATOR_GUIDE]];
- current tested capability and honest boundary: [[docs/STATUS]];
- concise chronological release history: [[docs/CHANGELOG]];
- version increments, checkout upgrades, release audit, tags, compatibility,
  and host pins: [[docs/design/versioning-and-release]];
- active outcome, checklist, and exact candidate/final proof: `PLANS` and its
  indexed plan;
- lasting subsystem invariants: the relevant file under `docs/design/`.

README is not a release ledger, STATUS is not a changelog, and a completed plan
is not current design authority. Read the version policy before editing package
metadata or publishing a tag.

## Starting a quantitative assignment

Do not begin with data downloads, candidate edits, model training, or
backtests. First establish the assignment as an English Markdown research
brief that another Agent can recover from the filesystem.

1. Inspect the Workspace and existing Projects. Continue the Project when the
   assignment belongs to its evolving research question; do not create a new
   Project merely because a new coworker or conversation arrived.
2. When the assignment is genuinely new, create its construction site with
   `aq project create <workspace> <project-id>`. First inspect
   `aq project templates`; use its fit and anti-fit contracts rather than
   guessing from template names. Use `--template blank` while the appropriate
   research method is still unclear. Factor evidence that must feed Portfolio
   or governed RL belongs in `ohlcv-research-desk`, not a standalone Portfolio
   Lab.
3. Before quantitative work, read and update the Project-root `research.md`.
   Rewrite the incoming assignment in English and preserve useful source
   context, including a verbatim caller statement when precision requires it.
4. Make the research decision, question, motivation, asset scope, horizon or
   cadence, available evidence, material constraints, evaluation meaning,
   expected deliverable, assumptions, open questions, and proposed bounded
   route clear enough for a replacement Agent to continue.
5. Separate caller-owned intent from researcher-owned method. Use informed
   judgment to choose factors, diagnostics, models, and implementation details.
   Do not invent the decision being supported, risk appetite, universe,
   direction, horizon, benchmark, hard constraints, or what would count as a
   useful answer.
6. If a missing or ambiguous caller-owned fact could materially change the
   study, stop and ask the delegating Agent or user. Record the question and
   answer in `research.md`, then ask again if the answer exposes another
   material ambiguity. Continue until the assignment is bounded, falsifiable,
   and safe to translate into fixed evaluation authority.
7. Only then bind datasets, requests, Studies, Judges, or other strict
   manifests and begin the bounded research loop. Those machine contracts
   freeze an understood question; they do not replace the Markdown brief.
   Preserve provider retrieval time only when the supplied provenance knows
   it. Use explicit JSON `null` for an unknown original `retrievedAt`; never
   invent the current or packaging time.
   The request `source.system` is provenance, not a generic label: use
   `openalice` when an OpenAlice coworker delegated the assignment, `local`
   only for a direct standalone desk request, and `external` only for another
   external origin. Preserve exact Workspace, Session, artifact, and revision
   identifiers only when supplied; otherwise use JSON `null` rather than
   inventing trial or path-derived ids.
   For a related fixed Book Risk question over the exact retained dataset,
   use `aq study intake <project> <study-id> --request <request.json>` to add
   Study-owned authority. Do not overwrite the Project-root request/snapshot
   or create a duplicate Project merely to represent the follow-up. When the
   same evolving question needs a strictly newer comparable data vintage, add
   `--dataset <complete-package.json>`; Core gives that Study its own immutable
   data namespace and preserves all earlier evidence. If asset descriptions,
   roles, market clock, adjustment meaning, or the body of research differ,
   acquire a task-complete package for a sibling Project instead.
   For another fixed custom question that still belongs to the same Project,
   use `aq study create ... --request <request.json> --dataset
   <complete-package.json>`. This atomically creates its Study-owned request
   and V1-V3 OHLCV closure; do not inspect installed implementation modules or
   hand-write a materialization script. Supply the scientific Judge and
   objective explicitly. Use a sibling Project only when the body of research
   itself no longer belongs together.
8. After every Experiment, re-read `aq orient`. Treat
   `evidence.latestExperiment` as the immutable trial/check pointer and
   `trial-review-required` as an Agent/caller choice to report/complete or
   explicitly declare another bounded hypothesis. Session writability is not
   an instruction to continue tuning. For an improved KEEP, guarded promotion
   is itself the terminal `promoted` close; `session.complete` is only the
   alternative baseline-retaining close and must not follow promotion. After a
   valid completion or promotion, treat `required-research-complete` as the
   terminal handoff; a listed `session.start` is an optional explicit follow-
   up, not unfinished required work. Read `researchAgenda.moveRole`
   literally: `optional-follow-up` preserves useful evidence-derived ideas but
   does not authorize or require another Session or Experiment.
   The same rule applies after a failed baseline Run. Read
   `evidence.failureDisposition`: inspect `repair-required` before changing
   source or authority, and publish/return an explicit `scientific-limit` as
   the bounded answer to the exact fixed Study. Never repeat an unchanged
   `run.execute`, erase the failed Run, or describe either failure as “no
   evidence.” A different hypothesis, data package, Study type, or authority
   is separately declared work.

Before the first Factor Run, choose `factorPolicy` from the caller's claim,
not from the candidate formula. Use `decision-signal` when the question asks
whether a signal supports ranking, timing, allocation, or Portfolio decisions
over an explicit caller-owned population. Every new decision-signal request
must list `factorPolicy.predictionAssets`; other requested assets remain
Factor context. Do not infer this list from `assets[].positionRole`: Factor
evaluation and Portfolio position permission are separate authorities. Use
`novel-factor` only when the caller actually claims new factor identity across
the complete research universe, and `known-style-validation` only for a
predeclared supported style; neither may narrow the population. Inspect
`strategies/factor-population.json` before evaluation. If a Run later exposes
a request-binding mistake, preserve that Project and immutable Run, disclose
the visible-evidence timing, and create a corrected sibling Study or Project;
never delete evidence and recreate the same identity to make the attempt look
clean. See [[docs/design/caller-owned-factor-population]].

Also bind `factorPolicy.outcome` before construction. Use `forward-return` for
expected-return, ranking, timing, target-weight, Portfolio, or RL questions.
Use `forward-realized-volatility` only when the caller asks which causal OHLCV
features predict future risk; route it to standalone `ohlcv-factor-lab`, where
a higher factor means higher predicted risk and no Portfolio/RL gate may open.
Read [[docs/design/caller-owned-factor-outcomes]] for the exact complete-window
log-return formula, supported populations, and historical implicit-return
boundary. Do not infer the outcome from candidate code or invert a risk score
into a return claim.

When the assignment requires market data, use the Workspace's
`$acquire-market-ohlcv` Skill after the research question fixes the venue,
assets, completed-bar interval, date range, research clock, and required
adjustment meaning. Local staging is only a possible source; never shrink or
reshape the question around available inventory. Verify the complete current
contract and acquire or complete one task-coherent package whenever coverage
or alignment is uncertain, even if that duplicates prior bytes. Read only the
relevant market reference, then use at least two suitable provider routes for
an accepted market. Preserve exact provider bytes and audits under Workspace
staging; compare numerically only when price contracts match; select a route
by the task's authority, freshness, history, and observed quality rather than
a global primary/fallback rule. Run `$package-autoquant-ohlcv` and strict
intake before treating data as Project authority. Never download directly
into `projects/`, relabel raw and adjusted series, fill provider placeholders
silently, or claim that an unofficial route is exchange truth. See
[[docs/design/agent-native-market-data-acquisition]].

For a cross-market Factor request whose provider supplies only daily session
dates, retain one strict observed-only V4 package first. Then use the packaging
Skill's bundled `materialize_daily_close_time.py` with an exact source-hash,
per-asset calendar/timezone/volume authority manifest. Do not infer calendars
from symbols, reuse one market's close for another, append a nominal UTC hour,
or write a private converter. Inspect the emitted transformation audit before
strict V5 intake.

When one observed Factor question needs distinct provider packages, keep each
source as a complete independently audited V5 package. Use the packaging
Skill's `compose_observed_packages.py` with an exact authority manifest to
publish V6. Never collapse several providers into one synthetic provider,
hand-edit the union, subset a source package, align or fill observations, or
mix adjustment claims. Inspect `composition-audit.json`, audit the V6 output,
then use strict Factor intake. See
[[docs/design/research-intake-and-dataset-snapshots]].

Run bundled Python Skill scripts with `aq-python`, never an ambient `python`
or `python3`. The bridge uses the interpreter that owns the installed Harness.
Do not install dependencies into a system or user Python to work around an
Agent shell that rewrites `PATH`.

Read `selectionIntegrity.testExposureState` literally. The first candidate is
fixed before its own audit becomes visible; a later Experiment proves only
that another source iteration followed prior visible evidence. Core cannot
observe whether a human or Agent actually used that evidence, so never rewrite
`testGuidanceObservability=not-observable` as a factual test-guided claim.
The external-holdout requirement remains conservative in both cases.

For a new editable Factor assignment, the scaffold `candidate.py` is an API
demonstrator, not the caller's baseline. Finish the brief and intake, inspect
the candidate contract, author the first predeclared caller-relevant candidate
before any evaluation, and then start the governed Session. When no exact
successful baseline can be reused, `session start` first runs the Study's fixed
seconds-scale preflight against that canonical candidate. A failed guard creates
no Run or Session; repair the candidate and invoke the same command again. A
passing guard is not quantitative evidence and has no selection, promotion, or
trading authority; only then does Core execute the complete baseline and retain
the guard receipt in the Session. Do not run the generic scaffold first, and do
not invoke `session check` on the unchanged baseline candidate—Checks are for
later worktree edits. If any prior Run's visible test evidence preceded a later
source edit, disclose that timing, preserve `externalHoldoutRequired`, and never
call the process test-blind or claim that test evidence was not used.

When strict Project intake has already bound `request.json`, start the Session
with `--request request.json` so the delegated brief is visible before research
and a terminal Report can be published. The CLI also binds that verified
Project request by default when `--request` is omitted; an unbound local
Project keeps the optional request-free Session behavior.

Do not create a Session merely to obtain a Report directory. When one
successful current immutable Run already answers the bounded request and no
candidate editing occurred, publish directly with `aq report publish --study
ID --run ID --analysis FILE`. Start a Session only for a real editable
investigation; once it exists for a lane, its evidence and Report take
precedence over an older direct Run Report. See
[[docs/design/run-bound-research-reports]].

When Report publication is required, prefer the optional exact-anchor
`aq report draft` scaffold over manually reconstructing Run/artifact
identities. It is mutable authoring material, not evidence: replace every
reserved placeholder, set `authoringState` to `final`, and only then publish.
Never treat the scaffold as Core-authored analysis.

When asked to review completed research, do not trust Report prose, rerun the
Study, or create a replacement Report. Use strict Report/Run readers, write a
`review-analysis` that classifies every material claim as `verified`,
`declared`, `observed-unbound`, or `unverified`, and publish it with
`aq review publish`. Bound classes may cite only the exact target Report and
anchor Run. Workspace files require `observed-file`; their recorded digest
does not promote them into research authority. If the assignment forbids any
target Workspace mutation, pass `--output` to a directory outside the
Workspace and verify the resulting detached package directly with
`aq review show <review-directory>`. See
[[docs/design/independent-research-reviews]].

When a verified Review requires a material correction to a Project-owned Run
Report, do not edit, delete, or merely out-date the prior Report, and do not
encode currentness only in prose. Publish a new Report over the same exact Run
with `--corrects`, `--correction-review`, and `--correction-reason` together.
Retain supported Run-bound conclusions, remove or qualify the reviewed defect,
and never promote `observed-unbound` files into Run authority. Verify the new
Report through `aq report show`; its embedded Review and linear correction
graph determine currentness while every earlier package remains immutable.
Session-bound Report correction is not part of this contract.

A frozen Holdout is not handed off merely because its one-shot Runs succeeded.
After `aq holdout run`, inspect the bounded source/later comparison with
`aq holdout show`, author `holdout-analysis.json`, and publish it with
`aq holdout assess`. Judge Factor, Portfolio, and optional RL lanes separately;
do not let one favorable scalar rescue another weakened claim, and do not
invent a universal pass threshold. Only verified `assessed` state is the
terminal caller handoff. The Assessment is Agent-authored quantitative support
with no selection, automatic-promotion, Order, or trading authority.

When writing `request.horizonPolicy`, declare the required primary horizon
once. `diagnosticForwardBars` may contain only the additional sorted context
horizons; Core canonically adds the primary and enforces a five-horizon total.

When a caller asks about an existing book, do not substitute historical model
targets for current holdings. If the caller or delegating Agent can supply one
explicit reported or hypothetical funded weight snapshot, the
`ohlcv-book-risk-lab` can perform a fixed descriptive audit. A conditional
question may additionally supply up to eight explicitly named, complete funded
hypothetical books at the same time and currency; never invent or search those
scenarios. A caller may instead authorize one asset/cash sizing path against
one fixed historical volatility ceiling: a decrease requires a strictly
positive held asset and explicit minimum resulting weight; an increase permits
an absent candidate, requires positive cash, and fixes an explicit maximum
resulting weight. Never fabricate a zero holding, omit the caller's weight
boundary, add another adjustable leg, or turn the resulting target into an
Order. Treat
every snapshot as unauthenticated external input, return its verified evidence,
and leave live account reconciliation and execution to OpenAlice/UTA. See
[[docs/design/reported-position-book-risk]].

When the caller asks which historical paths hurt one exact reported book,
do not substitute Book Risk's daily constant-weight drawdown or covariance
contribution. Use `ohlcv-book-path-stress-lab` only after the caller fixes one
funded snapshot, split-adjusted task-complete daily history, holding bars,
episode count, and greedy inclusive non-overlap rule. The fixed Study buys the
opening units once per window, permits natural weight drift, keeps cash flat,
and attributes return as opening weight times holding cumulative return. Do
not search parameters, attach news explanations, forecast recurrence,
authenticate the account, optimize another book, or create an Order. See
[[docs/design/reported-book-historical-path-stress]].

English is the working language inside the AutoQuant desk: use it for
`research.md`, plans, research notes, code and comments, experiment hypotheses,
and internal Reports or Dossiers. Preserve proper nouns, identifiers, source
quotes, and evidence in their original form when needed. The delegating or
user-facing Agent owns conversation locale and may translate the resulting
evidence for the user; callers are never required to speak English.

## Research work and Workbench work

Keep two connected lines of work distinct:

1. The Project research line answers the assignment. Maintain its question,
   hypotheses, evidence, and progress in `research.md`, candidate source,
   Sessions, Runs, Reports, Reviews, and Dossiers.
2. The Workbench improvement line changes AutoQuant when real Project work
   exposes a reusable framework gap. Record the observed gap in the
   canonical Project-root `framework-needs.md` before proposing a Core
   solution. During a governed candidate operation, its Session worktree copy
   is protected orientation material; update the canonical note before
   entering or after returning from the operation.

Do not turn `research.md` into a framework backlog, and do not modify fixed
Harness/Judge authority to work around a missing capability. A useful
`framework-needs.md` item states the attempted research, concrete missing or
misleading behavior, evidence, smallest useful Core improvement, and any
temporary workaround plus its scientific cost. Keep speculative feature wishes
out of the file.

When acting as a Workbench developer, reproduce and generalize a Project need,
then promote accepted reusable work into an indexed repository plan and the
appropriate `docs/design/` contract. When the fix lands, preserve the original
Project note and record the version and research retry outcome. See
[[docs/design/project-derived-workbench-needs]].

## Plan workflow

Read `PLANS` before starting non-trivial work. A plan is required when work
crosses packages or public surfaces, changes a domain model, contains meaningful
unknowns, or needs multiple implementation steps. Small, local fixes can
proceed without one.

For planned work:

1. Copy `plans/_template` to a stable kebab-case filename and register it in
   the matching status section of `PLANS` before implementation.
2. Treat the plan as the live coordination record. Update its checklist,
   findings, decisions, verification evidence, and date as work evolves; do not
   reconstruct them only at the end.
3. Keep durable system truth in the relevant `docs/design/` document. A plan
   may link to design intent but must not become a second source of current
   invariants.
4. Before marking a plan `completed`, audit every acceptance item against
   executable or manual evidence. Move the index entry to the completed section
   and preserve the plan as a concise record.
5. If a plan is replaced, mark it `superseded` and link its replacement. If
   follow-up work remains after completion, create and index a separate plan
   rather than leaving unchecked work in a completed plan.

Plan structure, lifecycle, and its boundary with design documentation are
defined in [[docs/design/documentation-system]].

## Design map

Read the relevant linked document before changing a subsystem:

- Current tested capability, real-request proof, release verification, honest
  boundary, and known product gaps: [[docs/STATUS]]
- Product identity, standalone/hosted parity, desk composition, Agent-first
  requirements, and ownership boundaries:
  [[docs/design/agent-native-quant-workbench]]
- Documentation ownership and update protocol:
  [[docs/design/documentation-system]]
- Public end-to-end Workspace operation and task routing:
  [[docs/OPERATOR_GUIDE]]
- Version increments, compatibility boundary, release audit, tagging, and host
  pin independence: [[docs/design/versioning-and-release]]
- Installed/source Harness commit provenance, dirty meaning, runtime closure
  hashing, and identity discovery: [[docs/design/distribution-build-identity]]
- System direction, Workspace/Project ownership, and runtime boundaries:
  [[docs/ARCHITECTURE]]
- Workspace discovery, Project identity, self-contained construction, and path
  confinement: [[docs/design/workspace-project-boundaries]]
- Versioned CLI envelopes, capability discovery, operation effects, artifacts,
  and next actions: [[docs/design/agent-cli-contract]]
- AI-primary operator, human-reviewer roles, compact Agent Work Brief,
  filesystem authority, and CLI/Studio orientation parity:
  [[docs/design/agent-operator-experience]]
- Direct immutable-Run versus governed-Session Report ownership, anchors, and
  coordinated-program precedence: [[docs/design/run-bound-research-reports]]
- Fixed-unit reported-book historical windows, terminal-loss ranking, greedy
  non-overlap selection, exact return attribution, and no-forecast boundary:
  [[docs/design/reported-book-historical-path-stress]]
- Fresh-worker isolation, employability evidence grades, trial observation,
  friction promotion, and the OpenAlice readiness gate:
  `docs/agent-employability-validation`
- The `0.9.0` real-delegation cohort, demonstrated strengths, repaired
  friction, honest limits, and thin OpenAlice boundary:
  `docs/openalice-real-delegation-synthesis`
- Project-observed capability gaps and their promotion into Workbench design
  and plans: [[docs/design/project-derived-workbench-needs]]
- Observed-universe ordinary-pandas factor input, aligned/ragged cross-asset
  computation, and shared causality runtime:
  [[docs/design/panel-native-factor-api]]
- Verified Factor/Portfolio/RL evidence translated into bounded experiment
  briefs without automatic execution, promotion, or trading authority:
  [[docs/design/evidence-driven-research-agenda]]
- Exact Dossier leaders frozen into a strictly later compatible Project for
  one non-iterative external-period challenge:
  [[docs/design/frozen-external-holdout-challenge]]
- Configurable decision-bar intervals and calendar-verified XNYS regular
  sessions:
  [[docs/design/configurable-session-interval-inputs]]
- Caller-owned Portfolio risk and implementation assumptions shared by
  Portfolio and governed RL:
  [[docs/design/caller-owned-portfolio-research-policy]]
- Caller-owned per-asset target caps shared by Portfolio and governed RL:
  [[docs/design/caller-owned-asset-position-caps]]
- Caller-owned per-asset long, short, two-sided, and context-only position
  permissions shared by Portfolio and governed RL:
  [[docs/design/caller-owned-asset-position-roles]]
- Caller-owned Factor prediction/context partition, evaluation modes, and
  strict separation from Portfolio construction authority:
  [[docs/design/caller-owned-factor-population]]
- Caller-owned cash or named-asset benchmark references shared by Portfolio
  and governed RL:
  [[docs/design/caller-owned-benchmark-reference]]
- Caller-owned Portfolio/RL decision cadence, scheduled mechanical holds, and
  continuously available risk-only repair:
  [[docs/design/caller-owned-decision-cadence]]
- Caller-owned dataset/session decision anchors bound to verified market-clock
  authority: [[docs/design/market-clock-decision-anchors]]
- Target-weight portfolio construction, Order/TPSL realization, conservative
  OHLC bar execution, and optional host delivery:
  [[docs/design/order-native-portfolio-decisions]]
- Request-bound numerical forward horizon shared by Factor, Portfolio, and
  governed RL:
  [[docs/design/request-bound-research-horizon]]
- Fixed seconds-scale candidate checks, immutable non-selection diagnostics,
  and edit/check/evaluate routing:
  [[docs/design/candidate-preflight-feedback]]
- Fixed Study authority, editable/Judge source closures, bounded execution, and
  immutable RunResult evidence: [[docs/design/study-run-evidence]]
- Transactional reference-Project construction, ordinary pandas factor API,
  deterministic OHLCV fixture, and fixed no-lookahead factor Judge:
  [[docs/design/ohlcv-factor-lab]]
- Externally reported position snapshots, covariance crowding, component risk,
  standardized reduction sensitivity, and live-account authority boundary:
  [[docs/design/reported-position-book-risk]]
- Caller-fixed downside opening gaps, delayed close-to-close outcomes,
  unconditional/matched references, overlap handling, and no-trading event
  evidence: [[docs/design/ohlcv-price-event-study]]
- Portfolio-native equal-risk-contribution construction, fixed weighted
  reference paths, cap-induced parity disclosure, and no-Session evidence:
  [[docs/design/portfolio-native-allocation-lab]]
- Causal signal ranking, constrained target weights, drift-aware accounting,
  costs, risk/implementation metrics, and portfolio stress evidence:
  [[docs/design/portfolio-construction-lab]]
- Predeclared local entry/exit and no-trade parameter stability without
  parameter-selection authority:
  [[docs/design/portfolio-parameter-neighborhood]]
- Predeclared temporal Factor-to-target history-window stability without
  window-selection authority:
  [[docs/design/target-translation-robustness]]
- Governed causal state encoding, fixed factor-mixture actions, RL reward,
  seeds/folds/baselines, and policy evidence:
  [[docs/design/rl-factor-policy-lab]]
- Governed RL action persistence and exact chosen-versus-runner-up linear
  decision rationale:
  [[docs/design/rl-policy-behavior-rationale]]
- Same-pretrade one-step governed factor opportunities, realized selection
  regret, and ex-post oracle authority boundaries:
  [[docs/design/rl-factor-opportunity-audit]]
- Verified governed RL artifacts, bounded fold/seed, training, baseline, and
  fixed-action Studio projection:
  [[docs/design/rl-policy-evidence-explorer]]
- Validation-only candidate selection, visible-test limitations, trial counts,
  and shared Session/Report/Studio integrity evidence:
  [[docs/design/research-selection-integrity]]
- Project-wide research families, multiple-testing correction, and
  selection-adjusted Factor/Portfolio evidence:
  [[docs/design/selection-adjusted-research-evidence]]
- Purged forward horizons, factor significance/decay/quantiles, fixed style
  overlap, request-bound novel/known-style claims, claim-specific
  qualification, and asset/fold/causal-regime stability:
  [[docs/design/factor-diagnostics]]
- Verified Factor artifacts, bounded IC/quantile paths, horizon profile, and
  Studio tear-sheet projection:
  [[docs/design/factor-evidence-explorer]]
- Mechanical signal state, hysteresis, prediction-mode-aware normalized
  intent, conviction/risk sizing, execution reasons, and portfolio
  contribution reconciliation:
  [[docs/design/signal-policy-and-attribution]]
- Split-bounded executed-position episodes, holding periods, entry/exit cost,
  contribution excursions, and signal/execution mismatch:
  [[docs/design/mechanical-position-lifecycle-evidence]]
- Causal covariance forecast, one-sided portfolio-volatility ceiling, shared
  Portfolio/RL risk policy, and pre/post sizing evidence:
  [[docs/design/portfolio-risk-governor]]
- Post-drift executed-book volatility compliance, no-trade risk overrides,
  proportional repairs, and shared Portfolio/RL execution evidence:
  [[docs/design/executed-book-risk-compliance]]
- Causal OHLCV dollar-volume capacity envelopes, exact trade-path
  reconciliation, binding assets, and no-impact interpretation:
  [[docs/design/portfolio-liquidity-capacity]]
- Request-derived tradable/context universes, directional construction,
  cash, benchmarks, and shared Portfolio/RL position authority:
  [[docs/design/request-bound-portfolio-mandates]]
- Bounded verified Portfolio Run projection, sampled performance/exposure
  series, current mechanical book, transitions, and contribution explorer:
  [[docs/design/portfolio-decision-explorer]]
- Verified baseline/candidate/leader comparison, metric preferences,
  validation-only non-dominance, and Studio decision matrix:
  [[docs/design/session-decision-matrix]]
- Request-driven Project construction, aligned or observed-only external OHLCV
  package validation, normalized dataset snapshots, and pre-Session intake
  state:
  [[docs/design/research-intake-and-dataset-snapshots]]
- Agent-native market-data routing, source diversity, staged evidence, and
  provider-neutral intake:
  [[docs/design/agent-native-market-data-acquisition]]
- Completed-bar multi-interval aggregation, causal as-of alignment, ordinary
  pandas candidate surface, and shared Factor/Portfolio/RL input authority:
  [[docs/design/causal-multi-interval-factor-inputs]]
- Explicit score/context component declarations, causal contract checks,
  component redundancy/incremental diagnostics, context-state conditionals,
  and fixed-blend attribution:
  [[docs/design/factor-component-attribution]]
- One-request/multi-Study orchestration, shared factor-source sequencing, lane
  currentness, and research-program status:
  [[docs/design/research-program-orchestration]]
- Read-only cross-Study source dependencies and governed Factor-to-RL fusion:
  [[docs/design/cross-study-factor-dependencies]]
- Resumable Agent worktrees, KEEP/REVERT/CRASH Experiments, and Report-bound
  delegated source promotion: [[docs/design/research-session-loop]]
- Provider-neutral external Researcher turns, budgets, restoration, and
  immutable Campaign evidence: [[docs/design/external-researcher-driver]]
- Read-only Workspace observation, local HTTP, browser presentation, and
  mutable-versus-immutable research state:
  [[docs/design/studio-observation-surface]]
- Agent-native request/report collaboration, professional quantitative
  evidence, causal portfolio construction, governed RL, and human/Agent
  interaction:
  [[docs/design/quant-research-lifecycle]]
- Project-level synthesis of verified lane Reports into one immutable
  deliverable: [[docs/design/program-research-dossiers]]
- Studio operator and public read-model guide: [[docs/STUDIO]]
- Canonical Workspace and Project file schemas: [[docs/PROJECT_FORMAT]]
- Human and machine-readable command behavior: [[docs/CLI]]
- Retired repository-root Freqtrade Harness boundary:
  [[docs/design/retired-flat-freqtrade-harness]]

Add new active design documents to this map when a subsystem gains its own
invariants. Keep this list as a routing surface, not a historical catalog.

## Required change loop

1. Read `PLANS`, the active plan when one exists, and the relevant design
   document(s); identify the current invariant being changed.
2. Make the smallest coherent source, schema, fixture, and project changes.
3. Update every affected design document in the same change. If the concept has
   no document, create one under `docs/design/` and add it to the design map.
4. Exercise the affected public CLI or Python boundary with bounded inputs.
5. Run:

   ```bash
   uv run python scripts/check_doc_links.py
   uv run python -m unittest discover -s tests -v
   ```

6. If evaluation semantics, dataset identity, or result hashes changed,
   explicitly record which checked-in fixtures or immutable Runs were
   regenerated and why.
7. If a locked benchmark or Judge contract changed, relock it deliberately and
   prove both an unchanged candidate and a known-improvement path.

Do not launch the autonomous NEVER STOP loop, download large datasets, or run a
long multi-year backtest as routine validation. Use fast deterministic tests
and bounded smoke fixtures unless the active plan explicitly requires a larger
run and records its budget.

Tests prove executable behavior; design documents explain why the behavior
exists and which invariants future changes must preserve. Neither substitutes
for the other.
