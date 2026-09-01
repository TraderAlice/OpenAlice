# Office generated coworkers

These runtime-specific coworker sprites make Alice the unique player character
instead of reusing her overworld sheet for every employee.

The original four full-resolution portrait masters were generated with the built-in image generator,
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
and produced genuine alpha. The shipped `*-portrait-v2.png` files trim those
transparent sources, fit each full silhouette into a native 72x104 canvas with
nearest-neighbor sampling, and hard-mat alpha for crisp GBA-scale cards. The
generated full-resolution masters are intentionally not shipped at runtime.

The roster now contains thirty curated identities. Six additional feminine coworkers were generated as transparent
three-pose sheets: two Codex variants (field mechanic and cyber scout), a Claude botanical archivist, a Pi field
mathematician, and two OpenCode variants (workshop hacker and systems analyst). Each sheet keeps one identity across a
standing portrait, seated idle pose, and seated typing pose. `scripts/package-office-coworker-sheet.py` splits those
sheets and packages hard-alpha 72x104 portraits plus 176x176 seated canvases. Packaging applies the hard-alpha matte
before measuring each pose, so faint generated fringe cannot shrink the visible character. Existing idle/work pairs
can be repacked with `scripts/normalize-office-coworker-pair.py`; both frames share one scale, fit a 164x164 visual
area, and keep the same bottom-center anchor. This keeps every seated NPC legible at map scale without resizing Alice,
desks, or collision geometry.

Known runtimes map to a small family pool, and `agent + resumeId` selects one identity deterministically so a Session
never changes appearance after refresh. The original four coworkers remain veteran variants; the six newcomers make
the default population feminine-led without deleting the original cast. Unknown future runtime names receive a stable
hash-selected family; they never fall back to Alice.

Grok Build owns a separate feminine runtime family instead of borrowing the
Codex pool: a night-sky systems oracle, copper signal engineer, violet inference
analyst, teal star-network researcher, ivory lattice architect, silver-blue
navigator, rose-gold synthesist, and emerald-black operations sentinel. Each was
generated with the built-in image generator as one identity-locked three-pose
sheet against the same style master and Codex scout pose references. When a
generation baked its preview background into RGB, a background-extraction edit
removed only that background before the standard packager applied hard alpha,
native card/map canvases, shared seated scale, and bottom-center anchoring.
Four later arrivals extend the party for larger Office teams: an auburn field
cartographer, mint technical alchemist, burgundy museum curator, and platinum
operations strategist. Their sheets use the same standing / seated / typing
contract and the same native packager. A violet tactician, coral diplomat,
copper artificer, and blue-black librarian first extended that party to sixteen. Four more complete identities—a
midnight astronomer, silver-lilac cryptographer, copper-braided geometer, and coral-haired prototyper—bring the Grok
family to twenty. Each addition ships the same standing portrait, seated idle, and seated typing contract rather than
recoloring an existing silhouette. The packager also strips an edge-connected neutral checkerboard when a generated
source bakes its transparency preview into RGB, before applying the normal hard-alpha and native-canvas pass;
the cast repair path also replaces an already-retained duplicate as soon as a
new authored identity becomes available. Grok uses its own deterministic
identity hash, so a twenty-person party exhausts the authored feminine cast
before any appearance repeats while retaining each Session's appearance after
refresh. Larger teams reuse the least-used identity first; the real forty-person
Chat team therefore forms two balanced rounds instead of clustering repeated
archetypes.

The four `*-desk-v1.png` files are a separate generated map-scale pose family.
Each employee is seated, seen from a top-down three-quarter rear view, and faces
the workstation monitor instead of standing front-facing inside the chair. The
Codex pose established the locked camera and silhouette; Claude, Pi, and
OpenCode preserve that framing while carrying their portrait hair, headgear,
outerwear, and accent colors. Checkerboard outputs went through background
extraction before the transparent sources were cropped and packaged for the
runtime. Portrait sprites remain the identity view in roster and Agent windows.

The four `*-desk-work-v1.png` files add the alternate keyboard phase for working coworkers. They were generated as
identity-constrained rear-view poses, then packaged non-destructively beside the original frame. To prevent whole-body
generation shimmer, each runtime frame composites the original head and central torso pixel-for-pixel over the new
shoulder and forearm movement. Runtime animation swaps the two frames with discrete timing and a different phase per
archetype; reduced motion keeps the original frame, and portrait views never use the typing family.

`waiting-emote-v1.png` and `failed-emote-v1.png` are exceptional-state map
signals. The waiting desk gets a quiet three-dot parchment bubble; a failed desk
gets a jagged warning bubble. Normal work stays unlabelled, and an actual tool
bubble replaces the emote when Alice approaches so the map never stacks two
messages over one worker. Both icons were generated on a flat magenta key,
processed with the ImageGen chroma-key helper, alpha-checked, and packaged at
map scale.
