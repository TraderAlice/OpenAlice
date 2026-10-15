# Alice desktop companion

Status: implementation complete; native and packaged acceptance in progress.
Related issues: none. User requested a native macOS/Windows companion using
their two PNGs and the Whale Widget interaction model.

Current increment: Settings → Pet audio preferences, with an original bundled
soft-double click sound. Local copied imports, mute/volume,
preview/reset, persistence and confirmed-click playback are in scope. Validate
the real settings route and native audio playback, plus invalid-file rejection.

Audio acceptance: real `app://openalice/settings/pet` import/preview/playback,
mute and reset pass with a generated temporary silent WAV (not bundled).
Browser route correctly explains the desktop-only boundary. Store reload tests
prove copied-file persistence; targeted store/hook/page tests pass. Root, UI and
desktop typechecks and unsigned macOS packaged Workspace acceptance pass.
Windows native audio remains unverified locally. No third-party audio was added.

Owners: docs/desktop-companion.md, docs/managed-workspace-runtime.md,
docs/testing.md, docs/development-workflow.md.

Decisions: one companion renderer owned by the existing Electron process;
start with the main window, remain visible on minimize, destroy on owner close.
Use upstream press/release/mirror/bubble timings and default snap zones. Native
menus and tray own visibility/size; static PNGs retain user artwork. Decorative
speech is not runtime status. Keep local-only IPC and packaged resource checks.

- [x] Character/bubble assets, MIT attribution, press and bubble animation.
- [x] Native window lifecycle, click-through, drag/snap, tray, size/persistence.
- [x] Geometry tests and isolated real-Electron interaction smoke.
- [x] macOS demo startup and main UI regression smoke.
- [x] Full hermetic suite: 808 files, 7103 passing tests, 4 skipped; desktop/root/UI typechecks.
- [x] Unsigned packaged Workspace acceptance with companion resources.
- [ ] Windows native interaction smoke in Desktop Package Smoke workflow.
- [ ] Review final diff, integrate through dev PR, leave reviewable preview.

Maintainer visual iteration: shifted bubble left 22% of stage width, retaining
its original height to avoid bow overlap. Added symmetric native gutters without
changing portrait/bubble size or animation. Native smoke verifies all three
sizes in both directions, alongside press/release. Desktop 75 tests and desktop/UI
typechecks pass. Keep the feature branch open for visual acceptance.

Follow-up: maintainer requested regenerating the awkward thought bubble. Added
generated bubble-speech.png with a connected lower-right tail; preserved the
original PNG. Replaced dot layers with a single 200ms pop and re-centered text.
Generation prompt and provenance are saved alongside the asset. Native smoke
also checks transparent exterior and opaque interior of the generated bubble.

Position correction after maintainer screenshot: move speech to the side of
the character (left 80% stage width, top 26% stage height minus 55 DIPs after
the maintainer requested a substantial upward adjustment), keeping the image size.
Expand transparent gutters for both mirrored directions. Native smoke checks
all sizes/directions and captures a light background to inspect the black tail.

Completion: all available automated gates pass; actual evidence and any remaining
physical multi-monitor/manual Windows limitations are reported explicitly.

Recovery entry: Alice’s Settings now includes a desktop-only Show pet /
Hide pet row backed by owner-frame-validated preload IPC. Tray visibility
changes synchronize with the menu; browser/disabled companions omit the row.
Native demo smoke and manual native menu clicks verified hide/show recovery.
English, Simplified/Traditional Chinese and Japanese labels are included.
