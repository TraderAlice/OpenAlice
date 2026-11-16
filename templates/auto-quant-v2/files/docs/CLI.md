# AutoQuant V2 CLI

Status: Workspace/Project and request-driven OHLCV intake, Study/Run evidence,
governed Session/Experiment research, bounded external Researcher Campaigns,
delegated requests, and evidence-bound Research Reports implemented.

`aq` is the public human- and Agent-facing command line interface. Humans
receive compact text by default. `--json` emits exactly one versioned envelope.

## Discovery

```bash
aq --version
aq version
aq version --json
aq capabilities
aq capabilities --json
aq schema
aq schema project --json
aq schema agent-work-brief --json
aq schema research-agenda --json
aq schema research-request --json
aq schema ohlcv-dataset-package --json
aq schema report-analysis --json
aq schema factor-diagnostics --json
aq schema factor-candidate-contract --json
aq schema factor-claim --json
aq schema factor-population --json
aq schema event-study-policy --json
aq schema event-study-diagnostics --json
aq schema allocation-policy --json
aq schema allocation-diagnostics --json
aq schema book-risk-diagnostics --json
aq schema portfolio-diagnostics --json
aq schema portfolio-mandate --json
aq schema rl-policy-diagnostics --json
aq schema research-program-status --json
aq schema session-decision-matrix --json
aq schema candidate-preflight --json
aq schema candidate-check-output --json
aq schema candidate-check-result --json
```

`aq --version` is the stable concise package-version probe. `aq version
--json` returns the exact current Harness id/version, source build commit,
dirty state, complete runtime closure hash, Python version, and whether that
build provenance came from the installed distribution, an exact-root source
checkout, or nowhere trustworthy. These are fields of one Harness object;
`capabilities --json` embeds that exact object, so an Agent does not need a
separate probe after ordinary discovery.
See [[docs/design/distribution-build-identity]].

`capabilities --json` is the authoritative machine discovery surface. Each
command descriptor includes:

- stable command id and usage;
- description and operation effect;
- JSON support;
- positional and option argument types, requirements, defaults, and choices;
- success, failure, and usage exit codes;
- output sections, currently empty for the foundation commands.

Agents should discover the contract rather than scrape `--help`.

## Workspace and Project commands

```bash
aq workspace init <workspace-dir> \
  [--name NAME] [--adopt-existing] [--json]
aq project create <workspace-dir> <project-id> \
  [--name NAME] [--description TEXT] \
  [--template blank|ohlcv-factor-lab|ohlcv-portfolio-lab|ohlcv-rl-factor-lab|ohlcv-book-risk-lab|ohlcv-event-study-lab|ohlcv-allocation-lab|ohlcv-research-desk] \
  [--json]
aq project intake <workspace-dir> <project-id> \
  --request research-request.json \
  --dataset ohlcv-dataset-package.json \
  [--template ohlcv-factor-lab|ohlcv-portfolio-lab|ohlcv-rl-factor-lab|ohlcv-book-risk-lab|ohlcv-event-study-lab|ohlcv-allocation-lab|ohlcv-research-desk] \
  [--name NAME] [--json]
aq project list <workspace-dir> [--json]
aq project default <workspace-dir> <project-id> [--json]
aq project program <project-or-workspace-dir> [--project ID] [--json]
aq orient <project-or-workspace-dir> [--project ID] [--json]
aq validate <project-or-workspace-dir> [--project ID] [--json]
aq inspect <project-or-workspace-dir> [--project ID] [--json]
```

`workspace init` requires an absent or empty target by default. If caller or
host inputs are already staged inside the intended desk,
`--adopt-existing` explicitly preserves them and creates only
`autoquant-workspace.json` plus a new empty `projects/`. Adoption refuses any
existing base/local Workspace manifest or `projects` file, directory, or
symlink; it never imports staging into Project or quantitative identity.
Keeping staging in a sibling directory and passing those external paths to
`project intake` remains the other safe route.

The repository root is the shipped Workspace, so the first commands after a
clone are normally:

```bash
aq project list .
aq orient . --json
aq studio serve .
```

Workspace-scoped JSON context includes the effective `projectsDir`,
`configurationSource`, and `configurationPath`. Human Project listing prints
the same Projects directory and source. `workspace-manifest` means the strict
checked-in confined manifest is active; `local-override` means the ignored
complete `autoquant-workspace.local.json` selected a local external Projects
directory. Studio exposes the same effective source. Invalid local
configuration is an error and never silently falls back.

`orient`, `validate`, and `inspect` resolve exactly one Project before reading
its manifest. A direct Project path rejects `--project`; a Workspace path
selects the explicit id or its default. When entry came through a Workspace,
human output prints the selection method and JSON `context` includes both the
effective Workspace and `projectSelection`: selected/default Project, whether
selection was explicit, Project count, and available ids. Default orientation
in a multi-Project desk also advertises `project list` before the selected
Project's own supporting actions.

A Workspace default is read-only navigation convenience, not mutation
authority. When a Workspace contains two or more Projects, every Project-local
command whose advertised effect is `creates-artifact` or `mutates-project`
must receive an explicit `--project ID`; otherwise Core returns
`workspace.explicit-project-required` before creating state. Direct Project
paths and single-Project Workspaces retain their existing behavior. Studio
snapshot/serve intentionally remain Workspace-wide observation surfaces.

`project create` is the normal new-assignment scaffold. It creates a
self-contained Project with root `research.md`, `framework-needs.md`, and all
declared Project directories. Its JSON envelope returns `researchBriefPath`,
`frameworkNeedsPath`, and corresponding mutable artifacts. Before following
the available inspect, baseline, or Session actions, the Quant Agent rewrites
the research brief in English and clarifies material caller-owned ambiguity
with the delegating Agent or user. Real reusable Workbench gaps encountered
during research are recorded separately in `framework-needs.md`.
The caller may converse in any language. `--template blank` is appropriate
while the method is unclear; a specialized template is appropriate only when
the understood question already fits its fixed contract.

`orient` is the AI-first entry point. It compacts already verified Project,
Study, research-program, Session, Run, Report, Dossier, gate, and conflict
state into one strict `AgentWorkBrief`. The brief identifies the current
question and focus, stable reason code, exact operating root, paths writable
now versus only declared for a future Session, protected authority, and at
most one primary command with working directory, effect, and expected evidence
kind. When the next step is an Agent-owned source edit or Report analysis
rather than an executable Core operation, JSON keeps `primaryAction` null and
the human/JSON review text states that exact preparation step.
For a focused editable Factor Study, `candidateContract` states the actual
Project base interval, available completed feature intervals, full panel
column inventory, timestamp meaning, ragged/missing policy, target clock,
causal context-visibility rule, factor API, component metadata fields, and the only legal
roles: `cross-sectional-score` and `timestamp-context`. A legacy teaching
Project therefore says `baseInterval: 1d` and `featureIntervals: []`; an
intake-bound multi-interval Project lists its exact locked surface. Agents must
not infer higher-interval availability from conditional template branches or
component declarations; the contract carries this availability rule
explicitly.
`evidence.candidateCheckId` remains scoped to the exact current worktree
candidate. Separately, nullable `evidence.latestExperiment` preserves the
latest immutable Experiment id, verdict, candidate Run/source, verdict
authority, and the latest matching Check completed before that Experiment.
This historical link survives leader restore, Report publication, and Session
completion.
Question provenance is explicit: delegated intake returns
`origin: delegated-request`; otherwise a strict Project request returns
`origin: project-request` only when a fixed Study dependency binds its exact
canonical request hash. Without either request, an explicitly headed
`Question`, `Research question...`, or `Fixed question` section in the
Project research program returns `origin: project-research-brief`. Every
verified source exposes an absolute `sourcePath`. If none exists, orientation
uses the create-time Project description with `origin: local` and does not
infer intent from arbitrary prose.
V2 also includes `researchAgenda`: an explicit waiting/unsupported/frozen
state or up to three deterministic experiment briefs derived from the current
verified Factor, Portfolio, or governed-RL Run. Each move carries its
hypothesis, editable paths, optional declared components, typed evidence
references, validation checks, and stop conditions. `moveRole` is
`current-research-guidance` while the lifecycle is actively preparing a
bounded investigation, `optional-follow-up` after immutable trial review or a
terminal lane has no required primary action, and `unavailable` when no move
exists. Human output uses `Research move` versus `Optional follow-up` from
that exact field. Agenda moves are not
`nextActions`; they cannot execute, promote, or trade, and visible test audit
cannot affect their order.
It is read-only. Before a Session exists it never advertises canonical Project
source as the governed edit target; an active valid Session points only to its
disposable worktree. Human output fits a short terminal readout, while JSON is
the machine contract defined by `aq schema agent-work-brief --json`. See
[[docs/design/evidence-driven-research-agenda]].

An Agent may invoke `aq orient .` after changing into that advertised
worktree. New worktrees carry one fixed-inventory-locked Session marker; Core
verifies the marker, owning Session, canonical Project, and exact path before
returning the same canonical brief. Human output prints both the canonical
Project root and writable operating root. Dataset bytes remain only under the
canonical Project, and mutation commands still require their existing
explicit Project path.

Inside an active Session, orientation distinguishes the accepted leader from a
newer worktree edit. A settled non-delegated KEEP routes directly to guarded
`session promote` as the primary action. A newer candidate still routes to its
bounded check/evaluation first and may keep promotion only as a secondary
escape to the already accepted leader. Delegated KEEP work returns
`report-required` until an exact current Report exists; only then does
orientation expose primary promotion with the required `--report` argument.
It never emits a promotion command that the Session contract would reject.
When the accepted source, Study, preflight, and Harness identities remain
exact, the promotion/report handoff also retains the passed candidate Check
id/status even though leader advancement means that Check is no longer a
pre-evaluation check against the *previous* leader.

After promotion succeeds, its response reconstructs the same post-mutation
work brief as `aq orient` and Studio, returns it as `data.agentWorkBrief`,
prints its leading post-promotion reason for human operators, and uses that
brief for `nextActions`. The response therefore does not request a redundant
`run execute` when the promoted KEEP Run already supplies current evidence.

`blank` is the default construction. `ohlcv-factor-lab` transactionally
creates a complete, self-contained pandas factor research Project with local
synthetic OHLCV, content-locked Study, fixed no-lookahead Judge, fixed
claim-aware prediction population, and executable next actions. Candidate code
always sees the complete research panel. A `decision-signal` explicitly names
`factorPolicy.predictionAssets`; factor-identity claims use the complete
research universe. Core freezes this evaluation-only authority in
`strategies/factor-population.json`. A standalone Factor Lab has no Portfolio
Mandate. Diagnostics disclose `predictionUniverse.evaluationMode`:
one decision asset uses temporal evaluation; exactly two symmetric,
dollar-neutral decision assets use temporal first-minus-second factor/return
spread evaluation; four or more use cross-sectional evaluation. Three assets
remain unsupported until the caller supplies an explicit relative-basket
contrast. A request-bound one- or two-asset temporal decision signal may use a
package containing only those prediction assets; Core does not require
unrequested context padding merely to satisfy the cross-sectional breadth
floor.
The request's `factorPolicy.outcome` binds `forward-return` or
`forward-realized-volatility`. The latter uses a complete unannualized
square-root-sum-of-squared-log-return window and is accepted only by
`ohlcv-factor-lab` for one temporal target or four-or-more cross-sectional
targets. CLI/JSON/Studio label it as future risk and never open Portfolio or RL
admission. See [[docs/design/caller-owned-factor-outcomes]].
`ohlcv-portfolio-lab` uses the same causal candidate API and
adds fixed constrained target construction, drift-aware accounting,
transaction costs, layered professional metrics, and cost/delay/risk-governor
stresses. It also emits a fixed 15-cell signal-threshold × no-trade
neighborhood with exact validation/test paths; the neighborhood is context
only and never selects a parameter. New Portfolio and RL Projects bind both
the strict Factor Population and a compatible `portfolio-mandate`:
delegated intake authorizes requested assets and direction while retaining
other panel assets as research context only. A complete optional asset-role
vector can instead assign long-only, short-only, two-sided, or context-only
duties plus fixed long/short side limits. The same Mandate fixes a causal
60-bar covariance forecast and a scale-down-only annualized volatility
ceiling. The optional Research Request `portfolioPolicy` also locks gross, a
default cap, requested-asset cap overrides, ceiling, base cost, no-trade band,
reference NAV, every-N-base-bars ordinary decision cadence, and its
dataset/session anchor; when absent, documented defaults are recorded
explicitly.
Optional `benchmarkPolicy` separately locks cash, one named dataset asset, or
one funded non-negative `fixed-weights` basket as the evaluation reference
shared by Portfolio and governed RL. Named/context-only benchmark membership
remains non-tradable and carries no order authority.
Portfolio accounting and RL rollout then recheck the final post-drift book;
risk may bypass the no-trade band using the minimum proportional repair.
`ohlcv-rl-factor-lab` adds a deterministic causal state encoder surface over
a content-locked candidate-factor sleeve plus fixed reference actions,
Q-learning, folds, seeds, rewards, portfolio accounting, and simple baselines.
All three reference templates are bounded, deterministic construction
fixtures.

`ohlcv-book-risk-lab` is the fixed descriptive route for one explicit
reported or hypothetical position-weight baseline. The request may also carry
one to eight explicitly named, complete hypothetical funded books at the same
`asOf` and base currency. It binds all normalized books as one Study
dependency, uses only content-locked closed OHLCV at or before their common
`asOf`, and publishes component risk, effective risk bets,
first-principal-component crowding, held-asset correlations, fixed-lookback
stability, one-percentage-point cash-funded reduction sensitivities, and
same-window deltas for every supplied scenario.
Instead of scenarios, `positionSizing` may freeze one direction-specific
asset/cash path. An increase declares an exact caller-owned `maximumWeight`;
a decrease declares an exact `minimumWeight`. The fixed Run admits an absent
increase asset without fabricating a baseline holding and identifies whether
the volatility ceiling, caller weight boundary, or available cash binds. Its
governing target-book evidence also includes pairwise correlations and
constant-weight maximum drawdown even when the candidate was absent from the
reported baseline.
It does not authenticate an account, replace the supplied weights with model
targets, generate or optimize scenarios, or create orders. After the Run,
`orient` closes the descriptive audit with no primary CLI action, tells the
Agent to write and return the decision-support answer, and retains the exact
read-only Explorer as a supporting evidence path instead of starting an
experiment agenda. Price Event and Allocation fixed Studies use the same
completion handoff. See
[[docs/design/reported-position-book-risk]].

`ohlcv-event-study-lab` is the fixed descriptive route for a caller-frozen,
OHLCV-observable price event. Its first contract detects one downside opening
gap, waits an exact number of complete bars, measures one close-to-close
holding return, and compares the complete event ledger with unconditional
same-asset and matched-date reference-asset returns. Intake derives strict
`strategies/event-study.json` authority from `request.eventPolicy`; adjusted
OHLCV is required, and parallel Factor, Portfolio, benchmark, or horizon
policies are rejected because the event policy owns the complete clock and
reference meaning.

The Study has no candidate source or Session. One direct immutable Run
preserves qualifying, complete, right-censored, overlap-excluded, and primary
event populations plus deterministic distributions and uncertainty. It does
not infer earnings/news labels, search thresholds, create an Order, or grant
trading authority. See [[docs/design/ohlcv-price-event-study]].

`ohlcv-allocation-lab` is the fixed Portfolio-native route for a caller who
chooses equal risk contribution rather than return prediction. It requires
explicit long-only/context roles, `allocationPolicy`, `portfolioPolicy`, and a
funded `fixed-weights` benchmark. One direct immutable Run constructs causal
ERC targets, discloses cap-induced parity gaps, applies scale-down-only risk
control, and simulates the candidate and reference independently with the same
schedule, drift, no-trade, and costs. It has no Factor, RL, candidate Session,
Order, or trading authority. See
[[docs/design/portfolio-native-allocation-lab]].

`ohlcv-research-desk` coordinates those three evaluation questions in one
Project over one dataset snapshot. Factor and Portfolio deliberately share
`factors/candidate.py`; RL owns `models/candidate.py`. The program reports
simultaneous active Sessions on the shared Factor surface as a conflict and
also reports active factor-writer/RL-reader conflicts. The RL Study binds the
exact current candidate bytes and the same fixed Portfolio Mandate as the
Portfolio lane, so factor or mandate changes stale its Run evidence.

`project intake` is the atomic fast path after research intent has been
clarified and translated into a strict request. It defaults to this
research-desk template and validates the request and a caller-supplied,
path-confined OHLCV package before binding anything. If `project create`
already established the exact selected template so an Agent could clarify
`research.md` first, intake safely hydrates that pristine scaffold and
preserves `research.md` plus `framework-needs.md`. It refuses any existing
candidate edit, data, Run, Session, or unknown file instead of replacing
worked-in research. An absent target is created atomically as before.

`--dataset` names the package manifest JSON file, not its containing directory;
a directory returns `dataset.manifest-path-required`. Every asset `path` is
resolved from the directory containing that manifest. For already staged
nested files, make the manifest directory their common ancestor:

```text
staging/
├── dataset-package.json
└── raw-ohlcv/
    ├── AAPL.csv
    └── SPY.csv
```

The manifest then uses `raw-ohlcv/AAPL.csv` and `raw-ohlcv/SPY.csv`. This
avoids an Agent-managed intermediate copy while keeping portable relative
paths, parent/absolute-path rejection, and symlink rejection. Intake still
creates the intentional normalized content-locked snapshot inside the new
Project. The generated
`research.md` remains the Agent-maintained narrative source; `request.json`
locks the understood execution assumptions and does not replace it. V1
accepts one exact daily session panel. V2 accepts a
continuous UTC 1h bar-close panel and deterministically materializes completed
3h/4h/6h/12h/1d context. Core never exposes a forming higher bar: each
namespaced value joins backward only after its close. It records the interval
surface, provider, retrieval, calendar, terms, and price-adjustment claims;
hashes source and normalized bytes; replaces the synthetic Study dataset
identity; and atomically publishes the Project. It does not download data,
authenticate provider claims, or fill missing bars.

Research Request `source.artifactPath` and `source.artifactRevision` are an
explicit pair. Set both to non-empty strings when the exact caller artifact is
known, or set both to JSON `null`. For a local immutable assignment,
`artifactRevision` may be an explicit content digest such as
`sha256:<hex>`; Core records the claim but does not authenticate its host
origin.

`provider.retrievedAt` is a required but nullable provenance claim. Use a
timezone-aware ISO-8601 string only when the original provider retrieval time
is known. Use JSON `null` when caller-supplied bytes do not preserve that
time. Never substitute Project creation time, package preparation time, file
mtime, or the current clock; unknown provenance is more truthful than invented
precision. The exact string/null is content-locked into the dataset snapshot.

V1–V4 packages may add `assetClass` to every asset row. The vector is
all-or-nothing, each value must be supported, and the top-level class must be
the shared value or `mixed`. Intake freezes the vector and matches each
requested symbol against it. Packages that omit every row-level class retain
the legacy homogeneous top-level-class behavior.

V3 accepts a bounded configurable base interval and either continuous UTC or
XNYS regular-session authority. Continuous features must be larger exact
multiples of the base. XNYS uses exchange-scheduled opens/closes, including
DST, holidays, and early closes; `1d` is one exchange session and a final
short intraday bucket completes at the scheduled close. Extended hours and
unscheduled halts remain unsupported.

V4 accepts a daily observed-only panel only with
`--template ohlcv-factor-lab`. Its exact
`panelPolicy.alignment=observed-only` and
`missingObservation=absent-no-fill` retain each asset's real dates and
listing-history start. Snapshot, Run, Factor Explorer, Studio, and Report
expose verified union coverage and time-varying breadth. Portfolio, governed
RL, and the coordinated research desk reject V4 explicitly.

V5 accepts observed-only base-bar input, including close-time-aware `1d`,
only with `--template ohlcv-factor-lab`. It requires completed timezone-aware
bar-close timestamps, one explicit non-context prediction asset, per-asset
classes, and declared volume semantics. Market closures and unmatched context
rows remain absent. Forward horizons and split purges advance on the
prediction asset's own observed bars, not elapsed time or the panel union.
At one target close, candidate code may use only context rows at or before that
exact timestamp. Asynchronous context therefore requires an explicit backward
as-of operation; the Harness does not manufacture a filled common calendar.
Portfolio, governed RL, and the coordinated research desk reject V5/V6.
For date-only cross-market daily source, use the bundled
`$package-autoquant-ohlcv` `materialize_daily_close_time.py` procedure with an
exact per-asset calendar authority manifest; Core does not infer or append
close times during intake.

V6 preserves the same Factor-only observed-bar and one-target semantics while
replacing the single top-level provider with at least two ordered,
content-addressed source-package claims. Every asset names exactly one source.
Create V6 only from complete, compatible, disjoint strict V5 packages with
the bundled `$package-autoquant-ohlcv`
`compose_observed_packages.py` procedure. It copies bytes without subsetting,
alignment, fill, transformation, or conflict resolution and emits
`composition-audit.json`. Core rejects unknown or unused source ids, duplicate
source identities or package hashes, fewer than two distinct provider claims,
and any ordinary V5 invariant violation.

The JSON result contains Project-level `request.json`, `intake.json`,
`data/ohlcv/snapshot.json`, the template's verified Study identities, and
exact next actions for inspecting the program and advancing its recommended
lane. Iterative templates publish intake status `ready-for-session` and may
offer `session.start`. Fixed Book Risk, Price Event, and Portfolio-native
Allocation templates publish `ready-for-run` and offer only inspection plus
`run.execute`; Core will not advertise a Session that those Labs reject.
V2/V3 RunResults copy the locked `dataset.intervalSurface`, and Reports, Studio,
and Dossiers project that same evidence rather than inferring intervals from
filenames.
`project program --json` is the stable Agent read model for lane phase, current
Run evidence, Sessions, Reports, shared-source conflicts, scientific
`progression` gates, and next action. Phase is coordination state only.
Current failed attempts use `scientific-limit` or `repair-required` phase and
carry `latestRun.failureDisposition`, summary, and exact errors. They never
look like `not-started` and never advertise an unchanged `run.execute`.
Portfolio requires a reported claim-positive Factor leader—
`decision-signal-positive` for a general trading-research signal,
`factor-qualification-positive` for a novel claim, or
`known-style-validation-positive` for a request-predeclared known style—and a
passing Project-family selection adjustment. Optional RL requires a reported
`post-cost-edge-positive` Portfolio leader. A terminal upstream Session that
remains blocked exposes a fresh `session start` command as optional supporting
work rather than an unfinished primary action. An initial blocked baseline
with no completed Session still requires its first Session. See
[[docs/design/research-intake-and-dataset-snapshots]] and
[[docs/design/evidence-gated-research-progression]].

## Study and Run commands

```bash
aq study intake <path> <study-id> \
  --request <book-risk-request.json> \
  [--dataset <newer-dataset-package.json>] \
  [--project ID] [--json]

aq study create <path> <study-id> \
  --subject-kind factor \
  --judge judges/evaluate.py \
  --judge-path 'judges/**' \
  (--editable 'factors/**' | --no-editable) \
  [--dependency 'models/fixed-input.py'] \
  [--request-path 'requests/recovery.json'] \
  [--position-snapshot-path 'requests/position-snapshot.json'] \
  [--upstream-run run-...] \
  [--upstream-artifact 'artifacts/selected-episodes.csv'] \
  --metric score \
  --dataset-id synthetic-bars \
  --dataset-path 'ohlcv/**' \
  --asset-class equity \
  --asset AAA/USD \
  --start 2026-01-01 \
  --end 2026-01-31

# External-package form for a new Study inside an existing Project:
aq study create <path> <study-id> \
  --subject-kind research \
  --judge judges/evaluate.py \
  --judge-path 'judges/**' \
  --no-editable \
  [--dependency 'strategies/fixed-method.json'] \
  [--upstream-run run-...] \
  [--upstream-artifact 'artifacts/selected-episodes.csv'] \
  --metric score \
  --request /absolute/path/research-request.json \
  --dataset /absolute/path/dataset-package.json

aq study list <path> [--project ID] [--json]
aq study inspect <path> --study ID [--project ID] [--json]
aq run execute <path> --study ID [--project ID] [--json]
aq run list <path> [--study ID] [--project ID] [--json]
aq run show <path> --run ID [--project ID] [--json]
aq run factor <path> --run ID \
  [--points 180] [--project ID] [--json]
aq run portfolio <path> --run ID \
  [--points 180] [--project ID] [--json]
aq run book-risk <path> --run ID \
  [--points 80] [--project ID] [--json]
aq run event-study <path> --run ID \
  [--project ID] [--json]
aq run allocation <path> --run ID \
  [--points 180] [--project ID] [--json]
aq run rl <path> --run ID \
  [--points 180] [--project ID] [--json]
```

`study intake` is a deliberately narrow continuation path for an already
request-bound `ohlcv-book-risk-lab` Project. The new strict Research Request
must preserve the original asset descriptions. Without `--dataset`, its
position as-of must fit the retained range and Core binds the exact existing
dataset bytes. With `--dataset`, Core validates one complete task-specific
package whose universe, start, market, adjustment, and economic meaning match
the original while its id/version identity changes and its end boundary is
strictly newer. It materializes that
closure under `data/studies/<study-id>/ohlcv/` and binds only the new Study to
it. Core never overwrites Project-root intake or treats a mutable `latest`
directory as authority.

Both routes create Study-owned request, position-snapshot, covariance-method,
and current Judge files, and leave the Project-root request, original Study,
Runs, and Reports untouched. The result is another fixed descriptive Study
with no editable candidate or Session. A different universe, role meaning,
clock, adjustment contract, or research question that no longer belongs to the
same evolving body of work requires task-complete intake into a sibling
Project. Local data inventory never decides which question may be studied.
When the follow-up Run is published directly, its Research Report binds the
Study-owned request frozen inside that Run; it does not inherit the original
Project-root request merely because both Studies share one Project.

`--dataset-path` is optional and repeatable. When provided it is relative to
the selected Project's `data/` directory and binds matching file bytes into
Study and Run identity.

`study create` has two exclusive dataset forms. The manual form above binds an
already materialized or custom dataset using `--dataset-id`, `--asset-class`,
`--asset`, `--start`, and `--end`. The external-package form supplies
`--request` and `--dataset` together and omits every manual request/dataset
identity option. Core strictly validates an aligned V1-V3 package, normalizes
it beneath `data/studies/<study-id>/ohlcv/`, writes the canonical request at
`strategies/<study-id>/request.json`, infers the complete Study dataset
contract, and creates the Study as one operation. If the request contains a
reported `positionSnapshot`, Core also generates and binds the matching
`position-snapshot.json`.

The external form does not infer a Judge, objective, subject, or scientific
method. Its `study-owned-ohlcv` profile establishes structural data authority
only; the fixed Judge owns the meaning of request policy fields. V4 ragged
daily and V5/V6 observed base-bar packages remain Factor-only. Generated request
files are merged with repeatable additional `--dependency` values and optional
upstream immutable Run evidence. Existing owned paths are never overwritten;
an ordinary validation or Study-creation failure removes all newly created
request, data, and Study paths.

For a Study that edits `factors/**`, `study inspect` returns the same strict
`candidateContract` used by orientation. Human output prints its base
interval, completed feature intervals, observation semantics,
context-visibility rule, interval-authority rule, and legal component roles
before input identity.

For every request-intake Project, `study inspect --json` also returns
`datasetContext`: the verified package summary, a complete symbol-to-class
map, and whether that map came from explicit per-asset declarations or the
legacy homogeneous package summary. The Study definition keeps its compact
top-level `dataset.asset_class`; consumers do not need to mistake that summary
for the complete economic inventory.

Exactly one candidate-surface form is required. Repeat `--editable` for a
Study that permits bounded candidate Sessions. Use `--no-editable` for a fixed
descriptive Study that executes only its locked Judge and can publish a direct
Run-bound Report; Orientation will not suggest `session start` for that Study.

`--dependency` is optional and repeatable. It declares fixed Project-relative
strategy/factor/model source that the Judge may import but the Study cannot
edit. Dependency files are separately hashed, frozen into Run inputs, copied
read-only into Session worktrees, and included in Study currentness.

`--request-path` explicitly assigns one exact Study-owned Research Request;
optional `--position-snapshot-path` pairs an exact position snapshot. Each must
also appear as an exact `--dependency`. These paths may live outside the normal
strategy/factor/model roots, but only as the explicitly named files—wildcard
closures do not gain that exception. Direct Run Reports then use this frozen
request instead of guessing from a directory convention or stale Project-root
intake.

`--upstream-run` and one or more repeatable `--upstream-artifact` arguments are
required together. Core resolves the immutable prior Run, fills its exact
Study/result/input/artifact hashes into the new Study, and exposes copied
evidence to the Judge at `AUTOQUANT_UPSTREAM_EVIDENCE_ROOT`. The CLI never
selects a latest Run implicitly and does not accept multiple upstream Runs.

`study create` validates the complete fixed contract immediately. `run execute`
freezes inputs, runs the Python Judge under its timeout, and atomically
publishes one immutable Run whether the Judge succeeds or fails. `run list`
and `run show` verify terminal file hashes before returning evidence.

`run portfolio` is the bounded decision-explorer projection for a successful
Portfolio Lab Run. Core verifies the immutable Run and its report, daily path,
target weights, executed weights, and per-asset decision ledger before
returning compounded gross/net/benchmark paths, drawdown, exposure, unused
cash budget, turnover/cost, the latest historical mechanical book, recent
signal transitions, validation/test attribution, exact mandate, current
pre/post volatility forecast and scale, plus governed-versus-ungoverned
diagnostic evidence. It also verifies the causal 20-observation
close-times-volume ledger and returns validation/test 1%/5% participation
capacity distributions, coverage, reference-$1m breach rates, binding assets,
and the latest rebalance envelope. These are contextual OHLCV estimates, not
impact or fill claims.
The same projection reconciles daily and per-asset executed-book risk:
forecast coverage, pretrade breaches, risk-only overrides, final breaches,
and the current executed forecast. Available final breaches are invalid
evidence, not warnings.
The same object includes `mechanicalDecision`: the latest verified
percentile-state trigger set allowed by the Mandate, current
same-cross-section distance to each entry/exit/reversal boundary, raw and
governed target, drifted pretrade and executed weight, plus proposed turnover
versus the fixed portfolio no-trade band. Core recomputes and reconciles that
turnover from the exact per-asset vectors. Distances are percentile points
with peer ranks held fixed, not prices, forecasts, probabilities, or orders;
the object carries `tradingAuthority: none`.
It also includes `sizingAnatomy`: the current verified signal conviction,
trailing own volatility, inverse-volatility strength, same-side proportional
budget, cap/water-fill redistribution, raw/governed/executed weight, and
diagonal versus covariance-aware risk contribution. Side summaries reconcile
configured, funded, and unfunded budget. The human command prints the
construction family, gross stages, cap count, component-risk concentration,
and largest contributor; it does not choose or recommend weights.
`diversificationStress` then reconstructs the exact causal covariance window
from the immutable decision ledger. It reports current effective risk bets and
a fixed 25% / 50% / 100% blend ladder toward perfect position-aligned
correlation, plus validation/test ceiling-breach rates and per-asset
stress-risk shares. The human summary prints the same ladder. It is
`context-only`, assigns no scenario probability, and cannot select, resize, or
trade.
`strategyViability` reconstructs the validation factor → gross portfolio →
friction → net chain and keeps visible test as audit only. It reports fixed
cost stresses and non-negative break-even status, return per one-way turnover,
extra-delay delta, monthly breadth, best-day dependence, and underwater
duration. The human command prints the validation stage and next bounded
research focus. This has `research-prioritization-only` authority and cannot
change KEEP/REVERT or trading authority.
`signalMonetization` then rebuilds normalized intent under the verified
prediction mode before comparing fixed sizing/caps, governed target,
historical executed gross, and executed net additive contribution. Explicit
two-asset relative value uses the capped complementary pair and permits Cash;
ordinary cross-sectional dollar-neutral intent retains the full-side-breadth
rule. The projection discloses the construction id and strictly requires pair
intent to equal the pre-governor pair target before assigning a validation-only
failure layer. Test remains visible audit.
For temporal and two-asset relative-value Runs, `translationRobustness`
strictly reconstructs the fixed 40/60/120 causal history-window surface. It
reports score availability, active-state and target-direction agreement,
target-weight delta, performance, turnover, cost, and the last reconciled
target under each profile. Validation alone labels target-path stability;
test is visible audit and no profile can be selected. Cross-sectional Runs
return an explicit not-applicable state because they have no temporal history
window. See [[docs/design/target-translation-robustness]].
For new Runs it also verifies `portfolio-position-episodes`, reconstructs
every split-bounded executed-position episode from the decision ledger, and
returns complete-episode holding/win/payoff, per-asset contribution/cost,
MFE/MAE, intent mismatch, and recent episodes. Boundary-censored segments are
named separately. These are additive portfolio-contribution diagnostics, not
standalone compounded trade returns or selection/trading authority. Legacy
Runs without the paired metric and artifact remain readable and return
`positionLifecycle.available=false`.
`--points` defaults to 180 and is bounded to 40–400; full history is
reconciled before deterministic sampling. The operation has no live account
or trading authority.

`run book-risk` is the strict read-only projection for a successful
`ohlcv-book-risk-lab` Run. Core verifies the frozen baseline and hypothetical
scenario dependency, exact method and dataset description, Run metrics,
component-risk and standardized-reduction tables, pair count and correlations,
fixed lookbacks, complete per-lookback reduction rankings on new Runs, every
scenario metric/delta/rank and primary-window per-asset contribution change,
the complete rolling path, and—on `0.8.19+` Runs—the
static-weight equity path plus maximum-drawdown interval before sampling
20–400 points.
The human view identifies the largest component-risk contributor, first
one-percentage-point reduction sensitivity, strongest pair, effective risk
bets, first-PC share, signed maximum drawdown with peak/trough/recovery,
supplied-scenario count, lowest modeled-volatility scenario in the primary
window, and the unauthenticated-position warning.
JSON returns the same evidence under `book-risk-diagnostics`. Ranking applies
only to caller-supplied books and has no selection authority. The command
neither authenticates a snapshot nor emits generated target weights or orders.
Older immutable Runs remain readable and explicitly return drawdown/equity
path as unavailable rather than fabricating retroactive evidence.

`run event-study` is the strict read-only projection for a successful
`ohlcv-event-study-lab` Run. Core verifies the immutable Run, frozen event
policy, exact three-artifact inventory, event/entry/exit timing, right
censoring, overlap eligibility, conditional and reference returns,
distributions, uncertainty, metrics, and conclusion before returning
`event-study-diagnostics`. It exposes every event row and the reference
distribution without treating the result as a strategy, event label, Order,
or live-trading instruction.

`run book-path-stress` is the strict read-only projection for a successful
`ohlcv-book-path-stress-lab` Run. Core verifies the exact five-artifact
inventory and frozen position/policy authorities; reconstructs every complete
fixed-unit window; reapplies terminal-loss ordering, earlier-start tie-break,
and greedy inclusive non-overlap selection; reconciles selected paths and
opening-weight return contribution at every offset; and checks the Run report
and metrics. JSON returns `book-path-stress-diagnostics`; the human view lists
each episode's terminal loss, worst interim loss/date, dominant holding, and
cross-episode dominance conclusion. It is historical support only and grants
no forecast, account, optimization, Order, or trading authority. See
[[docs/design/reported-book-historical-path-stress]].

`run allocation` is the strict read-only projection for a successful
`ohlcv-allocation-lab` Run. Core verifies the frozen allocation contract and
six-artifact inventory, then independently rederives candidate/reference split
performance, costs, turnover, caps, gross exposure, volatility breaches,
solver counts, train/validation/test ERC construction fidelity, latest weights,
and validation-only conclusion. The performance conclusion is explicitly
`relative-performance-only`; validation fidelity separately exposes
scheduled/eligible/within-tolerance/cap-gap counts, rate, maximum error, and
latest eligible decision. It samples 40–400 path points only after full
reconciliation and carries no account, Order, or trading authority.

For every completed fixed Book Risk, Price Event, Book Path Stress, or
Allocation Study,
`aq orient` returns `primaryAction: null`, `review.status: complete`, and an
Agent-owned write/return instruction. The corresponding strict Explorer is one
supporting read-only action and therefore remains in JSON `nextActions`,
Studio commands, and human output without masquerading as unfinished work.
For Allocation, the Agent Work Brief and human orientation also include the
strictly rederived validation ERC fidelity, so an Agent need not privately
aggregate immutable CSV evidence.
The descriptive agenda's `run.inputHash` is the immutable Run's exact
Harness-bound input hash, not its separate Study input hash.

`run factor` is the corresponding bounded professional tear sheet for a
successful fixed Factor Lab Run. Core verifies the immutable report, daily
request-bound forward-bar rank/Pearson IC, fixed-tertile,
style-qualification, and optional
candidate-declared component artifacts; reconciles every split/horizon
aggregate; then deterministically samples 40–400 timestamp anchors. The
response keeps horizon decay, quantiles, folds, causal regimes, assets, styles,
coverage, rank turnover, and component quality/redundancy/fixed-blend
leave-one-out machine-readable. Component declarations are explicit candidate
claims, never inferred column use; their ablation target is the fixed
diagnostic blend rather than arbitrary `compute_factor`. Validation
primary-horizon final-factor rank IC remains the only selection objective;
test and all other
layers are explicitly diagnostic.

`run rl` projects one successful governed RL Factor-Policy Run. Core verifies
the immutable report, learned models, complete fixed-budget training histories,
and timestamped action ledger; reconciles every declared fold/seed, baseline,
reward, action frequency, observation count, turnover, and cost; then returns
a bounded action path with exact trial, training, and model evidence.
For new Runs it also verifies the policy-rationale ledger against frozen model
weights and action chronology, then reconstructs action persistence,
transitions, uncalibrated chosen-versus-runner-up Q margins, exact linear
feature contributions, and descriptive action-conditioned outcomes. The human
view prints a compact validation behavior line; JSON exposes
`policyBehavior`. Legacy Runs without both rationale metric and artifact remain
readable with `available=false`.
Validation advantage versus each fold's fixed validation-selected baseline is
the value-add test. Test remains visible audit only, failed seeds cannot be
hidden, every action must pass the shared Portfolio Mandate audit, and
the shared causal risk governor cannot be bypassed by the editable encoder.
Every timestamped action also carries the same post-drift execution-risk
status, forecast, ceiling, override reason, and zero-breach invariant.
Factor-mixture actions carry no trading authority.

A failed Run is a successful artifact-creation operation whose RunResult has
`status: failed`; it retains errors and logs. New failed Runs also record
`failureDisposition`. `scientific-limit` may anchor a Run-bound Report over the
exact fixed question; `repair-required` must be inspected and repaired first.
`aq run show` prints the disposition and errors, and `aq orient` preserves the
current failed Run instead of recommending an identical retry. A CLI error
means trustworthy Run evidence could not be created or verified.

## Session and Experiment commands

```bash
aq session start <path> --study ID \
  [--request research-request.json] \
  [--project ID] [--json]
aq session list <path> [--project ID] [--json]
aq session show <path> --session ID [--project ID] [--json]
aq session check <path> --session ID [--project ID] [--json]
aq session compare <path> --session ID \
  [--trials 24] [--project ID] [--json]
aq session promote <path> --session ID [--project ID] [--json]
aq session complete <path> \
  --session ID \
  --report ID \
  [--project ID] [--json]

aq experiment evaluate <path> \
  --session ID \
  --hypothesis TEXT \
  [--project ID] [--json]
aq experiment list <path> --session ID [--project ID] [--json]
aq experiment show <path> \
  --session ID \
  --experiment ID \
  [--project ID] [--json]
```

`session start` reuses the newest verified successful Run when its Study,
program, editable source, Judge, dataset, dependencies, and Harness identities
all equal the current inputs. If no exact baseline exists and the Study has a
fixed candidate preflight, it first evaluates the canonical Project candidate
through that seconds-scale isolated guard. Failure returns structured issues
and creates no Run, Session, Check, or partial Session directory. Success grants
no selection or trading authority; Core then runs one fresh complete baseline
and retains the exact guard receipt in `session.baselineGuard`. A Study without
preflight preserves the direct fresh-baseline route. A reused baseline does not
rerun the operational guard merely to decorate existing evidence. Human output
prints the guard mode and JSON exposes its full provenance. Session start then
returns an Agent brief containing the disposable worktree, fixed program,
editable closure, leader, authority status, and exact next commands. The caller
edits only that worktree.
Fixed `ohlcv-book-risk-lab` and `ohlcv-event-study-lab` Studies reject Session
creation: their result is a descriptive audit to review, not an objective to
optimize through candidate selection.

With `--request`, Session start first validates the strict external question,
assets, required decision-signal `factorPolicy.predictionAssets` or a
complete-universe factor-identity claim, optional complete per-asset
`positionRole` declarations, direction,
optional complete `portfolioPolicy`, human horizon,
optional complete numerical `horizonPolicy`, hypotheses, constraints,
deliverables, and caller-supplied origin context. If one requested asset
declares a position role, all must declare one as long-only, short-only,
two-sided, or context-only. Requested assets and asset classes must fit the
selected Study. Portfolio policy values are bounded
research assumptions, not authenticated Broker/account state. Horizon policy
values are decision-bar counts on the locked dataset base clock; Core does not
infer them from prose. The primary horizon is always evaluated, so callers may
list only additional sorted diagnostic horizons. Core records their sorted
union with the primary, with no more than five total evaluated horizons.
Core copies canonical `request.json` and derives `brief.json`
from that request plus the Project, Study, baseline, dataset, Judge, and Harness
locks. Those files are verified on every Session load and are included in each
external Researcher turn. Existing local Sessions without a request remain
valid.

When strict Project intake already binds a canonical `request.json`,
`session start` uses that verified Project request by default if `--request`
is omitted. Passing `--request` remains explicit and is preferred in
Agent-facing commands because it makes delegated authority visible at the
call site. A Project without bound intake still starts an ordinary local
request-free Session when the option is absent.

Reference Studies include an optional fixed `preflight.json`. After the caller
authors the first canonical candidate, a fresh `session start` runs that short
contract before spending the first full baseline. After Session creation and a
worktree edit, `session check` runs the same structural contract in an
isolated source workspace. It publishes an immutable passed/failed
CandidateCheck bound to the exact candidate, leader, Study input, dataset,
preflight sources, and Harness. A Check contains no metric or verdict and has
no selection, promotion, or trading authority. It never creates a Run or
Experiment, advances the sequence, restores source, or changes the leader.
Failure leaves the candidate in place for repair. A later edit makes the old
Check stale.
Factor preflight validates static `FACTOR_COMPONENTS` metadata before
executing the final factor, so an illegal role is rejected without spending a
formal Experiment. Its bounded panel contains up to two position-capable Study
assets plus every fixed context asset and named benchmark asset from the
Study-bound Portfolio mandate, all capped at 256 timestamps. The passing Check
message names the exact decision and reference assets it exercised. Studies
without usable fixed reference metadata retain deterministic first-two-asset
behavior. The same edit-time shape is independently discoverable through
`aq schema factor-candidate-contract --json`.

`aq orient` uses this feedback tier when present: unchanged candidate asks for
an edit; a changed unchecked candidate points to `session.check`; a failed
candidate asks for repair; and a passed exact candidate points to
`experiment.evaluate`. Legacy Studies without a preflight continue directly
to formal evaluation. Direct formal evaluation remains available because only
the complete Judge owns selection evidence.

`experiment evaluate` freezes the candidate into a canonical Run, compares the
primary metric with the current leader, publishes immutable Experiment
evidence, and returns `KEEP`, `REVERT`, or `CRASH`. REVERT and CRASH restore the
leader bytes in the worktree. Its CLI envelope also returns
`verdictAuthority.scope: session-objective-only` and explicitly denies
scientific qualification, downstream admission, and trading authority. A
`experiment show` repeats the same authority object and human disclosure for a
replacement Agent inspecting immutable history. `session promote` is the only
operation that copies a KEEP into Project source; it rejects a stale Project
base and rolls back if the source, receipt, and Session pointer cannot all be
committed.

When an Experiment restores the current leader and the Session remains active,
orientation returns `trial-review-required` instead of declaring that another
edit is mandatory. A delegated Session exposes `report.publish` and read-only
`session.show` as supporting choices. The Agent/caller may freeze and report
the current prefix or explicitly declare another bounded hypothesis; Core
neither infers a prose trial budget nor starts the next edit. After a
baseline-retaining Report exists, exact `session.complete` becomes the primary
action.

When REVERT or CRASH restores an unchanged baseline after at least one trial
and the verified Portfolio agenda says `no-further-in-sample-tuning`,
orientation returns `in-sample-freeze-ready`, observe mode, no primary edit
action, and a supporting read-only `session.show`. It does not close the
Session or forbid explicit new research; it stops presenting more in-sample
tuning as the default next step.

`session complete` is the no-promotion terminal path for a delegated lane whose
leader remains its baseline. The caller selects the exact current Report.
Core rejects a changed worktree, incomplete Report prefix, running Campaign,
unpromoted KEEP, stale authority, or terminal Session. It writes immutable
`completion.json`, marks the Session `completed`, and leaves Project source
unchanged. A completed Session cannot run Experiments/Campaigns, publish later
Reports, promote, or complete again.
When that receipt, its exact Report, current Study authority, and retained
leader all remain valid, `aq orient` treats the work as complete: it has no
primary action, exposes the Report id, and lists Session inspection plus a new
Session only as optional supporting work. Core does not infer this state from
request prose or a trial count.

`session promote` is the source-changing terminal path for a KEEP. A delegated
Session must first publish a Report that freezes the exact current request,
leader, Experiment prefix, and Campaign prefix, then pass that Report id:

```bash
aq session promote . <session-id> --report <report-id>
```

Core records the Report identity in the immutable promotion receipt. A stale
or partial Report cannot authorize source mutation. Non-delegated local
Sessions retain the report-free promotion path. Promotion preserves the best
source but does not assert scientific qualification. When the terminal receipt
still matches current authority and leader evidence, `aq orient` has no
mandatory next Session; inspection and an explicit new Session are supporting
choices.
source and terminally closes the Session as `promoted`; it does not assert
Factor qualification,
Portfolio/RL admission, or trading authority. Consequently an improved KEEP
that remains scientifically unqualified is still promoted as source while its
Report records the failed gate. `session complete` is the mutually exclusive
baseline-retaining close path and is neither required nor valid afterward;
such an attempt returns `completion.already-promoted`.

For the Factor Lab, `run execute/show --json` and Experiment output preserve
the full purge-aware factor tear sheet: request-bound forward-horizon quality,
HAC
inference, fixed-tertile behavior, style overlap, and asset/fold/causal-regime
stability. Studio is a concise projection; exact daily IC/regime and quantile
rows remain Run artifacts.

For the Portfolio Lab, the same commands preserve the fixed signal policy,
dataset-fixed purged splits, hysteresis comparison, contribution
reconciliation, and attribution by asset, signal intent, and causal regime.
Proposed/executed weights and the exact per-asset decision path remain
immutable Run artifacts; Studio is the concise human projection.

`session show --json` also projects selection integrity from verified evidence:
selection metric/split, exact candidate and evaluated-Run counts, verdict
counts, test visibility/use, first-candidate versus post-audit iteration state,
and whether a new external holdout is required. `testGuidanceObservability`
remains `not-observable`: Experiment order proves when source changed relative
to visible evidence, not whether a person or Agent actually used it.
It additionally includes the Project-wide fixed-evaluation `researchFamily`
with unique-source and duplicate-execution counts plus a Core-authored
`selectionAdjustment`. Factor Studies use Bonferroni-adjusted HAC evidence,
Portfolio Studies use probabilistic/deflated Sharpe and minimum track record,
and aggregate fold/seed RL objectives return an explicit unsupported reason.
The adjustment is diagnostic only. Reference templates select on validation
only; generic Studies return explicit `unspecified` or unsupported values.
Human `session show` output repeats the exposure state, post-audit candidate
count, and holdout requirement rather than collapsing them into a
“test-guided” label.

`session compare` verifies the immutable Session, Experiment chain, and
referenced Runs before producing one bounded baseline/candidate/leader matrix.
`--trials` defaults to 24 and is bounded to 1–100; the current leader and
baseline remain visible even when older candidates are omitted. Core owns the
metric dictionary, units, preference direction, comparable set, and
validation-only non-dominance calculation. Test values are explicitly labelled
audit evidence, contextual policy state is display-only, and neither can
change an Experiment verdict. Failed candidates remain explicit rows without
invented metrics.

## Research Campaign commands

```bash
aq research run <path> \
  --session ID \
  --agent-command SHELL \
  [--max-turns 5] \
  [--max-wall-seconds 900] \
  [--turn-timeout-seconds 300] \
  [--project ID] [--json]
aq research list <path> --session ID [--project ID] [--json]
aq research show <path> \
  --session ID \
  --campaign ID \
  [--project ID] [--json]
```

`research run` invokes the explicit shell command in the Session worktree. A
fresh structured brief is provided on stdin every turn. The command edits the
declared candidate closure and returns exactly one strict JSON `propose` or
`stop` response. Valid proposals are evaluated through the existing fixed
Judge and Experiment path; they cannot supply metrics, verdicts, or promotion.

The aggregate and per-turn budgets are mandatory and bounded. Command exit,
timeout, malformed response, illegal fixed-source changes, unchanged
proposals, and changed-source STOP responses terminate the Campaign as
`failed` and reconstruct the worktree from verified fixed inputs and leader
Run evidence. `research list` and `research show` verify every Campaign file
hash and referenced Experiment.

The external command is explicit host-code execution, not an OS sandbox.
Callers that require stronger isolation can wrap the same stdin/stdout
protocol in their own sandbox.

## Research Report commands

```bash
aq report draft <path> \
  (--session ID | --study ID --run ID) \
  [--output report-analysis.json] \
  [--project ID] [--json]
aq report publish <path> \
  (--session ID | --study ID --run ID) \
  --analysis report-analysis.json \
  [--corrects REPORT_ID \
   --correction-review REVIEW_ID_OR_PACKAGE_PATH \
   --correction-reason TEXT] \
  [--project ID] [--json]
aq report list <path> \
  [--session ID | --study ID] \
  [--project ID] [--json]
aq report show <path> \
  [--session ID] \
  --report ID \
  [--project ID] [--json]
```

`report draft` verifies exactly one publishable Session or direct-Run anchor
and writes one new Project-confined analysis scaffold. It never overwrites,
creates missing parent directories, follows a symlink parent, or accepts a
path outside the selected Project. The default is `report-analysis.json`.
Every declared artifact of the exact leader Run is prefilled as an evidence
reference; the command does not interpret any artifact or write a conclusion.

The returned object is schema-valid with `authoringState: draft` and a reserved
instructional finding. Publication rejects both until the Agent replaces the
placeholder content and sets `authoringState` to `final`. Older completed
analysis objects may omit the optional authoring field. Use
`aq schema report-analysis --json` when authoring without the scaffold.

`report publish` accepts exactly one evidence anchor. `--session` publishes a
Session-owned Report over the verified Experiment/Campaign prefix. `--study`
plus `--run` publishes a Project-owned Report directly over one successful,
current immutable Run in a verified request-driven Project. The direct Run
route creates no Session, Check, Experiment, completion, or promotion state.
Use it for a frozen baseline or fixed delegated reproduction; use the Session
route when the conclusion depends on candidate iteration.

The three correction options are an all-or-none extension of the direct Run
route. `--corrects` must name a current terminal Run Report over the same exact
Run anchor. `--correction-review` accepts either an attached Review id or a
detached Review package path and must target that exact prior Report.
`--correction-reason` is frozen as durable lineage. Session Report correction
is intentionally unsupported.

The Agent-authored analysis is strict JSON: title, executive summary, findings
with confidence, conditional recommendations, limitations, unresolved
questions, and exact evidence references. A Run reference may also name one of
that Run's declared artifact paths. Session Reports may additionally cite
Experiments and Campaigns; Run Reports reject those kinds. Every
recommendation contains all four fields: `action`, `rationale`, `conditions`,
and `evidenceRefs`.

`aq schema report-analysis --json` carries the executable reference contract
and one complete copyable analysis example. Start from that complete object
rather than reconstructing nested required fields from a truncated schema
view. Copy a Run artifact path exactly from that Run's
`result.artifacts[].path`; it is relative to the Run and already begins with
`artifacts/`. Do not prefix it with `runs/<id>/`, a Project path, or a
filesystem path. Experiment and Campaign evidence have no separately
selectable declared artifact, so their required `artifactPath` field is
`null`:

```json
[
  {
    "kind": "run",
    "id": "run-20260730T120000000000Z-example",
    "artifactPath": "artifacts/factor-report.json"
  },
  {
    "kind": "experiment",
    "id": "exp-0001-example",
    "artifactPath": null
  }
]
```

Core does not write the conclusions. It validates every reference against the
selected anchor and freezes its exact Run metrics, Study locks, Harness,
dataset, request, selection integrity, and decision-support evidence. A
Session Report additionally freezes the current baseline/leader, Experiment
and Campaign prefix, and Brief. Publication is atomic. Run Reports live at the
Project root; Session Reports remain under their owning Session:

```text
<project>/reports/report-.../             # anchor.kind = run
<project>/sessions/<session>/reports/...  # anchor.kind = session
```

`report.md` is rendered deterministically for human or Agent review.
`report.json` is the machine-readable evidence projection. Both declare
`quantitative-decision-support` authority and `tradingAuthority: none`.
New Reports bind `leaderDecisionSupport` to the exact leader Run/result hash.
For Portfolio leaders it freezes the Core-verified historical mechanical
decision, sizing anatomy, diversification stress, strategy viability
diagnosis, and their hashes; Factor/RL leaders carry explicit null Portfolio
evidence. Human
`publish`/`show`, JSON summaries, and Studio identify the snapshot timestamp,
execution gate, cap count, effective risk bets, correlation-breakdown ladder,
and validation failure stage. Reports created before newer optional snapshots
remain loadable without backfilling; legacy Reports may omit the entire
decision-support field.
Every CLI/JSON summary exposes `anchor.kind`, Study, Run, and nullable Session
identity. `report list` with `--session` searches that Session; without it the
command searches Project-owned Run Reports and may filter by `--study`.
Run Report summaries also expose `current`, `supersededBy`, `lineageDepth`,
and the exact optional correction object. `report show` verifies and returns
the same lineage. A later timestamp alone never means correction authority.

A corrected Report embeds the complete governing Review package beneath
`governing-review/<review-id>/`. Loading verifies that package against the
prior Report and Run, while listing rejects missing, cyclic, branched,
cross-Project, cross-anchor, or already-superseded correction targets. The
prior Report and original attached/detached Review remain unchanged.

Later Session research does not reinterpret an older report; its frozen
Experiment/Campaign catalogs must remain chronological prefixes of the
verified history. The artifact is complete for standalone review or direct
Agent-to-Agent delivery. When OpenAlice publishes the exact Markdown through
Inbox, OpenAlice—not AutoQuant—stamps authoritative Workspace, Session, and
document-revision provenance.

## Independent Research Review commands

```bash
aq schema review-analysis --json
aq review publish <path> \
  --report REPORT_ID [--session SESSION_ID] \
  --analysis review-analysis.json \
  [--output EXTERNAL_DIRECTORY] [--project ID] [--json]
aq review list <path> [--report REPORT_ID] [--project ID] [--json]
aq review show <path> --review REVIEW_ID [--project ID] [--json]
aq review show <detached-review-directory> [--json]
```

A Review independently classifies claims in one completed Report and its exact
anchor Run. It is not a new Run or primary Report. The strict analysis uses
`verified`, `declared`, `observed-unbound`, and `unverified`; every claim has a
rationale and explicit evidence references except that an unverified absence
may intentionally cite none. Bound classifications may reference only the
exact target Report/Run. An `observed-file` is resolved beneath the Project or
Workspace entry root and freezes path, size, and SHA-256 with
`observed-unbound` authority; it never becomes Run evidence.
The positional `<path>` deliberately chooses that observation boundary. Use a
direct Project path only for Project-relative observed files. To cite
Workspace-owned material such as `staging/comparison.json`, enter through the
Workspace root and pass `--project PROJECT_ID`; Core will not silently widen a
Project entry into its surrounding Workspace.

Without `--output`, publication atomically attaches the package under
`<project>/reviews/review-.../`. With `--output`, Core creates the same
`review-*` package beneath an external directory and rejects destinations
inside the reviewed Project or observation root. Detached mode is intended for
strict audits that must leave the target Workspace byte-for-byte unchanged.
Direct `review show` verifies its internal manifest without requiring target
mutation; attached `show` additionally reloads and verifies the frozen target
Report and Run. See [[docs/design/independent-research-reviews]].

## Project Research Dossier commands

```bash
aq dossier status <path> [--project ID] [--json]
aq schema dossier-analysis --json
aq dossier publish <path> \
  --analysis dossier-analysis.json \
  [--project ID] [--json]
aq dossier list <path> [--project ID] [--json]
aq dossier show <path> \
  --dossier ID \
  [--project ID] [--json]
```

A Session Report is one lane's point-in-time answer. A Project Research
Dossier is the cross-lane deliverable. `dossier status` uses the canonical
Research Program to require Factor, dynamically require Portfolio only after a
positive frozen Factor qualification, and admit governed RL only after
positive frozen Portfolio post-cost evidence. RL remains optional. Missing
gated or optional evidence is not silently ignored: its admission state,
omission, and reason are frozen into the Dossier. This permits Factor-only and
Factor-plus-Portfolio early-stop handoffs.

The Agent authors strict cross-lane analysis whose references select exact
included `laneId`, `reportId`, and optional Report `findingId`. Core verifies
coverage of every included lane and atomically publishes:

```text
dossiers/dossier-<UTC timestamp>-<identity>/
├── analysis.json
├── dossier.json
├── dossier.md
└── manifest.json
```

The Dossier freezes request, dataset, Research Program, lane Study, Report,
leader Run, selection-integrity, Harness, source/dependency, omission, and
analysis identities. It inherits any leader-decision-support snapshot from the
exact included Report rather than recomputing a current decision. It requires
Portfolio and included RL evidence to use the same fixed mandate and renders
the authorized/context-only asset boundary.
Later lane research does not invalidate an older point-in-time Dossier.
`dossier.md` is the exact decision-support document for local review,
Agent-to-Agent delivery, or optional host publication. When OpenAlice is the
host, it may publish that file through its own Inbox authority; AutoQuant has
no trading or authenticated host-provenance authority.

## Frozen external holdout commands

```bash
aq holdout create-target <source> <workspace-dir> <project-id> \
  --dossier ID \
  --dataset <later-dataset-package.json> \
  [--source-project ID] \
  [--name NAME] \
  [--json]
aq holdout bind <source> <target> \
  --dossier ID \
  [--source-project ID] \
  [--target-project ID] \
  [--json]
aq holdout status <path> [--project ID] [--json]
aq holdout run <path> [--project ID] [--json]
aq holdout assess <path> --analysis FILE [--project ID] [--json]
aq holdout show <path> [--project ID] [--json]
aq schema holdout-binding --json
aq schema holdout-result --json
aq schema holdout-assessment-analysis --json
aq schema holdout-assessment --json
aq schema holdout-status --json
```

`holdout create-target` is the preferred Agent path when the later Project
does not exist yet. Core loads the source Project's current Dossier, reuses its
canonical `request.json`, validates the caller-supplied strictly later dataset
against only the Dossier-included lanes, creates an ordinary
`ohlcv-research-desk`, and freezes the binding as one atomic operation.
Factor-only targets require at least 120 rows and enough fixed validation rows
to retain 20 observations after the primary forward horizon; included
Portfolio raises the floor to 180 rows and included governed RL to 240. A
secondary diagnostic horizon with fewer than 20 later observations remains
visible as insufficient evidence instead of erasing a usable primary
objective. Any source, compatibility, overlap, target-id, intake, or binding
failure leaves neither a target Project nor a Workspace configuration change.

`holdout bind` accepts a current immutable source Dossier and a separate fresh
`ohlcv-research-desk` Project already constructed from caller-supplied later
data. V1 requires the exact request, universe, market/adjustment/interval
contract, a different dataset identity, no prior target research history, and
`target.start > source.end`.

Core imports exact Factor and optional RL source bytes from the Dossier leader
Runs, freezes their hashes and portable Dossier evidence under `holdout/`, and
binds the target Study/Judge/dataset identities. A bound target rejects
`session start`, Research Campaigns, and generic `run execute`; only
`holdout run` may execute the Dossier-included lanes. Interrupted partial lane
execution is resumable, but each lane can publish at most one Run and repeated
terminal invocation returns the same immutable result.

The result compares the original objective with the strictly later-period
objective and observed delta for each lane. It is an
`external-temporal-audit`, not another selection round. Holdout-authorized
Runs record that evaluation role separately from ordinary
`research-selection` Runs. There is no universal pass threshold, automatic
promotion, production approval, Broker action, or trading authority.

A terminal result is `completed`, not yet a finished research answer.
`holdout show` exposes one bounded Core-verified source/later evidence
projection, including lane decision support and the Factor horizon or
Portfolio target-translation diagnostics needed for interpretation.

`holdout assess` accepts the strict `autoquant-holdout-assessment-analysis`
JSON contract. It requires every frozen lane exactly once and publishes one
immutable analysis/evidence/Markdown bundle bound to the result. Overall and
lane judgments are explicitly Agent-authored; Core validates provenance and
completeness but supplies no universal pass threshold. Successful publication
advances state to `assessed`, after which `holdout show` verifies both result
and Assessment.

## Studio commands

```bash
aq studio snapshot <path> [--project ID] [--json]
aq studio serve <path> \
  [--project ID] \
  [--host 127.0.0.1] \
  [--port 8765] \
  [--no-open]
```

`studio snapshot` builds one Workspace or direct-Project observation through
the same verified Core loaders used by other commands. It includes fixed
Studies, immutable Runs, Session/Experiment history, terminal Campaigns, and
explicitly mutable in-progress Campaign telemetry. Delegated requests, Research
Briefs, immutable Reports, and Core-generated copyable CLI commands are in the
same read model. For canonical multi-Study Projects the snapshot also includes
Dossier readiness, blockers, explicit optional-lane omissions, immutable
Dossier summaries, frozen external-holdout binding/result state, and the exact
publish, run, or show command.

`studio serve` is a foreground `long-running-server` operation. It serves the
packaged read-only browser presentation and the same snapshot contract. It
does not support `--json` because its stdout announces a live URL rather than
one terminal envelope. Loopback is the default; non-loopback binding is an
explicit operator choice and V1 has no authentication.

When `HARNESS_CAPABILITY=studio`, the command enters strict Harness-managed
launch. It requires `HARNESS_HOST` and JSON `HARNESS_PORTS` with exactly the
manifest-declared names—currently one integer `http` port in `1..65535`—binds
that exact endpoint, and fails instead of finding another port. Managed hosts
are limited to `localhost` or canonical IPv4 `127/8` literals. Missing or extra
port names, unsupported hosts, and conflicting explicit `--host`/`--port`
values are invalid, while equal repetitions are allowed.
`HARNESS_NO_OPEN=1` forces no-browser operation. The manifest command is
`uv run --frozen --no-sync aq studio serve . --no-open`: first prepare the
source Workspace with `uv sync --frozen`; launch itself never synchronizes
dependencies. Other capability values do not alter standalone defaults,
flags, or response security. See
[[docs/STUDIO]].

## Success envelope

```json
{
  "schemaVersion": 1,
  "ok": true,
  "command": "project.create",
  "context": {
    "scope": "project",
    "project": {
      "id": "factor-lab",
      "name": "Factor Lab",
      "rootDir": "/absolute/path/projects/factor-lab"
    }
  },
  "data": {},
  "diagnostics": [],
  "artifacts": [
    {
      "kind": "project",
      "id": "factor-lab",
      "path": "/absolute/path/projects/factor-lab/autoquant.json",
      "immutable": false
    }
  ],
  "nextActions": [
    {
      "id": "validate",
      "description": "Validate the newly created Project.",
      "argv": [
        "aq",
        "validate",
        "/absolute/path/projects/factor-lab",
        "--json"
      ],
      "effect": "read-only"
    }
  ]
}
```

Contexts are `global`, `workspace`, or `project`. Artifacts name an identity,
path, kind, and mutability. `nextActions.argv` is directly executable and its
effect is explicit.

Current operation effects are:

- `read-only`;
- `creates-artifact`;
- `mutates-workspace`;
- `mutates-project`;
- `long-running-server`.

Only `session.promote` currently uses `mutates-project`, after locked-history,
stale-base, source-hash, and rollback checks. `studio.serve` is the only
`long-running-server`; its routes are fixed and read-only.

## Error envelope

```json
{
  "schemaVersion": 1,
  "ok": false,
  "command": "project.create",
  "context": {
    "scope": "global"
  },
  "error": {
    "code": "validation.failed",
    "message": "Must be a lowercase kebab-case id",
    "retryable": false,
    "issues": [
      {
        "path": "project_id",
        "code": "schema.id",
        "message": "Must be a lowercase kebab-case id"
      }
    ]
  }
}
```

## Exit behavior

- `0`: success;
- `1`: validation or operation failure;
- `2`: CLI usage failure.

When `--json` is present, validation and usage failures still emit one JSON
error envelope. Human errors are written to stderr.

## Packaging and invocation

The repository installs the command as a Python project:

```bash
uv sync --frozen
uv run aq capabilities --json
```

`python -m autoquant` is an equivalent source-tree entry point.

## Current boundary

This CLI owns Workspace/Project lifecycle, fixed Study and immutable Run
evidence, the governed Session/Experiment edit/evaluate/promotion loop, and
bounded provider-neutral Researcher Campaigns. `aq` is the only current command
family; the repository-root Classic/Freqtrade arena is retired. Local or
delegated request/Brief/Report state is Project-local and has no authenticated
host provenance or live-trading authority. The local Studio projects the
current read model.
Richer robust comparison and Studio mutation operations remain separate future
surfaces. See [[docs/design/retired-flat-freqtrade-harness]].

## Verification

```bash
uv run aq capabilities --json
uv run python -m unittest \
  tests.test_cli tests.test_studies tests.test_runs tests.test_sessions \
  tests.test_research tests.test_reports tests.test_studio -v
```
