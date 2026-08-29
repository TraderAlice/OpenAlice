# Office HUD assets

These generated RGBA PNGs are the game-art layer for the Office map controls.
Live labels, button behavior, focus rings, and accessible names remain DOM-owned.

- `move-pad-v2.png` — four-way movement tutorial icon
- `action-button-v1.png` — right-thumb nearby action control
- `reset-compass-v2.png` — map recenter control
- `menu-terminal-v2.png` — pause-menu trigger and title icon
- `group-grid-v2.png` — all-Workspace-groups floor mode
- `occupancy-log-v2.png` — occupancy-log command
- `signal-receiver-v2.png` — live-floor and quiet-floor signal state
- `roster-badge-v2.png` — Team roster window identity
- `window-close-v2.png` — shared Office window close latch
- `session-portal-v2.png` — open the selected Agent session
- `drawer-record-v2.png` — open a provenance record from an Agent desk
- `talk-bubble-v2.png` — nearby conversation action in the compact world prompt
- `window-back-v2.png` — return from an Agent file to its originating team roster

All assets use `docs/assets/office/style-master-v1.png` as their visual reference.
The command glyphs are separate transparent images so their silhouettes remain
legible at UI size and their accessible labels stay DOM-owned. The generated
masters are packaged onto native RGBA canvases with nearest-neighbor sampling and
hard alpha. Command icons use 48x48 canvases; the primary touch action uses 72x72
for its larger hit target. Full-resolution generated sources are not shipped.
