# Semantic Issue assignees

Status: completed in serial PR #990

Related owner guides:

- [[docs/workspace-issues-and-scheduling.md]]
- [[docs/conversation-provenance.md]]

## Scope

Replace the ambiguous scheduled-Issue assignee tokens with behavior-named
canonical values while preserving existing Workspace data:

- `@new-each-run` — recruit a fresh Session for every fire;
- `@new-then-resume` — recruit once, then persist the concrete `@resumeId`;
- exact `@resume-*` signatures remain unchanged.

Legacy `@workspace` and `@new` values remain read-compatible only. They are
deprecated, rejected by new write surfaces with a replacement hint, and
migrated idempotently. Unscheduled Issues without an owner project as
`@unassigned`; the old unscheduled `@workspace` default is migrated there.

## Non-goals

- Changing schedule timing, retry, health, or Session-resume behavior.
- Renaming exact `@resume-*`, `@human`, or `@unassigned` values.
- Introducing a second dispatch-policy field.

## Work

- [x] Add canonical constants, legacy read compatibility, and strict writer validation.
- [x] Add migration 0033 with backups, idempotency, and malformed-file isolation.
- [x] Update scheduler, API, CLI, UI, fixtures, and focused tests.
- [x] Update the shipped self-scheduling skill and durable owner guides.
- [x] Run migration index generation, type checks, tests, real CLI, browser, and package smoke.
- [x] Deliver through one serial PR to `dev`.

## Completion

New product and agent surfaces never emit or recommend `@workspace` or `@new`;
existing files continue to load before migration and are rewritten to canonical
tokens by migration 0033 without changing their schedule behavior or markdown
What.
