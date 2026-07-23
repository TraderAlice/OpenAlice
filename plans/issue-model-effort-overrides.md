# Issue Model and Effort Overrides

Status: In progress

Related issues: #706, #710

Owner guides: [[docs/model-semantics-and-runtime-injection.md]],
[[docs/workspace-issues-and-scheduling.md]],
[[docs/conversation-provenance.md]]

## Outcome

Users with native Codex or Claude Code login state can save a Workspace-local
model and reasoning-effort preference without supplying an OpenAlice-managed
API key. Scheduled Issues can optionally select an agent, model, and effort for
one headless run without mutating the Workspace's persistent runtime files or
copying authentication into the Issue.

## Scope

- Establish the repository plan index and plan lifecycle rules.
- Correct login-backed Codex and Claude Code Workspace-local projection.
- Correct the Workspace AI modal's probe/save boundary.
- Extend the Issue file, API, tool, CLI, scheduler, task record, and runtime
  dispatch contracts with optional model and effort overrides.
- Project one-run overrides into all runtimes where the installed CLI exposes a
  stable flag, while preserving provider/model registration constraints.
- Update owner guides, agent-facing scheduling guidance, demo handlers, and
  tests with the delivered contract.

Not in scope:

- Storing credentials, endpoints, or provider selection on an Issue.
- Changing an exact Session assignee's runtime binding in the first increment.
- Turning the model registry into a live remote catalog.
- Rewriting existing Issue files merely because optional fields were added.

## Decisions

1. Workspace defaults and run overrides are separate layers.
   Workspace-local files own durable defaults; explicit CLI arguments own one
   Issue run and take precedence.
2. An Issue stores flat optional `model` and `effort` fields beside `agent`.
   Omission means inherit the Workspace/native runtime default.
3. Authentication and provider routing are always inherited from the selected
   Workspace runtime. Issue files never contain secrets.
4. Exact `@resumeId` assignees continue to own their runtime and initially
   reject `agent`, `model`, and `effort` overrides.
5. Login-backed Codex project preferences use `.codex/config.toml` without
   changing `CODEX_HOME`. OpenAlice-managed custom Codex providers retain an
   explicit isolated home.
6. A model/effort-only native-login save does not require an HTTP credential
   probe. Endpoint, key, auth, or wire changes still do.
7. Run records retain requested model and effort so the Runs UI and future
   provenance work can explain the dispatch decision.

## Work

### 1. Planning and durable documentation

- [x] Audit existing owner-guide and plan infrastructure.
- [x] Add `PLANS.md`, this plan, and plan rules to `AGENTS.md`.
- [x] Update model-injection and scheduling owner guides with the final
  contract.

### 2. Workspace-local native login configuration

- [x] Split Codex native project preferences from isolated custom-provider
  `CODEX_HOME` ownership.
- [x] Preserve user-owned Codex project configuration and restore only
  OpenAlice-owned keys.
- [x] Treat Claude effort-only configuration as a valid local projection.
- [x] Let native-login model/effort changes save without a credential probe.
- [x] Add adapter, route, and UI regression tests for model-only and
  effort-only login-backed configuration.

### 3. Issue declaration and mutation contract

- [x] Add optional `model` and `effort` fields to declaration parsing and
  serialization.
- [x] Enforce compatible assignee/agent/model/effort combinations.
- [x] Extend HTTP, UI API, CLI, MCP tools, demo handlers, and agent-facing
  scheduling instructions.
- [x] Add Issue editor controls with clear inheritance semantics.

### 4. Headless dispatch and runtime projection

- [x] Carry requested model/effort through scanner dispatch and task records.
- [x] Add typed per-run overrides to adapter command composition.
- [x] Map Codex, Claude Code, opencode, and Pi overrides to native CLI flags.
- [x] Define safe behavior when an opencode/Pi model is not registered by the
  inherited provider configuration.
- [x] Keep exact Session ownership unchanged and covered by tests.

### 5. Verification and delivery

- [x] Run targeted adapter, Issue, scheduler, route, demo, and UI tests.
- [x] Run `npx tsc --noEmit`.
- [x] Run `cd ui && npx tsc -b`.
- [x] Run `pnpm test`.
- [x] Walk the real Workspace AI and Issue editor routes in browser/dev.
- [x] Run the proportional Electron/workspace smoke required by the final
  touched runtime surface.
- [x] Update this plan and owner guides to match delivered behavior.
- [ ] Publish and merge a serial PR to `dev`, then move this plan to Completed.

## Completion Criteria

- A logged-in Codex or Claude Code user can persist only model and/or effort
  for one Workspace without adding an API key or losing global login state.
- A scheduled `@workspace` or `@new` Issue can inherit all runtime defaults or
  explicitly select supported agent/model/effort values for that run.
- One-run selection is visible in the durable task record and does not rewrite
  Workspace configuration.
- Exact Session ownership rejects conflicting runtime overrides.
- Required typechecks, tests, real UI verification, and proportional runtime
  smoke pass.
