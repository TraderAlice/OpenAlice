# Versioning and release

Status: active pre-1.0 release policy.

Related: [[README]], [[docs/STATUS]], [[docs/CHANGELOG]],
[[docs/ARCHITECTURE]], [[AGENTS]], `PLANS`, and
[[docs/design/documentation-system]].

## Purpose

This document owns AutoQuant version meaning, release preparation, verification,
tagging, and host-version boundaries. README owns product orientation and quick
start. `docs/STATUS.md` owns only current tested capability and boundaries.
`docs/CHANGELOG.md` owns concise chronological release summaries. Completed
plans preserve the exact proof for one release.

Do not copy release histories, command transcripts, or per-version audit numbers
back into README.

## Version authority

One release version must agree across:

- `pyproject.toml` package metadata;
- `uv.lock` lock metadata;
- repository-root `harness.json` product version (its independent
  `manifestVersion` belongs to the host capability protocol);
- `autoquant/version.py` runtime reporting of installed package metadata (it
  has no separately edited version literal);
- `hatch_build.py` embedded commit/dirty provenance for built distributions;
- the README front matter and concise current-release pointer;
- the Git tag `v<version>`.

Changing those files creates only a release candidate. The immutable Git tag is
the published version authority. Every Run independently records Harness
version, commit, dirty state, source hash, and Python version, so research
evidence never relies on the mutable checkout's current label alone.
Exact build and runtime-closure semantics are defined in
[[docs/design/distribution-build-identity]].

## Increment policy

AutoQuant is pre-1.0. Compatibility matters, but a pre-1.0 version is not a
promise that every mutable Workspace checkout can be upgraded automatically.

- Patch increments (`0.9.17` to `0.9.18`) are the default. Use them for bounded
  correctness fixes, one proven research route, read-model completion, Agent
  ergonomics, or compatible contract refinement.
- Minor increments (`0.9.x` to `0.10.0`) require a meaningful product layer,
  lifecycle change, or broad public-contract expansion.
- Major versions are reserved for a genuinely stable new generation. They are
  not a counter for nights of development or the number of shipped features.

Bump the version late, after focused implementation and candidate behavior are
credible. Several commits may belong to one unreleased patch candidate.

## Compatibility and Workspace upgrades

AutoQuant does not currently provide `aq upgrade` or a Workspace migration
protocol. A coding Agent may pull ordinary Git changes and resolve a small
conflict, or retire an old desk and create a fresh one when reconciliation is
not worthwhile. Immutable Runs and Reports retain their original Harness
identity.

Breaking a public pre-1.0 contract still requires an explicit design decision,
updated schemas and docs, deterministic tests, and an honest note in
`docs/STATUS.md`. Do not add speculative compatibility machinery before a real
Project demonstrates the need.

Host selection is independent. OpenAlice or another host pins the AutoQuant tag
it has deliberately selected; publishing a newer repository tag does not move
that pin, rewrite a desk, or migrate Project state. Record the current host pin
in `docs/STATUS.md`, not as a package-side upgrade action.

A source-Workspace host prepares the selected tag with AutoQuant's documented
`uv sync --frozen` command. Capability startup must execute the checked-in
manifest literally under an ordinary parent `PATH`; the supervisor does not
activate `.venv`, install dependencies, or rewrite the manifest command.

## Release evidence

The active plan owns the live release checklist and exact verification output.
When complete:

- the plan keeps the candidate and final evidence, hashes, exceptions, and
  acceptance audit;
- `docs/STATUS.md` replaces the current capability, honest boundary, current
  verification summary, and link to that plan;
- `docs/CHANGELOG.md` gains one concise outcome row and plan link;
- README changes only its current-version pointer and links.

Historical evidence remains append-only in completed plans and immutable tags.
Only its concise index accumulates in CHANGELOG; neither README nor STATUS is a
historical ledger.

## Required release audit

Run focused tests throughout development. Before publishing a tag, reconcile at
least:

```bash
uv lock --check
uv run python -m py_compile autoquant/*.py
uv run python scripts/check_doc_links.py
uv run python -m unittest discover -s tests -v
uv build
```

Then install the built wheel into a fresh Python 3.11 environment and verify:

- `aq --version`, `aq version --json`, and `aq-python` resolve to the installed
  candidate; exact version/commit/dirty/source-hash identity agrees across
  version discovery, capabilities, Studio, and a newly executed Run;
- capability and changed schema discovery work from the installed package;
- the repository-root Workspace can orient, validate, list Projects, and build
  a Studio snapshot without an ignored local override;
- package contents include every runtime asset and Skill required by the public
  contract;
- candidate field evidence required by the active plan came from the built
  wheel, not ambient source imports.

The active plan may require additional bounded domain checks. A full long-range
backtest is not a routine release gate.

## Publish order

1. Finish the active plan's acceptance and candidate replay.
2. Update version authorities, current status, and final verification evidence.
3. Confirm the intended diff and a clean test/build audit.
4. Commit the release intentionally and push the commit.
5. Create annotated tag `v<version>` at that exact pushed commit and push it.
6. Verify the remote branch and tag resolve to the same commit.

Never move a published release tag to hide a correction. Fix forward with the
next patch release.

## Change checklist

- Keep version policy here, current capability in `docs/STATUS.md`, concise
  history in `docs/CHANGELOG.md`, and exact work evidence in the
  active/completed plan.
- Keep README concise and newcomer-oriented.
- Update package, lock, runtime, README metadata, commit, and tag together.
- Preserve immutable evidence identity across mutable checkout upgrades.
- Keep host pins explicit and independent.
