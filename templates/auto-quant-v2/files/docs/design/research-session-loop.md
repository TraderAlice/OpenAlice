# Governed Research Sessions and Experiments

Status: V1 implemented.

Related: [[docs/ARCHITECTURE]], [[docs/PROJECT_FORMAT]], [[docs/CLI]],
[[docs/design/study-run-evidence]], and
[[docs/design/agent-cli-contract]], and
[[docs/design/quant-research-lifecycle]], and
[[docs/design/session-decision-matrix]].

## Scope

This document owns the resumable Agent edit/evaluate loop above a fixed Study:
Session identity, disposable working construction, Experiment evidence,
KEEP/REVERT/CRASH comparison, leader restoration, and guarded promotion.

It does not own the Researcher's model/provider, proposal quality, parallel
search, portfolio guardrails, or Studio presentation. Delegated request/Brief
and Session-bound Report files compose this boundary. A Project-owned Report
over a current immutable Run is deliberately outside the Session model; see
[[docs/design/run-bound-research-reports]]. End-to-end handoff semantics are
owned by [[docs/design/quant-research-lifecycle]].

## Authority model

The human-owned Study remains the authority. A Researcher receives:

- the Study program and objective;
- the exact editable strategy/factor/model closure;
- a disposable Session worktree path;
- the current leader Run, metric, source hash, and prior Experiment history;
- one bounded evaluate command.

The Researcher may edit candidate source in the worktree and describe one
hypothesis. It cannot decide the verdict, rewrite history, change fixed inputs,
or publish source to the owning Project. The fixed Judge and Core comparison
decide KEEP, REVERT, or CRASH. Promotion is a separate explicit operation.

This separates the replaceable intelligence that proposes code from the stable
Harness that controls authority and evidence.

## Project layout

The Project gains one durable `sessions/` ownership slot:

```text
sessions/
└── session-<UTC timestamp>-<identity>/
    ├── session.json
    ├── request.json        # optional delegated request
    ├── brief.json          # optional derived Research Brief
    ├── worktree/
    │   └── <project-id>/
    │       ├── autoquant.json
    │       ├── research.md
    │       ├── <fixed selected Study and Judge files>
    │       ├── <editable candidate files>
    │       └── <empty required Project directories>
    ├── experiments/
    │   └── exp-0001-<candidate identity>/
    │       ├── result.json
    │       ├── changes.json
    │       ├── diff.patch
    │       └── manifest.json
    ├── campaigns/
    │   └── campaign-<UTC timestamp>-<identity>/
    │       ├── turns/
    │       ├── result.json
    │       └── manifest.json
    ├── reports/
    │   └── report-<UTC timestamp>-<identity>/
    ├── promotion.json      # improved KEEP accepted into Project
    └── completion.json     # baseline retained with exact current Report
```

`session.json` is a mutable, strict coordination pointer. Immutable Runs and
Experiment directories are the evidence. `promotion.json` is written once when
the accepted leader is copied back to the Project. `completion.json` is the
alternative terminal receipt when a delegated lane retains its baseline.
When either terminal receipt and its Report still validate against current
authority and the retained leader remains the current Run, Agent orientation
exposes that Report as complete evidence and makes a new Session an explicit
optional continuation rather than required work. Promotion preserves source;
neither terminal state asserts scientific qualification.

## Session identity and locks

A Session pins:

- owning Project and selected Study;
- Study, program, Judge, dataset, and Harness identities;
- successful baseline Run id, metric, and source hash;
- current leader Run id, metric, and source hash;
- Project source hash at Session start;
- worktree path, status, timestamps, and next Experiment sequence.

Session start executes a fresh successful baseline through the ordinary
Study/Run contract. It then constructs the worktree from exact fixed and
editable bytes. Canonical Project candidate source is not changed. The
worktree also receives one strict Project/Session marker that is forced into
the Session fixed inventory regardless of editable globs.

When `--request` is supplied, Core validates it before baseline execution and
requires every requested symbol and asset class to fit the selected Study. It
then derives a Research Brief from the normalized request, Session identity,
baseline, objective, Study/program/Judge/dataset locks, and Harness. The
Session pointer stores the Brief id and request/Brief hashes; the canonical
request and derived Brief live beside it. Every load reconstructs the expected
Brief and rejects missing, changed, or untracked delegation files.

Caller-provided OpenAlice Workspace, Session, artifact path, and revision are
content-locked context. They are not authenticated inside AutoQuant.

Evaluation rejects stale or modified authority before running:

1. the owning Project and worktree Project manifests still agree;
2. canonical and worktree Study/program/Judge/dataset hashes equal Session
   locks;
3. the installed Harness executable identity equals the baseline lock;
4. every worktree file outside the editable closure equals the fixed inventory;
5. the mutable leader and sequence reconstruct exactly from immutable
   Experiment history;
6. the candidate source differs from the current leader.

Harness executable identity is the id, semantic version, Harness source hash,
and Python version. RunResult also preserves repository commit and dirty state
as provenance, but those fields do not define runtime equality: committing
Project research in a repository-root Workspace changes Git HEAD without
changing the installed Harness. That ordinary research commit must not stale a
Session or force a duplicate baseline Run. A changed Harness source hash or
runtime version still stales the Session.

For a content-locked Study, canonical and worktree identity checks hash the
same owning Project data root. Dataset bytes are not copied into the worktree;
changing them stales the Session before another candidate can run.

The advertised worktree is nevertheless a valid read-only CLI re-entry point.
`aq orient <worktree>` verifies its strict marker, exact ancestor Project and
Session topology, Session manifest, and locked marker hash, then builds the
brief from the canonical Project. JSON context and generated commands continue
to name that canonical evidence root, while `filesystem.operatingRoot` remains
the separate writable worktree. Other commands retain their explicit Project
path semantics; re-entry does not redirect mutation through hidden ownership.
Detached or forged worktrees fail instead of becoming standalone Projects.

## Experiment execution

```text
Agent edits Session worktree
→ validate fixed inventory and candidate closure
→ publish candidate Run in owning Project
→ compare primary metric with current leader
→ publish immutable Experiment evidence
→ KEEP: retain candidate worktree and advance leader
→ REVERT/CRASH: restore exact leader source bytes
→ atomically update mutable Session pointer
```

The candidate Judge executes from the Session worktree but reads the owning
Project's declared data directory. Its Run is published in the owning
Project's canonical `runs/`, so Studio and CLI need no second Run catalog.

The V1 verdict rule is deliberately small:

- `CRASH`: candidate Run status is failed;
- `KEEP`: candidate Run succeeded and its direction-normalized improvement is
  strictly positive and at least `minimum_improvement`;
- `REVERT`: candidate Run succeeded but did not clear that threshold.

An Experiment records the hypothesis, before/candidate source hashes, leader
and candidate Runs, primary values, signed direction-normalized improvement,
threshold, verdict, structured source changes, unified text diff, errors, and
timestamps. Its terminal manifest pins every other Experiment file.

## Restoration and promotion

REVERT and CRASH never copy candidate bytes into the owning Project. After
their evidence is published, the worktree editable closure is restored from
the verified immutable leader Run.

Promotion is allowed only when:

- the Session is active and has at least one KEEP beyond baseline;
- the current leader Run is successful and matches the Session leader hashes;
- fixed Study/Judge/Harness locks remain current;
- the owning Project editable source still equals its Session-start hash;
- for delegated work, one explicitly selected immutable Report freezes the
  exact current request, leader, Experiment prefix, and Campaign prefix;
- no promotion receipt already exists.

Promotion backs up the confined Project editable closure, applies exact leader
files including deletions, reloads the Study to verify the accepted source
hash, and restores the backup on any failure. Only then does it write the
promotion receipt and mark the Session promoted. A stale promotion changes
nothing. The content-derived promotion receipt binds the full leader pointer
and, for a delegated Session, the selected Report
manifest/result/evidence identity. Local non-delegated Sessions retain
report-free promotion because there is no caller handoff contract to satisfy.
Promotion is a terminal close path, not a precursor to completion.
`session.complete` is the mutually exclusive terminal path for an active
baseline-retaining delegated Session. Calling it after promotion returns the
specific `completion.already-promoted` diagnostic and creates no second
receipt.

V1 promotion is process-atomic with verified rollback, not a cross-filesystem
transaction. Concurrent writers outside AutoQuant remain prohibited during
the short promotion critical section.

Completion never copies source. It requires an active delegated Session whose
leader still equals its baseline, a worktree equal to that leader, no running
Campaign, and one explicitly selected Report that freezes the complete current
Experiment/Campaign prefix. The content-derived receipt binds that Report
manifest/result/evidence identity, Brief, leader, Study, Project, and timestamp.
An unpromoted KEEP cannot complete because downstream Studies would otherwise
interpret candidate-only source as current Project input.

## Agent loop

The CLI is the shared protocol:

```text
aq session start <path> --study <id> --json
aq session start <path> --study <id> --request request.json --json
→ edit data.worktree under data.editablePaths
→ aq experiment evaluate <path> --session <id> --hypothesis "..." --json
→ inspect verdict/history/nextActions
→ repeat; or publish a Report and either:
  - aq session promote <path> --session <id> --report <id> --json
  - aq session complete <path> --session <id> --report <id> --json
```

The first form starts a request-free local Session only when the Project has
no strict request-bound intake. If intake has already verified and bound the
Project's canonical `request.json`, omission of `--request` reuses that request
instead of silently creating a non-delegated Session. Agent-facing templates
show the second form explicitly so delegated authority is visible before the
baseline is created or reused.

Choose exactly one terminal branch: promote an improved KEEP, or complete a
delegated baseline-retaining Session. Neither branch follows the other.

Session start first searches verified successful Runs newest-first. It reuses a
Run only when the Study, program, editable source, Judge, dataset,
dependencies, and installed Harness executable identities exactly match
current inputs. Repository commit and dirty-state differences remain visible
provenance but do not prevent reuse when the executable identity is unchanged.
Otherwise, when the Study has fixed candidate preflight authority, it executes
that seconds-scale contract against the canonical Project candidate before the
complete Judge. A failed guard is structured operational feedback and leaves
no Run, Session, Check, or partial directory. A passed guard grants no research
authority; Core executes one fresh baseline and retains a content-bound receipt
in `baselineGuard`. Studies without a preflight execute the fresh baseline
directly. Reused baselines do not rerun the guard. This keeps Session
construction from silently duplicating an already established one-shot
evaluation while preserving strict currentness after any scientific or runtime
change.

`baselineGuard.mode` tells a replacement Agent exactly which route occurred:
`fresh-preflight-and-run`, `fresh-run-no-preflight`, or
`reused-successful-run`. Only the first contains a receipt. The receipt binds
the Study input, dataset, candidate source, preflight definition and sources,
Harness, normalized output, execution record, and explicit
no-selection/no-promotion/no-trading authority. Session loading verifies those
locks and hashes. This receipt is distinct from a post-edit CandidateCheck and
does not enter Experiment history.

An external Codex, another coding Agent, or a human can drive these same
operations. The implemented provider-neutral bounded layer is
[[docs/design/external-researcher-driver]]; it composes this contract rather
than entering the Judge or promotion authority.

A delegated Session may publish immutable Reports over any verified evidence
prefix. Report publication neither changes the leader nor closes the Session.
Later Experiments do not mutate an earlier Report.

The verified Agent Work Brief orders these same states. A worktree that equals
an accepted non-baseline KEEP has no pending candidate hypothesis, so
orientation routes a local Session directly to guarded promotion. Delegated
promotion becomes primary only after an exact current Report binds the leader
and its generated argv includes that Report. A newer worktree edit keeps
check/evaluation primary; promotion of the prior KEEP may remain secondary
only when it is already executable. The initial source edit and Report-analysis
authoring are reasoning work, not CLI operations, so orientation supplies
their exact filesystem/review boundary without inventing a command.
The same settled handoff retains the accepted candidate's exact passed
preflight pointer when source, Study, preflight, and Harness identities remain
current. It is audit provenance for that accepted candidate, not authority to
skip checking a later edit.

## Invariants

1. Sessions and Experiments are Project-local and path-confined.
2. Candidate execution never imports undeclared Project source.
3. Fixed authority is checked before every Experiment and promotion.
4. Candidate Runs use the canonical Run evidence protocol.
5. Experiment manifests are written last and verified on load.
6. Every Experiment verdict is recomputed from its immutable candidate Run when
   Session history is validated.
7. KEEP alone advances the Session leader.
8. REVERT and CRASH restore the exact prior leader.
9. Promotion is explicit, stale-base guarded, hash-verified, and rollback-safe.
10. Session pointers may be rebuilt from immutable Runs and Experiments; they
   are not research evidence by themselves.
11. A delegated Brief is exactly derived from caller content and fixed
    Session/Study authority; caller context cannot alter the Judge.
12. Session start does not duplicate an exact successful current baseline Run.
13. Reports freeze chronological evidence prefixes and have no trading
    authority.
14. `promoted` and `completed` are mutually exclusive terminal states.
15. Completion is baseline-only, Report-bound, and never mutates Project
    source.
16. Delegated KEEP promotion is Report-bound; local non-delegated promotion
    cannot invent a Report.

## Known gaps

- One Session has one linear leader; there are no branches or Pareto fronts.
- Comparison uses one primary metric without per-asset guardrails.
- Session recovery after process termination between Experiment publication
  and pointer update is not yet automated.
- Studio observation is read-only; Session operations remain CLI/Core-owned.
