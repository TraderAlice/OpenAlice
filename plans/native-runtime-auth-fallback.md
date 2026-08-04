# Native Runtime Authentication Fallback

Status: Complete — delivered in serial PR #983

Owner guides:

- [[../docs/model-semantics-and-runtime-injection.md]]
- [[../docs/managed-workspace-runtime.md]]
- [[../docs/workspace-lifecycle.md]]

## Problem

OpenCode and Pi currently advertise that every launch requires Workspace-local
OpenAlice credentials. That is no longer true: both runtimes own native global
login/config state, and an existing user may intentionally depend on it. The
launcher consequently blocks or rewrites fresh and resumed Sessions when the
OpenAlice vault has no compatible API key, and some failed resumes remain in an
indefinite opening state without a useful repair target.

## Decisions

- Native runtime login/config is the default for OpenCode and Pi, as it already
  is for Claude Code and Codex.
- OpenAlice never imports or copies a runtime's global secret into its vault or
  a Workspace.
- An existing Workspace-local provider configuration remains authoritative.
- OpenAlice-managed provider injection happens only after an explicit user
  choice. Runtime readiness probes must not silently mutate a Workspace by
  injecting the first compatible vault credential.
- Packaged managed Pi still owns instance-scoped native login state under the
  complete OpenAlice home; “global” means global to that managed runtime, not
  necessarily the user's separately installed shell Pi.
- Launch and resume failures must settle the UI's opening state and surface the
  server/runtime error with the correct CLI-login or provider repair target.

## Work

- [x] Characterize launch, resume, readiness, and explicit credential paths.
- [x] Mark OpenCode/Pi as native-login-capable without weakening explicit
      Workspace credential overrides.
- [x] Remove implicit vault injection from readiness and ordinary launch.
- [x] Repair resume failure propagation and opening-state cleanup.
- [x] Update UI copy, demo capabilities, tests, and durable owner guidance.
- [x] Verify source types/tests, real browser behavior, and packaged Electron.
- [x] Deliver through the serial `dev` PR flow.

## Verification

- `npx tsc --noEmit`
- `pnpm test`
- `cd ui && npx tsc -b`
- Targeted Workspace credential/readiness/resume specs
- Real `pnpm dev` browser walk covering fresh and resumed OpenCode/Pi paths
- `pnpm electron:smoke:workspace`

Verified with 3,923 unit/integration tests, the non-trading Workspace E2E lane,
the real `pnpm dev` Chat surface, and the packaged Electron Workspace
acceptance. A native Pi probe also confirmed that a broken user-global provider
is reported as its real 401 authentication failure rather than being replaced
by an OpenAlice vault credential.

## Completion

The plan is complete when a Workspace with no OpenAlice credential can start or
resume OpenCode/Pi through valid native login, an explicit OpenAlice credential
still produces a Workspace-local override, failed native authentication is
visible and actionable, and the serial PR is merged to `dev`.
