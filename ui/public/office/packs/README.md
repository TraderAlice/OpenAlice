# Office player-character pack

`alice-overworld-v1.png` is the runtime Alice sheet for the Office map. It is a
native 48x48-cell, 3-column by 4-row RGBA atlas:

- row 0: down, left-step / neutral / right-step;
- row 1: left, left-step / neutral / right-step;
- row 2: right, left-step / neutral / right-step;
- row 3: up, left-step / neutral / right-step.

The built-in image generator used the canonical Alice maid atlas and generated
rear view as identity references, then produced a unified late-GBA overworld
sheet with genuine alpha. Packaging removed disconnected generation artifacts,
normalized every sprite to a common baseline, nearest-neighbor reduced each
cell to 48x48, and quantized the final sheet to a shared 64-color palette.

Office no longer ships or loads the full Codex pet atlas. The player, map
collision, and four-direction animation now have their own purpose-built asset;
the desktop pet remains a separate product surface.
