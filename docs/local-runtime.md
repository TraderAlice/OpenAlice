# Local Runtime and CLI Bootstrap

This guide owns the browser-local OpenAlice entry, the small installable CLI,
and the boundary between dependency bootstrap, source-backed Runtime startup,
Electron distribution, and later downloadable Runtime bundles.

Related guides: [[docs/managed-workspace-runtime.md]],
[[docs/docker-deployment.md]], and [[docs/remote-access.md]].

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

The preview requires Node.js 20 or newer. It installs versioned CLI files under
`~/.openalice/cli-versions/`, writes stable `openalice` and `openalice.cmd`
launchers under `~/.openalice/bin/`, and offers to add that bin directory to the
current shell profile. Before changing files, the interactive installer shows
its source, version, paths, and shell changes, explains what it will not do, and
asks for confirmation. It does not clone OpenAlice, write application state, or
install Electron. The curl entry targets macOS, Linux, WSL, and Git Bash;
native Windows desktop distribution remains the signed Electron installer.

Unattended environments have no implicit consent. After reviewing the same
install plan, pass `--yes` explicitly:

```bash
curl -fsSL https://raw.githubusercontent.com/TraderAlice/OpenAlice/dev/install \
  | bash -s -- --yes
```

For a pinned tag or commit:

```bash
curl -fsSL https://raw.githubusercontent.com/TraderAlice/OpenAlice/dev/install \
  | bash -s -- --version <git-ref>
```

For local installer development:

```bash
./install --source . --version dev --no-modify-path
```

To experience the real prompt in a clean, offline container and remain in its
shell afterward for inspection:

```bash
pnpm test:install:docker --interactive
```

`OPENALICE_INSTALL_BASE_URL` may point the download branch at a local fixture
server. It exists for installer development and the release smoke; normal user
installs should leave it unset.

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

Use `--rebuild` after pulling source changes when existing build artifacts may
be stale. Never use a real user-state root for launcher or recovery tests.

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

1. Run the CLI unit and installer tests.
2. Run `pnpm test:install:docker` locally. It executes the real `curl | bash`
   download path as a non-root user with an empty home and no global pnpm,
   then verifies repeat installation, version switching, shell PATH changes,
   and both launchers while the run container has no external network. This is
   a manual pre-release gate and intentionally does not run in PR CI.
3. Install from `--source` into a temporary install root and execute the
   installed symlink.
4. Run `pnpm build:server` and start with an isolated `--home` and test port.
5. Open the real localhost route and verify the auth contract and Workspace UI.
6. Run Guardian recovery checks when launcher ownership changes.
7. Run Docker smoke when `scripts/guardian/prod.mjs` changes.
8. Run Electron PTY/package smoke when dependency topology or shared Runtime
   behavior changes, even though the CLI itself does not package Electron.
