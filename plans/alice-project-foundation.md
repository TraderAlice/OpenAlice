# AliceProject Foundation

Status: completed (accepted and delivered in PR #1063)

Owner guides: [[docs/alice-project.md]], [[docs/project-structure.md]], [[docs/cli-supervisor.md]],
[[docs/data-locations.md]], [[docs/local-runtime.md]],
[[docs/managed-workspace-runtime.md]]

## Objective

Turn the existing named Instance, complete-home, Guardian ownership, and
frontend endpoint topology into one explicit product concept: an
`AliceProject`. One AliceProject is one independently startable, discoverable,
openable, and stoppable OpenAlice runtime. It owns one complete
`OPENALICE_HOME`, one Guardian tree, one Alice backend, and one logical frontend
endpoint; any number of browser windows may attach to that endpoint.

The machine-level Supervisor manages AliceProjects. It must not become a shared
business backend, proxy Workspace state, or weaken the one-writer-per-home
boundary.

## Design alternatives

### A. One shared backend with project tenants

This would make switching cheap inside one origin, but it would move locks,
credentials, Workspace registries, process supervision, and failures into one
multi-tenant process. It does not solve development checkouts fighting each
other and contradicts the existing complete-home ownership boundary.

### B. Stable shared frontend that hot-switches between project backends

This preserves separate backends, but makes every frontend domain hook,
transport, cache, tab store, and reconnect path project-aware. A stale request
could cross the active-project boundary. It also creates a central frontend
whose lifecycle is unclear when every project backend is stopped.

### C. Supervisor-managed independent AliceProjects (chosen)

Keep the proven topology: one home, Guardian, backend, and logical frontend per
project. Promote the existing CLI Instance registry into an AliceProject
registry, include project identity in Guardian discovery, and make project
identity/status visible in CLI and desktop/product UI. Opening or switching a
project means opening its own endpoint; stopping remains a separate explicit
operation.

This is the smallest architecture that permits true concurrent development,
isolates failure and persisted state, and matches normal single-project use.

## Product and interaction contract

- `AliceProject` is the user-facing name. `Workspace` remains the durable work
  container inside an AliceProject. `Session` remains an agent conversation.
- The persisted project identity is stable and is not derived from a mutable
  display name or port.
- A project binds a complete home and, when source-backed, an application/source
  root. Distinct projects may not share a writable complete home.
- A running project exposes its live Guardian owner, health, components, source,
  and frontend endpoint through runtime discovery.
- `Open`, `Switch current window`, and `Stop` are distinct actions. Opening B
  never implicitly stops A.
- The current AliceProject identity is available in the top-level About area of
  Settings > General, next to the installation and runtime identity. Detailed
  ownership and lifecycle controls remain the responsibility of a future
  project manager/dialog rather than persistent navigation chrome.
- Browser windows attach to the selected project's own origin. Electron app
  mode remains `app://` and exposes the current project through its preload
  bridge; it does not silently fall back to localhost.
- Narrow layouts stack installation and project identity without clipping.
  Paths wrap inside their own fields; controls remain keyboard accessible with
  explicit labels and focus behavior.

## Persistence and compatibility

The existing Supervisor `config.json` Instance map shipped in the 0.88 and
0.89 release lines, so it is a real compatibility boundary rather than an
unreleased precursor. This change introduces a canonical AliceProject domain
model and project IDs while accepting the released `instances` document only
at the config read boundary. The next successful write emits the canonical
project shape. Product code, protocols, tests, and new copy do not retain
Instance as a synonym; deprecated `--instance` and `OPENALICE_INSTANCE` inputs
remain boundary aliases for released automation.

No user-state startup migration or dual business-state store is introduced.
The machine Supervisor registry remains outside every `OPENALICE_HOME`; runtime
status remains derived from the Guardian that owns that home.

## Ordered work

- [x] Add the canonical AliceProject schema, stable identity, registry API, and
  focused unit coverage in the CLI Supervisor package.
- [x] Project AliceProject identity into resolved launch context and Guardian
  runtime status without changing lock ownership semantics.
- [x] Rename CLI flags, TUI labels, status output, and commands to AliceProject,
  retaining deprecated `--instance` parsing only at the CLI boundary.
- [x] Expose the active AliceProject through Alice HTTP/runtime metadata and the
  Electron preload bridge using domain hooks in the renderer.
- [x] Add a quiet current-project identity and a responsive project manager on
  the real product surface using shared shadcn/Base UI primitives.
- [x] Align Electron data-location startup language and handoff behavior with
  AliceProject while preserving complete-home recovery and app-mode transport.
- [x] Reframe Settings around explicit General, Appearance, and Tools
  categories: General owns installation/AliceProject identity and local runtime
  settings, while visual preferences and tool policy have dedicated routes.
- [x] Retire the installation-wide Persona editor and `/api/persona` transport;
  freeze Alice's current baseline identity into the Chat template instruction
  that is durably copied into each new Workspace.
- [x] Update owner guides and public CLI help where the old Instance term is no
  longer accurate.
- [x] Complete typecheck, unit, Guardian recovery, browser, Electron PTY, and
  disposable packaged verification appropriate to the touched surfaces.
- [x] Publish one autonomous-topic Draft PR to `dev` with the required workflow,
  theme, area, and deep-review labels. Accepted and merged as PR #1063 on
  2026-08-12.

## Verification matrix

### Domain and config

- Legacy Instance config reads as canonical AliceProjects with stable IDs.
- Canonical writes contain no ambiguous Instance product fields.
- Duplicate/overlapping homes remain rejected.
- A missing project home is diagnostic and does not create a replacement.

### Runtime and Guardian

- Runtime status reports the owning AliceProject ID/name/home/source/endpoint.
- Two Guardians for one project remain blocked.
- Two projects with distinct homes may run concurrently.
- Open/switch does not stop the previous project; explicit stop affects only the
  selected project and never removes a live foreign owner lock.

### UI and Electron

- The active project is visible in browser and Electron without exposing
  secrets or requiring Workspace data to load first.
- Project management works at desktop and narrow widths with keyboard and focus
  behavior intact.
- Browser attaches through the project's HTTP origin; Electron continues
  through the preload/IPC bridge and reports app-mode identity.
- A running dev/CLI project can be opened in its verified browser endpoint from
  Electron without takeover.

### Commands

```bash
npx tsc --noEmit
cd ui && npx tsc -b
npx tsc -p apps/desktop/tsconfig.json --noEmit
pnpm test
pnpm test:guardian-recovery
pnpm electron:smoke:pty
pnpm electron:smoke:workspace
```

The real `pnpm dev` route is inspected in the browser. Guardian and Electron
smokes use disposable homes and launcher roots only.

## Completion criteria

AliceProject is the sole current product term for the top-level runtime unit;
its stable identity and live status survive restart and are visible across CLI,
browser, and Electron. Multiple projects run concurrently without sharing a
writable home, and existing single-project users retain the same default launch
behavior.
