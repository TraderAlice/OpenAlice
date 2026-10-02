# AliceProject

This guide owns the top-level local-runtime concept, identity, and concurrency
boundary. Guardian recovery mechanics belong to [[docs/project-structure.md]],
machine-level lifecycle commands belong to [[docs/cli-supervisor.md]], and the
complete-home filesystem contract belongs to [[docs/data-locations.md]].

## Definition

An **AliceProject** is one independently startable OpenAlice product runtime:

```text
AliceProject
├── one complete OPENALICE_HOME
├── one Guardian owner tree
│   ├── one Alice backend
│   ├── optional UTA
│   └── optional Connector Service
├── one logical product endpoint
└── many browser windows or one Electron renderer may attach
```

`AliceProject` is above `Workspace`. A Workspace is a durable agent context
inside one AliceProject; a Session is one conversation inside a Workspace.
Neither a Workspace nor a browser tab owns the backend process.

The ordinary user has one implicit `Default AliceProject`. Named projects are
for independently owned contexts such as concurrent source checkouts, separate
companies or personas, or non-trading uses that must not share state and
failure domains.

## Why the backend is per project

The Alice backend owns file-backed registries, Workspace PTYs, credentials,
runtime locks, and local service connections beneath one complete home.
Turning that process into a multi-project tenant would make every state path,
cache, socket, and write lease project-aware while weakening the existing
single-writer invariant.

OpenAlice therefore scales local concurrency by starting another AliceProject,
not by switching a shared backend in place. A project's own frontend attaches
to its backend. Opening another project does not stop or mutate the first one.

## Identity

An AliceProject has four identity fields plus an immutable product birth:

- `id`: stable `alice-project-…` identifier derived from the canonical complete
  home, unless the Supervisor supplies an explicit stable id;
- `key`: machine-local CLI selector such as `default` or `research`;
- `displayName`: mutable human-facing name;
- `home`: canonical complete `OPENALICE_HOME` and ownership boundary;
- `product`: `trader` (TraderAlice, default) or `nano` (NanoAlice). Written
  once at create time. Missing stamps are `trader`.

An existing unreadable or malformed product stamp blocks startup instead of
silently enabling the Trader runtime and UTA. Concurrent create attempts are
first-writer-wins and registration must agree with that recorded product.

TraderAlice is the trading product (Lite/Pro remain intensity inside it).
NanoAlice is an experimental general-purpose product: Guardian never starts
UTA for that complete home. Product is not a Settings switch; create another
AliceProject to use a different product. The Nano chrome hides Market
(including the News feed nested under it), Trading as Git, and Portfolio,
plus the matching Settings categories
(Trading, Market Data, News Sources). Bookmarks to those routes return to
Ask Alice or Settings. AutoQuant and Tracked stay visible until that
boundary is reviewed separately.

Named AliceProject creation selects Chat, Auto Quant, and Auto Prediction by
default. The TUI Foundry reviews all three before Create & start. Creation records the request
without preparing any Workspace. After the app shell opens, it activates the
default Workspace setup asynchronously; Workspace pages show the pending state
while the rest of the app remains usable. Existing projects with a missing
canonical default are prepared by the same post-open lifecycle.

The CLI and TUI share the same registration and `workspace-setup.json` birth
request. Under its writer lease, the backend resolves or creates each selected
Workspace and saves the canonical Harness default before checkpointing success.
It never starts an Agent Session or copies credentials. An interrupted attempt
reuses the existing Workspace. Failed items remain pending, while successful
items are not recreated. Quick Start reports remaining setup and offers Retry;
the existing per-Harness setup page still supports deferred/legacy projects.
A missing request leaves older homes unchanged. Chat does not pin a Harness version.

A prepared Workspace may still need an Agent or credentials before its first
Session; the normal launch controls own that readiness, independently of setup.
Users configure AI providers and Agent Runtimes from the ordinary Settings and
Chat surfaces; no full-screen first-run wizard gates the product. Saving a
compatible provider binds it to an unconfigured Chat's interactive defaults;
existing runtime choices and headless defaults are preserved. Packaged
fresh-user smoke uses isolated Pi state and the same Chat birth request. It
first verifies the renderer is available, then waits for Chat's asynchronous
preparation and checks Agent readiness; other default Workspaces do not gate
Chat startup.

Create a named project from the CLI:

```bash
openalice create alice-project
openalice create alice-project --name office --home ~/.openalice-office --product nano --yes
openalice project list
openalice project use office
openalice project copy-ai-creds --from default --to office --yes
```

`project use` only changes the Supervisor's remembered default. It does not
stop a running project or move state. `copy-ai-creds` is the explicit exception
for AI credential rows: it copies only `credentials` from the per-home
`ai-provider-manager.json`, writes into the destination home, and never prints
secrets. Workspace launch preferences and broker credentials stay project-local.

The Supervisor TUI create path registers a Trader-equivalent home.

For isolated first-run verification, use
`OPENALICE_ONBOARDING_WORKSPACES=chat pnpm dev:onboarding`. Omit the variable
to exercise the legacy/deferred setup page. `none` explicitly skips preparation.

The application/source root is launch metadata, not identity. Ports and Web
URLs are live discovery data and may change between launches. Guardian's
`instanceId` remains a separate identifier for one process-tree ownership run;
it must never be presented as an AliceProject.

Supervisor-launched children receive `OPENALICE_PROJECT_ID`,
`OPENALICE_PROJECT_KEY`, `OPENALICE_PROJECT_NAME`, and optionally
`OPENALICE_PROJECT_APP_ROOT`. Direct development and Electron launches derive
the same identity from their complete home when explicit metadata is absent.

Load-bearing paths:

- `packages/guardian-runtime/src/alice-project.ts` — canonical identity and
  child environment contract;
- `packages/cli/src/alice-project.ts` — standalone installer projection of the
  same versioned hash/environment contract;
- `packages/cli/src/supervisor-config.ts` — machine-level project registry;
- `scripts/guardian/dev.ts` and `scripts/guardian/prod.mjs` — runtime discovery
  projection;
- `src/webui/routes/alice-project.ts` — secret-free Web identity endpoint;
- `ui/src/hooks/useAliceProject.ts` — browser/Electron domain read boundary.

## Persistence and released compatibility

The Supervisor registry lives outside every project home at the platform
Supervisor root. Its canonical schema is version 3:

```json
{
  "schemaVersion": 3,
  "defaultTarget": { "machine": "local", "project": "research" },
  "projects": {
    "research": {
      "name": "research",
      "displayName": "Research",
      "home": "/path/to/research-home"
    }
  }
}
```

Released version-1 and version-2 registries migrate once to version 3 under
the Supervisor write lock. The old registry is preserved as
`config.pre-default-target.json`. Deprecated
`--instance` and `OPENALICE_INSTANCE` inputs remain CLI/environment aliases for
released automation; current product copy and new integrations use
`--project` and `OPENALICE_PROJECT`.

The registry never stores credentials or Workspace state. Equal or nested
complete homes are rejected. Missing registered homes remain visible and fail
without silently creating replacement state.

## Lifecycle and discovery

Guardian remains the exclusive writer lease for one project's complete home.
Two Guardians for the same project are rejected or require explicit takeover;
two projects with distinct homes may run concurrently. The runtime status
envelope publishes its owning AliceProject alongside owner, components,
provider, and endpoints.

Lifecycle actions are deliberately separate:

- **Open** attaches a window to a verified running endpoint;
- **Select** changes the Supervisor's target/default for subsequent actions;
- **Start** launches only the selected AliceProject;
- **Stop** stops only its matching Guardian owner;
- **Take over** is explicit recovery for the same complete home.

Selecting or opening project B never implicitly stops project A. The browser
does not hot-swap one React tree between unrelated backend origins. Electron's
`app://` renderer reads its current project through preload/IPC; browser mode
reads the same shape through authenticated HTTP.

## Display contract

The renderer identifies the current AliceProject in Settings > General without
turning this low-frequency boundary into primary Workspace navigation. The
About OpenAlice area shows the project name, health, stable id, home, and
application root alongside the current installation identity. Paths wrap inside
their own fields and are not used as the main label.

Frontend components must consume the project through `useAliceProject`; they
must not call the HTTP route or Electron bridge directly. The hook owns
loading, error, retry, and transport selection and has unit coverage.

## Invariants

- one writable complete home has at most one Guardian owner;
- project id does not depend on display name, port, or browser URL;
- a project switch never moves, copies, merges, or deletes state;
- AI vault copy is a separate, confirmed command and never travels with select;
- opening a project never stops another project;
- browser and Electron show the same secret-free identity shape;
- `Workspace` is never renamed or overloaded to mean AliceProject;
- Guardian `instanceId` is process identity, not product hierarchy.

## Client startup selection

The legacy language/AI/broker first-run wizard is retired. Client startup now
selects where Alice works before mounting any project-owned UI. The two-column
Machine / AliceProject launcher can add SSH machines, review their preparation,
create projects in new or empty folders, and start stopped projects without
implicit takeover. Workspace preparation remains asynchronous after app entry.

The current machine's Supervisor owns one **Default** Machine/AliceProject pair
in `config.json.defaultTarget`. `null` opens the chooser. Desktop, Web, TUI and
CLI use this same authority. There is no independent Recent or local lifecycle
default. Electron opens its client relay shell for a remote or unresolved
Default without locking or starting a local project. A selected local project
retains native IPC; an already running CLI backend attaches through the relay.
Explicit home/project/environment overrides apply only to that invocation.

Restore, reconnect, polling and inventory never change Default. A successful
user switch saves after health and identity verification; Desktop also waits
for replacement navigation. Relay owns this entire selection operation: Desktop
supplies its presentation callback instead of saving a second time after
`connect`. The generation remains switching until presentation and persistence
finish. Renderers ignore intermediate generations, then older tabs reload once;
a replacement renderer refreshes Default after completion without navigating
again. Browser connect responses do not issue a second navigation alongside the
generation observer. Cancel, close and superseding requests invalidate late
completion. Persistence failure keeps the connection and reports that
Default was not saved. Create, start and inspect alone do not select a project.
`project use` is the explicit set-Default compatibility operation.

The Supervisor migration examines the old startup pair, mapped Electron
selectedHome, and old explicit local default. Consistent inputs are retained;
conflicting, corrupt or unmapped choices produce a recoverable chooser error.
Unreachable targets are preserved. Schema 3, including null, never rereads old
files. The old files remain backups; no project data moves or deletion occur.
An unmapped legacy home can be explicitly registered with the CLI before it
is selected. The migration runs at the client root, independently of backend
project journals; its inventory is in [[src/migrations/INDEX.md]].

The launcher uses a two-column selector at desktop width and Machine → project
drill-in on narrow screens. Back stays inside the same shell; header and footer
stay fixed inside the viewport. The chooser fills the remaining height; only
long Machine/project lists scroll within their columns. Forms/reviews have a
separate bounded scroller for small windows or an on-screen keyboard. Async
checks show indeterminate loading or the controller's real stage rather than
invented percentages. The
shared `useMachineControls` and `useRelayConnection` hooks consume client control
APIs; project-owned UI mounts only after attachment. No project file/PT Y IPC
is exposed from the detached Electron shell.
