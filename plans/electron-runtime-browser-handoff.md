# Electron Runtime Browser Handoff

Status: Complete

Owner guides:

- [[docs/cli-supervisor.md]]
- [[docs/data-locations.md]]
- [[docs/managed-workspace-runtime.md]]

## Goal

When Electron starts against a complete `OPENALICE_HOME` already owned by a
healthy dev or CLI Server Runtime, present that owner as something the user can
continue using instead of treating it only as a lock conflict. The primary
action opens the verified existing Web endpoint in the default browser.

This is complete-home ownership, not ownership of one individual Workspace.
The dialog must name the data location and owner surface accurately so users do
not infer that only the currently selected Workspace is locked.

## Decisions

- Guardian remains single-writer. Browser handoff does not release, steal, or
  mutate the existing owner.
- Electron consumes the same private `runtime.status` contract as the Shell
  Supervisor; it does not infer a Web port from lock metadata.
- Show **Open in browser** only when the discovered endpoint is a verified
  loopback HTTP URL and its auth/readiness probe succeeds.
- A healthy dev or CLI Server owner makes browser handoff the default action.
  **Choose another data location** remains available. Takeover stays explicit,
  destructive-looking, and secondary.
- Electron-owned, incompatible, starting, unhealthy, and stale owners retain
  tailored recovery paths; they must not receive a misleading browser action.
- Opening the existing Runtime quits the redundant Electron startup attempt
  after the browser request succeeds. Failure leaves the dialog open with a
  useful diagnostic.
- Canonical sanitizer, control client, and startup decision table live in
  `@traderalice/guardian-runtime`. The installed CLI payload still mirrors
  `classifyControlStatus` locally because it cannot import the workspace
  package graph; keep those two classifiers aligned.

## Work

- [x] Move the normalized local discovery client into guardian-runtime so
  Electron uses one sanitizer and compatibility policy. The installed CLI
  continues to ship its mirrored classifier.
- [x] Enrich the existing-owner startup decision with owner surface, lifecycle
  state, component health, and verified Web endpoint.
- [x] Replace the generic conflict dialog for healthy dev/CLI owners with
  **Open in browser**, **Choose another data location**, and an explicit
  takeover path.
- [x] Preserve current stale-owner, failed-recovery, selection-lock, and
  packaged-data-relocation behavior.
- [x] Add deterministic decision-table tests for every owner/state/endpoint
  combination.
- [x] Add a real isolated journey: start dev and CLI Server owners separately,
  launch Electron on the same home, probe the advertised page, and prove the
  original owner PID and lock survive unchanged.

## Verification

- `pnpm -F @traderalice/guardian-runtime test`
- `pnpm -F @traderalice/desktop typecheck`
- `pnpm test:guardian-recovery`
- `pnpm electron:smoke:guardian-recovery`
- `pnpm electron:smoke:existing-owner`
- A real browser probe of the advertised loopback endpoint for both dev and
  CLI Server owners, using disposable complete homes only.

Recorded locally against this change:

- guardian-runtime: 8 files / 48 tests passed
- focused desktop + workflow specs passed
- `pnpm -F @traderalice/desktop typecheck` and `npx tsc --noEmit` passed
- `pnpm test:guardian-recovery` passed
- `pnpm electron:smoke:existing-owner` passed for both `dev` and `cli-server`
  fixtures; original owner PIDs survived
- `pnpm electron:smoke:guardian-recovery` was not re-run here; the existing
  takeover path is unchanged and remains gated in Desktop Package Smoke
- full `pnpm test` was not used as the acceptance gate: this environment is
  Node v22.14.0, below the repo's `>=22.19.0` engine, and the CLI installer /
  supervisor PTY specs fail for that reason

## Completion Boundary

The topic is complete when Electron can hand a healthy foreign local Runtime
off to the browser without taking ownership, while all non-handoff recovery
states remain explicit and the existing owner survives the full journey.
