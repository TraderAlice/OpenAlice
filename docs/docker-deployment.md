# Docker Deployment

This guide owns the OpenAlice server-image contract, Docker Compose lifecycle,
remote-host safety boundary, and container smoke requirements. It complements
[[docs/project-structure.md]] and [[docs/managed-workspace-runtime.md]].

## Topology

The image is the non-Electron production topology:

```text
tini (PID 1)
└── scripts/guardian/prod.mjs
    ├── Alice HTTP + Workspace process
    └── optional UTA process

/app   immutable image resources
/data  persistent operator state and Workspaces
```

Only Alice's web port `47331` is published. The CLI/MCP gateway and UTA stay on
container loopback. Workspace agents reach Alice through the injected
`alice`, `alice-workspace`, `alice-uta`, and `traderhub` CLI launchers; remote
clients must not expose the internal tool gateway as a replacement API.

The server image installs pinned Claude Code, Codex, opencode, and Pi runtimes.
Docker has no portable way to borrow host CLIs (a macOS binary cannot run in a
Linux container, and remote hosts may have none), so the image owns the full
four-runtime contract. Version changes are deliberate Dockerfile changes and
the build executes every runtime's `--version`, preventing a cached/rebuilt
image from silently acquiring a different or broken runtime. Pi headless runs
auto-approve project resources because the image owns its pinned Pi version;
interactive Pi still leaves that trust decision visible to the user.

## Start and Authenticate

```bash
docker compose up -d --build
docker compose ps
docker compose logs openalice
```

The first boot prints a one-time admin token. Store it in a password manager
and use it on the web login screen. The token hash, sessions, Workspaces,
credentials, reports, and trading state persist in the `openalice-data`
volume. Authenticate the agent runtime you intend to use:

```bash
docker exec -it openalice claude
docker exec -it openalice codex login
```

Never set `OPENALICE_DISABLE_AUTH=1` on a remote deployment. That switch exists
for isolated automated smokes only. Expose port `47331` through HTTPS (for
example Caddy, nginx, Tailscale, or a private tunnel) rather than publishing an
unencrypted public endpoint. Configure `OPENALICE_TRUSTED_PROXIES` only with
the actual proxy peer addresses; an overly broad trusted-proxy range weakens
the localhost/auth boundary.

## Health and Lifecycle

The image healthcheck calls the public `/api/version` route from container
loopback. `docker compose ps` should report `healthy` after Alice is ready.
`stop_grace_period: 30s` gives Guardian time to stop PTYs and UTA before Docker
forces termination. Compose also rotates stdout/stderr logs (`10m`, three
files) so an always-on host does not grow an unbounded Docker json log.

Useful operations:

```bash
docker compose logs --tail=200 -f openalice
docker compose restart openalice
docker compose down
docker compose up -d --build
```

`docker compose down` preserves the named volume. `docker compose down -v` is
a factory reset and permanently removes user data.

## Backup and Restore

Stop the container before taking a filesystem-consistent volume snapshot:

```bash
docker compose stop openalice
docker run --rm \
  -v openalice_openalice-data:/data:ro \
  -v "$PWD":/backup \
  alpine tar -czf /backup/openalice-data.tgz -C /data .
docker compose start openalice
```

Compose derives the volume prefix from the project directory; confirm the real
name with `docker volume ls` before backup. Restore into an empty volume while
OpenAlice is stopped. Treat the archive as sensitive: it can contain sealed
broker credentials, the local sealing key, agent logins, reports, and private
Workspace history.

## Runtime Acceptance

`pnpm docker:smoke` is the local definition of a usable server image. It:

1. builds an isolated, uniquely tagged image;
2. starts it in lite mode with a temporary Docker volume and random host port;
3. waits for Alice HTTP readiness;
4. requires Claude Code, Codex, opencode, and Pi to appear as installed;
5. creates a real Chat Workspace with the shell adapter;
6. opens the real Workspace PTY WebSocket;
7. runs `alice` inside that PTY and requires a live CLI manifest response;
8. offboards the Workspace and removes its container, volume, and owned image.

The smoke uses no AI credential and no broker. It deliberately checks an
observable CLI round trip rather than only asserting that files exist. Docker
build cache is shared infrastructure and is retained; only resources owned by
the smoke are deleted. Use `--keep` or `--keep-image` for investigation.

Before a release, an operator can add a real multi-turn agent check with a
credential already stored in the local Alice vault:

```bash
pnpm docker:smoke -- --ai-credential <slug>
```

This opt-in mode uses `claude` by default; `--ai-agent` can select any of the
four installed runtimes when the credential exposes a compatible wire (Codex
specifically requires `openai-responses`). It writes only the selected
credential into the temporary runtime volume over stdin, asks the agent to
remember a generated codeword, resumes the same OpenAlice `resumeId`, and
requires the second turn to recall it. A final turn requires the agent to use
`alice-workspace` to create and read back marker-bearing Issue data; the smoke
requires both a normalized tool block containing the marker and the agent's
confirmation. The credential check then requires a completed
`traderhub board get --board macro` call and a metric summary from its live,
keyless market-data output. The credential never enters the image or build
context; credentialed runs reject `--keep`, redact the key from failure
diagnostics, and fail loudly if Docker cannot remove their temporary volume. Set
`OPENALICE_DOCKER_AI_CONFIG_FILE` only when testing against a non-default Alice
vault path. This mode intentionally stays out of ordinary PR CI because it
uses a paid external model and a repository secret would broaden the trust
boundary.

CI builds with BuildKit's GitHub cache, reuses that caller-owned image with
`--skip-build --image openalice:ci`, and uploads redacted container diagnostics
on failure. The Docker workflow runs for deployment/runtime surfaces on PRs to
`dev` or `master`, and again for matching direct changes on `master`.
