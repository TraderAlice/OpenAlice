# AliceProject

This guide owns the top-level local-runtime concept, identity, and
concurrency boundary. Guardian recovery mechanics belong to
[[docs/project-structure.md]], machine-level lifecycle commands to
[[docs/cli-supervisor.md]], and the complete-home filesystem contract to
[[docs/data-locations.md]].

## Definition

An **AliceProject** is one independently startable OpenAlice product
runtime: one complete `OPENALICE_HOME`, one Guardian owner tree (Alice
backend, optional UTA, optional Connector), one logical product endpoint,
with many browser windows or one Electron renderer attached. It sits above
`Workspace` (a durable agent context inside one project) and `Session` (one
conversation). Neither a Workspace nor a browser tab owns the backend
process. Ordinary users have one implicit `Default AliceProject`; named
projects are for independently owned contexts (concurrent checkouts,
separate personas, isolated non-trading uses).

The backend is per project because it owns file-backed registries, PTYs,
credentials, runtime locks, and service connections beneath one complete
home; making it a multi-project tenant would weaken the single-writer
invariant. Local concurrency scales by starting another AliceProject, never
by switching a shared backend in place, and opening another project never
stops or mutates the first.

## Identity

Four identity fields plus an immutable product birth:

- `id`: stable `alice-project-…` identifier derived from the canonical
  complete home (or supplied explicitly by the Supervisor);
- `key`: machine-local CLI selector (`default`, `research`, …);
- `displayName`: mutable;
- `home`: canonical complete `OPENALICE_HOME` and ownership boundary;
- `product`: `trader` (default) or `nano`, written once at create. Missing
  stamps are `trader`; an unreadable or malformed stamp blocks startup
  instead of silently enabling the Trader runtime and UTA. Concurrent
  creates are first-writer-wins and registration must agree with the
  recorded product.

NanoAlice is experimental: Guardian never starts UTA for it and its chrome
hides Market, Trading-as-Git, Portfolio, and matching Settings categories.
Product is not a Settings switch — create another AliceProject to change
product.

Named-project creation selects Chat, Auto Quant, and Auto Prediction by
default and records the `workspace-setup.json` birth request without
preparing any Workspace; the backend resolves/creates selected Workspaces
under its writer lease and checkpoints success (never starting an Agent
Session or copying credentials; interrupted attempts reuse the existing
Workspace; failed items stay pending). A prepared Workspace may still need
an Agent or credentials before its first Session — readiness belongs to the
normal launch controls. Users configure providers and Runtimes from ordinary
Settings/Chat surfaces; no full-screen first-run wizard gates the product.

```bash
openalice create alice-project --name office --home ~/.openalice-office --product nano --yes
openalice project use office
openalice project copy-ai-creds --from default --to office --yes
```

`project use` only changes the Supervisor's remembered default. `copy-ai-creds`
is the explicit AI-vault exception: it copies only `credentials` from the
per-home `ai-provider-manager.json`, never prints secrets, and leaves
Workspace launch preferences and broker credentials project-local.

The application/source root is launch metadata, not identity; ports and Web
URLs are live discovery data. Guardian's `instanceId` is one process-tree
ownership run and must never be presented as an AliceProject.
Supervisor-launched children receive `OPENALICE_PROJECT_{ID,KEY,NAME}` and
optionally `OPENALICE_PROJECT_APP_ROOT`; direct dev/Electron launches derive
identity from the complete home. Load-bearing paths:
`packages/guardian-runtime/src/alice-project.ts`,
`packages/cli/src/alice-project.ts` (installer projection),
`packages/cli/src/supervisor-config.ts`, `scripts/guardian/{dev.ts,prod.mjs}`,
`src/webui/routes/alice-project.ts`, `ui/src/hooks/useAliceProject.ts`.

## Persistence and released compatibility

The Supervisor registry lives outside every project home at the platform
Supervisor root. Canonical schema is version 3 (`schemaVersion`,
`defaultTarget: {machine, project}`, `projects: {key: {name, displayName,
home}}`). Released v1/v2 registries migrate once under the Supervisor write
lock (old file preserved as `config.pre-default-target.json`). Deprecated
`--instance`/`OPENALICE_INSTANCE` remain automation aliases; new
integrations use `--project`/`OPENALICE_PROJECT`. The registry never stores
credentials or Workspace state; equal or nested complete homes are rejected;
missing registered homes stay visible and fail without silent replacement
state.

## Lifecycle and discovery

Guardian remains the exclusive writer lease for one project's complete home:
two Guardians for the same project are rejected or require explicit takeover;
two projects with distinct homes run concurrently. Lifecycle actions stay
deliberately separate — **Open** attaches to a verified running endpoint;
**Select** changes the Supervisor default; **Start/Stop** affect only the
selected project's matching owner; **Take over** is explicit recovery.
Selecting or opening project B never stops project A, and the browser never
hot-swaps one React tree between unrelated backend origins. Electron reads
its current project through preload/IPC; browser mode reads the same shape
through authenticated HTTP. Frontend components must consume the project via
`useAliceProject`, never calling the HTTP route or bridge directly.

## Client startup selection

Client startup selects where Alice works before mounting any project-owned
UI. The current machine's Supervisor owns one **Default** Machine/project
pair in `config.json.defaultTarget` (`null` opens the chooser); Desktop,
Web, TUI, and CLI share this authority — there is no independent Recent or
local lifecycle default. Electron opens its client relay shell for a remote
or unresolved Default without locking or starting a local project; explicit
home/project/environment overrides apply only to that invocation.

Restore, reconnect, polling, and inventory never change Default. A
successful user switch saves after health and identity verification (relay
owns the entire operation; persistence failure keeps the connection and
reports that Default was not saved). Create, start, and inspect alone do not
select a project; `project use` is the explicit set-Default operation. The
schema-3 migration examines the old startup pair, Electron selectedHome, and
old local default once (conflicting inputs produce a recoverable chooser
error; unreachable targets preserved; old files remain backups; inventory in
`src/migrations/INDEX.md`).

## Invariants

- one writable complete home has at most one Guardian owner;
- project id does not depend on display name, port, or browser URL;
- a project switch never moves, copies, merges, or deletes state;
- AI vault copy is a separate confirmed command, never bundled with select;
- opening a project never stops another project;
- browser and Electron show the same secret-free identity shape;
- `Workspace` is never renamed or overloaded to mean AliceProject;
- Guardian `instanceId` is process identity, not product hierarchy.
