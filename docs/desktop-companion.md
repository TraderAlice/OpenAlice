# Desktop companion

The normal desktop and isolated Electron demo start one Alice companion
window from `apps/desktop/src/app-window.ts`. It shares the Electron main
process and adds a renderer — no additional Guardian, Alice, UTA, or remote
connection. Closing the main window hides it on every platform (tray,
companion, and managed processes stay available); the Windows/macOS tray or
the macOS Dock restores it. Only an explicit Quit action starts
managed-process shutdown; quitting destroys the companion and stops
processes. The isolated demo retains exit-on-close so its disposable
fixture backend is cleaned up. Settings' bottom-left Alice menu provides
Show pet / Hide pet in desktop mode (omitted in browsers and when the
companion is unavailable; only the owning window's main frame may use these
IPC commands).

The character and speech bubble live in `ui/public/companion/`. Speech is
decorative — never a claim about Agent execution status. Single click cycles
short lines, double click opens the main window, right click opens the
native menu. Position, size, and visibility are machine-local launcher
preferences in Electron userData `companion.json`.

Settings → Pet (`/settings/pet`) configures click audio (enabled, volume,
local WAV/MP3/OGG import, preview, restore). Imports decode to ≤10s and
≤2 MB; the main process checks MIME, base64, signatures, and bounds, then
atomically saves a copied data URL in userData `companion-sound.json` — no
external URLs or filesystem paths. Only confirmed clicks and keyboard
interaction play sound. The page explains desktop-only availability.

Security/window contract: dedicated narrow preload, sender/frame-checked
IPC, context isolation, no renderer Node APIs, local-only CSP, blocked
navigation/popups; Windows uses a transparent toolbar window; macOS shows
the companion across Spaces without changing the Dock identity. Geometry
uses DIPs and monitor work areas (including negative coordinates); drag/snap
writes include the intended content size so fractional display scaling
cannot enlarge the window. Removing a monitor returns the window to a
remaining work area. `OPENALICE_DISABLE_COMPANION=1` is the launcher kill
switch. Assets are copied by the UI public-assets build into packaged
`Resources/runtime/ui/dist/companion`; package assertions require images,
renderer, attribution, and compiled preload.

## Product activity notifications

Desktop-local notification policy is saved atomically in Electron userData
`activity-notifications.json` (fresh installs: completion/Inbox, failure,
action needed, News on; routine progress off; unknown event families stay
silent until mapped; pause lasts one hour; enablement/surface are
independent of pet visibility). One Electron main-process controller reads
the ProductActivityJournal API every four seconds via integrated child IPC
or the selected relay with the owning session's cookies; the pet has no
backend connection (`connect-src 'none'` unchanged), and main-native polling
also feeds the global activity summary (hidden renderer timers are not the
notification source). At most 500 new facts are read at once, backlog is
baselined, queue storage is bounded to 100, old-project responses are
discarded, and polls never overlap.

Visible non-minimized main windows use top-right notifications; hidden or
minimized windows use an already-visible pet (a hidden pet is never shown
for a notification). Surface transitions clear old announcements without
replaying them. The pet shows one bubble, the main surface up to three;
errors preempt lower-priority items; dismissal changes only display state,
never task completion or Inbox read state. Brief pet messages are the
default (generic state/count; no names, raw text, headlines, or images);
disabling brief mode permits bounded previews. The bridge accepts only an
active display token from the owning window's main frame, revalidates the
source, and opens only Office/Inbox/News destinations — no arbitrary URL,
code, or article deep link.

## Verification

```bash
pnpm -F @traderalice/guardian-runtime build
pnpm electron:tsc
pnpm -F @traderalice/desktop exec electron ../../dist/electron/companion-preview.js --smoke
pnpm test:owner:desktop
pnpm electron:smoke:demo
```

The companion smoke creates a disposable Electron profile without a backend
and checks real preload/PNG decode, alpha, press/release, speech, and
mirroring (renderer captures in its printed temp directory; omit `--smoke`
to keep the preview running). The native Desktop Package Smoke workflow runs
this acceptance on macOS and Windows. Real display composition, cross-monitor
drag, and click-through still need native desktop interaction.
