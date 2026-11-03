# Alice Harness injection

AliceProject supplies CLI runtime capabilities and companion Skills independently
of Workspace templates. CLI availability and copied Skill inclusion are separate
preferences. Chat template versions and source-backed Harness pins do not
version this injection layer.

## Version and ownership

`default/alice-harness.json` declares the Project injection release. Its
effective revision fingerprints the complete owned Skill trees. CLI implementation
or registry changes do not change that file-bundle revision; executable behavior
follows the running Project and is never pinned to an old Workspace receipt.

Each Workspace records accepted state in `.alice/alice-harness-version.json`,
with bundle and per-Skill revisions plus optional upgrade commit. Baselines and
recovery journals live under `.alice/alice-harness-upgrade/`. These are local
bookkeeping excluded from Workspace Git. Status surfaces distinguish accepted
and available revisions.

`ALICE_HARNESS_SKILLS` in `src/workspaces/alice-harness-policy.ts` is the sole
catalog of complete Alice-owned Skill trees. `.agents/skills` is primary;
`.claude/skills` is its runtime mirror; legacy `.pi/skills` exists only for
reconciliation. The catalog also handles legacy `alice-workspace` copies without
restoring that name as current guidance.

Template instructions, README, and other bundled Skills remain template-owned.
Template plans exclude Alice-owned paths. Source upgrades are upstream Git
merges and do not advance Alice injection metadata. Sticker packs use their
separate Project projection in [[docs/sticker-packs.md]].

## Workspace preferences

`.alice/alice-harness-config.json` is Workspace-owned tracked config. Omitted CLI
entries are enabled. A CLI-wide disable wins over group switches. The gateway
reads current config for discovery and invocation, including compatibility
exports. Disabled tools return 403; malformed config fails closed.

These switches customize capabilities, not a security sandbox against an Agent
that can edit its own files. UTA permission and trading-write authority are
unchanged.

Skill inclusion is an independent optional name-to-boolean map. Omitted Skills
follow template defaults, with self-scheduling always included. Explicit choices
override defaults. CLI switches never add/remove Skill files, and excluding a
Skill never disables commands.

Preference saves apply CLI switches immediately without overwriting Skill files.
Updates reconcile excluded files with local-edit review rather than silent
deletion. Exclusions persist until changed and never remove the Project
prototype. Re-enabling restores files on the next update even at the same bundle
revision or with the CLI disabled.

## Independent updates

Project Settings → Workspace injection owns prototypes, inventory, and batch
updates; Workspace details owns preferences. Batch apply uses displayed digests,
skips blocked/conflicting checkouts, and isolates each Workspace result.

Existing Workspaces stay unversioned until explicit adoption. First preview uses
the root-commit baseline without startup rewrites; unknown/custom content is
preserved or reviewed. Adoption and missing default config use one transaction.

The shared managed-file engine supplies leases, staged-index blockers, exact
digests, atomic replacement, isolated commit, rollback, and committed recovery
before scheduled work. Config joins the digest and is never overwritten.

Skill updates may run during active Sessions; Agents must reread changed files
because model context is not reloaded. Template/source upgrades and CLI config
writes retain separate activity gates.

Scoped operations affect one Skill identity across `.agents` and `.claude`.
They preview exact files and commit retention preference with those files while
preserving CLI switches. Update uses three-way comparison; restore deliberately
replaces the reviewed local copy. Unverified or divergent comparisons never
mean equal.

A scoped operation merges only that Skill into Base and updates only its
`skillVersions` entry; removal clears it. Whole-bundle revision changes only on
a full update. Legacy scoped adoption stays `unversioned` until full review.
Recovery preserves the same bookkeeping.

`alice harness upgrade` previews; `--apply` applies. `--skill` plus an action
(`install`, `update`, `remove`, `restore`) scopes the operation. CLI and UI use
the same digest, conflict, and lease contracts.

## CLI context injection

Workspace launch supplies `OPENALICE_HOME`, `OPENALICE_PROJECT_ID`, the tool
endpoint, and `AQ_WS_ID`; Session/run identity is separate. Project-only calls
omit Workspace identity and expose only global registry commands. Workspace
calls enforce current preferences. [[docs/cli-supervisor.md]] owns Project and
endpoint resolution.

Adapters must preserve Alice's composed PATH through native shell startup. A
login profile or shell snapshot must not replace it with a global `alice`.
Required corrections are process-local adapter launch policy, including resume;
OpenAlice does not rewrite user shell profiles or global native config.

CLI discovery may warn on stderr about stale Skills without changing JSON/
output files or blocking commands. Updates change files, not loaded context or
preferences; Project-only calls have no Workspace bundle.

## Load-bearing paths

- `default/alice-harness.json` and `default/skills/` — release and prototypes.
- `src/workspaces/alice-harness-policy.ts` — owned Skills and preferences.
- `src/workspaces/template-upgrade.ts` — shared plans, scoped updates, receipts.
- `src/workspaces/workspace-operation-guard.ts` — checkout serialization.
- `src/workspaces/context-injector.ts` and adapters — copies and launch PATH.
- `src/server/` CLI gateway and Workspace injection routes/UI — live enforcement,
  catalog, comparisons, and updates.

## Verification gates

Test bundle/scoped apply, preference independence, stale digests, conflicts,
rollback/recovery, per-Skill revisions, legacy adoption, exclusion/re-enable,
and gateway enforcement. For PATH changes, use the real Workspace headless API
with default shell options: check `command -v alice` and a bounded read without
PATH/login overrides. Exit zero alone can hide stale binaries or normalized
provider failure. Expand cross-runtime scope via [[docs/development-workflow.md]].
