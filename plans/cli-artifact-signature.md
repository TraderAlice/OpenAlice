# CLI artifact signatures

Status: implementation and native CI acceptance pending. Related: #1670.
Owner guides: [[docs/cli-installer.md]], [[docs/broker-packs.md]],
[[docs/development-workflow.md]]. Delivery: Draft PR to dev; no merge/release.

The approved scope pins Bun 1.4.2, centralizes exact compiler checks, signs only
build-owned macOS CLI/probe/fixture outputs using system ad-hoc codesign, and
checks actual final archive bytes before all channel publication. Electron,
Developer ID, TCC, updater behavior, and existing published releases are outside
this change. The static checker targets thin arm64/x64 SHA-256 Mach-O only.

- [x] Centralize compiler pin and Docker/manual verification.
- [x] Stage native signing before file hashes and preserve runtime metadata.
- [x] Share final archive/file/identity/signature checks across channels.
- [x] Add negative integrity and toolchain/signing retry tests.
- [x] Build and accept the Linux CLI with Bun 1.4.2.
- [ ] Complete local full suite, typechecks and installer surface gates.
- [ ] Record native CI results and immutable head-bound candidate artifacts.
- [ ] Maintainer Mac acceptance before merging or publishing.

Linux build acceptance includes isolated install, same-version identity upgrade,
no Node/Bun on PATH, multiprocess startup, two independent PTYs, resize/input/stop,
UI serving and resource checks. System codesign and macOS kernel execution have
not run locally. The focused read-only artifact workflow preserves candidates
for both Mac architectures and rechecks their bytes on Linux.

Local evidence: focused surface suite 97 passed / 1 skipped (before the final
entitlement-loss case), root and UI typechecks passed. Initial full suite:
7365 passed, 45 failed, 5 skipped plus one native-PTY collection failure.
Missing dugite was restored from its checksum-verified upstream archive; npm
cache and umask failures pass on focused rerun. Remaining full-suite verification
is tracked separately: native node-pty build is blocked by Node header HTTP 403,
and three process-cleanup cases failed in this environment. Docker installer
acceptance is blocked by Docker Hub HTTP 403. No unrelated test fixes are made.
