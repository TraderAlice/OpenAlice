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

- [[plans/remote-project-fleet.md]] — Adds a machine-aware Supervisor fleet,
  remote AliceProject inventory/connection, and safe local-to-SSH project
  transfer for portable configuration and Workspaces while deliberately
  excluding native/OpenAlice Session continuation state.
- [[plans/auto-prediction-harness.md]] — Auto Prediction Beta conversation
  Harness is in `dev`; managed AP/AQ Studio supervision, opaque routing, and
  embedded product surfaces are implemented. Shared verified/unverified source
  release management and cross-runtime acceptance remain active.
- [[plans/antigravity-adapter.md]] — Antigravity (`agy`) CliAdapter.
  PATH `agy` only; never spawn `antigravity` / `gemini`.
  Serial PR from `feat/agy-adapter`; do not merge until Ame says so.
- [[plans/agent-runtime-log.md]] — Append-only agent runtime lifecycle log
  (`session.born` / started / stopped / rejected / headless turn assets).
  Occupancy + Office timeline + headless text/tool/completion are in;
  the floor canvas lives in [[plans/office-floor.md]].
- [[plans/office-floor.md]] — Office overworld rebuild: one continuous 4:3
  top-down tilemap; Harness=functional neighborhood, Workspace=furniture pod,
  `resumeId`=employee. Scene graph, top-down placeholders, game chrome, camera,
  and browser acceptance remain active.
- [[plans/issue-comment-prompt.md]] — Optional per-Issue `commentPrompt`
  template for comment-reply Input Prompts. Omission keeps the historical
  wrapper; chat desks seed `{comment}`.
- [[plans/telegram-connector-issue.md]] — One Issue per Alice Project is the
  Telegram phone desk: What is the heartbeat prompt, comments are the chat,
  Connector only transports. Increment 1 bound the desk in Settings.
  Increment 2 projects comments unless `[[no-reply]]`.
- [[plans/connector-desk.md]] — Desk specimen is shared; each `desk` adapter
  owns its own Issue. Increment 1 generalizes `telegramConnector` →
  `connectorDesk: <id>`. Feishu adapter is a later increment.
- [[plans/connector-inbox-commands.md]] — Connectors declare `inbox` and
  `settings` capabilities and implement their own slash-command forms.
  Telegram uses a bounded `/inbox` summary plus on-demand file pull;
  Discord/Slack stay placeholders. `inboxPush` can mute push without
  touching the phone desk.
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
