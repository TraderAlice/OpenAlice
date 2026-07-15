# Local Runtime and CLI Bootstrap

This guide owns the browser-local OpenAlice entry after CLI installation and
the boundary between dependency bootstrap, source-backed Runtime startup,
Electron distribution, and later downloadable Runtime bundles. Installer
consent, installed layout, PATH integration, updates, and installer release
checks belong to [[docs/cli-installer.md]].

Related guides: [[docs/cli-installer.md]],
[[docs/managed-workspace-runtime.md]],
[[docs/docker-deployment.md]], [[docs/broker-packs.md]], and
[[docs/remote-access.md]].

## Product Boundary

The local browser path is a first-class OpenAlice distribution surface:

```text
installed openalice CLI
  └── local OpenAlice source checkout
        └── built-runtime Guardian
              ├── Alice + normal Web UI on 127.0.0.1:47331
              ├── optional UTA on local internal ports
              └── optional Connector Service on local internal ports
```

The browser, API, authentication, Workspace WebSocket, and terminal all share
one loopback origin. This path does not require a public domain, cross-domain
cookies, a hosted Studio protocol, or an SSH transport.

Electron remains a separate, complete distribution. The CLI excludes the
desktop package when preparing a source checkout; it does not replace or
modify Electron packaging, app protocol, preload, IPC, PTY, signing, or update
behavior.

## Preview Install

The current installer distributes the small JavaScript CLI from the `dev` ref:

```bash
curl -fsSL https://raw.githubusercontent.com/TraderAlice/OpenAlice/dev/install | bash
```

The preview requires Node.js 20 or newer. It installs only the small CLI; it
does not clone OpenAlice, write application state, install Electron, or start a
service without separate consent. The curl entry targets macOS, Linux, WSL,
and Git Bash; native Windows desktop distribution remains the signed Electron
installer. The complete consent, update, filesystem, PATH, authenticity, and
test contract lives in [[docs/cli-installer.md]].

Installer flags, non-interactive consent, development seams, the clean Docker
fixture, and the manual prompt playground are documented only in
[[docs/cli-installer.md]].

Until release assets include a standalone headless Runtime, users keep an
OpenAlice source checkout and run the CLI from inside it:

```bash
git clone https://github.com/TraderAlice/OpenAlice.git
cd OpenAlice
openalice
```

`openalice` finds the checkout, installs the locked workspace dependencies
without `@traderalice/desktop`, runs `pnpm build:server`, starts
`scripts/guardian/prod.mjs` on `127.0.0.1`, and opens the normal UI. If `pnpm`
is absent but Corepack is available, preparation uses Corepack with the pnpm
version pinned by the repository.

Live broker engines are still activated through the Trading UI and
`<OPENALICE_HOME>/runtime/broker-packs/`. The source checkout contains their
adapter workspaces for development, but `build:server` excludes those wrappers
from UTA Core and no live SDK is evaluated at startup.

When an interactive install is run from inside an OpenAlice checkout, the
installer presents a separate, default-no `Start OpenAlice now?` prompt after
the CLI is complete. Installation consent never implies service-start consent,
and `--yes` remains installation-only for automation.

The CLI stays in the foreground and owns the Guardian lifetime. `Ctrl+C` stops
the local Runtime. A normal second launch reuses an already healthy local URL;
it does not kill the existing owner. `openalice start --takeover` explicitly
requests the existing Guardian recovery flow.

Useful controls:

```bash
openalice start --no-open
openalice start --rebuild
openalice start --home /tmp/openalice-test-home --port 41000
openalice start /path/to/OpenAlice
```

For concurrent source worktrees, select a complete home outside the checkout:

```bash
pnpm dev -- --home ~/.openalice-dev/feature-a
pnpm dev -- --home ~/.openalice-dev/feature-b
```

The development `--home` override takes precedence over `OPENALICE_HOME` and
moves the same complete boundary as `openalice start --home`: product data,
Workspaces, runtime locks, credentials, and optional Broker Packs. See
[[docs/data-locations.md]].

Use `--rebuild` after pulling source changes when existing build artifacts may
be stale. Never use a real user-state root for launcher or recovery tests.

## Server Lifecycle

The browser convenience command and a persistent Server are separate lifetime
contracts. `openalice start` remains foreground and browser-oriented. The
installed Server surface is:

```bash
openalice server run [app-dir]     # foreground, no browser
openalice server start [app-dir]   # detached, wait for real readiness
openalice server status            # read-only, with stable --json output
openalice server stop              # ask the owning Guardian to stop itself
```

These commands reuse the same checkout preparation, build artifacts,
`OPENALICE_HOME`, loopback binding, Guardian lease, optional-component policy,
and explicit `--takeover` rule as local start. They do not introduce a second
launcher or a PID-file kill path. Detached start succeeds only after Guardian
ownership, the local control endpoint, and Alice HTTP are ready.

The control endpoint is local to the selected home and is not an Alice HTTP
route. `server stop` sends a versioned structured request to a matching CLI
Server, then waits for Guardian's normal child shutdown and ownership release.
It refuses to guess at an unreachable PID or silently stop an Electron-owned
Runtime. Exact status classes, control fields, recovery rules, and the managed
SSH composition live in [[docs/remote-access.md]].

The detached path is still source-backed: the checkout supplies the built
Runtime while the installed CLI supplies lifecycle and transport control. A
future standalone bundle changes preparation, not these ownership semantics.

## Dependency Bootstrap Direction

Keep bootstrap observable and layered:

1. The shell installer validates Node and makes only the `openalice` command available.
2. Local start validates the source and built artifacts, using pnpm or Corepack
   when preparation is required.
3. A guided setup layer should validate Git and present optional native agent
   CLIs, installing only
   the user's selections, with explicit commands, versions, and retry status.
4. A future release asset can replace the source/build requirement with a
   downloadable headless Runtime while retaining the same CLI and localhost
   contract.

The same Server command contract survives that transition. Source-backed and
standalone-bundle Runtime providers differ in preparation, not in ownership,
status, stop, browser, or SSH behavior.

Do not silently place every optional agent runtime into Electron or the curl
installer. The same dependency plan must remain inspectable and independently
retryable, and Electron's managed-runtime policy continues to belong to
[[docs/managed-workspace-runtime.md]].

## Security and Network Invariants

- The CLI always sets `OPENALICE_BIND_HOST=127.0.0.1` for local startup.
- Internal MCP/CLI, UTA, and Connector ports remain local-only.
- The normal Guardian and Alice runtime locks remain the final single-writer
  boundary for `OPENALICE_HOME`.
- `--takeover` is the only CLI path authorized to replace a recorded owner.
- Do not turn the local CLI into a public listener to make remote access work.
  Remote access composes an authenticated transport around the same loopback
  Runtime; see [[docs/remote-access.md]].

## Verification

When this surface changes:

1. Follow [[docs/cli-installer.md]] when the root installer or distributed CLI
   payload changes.
2. Run `pnpm build:server` and start with an isolated `--home` and test port.
3. Open the real localhost route and verify the auth contract and Workspace UI.
4. Run Guardian recovery checks when launcher ownership changes.
5. Run `pnpm test:remote:docker` when managed SSH or Server lifecycle changes.
6. Run Docker smoke when `scripts/guardian/prod.mjs` changes.
7. Run Electron PTY/package smoke when dependency topology or shared Runtime
   behavior changes, even though the CLI itself does not package Electron.
