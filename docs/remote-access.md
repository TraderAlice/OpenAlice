# Remote Access

This guide owns OpenAlice's SSH access experiment and the boundary between a
remote Runtime and local presentation. It complements
[[docs/local-runtime.md]], [[docs/docker-deployment.md]], and
[[docs/managed-workspace-runtime.md]].

## Local Runtime First

Remote access builds on the local Runtime contract in
[[docs/local-runtime.md]]. Prove `openalice` can prepare a source checkout,
start Guardian on `127.0.0.1`, and serve the normal browser UI before adding a
transport. This keeps the first distribution loop independent of domains,
cross-domain cookies, hosted Studio state, and SSH lifecycle.

## SSH Experiment: Measure the Existing TUI

The first remote path deliberately keeps the existing product architecture:

```text
local browser
  └── 127.0.0.1:<random port>
        └── SSH local forward
              └── remote 127.0.0.1:47331
                    └── Alice HTTP + Workspace PTY WebSocket
```

Alice, the Workspace, agent CLI, shell, model requests, and tool execution all
run on the SSH host. The browser loads the normal OpenAlice bundle through the
tunnel, so HTTP, authentication, and the PTY WebSocket remain same-origin. No
hosted Studio, relay, or second frontend protocol is involved.

This experiment exists to measure the real TUI experience before designing around a
latency problem that may not matter on normal developer links. WebPi remains an
optional structured Pi surface; it is not a prerequisite or replacement for
Shell, Claude Code, Codex, opencode, or Pi TUI sessions.

## Prerequisites

1. OpenAlice is already running on the remote machine, for example with the
   source-backed `openalice start --no-open` path.
2. Its web listener is reachable as `127.0.0.1:47331` from that machine.
3. The local machine has `ssh` and working key, agent, or interactive SSH auth.

For a source checkout, start the normal Guardian on the remote host. For a
server deployment, follow [[docs/docker-deployment.md]]. Do not expose the
internal CLI/MCP, UTA, or Connector ports.

From this repository:

```bash
pnpm remote:ssh -- user@example.com
```

From an installed CLI package:

```bash
openalice ssh user@example.com
```

The command chooses a free local port, opens the local URL, and remains in the
foreground to own the tunnel. Use `--no-open` to print the URL only, or
`--remote-port` when the remote Alice web port differs from `47331`.

The forward binds only local `127.0.0.1` and targets only remote `127.0.0.1`.
Closing the CLI closes the tunnel. The command does not install, update, start,
or stop the remote Runtime. A later remote lifecycle command should reuse the
local bootstrap contract rather than embedding a second installation system in
the SSH connector.

## Security Boundary

SSH authenticates the transport, but the remote HTTP server sees forwarded
requests as loopback. Alice therefore grants its loginless localhost behavior
only to requests with no browser `Origin` (CLI/server callers), a loopback
browser Origin, or the exact packaged `app://openalice` origin. A public
website cannot inherit localhost trust merely because the user currently has
an OpenAlice tunnel open.

Keep the remote web listener private or protected by the deployment's normal
HTTPS/auth boundary. Never use `OPENALICE_DISABLE_AUTH=1` for remote access.

## Deferred Remote Stages

The SSH experiment intentionally leaves these separate:

- managed remote Runtime installation and daemon lifecycle;
- a hosted standalone Studio and pairing/capability protocol;
- cloud relay or device enrollment;
- cursor-based structured Session streaming for Pi, Codex, or other agents;
- remote control from the packaged Electron app.

Evidence from the raw TUI experiment should decide which of these is worth
building next. Electron's existing local `app://` + preload/IPC distribution
remains unchanged.
