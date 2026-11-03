# Data Locations and Concurrent AliceProjects

This guide owns OpenAlice data-location selection, desktop launcher
preferences, and the isolation contract for concurrent local AliceProjects.
Runtime lock recovery belongs to `packages/guardian-runtime/`; persistent
state layout to [[docs/project-structure.md]].

## One Complete Home

A selectable **data location** is the complete `OPENALICE_HOME`, not only
its `data/` child and not Electron's browser-profile directory:

```text
<OPENALICE_HOME>/
├── data/                 product configuration and portable user data
├── workspaces/           Workspace repositories, Sessions, and task state
├── state/                Guardian and runtime ownership locks
├── runtime/              optional Broker Packs
├── provider-keys.json    AI provider credentials, unless globally overridden
└── sealing.key           machine-bound encryption key
```

Two AliceProjects may run concurrently with different complete homes and
unpinned ports; two writers must never share one home. Default ports probe
upward independently; explicitly pinned ports fail on collision. Note the
port pin rule: first Alice boot must not write `data/config/ports.json` — a
file `web` value is a pin, so existing shipped `{ "web": 3002 }` files stay
pins (delete the key/file to restore probing); `openalice up --port` and
`OPENALICE_WEB_PORT` are one-run pins and never rewrite the file.

Launcher-owned state under `workspaces/state/`:
`agent-conversations.jsonl` (prompt/reply stream — sensitive history when
backing up or sharing a home), `agent-runtime.jsonl` (occupancy journal, no
prompt bodies), `session-executions.json` (secret-free process lifecycle
ledger), and `resume-identities.json` (product-to-native Session identity
ledger only). `openalice project transfer` deliberately excludes the
journals, resume identities, headless tasks/logs, Runtime state, ports, auth,
and untracked Session dossiers; it preserves portable data and Workspace
repositories, rebases absolute paths, and reports zero imported resumable
Sessions.

Per-Workspace facts:

- `.alice/settings.json` — versioned, secret-free record of recent
  interactive/headless runtime choices (may contain vault credential slugs,
  model ids, effort; never provider keys or resolved endpoints). Referenced
  secrets stay under the complete home and do not travel with a repository
  copy.
- `.alice/sessions/<resumeId>.json` — secret-free Session dossier: the
  frozen Agent runtime + credential reference/model/effort and optional
  `displayName` coworker nametag. Copying a Workspace carries launch
  semantics and names, never the vault secret. The Workspace Manager is the
  exception: its files live under
  `workspaces/state/workspace-manager-sessions/` instead of `.alice/` at the
  floor root.
- `data/ui-layout.json` — Activity Bar layout (user chrome, travels with the
  home; missing/malformed equals the default document).
- `data/inbox/routine-follow-ups.json` — Office decision queue and immutable
  receipt ledger (version 2). Saving a decision atomically removes the exact
  active row and appends a receipt bound to the pre-observed per-entry
  revision; `evidence-unavailable` requires successful authority reads;
  receipts are never silently pruned (identical retries stay idempotent);
  the ledger never owns Issue status or scheduling and writing it dispatches
  no Agent. Malformed state fails closed (Office API errors; other surfaces
  keep serving) rather than being discarded.
- `data/office/day.json` — Office Day sidecar: one server-local calendar
  day, current shift (≤ 4 duty keys), and an append-only admission ledger
  (capped 1,024 keys) preventing a stale renderer from reopening an older
  evidence version. Presentation/workflow state only; malformed state fails
  closed the same way.

`AQ_LAUNCHER_ROOT` and `OPENALICE_GLOBAL_DIR` are advanced split-root
overrides; a fixed `AQ_LAUNCHER_ROOT` disables desktop home switching
(sharing Workspace files and locks would remain), and provider keys under
`OPENALICE_GLOBAL_DIR` stay shared by design.

## Desktop and client flow

The packaged app resolves a home before acquiring any Guardian lock,
relocating data, reading ports, running migrations, or starting children.
Selection uses the same client Supervisor `config.json.defaultTarget` as
Web/TUI/CLI; explicit `OPENALICE_HOME` is an invocation override; a null,
unavailable, or ambiguous Default opens the chooser — never a silent
`~/.openalice`. The old `<Electron userData>/openalice-data-home.json` is
migration input only (selectedHome must map to a registered project;
conflicts require explicit selection; the old file stays as backup; nothing
is moved or deleted). See [[docs/alice-project.md]] for save/cancel
semantics.

`--home` takes precedence over `OPENALICE_HOME` in `openalice run --home …`
and `pnpm dev -- --home …`; keep development homes outside the repository.
`--takeover` is the only development/CLI operation that may stop an owner of
the same home — takeover is recovery, not concurrency. The machine-local
Supervisor registry lives outside every complete home; creating an entry
never selects it or moves/copies/stops/deletes another home; equal and
nested registered paths are rejected. A remembered home that disappears
stays registered with a visible error — never attach to another project,
silently recreate the path, or override an explicit environment/flag
selection.

The Supervisor root also owns `machines.json` (schema 1): SSH Machine
profiles keyed by an internal handle with opaque `id`, `displayName`,
`sshTarget`, `enabled`, optional integer `sshPort` (1–65535) and absolute
local `identityFile` — never key bytes or AliceProject data. Public
`machine list --json` output is an array (`id`, `label`, `target`,
`enabled`, nullable `sshPort`) and must not be written back as the registry.
Labels are unique and never `local` or a profile id; selectors resolve id →
label → internal key; unknown fields survive writes. Beside it,
`remote-targets.json` is a hashed, non-enumerable tunnel-port cache, not
fleet identity. A received AliceProject registers in `config.json` (never
`machines.json`) only after its staging Home passes validation and atomic
publish; registration does not select it as default, and the new Home owns a
new `sealing.key`.

`OPENALICE_INSTANCE`/`--instance` remain deprecated automation aliases; when
`OPENALICE_PROJECT`/`OPENALICE_HOME`/`--project`/`--home` fix the
selection, the TUI presents AliceProject selection read-only rather than
persisting a choice that cannot affect the current process.

## Switching and failure safety

Selection never moves, copies, merges, or deletes project data. Explicit
create may prepare a new or empty home and rejects an unrelated non-empty
directory. Verify the target and successful presentation before remembering
the shared Default; a failed switch preserves the old connection and
Default. `openalice project copy-ai-creds` is the explicit AI-credential
exception (merges only the `credentials` map of
`<home>/data/config/ai-provider-manager.json`, never prints secrets, never
copies launch preferences, broker accounts, `sealing.key`, or
`provider-keys.json`).

These fail visibly before another backend starts: a saved location
disappeared; the target is a file/unreadable/not writable; the target is
inside or contains the current home; an environment override fixes
`OPENALICE_HOME`/`AQ_LAUNCHER_ROOT`; another live writer owns the same
physical directory. Paths are canonicalized after selection (symlink
aliases resolve to the same location), and a missing saved location is
never silently recreated. Workspace creation keeps a free-space safety
margin; `ENOSPC` during bootstrap returns `insufficient_storage` without
registering, removing partial directories (bounded retries) or quarantining
them when Windows still holds a handle.

## Load-bearing code and verification

- `apps/desktop/src/data-home{,-desktop}.ts` — legacy preference migration
  and invocation-home resolution/Settings disclosure.
- `packages/cli/src/supervisor-default-migration.ts` — one-time legacy
  startup migration into the client Supervisor Default.
- `apps/desktop/src/main.ts`, `existing-owner-startup.ts`,
  `packages/guardian-runtime/src/existing-owner-startup.ts` — Guardian
  wiring, duplicate-owner choice, safe relaunch, browser handoff.
- `apps/desktop/src/data-home-smoke.ts`, `ipc.ts`, `preload.ts` — real
  preload assertion and the narrow renderer bridge (raw filesystem/Electron
  APIs never reach the renderer).
- `ui/src/pages/SettingsPage.tsx`, `src/core/ui-layout.ts`,
  `scripts/guardian/dev-options.ts`.

Run the focused unit/UI specs, Guardian recovery tests, strict desktop and
UI type checks, and an isolated packaged onboarding or Workspace smoke.
Manually verify the initial chooser, a saved Default, a missing Default
location, and the duplicate-owner path; for healthy foreign dev/CLI owners
also run `pnpm electron:smoke:existing-owner` on disposable homes. Never
use a real user home for these checks.
