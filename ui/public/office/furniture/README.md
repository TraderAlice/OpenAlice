# Office generated furniture

These `*-v1.png` files are the first generated environment pack for the Office
overworld. Alice and employee characters continue to use the independent
`alice-maid` Codex pet v2 pack.

Art direction:

- polished 16-bit-era pixel art;
- consistent top-down three-quarter projection;
- 16 px base-tile proportions with 1x1 to 4x3-tile props;
- upper-left lighting;
- warm walnut, parchment cream, muted olive, charcoal outlines, and teal screens;
- genuine transparent alpha and tight object shadows;
- no text, logos, characters, UI panels, or baked backgrounds.

The visual style master is stored at
`docs/assets/office/style-master-v1.png`; it is a generation reference, not a
runtime asset. Generate each new prop as a standalone transparent image using
that master as the style reference, verify its alpha channel, and add it to
`ui/src/office/furniture.ts` before use.

Environment textures may be opaque when they intentionally fill the entire
canvas. Repeating floor textures must stay orthographic and quiet; wall modules
must tile horizontally; Workspace rugs define a functional neighborhood but
must not recreate card or room boundaries.

Current runtime assets:

- `workstation-v1.png`
- `filing-cabinet-v1.png`
- `terminal-kiosk-v1.png`
- `plant-v1.png`
- `wall-window-v1.png`
- `wall-window-night-v1.png` — geometry-matched after-hours window variant
- `floor-tile-v1.png`
- `workspace-rug-v1.png`
- `coffee-station-v1.png` — Chat neighborhood social prop

`wall-window-night-v1.png` was produced as a geometry-locked lighting edit of
the daytime window module, followed by a background-extraction pass to restore
real alpha. `OfficeBuilding` selects the day or night module from the effective
theme preference, including system-resolved Auto mode.
- `server-rack-v1.png` — AutoQuant neighborhood operations prop
- `personnel-board-v1.png` — interactive roster prop for groups with more than four Sessions
- `operations-board-v1.png` — floor landmark that opens the live occupancy log and replay
- `workspace-sign-v1.png` — blank physical placard behind live Workspace, Harness, and agent text

`operations-board-v1.png` was generated from the locked style master as a freestanding, width-dominant
mission console with an abstract teal status display and no baked words. The built-in image generator
rendered it on a flat magenta key; the repository copy uses locally extracted transparent alpha.

`workspace-sign-v1.png` was generated from the same style master as a wide walnut-and-teal physical
placard with no baked text. Runtime HTML supplies the localized Harness label, Workspace title, and
agent count over its quiet center panel, preserving dynamic data and accessible text without reverting
to a dashboard card.
