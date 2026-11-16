# Distribution build identity

Status: implemented Harness provenance contract.

Related: [[docs/design/versioning-and-release]],
[[docs/design/study-run-evidence]], [[docs/design/agent-cli-contract]],
[[docs/STUDIO]], and `plans/distribution-build-provenance`.

## Purpose

An AutoQuant worker must be able to identify its actual Harness before doing
research, including after installation from a wheel. Package version alone is
not enough: two candidate builds may share a version while containing different
bytes, and runtime Git discovery cannot reconstruct the checkout that produced
an installed distribution.

This document owns build provenance resolution and runtime-package closure.
Release numbering and publication remain in
[[docs/design/versioning-and-release]]. Immutable Run meaning remains in
[[docs/design/study-run-evidence]].

## Identity fields

One current Harness identity contains:

- `id`: the stable Harness implementation id;
- `version`: installed distribution version;
- `commit`: exact 40- or 64-hex Git source commit, or `unavailable` when no
  honest source exists;
- `dirty`: whether relevant runtime/build paths differed from that commit when
  the distribution identity was captured;
- `buildProvenance`: exactly `embedded-distribution`, `source-checkout`, or
  `unavailable`, naming how commit and dirty state were established;
- `sourceHash`: SHA-256-derived identity of the complete current AutoQuant
  runtime file closure;
- `python`: executing Python version.

Every discovery and new evidence surface projects this same seven-field object.
Historical Run, Check, and Session evidence may omit `buildProvenance`; that
older six-field form remains valid and is never rewritten.

Version, commit, and source hash answer different questions. Version names the
declared release line. Commit names the source point. Source hash identifies
the runtime bytes. Dirty state prevents a base commit from impersonating an
unchanged checkout.

## Build contract

`hatch_build.py` runs for both sdist and wheel targets and force-includes one
generated `autoquant/_build_identity.py` module. It never edits the checkout.

Resolution order is strict:

1. If the build root already contains a valid generated identity, preserve it.
   This is how a wheel built from an AutoQuant sdist retains the original
   checkout identity even though the extracted archive has no `.git`.
2. Otherwise accept Git only when `git rev-parse --show-toplevel` resolves to
   the exact build root. Record its commit and relevant dirty state.
3. Otherwise generate `commit: unavailable`, `dirty: false`.

Exact-root comparison prevents a source archive nested inside an unrelated
repository from borrowing that parent repository's commit. The embedded module
is generated data in distributions and is not checked into source.

Relevant dirty paths are `autoquant/`, `hatch_build.py`, `pyproject.toml`, and
`uv.lock`. Documentation, plans, tests, sample research state, and unrelated
Workspace files do not make an otherwise identical runtime build dirty.

## Runtime resolution

Installed code always prefers the embedded distribution identity before any
Git operation. Therefore a virtual environment inside an arbitrary Project or
Workspace repository still reports the AutoQuant build commit.

A direct source checkout has no generated module. It may discover Git only
when the package root's parent is the exact repository top level, using the
same relevant dirty paths as the build hook. All other environments report
unavailable rather than guessing.

`aq version --json` is the smallest authoritative discovery command.
`aq capabilities --json` embeds the same identity so a worker's ordinary
capability probe is sufficient. Studio snapshots and the top source label show
the same current runtime. New Runs, Candidate Checks, and Session locks all use
the shared `harness_identity()` function.

## Runtime closure hash

The Harness `sourceHash` inventories every regular, non-symlink runtime file
beneath the current `autoquant/` package. This includes Python modules, Project
templates, Studio HTML/CSS/JavaScript, Workspace Skills and their references or
scripts, schemas, and other packaged assets.

Generated `_build_identity.py`, `__pycache__/`, and `.pyc` files are excluded.
Commit and dirty state already identify build provenance, while caches are
machine-local derivatives. Excluding the generated identity also lets an exact
source checkout and its wheel retain the same runtime closure hash.

Changing any included runtime byte changes `sourceHash`. Changing only docs,
tests, plans, immutable sample evidence, or generated caches does not.

## Evidence and release boundary

Every new immutable Run binds the seven-field Harness identity into
`inputHash`. Historical Runs with `commit: unavailable` or without
`buildProvenance` remain truthful records of what the older Harness could prove
and are never rewritten.

An official release wheel must be built from the final clean tagged commit.
Candidate wheels may honestly record the current base commit with
`dirty: true`; they are field evidence, not the clean release artifact. Release
audit verifies that installed `aq version --json`, capability discovery,
Studio, and a new Run agree before publication.

This contract is provenance, not cryptographic signing or remote attestation.
AutoQuant does not claim that a commit exists on a particular remote, that a
tag is authentic, or that a wheel came from PyPI. Those are publication and
supply-chain concerns outside the running research desk.
