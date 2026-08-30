# Explicit Release Channels and 0.90.2

Status: Active

Related owner guides:

- [[docs/development-workflow.md]]
- [[docs/cli-installer.md]]
- [[docs/cli-package-managers.md]]
- [[docs/managed-workspace-runtime.md]]

## Goal

Separate source integration from product publication, then prove the new
contract by releasing the same accepted 0.90.2 line first as beta and later as
stable. Existing Bun/native CLI work already present in `dev` remains part of
the candidate, but this plan does not introduce another Bun architecture or
packaging redesign.

## Scope

- one manual `Release` workflow for new releases and mirror repair;
- explicit `beta` and `stable` release intent;
- tag, root package, and CLI package version agreement;
- GitHub prerelease state, Electron updater feeds, CLI installer manifests,
  CDN aliases, and package-manager publication derived from the same channel;
- one channel-neutral CLI installer plus stable/beta/dev selection in the CLI
  and Supervisor TUI;
- full candidate acceptance before either tag or GitHub Release exists;
- a beta-first, stable-second 0.90.2 release sequence.

Out of scope:

- another Bun process-layout or artifact-layout change;
- Agent Runtime installation or version management;
- independent UTA/Broker Pack product versioning;
- npm/Homebrew/AUR beta channels;
- Windows VM replacement for the release runner.

UTA and Broker Packs continue to ship with the OpenAlice product version for
this release line.

## Decisions

### Source and publication are separate

`dev` remains the integration and per-commit preview lane. `master` is the
human-promoted release source, but merging to `master` does not publish. A
maintainer manually dispatches the workflow from the exact `master` commit and
supplies both a channel and tag.

### Channel and version are one contract

- `stable` accepts only `vX.Y.Z`.
- `beta` accepts `vX.Y.Z-beta` or `vX.Y.Z-beta.N`.
- root `package.json` and `packages/cli/package.json` must both equal the tag
  without the leading `v`.
- the accepted commit SHA becomes the tag target only after every required
  candidate and upgrade gate succeeds.

The workflow must reject a mismatched channel/tag, a mismatched package
version, an existing new-release tag, or a release dispatched from a branch
other than `master` before expensive builds begin.

### One installer selects isolated channels

`https://openalice.ai/install` is the canonical human-facing Bash entry. Every
public installer URL serves one implementation, which defaults to stable and
accepts `--channel stable|beta|dev`. `--version` alone
remains an exact pin; an updater combines `--channel` and `--version` to bind an
accepted release without losing its channel. Release-owned
`OpenAlice-<version>-install` files and dev `releases/<commit>/install` files
are immutable byte snapshots of that same source, used for SHA-256 verification.
Versioned release snapshots are frozen and accepted before the tag/Release is
created; mirror jobs consume those bytes and cannot clobber them. They are not
channel-specific implementations.

The Supervisor's `u` action chooses stable, beta, or dev before probing. The
choice is session-local until a confirmed install succeeds; installer
provenance then makes that channel the next launch's default. Stable/beta use
SemVer, while dev compares the complete target archive SHA-256 from its
per-commit manifest.

### Immutable assets are shared; mutable product aliases are isolated

Both channels publish versioned GitHub and R2 assets. Mutable surfaces are
channel-owned:

| Surface | Beta | Stable |
|---|---|---|
| GitHub Release | prerelease | full release |
| Desktop updater | `beta*.yml` | `latest*.yml` |
| CLI manifest | `beta/manifest.json` | `manifest.json` |
| CLI installer | shared `install`; `--channel beta` | shared `install`; default channel |
| Desktop download aliases | no stable aliases | `mac-*.dmg`, ZIPs, Windows EXE |
| Package managers | candidate npm/Bun mechanics only; no beta metadata | publish npm/Bun, Homebrew, and AUR after public-byte verification |

A beta mirror repair cannot overwrite the stable manifest, desktop feeds, or
desktop download aliases. Mirror repair is restricted to the release already
active on that channel and never rewrites the shared channel-neutral installer;
only a newly accepted release may change that bootstrap. A stable mirror repair
cannot be used to mirror a beta tag. This repair contract begins with releases
created by the channel-aware workflow, which attach both the immutable installer
and checksum sidecar; it does not retrofit older GitHub Releases.

### Verification is local first, publication remains gated

Workflow structure, mirror generation, installer provenance, and channel
selection are unit-tested locally. macOS native packaging and OrbStack Linux
acceptance run before integration where practical. Windows and credentialed
signing/notarization/publication stay in the versioned release gate.

The `dev` push lane performs only the four native builds, archive/manifest
validation, publication, and a live channel install. npm/Bun, Linuxbrew, AUR,
and historical cutover acceptance do not block per-commit preview publication;
those broader gates run on PR or explicit beta/stable release lanes as
appropriate.

## Material Discoveries

- The earlier manual-dispatch change correctly removed master-push publication,
  but beta mirroring still overwrote every stable CDN alias. Channel isolation
  therefore belongs in asset generation and upload/verification, not only in
  the GitHub prerelease flag.
- A stable CLI self-update downloaded the versioned installer and then passed
  `--version`, which reclassified the updated installation as pinned. The
  updater now passes `--channel <stable|beta> --version <accepted>` to the
  shared installer; dev passes `--channel dev` and binds the expected archive
  identity.
- The dev manifest already had the correct update identity: its target archive
  SHA-256. Its package version can remain unchanged across commits. Native
  `contentIdentity` now also covers the complete payload manifest rather than
  only the executable, so resource-only builds activate distinct releases.
- The first dev cutover can legitimately replace the expanded v0.90.1 layout
  with a native v0.90.1 build. The historical stable updater sees no SemVer
  increase, so dev publication replays that cutover directly from the pinned
  v0.90.1 installer into the accepted dev archive and proves its archive SHA,
  content identity, data preservation, Runtime boot, and uninstall. Stable
  keeps exercising the historical updater once the candidate version advances.
- The latest stable v0.90.1 predates native CLI archives. During the beta-first
  transition, the shared installer keeps its stable default usable by verifying
  and delegating the immutable published v0.90.1 installer for fresh or legacy
  roots. Exact v0.90.1 selection uses the same bridge. A native beta/dev root
  must not be replaced by that Node-managed layout: update checks and the
  installer refuse the reverse switch until stable has a native release.
- Legacy-to-native cutover is one transaction. The installer backs up the old
  launchers before changing `cli/current`, restores both pointer and launchers
  on failed validation, and safely quotes PATH entries even when the install
  root contains spaces or quotes.
- Dev/package-channel publication must not trust a well-shaped but stale
  `contentIdentity`. The archive validator recomputes the canonical identity
  from the complete release manifest before emitting channel metadata. The
  historical v0.90.1 acceptance smoke likewise verifies the exact pinned
  installer SHA-256 before executing it.
- Stable N-1 acceptance and release notes must select the previous stable tag,
  not the latest tag of any kind; otherwise a beta immediately before stable
  would reduce the only stable upgrade proof to beta-to-stable.
- The Windows failure observed on the earlier workflow PR predates the release
  change: three real `npm pack` subprocesses exceeded Vitest's default five
  seconds. That integration test now has an explicit 30-second timeout; the
  release workflow tests themselves were green.
- The npm/Bun candidate smoke originally synthesized only a prior stable
  version, so the first beta would fail before publication. Its fixture now
  preserves a beta suffix while deriving an equal-length earlier core version,
  allowing the same stopped/active upgrade proof without publishing beta
  package-manager metadata.
- The inherited dev workflow still made every preview wait for npm/Bun,
  Linuxbrew, AUR, and v0.90.1 cutover acceptance. The preview lane now publishes
  immediately after its four native packaging jobs; full release checks remain
  on beta/stable, while PR and local lanes provide earlier feedback without
  becoming a publication dependency.

## Work Plan

### 1. Establish the release branch

- [x] Create `codex/release-flow-0.90.2` in an isolated worktree.
- [x] Audit the divergence between `master`, `dev`, and the earlier usability
  branch.
- [x] Merge current `origin/dev` while retaining the historical release merge
  commits and `v0.90.1` ancestry.
- [x] Reuse the earlier manual-dispatch release change without carrying its Bun
  plan progress into this branch.

### 2. Encode beta/stable intent

- [x] Add an explicit channel input and validate its tag grammar.
- [x] Derive GitHub prerelease state from the validated channel.
- [x] Keep tag creation after the complete candidate fan-in and bind it to the
  dispatch SHA.
- [x] Freeze and attach the immutable installer snapshot before creating the
  tag/Release.
- [x] Keep existing-tag mirror repair separate from release creation, bound to
  the active channel release, and unable to clobber installer bytes.

### 3. Isolate public aliases and expose CLI channels

- [x] Generate channel-specific CLI manifests from one shared installer.
- [x] Add `install --channel stable|beta|dev` while retaining standalone
  `--version` as a pin.
- [x] Let CLI update checks probe stable, beta, or dev and preserve the chosen
  channel during a confirmed direct install.
- [x] Add a stable/beta/dev picker to the Supervisor TUI without storing an
  AliceProject setting or bypassing package-manager ownership.
- [x] Upload only beta Electron feeds during beta publication.
- [x] Update the shared installer for either release channel while keeping the
  stable manifest and desktop aliases stable-only.
- [x] Keep npm/Bun registry, Homebrew Tap, and AUR activation stable-only.
- [x] Verify immutable release bytes for both channels and mutable aliases only
  for the owning channel.

### 4. Validate and integrate

- [x] Add workflow and mirror-asset regression tests.
- [x] Run targeted tests, `npx tsc --noEmit`, and `pnpm test`.
- [x] Run the relevant local installer/package smokes and unsigned macOS
  package smoke; use OrbStack for Linux acceptance.
- [x] Finish and locally verify the coherent feature branch after classifying
  or repairing every known release-channel blocker.
- [x] Merge the serial PR to `dev` and verify the post-merge dev-channel
  publication plus live installer path (PR #1257; `CLI Installer Smoke`
  run `33311979583`).
- [ ] Promote the accepted `dev` source to `master` under the full promotion
  gate.

### 5. Prove 0.90.2

- [ ] Set both product package versions to `0.90.2-beta.1` on the release
  source and dispatch `beta` + `v0.90.2-beta.1`.
- [ ] Verify the GitHub prerelease, expected assets, beta updater feeds,
  beta CLI manifest, shared installer, and unchanged stable product aliases.
- [ ] Record any beta fix on `dev`, promote it normally, and repeat beta only if
  the accepted source changes materially.
- [ ] Set both product package versions to `0.90.2`, dispatch `stable` +
  `v0.90.2`, and verify GitHub, updater, CDN, installer, Broker Pack, and opted-in
  package-manager publication evidence.

## Completion Criteria

This plan completes only when the release workflow is merged, a 0.90.2 beta
has been accepted without changing stable aliases, and `v0.90.2` has been
published and externally verified. The active Bun distribution plan then
continues from that known public baseline rather than being folded into this
release plan.
