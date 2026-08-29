# Office generated coworkers

These runtime-specific coworker sprites make Alice the unique player character
instead of reusing her overworld sheet for every employee.

The four `*-v1.webp` files were generated with the built-in image generator,
using `docs/assets/office/style-master-v1.png` as the environment palette
reference and Alice's canonical maid art only as the pixel-density and
character-proportion reference.

Prompt set:

- Codex: navy field engineer with amber scarf and tool pouch.
- Claude: rust-red research archivist with cream clothes and notebook satchel.
- Pi: teal technical explorer with cream cap, goggles, and field pouch.
- OpenCode: olive-and-plum workshop hacker with a compact headset.

Every prompt requested one centered late-GBA 16-bit human NPC, full body,
slightly top-down and facing down-screen, with no text, logos, UI, furniture, or
background. The initial generated checkerboard was baked into RGB, so each
character went through a background-extraction edit that preserved the subject
and produced genuine alpha. The final PNG outputs were losslessly packaged as
WebP and alpha-checked before integration.

Known runtimes map to the closest authored archetype. Unknown future runtime
names receive a stable hash-selected archetype; they never fall back to Alice.

The four `*-desk-v1.png` files are a separate generated map-scale pose family.
Each employee is seated, seen from a top-down three-quarter rear view, and faces
the workstation monitor instead of standing front-facing inside the chair. The
Codex pose established the locked camera and silhouette; Claude, Pi, and
OpenCode preserve that framing while carrying their portrait hair, headgear,
outerwear, and accent colors. Checkerboard outputs went through background
extraction before the transparent sources were cropped and packaged for the
runtime. Portrait sprites remain the identity view in roster and Agent windows.

`waiting-emote-v1.png` and `failed-emote-v1.png` are exceptional-state map
signals. The waiting desk gets a quiet three-dot parchment bubble; a failed desk
gets a jagged warning bubble. Normal work stays unlabelled, and an actual tool
bubble replaces the emote when Alice approaches so the map never stacks two
messages over one worker. Both icons were generated on a flat magenta key,
processed with the ImageGen chroma-key helper, alpha-checked, and packaged at
map scale.
