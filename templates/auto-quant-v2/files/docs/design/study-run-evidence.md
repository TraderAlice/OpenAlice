# Study contracts and immutable Run evidence

Status: V1 Python Judge lane, optional dataset content locks, fixed source
dependencies, Study-owned requests, and one exact prior-Run evidence binding
implemented.

Related: [[docs/ARCHITECTURE]], [[docs/PROJECT_FORMAT]], [[docs/CLI]],
[[docs/design/workspace-project-boundaries]], and
[[docs/design/agent-cli-contract]].

## Scope

This document owns fixed quantitative Study contracts, human research
programs, Judge and editable source closures, dataset and objective identity,
bounded Python Judge execution, structured Judge output, immutable RunResult
publication, and Run verification.

It does not own autonomous Researcher invocation, KEEP/REVERT/CRASH
Experiments, source promotion, market-data ingestion, or Studio presentation.

## Authority model

V1 establishes three authority surfaces:

1. A human-authored Study and `program.md` define the research question,
   subject, dataset identity, primary metric, improvement direction, and
   operating intent.
2. Candidate work may change only the explicit Project-local editable source
   closure beneath `strategies/`, `factors/`, or `models/`.
3. A fixed Python Judge closure executes from frozen bytes and writes one
   strict result. Its files, Study, program, dataset identity, objective, and
   Harness are outside candidate authority.

A continuation Study may additionally bind one immutable prior Run and one or
more of its declared artifacts. This is evidence input, not mutable Project
inventory: Core verifies the source Run and copies only the selected exact
bytes into the new execution and Run.

`aq run execute` does not mutate candidate source. The governed Research
Session defined in [[docs/design/research-session-loop]] stages a disposable
Project, proves that its diff stays inside the same editable closure, runs this
Judge, and promotes only a hash-checked KEEP. External Researcher invocation
remains layered above that protocol.

## Source of truth

- Study schema, loading, closures, and identity: `autoquant/studies.py`
- Judge execution, RunResult publication, and immutable verification:
  `autoquant/runs.py`
- Human/Agent operations: `autoquant/cli.py`
- Machine capability descriptors: `autoquant/capabilities.py`
- Canonical formats: [[docs/PROJECT_FORMAT]]
- Canonical commands and envelopes: [[docs/CLI]]
- Focused evidence tests: `tests/test_studies.py`, `tests/test_runs.py`, and
  `tests/test_cli.py`

## Study identity

A Study contains:

- stable id, name, description, and human program;
- subject kind/name/version;
- exact editable files or trailing-`/**` directory closures;
- optional separately hashed, non-editable strategy/factor/model dependency
  closures;
- an optional exact Study-owned Research Request and position snapshot, each
  named as a fixed dependency;
- an optional single prior immutable Run identity plus one or more exact
  declared artifact paths and hashes;
- one Python Judge entrypoint, its complete fixed source closure, arguments,
  and wall-clock timeout;
- primary metric, maximize/minimize direction, and minimum improvement;
- dataset id/version, asset class, universe, date range, and optional
  Project-data-relative exact files or trailing-`/**` closures.

The Core derives:

- `studyHash` from the strict Study definition;
- `programHash` from program bytes;
- `judgeHash` from every fixed Judge source path and content hash;
- `sourceHash` from every editable source path and content hash;
- optional `dependencyHash` from every declared fixed dependency path and
  content hash;
- optional `upstreamEvidenceHash` from the prior Run/result/Study-input identity
  and selected artifact hashes;
- `datasetHash` from the declared dataset identity alone for legacy Studies, or
  from that definition plus the complete matched file-hash inventory when
  optional `dataset.paths` is present;
- `studyInputHash` from the fixed identities, including `dependencyHash` only
  when the optional dependency field is declared. Legacy identities remain
  unchanged.

The complete Run `inputHash` additionally binds the installed AutoQuant
Harness id/version/commit, dirty state, complete runtime-closure source hash,
and Python version. Installed distributions recover the source commit from
build-time embedded provenance rather than probing a runtime parent repository;
direct source checkouts require an exact Git root. See
[[docs/design/distribution-build-identity]].
Identical Study/source/Harness inputs preserve the same `inputHash`; repeated
executions still receive unique immutable Run ids.

## Closure and confinement invariants

1. Study ids match their immediate `studies/<id>/` directory.
2. Study manifest objects and all nested objects are strict.
3. Exact source paths are files. Trailing-`/**` closures are real directories.
4. Source traversal never follows symlinks and ignores generated Python cache
   files.
5. Editable paths stay beneath the Project's declared strategy, factor, or
   model directories; Judge paths stay beneath its declared Judge directory.
6. The Study manifest, program, Judge entrypoint, and every Judge source file
   are outside the editable closure.
7. Dependency closures stay under strategy/factor/model directories, are
   non-empty, and cannot overlap editable files. Only exact files explicitly
   named by `research_request` may live elsewhere in the Project; that
   exception never authorizes a wildcard closure.
8. The Judge entrypoint is included in the declared Judge closure.
9. Program, Judge, editable source, dependency, and artifact paths are Project- or
   artifact-root-confined POSIX relative paths.
10. Dataset paths are confined beneath the canonical Project data root. Exact
   paths are files; closures are non-empty real directories; neither may
   contain symlinks.
11. One upstream binding must resolve inside the same Project to a complete
    immutable Run of a different Study. Its Run id, Study id, result hash,
    Study-input hash, declared artifact paths, and artifact hashes must all
    agree. Multiple parents and implicit latest-Run selection are invalid.

## Execution model

```text
strict Study load
→ verify optional Study request and exact prior-Run evidence
→ hash Study/program/Judge/editable/dependency/upstream identities/dataset/Harness
→ freeze Run inputs, editable source bytes, fixed dependency bytes, and selected upstream artifacts
→ materialize isolated source workspace
→ execute fixed Python Judge with a bounded timeout
→ validate one Judge output JSON and exact artifact inventory
→ normalize success or failure RunResult
→ hash every Run file
→ write terminal manifest last
→ atomically rename the complete Run into discovery
```

The isolated execution workspace contains only the Project manifest, Study,
program, fixed Judge sources, editable sources, and declared fixed dependency
sources, plus the exact selected upstream evidence when declared. It does not
inherit undeclared Project code. Dataset access is explicit through
`AUTOQUANT_DATA_ROOT`. Content-locked Studies hash that same canonical root
before execution and freeze its relative file-hash inventory into Run inputs;
they do not copy potentially large dataset bytes into the isolated workspace.

Session worktrees intentionally keep an empty `data/` directory. When their
Study identity is loaded, Core supplies the owning Project's canonical data
root, so baseline and candidate evaluations bind and read identical bytes.
The same explicit owning-Project resolution verifies a continuation Study's
immutable prior Run; the upstream evidence hash enters Session locks, and each
candidate Run still freezes only the selected artifacts rather than copying
ambient Run history into the worktree.
Read-only orientation from a current Session worktree resolves that owning
Project through the worktree's fixed-inventory-locked Session marker; it does
not copy or symlink dataset bytes into disposable state.

Judge environment:

- `AUTOQUANT_PROJECT_ROOT`: isolated source workspace;
- `AUTOQUANT_DATA_ROOT`: original Project-local data directory;
- `AUTOQUANT_STUDY_PATH`: frozen Study manifest;
- `AUTOQUANT_RUN_OUTPUT`: required Judge output JSON path;
- `AUTOQUANT_ARTIFACTS_DIR`: confined artifact output directory;
- `AUTOQUANT_INPUT_HASH`: complete Study plus Harness input identity.
- `AUTOQUANT_UPSTREAM_EVIDENCE_ROOT`: present only for a continuation Study;
  contains `<run-id>/binding.json` and the selected prior artifact paths.

The Judge process is not an OS sandbox. It is ordinary Project-authored Python
with a fixed source and evidence contract. Host-level sandboxing is a separate
deployment concern.

## Failure evidence

Process exit, timeout, missing output, malformed JSON, non-finite metrics,
missing primary metric, invalid artifacts, and inconsistent status/errors all
produce a completed immutable RunResult with `status: failed`. Stdout, stderr,
partial raw Judge output, and any written files remain inspectable.

Every newly created failed Run also records `failureDisposition`:

- `scientific-limit` means the Judge completed the exact fixed evaluation and
  proved that its required research population or estimand is unavailable.
  The Run may anchor an immutable Run-bound Report, but it never becomes a
  successful objective, Session baseline, or downstream admission gate.
- `repair-required` means candidate, contract, Judge, process, runtime, or
  otherwise unclassified failure requires inspection before another attempt.
  Core assigns this conservative value to exits, timeouts, invalid output, and
  Judge failures that do not explicitly declare a scientific limit. It cannot
  anchor a Research Report.

The Judge output may declare `failure_disposition`; absence defaults to
`repair-required`. Older immutable failed Runs without the field remain
readable and receive that same conservative projection without rewriting their
bytes. A current failed attempt is evidence that execution occurred. Agent
orientation exposes its Run id, errors, and disposition and never recommends
an identical `run.execute`. Changing source or fixed authority makes the old
attempt stale and restores the normal new-evidence route.

A CLI operation failure is reserved for conditions where trustworthy evidence
cannot be published, such as invalid Study identity or an immutable Run
collision.

## Immutable Run invariants

1. Each visible Run directory has a terminal `manifest.json` with
   `completed: true`.
2. Hidden staging directories and visible incomplete directories are ignored by
   listing.
3. The terminal manifest maps every other file to its SHA-256 hash and pins the
   normalized `result.json` hash.
4. Loading or listing a completed Run rejects changed, deleted, or added files,
   and validates the strict RunResult contract after verifying its bytes.
5. RunResult records status, failure disposition when newly failed, metrics,
   subject/version, asset universe,
   dataset/time range, artifacts, errors, Study/Judge/source identity,
   execution timing, and Harness version/source identity.
6. A content-locked RunResult records dataset paths and `sourceHashes`; its
   frozen `inputs/dataset-files.json` preserves the same inventory.
7. Completed Run directories are read-only protocol artifacts. New analysis
   produces a derived artifact or new Run rather than changing them.
8. A dependency-bearing RunResult records paths, aggregate hash, and
   `sourceHashes`; `inputs/dependency-sources/` preserves those exact bytes.
9. A V2 multi-interval RunResult records the canonical
   `dataset.intervalSurface`; Reports, Studio, and Dossiers preserve that
   content-locked disclosure.
10. A request-bound RunResult records the request and optional position
    snapshot paths and hashes, and its frozen dependency copies must match.
11. A continuation RunResult records the exact upstream binding and input root;
    the binding file and every selected copied artifact are semantically
    reverified in addition to ordinary terminal-manifest hashing.

## Non-goals

- Claiming that a declarative-only legacy dataset is byte-reproducible.
- Letting the Judge train, repair, or promote a candidate.
- Treating a failed Judge process as absent evidence.
- Selecting different framework libraries per asset class.
- Running a long backtest as part of repository validation.
- Building a generic multi-parent evidence DAG, silently selecting a latest
  Run, or treating prior artifacts as a reusable data catalog.

## Change checklist

- Update Study, Judge output, RunResult schemas, parser behavior, CLI
  capability descriptors, and canonical docs together.
- Keep Judge, editable source, and dependency authority surfaces disjoint.
- Add failure evidence for each new execution failure mode.
- Preserve manifest-last atomic publication and full-file tamper verification.
- Add Studio as a projection of verified RunResult rather than a second
  evaluator.
- Keep optional content locks backward compatible: absence of `dataset.paths`
  must preserve the historical definition and dataset hash exactly.
- Keep optional source dependencies backward compatible: their absence must
  preserve historical Study serialization and input hashes exactly.
- Keep Study-owned request and single-upstream evidence fields optional; verify
  every declared byte and project the same relation through CLI and Studio.

## Verification

```bash
uv run aq schema study --json
uv run aq schema judge-output --json
uv run aq schema run-result --json
uv run python -m unittest tests.test_studies tests.test_runs tests.test_cli -v
```

## Known gaps

- Corporate-action, exchange-calendar, adjustment, symbol-master, and external
  object-store metadata have no standard content contract yet.
- V1 baseline/candidate comparison uses only one primary metric; richer robust
  gates remain future work.
- There are no streamed progress events.
