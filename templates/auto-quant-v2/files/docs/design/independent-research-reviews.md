# Independent Research Reviews

Status: implemented for `0.9.16`.

Related: [[docs/design/run-bound-research-reports]],
[[docs/design/study-run-evidence]],
[[docs/design/agent-native-quant-workbench]], and
[[docs/design/studio-observation-surface]].

## Purpose

A Research Report is the primary researcher's immutable interpretation of a
bounded evidence prefix. An Independent Review is a different object: another
researcher inspects that completed Report and its exact anchor Run, checks its
claims and evidence references, and records what the available evidence does
and does not support.

Review is not another research lane. It does not acquire data, run a Judge,
edit a candidate, create a Session, replace the primary Report, authenticate a
provider or account, or grant quantitative/trading authority. The target
Report and Run remain byte-identical.

A primary researcher may later use the Review as the governing trigger for a
new append-only Run Report correction. That operation still does not mutate
the Review or target Report; it copies the verified Review package into the
new Report and derives currentness from explicit correction lineage. See
[[docs/design/run-bound-research-reports]].

## Four evidence classes

Every Review claim uses exactly one class:

- `verified`: a strict reader reconstructs or hash-verifies the claim from the
  target Project's immutable Report/Run evidence;
- `declared`: a verified snapshot, manifest, or artifact contains the stated
  semantic claim, but AutoQuant does not independently authenticate it;
- `observed-unbound`: a file was visible beneath the explicit Project or
  Workspace observation root, but it is outside the target Report/Run
  identity;
- `unverified`: the necessary evidence is absent, contradictory, stale, or not
  reproducibly connected to the target.

Core enforces the authority boundary, not the scientific prose. `verified` and
`declared` claims can cite only the exact target Report and anchor Run.
`observed-unbound` must cite at least one `observed-file`; publication records
that file's root-relative path, byte size, and SHA-256 without copying it into
target evidence. `unverified` may intentionally have no evidence reference.
Core also rejects references to another Report, another Run, undeclared Run
artifacts, missing Report files, escaping paths, or symlinks.

A digest of an observed file proves only which bytes the reviewer saw. It does
not make those bytes portable research authority and does not repair a broken
Report reference.

## Target and package identity

Each Review freezes:

- Project id and name;
- target Report id, Report hash, and file hashes;
- anchor kind, Study, Run, optional Session, and Run result hash;
- Run Study-input, dataset, and Harness identities;
- the target Report's formal finding/recommendation evidence references;
- every distinct Review reference with `bound-immutable` or
  `observed-unbound` authority;
- normalized Review analysis and a canonical Markdown rendering.

The package contains:

```text
review-<UTC timestamp>-<identity>/
├── analysis.json
├── evidence.json
├── review.json
├── review.md
└── manifest.json
```

The terminal manifest hashes every other file. Loading an attached Review also
re-loads the exact target Report and Run and rejects identity drift. Loading a
detached package verifies its internal identity and preserves the target
hashes needed to reconnect it to the Project later.

## Attached and detached publication

Normal Project history may attach a Review under `reviews/`:

```bash
aq review publish <workspace-or-project> \
  --report REPORT_ID \
  [--session SESSION_ID] \
  --analysis review-analysis.json
```

An independent auditor may be forbidden to change even the target Workspace.
The same command therefore supports a detached output parent:

```bash
aq review publish <workspace> \
  --project PROJECT_ID \
  --report REPORT_ID \
  --analysis review-analysis.json \
  --output /outside/review-packages
```

The generated `review-*` package is outside the reviewed Project and
observation root. Core rejects a detached destination inside either boundary.
This mode can observe Workspace staging, freeze its digest as unbound, and
still leave the Workspace byte-for-byte unchanged.

Attached discovery and both verification routes are public:

```bash
aq schema review-analysis --json
aq review list <path> [--report REPORT_ID] --json
aq review show <path> --review REVIEW_ID --json
aq review show /outside/review-packages/review-... --json
```

Studio projects attached Reviews and their conclusion/classification counts.
Detached packages remain deliberately absent from the target Studio because
their defining contract is that the reviewed Workspace was not changed.

## Governing a correction

An attached Review id or detached package path may be supplied to `aq report
publish --corrects ... --correction-review ... --correction-reason ...`.
Core reconnects the Review to its exact immutable target before publication.
The complete five-file package is then copied beneath the new Report, so the
correction remains self-contained even if the original detached location is
later unavailable.

Review authority does not become quantitative evidence. The corrected
analysis still cites only its Run anchor. The embedded Review proves the
editorial lineage—what prior Report was challenged and why another primary
handoff exists—while the Run continues to govern every retained quantitative
claim.

## Non-goals

- universal certification, reviewer reputation, signatures, or provider
  attestation;
- automatic semantic judgment of prose;
- importing mutable staging into a Run after the fact;
- rewriting or withdrawing the reviewed Report in place;
- treating Review acceptance as selection, forecast, allocation, Order, or
  execution authority;
- replacing the strictly-later source-versus-target Holdout Assessment.
