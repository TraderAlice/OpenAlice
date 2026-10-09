# Data Locations and Concurrent AliceProjects

This guide owns OpenAlice data-location selection, desktop launcher
preferences, and the isolation contract for concurrent local AliceProjects.
Runtime lock recovery itself belongs to `packages/guardian-runtime/`; the
persistent state layout belongs to [[docs/project-structure.md]].

## One Complete Home

A selectable **data location** is the complete `OPENALICE_HOME`, not only its
`data/` child and not Electron's browser-profile directory. It keeps these
parts together:

```text
<OPENALICE_HOME>/
├── data/                 product configuration and portable user data
├── workspaces/           Workspace repositories, Sessions, and task state
├── state/                Guardian and runtime ownership locks
├── runtime/              optional Broker Packs
├── provider-keys.json    AI provider credentials, unless globally overridden
└── sealing.key           machine-bound encryption key
```

Two AliceProjects may run concurrently when they use different complete
homes and unpinned ports. Two writers must never share one home. Default ports
probe upward independently, while explicitly pinned ports still fail if they
collide.

Workspace launcher state includes the private
`workspaces/state/agent-conversations.jsonl` prompt/reply event stream and
`workspaces/state/agent-runtime.jsonl` occupancy journal.
`workspaces/state/session-executions.json` is the secret-free process lifecycle
ledger (source, selection, PID, states, and exit reason). These move with the
complete home and are not part of any Workspace repository. Treat the
conversation stream as sensitive history when backing up or sharing a home;
the occupancy journal has no prompt bodies.

The explicit `openalice project transfer` operation is narrower than a raw
complete-home backup or filesystem copy. It deliberately excludes both of
those launcher journals, resume identities, headless tasks/logs, Runtime state,
ports, auth, and untracked Session dossiers. It preserves portable data and
Workspace repositories, rebases their absolute paths, and reports zero imported
resumable Sessions. Git-tracked `.alice/sessions` bytes may remain for repository
fidelity, but are inert without a destination resume identity.

Each Workspace repository carries `.alice/settings.json`, a versioned,
secret-free description of its recent interactive and headless Agent runtime
choices. It may contain vault credential slugs, model ids, and effort values,
but never provider keys or resolved endpoints. The referenced secrets remain
under the complete home and therefore do not travel merely because a Workspace
repository is copied.

`<OPENALICE_HOME>/data/ui-layout.json` is the Activity Bar layout: group
order, custom groups, and which rail entries are hidden. It is user chrome,
not operator config, and travels with the complete home. Missing or
malformed files equal the default document (Dev Panel hidden). Settings
cannot be hidden. Deep links to a hidden surface still adopt.

`<OPENALICE_HOME>/data/inbox/routine-follow-ups.json` is the Office decision
queue and receipt ledger. Its version-2 document contains active scheduled-report
references the human explicitly carried out of a review shift and immutable
decision receipts. Both retain the Inbox entry identity, immutable report
timestamp, exact Issue coordinates, and first-carried timestamp; a receipt also
stores the declared disposition, any required normalized note, and the server
decision time. Saving a decision atomically removes the exact active row and
appends its receipt. A new receipt is bound to the per-entry revision observed
before its exact Inbox and Scheduled-Issue evidence checks, so it cannot consume
a carry that appeared later. Source loading or read failure is never classified
as missing evidence; `evidence-unavailable` requires successful authority reads
that prove at least one exact source absent. Receipts are never silently pruned:
every retained identity continues to make an identical retry idempotent and
prevents that report from becoming active again. The ledger never owns Issue
status or scheduling, and writing it never dispatches an Agent. Missing means an empty queue and ledger;
malformed state is a load error rather than something the product silently
discards or overwrites. Alice keeps serving its other surfaces, while the Office
decision-queue API fails closed until the sidecar is repaired. The file moves
with the complete AliceProject so browser and Electron views share one durable
diligence workflow.

`<OPENALICE_HOME>/data/office/day.json` is the AliceProject-wide Office Day
sidecar. It stores one server-local IANA calendar day, the current finite shift
of up to four exact duty keys, their pending order, a same-day ledger of every
exact duty key already admitted, and exact evidence receipts. The admission
ledger is append-only within the day and capped at 1,024 exact keys. The
ledger prevents a stale renderer from reopening an older evidence version as a
new shift while still allowing a genuinely new fingerprint.
It is presentation/workflow state only: Inbox, Issues, schedules, and Decision
Desk records remain the completion authorities. The backend supplies the day
key and next local-midnight rollover; browser tabs mutate it through commands
guarded by that day key and the current monotonic shift id. Missing means no day
has been opened. Malformed state is never replaced: Alice keeps serving other
surfaces while every Office Day API fails closed until the sidecar is repaired.
Atomic replacement and process-local command serialization make every browser
and Electron view of one AliceProject converge on the same day.

Each product Session created in that Workspace owns a secret-free dossier
at `.alice/sessions/<resumeId>.json`. The `ai` object records the Agent
runtime plus the credential reference, model, and effort frozen for that
Session. An optional sibling `displayName` is the mutable coworker nametag.
The global `workspaces/state/resume-identities.json` remains only the
product-to-native Session identity ledger; it does not own AI configuration
or the nametag. Copying or archiving a Workspace therefore carries its
Session launch semantics and coworker names, but never the vault secret
referenced by a credential slug. The launcher-owned Workspace Manager is
the deliberate exception: because its cwd is the active Workspace floor rather
than a business Workspace, its files live under
`workspaces/state/workspace-manager-sessions/` instead of creating `.alice/` at
the floor root.

`AQ_LAUNCHER_ROOT` and `OPENALICE_GLOBAL_DIR` remain advanced split-root
overrides. A fixed `AQ_LAUNCHER_ROOT` disables desktop home switching because
changing only the rest of the home would still share Workspace files and
locks. `OPENALICE_GLOBAL_DIR` does not affect runtime ownership, but provider
keys under that override remain shared by design.

## Desktop Flow

The packaged and Electron-development app resolve a home before acquiring any
Guardian lock, relocating legacy data, reading ports, running migrations, or
starting a child process.

Selection uses the same client Supervisor `config.json.defaultTarget` as Web,
TUI and CLI. Explicit `OPENALICE_HOME` is an invocation override. A null,
unavailable or ambiguous migrated Default opens the existing project chooser;
it never silently selects `~/.openalice`.

**Settings → General → Data location** reveals the effective home and can open
its folder. Switch projects through **Where Alice is working**. The independent
recent-directory list and ask-on-startup policy are retired. Choosing another
project after an existing-owner dialog returns to the shared chooser rather
than writing a native directory preference.

The old `<Electron userData>/openalice-data-home.json` is read only as migration
input. Its selectedHome must map to one registered local project. Conflicts,
corruption or unmapped folders require explicit selection. The old file remains
as a backup, and no project data is moved or deleted by selection migration.
See [[docs/alice-project.md]] for save/cancel semantics and the Supervisor-root
migration boundary.

## Browser, CLI, and Development Flow

The local CLI already exposes the same complete-root boundary:

```bash
openalice run --home ~/.openalice-dev/feature-a
```

`pnpm dev` accepts an equivalent focused override. Keep these homes outside the
repository so a feature checkout does not accumulate user state:

```bash
pnpm dev -- --home ~/.openalice-dev/feature-a
pnpm dev -- --home ~/.openalice-dev/feature-b
```

`--home` takes precedence over `OPENALICE_HOME`. `--takeover` remains the only
development/CLI operation that may stop an owner of the same home. Separate
homes are the normal choice for concurrent worktrees; takeover is recovery,
not concurrency.

Bare `openalice` exposes registered homes through AliceProjects. The
machine-local Supervisor registry lives outside every complete home and stores
the shared Machine/AliceProject Default. Creating an entry does not select it
or move, copy, stop, or delete another home. Named projects require a separate
home; equal and nested registered paths are rejected.

If the remembered home disappears, retain the registry entry and show the
startup chooser or a visible target error. Do not attach to another available
project or silently recreate the missing path. Explicit environment/flag
selection also remains authoritative rather than falling back.

An inherited Web port
remains automatic from 47331 so concurrent AliceProjects probe upward, while a
configured port is intentionally pinned. First Alice boot must not write
`data/config/ports.json` merely to materialize that default: a file `web`
value is a pin, so a seeded `3002` (or `47331`) would refuse to move when
another home already holds it. Existing shipped `{ "web": 3002 }` files stay
pins; delete the key or the file to restore probing. `openalice up --port`
and `OPENALICE_WEB_PORT` remain one-run pins and do not rewrite the file.

The machine-wide Supervisor root also owns `machines.json`. This second
registry stores Herdr-style remote Machine profiles; it does not move with a
complete home and does not belong to the Electron browser profile. Stored rows
contain an opaque id, display name, SSH target, optional port, enabled state,
and local identity-file path, never key bytes or AliceProject data.
`remote-targets.json` beside it remains a hashed, non-enumerable tunnel-port
cache rather than durable fleet identity.

The persisted shape is distinct from the `machine list --json` presentation:

```json
{
  "schemaVersion": 1,
  "machines": {
    "cloud": {
      "id": "0123456789abcdef0123456789abcdef",
      "displayName": "Cloud",
      "sshTarget": "alice@cloud",
      "enabled": true
    }
  }
}
```

The map key is an internal Fleet/transfer handle. Optional `sshPort` is an
integer from 1 to 65535; optional `identityFile` is an absolute local path.
Omitting `sshPort` lets OpenSSH config choose it. Older rows may omit `id` and
`enabled`; they use the map key as id and are enabled by default. Public JSON
uses an array with `id`, `label`, `target`, `enabled`, and nullable `sshPort`.
Do not write that output back as the registry. New CLI labels must be unique and cannot
be `local` or a profile id. Selectors resolve id, then label, then internal key.
Unknown fields survive writes; an old `remoteSession` field is inert metadata,
not a session selector. OpenAlice does not consume Herdr's catalog format.

A received AliceProject is registered in the Supervisor's `config.json`, not
`machines.json`, only after
its sibling staging Home has passed checksum and space validation and has been
atomically published. Registration does not select it as the remote default.
The new Home owns a new `sealing.key`; source machine locks, Runtime payloads,
installer state, and sealing material never travel with it.

`OPENALICE_PROJECT`, `OPENALICE_HOME`, `--project`, and `--home` remain
higher-priority one-run/automation inputs. When they fix the selected project
or Home, the TUI explains that AliceProject selection is read-only rather than
persisting a choice that cannot affect the current process.

`OPENALICE_INSTANCE` and `--instance` remain deprecated compatibility aliases
for released automation only.

## Switching and Failure Safety

Selection never moves, copies, merges, or deletes project data. Startup chooses
a registered Machine/AliceProject; explicit create may prepare a new or empty
home and rejects an unrelated non-empty directory. Verify the target and
successful client presentation before remembering the shared Default. A failed
switch preserves the old connection and Default.

The retired Electron directory picker, recent-home list, and ask-on-startup
setting are not alternative selection authorities. Integrated/separated mode
transitions and owned-child retirement follow [[docs/remote-access.md]];
complete-home ownership remains with the selected AliceProject.

`openalice project copy-ai-creds` is the explicit exception for AI credential
rows in `<home>/data/config/ai-provider-manager.json`. It merges only the
`credentials` map into the destination home, never prints secrets, and does not
copy Workspace launch preferences, broker accounts, `sealing.key`, or
`provider-keys.json`.

The following cases fail visibly before another backend starts:

- a saved location disappeared, such as an unmounted removable drive;
- the target is a file, unreadable, or not writable;
- the target is inside the current home or contains the current home;
- an environment override fixes `OPENALICE_HOME` or `AQ_LAUNCHER_ROOT`;
- another live writer owns the same physical directory.

Paths are canonicalized after creation/selection, so symlink aliases resolve
to the same physical location. A missing saved location is not silently
re-created as an empty folder. The user must reconnect it, choose another
location, or explicitly use the default.

Workspace creation keeps a small free-space safety margin before bootstrap.
An `ENOSPC` during bootstrap, context injection, git initialization, or
registry persistence returns `insufficient_storage` without registering the
Workspace. Partial directories are removed with bounded retries or renamed as
failed bootstrap quarantine directories when Windows still holds a handle.

## Load-Bearing Code and Verification

- `apps/desktop/src/data-home.ts` — legacy preference parsing and canonicalization
  helpers retained for migration and isolated data-home utilities.
- `apps/desktop/src/data-home-desktop.ts` — explicit invocation-home resolution
  and read-only Settings folder disclosure.
- `packages/cli/src/supervisor-default-migration.ts` — one-time legacy startup
  migration into the client Supervisor Default.
- `apps/desktop/src/main.ts` — Guardian wiring, duplicate-owner choice, safe
  relaunch, and the machine-local preference location.
- `apps/desktop/src/existing-owner-startup.ts` — existing-owner dialog and
  verified loopback browser handoff.
- `packages/guardian-runtime/src/existing-owner-startup.ts` — owner/state/
  endpoint decision table consumed by Electron.
- `apps/desktop/src/data-home-smoke.ts` — real Electron preload and Settings
  rendering assertion for isolated launches.
- `apps/desktop/src/ipc.ts` + `apps/desktop/src/preload.ts` — narrow renderer
  bridge; raw filesystem and Electron APIs never reach the renderer.
- `ui/src/pages/SettingsPage.tsx` — desktop controls and browser/CLI guidance.
- `src/core/ui-layout.ts` — Activity Bar layout document at `data/ui-layout.json`.
- `scripts/guardian/dev-options.ts` — development `--home` parsing.

For changes to this subsystem, run the focused unit/UI specs, Guardian recovery
tests, strict desktop and UI type checks, and an isolated packaged onboarding
or Workspace smoke. Manually verify the initial project chooser, a saved Default,
a missing Default location, and the duplicate-owner “choose another”
path. For healthy foreign `dev` / CLI Server owners, also run
`pnpm electron:smoke:existing-owner` on disposable homes. Never use a real
user home for these checks.
