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

- [[plans/shell-first-cli-supervisor.md]] — Delivers a first-class Shell
  Supervisor TUI, persistent Guardian-owned Runtime lifecycle, standalone
  headless release bundle, atomic update/rollback, and real N-1 plus PTY
  acceptance through serial increments.

## Completed

- [[plans/desktop-upgrade-release-gate.md]] — Adds a real N-1 desktop-state
  upgrade journey to the native package matrix and validates final updater
  metadata and artifacts before a release can be published.
- [[plans/desktop-update-reliability.md]] — Makes packaged desktop updates
  visibly progress through shutdown and installer handoff, records update
  attempts, and surfaces backend startup failures instead of silently exiting.
- [[plans/retire-workspace-adapter-pins.md]] — Retires the legacy per-Workspace
  adapter allowlist so runtime availability comes from the live installation
  registry and future default-enabled choices can live in global preferences.
- [[plans/auto-quant-v2-harness.md]] — Adds AutoQuant V2 as a first-class
  version-pinned Harness, then refines it into an explicitly initialized
  default desk with Session-first daily UI and pinned `v0.8.31` source.
- [[plans/cli-lifecycle-quality.md]] — Aligns the computer-level CLI with the
  OpenAlice product version and adds bounded update discovery, installer-backed
  updates, and state-preserving CLI uninstall. Delivered in PR #847.
- [[plans/agent-conversation-log-ui.md]] — Adds a read-only, paginated Agent
  collaboration view to Dev Logs without exposing launcher file paths or
  introducing a new dispatch surface. Delivered in PR #742.
- [[plans/agent-conversation-semantics.md]] — Separates ordinary peer
  conversation from explicit artifact reconstruction, documents synchronous
  and asynchronous delegation, and records cross-Agent exchanges in a
  dedicated local event log. Delivered in PR #741.
- [[plans/broker-pack-release-safety.md]] — Repaired the v0.85 existing-user
  Broker Pack upgrade gap, shipped v0.86.0-beta, and made N-1→N reconciliation
  a blocking release contract.
- [[plans/workspace-launch-configuration.md]] — Adds a Workspace-local default
  Session runtime and makes the resolved launch plan inspectable from the
  existing Workspace settings panel.
- [[plans/windows-headless-launch.md]] — Safely launches Windows npm Agent
  runtimes for scheduled work and makes pre-process failures observable.
- [[plans/issue-model-effort-overrides.md]] — Separated login-backed Workspace
  model defaults from provider isolation and added per-run Issue model/effort
  overrides. Delivered in PR #715; closed GitHub issues #706 and #710.
