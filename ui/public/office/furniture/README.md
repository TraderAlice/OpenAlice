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

Current runtime assets:

- `workstation-v1.png`
- `filing-cabinet-v1.png`
- `terminal-kiosk-v1.png`
- `plant-v1.png`
