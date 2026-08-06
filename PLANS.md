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

- [[plans/semantic-issue-assignees.md]] — Replaced ambiguous scheduled-Issue
  assignee tokens with behavior-named canonical values, explicit deprecated
  aliases, and an idempotent Workspace-file migration. Delivered in serial PR
  #990.
- [[plans/issue-runtime-choice.md]] — Made scheduled Issue launch selection a
  credential-first flow, narrowed model and effort choices to that provider,
  and froze the result in the new Session runtime binding.
- [[plans/session-runtime-bindings.md]] — Made credential source, model, and
  effort a durable product-Session binding projected by every Agent adapter
  across interactive, Web, and headless launch/resume.
- [[plans/native-runtime-auth-fallback.md]] — Makes OpenCode and Pi honor their
  native global login/config by default, keeps OpenAlice-managed credentials as
  an explicit Workspace override, and makes launch/resume authentication
  failures visible instead of leaving Sessions stuck opening. Delivered in
  serial PR #983.
- [[plans/pi-local-workspace-provider.md]] — Moved OpenAlice-managed Pi
  provider registration from the user-global model registry into reversible,
  Workspace-local extension state. Delivered in serial PR #981.
- [[plans/runtime-ui-style-profiles.md]] — Added independent runtime-selectable
  component appearance profiles for Default, Windows 98, and Broker Classic
  while preserving palette choice and shared shadcn/Base UI behavior. Delivered
  in serial PR #976.
- [[plans/shadcn-systematic-ui-audit.md]] — Exercised every installed
  shadcn/Base UI primitive through real product entries, repaired the
  menu-to-dialog focus handoff, and passed browser, full-suite, build, and
  packaged Electron acceptance. Delivered in serial PR #974.
- [[plans/shadcn-base-ui-migration.md]] — Replaced the initial Radix-backed
  shadcn primitives and custom overlay patches with the official Base UI + Nova
  source while preserving OpenAlice's product hierarchy and palette. Delivered
  for integration in serial PR #973.
- [[plans/mobile-activity-sheet.md]] — Moved the phone ActivityBar onto the
  shared Sheet behavior while preserving the static desktop rail. Delivered as
  serial PR #971 after the foundation in PR #970 was accepted and merged.
- [[plans/shadcn-overlay-foundation.md]] — Established an OpenAlice-owned
  shadcn/Radix primitive layer, retired representative hand-written overlay
  behavior, and preserved the current product hierarchy and visual language as
  the foundation for later runtime-selectable style profiles. Implemented in
  Draft PR #970.
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
