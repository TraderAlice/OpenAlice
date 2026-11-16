# Agent CLI contract

Status: implemented for Workspace, Project, AI-first Project orientation,
request-driven OHLCV intake, Study, Run, Session, Experiment, bounded Research
Campaign, delegated request, Research Report, and Session comparison
operations.

Related: [[docs/CLI]], [[docs/PROJECT_FORMAT]],
[[docs/design/workspace-project-boundaries]], and
[[docs/design/study-run-evidence]], and
[[docs/design/external-researcher-driver]], and
[[docs/design/session-decision-matrix]], and
[[docs/design/agent-operator-experience]].

## Scope

This document owns versioned command envelopes, machine capability discovery,
contexts, artifact references, next actions, operation effects, and exit
behavior. It does not own the underlying Workspace/Project semantics or
Study/Run evaluation rules.

## Principles

- Agents consume structured contracts rather than scrape terminal prose.
- Humans and Agents invoke the same Core operations.
- JSON output is one complete envelope, not mixed logs and payload fragments.
- Every mutating or artifact-producing operation declares its effect.
- Successful commands expose executable next actions instead of requiring the
  caller to guess the next syntax.
- Errors retain stable codes and path-level issues.
- A future Studio is another projection of these operations, never a second
  evaluator or hidden write path.

## Source of truth

- Envelope constructors and schema version: `autoquant/cli_contract.py`
- Capability descriptors: `autoquant/capabilities.py`
- Verified Agent Work Brief projection: `autoquant/orientation.py`
- Parser, dispatch, human rendering, and JSON rendering: `autoquant/cli.py`
- Canonical command reference: [[docs/CLI]]
- Contract tests: `tests/test_cli.py`

## Envelope invariants

1. Every JSON success contains `schemaVersion`, `ok`, `command`, `context`,
   `data`, `diagnostics`, `artifacts`, and `nextActions`.
2. Every JSON failure contains `schemaVersion`, `ok`, `command`, `context`, and
   an `error` with `code`, `message`, `retryable`, and `issues`.
3. Context scope is exactly `global`, `workspace`, or `project`.
4. Artifact references declare `kind`, `id`, absolute `path`, and
   `immutable`.
5. Next actions declare stable `id`, human description, executable `argv`, and
   operation `effect`.
6. Capability discovery describes every public subcommand and every public
   argument, including JSON support and exit codes.
7. Exit `0` means success, `1` means a validation/operation failure, and `2`
   means invalid CLI usage.
8. `--json` usage errors remain parseable JSON rather than argparse prose.
9. Human output may improve without changing the machine contract.
10. Project context reached through a Workspace includes effective Workspace
    and Project-selection provenance.
11. In a Workspace with multiple Projects, `creates-artifact` and
    `mutates-project` commands require explicit `--project ID` and fail before
    mutation otherwise.
12. A non-empty Workspace target fails with an actionable recovery path.
    Explicit adoption is discoverable through both parser help and capability
    JSON; it preserves surrounding files and refuses existing AutoQuant-owned
    configuration or Projects paths.
13. `version` and `capabilities` project the same current seven-field Harness
    object, including build provenance. Machine discovery never requires
    parsing `--version` or terminal prose.

## Operation effects

The current CLI supports:

- `read-only`;
- `creates-artifact`;
- `mutates-workspace`;
- `mutates-project`;
- `long-running-server`.

Study/Session creation, Run execution, and Experiment evaluation use
`creates-artifact`. Transactional `project.intake` also uses
`creates-artifact`: it validates request/data before atomically exposing a
self-contained Project and does not start a Run. The same operation may
hydrate an exact pristine template scaffold while preserving its research and
Workbench-needs Markdown; any worked-in state is rejected before replacement.
Bounded `research.run` also uses `creates-artifact`: it may
advance the Session leader through ordinary KEEP Experiments but never copies
source into the owning Project. `report.publish` uses `creates-artifact` after
strict analysis and evidence-reference validation. Only
`session.promote` uses `mutates-project`, after stale-base validation and
rollback-safe receipt publication. Future operations may add `mode-dependent`
only when their confirmation, progress, and evidence contracts are defined.
`studio.serve` uses `long-running-server`, does not support terminal JSON, and
exposes only fixed read-only HTTP routes.

`session.compare` is read-only. It returns one bounded Core-authored comparison
object after verifying the Session, Experiments, and Runs; the CLI and Studio
must not independently select metrics, infer preference direction, or include
test audit fields in dominance.

`workspace.init` creates ownership rather than discovering arbitrary contents.
Without `--adopt-existing`, its target must be absent or empty. With the flag,
Core preserves existing caller/host entries byte-for-byte, creates only the
base manifest and a new empty `projects/`, and rejects existing base/local
configuration or any `projects` file, directory, or symlink. Surrounding
staging remains outside Project, dataset, Study, and Run identity.

`orient` is read-only. It returns one strict Core-authored `AgentWorkBrief`
after resolving the selected Project and reconstructing its current Study,
Run, Session, Report, Dossier, research-program, gate, and conflict state. Its
filesystem contract grants candidate writes only inside a valid active Session
worktree. The V2 brief also carries zero to three bounded experiment briefs
derived from the current verified Factor, Portfolio, or governed-RL diagnosis.
Those agenda moves are diagnostic-only data, not CLI actions; they cannot
execute, promote, or trade. Studio consumes the exact same object and Core
hash rather than deriving a competing research decision or experiment order
in JavaScript. See [[docs/design/evidence-driven-research-agenda]].

When `orient`, `inspect`, or `validate` enters through a Workspace, the
envelope keeps `scope: project` but additionally names the effective
Workspace and `projectSelection`. A default-selected multi-Project orientation
lists every available id and advertises `project.list`. This is navigation
provenance, not mutation authority: any Project-local command whose capability
effect is `creates-artifact` or `mutates-project` must use explicit
`--project ID` once more than one Project exists.

For a focused editable Factor Study, the same brief carries one strict
`candidateContract`. It projects the verified Project's actual base interval,
completed feature intervals, panel columns, observation timestamp/panel/
missing/target-clock semantics, causal context-visibility rule, factor API,
component metadata fields, and legal component roles. `study inspect` returns the identical
object, `aq schema factor-candidate-contract` publishes its schema, and Studio
renders it from the hashed brief. Conditional candidate code never grants
columns absent from this contract; the contract states that source branches
and component declarations do not add panel inputs.

The positional path may also be a newly materialized Session worktree. Core
accepts that re-entry only when the worktree's strict marker is present in the
owning Session's fixed inventory and its Project id, Session id, ancestor
Project, exact topology, and marker hash all verify. The returned brief and
context are canonical-Project projections; `filesystem.operatingRoot` remains
the worktree. Other commands do not inherit this owner redirection.

The brief's `question` projection has ordered, disclosed provenance. A
validated delegated intake returns `origin: delegated-request` and its request
path in both `sourcePath` and `requestPath`. Without intake, a strict
Project-root request returns `origin: project-request` only when its canonical
hash is bound by `source.requestHash` in a declared fixed Study dependency.
Both paths identify `request.json`.

Without a verified request, a clearly headed `Question`, qualified
`Question ...`, `Research question...`, or `Fixed question` section in the
manifest-declared research program returns
`origin: project-research-brief`, that Markdown `sourcePath`, and a null
`requestPath`. When none exists, Core returns the Project manifest description
with `origin: local` and null source/request paths. Studio consumes this exact
projection; it does not reread files or choose a competing question.

Session action ordering is also reconstructed from verified state. When the
worktree equals a non-baseline KEEP leader, non-delegated orientation makes
guarded `session.promote` the primary action. Delegated orientation does so
only when an exact current Report binds that leader and includes `--report` in
the generated argv. Without the Report, the brief returns `report-required`
and no unexecutable promotion action. If the worktree contains a newer
candidate, its check/evaluation remains primary while an already executable
promotion may remain supporting. Free-form code edits and Report-analysis
authoring are Agent-owned preparation, so they use review guidance rather than
a fabricated CLI command. A settled handoff retains the exact accepted
candidate's passed Check pointer when source, Study, preflight, and Harness
identity still match; this evidence projection does not make the old
leader-relative Check eligible to preflight a different candidate.

After successful promotion, the mutation response reconstructs the same
post-mutation Agent Work Brief used by `aq orient` and Studio, includes that
brief in `data.agentWorkBrief`, and projects its primary/supporting actions
into `nextActions`. Human output prints its leading disposition. It must not
recommend a redundant baseline Run when the promoted KEEP Run is already
current evidence. The response also carries `data.terminalClosure`, naming
promotion as the terminal method, the `promoted` Session status, the immutable
receipt, and that `session.complete` is inapplicable. Completion remains the
mutually exclusive terminal method for an active delegated
baseline-retaining Session.

Experiment evaluation separates local selection from scientific authority.
Its immutable Experiment result retains the fixed `KEEP`, `REVERT`, or `CRASH`
verdict, while the command envelope adds `verdictAuthority` with
`scope: session-objective-only`, false scientific qualification and downstream
admission, and `tradingAuthority: none`. This disclosure does not rewrite
historical Experiment schemas or make the CLI a second evaluator.
`experiment.show` repeats the same envelope-level authority and human
disclosure so replacement Agents do not need the original evaluation response.
The Work Brief additionally projects nullable `evidence.latestExperiment`
with the latest Experiment id/verdict, candidate Run/source, fixed
`session-objective-only` authority, and the last same-source Check completed
before Experiment start. This is distinct from `candidateCheckId`, which
continues to describe only the exact current worktree candidate.

Before any current Run exists, an editable Study routes directly to
`session.start`, not a separate generic `run.execute`. Session start owns the
atomic first-candidate path: it executes fixed preflight authority when
declared, leaves zero lifecycle artifacts on failure, then creates the complete
baseline and Session only after a pass. JSON and Studio expose the resulting
`baselineGuard` mode and receipt. A fixed non-editable Study continues to route
to `run.execute`. After Session creation, an unchanged leader has no
`session.check` action; that command is reserved for a later source edit.

After a REVERT/CRASH restores the leader, an active Session with trial history
uses `trial-review-required`: no primary edit is invented, delegated
`report.publish` and read-only `session.show` are supporting choices, and the
review text leaves an explicit new bounded hypothesis under Agent/caller
authority. Once a baseline-retaining Report exists, `session.complete` is the
single executable primary action.

When a coordinated lane has both terminal Session evidence and a blocked
scientific gate, orientation has no primary action and keeps a new
`session.start` only as optional supporting work. The Agent can still invoke
that exact command explicitly. A weak initial baseline without prior terminal
research continues to present its first Session as primary work.

For a single Portfolio Study, a baseline-restored active Session with at least
one immutable trial and a verified `no-further-in-sample-tuning` agenda is
also terminal by default. Orientation returns
`in-sample-freeze-ready`, observe mode, null primary action, and only
read-only Session inspection as support. Core neither closes the Session nor
infers a caller trial budget; an explicit new mandate may still continue it.

A successful current fixed Book Risk, Price Event, or Allocation Study is also
terminal. Orientation has no primary CLI action, puts the Agent-owned
write/return instruction in `review.next`, and retains the exact strict
Explorer as one supporting read-only action. The standard envelope therefore
keeps that Explorer in `nextActions` for optional evidence access without
claiming more research is required. Human orientation prints both the
Agent-owned next step and the first supporting command; no fake write command
or operation effect is introduced.

## CLI-to-Studio flow

```text
Core operation
├── aq human projection
├── aq JSON envelope
└── Studio read-only snapshot and browser projection
```

Core operation data is authoritative. The Studio must not reimplement manifest
validation, Project selection, evaluation, or mutation policy.

Studio may expose Core-generated `argv` and shell-display strings for copy.
Copying a command is not an operation and grants no new authority; the CLI
remains the mutation boundary.

Long-running research will require versioned progress events on stderr or a
separate stream while stdout retains one terminal envelope. That protocol is a
known future design task, not an implied behavior of the current CLI.

## Non-goals

- Treating natural-language terminal output as an API.
- Generic shell orchestration or a distributed task queue.
- Emitting unstructured Python tracebacks for expected validation failures.
- Claiming a next action is safe without declaring its effect.

## Change checklist

- Add or update the capability descriptor with every public command change.
- Exercise both human and JSON surfaces.
- Preserve the envelope schema or deliberately increment `schemaVersion`.
- Add stable error codes and issue paths for expected failure modes.
- Provide truthful artifacts and next actions; never advertise an operation
  that does not exist.
- Add the same Core operation to Studio rather than implementing a UI-only
  mutation.

## Verification

```bash
uv run aq capabilities --json
uv run python -m unittest tests.test_cli -v
```

## Known gaps

- No progress-event envelope exists.
- No output section selection exists.
- No confirmation receipt exists for future Project mutations.
- Studio has no confirmed mutation routes.
