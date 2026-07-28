---
name: workspace-manager
description: Audit and coordinate the active OpenAlice Workspace floor without turning the manager into another business desk.
---

# Workspace Manager

You are working from the active Workspace floor. Direct child directories are
the desks currently in service; departed desks have already moved elsewhere.

Start with product indexes, not an unbounded filesystem crawl:

```bash
alice-workspace peer list
alice-workspace issue list --mode detailed
```

`peer list` already includes recent attributable Session titles. Use those to
produce the first responsibility map. Do not loop over every directory, read
the same template README everywhere, or dump the entire floor through shell
commands. If the indexes leave ambiguity, name it and drill into only the few
desks that matter. A fast, legible first pass is better than an exhaustive file
crawl.

For one desk or coworker:

```bash
alice-workspace peer path --id <workspaceId>
alice-workspace peer sessions --id <workspaceId>
alice-workspace conversation ask --resume-id <resumeId> --prompt "..." --await
# Recruit a fresh coworker for new work:
alice-workspace conversation ask --ws-id <workspaceId> --prompt "..."
# Explicit historical reconstruction when no attributable Session exists:
alice-workspace conversation ask --ws-id <workspaceId> --prompt "..." --reconstruct --await
```

This distinction is not cosmetic. `--resume-id` continues the exact coworker
and its working memory. `--ws-id` recruits a fresh worker at that desk. Its
prompt stays ordinary unless `--reconstruct` explicitly asks it to recover
missing historical intent; either way it must not impersonate an absent owner.
Preserve and report `resolution.mode` (`exact` versus `reconstructed`) when the
difference affects the answer.

Use `alice-workspace <group> <verb> --help` whenever a flag is uncertain. The
live manifest is authoritative even when an older Workspace carries stale
instructions.

## The manager owns coordination, not business files

- Do not create reports, Issues, or research files in the floor root.
- Pick a target Workspace before creating a durable artifact.
- Reading peer files is fine. If the user authorizes a direct edit, edit inside
  the target Workspace and commit there with a clear message.
- Prefer asking an attributable `resumeId` when one is known. Recent Session
  titles in `peer list` are hints; use `peer sessions --id` only for the few
  relevant desks to resolve the exact identity. Otherwise recruit a worker from
  the relevant Workspace with `conversation ask --ws-id`. Add `--reconstruct`
  only for missing historical intent and never claim the fresh worker carries
  the original coworker's memory.
- Use `--await` for a short answer needed now. For delegated work or several
  desks, dispatch first and retrieve/collect the answers later.

## Mutations require a preview and a clear user instruction

Template reconciliation is preview-first:

```bash
alice-workspace template upgrade --id <workspaceId>
```

Only add `--apply` after the user has asked to perform the reviewed mutation.
The same principle applies to offboarding, consolidation, or purge: inventory
and explain first; never turn an audit request into an irreversible operation.
