# AI-first Agent operator experience

Status: implemented for the V2 Agent Work Brief, evidence-driven research
agenda, and read-only orientation surface.

Related: [[docs/design/agent-cli-contract]],
[[docs/design/agent-native-quant-workbench]],
[[docs/design/research-program-orchestration]],
[[docs/design/research-session-loop]],
[[docs/design/external-researcher-driver]],
[[docs/design/evidence-driven-research-agenda]],
[[docs/design/studio-observation-surface]], and
[[docs/design/study-run-evidence]].

## Purpose

AutoQuant is operated primarily by coding Agents. A human, a local Agent, or a
coworker in a host such as OpenAlice may supply the question. Humans define or
approve intent, review evidence, and accept or reject the result. The default
operating surface must therefore optimize for a new Agent to sit at an existing
Workspace desk and take one correct bounded action, while preserving a concise
truthful review surface for humans.

The interface is not a larger prompt. It is a verified Core work contract:

```text
Workspace / Project path
+ verified request and Project construction
+ current Study / Session / Run / Report state
+ scientific progression and conflicts
+ verified diagnosis and bounded experiment briefs
+ fixed authority and editable closures
→ Agent Work Brief
├── aq orient --json
├── concise human terminal projection
└── Studio decision brief
```

Existing detailed objects remain available for deep inspection. Orientation
answers what the operator should do now and why.

The brief must work without an external orchestrator. Host Session identity,
cross-Workspace communication, and authenticated provenance may add context,
but Project files and Core evidence remain sufficient to orient a replacement
Agent. Standalone and hosted operation use the same brief contract.

Question authority is explicit and ordered. When the focused Study declares an
exact Study-owned request, Core uses that frozen authority with
`origin: study-request`; this prevents a continuation from inheriting a stale
Project-root question. Otherwise a validated delegated intake request freezes
caller-owned intent. Core may next accept a Project-root strict request only
when its canonical hash exactly
matches `source.requestHash` in at least one currently declared fixed Study
dependency. That locally constructed authority uses
`origin: project-request`; an invalid, symlinked, tampered, or unbound request
is never projected.

Without either verified request, Core reads the manifest-declared research
program and extracts only a non-empty section headed `Question`, qualified
`Question ...` such as `Question (bounded, falsifiable)`,
`Research question`, `Research question ...`, or `Fixed question`. That
bounded Markdown section uses `origin: project-research-brief` and returns its
absolute `sourcePath`. Core does not infer intent from arbitrary prose; when no
recognized section exists it safely falls back to the Project manifest
description with `origin: local`. `requestPath` remains null for a
Markdown-derived question.

The repository clone is itself the default Workspace. Harness source,
checked-in `projects/`, and one complete three-lane sample therefore share one
filesystem search surface. A new Agent can use `aq project list .`,
`aq orient .`, ordinary grep/glob, and Studio without first constructing or
locating a second desk. The sample's historical `0.8.7` Factor Run is explicit
orientation evidence, not authority to reuse that sample for an unrelated
caller question.

## Operator and reviewer roles

The Agent is the principal research operator. It may:

- inspect verified context and evidence;
- record a concrete Project-observed Workbench gap in `framework-needs.md`
  at the canonical Project coordination surface, outside an active candidate
  edit/evaluate operation, without changing fixed research authority;
- start an explicitly offered bounded operation;
- edit only the candidate closure inside an active Session worktree;
- propose a falsifiable hypothesis;
- evaluate through the fixed Judge;
- inspect immutable verdict and diagnostic evidence.

The Agent may not:

- change the request, dataset snapshot, Study, Judge, objective, mandate, gate,
  immutable history, or promotion rules;
- treat visible-test diagnostics as selection evidence;
- copy candidate source into the canonical Project outside the guarded
  promotion operation;
- infer trading authority from research weights, Reports, or Dossiers.

The human is the intent owner and evidence reviewer. Human review does not
create a second evaluator: Studio displays the same Core work brief and
evidence that the Agent receives.

An external coworker may delegate or discuss a task, but does not become the
quantitative evaluator. Its message is caller context until AutoQuant binds it
to a Project request and fixed research authority.

## Assignment clarification before orientation

The verified Agent Work Brief orients work after enough Project authority
exists to derive current state. It does not replace the earlier act of
understanding an assignment.

For a genuinely new question, the Quant Agent uses `aq project create` to
establish a self-contained construction site, then reads and updates the
returned Project-root `research.md` in English. Before downloading data,
editing research source, training, or evaluating, the Agent must make the
decision context, question, scope, horizon, evidence, caller-owned constraints,
evaluation meaning, deliverable, assumptions, unresolved questions, and
proposed route explicit.

The Agent chooses research methods using domain judgment. It asks the
delegating Agent or user whenever missing intent could materially change the
universe, direction, horizon, risk interpretation, benchmark, evaluation, or
usefulness of the answer. Clarification repeats until the question is bounded
and falsifiable. Conversation may use the caller's language; Project working
materials use English, and the user-facing Agent may translate the final
evidence.

Strict requests and manifests are derived after this step. They make understood
authority machine-verifiable but are not an automatic intake parser or a
substitute for the living Markdown brief.

## Agent Work Brief

The V2 brief is compact, strict, and derived entirely from verified current
state. It contains:

- identity: Workspace/Project and optional delegated request;
- objective: current research question, its study-request, delegated-request,
  project-request, project-research-brief, or local-fallback origin, source
  path when present, and selected Study objective;
- continuation: the optional exact prior Run/Study/result/input/artifact
  binding that makes the focused Study a terminal continuation;
- candidate contract: for a focused Factor edit, the actual Project base
  interval, completed feature intervals, panel columns, component metadata
  fields, and legal roles; unavailable columns are explicit rather than
  inferred from reusable template branches;
- factor split contrast: a nullable visibility-only comparison of primary-
  horizon train and validation mean rank IC. It appears only when the absolute
  gap is at least `0.20`, identifies the exact Run and values, retains
  validation as the sole selection split, and never becomes a gate or verdict;
- focus: lane, Study, coordination phase, scientific stage, and operating
  mode;
- evidence: current Run/Session/Report/Dossier identities needed to understand
  the focus, without embedding raw histories or complete diagnostics;
- blockers: stable reason codes, explanations, and whether they arise from
  missing coordination evidence, scientific admission, staleness, or source
  conflict;
- authority: selection split, visible-test role, research authority, and
  `tradingAuthority: none`;
- research agenda: zero to three deterministic Factor, Portfolio, or
  governed-RL experiment briefs derived from the current immutable leader
  evidence, each with editable targets, typed evidence references, validation
  checks, stop conditions, and one Core-derived move role distinguishing
  current research guidance from optional post-trial follow-up;
- filesystem contract: the exact operating root, candidate-editable patterns,
  and protected authority categories;
- primary action: at most one existing Core-generated command with exact
  `argv`, working directory, operation effect, and expected evidence kind;
  an Agent-owned source edit remains explicit review guidance rather than a
  fake command;
- supporting actions only when their effect is explicit and they materially
  help the current decision; these are normally read-only, while a
  creates-artifact continuation may appear without a primary action only when
  terminal evidence labels it explicitly optional. When Report publication is
  primary, `report.draft` may appear first as an optional, exact-anchor
  authoring scaffold; publication remains the required lifecycle action.

The brief does not copy the entire program projection. A caller may use the
referenced detailed command when it needs full lane, Run, Session, or report
history.

Multiple uncoordinated Studies still produce `study-selection-required`. The
one narrow exception is a complete single-parent chain: if all Studies form one
connected acyclic sequence and exactly one Study is terminal, Core focuses that
terminal continuation and discloses its upstream binding. It never chooses by
timestamp, guesses between branches, or treats a general multi-Study Project as
a workflow graph.

The research agenda does not replace the primary action. It says which
scientific change is worth testing after the lifecycle permits an edit;
`primaryAction` still says whether the operator must establish a baseline,
start a Session, run preflight, evaluate, publish, complete, or promote. Agenda
moves have no operation effect and cannot execute themselves.

`researchAgenda.moveRole` is part of the hashed Work Brief. It is
`current-research-guidance` during active bounded preparation,
`optional-follow-up` when immutable trial history exists and no required
primary action remains (or terminal required research is complete), and
`unavailable` when there are no moves. Core derives this from verified
lifecycle state, never by parsing a caller's Markdown experiment budget.

Factor moves can prioritize explicitly declared components, but they never
infer Python provenance or claim that a fixed diagnostic-blend removal is an
arbitrary final-factor ablation. Portfolio moves can change only the factor
closure; fixed Mandate, sizing, risk, execution, and cost rules remain
evaluation pressure. RL moves can change only the causal encoder; fixed
factors, actions, rewards, learning rules, and Portfolio mechanics remain
protected. Positive validation evidence may intentionally produce a
freeze-and-external-holdout move instead of another in-sample edit.
If REVERT or CRASH has already restored an unchanged baseline and this agenda
is active, the lifecycle follows the freeze: observe mode, no primary edit,
and read-only Session inspection. A newly opened Session with no trial still
retains its normal edit path, but the brief explicitly limits that authority
to a predeclared bounded alternative and distinguishes it from open-ended
tuning.
For other agendas, a restored leader with immutable trial history enters
`trial-review-required`, not `candidate-edit-required`. The Agent can publish
and complete the current evidence prefix or deliberately declare another
bounded hypothesis; Work Brief writability is never phrased as mandatory
continuation. `latestExperiment` retains the trial verdict, candidate Run, and
preceding Check even after the current candidate becomes the leader again or
the Session closes.
Once such a Dossier is bound into a later Project, the work brief switches to
`external-audit`, exposes no editable paths, routes only to `holdout.run`, and
marks the research agenda unavailable because candidate selection is frozen.
After the terminal Runs it enters `publish-evidence`, exposes only the
`holdout-analysis.json` draft boundary, supplies verified `holdout.show` as the
supporting read, and routes to `holdout.assess`. Only a verified immutable
Assessment returns the desk to `observe` with
`external-holdout-complete`; objective scalars alone are not a completed
caller handoff.

## Operating modes

Operating modes summarize existing state; they do not replace it.

- `observe`: choose a Project or inspect a terminal/complete result.
- `establish-baseline`: execute missing or stale immutable baseline evidence.
- `edit-and-evaluate`: operate only inside an active Session worktree and
  evaluate one hypothesis.
- `publish-evidence`: freeze the current leader and evidence prefix in a
  Report or Dossier.
- `external-audit`: execute the exact Dossier-bound source once on the
  strictly later Project; no candidate edit or selection is permitted.
- `complete`: retain a reported baseline or finish required cross-lane
  research without changing candidate source.
- `promote`: apply an accepted non-baseline Session leader through the existing
  guarded promotion operation.

One brief has exactly one primary mode and at most one primary action.
`establish-baseline` never hides a current failed attempt. A
`repair-required` Run routes first to read-only `run.show`; a
`scientific-limit` Run routes to its one reportable bounded conclusion and then
returns to terminal `observe`. Only changed source or fixed authority makes a
prior failed attempt stale enough to establish new baseline evidence.
After a terminal Session leaves a coordinated lane scientifically blocked,
orientation switches to `observe`, returns no primary action, and retains
another governed Session only as an optional supporting command. This is a
truthful stopping point, not a prohibition on further research. The first
Session after an unqualified baseline remains primary because no bounded
attempt has yet completed.

A verified current Research Dossier supersedes lower-level lane progression as
the caller-handoff state. This includes a scientifically valid early-stop
Dossier whose upstream rejection intentionally gates later lanes. Orientation
uses `required-research-complete`, returns no primary action, exposes exact
`dossier.show` only as supporting inspection, and marks any remaining
evidence-derived agenda as optional follow-up. A Dossier whose evidence no
longer matches current publication evidence does not hide newer required work.

After a fixed Book Risk, Price Event, or Allocation Study has current
successful evidence, `observe` likewise has no primary action. `review.next`
instructs the Agent to write and return the decision-support answer; the exact
verified Explorer remains supporting read-only evidence access. Markdown
authoring and outward communication remain Agent-owned work, so Core does not
invent a `review.write-*` command.

For Allocation, the Work Brief additionally projects Core-verified validation
ERC construction fidelity. This prevents an Agent from privately aggregating
the decision ledger or treating a validation performance verdict as evidence
that capped risk contributions met tolerance.

For Factor, a material primary train/validation IC contrast is visible in the
same Core field across JSON, terminal, and Studio. The fixed `0.20` threshold
controls attention only. It neither changes qualification nor lets train or
test evidence replace validation selection.

Before Project orientation exists, Workspace construction should not force an
Agent to rearrange caller inputs. Public help and capability discovery expose
two safe routes: keep staging outside an absent/empty Workspace target, or
explicitly adopt a pre-staged directory. Adoption never turns surrounding
files into research authority and refuses collisions with AutoQuant-owned
configuration or `projects/`.

The dataset-package manifest directory is the package source root. A worker
with files below `staging/raw-ohlcv/` places its manifest at `staging/` and
uses asset paths such as `raw-ohlcv/AAPL.csv`. It does not duplicate those
bytes beside a deeper manifest. This manifest-rooted layout is portable and
retains parent/absolute-path and symlink rejection; the Project-local
normalized content-locked snapshot created by intake remains intentional.

## Filesystem authority

The distinction between ownership and current edit authority is explicit.

Before a Session exists, a Study may declare `factors/**`, `strategies/**`, or
`models/**` as its candidate source closure. This describes what a future
Session may stage; it is not an instruction for a governed Agent to edit the
canonical Project directly.

During an active Session:

- `operatingRoot` is the disposable Session Project;
- the brief's `project.rootDir` is the canonical evidence root, and human
  orientation prints both roots;
- `aq orient .` from a locked `operatingRoot` verifies and re-enters the exact
  owning Project read-only without copying data or widening mutation paths;
- editable paths are resolved beneath that root;
- the canonical Project, request, data, Study, program, Judge, mandate,
  dependency closures, Runs, Experiments, Reports, and Dossiers are protected;
- a newer candidate routes through bounded check/evaluation before it can
  replace the leader;
- a worktree already settled on a non-baseline KEEP routes to guarded
  promotion instead of another edit, and successful promotion terminally
  closes the Session as `promoted`;
- that settled handoff retains the exact accepted candidate's passed Check
  pointer while its source, Study, preflight, and Harness identities match;
- delegated promotion is visible only when an exact current Report makes its
  generated `--report` command executable;
- baseline-retaining completion is the alternative terminal branch and is
  never advertised after promotion;
- a first free-form candidate edit or Report analysis remains Agent-owned
  preparation, with exact root/closure/review guidance and no fabricated
  command.

No brief may advertise two writable roots.

## Operator reason taxonomy

Stable Project-level reason categories distinguish:

- `study-selection-required`;
- `baseline-evidence-missing`;
- `baseline-repair-required`;
- `scientific-limit-report-required`;
- `scientific-limit-reported`;
- `current-evidence-stale`;
- `session-required`;
- `session-active`;
- `scientific-gate-blocked`;
- `report-required`;
- `shared-source-conflict`;
- `promotion-ready`;
- `baseline-completion-ready`;
- `required-research-complete`.

For a current immutable Run with no Session, `report-required` is primary when
the verified research agenda freezes in-sample work and exposes no editable
target. `session-required` remains correct when a real bounded candidate
investigation is still proposed. Orientation must not make an Agent infer this
distinction by comparing lower-level commands manually.

Implementation may add more specific codes, but it must not collapse
scientific rejection into missing workflow state or describe an immutable
negative result as an infrastructure failure.

A Workspace with a declared default Project resolves normally. A Workspace
without a default requires `--project ID` through the existing structured
`workspace.selection-required` CLI error. Orientation never guesses which
research question the Agent should operate.

## CLI and Studio parity

`aq orient` is read-only and uses the standard versioned CLI envelope.
`nextActions` repeats the brief's exact primary/supporting actions using the
existing action schema and declared effects.

Studio receives the same brief and a Core hash. JavaScript may format or
progressively disclose its fields. It must not independently choose the focus
lane, derive a scientific stage from metric signs, rank experiment briefs,
invent filesystem authority, or substitute a different next action.

## Feedback tiers

Orientation must truthfully distinguish the feedback operations that already
exist:

- structural inspection and validation;
- fixed seconds-scale candidate preflight;
- bounded baseline Run execution;
- Session Experiment evaluation;
- full repository engineering regression.

It must not advise a Project Researcher to run the AutoQuant repository's full
engineering suite, nor pretend that structural validation or preflight creates
selection evidence. Preflight preserves the fixed Study boundary and formal
Judge authority.

## Invariants

1. Orientation is read-only and cannot start research implicitly.
2. Every claim is reconstructed from verified Core state.
3. There is one operating root, one primary mode, and at most one primary
   action.
4. Existing lifecycle and scientific-gate objects remain authoritative.
5. A work brief never grants broader edit authority than its active Study and
   Session.
6. Validation selects; visible test audits; neither role is rewritten for
   convenience.
7. CLI and Studio share the exact brief and hash.
8. Every brief states that AutoQuant has no trading authority.
9. Agenda ordering uses train context and validation evidence only; visible
   test audit cannot change a move, its order, or its wording.
10. Agenda moves never broaden the declared editable closure or become
    executable lifecycle actions.
11. A standalone Agent and a host-started Agent receive the same quantitative
    orientation for the same Workspace state.
12. Required orientation survives replacement of the native Agent Session;
    private chat history is never the only source of Project truth.
13. Delegated request authority precedes a fixed-dependency-bound Project
    request, which precedes the flexible research brief; an explicitly headed
    maintained question precedes the create-time Project description.
14. A settled KEEP routes to executable guarded promotion; a newer worktree
    edit retains check/evaluation priority, and delegated Report gates are
    never bypassed by orientation.
15. Experiment `KEEP` is Session-objective-only; scientific qualification,
    downstream admission, and trading authority remain separately denied until
    their verified contracts say otherwise.
16. Promotion returns the exact post-mutation Work Brief, and terminal blocked
    evidence makes further research optional rather than implicitly required.
17. Completed fixed Studies have no mandatory CLI action; answer authoring is
    explicit review guidance and their Explorer is optional supporting
    evidence.
18. A validated current Report-bound completion or promotion has no mandatory
    next Session; its exact Report is visible and another Session is optional
    supporting work, without inferring a trial budget from prose or treating
    promotion as scientific qualification.
19. A current immutable Research Dossier is a terminal caller handoff even
    when it records an upstream early stop; lower-level gate state cannot turn
    its optional next hypothesis into required tuning.

## Known limitations

- V1 orients one selected Project, not a portfolio of simultaneous Projects.
- It does not measure Agent token use, reasoning quality, or provider cost.
- It does not execute commands or guarantee that an external Agent follows
  them.
- Recipes are fixed for the reference Factor, Portfolio, and governed-RL
  objectives; unknown Study objectives are explicitly unsupported.
