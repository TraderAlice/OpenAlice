# Plan: Session coworker `displayName`

**Status:** active  
**Owner guides:** [[docs/conversation-provenance.md]], [[docs/data-locations.md]], [[docs/model-semantics-and-runtime-injection.md]], [[docs/workspace-agent-guidance.md]]  
**Delivery:** serial PR to `dev` (`area:workspace`). Open PR, do not merge.

## Goal

Product Sessions are durable coworkers. Their public label should be a
Workspace-owned `displayName`, not the conversation `title` copied from a
native CLI. Agents rename a coworker by writing a Workspace file through a
small CLI, without touching launcher roster state or the frozen AI binding.

## Decisions

1. **Storage.** `displayName` lives on
   `<workspace>/.alice/sessions/<resumeId>.json` as a **sibling of `ai`**, not
   inside `SessionRuntimeBinding` and not on launcher
   `workspaces/state/sessions/<wsId>.json`.
2. **File evolution.** That file is a Session dossier. `ai` stays the
   first-write-wins launch binding. `displayName` is optional and mutable.
   Historical files without `displayName` stay valid. A rename may create the
   file before any AI binding exists; `ai` remains optional on read.
3. **Writes merge.** Writing `ai` must preserve `displayName`. Writing
   `displayName` must preserve `ai`. Agents must not hand-edit the whole JSON.
4. **Label order.** `displayName` → native/`fallback` `title` → sticky `name`
   (`p1`). Native title refresh never overwrites `displayName`.
5. **Clear.** Empty or `null` removes the field. Max length matches Workspace
   metadata: 120 characters after trim.
6. **Mutation surface.** One domain mutator. CLI:
   `alice-workspace session rename --resume-id <id> --display-name <name>`.
   HTTP: `PATCH /api/workspaces/:id/resumes/:resumeId/metadata`. Both only
   touch `displayName`. Scope is the caller/owning Workspace.
7. **No migration.** Unreleased-or-additive optional field. Missing means
   unnamed.

## Alternatives considered

1. **Put `displayName` on `SessionRecord`.** Agents would need a launcher API
   and the name would not travel with the desk. Rejected.
2. **Put it inside `ai`.** Mixes an immutable launch binding with a mutable
   nametag. Rejected.
3. **Let agents rewrite the JSON.** One bad write can destroy credential /
   model / effort. Rejected; CLI/API only.

## Increments

### 1. Dossier + rename + projection

- [x] Parse/write `displayName` on the Session dossier; keep `ai` optional on read.
- [x] Hydrate `displayName` onto the in-memory resume identity (strip on flush,
  same as `runtimeBinding`).
- [x] Project it on the public Session roster and Session directory.
- [x] CLI `session rename` and HTTP metadata PATCH.
- [x] UI label helpers prefer `displayName` without changing conversation `title`.
- [x] Owner guides + `alice-workspace` skill.

Acceptance: rename a coworker, refresh, sidebar/directory show the new name;
`ai` in the same file is unchanged; clearing the name falls back to `title`.

## Verification

```bash
npx tsc --noEmit
cd ui && npx tsc -b
pnpm test
```

Cover store merge, resume hydrate, HTTP/CLI rename, and label precedence.
Follow [[docs/workspace-issues-and-scheduling.md]] only if a later increment
touches Issue assignee display.

## Completion

Delete this plan and its [[PLANS.md]] bullet in the accepting change.
