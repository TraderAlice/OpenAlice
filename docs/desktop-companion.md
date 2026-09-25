# Desktop companion

The normal desktop and isolated Electron demo start one Alice companion window
from `apps/desktop/src/app-window.ts`. It shares the Electron main process and
adds a renderer, with no additional Guardian, Alice, UTA or remote connection.
Closing the main window hides it while the app tray and companion stay available;
the tray can restore the main window or quit the app. Minimizing the main window
also leaves the companion available. Quitting destroys the companion and stops
the managed processes.
The bottom-left Alice’s Settings menu also provides Show pet / Hide pet in
desktop mode. Its local preload bridge reads the saved preference, toggles the
same native controller as the tray, and subscribes to visibility changes. The
entry is omitted in browsers and when the companion is unavailable; only the
owning app window's main frame can use these IPC commands.

The first version uses a maintainer-supplied character and a generated speech bubble in
`ui/public/companion/`. Its local speech is decorative, never a claim about an
Agent's execution status. Single click cycles through short lines, double click
opens the main window, and right click opens the native menu. The tray remains
available after hiding Alice. Position, size and visibility are machine-local
launcher preferences in Electron userData `companion.json`.

Click dialogue currently cycles through eight English placeholders, all spoken
by Alice in Carroll's original *Alice's Adventures in Wonderland*. The source
and chapter order are recorded with the list in `pet.js`. Dialogue editing is
not implemented yet; these lines are not agent status.

Settings → Pet (`/settings/pet`) configures click audio: enabled, volume, local
WAV/MP3/OGG import, preview and restore defaults. The built-in default is the
originally synthesized `click.wav` soft double squeak. Imports must decode to at most 10 seconds and
be at most 2 MB. The main process separately checks MIME, base64, file signatures
and bounds, then atomically saves a copied data URL in userData
`companion-sound.json`. No external URL or arbitrary filesystem path is accepted.
Changes reach the pet immediately over checked IPC. Only confirmed clicks and
keyboard interaction play sound; dragging/cancellation does not. Preview ignores
the click mute toggle. Reset clears the copied audio and restores 50% volume.
The page explains desktop-only availability in browser mode.

Interaction follows MeteorNOX's Whale Widget (MIT attribution ships in
`ui/public/companion/NOTICE.md`): bottom-anchored 0.88Y/1.05X press transform,
220ms `cubic-bezier(.34,1.56,.64,1)`, 3-DIP drag threshold, 300ms mirror,
160ms CSS-ease snapping, 10% side and 15% bottom snap zones, no top snap.
The replacement speech bubble has a connected lower-right tail, rather than
the original thought dots. It scales/fades in as one image over 200ms from its
tail; text follows at 120ms. This visual revision is distinct from the upstream
staggered thought-dot animation.
The bubble sits 80% of the character stage width to the left, with its top at
26% of stage height minus 55 DIPs. It forms an above-left composition with clear
space around the bow, rather than sitting directly beside the face.
Symmetric transparent window gutters preserve the artwork size
and prevent clipping; mirroring puts the bubble on the opposite side. Alpha
hit testing still targets only the character, not the additional empty space.
System reduced-motion disables the transitions. Transparent pixels pass input
through to the desktop. Keyboard Space/Enter speaks; Escape dismisses speech;
Shift+F10 opens the menu.

The native window uses a dedicated narrow preload, sender/frame-checked IPC,
context isolation, no renderer Node APIs, a local-only CSP, and blocked
navigation/popups. Windows uses a transparent toolbar window; macOS makes the
companion visible across Spaces without transforming the app's Dock identity.
Geometry uses Electron DIPs and monitor work areas, including negative monitor
coordinates. Drag and snap writes include the intended content size on Windows
so fractional display scaling cannot enlarge the window during repeated moves.
Removing a monitor or changing display metrics brings the window back into a
remaining work area. `OPENALICE_DISABLE_COMPANION=1` is a launcher kill switch.

Assets are copied by the existing UI public-assets build into the packaged
`Resources/runtime/ui/dist/companion` directory. Package assertions require
the images, renderer, attribution and compiled preload.

## Verification

```bash
pnpm -F @traderalice/guardian-runtime build
pnpm electron:tsc
pnpm -F @traderalice/desktop exec electron ../../dist/electron/companion-preview.js --smoke
pnpm test:owner:desktop
pnpm electron:smoke:demo
```

The companion smoke creates a disposable Electron profile without a backend.
It checks real preload/PNG decode, alpha, press/release, speech and mirroring,
and saves native renderer captures in its printed temporary directory. Omitting
`--smoke` leaves the preview running. The native Desktop Package Smoke workflow
runs this acceptance on macOS and Windows; package/workspace acceptance remains
separate. Real display composition, cross-monitor drag and click-through still
need native desktop interaction in addition to renderer captures.
