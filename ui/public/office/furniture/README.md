# Office generated furniture

These versioned PNG files are the generated environment pack for the Office
overworld. Alice uses the purpose-built `alice-overworld-v1.png` four-direction
sheet, while runtime coworkers use their own portrait and seated families.

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

- `workstation-v2.png`
- `vacant-workstation-v2.png` — powered-down empty-chair variant for unoccupied Session slots
- `filing-cabinet-v2.png`
- `empty-cabinet-v1.png` — open, visibly empty drawer vignette for a Workspace with no filed records
- `terminal-kiosk-v2.png`
- `plant-v2.png`
- `wall-window-v2.png`
- `wall-window-night-v2.png` — geometry-matched after-hours window variant
- `floor-tile-v2.png`
- `workspace-rug-v2.png`
- `coffee-station-v2.png` — Chat neighborhood social prop

`wall-window-night-v2.png` was produced as a geometry-locked lighting edit of
the daytime window module, followed by a background-extraction pass to restore
real alpha. `OfficeBuilding` selects the day or night module from the effective
theme preference, including system-resolved Auto mode.
- `server-rack-v2.png` — AutoQuant neighborhood operations prop
- `personnel-board-v2.png` — interactive roster prop for groups with more than four Sessions
- `operations-board-v2.png` — floor landmark that opens the live occupancy log and replay
- `workspace-sign-v2.png` — blank physical placard behind live Workspace, Harness, and agent text
- `spawn-compass-v2.png` — flush four-direction Operations medallion beneath Alice's neutral reset point
- `route-chevron-v1.png` — generated 24px floor inlay for the remaining click-to-interact path
- `collision-impact-v1.png` — generated four-frame blocked-movement sparkle at native 24px cells
- `mail-service-v1.png` — water cooler and mail-sorting landmark for the open service edge
- `archive-service-v1.png` — copier and archive-trolley landmark for the open service edge

The v2 environment pack converts the original generated masters into their actual runtime canvases with
nearest-neighbor sampling, hard alpha, and compact 48- or 64-color palettes. Fifteen formerly 1K-scale sources
totaling 12.49 MiB become a 106.5 KiB native pack while preserving their existing contain/fill composition.

`operations-board-v2.png` was generated from the locked style master as a freestanding, width-dominant
mission console with an abstract teal status display and no baked words. The built-in image generator
rendered it on a flat magenta key; the repository copy uses locally extracted transparent alpha.

`workspace-sign-v2.png` was generated from the same style master as a wide walnut-and-teal physical
placard with no baked text. Runtime HTML supplies the localized Harness label, Workspace title, and
agent count over its quiet center panel, preserving dynamic data and accessible text without reverting
to a dashboard card.

`vacant-workstation-v2.png` preserves the workstation footprint while removing the cyan screen and tower
glow. It was generated on a flat magenta key, processed with the ImageGen chroma-key helper, and packaged
with real alpha. Empty slots remain disabled scenery, but no longer disappear into the rug as if their
assets failed to load.

`route-chevron-v1.png` is a compact diamond double-chevron generated on a flat magenta key, alpha-extracted,
hard-matted, and nearest-neighbor packaged at the native 24px navigation grid. Runtime rotation supplies four
directions; markers are decorative world feedback and never replace the named route status.

`collision-impact-v1.png` is a 96x24 transparent atlas with contact, star, arc, and fragment frames. Runtime
rotation supplies four collision directions. Reduced-motion mode holds the bright second frame for the same short
lifetime instead of animating the sheet; the effect is decorative and does not compete with interaction prompts.

`mail-service-v1.png` and `archive-service-v1.png` were generated together from the locked style master, extracted
from a chroma-key sheet, baseline-aligned, nearest-neighbor reduced to 120x104, and quantized against one 64-color
palette. They appear only when the map has one Workspace row, turning its otherwise empty lower margin into two
recognizable service landmarks without crowding denser floors.

`empty-cabinet-v1.png` was generated from the locked style master and the shipped cabinet identity as a single
cream two-drawer cabinet with its upper drawer pulled open and visibly empty. The transparent master was trimmed,
hard-matted, and nearest-neighbor packaged on a native 96x88 canvas for the compact cabinet empty state; it contains
no paper, folders, labels, characters, or UI frame.
