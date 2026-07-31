# Data Locations and Concurrent Instances

This guide owns OpenAlice data-location selection, desktop launcher
preferences, and the isolation contract for concurrent local instances.
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

Two OpenAlice instances may run concurrently when they use different complete
homes and unpinned ports. Two writers must never share one home. Default ports
probe upward independently, while explicitly pinned ports still fail if they
collide.

Workspace launcher state includes the private
`workspaces/state/agent-conversations.jsonl` prompt/reply event stream. It moves
with the complete home, is not part of any Workspace repository, and should be
treated as sensitive conversation history when backing up or sharing a home.

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
reuse a recent folder, or ask which location to use on every startup. If an
already-running instance owns the selected home, the recovery dialog offers a
third path: choose another data location without stopping the existing owner.

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

Bare `openalice` exposes those separate homes through `i Instances`. The
machine-local Supervisor registry lives outside every complete home. It always
retains the implicit `default`, may register named homes, and remembers the
selected name for the next bare start. Creating or selecting an entry does not
move, copy, stop, or delete another home. Named entries require an explicit
separate Home; equal and nested registered paths are rejected. An inherited
existing target must be empty or recognizable as an OpenAlice home. An
accepted target is created/canonicalized during registration; if that
registered path later disappears, a bare Supervisor launch keeps the entry,
falls back to an available instance, and directs the user to `i Instances` to
repair the remembered selection. An explicit environment/flag selection fails
instead of falling back, so automation cannot accidentally target another
Home. The missing path is never silently recreated. An inherited Web port
remains automatic from 47331 so concurrent instances probe upward, while a
configured port is intentionally pinned.

`OPENALICE_INSTANCE`, `OPENALICE_HOME`, `--instance`, and `--home` remain
higher-priority one-run/automation inputs. When they fix the selected instance
or Home, the TUI explains that instance selection is read-only rather than
persisting a choice that cannot affect the current process.

## Switching and Failure Safety

Switching never moves, copies, merges, or deletes current data. The desktop
validates the target, saves the selection, then performs a full Guardian
restart. The newly selected home may be empty or an existing OpenAlice home.
A non-empty unrelated directory requires confirmation.

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
- `apps/desktop/src/data-home-smoke.ts` — real Electron preload and Settings
  rendering assertion for isolated launches.
- `apps/desktop/src/ipc.ts` + `apps/desktop/src/preload.ts` — narrow renderer
  bridge; raw filesystem and Electron APIs never reach the renderer.
- `ui/src/pages/SettingsPage.tsx` — desktop controls and browser/CLI guidance.
- `scripts/guardian/dev-options.ts` — development `--home` parsing.

For changes to this subsystem, run the focused unit/UI specs, Guardian recovery
tests, strict desktop and UI type checks, and an isolated packaged onboarding
or Workspace smoke. Manually verify a fresh startup prompt, a saved recent
location, a missing saved location, and the duplicate-owner “choose another”
path. Never use a real user home for these checks.
