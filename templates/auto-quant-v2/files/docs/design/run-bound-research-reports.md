# Run-bound Research Reports

Status: implemented in `0.9.5`; Study-owned follow-up request binding added in
`0.9.8`; immutable correction lineage added in `0.9.17`; safe exact-anchor
analysis drafting added in `0.9.31`.

Related: [[docs/design/quant-research-lifecycle]],
[[docs/design/research-session-loop]],
[[docs/design/research-program-orchestration]],
[[docs/design/study-run-evidence]], [[docs/design/independent-research-reviews]],
and [[docs/design/agent-operator-experience]].

## Purpose

A Research Report is immutable Agent-authored interpretation over verified
AutoQuant evidence. Its evidence anchor must reflect how that evidence was
produced:

- a **Run anchor** reports one already immutable current Study execution;
- a **Session anchor** reports a bounded editable investigation and its exact
  Experiment/Campaign prefix.

Creating a Session merely to obtain a report directory is invalid modeling.
A Session grants candidate edit/evaluate authority and records search history;
a frozen baseline reproduction needs neither.

## Ownership and layout

Run-bound Reports are Project-owned:

```text
reports/
└── report-<UTC timestamp>-<identity>/
    ├── analysis.json
    ├── report.json
    ├── report.md
    └── manifest.json
```

A corrected Run Report additionally carries the complete governing Review
package inside its own immutable directory:

```text
report-.../
└── governing-review/
    └── review-.../
        ├── analysis.json
        ├── evidence.json
        ├── review.json
        ├── review.md
        └── manifest.json
```

Session-bound Reports remain beneath the Session because their evidence prefix
belongs to that investigation. Discovery is explicit across both locations;
identifiers remain globally unique within a Project.

## Authoring draft boundary

`aq report draft` is an optional bridge from verified evidence identity to
Agent-authored interpretation:

```bash
aq report draft <path> --session SESSION_ID \
  --output report-analysis.json

aq report draft <path> --study STUDY_ID --run RUN_ID \
  --output report-analysis.json
```

It accepts exactly the same Session or direct-Run anchor that publication
would verify, then creates one new confined Project-local JSON file. The
scaffold contains the exact leader Run and every declared Run artifact path;
Core does not generate conclusions, confidence, recommendations, or
limitations. Existing files, missing/symlink parents, path escapes, ambiguous
anchors, stale Runs, closed Sessions, and otherwise unreportable evidence fail
closed.

The scaffold is valid against the public Report-analysis schema but declares
`authoringState: draft` and one reserved instructional finding. Both are
publication guards: every publish API rejects the draft state and reserved
finding until the Agent replaces the prose and deliberately sets
`authoringState: final`. Historical final analyses without `authoringState`
remain readable. The draft itself is mutable authoring material, not an
immutable Report or research result.

## Run anchor authority

`aq report publish <path> --study ID --run ID --analysis FILE` requires:

1. verified request-driven Project intake or an exact Study-owned request
   frozen by the Run;
2. one successful immutable Run owned by the selected Study;
3. the Run is current for the Study's fixed and editable content identity;
4. the Run request, dataset, source/dependency, Harness, and Study identities
   remain exactly verifiable;
5. every analysis evidence reference resolves within the one frozen Run;
6. no active or historical Session exists for the Study, because omitting a
   real candidate-search prefix would understate selection history.

The frozen evidence contains the exact Run projection, selection-integrity
snapshot at publication time, and derived leader decision support. It contains
no Experiment or Campaign catalog and cannot cite those evidence kinds.

The Report request follows immutable Run authority, not merely Project-root
intake or a conventional source directory. Any fixed Study may explicitly name
one exact request dependency; a position snapshot is optional and, when
present, must bind back to that request. Publication and loading verify the
frozen hashes and use the request in both `report.json` and Report identity.
Older and newer Studies can therefore answer different questions inside one
long-lived Project without moving files into a special Study family or
relabeling either Report.

## Append-only correction lineage

A materially wrong published interpretation is corrected by another immutable
Run Report, never by editing or marking the prior package in place:

```bash
aq report publish <path> \
  --study STUDY_ID --run RUN_ID \
  --analysis corrected-analysis.json \
  --corrects PRIOR_REPORT_ID \
  --correction-review REVIEW_ID_OR_PACKAGE_PATH \
  --correction-reason "Remove the unsupported provider-coverage clause."
```

All three correction arguments are required together. The prior Report must be
a current terminal Project-owned Run Report over the same exact Run anchor.
The governing attached or detached Review must target that exact Report hash,
Run id, and result hash. Core copies the verified Review package into the new
Report, freezes the prior Report identity and reason in `report.json`, and
includes the correction object in the derived Report id.

Loading recursively verifies every prior Report and embedded Review. Listing
builds a linear graph and rejects missing, cyclic, cross-Project,
cross-anchor, semantically stale, or branched relationships. The prior package
remains independently valid. Its summary derives `current: false` and
`supersededBy`; the terminal correction derives `current: true`, its lineage
depth, exact prior identity, governing Review, and reason. CLI Orientation and
Studio consume that verified projection instead of trusting prose or a later
timestamp.

An ordinary later Report is not silently interpreted as a correction. It
starts an independent interpretation unless the explicit correction contract
is present. Correction publication is initially limited to Project-owned Run
Reports; Session-bound investigation history is not flattened into this
contract.

## Shared Report anchor

Every current Report exposes one strict anchor:

```json
{
  "kind": "run | session",
  "studyId": "ohlcv-factor-quality",
  "runId": "run-...",
  "sessionId": null
}
```

For a Session Report, `runId` is the frozen leader and `sessionId` is the
owning Session. For a Run Report, `sessionId` is null. CLI, Studio, Dossier, and
Markdown use this anchor instead of guessing semantics from a path or treating
all Reports as evidence of candidate search.

## Coordinated program semantics

A required Research Desk lane is report-ready when its current successful Run
has either:

- a Run-bound Report for the exact Project request and current Run; or
- a Session-bound Report for the exact Project request and current Session
  leader.

The first route is preferred when the caller supplied or accepted a frozen
baseline and no candidate iteration occurred. The second is required when the
claim depends on a governed Experiment history. Both routes preserve the same
Factor-to-Portfolio and Portfolio-to-RL content checks.

When the verified evidence-driven agenda says
`no-further-in-sample-tuning` and every proposed move has an empty editable
target, Agent Orientation promotes the current Run-bound `report.publish`
command over `session.start`. A weak or unresolved baseline with a real
candidate-edit target retains the governed Session route; Run Reports are not
a shortcut around needed investigation. Whenever `report.publish` is primary,
the Work Brief may expose `report.draft` as an optional supporting authoring
step; it does not replace or satisfy publication.

## Non-goals

- Reports do not turn Runs into selection or trading authority.
- A later Independent Review classifies a Report; it never rewrites it. A
  primary researcher may publish a separate Review-governed correction that
  preserves both packages and extends their verified lineage.
- A Report does not make a scientifically blocked lane admissible.
- Fixed single-lane Studies remain free to return Run/Explorer evidence without
  manufacturing a Report.
- This contract does not infer research intent, choose a template from prose,
  write Report conclusions, or publish into OpenAlice.
