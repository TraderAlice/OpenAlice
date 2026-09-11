# Alice Harness injection

Alice Project provides CLI runtime capabilities and companion Skills independently
of the Workspace Harness. Workspace CLI switches and Skill inclusion preferences
are separate; only copied Skill files need an explicit Workspace update. Chat template versions, AutoQuant source pins, and
Auto Prediction source pins do not version this injection layer.

## Version authority

`default/alice-harness.json` declares the Project's injection release version.
Its effective revision appends a content fingerprint of the complete owned Skill
trees only. CLI implementation/registry changes do not change this file-bundle
revision; update the Skills documentation and its release when the contract changes. Updating these assets does not require
bumping a Chat/AQ/AP template version.

Each newly created Workspace records accepted state at
`.alice/alice-harness-version.json` (schemaVersion, template=alice-harness,
appliedVersion, appliedAt, source, per-Skill skillVersions and optional upgrade commit). It is local
bookkeeping excluded from Workspace Git, alongside the compressed three-way
baseline and recovery journal under `.alice/alice-harness-upgrade/`.
The actual executable/tool implementation remains provided by the running
Project. The accepted revision does not pin an old binary. Status surfaces show
accepted and available revisions separately.

## Ownership

Alice Harness owns complete trees for `alice`, `alice-analysis`, `alice-uta`,
`traderhub`, `self-scheduling`, and `file-delivery`, plus removal/reconciliation of legacy
`alice-workspace` copies. `.agents/skills` is primary and `.claude/skills` is its
runtime mirror; old `.pi/skills` duplicates are included only for reconciliation.
Template-declared instructions, README and other bundled Skills remain template
owned. Existing template baselines may contain these trees, but template plans
exclude Alice-owned paths. Source upgrades remain ordinary upstream Git merges
and do not advance Alice injection metadata.

## Workspace configuration

`.alice/alice-harness-config.json` is Workspace-owned, tracked configuration.
Omitted CLI entries are enabled. A CLI-wide disable wins over group switches:

```json
{
  "schemaVersion": 1,
  "skills": { "traderhub": false },
  "cli": {
    "alice": { "groups": { "rss": false } },
    "alice-uta": { "enabled": false }
  }
}
```

First-version granularity is CLI and command group. The gateway reads current
configuration for both discovery and invocation, including the legacy Workspace
export. Disabled tools return 403; malformed configuration fails closed with a
configuration error. This is customization of Workspace capabilities, not a
sandbox against an Agent allowed to edit its own files. UTA permission and
trading-write authority remain unchanged.

Saving configuration applies CLI switches immediately but does not overwrite
Skill files. `skills` is an optional name-to-boolean inclusion map. Omitted
entries follow the template's original default (`injectTools`, plus the always
included self-scheduling Skill); explicit inclusion/exclusion overrides that
default. CLI switches never add or remove Skills, and excluding a Skill never
disables commands. A later update reconciles excluded files, with local edits
requiring review rather than silent deletion. Exclusions remain in effect until
the Workspace changes its preference. They never remove the Project prototype:
re-enabling a Skill restores its files on the next update, even at the same bundle
revision and with its CLI disabled.

## Independent upgrade

Project Settings → Workspace injection owns the Project CLI catalog, source Skills
browser, Workspace update inventory and batch updates. Batch updates use the
displayed digests and skip checkout-blocked/conflicting entries; each Workspace succeeds or
fails independently. Workspace details owns CLI/Skill preferences and a link to
Project management. Unversioned matching files need only a baseline/version
record; differing files enter the same update review. The Project catalog API is `/api/workspaces/alice-harness/catalog`. Per-Workspace
APIs are `/api/workspaces/:id/alice-harness`,
`PUT .../alice-harness/config`, and `GET/POST .../alice-harness-upgrade`.
The CLI offers `alice harness upgrade` and `alice harness upgrade --apply`, with
`--id` for a peer and the same per-file conflict flags as template upgrades.

Skill updates, including scoped install/remove/restore, are allowed during active
interactive, Web and headless Sessions. Existing model context is not reloaded;
an agent must reread changed Skills to use the new instructions. Template/source
upgrades and CLI configuration writes retain their separate activity checks.

The shared managed-file engine provides checkout serialization and staged-index
blockers, exact preview digests, atomic file replacements,
Git commit, rollback and committed-transaction recovery. Configuration is part
of the preview digest and never overwritten by upgrade. Both upgrade layers
recover before scheduled work starts.

Existing Workspaces are unversioned until explicitly adopted. First preview
uses the legacy root-commit baseline; unknown or customized content is preserved
or reviewed as a conflict. No startup rewrite or bulk migration changes user
files. First successful adoption creates a missing default configuration through the same reviewed transaction and records the independent baseline and revision.

## Skill prototypes and Workspace copies

Settings → Workspace injection opens a Workspace-first Skill list with injected
and Project versions beside each status. Select a Workspace, search Skills and
expand a row for file comparison. The separate Project prototype view remains
read-only; full-bundle batch updates live under a disclosure. Project
sources remain visible when a Workspace excludes or removes its copy. Each
prototype shows installed state, local customization, source changes and missing
or divergent runtime mirrors. File comparison loads on demand; unverified and
truncated entries remain explicit. Catalog responses carry summaries rather
than repeating every Workspace file body.

Install, remove, update and restore operate on a **single Skill**. Each action
previews exact files and commits its retention preference together with those
files under the existing checkout lease/journal. CLI switches are preserved.
Update uses three-way comparison; restore explicitly replaces the selected
Skill with the Project prototype after review. Both `.agents` and `.claude`
copies belong to that identity; local divergence is displayed, not silently
assumed equal. A restore reconciles both copies to the prototype.

Scoped operations merge only that Skill into the stored baseline and leave the
whole-bundle applied revision unchanged. Other Skill baselines are retained;
only a whole-bundle update records the Project bundle revision. This avoids
claiming that installing one Skill updated the rest of a Workspace. On legacy
Workspaces, scoped adoption records an `unversioned` bundle until the bundle is
reviewed. Each retained Skill also records its accepted Project revision and timestamp
in `skillVersions[name] = { version, appliedAt }`. Scoped operations update only
that entry; removal clears it. Full injection records every retained Skill.
The UI displays the release and a short fingerprint, with the full value on hover.
Older records without per-Skill metadata show an unknown injected version, even
when current files match. Local edits remain a separate status; the recorded
revision describes the accepted source baseline. The journal carries scoped
revision metadata so committed recovery preserves the same bookkeeping.

`GET /api/workspaces/:id/alice-harness/skills/:skill` supplies a detailed copy
comparison. The existing upgrade preview accepts `?skill=<name>&action=<action>`;
apply supplies the same `{ skill, action }` as `projection`, plus the exact plan
digest and conflict resolutions. Supported actions are `install`, `update`,
`remove` and `restore`. Preview is read-only; stale files or config invalidate
apply. Failures before commit restore both files and preferences.

## CLI context injection

Workspace launch supplies `OPENALICE_HOME`, `OPENALICE_PROJECT_ID`, its tool
endpoint and `AQ_WS_ID`; Session/run identity remains separate. Ordinary shells
can select that Project through `openalice exec --project <key> alice ...`.
Project-only requests omit Workspace identity and expose only global registry
commands. Workspace calls still enforce their CLI preferences. See
[[docs/cli-supervisor.md]] for resolution and endpoint discovery.

Codex launches use `allow_login_shell=false` across TUI, Web and headless
Sessions. Alice has already assembled the child PATH; a login profile such as
Linux `/etc/profile` can replace it and make the injected commands disappear.
The setting is a per-launch override, including resumes, not a user-config or
Skill rewrite. Verify CLI discovery inside the agent's shell, not just its
parent process environment.

Cursor's Bash/Zsh snapshot has the same precedence hazard: the login profile
can select a global `alice` even when Workspace routing variables survive.
The Cursor adapter restores the composed PATH through
`__CURSOR_SANDBOX_ENV_RESTORE`, evaluated after snapshot restoration in Cursor
`2026.09.08-6caf4ff`. This is a vendor-internal integration, not a public Cursor
configuration promise; revalidate it on runtime upgrades. Native Windows is
excluded. No user shell profile is rewritten.

### Headless CLI acceptance

Exercise the actual Workspace headless API with default shell options. Check
both the exact `command -v alice` path and a read such as
`alice issue list --limit 1`; exit zero alone can hide a stale global binary.
Do not supply PATH/login overrides in acceptance. Inspect normalized errors as
well as process exit codes: Pi can exit zero after a provider authentication
failure, and `headlessTaskStatus` correctly marks that outcome failed.

The 2026-09-09 audit exercised Codex, Pi and OpenCode on the Linux SSH Runtime,
and Grok, OMP and Cursor on macOS. Codex's non-login setting and Cursor's PATH
restoration address the observed failures. Local Claude was unauthenticated;
Antigravity returned an execution error before tool use. Those runs do not
establish CLI acceptance and require working native access before retesting.
This is dated acceptance evidence, not a permanent runtime compatibility claim.

## Optional sticker resources

Chat sticker packs use a separate Project-owned projection and generated Skill.
They do not participate in this bundle or template Skill upgrades; see
[[docs/sticker-packs.md]].

## Upgrade discovery

Workspace CLI discovery includes a warning when the accepted Skills revision
is missing or differs from the current Project source. The shim prints it to
stderr, leaving command JSON and `--output` files unchanged. Source hashing is
cached for 30 seconds; the Workspace receipt is reread each time. Project-only
CLI calls have no Workspace injection to compare. Receipt errors cannot block
normal command discovery.

The warning points to `alice harness upgrade --apply`. Clean line-level merges
are automatic; actual conflicts require resolution through the same CLI or the
UI's chat handoff. This updates files, not the already-loaded model context,
and does not restore excluded Skills or alter CLI preferences.

Use `alice harness upgrade --skill alice --action update` for the same scoped
operation offered by the UI. Actions are install, update, remove and restore;
restore explicitly replaces the local copy. Omit --skill for the whole bundle.
