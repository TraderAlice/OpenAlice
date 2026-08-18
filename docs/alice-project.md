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

A new AliceProject with no Chat Workspace opens Ask Alice on the shared
harness setup page rather than an empty composer; Chat does not pin a Harness
version.

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

The Supervisor TUI create path still registers a Trader-equivalent home.

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
Supervisor root. Its canonical schema is version 2:

```json
{
  "schemaVersion": 2,
  "defaultProject": "research",
  "projects": {
    "research": {
      "name": "research",
      "displayName": "Research",
      "home": "/path/to/research-home"
    }
  }
}
```

The released version-1 `defaultInstance`/`instances` document is accepted only
at this read boundary. The next successful write emits version 2. Deprecated
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
