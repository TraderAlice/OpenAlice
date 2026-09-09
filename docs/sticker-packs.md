# Sticker packs

An Alice Project supplies sticker prototypes independently of Alice Harness Skills
and Workspace template releases. Chat Workspaces project the selected images to
flat `sticker/<name>.png` or `.webp` paths and generate
`.agents/skills/alice-stickers/SKILL.md` with a byte-identical Claude mirror. The
Skill lists installed filenames and their meanings. Bundled meanings are written
in English for agent consumption; imported descriptions retain the author’s text. Nothing is added to
`AGENTS.md`, `CLAUDE.md`, system prompts, or the normal Alice Harness Skill bundle.
Native agents discover this optional Skill through their existing mechanism.
This is a Workspace-level capability, including any agents that share that
Workspace. Removing a Skill does not erase previously loaded session context.

## Prototypes and versions

The bundled Alice Color and Alice Ink packs live under `default/stickers/`, each with
20 maintainer-supplied PNGs and `pack.json`. Color is the initial default. Project imports live under
`data/stickers/packs/<id>/`; Project defaults live in `data/stickers/settings.json`.
Each manifest specifies `schemaVersion: 1`, `id`, `name`, `version`, and
`stickers: [{ file, description }]`. The effective revision includes a fingerprint
of manifest, image bytes and generated Skill, separately from other Harness versions.

Imports accept single or multiple PNG/WebP images and optional per-image meanings.
Without a meaning, the filename supplies the description. Users unpack archives
before upload. File names are portable ASCII names; traversal, folders, duplicate
filenames and non-image bytes are rejected. Each image is at most 512 KiB, with
at most 100 images and 32 MiB total. Imported revisions are immutable, with an
atomically replaced current pointer.
Importing the same pack ID publishes a new available revision without changing
Workspace copies. Previous prototypes remain on disk; the UI applies the current
Project revision. Builtin IDs cannot be overwritten.
Telegram's own sticker format/dimension requirements still apply; imports do not
silently resize or convert images.

## Workspace projection

Only new Chat Workspaces default to enabled. Existing Workspaces are not modified
on startup. `.alice/stickers.json` records enabled state, selected pack, accepted
revision and hashes of owned files. It survives ordinary template/Skill upgrades;
those engines exclude the Sticker Skill. Normal Alice Harness updates cannot
re-enable it. Changing the Project default affects future Chat creation only.

Disable removes the managed Skill and Claude mirror but retains images. Restore
regenerates the selected projection. Switching removes only previously managed
images and installs the new flat set. Personal files are preserved. A conflicting
unmanaged filename blocks apply; modified managed files require explicit restore.
The exact preview digest protects against changed files or prototypes.

Projection acquires the existing Workspace checkout operation lease. Replacements
are atomic per file; a rollback journal at `.alice/sticker-transaction.json`
recovers interrupted operations on the next preview/apply. Recovery refuses to
overwrite intervening edits. Symlinked projection paths are rejected. Changes
remain ordinary Workspace working-tree files rather than creating a Git commit
that could capture the agent's unrelated work.

## User surfaces

Settings → Workspace injection → Stickers previews packs, imports new ones, sets
the default for new Chats, and manages existing Chat projections. Chat Workspace
details has the same scoped Stickers tab. Both surfaces review exact changed paths
before applying. The API is mounted under `/api/workspaces/stickers`: catalog,
pack images, import, default selection, and per-Workspace preview/apply. Backend
reads stay behind a domain hook; demo handlers mirror these contracts.

Connector still owns reply presentation. `[[sticker/wave.png]]` resolves the
projected Workspace file through the generic file API and sends a native sticker.
There is no Connector dependency in resource injection or template construction.
