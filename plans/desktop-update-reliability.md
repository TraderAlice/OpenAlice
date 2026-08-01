# Desktop Update Reliability

Status: Complete

Related issues: none

Owner guides:

- [[../docs/managed-workspace-runtime.md]]
- [[../docs/development-workflow.md]]

## Scope

Make a packaged OpenAlice update visibly distinguishable from an application
crash, keep enough machine-local evidence to diagnose a failed installer
handoff, and show a native error when Alice cannot start before the renderer is
available.

This plan does not change release signing, update-feed publication, user data
migrations, or broker behavior.

## Decisions

- Download progress is determinate; shutdown and native-installer handoff are
  named stages with indeterminate progress because Squirrel does not expose a
  trustworthy install percentage to the old app.
- The renderer receives the installing stage before managed children stop, and
  the desktop emits a native notification before it hands control to the
  platform installer.
- The desktop records an update-attempt marker under Electron's machine-local
  `userData` directory. A later launch resolves success by version or warns
  that the previous handoff did not complete.
- Alice startup stderr is tee'd to the existing terminal and a bounded
  machine-local diagnostic log. An early child exit is reported with a native
  error dialog and the log path.
- Update shutdown releases the Guardian runtime lock before invoking the native
  installer.

## Work

- [x] Reproduce the installed N-1 to N update handoff and identify its silent
  interval.
- [x] Add installing stages, determinate download progress, and native handoff
  feedback.
- [x] Add update-attempt persistence and failed-handoff recovery messaging.
- [x] Capture bounded Alice startup diagnostics and surface early exits.
- [x] Extend updater, renderer, and persistence regression tests.
- [x] Update the desktop runtime owner guide.
- [x] Run TypeScript, unit, UI, and isolated packaged Electron verification.

## Verification

- `npx tsc --noEmit`
- `pnpm test`
- `pnpm -F @traderalice/desktop typecheck`
- `cd ui && npx tsc -b`
- targeted desktop updater and UI tests
- `CSC_IDENTITY_AUTO_DISCOVERY=false pnpm electron:smoke:workspace`

The signed/notarized Squirrel handoff remains a release-candidate gate; local
verification uses the repository's unsigned isolated package smoke.

## Completion

The plan is complete when an update visibly reports download, shutdown, and
installer handoff; a failed handoff is detected on the next launch; an Alice
startup failure opens a native diagnostic instead of silently quitting; and
the required local verification is complete.
