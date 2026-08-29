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
`workspaces/state/agent-runtime.jsonl` occupancy journal. Both move with the
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

Resolution precedence is:

1. explicit `OPENALICE_HOME` — authoritative and UI-locked;
2. the desktop's saved selection;
3. `~/.openalice`.

On a genuinely fresh install, the native startup prompt offers the default or
another folder. Existing `~/.openalice` users continue without an upgrade
prompt. An old packaged install with legacy data under Electron `userData`
also continues through the existing default relocation path before selection
is introduced.

**Settings → General → Data location** shows the effective root and its source.
The desktop can open the current folder, choose another folder and restart,
reuse a recent folder, or ask which location to use on every startup. If a
healthy development or CLI Server Runtime already owns the selected home,
Electron's primary action is **Open in browser**: it probes the advertised
loopback Web endpoint, opens that page, and quits without taking the lock.
**Choose another data location** remains available when the home is not
environment-locked. Dismissing the dialog keeps the existing AliceProject and
quits the redundant desktop launch. Takeover stays an explicit, destructive
secondary action.
Electron-owned, stale, starting, unhealthy, and incompatible owners keep
tailored recovery dialogs and never receive a misleading browser button.

The launcher preference is machine-local metadata stored at:

```text
<Electron app.getPath("userData")>/openalice-data-home.json
```

It contains only the selected path, up to eight recent paths, and the startup
prompt preference. It contains no account or provider secret. It must stay
outside every selectable home because a home cannot reliably store the pointer
that selects itself.

## Browser, CLI, and Development Flow

The local CLI already exposes the same complete-root boundary:

```bash
openalice start --home ~/.openalice-dev/feature-a
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

Bare `openalice` exposes those separate homes through `i AliceProjects`. The
machine-local Supervisor registry lives outside every complete home. It always
retains the implicit `default`, may register named homes, and remembers the
selected name for the next bare start. Creating or selecting an entry does not
move, copy, stop, or delete another home. Named entries require an explicit
separate Home; equal and nested registered paths are rejected. An inherited
existing target must be empty or recognizable as an OpenAlice home. An
accepted target is created/canonicalized during registration; if that
registered path later disappears, a bare Supervisor launch keeps the entry,
falls back to an available project, and directs the user to `i AliceProjects` to
repair the remembered selection. An explicit environment/flag selection fails
instead of falling back, so automation cannot accidentally target another
Home. The missing path is never silently recreated. An inherited Web port
remains automatic from 47331 so concurrent AliceProjects probe upward, while a
configured port is intentionally pinned. First Alice boot must not write
`data/config/ports.json` merely to materialize that default: a file `web`
value is a pin, so a seeded `3002` (or `47331`) would refuse to move when
another home already holds it. Existing shipped `{ "web": 3002 }` files stay
pins; delete the key or the file to restore probing. `openalice up --port`
and `OPENALICE_WEB_PORT` remain one-run pins and do not rewrite the file.

The machine-wide Supervisor root also owns `machines.json`. This second
registry names SSH Machines for fleet inspection; it does not move with a
complete home and does not belong to the Electron browser profile. The local
Machine is implicit. Stored rows contain only connection metadata (target,
port, display name, and optional local identity-file path), never key bytes or
AliceProject data. `remote-targets.json` beside it remains a hashed,
non-enumerable tunnel-port cache rather than durable fleet identity.

A received AliceProject is registered in this machine-wide registry only after
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

Switching never moves, copies, merges, or deletes current data. The desktop
validates the target, saves the selection, then performs a full Guardian
restart. The newly selected home may be empty or an existing OpenAlice home.
A non-empty unrelated directory requires confirmation.

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

- `apps/desktop/src/data-home.ts` — preference parsing, canonicalization,
  writeability checks, recent paths, and startup policy.
- `apps/desktop/src/data-home-desktop.ts` — native selection dialogs, startup
  resolution, Settings controller, and relaunch requests.
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
or Workspace smoke. Manually verify a fresh startup prompt, a saved recent
location, a missing saved location, and the duplicate-owner “choose another”
path. For healthy foreign `dev` / CLI Server owners, also run
`pnpm electron:smoke:existing-owner` on disposable homes. Never use a real
user home for these checks.
