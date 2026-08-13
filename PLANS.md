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

- [[plans/cron-catch-up.md]] — Cron schedules catch up a missed fire by default
  (same as `every`); `catchUp: false` waits for the next calendar slot.
- [[plans/session-presence.md]] — Give product Sessions an in-desk presence
  (`active` / `archived` / `deleted`) separate from workspace `retired`, uncap
  the Ask Alice roster, and make Archive the floor action instead of deleting
  a coworker. Increment 1 landed in PR #1069; persisted presence remains open.
- [[plans/release-feedback-reliability.md]] — Batch 1 (deterministic/early
  release feedback) landed in PR #1061. Batch 2 still needs per-platform N-1
  fan-in and accepted-tree provenance without weakening release gates.
- [[plans/shell-first-cli-supervisor.md]] — Delivers a first-class Shell
  Supervisor TUI, persistent Guardian-owned Runtime lifecycle, standalone
  headless release bundle, atomic update/rollback, and real N-1 plus PTY
  acceptance through serial increments. Increments 1–2 and most of 4/6/7 are
  in `dev`; remaining work is the TypeScript CLI conversion, logs/Doctor/update
  UX, config check, registry deletion, authenticity-hardened updates, and
  release-gate N-1.
