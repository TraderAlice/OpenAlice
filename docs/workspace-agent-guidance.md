# Workspace Agent Guidance

This guide owns the instruction architecture injected into OpenAlice
Workspaces. It covers the boundary between the always-loaded Workspace
contract, discoverable skills, and the live CLI surface.

## The three layers

### 1. Always-loaded contract

`src/workspaces/templates/<template>/files/instruction.md` is written to both
`CLAUDE.md` and `AGENTS.md` by `src/workspaces/context-injector.ts`. The Chat
template owns Alice's baseline identity directly in this file; there is no
mutable installation-wide persona source.

Templates may opt out of this instruction layer with `injectInstructions: false`.
AutoQuant V2 does so to preserve the upstream `AGENTS.md`; OpenAlice adds only
discoverable collaboration/data/trading skills alongside it.

This layer may define only durable behavior:

- how to distinguish chat, durable work, Inbox delivery, and trading;
- evidence and freshness requirements;
- when to ask an attributable Session instead of guessing;
- which skill owns a domain.

It must not duplicate flag manuals, Issue schemas, long examples, or provider
inventories. Those details change too often and crowd out the actual request.

### 2. Discoverable skills

`default/skills/*/SKILL.md` owns domain procedures and command examples. A skill
description should answer only “when should I load this?”; the body teaches the
workflow after it is selected.

One concept has one primary owner:

| Concept | Owner |
|---|---|
| Human notifications/reports through Inbox, Issue collaboration, provenance, peer questions, Session nametags | `alice` (collaboration reference) |
| Connector reply file attachments (`[[relative/path.ext]]`) | `file-delivery` |
| Delegating quantitative research from Chat to AutoQuant | `delegate-autoquant` |
| Issue file shape, ownership, schedules, headless delivery | `self-scheduling` |
| Low-frequency market/fundamental/macro data | `traderhub` |
| K-line discovery, raw OHLCV, freshness and reply chart references | `market-data` |
| Optional quantitative formulas and snapshots | `alice-analysis` |
| Broker accounts/contracts/quotes and trading writes | `alice-uta` |

Other instructions may route to that owner but should not copy its manual.

### 3. Live CLI contract

The CLI manifest and tool results are the final authority for verbs, flags, and
validation. Durable Workspaces can carry old skill snapshots, so errors should
be self-correcting: say what boundary was crossed and name the next appropriate
command. Reject unknown flags and positional arguments before invocation, show
the accepted flags, and give a semantic recovery command for common old or
guessed routes. A bare validation failure that forces the agent to guess is a
product bug.

Use the real shim in the verification loop; direct tool calls do not exercise
argv parsing or manifest help.

The three public CLI names are deliberate authority boundaries rather than one
flat command bag:

| CLI | Boundary |
|---|---|
| `alice` | Research data, subscribed-feed archive, symbols, K-lines, Workspace collaboration, Inbox, Issues, Sessions and tracked assets |
| `traderhub` | Low-frequency boards, fundamentals, macro, and calendars |
| `alice-uta` | Broker reads plus explicit trading mutations and approval flow |

`alice-workspace` remains a compatibility alias for existing scripts. New
Workspace guidance uses `alice` and its bundled collaboration reference. The
legacy `/workspace` gateway remains available to older shims; the unified
`/data` gateway routes each mapped tool to its owning registry, preserving
Workspace and Session provenance.

Every export manifest supplies intent-first descriptions for its command
groups. Top-level and group help must explain which namespace owns an action
before listing verbs. Skills may teach workflows, but an old copied skill must
be able to recover from current live help.

`alice inbox read` projects each attached document with a directly
usable absolute path when its source Workspace is available. `peer path` is the
lower-level addressing primitive for inspecting that desk. In both cases,
native Coding Agent file, search, and Git capabilities own the read flow. Do
not grow a second Workspace file API merely to reproduce those capabilities;
adapter permission problems belong at the runtime boundary.

## Snapshot and upgrade semantics

Guidance is copied into a Workspace at creation and committed as part of its
initial desk state. It is not silently replaced later: agents and users may have
edited those files, and an automatic overwrite would mutate a durable work log.

The template README version records guidance changes. Bump it when the injected
contract or bundled skill set changes materially. Existing Workspaces then show
an upgrade-available signal. Templates that opt into `managed-context` use the
explicit three-way review in [[docs/workspace-template-upgrade.md]]: launcher
changes apply, Workspace-only changes stay, and dual edits require a choice.
Live CLI help and self-correcting errors remain the compatibility layer for old
skills that a user deliberately preserves.

## Browsing the installed contract

The Workspace details page is a read-only capability browser. Skills are read
through the existing Workspace file API from `.agents/skills`, `.claude/skills`,
and `.pi/skills`. Each skill has one identity: `.agents/skills` is the Workspace
primary source, `.claude/skills` is its runtime mirror, and existing `.pi/skills`
entries are legacy copies. Instructions similarly present AGENTS.md with its
CLAUDE.md mirror. Missing primary sources retain inspectable runtime copies.

The browser separately groups ownership into Alice Harness injection and
Workspace-supplied content. The Project exposes its managed Skill names,
including legacy injection names; the frontend does not maintain a second
allowlist. Workspace-supplied includes template content and local additions,
not proof of upstream provenance. AGENTS.md/CLAUDE.md belong to the Workspace
instruction layer. Mirror location and divergence do not change ownership.
A failed ownership lookup leaves files readable under an unknown-source group.
The CLI tab inventories Alice Harness exports only, not arbitrary executables
installed by a Workspace.

Selecting an item compares its complete directory (including supporting files
and empty folders). Missing, extra and changed entries have a side-by-side text
view. Links, read failures, oversized or undecodable content and traversal limits
are unverified, never equal. Traversal is bounded to 2,000 operations and 24 levels.
This is a read-only snapshot, not a sync service. Template injection and upgrades
still own writes; divergent content is never automatically overwritten.
This inventory describes files on disk, not proof that a native runtime loaded
them, and does not inventory user-level or other native skill directories.

CLI reference pages use the authenticated
`GET /api/workspaces/:wsId/cli/:export/manifest` endpoint, sharing the native CLI
gateway's live registry and schemas. This mount exposes no invoke route. The UI
shows commands, required parameters, defaults, enums, and the raw schema; copying
a command never runs it. Injection explanations show the launch contract rather
than process environment values. Editing skills, credentials, and hooks remains
outside this browser's scope.

## Review checklist

- Is the rule durable enough to be always loaded, or does it belong in a skill?
- Does another skill already own the concept?
- Does the skill description route clearly without becoming a mini-manual?
- Can every market fact the prompt asks for be traced to a tool result or named
  artifact, with its `asOf` meaning preserved?
- If a stale agent chooses the wrong verb, does the live error lead it to the
  correct one?
- Was the template version bumped for a material injected-guidance change?
- Were context injection, the affected tool, the CLI gateway, and the real shim
  tested together?


## Independent injection releases

The Project supplies CLI runtime and companion Skill sources, as described in
[[docs/alice-harness.md]]. CLI follows the running Project; only copied Skill
files need an explicit update. Settings → Workspace injection owns the source
catalog, per-Workspace comparisons and batch updates. Workspace details → CLI →
Alice Harness links to this management surface and exposes the installed file revision and independent preferences
for command availability and retained Skills. Updates respect those preferences
and review local changes. Changing these Skills does not require a Chat/AQ/AP
template version bump.
