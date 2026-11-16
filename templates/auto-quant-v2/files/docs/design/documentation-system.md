# Design documentation system

Status: active, pre-alpha.

## Purpose

AutoQuant V2 is being built as a long-running Agent-native quantitative
workbench rather than a one-off strategy repository or an OpenAlice-specific
backend. Design decisions and current work must remain discoverable while
implementation evolves and while coding Agents replace or hand work to one
another. `AGENTS.md` routes contributors to both systems: files in
`docs/design/` are the subsystem-level source of design intent, while
`PLANS` and `plans/` describe bounded work and its execution state.

The canonical product identity and standalone/hosted composition remain in
[[docs/design/agent-native-quant-workbench]]. High-level architecture remains
in [[docs/ARCHITECTURE]]. Canonical Workspace/Project formats and executable
commands remain in [[docs/PROJECT_FORMAT]] and [[docs/CLI]]. Design documents
explain invariants, ownership, trade-offs, and how public contracts are
implemented.

README is the concise product entrance: identity, current-version pointer,
quick start, and routing links. [[docs/OPERATOR_GUIDE]] owns the complete public
path from entering a Workspace through Project construction, data binding,
governed research, evidence publication, and Studio observation. It connects
canonical references but does not replace their schemas or invariants.
[[docs/STATUS]] owns only current tested capability and honest boundaries.
[[docs/CHANGELOG]] is the append-only concise release index.
[[docs/design/versioning-and-release]] owns version meaning, checkout upgrades,
compatibility limits, release audit, and tag publication. Exact evidence for
one release remains in its completed plan. Do not let README grow into a
second operator manual, status ledger, or release playbook, or STATUS into a
second changelog.

README has a 220-physical-line entry budget enforced by tests. This is a
tripwire against accidental linear growth, not permission to compress complex
rules into unreadable prose. When the entrance needs more detail, route one
level deeper to the operator guide or the owning reference/design document.
Changing the budget requires an explicit documentation-system decision.

## Work plans

`PLANS` is the authoritative status index for repository work that needs
explicit coordination. Each indexed file under `plans/` owns one bounded
outcome, its scope, acceptance criteria, work checklist, discoveries,
verification evidence, and completion record. New plans start from
`plans/_template`.

Plans and design documents answer different questions:

- a plan says what outcome is being pursued, what remains, and how completion
  will be proved;
- a design document says how the current system works and which invariants
  future changes must preserve;
- tests provide executable evidence for both, but do not replace either
  explanation.

A plan may begin with incomplete understanding. Update its findings and route
as facts emerge. When discoveries change lasting system behavior, update the
relevant design document in the same implementation change. Completed plans
remain concise execution records, but they are not normative: current code,
tests, and active design documents win if history diverges.

Use the five lifecycle states defined by `PLANS`: `proposed`, `active`,
`paused`, `completed`, and `superseded`. A completed plan has no unchecked
acceptance or work items. A superseded plan links to its replacement. Do not
use either state to hide deferred work; index that work separately when it
still matters.

## Link convention

Use wiki-style links for design routing:

```text
[[docs/ARCHITECTURE]]
[[docs/CLI]]
```

Paths are repository-root relative and omit `.md`. An optional display label
or heading is allowed, for example:

```text
[[docs/ARCHITECTURE#Ownership boundaries|ownership boundaries]]
```

`uv run python scripts/check_doc_links.py` scans Markdown files and fails on
any unresolved double-link. The check is also exercised by the fast unit test
suite.

## Document ownership

Each subsystem design document should contain:

- scope and explicit non-goals;
- authoritative code and data locations;
- invariants that validation or runtime must enforce;
- file → prepare → execute → evidence → CLI/Studio flow;
- verification commands and important tests;
- a checklist for changes to that subsystem;
- known gaps when the design is intentionally incomplete.

Avoid copying complete schemas or CLI help into design documents. Link to the
canonical reference and describe the semantics that make those fields
necessary.

## Update protocol

A code change requires a document update when it changes a domain concept,
invariant, public JSON field, validation diagnostic, runtime event, evaluation
decision, CLI/JSON output, artifact identity, or Studio interpretation.
Mechanical refactors that preserve all contracts may omit a design edit.

When a design is replaced:

1. update the existing document to describe the new model;
2. delete obsolete statements rather than preserving a historical
   compatibility section;
3. migrate current examples and active-format fixtures;
4. add or update executable evidence;
5. keep `AGENTS.md` pointing only to active documents.

Git history and completed plans are the archive. Active design documents
describe only the current intended system. Historical immutable Runs remain
evidence under their recorded Harness versions and must not be rewritten to
look current.

## Review checklist

- Is non-trivial work represented by a current entry in `PLANS`?
- Does README remain a bounded entrance, with operational detail routed through
  [[docs/OPERATOR_GUIDE]] and release detail routed through
  [[docs/design/versioning-and-release]]?
- Does the plan status match its checklist, evidence, and completion record?
- Does every affected subsystem have an indexed design document?
- Does the change preserve the standalone/hosted parity and Agent-first
  requirements in [[docs/design/agent-native-quant-workbench]]?
- Do described invariants match the current schemas, code, and runtime?
- Can an engineer find relevant tests and CLI commands from the document?
- Are fixtures and result identities generated from the current model?
- Does `uv run python scripts/check_doc_links.py` pass?
