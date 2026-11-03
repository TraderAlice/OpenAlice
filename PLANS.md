# OpenAlice Implementation Plans

This file indexes **active** multi-step implementation work. Plans describe
how repository truth will change; owner guides under [[docs/README.md]] describe
the durable truth after it changes. Git history is the archive.

## Plan Contract

- Create `plans/<topic>.md` when work spans multiple subsystems, delivery
  increments, or sessions.
- Each plan names its status, related issues, owner guides, scope, decisions,
  ordered checklist, verification, and completion criteria.
- Update progress in the same commit as the work it describes. Do not mark a
  step complete before its code and required verification exist.
- Record material discoveries and changed decisions in the plan. Move stable
  architectural conclusions into the linked owner guide.
- Completing a plan is a deletion: remove `plans/<topic>.md` and its Active
  bullet in the same change that records acceptance. Do not keep a Completed
  section, tombstone bullets, or an on-tree `plans/archive/`. Recover a
  finished plan from git:

  ```bash
  git log --diff-filter=D --summary -- plans/
  git show <deletion-commit>^:plans/<topic>.md
  ```

- Use GitHub issues for externally visible defects and deferred findings; plans
  may coordinate those issues but do not replace them.

## Active

- [[plans/windows-signpath.md]] — SignPath Foundation self-signed onboarding,
  public signing policy, and production Windows release integration.
- [[plans/remote-project-fleet.md]] — Machine-aware Supervisor fleet, remote
  AliceProject inventory/connection, and local-to-SSH project transfer are in
  `dev`; Increment 7 (controller-driven remote release convergence) remains open.
- [[plans/auto-prediction-harness.md]] — Auto Prediction Beta conversation
  Harness, managed AP/AQ Studio supervision, opaque routing, and shared source
  release lifecycle are in `dev`; cross-runtime acceptance remains active.
- [[plans/session-presence.md]] — In-desk Session presence (`active` /
  `archived` / `deleted`) separate from Workspace `retired`, uncapped Ask Alice
  roster, and Archive as the primary floor action. Increments 1–2 are in `dev`;
  Increment 3 (`deleted` / undelete) remains open.
- [[plans/connector-desk.md]] — Shared desk execution specimen where each
  `desk`-capable adapter owns its own Issue (`connectorDesk: <id>`). Increments
  1–2 (specimen extraction + Feishu adapter) are in `dev`; Increment 3 (Feishu
  `/inbox` and `/uta` cards) remains deferred.
