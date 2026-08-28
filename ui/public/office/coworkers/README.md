# Office generated coworkers

These runtime-specific coworker sprites make Alice the unique player character
instead of reusing her `alice-maid` atlas for every employee.

The four `*-v1.webp` files were generated with the built-in image generator,
using `docs/assets/office/style-master-v1.png` as the environment palette
reference and `ui/public/office/packs/alice-maid/spritesheet.webp` only as the
pixel-density and character-proportion reference.

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
