# OpenAlice Implementation Plans

This file indexes substantial, multi-step implementation work. Plans describe
how repository truth will change; owner guides under [[docs/README.md]] describe
the durable truth after it changes.

## Plan Contract

- Create `plans/<topic>.md` when work spans multiple subsystems, delivery
  increments, or sessions.
- Each plan names its status, related issues, owner guides, scope, decisions,
  ordered checklist, verification, and completion criteria.
- Update progress in the same commit as the work it describes. Do not mark a
  step complete before its code and required verification exist.
- Record material discoveries and changed decisions in the plan. Move stable
  architectural conclusions into the linked owner guide.
- Keep completed plans in the repository as concise execution history and move
  their index entry from Active to Completed.
- Use GitHub issues for externally visible defects and deferred findings; plans
  may coordinate those issues but do not replace them.

## Active

No active plans are indexed yet.

## Completed

- [[plans/issue-model-effort-overrides.md]] — Separated login-backed Workspace
  model defaults from provider isolation and added per-run Issue model/effort
  overrides. Delivered in PR #715; closed GitHub issues #706 and #710.
