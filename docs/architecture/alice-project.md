# AliceProject, Data Locations, and Local Runtime

This guide owns the top-level local runtime identity (`AliceProject`), complete-home
filesystem isolation (`OPENALICE_HOME`), client startup selection, and the local
CLI/source runtime provider. Process-tree recovery belongs to
[[docs/project-structure.md]], top-level CLI/TUI commands to
[[docs/cli-supervisor.md]], installation/updates to [[docs/cli-installer.md]],
and Electron packaging to [[docs/managed-workspace-runtime.md]].

---

## 1. AliceProject Identity and Topology

An **AliceProject** is one independently startable OpenAlice runtime:

```text
AliceProject
├── one complete OPENALICE_HOME
├── one Guardian owner tree (Alice backend + optional UTA + optional Connector)
├── one logical product endpoint
└── many browser windows or one Electron renderer attached
```

`AliceProject` sits above `Workspace` (a durable agent context inside one
project) and `Session` (one conversation). Neither a Workspace nor a browser tab
owns the backend process. Because the backend owns file-backed registries,
Workspace PTYs, credentials, runtime locks, and local service connections
beneath one complete home, local concurrency scales by starting another
AliceProject with a separate home—never by turning one backend into a
multi-project tenant or switching a shared backend in place.

### Identity fields and product birth

- `id`: stable `alice-project-…` identifier derived from the canonical complete
  home (or supplied explicitly by the Supervisor).
- `key`: machine-local CLI selector (`default`, `research`, …).
- `displayName`: mutable human-facing name.
- `home`: canonical complete `OPENALICE_HOME` and single-writer boundary.
- `product`: `trader` (TraderAlice, default) or `nano` (NanoAlice), written once
  at creation to `<OPENALICE_HOME>/data/config/alice-project.json`. Missing
  stamps default to `trader`; an unreadable or malformed stamp blocks startup
  rather than silently starting UTA.

NanoAlice never starts UTA and hides trading-specific chrome (Market, Trading as
Git, Portfolio, and matching Settings categories). Product is immutable after
creation—create another AliceProject to use a different product.

Named-project creation records a `workspace-setup.json` birth request (Chat,
AutoQuant, Auto Prediction by default) and prepares the selected Workspaces
asynchronously after the app shell opens under the backend's writer lease. It
never starts an Agent Session or copies credentials.

```bash
openalice create alice-project --name office --home ~/.openalice-office --product nano --yes
openalice project use office
openalice project copy-ai-creds --from default --to office --yes
```

`project use` only updates the Supervisor's remembered default. `copy-ai-creds`
is the explicit exception for AI credentials: it merges only the `credentials`
map of `<home>/data/config/ai-provider-manager.json` into the destination home,
never prints secrets, and never copies Workspace launch preferences, broker
accounts, `sealing.key`, or `provider-keys.json`.

### Lifecycle and discovery invariants

- One writable complete home has at most one Guardian owner.
- Project `id` never depends on display name, port, or browser URL; Guardian
  `instanceId` is process-tree run identity, not product hierarchy.
- **Open** attaches a window to a verified running endpoint; **Select** changes
  the Supervisor default; **Start/Stop** affect only the selected project's
  matching owner; **Take over** (`--takeover`) is explicit recovery for the same
  home, never concurrency.
- Selecting or opening project B never stops, moves, copies, merges, or deletes
  project A.
- Electron reads its current project via preload/IPC; browser mode reads the
  same secret-free shape through authenticated HTTP. Frontend components must
  consume project identity through `useAliceProject`.

---

## 2. Complete Home (`OPENALICE_HOME`) and Data Locations

A selectable **data location** is the complete `OPENALICE_HOME`, never only its
`data/` subdirectory or Electron's browser profile:

```text
<OPENALICE_HOME>/
├── data/                 portable configuration, sessions, trading, inbox, office, cron, news
├── workspaces/           Workspace repositories, departed archives, and launcher state
├── state/                Guardian and runtime ownership locks
├── runtime/              optional Broker Packs
├── provider-keys.json    AI provider credentials (unless OPENALICE_GLOBAL_DIR overrides)
└── sealing.key           machine-bound encryption key (deliberately outside data/)
```

Two AliceProjects run concurrently when they use distinct complete homes and
unpinned ports. Default Web ports probe upward from `47331`; first boot must not
write `data/config/ports.json` merely to materialize the default, because a file
`web` entry is a hard pin. `openalice up --port` and `OPENALICE_WEB_PORT` are
one-run pins and do not rewrite the file.

### Launcher and Workspace state boundaries

- `workspaces/state/` holds `agent-conversations.jsonl` (sensitive prompt/reply
  stream), `agent-runtime.jsonl` (occupancy/activity journal without prompt
  bodies), `session-executions.json` (secret-free process lifecycle ledger), and
  `resume-identities.json` (product-to-native Session ID ledger).
- `openalice project transfer` excludes those runtime journals, resume
  identities, headless logs, locks, ports, auth, and `sealing.key`; it transfers
  portable `data/` and Workspace repositories, rebases paths, re-seals
  credentials with a fresh remote key, and reports zero imported resumable
  Sessions.
- Each Workspace stores secret-free launch preferences in `.alice/settings.json`
  and per-Session bindings/nametags in `.alice/sessions/<resumeId>.json`
  (Workspace Manager bindings live under
  `workspaces/state/workspace-manager-sessions/` instead of the floor root).
  Vault secrets stay in the complete home and never travel with a copied
  Workspace repo.
- `data/inbox/routine-follow-ups.json` (Office decision queue and immutable
  receipt ledger) and `data/office/day.json` (server-local shift and admission
  ledger) are presentation/workflow sidecars. Malformed state in either file
  fails closed on its Office API without discarding the file or blocking other
  Alice surfaces.

---

## 3. Supervisor Registry and Client Startup Selection

The machine-local Supervisor root lives outside every project home and owns:

1. `config.json` (schemaVersion 3): `defaultTarget: { machine, project }` plus
   registered local `projects`. Equal or nested homes are rejected; missing
   registered homes remain visible and fail closed instead of silently recreating
   an empty folder or falling back to `~/.openalice`.
2. `machines.json` (schemaVersion 1): saved SSH Machine profiles (`id`,
   `displayName`, `sshTarget`, `enabled`, optional `sshPort` and local
   `identityFile` path—never key bytes or project data). `remote-targets.json`
   beside it is a hashed tunnel-port cache only.

Client startup (Desktop, Web, TUI, and CLI) uses `config.json.defaultTarget` as
its single authority. A `null`, unavailable, or ambiguous migrated Default opens
the Machine/AliceProject chooser before mounting any project-owned UI or
acquiring a local lock. Restore, reconnect, polling, create, start, and inspect
never mutate Default; only a verified user switch or explicit `project use`
updates it. When `--project`, `--home`, `OPENALICE_PROJECT`, or `OPENALICE_HOME`
override the target for one invocation, TUI project selection is read-only.

---

## 4. Local Runtime Provider and Process Architecture

The installed CLI is a target-specific Bun executable that re-enters its own
bytes under internal roles to run Guardian, Alice, optional UTA, and optional
Connector as separate processes. Immutable assets (`ui/dist`, `default/`,
templates, adapter/CLI helpers) resolve from `share/openalice/` and are covered
by the release `contentIdentity`. The installed CLI requires working system
Git/Bash (`dependencyPolicy: "system"`) and needs no host Node, Bun, or npm.

- **Source development**: `pnpm dev` runs the local Web relay in front of Vite
  (`pnpm dev -- --home ~/.openalice-dev/<feature>` for concurrent worktrees).
  `--app-dir` or `OPENALICE_APP_HOME` explicitly selects a source checkout;
  installed startup never clones source or installs dependencies.
- **External Agent Runtimes**: Pi, OpenCode, Codex, Claude Code, Agy, Grok, and
  OMP remain user-owned external executables in CLI mode. The CLI strips
  Electron-only managed-Pi variables while preserving user `PI_*` settings.
- **PTY flow control**: Each Session owns an independent child process and PTY.
  Under output pressure, the POSIX Bun PTY backend pauses/resumes the child
  process group at the kernel boundary (resuming before graceful shutdown);
  Windows ConPTY detaches an over-watermark WebSocket consumer with retryable
  close code `1013` while retaining the agent and replay buffer.
- **Linux PID liveness**: Guardian parses `/proc/<pid>/stat` after the final `)`
  of the command name; a zombie thread-group leader (`Z`) proves exit only when
  a single thread remains.

---

## 5. Load-Bearing Paths and Verification

- `packages/guardian-runtime/src/alice-project.ts` &
  `packages/cli/src/alice-project.ts` — canonical identity and environment hash.
- `packages/cli/src/supervisor-config.ts` &
  `supervisor-default-migration.ts` — machine registry and schema-3 migration.
- `apps/desktop/src/main.ts`, `data-home-desktop.ts`,
  `existing-owner-startup.ts` — desktop home resolution, lock handoff, and
  narrow IPC bridge.
- `src/webui/routes/alice-project.ts` & `ui/src/hooks/useAliceProject.ts` —
  secret-free identity endpoint and renderer hook.

Verify changes with focused unit/UI specs, Guardian recovery tests, strict root/
desktop/UI typechecks, and an isolated onboarding or existing-owner smoke
(`pnpm electron:smoke:existing-owner` on disposable homes, never a real user
home).
