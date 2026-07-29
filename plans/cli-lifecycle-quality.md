# CLI Lifecycle Quality

Status: Complete

Related PR: #847

Owner guides:

- [[docs/cli-installer.md]]
- [[docs/local-runtime.md]]
- [[docs/development-workflow.md]]

## Scope

Make the computer-level `openalice` CLI share the OpenAlice product version,
notify interactive stable-channel users when a newer release exists, provide a
safe installer-backed update command, and provide a CLI-only uninstall that
preserves every application-state and user-work path.

Workspace-injected CLIs, Electron auto-update, source-checkout updates, and
Workspace template upgrades are out of scope.

## Decisions

- `packages/cli/package.json#version` must equal the root product version.
- Stable installed CLIs check the release download manifest on an interactive
  local start, with a short timeout, a daily cache, and an explicit opt-out.
- Automatic checks only notify. `openalice update` delegates mutation to the
  ordinary installer and preserves its visible plan and consent contract.
- Exact tag/commit installs remain pinned. Development-channel installs do not
  claim stable release update semantics.
- Update downloads the release-owned installer, verifies its manifest SHA-256,
  and then runs the normal transaction against the detected install root.
- Uninstall removes only installer-owned launchers, immutable CLI releases,
  installer locks/cache, and matching managed PATH blocks. It never removes
  application data, Workspaces, sources, credentials, sealing keys, or the
  shared install root.

## Work

- [x] Add installed-layout discovery and release-version comparison.
- [x] Add `openalice update`, explicit update checking, and daily start notice.
- [x] Add `openalice uninstall` with plan, consent, lock safety, and PATH cleanup.
- [x] Align CLI and root versions and enforce the invariant in tests/release.
- [x] Extend the distributed payload, installer acceptance, and owner guide.
- [x] Run required repository, CLI, Docker, and real installer-path checks.
- [x] Publish the completed serial change through PR #847 targeting `dev`.

## Verification

- `bash -n install scripts/install-smoke/run.sh scripts/install-smoke/interactive.sh scripts/install-channel-smoke/run.sh`
- `pnpm -F @traderalice/openalice-cli test`
- `pnpm test:install:docker`
- `npx tsc --noEmit`
- `pnpm test`
- installed `openalice update --check`
- isolated installed `openalice uninstall --plan` and `openalice uninstall --yes`

## Completion

The installed CLI reports the product version, stable users receive a bounded
non-blocking update notice, confirmed updates reuse the ordinary atomic
installer, confirmed uninstall removes only installer-owned files, and all
documented verification passes.
