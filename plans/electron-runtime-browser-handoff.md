# Electron Runtime Browser Handoff

Status: Planned

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

## Work

- [ ] Move the normalized local discovery client below CLI presentation code
  so Electron and the Shell Supervisor consume one sanitizer and compatibility
  policy.
- [ ] Enrich the existing-owner startup decision with owner surface, lifecycle
  state, component health, and verified Web endpoint.
- [ ] Replace the generic conflict dialog for healthy dev/CLI owners with
  **Open in browser**, **Choose another data location**, and an explicit
  takeover path.
- [ ] Preserve current stale-owner, failed-recovery, selection-lock, and
  packaged-data-relocation behavior.
- [ ] Add deterministic decision-table tests for every owner/state/endpoint
  combination.
- [ ] Add a real isolated journey: start dev and CLI Server owners separately,
  launch Electron on the same home, open the advertised page, and prove the
  original owner PID and lock survive unchanged.

## Verification

- `pnpm -F @traderalice/guardian-runtime test`
- `pnpm -F @traderalice/desktop typecheck`
- `pnpm test:guardian-recovery`
- `pnpm electron:smoke:guardian-recovery`
- A real browser probe of the advertised loopback endpoint for both dev and
  CLI Server owners, using disposable complete homes only.

## Completion Boundary

The topic is complete when Electron can hand a healthy foreign local Runtime
off to the browser without taking ownership, while all non-handoff recovery
states remain explicit and the existing owner survives the full journey.
