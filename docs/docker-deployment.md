# Docker Deployment

This guide owns the OpenAlice server-image contract, Docker Compose lifecycle,
remote-host safety boundary, and container smoke requirements. It complements
[[docs/project-structure.md]] and [[docs/managed-workspace-runtime.md]].
External notification setup is owned by [[docs/connector-service.md]].
For private source-backed browser access over SSH, start with
[[docs/remote-quickstart.md]]; its authoritative lifecycle and transport
contract is owned by [[docs/remote-access.md]]. The source server image,
Railway native CLI SSH host, and managed existing-host path are parallel
deployment profiles. The first owns an image, volume, healthcheck, bundled
Agent Runtimes, and optional HTTPS lifecycle. The Railway profile owns a small
native-CLI bootstrap image and foreground SSH-only service. Managed remote can
prepare an existing host without requiring either image.

## Source Server Image Topology

The image is the non-Electron production topology:

```text
tini (PID 1)
└── scripts/guardian/prod.mjs
    ├── Alice HTTP + Workspace process
    ├── optional UTA process
    └── optional Connector Service process

/app   immutable image resources
/data  persistent operator state and Workspaces
```

The image contains UTA Core but no live broker SDK. Alice installs selected
Broker Packs under `/data/runtime/broker-packs/`, so they survive container
replacement with the rest of `OPENALICE_HOME`. A missing or incompatible Pack
disables only its accounts/data sources; it does not prevent UTA Core or Chat
from starting. See [[docs/broker-packs.md]].

Only Alice's web port `47331` is published. The CLI/MCP gateway, UTA, and
Connector Service stay on
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

## Railway Native CLI SSH Host

`Dockerfile.railway` is a separate image contract. It does not replace the
source server image above and must not inherit that image's bundled Agent
Runtime or public-Web promises. Configure a Railway service to build it by
setting `RAILWAY_DOCKERFILE_PATH=Dockerfile.railway`, attach a Volume at
`/data`, and leave Public Networking without a generated domain or TCP proxy.
Railway provides the SSH transport; the browser still reaches Alice only
through `openalice remote` and a laptop-local loopback URL.

The Railway service settings are part of the runtime contract:

- leave the Dashboard **Start Command** empty so the Docker `ENTRYPOINT` stays
  authoritative;
- disable **Serverless**; SSH-only inactivity must not suspend a persistent
  Guardian or Agent process;
- select **Restart Policy: Always** so Railway restores the foreground service
  after either clean or failed exit (a plan without `Always` does not satisfy
  this always-on profile);
- run exactly one replica against the Volume because Guardian and the
  AliceProject filesystem are single-writer state; and
- set `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=30` or higher so `tini` and Guardian
  receive at least 30 seconds to cascade `SIGTERM` before Railway sends
  `SIGKILL`.

Do not duplicate those settings in a legacy `railway.json`. In particular, a
Dashboard Start Command override would bypass volume validation, installer
fallback, persistent `PATH`, and foreground Guardian startup in the image
entrypoint.

```text
Railway platform init (PID 1)
└── tini -s -g
    └── scripts/railway/entrypoint.sh
        └── /data/home/.openalice/bin/openalice server run
            └── Guardian foreground tree
                ├── Alice
                ├── optional UTA
                ├── optional Connector Service
                └── user-launched external Agent Runtime processes

/opt/openalice/install       shared installer snapshot from the image source
/data/home                   persistent user HOME
/data/home/.openalice        persistent native CLI install root
/data/projects/default       persistent OPENALICE_HOME
/data/projects/default/workspaces
                             persistent AQ_LAUNCHER_ROOT
```

The Railway profile fixes the Volume at `/data`, persistent SSH `HOME` at
`/data/home`, OpenAlice install root at `/data/home/.openalice`, npm prefix at
`/data/home/.local`, and Bun root at `/data/home/.bun`. `Dockerfile.railway`
exports those values and their executable directories on `PATH`, because a new
Railway SSH process receives image/service environment rather than variables
mutated only inside the entrypoint process. The entrypoint nevertheless starts
bootstrap with system-only `PATH`, validates the fixed user layout, and restores
the persistent `PATH` only after it has verified the native CLI.

`OPENALICE_HOME` is the only layout selector and must resolve beneath `/data`;
`AQ_LAUNCHER_ROOT` is always canonicalized from that selected Project as
`<OPENALICE_HOME>/workspaces`. The entrypoint rejects a different Volume mount,
ephemeral `HOME`, alternate install/npm/Bun root, or normalized/symlink escape;
it does not honor an independent Workspace-root override. The image filesystem
is replaceable; no install release, credential, Workspace, Agent login, or
Project state may depend on it.

The first boot runs the ordinary shared installer non-interactively without
editing user-owned shell profiles. The image-owned global shell environment
restores the same fixed Home, user PATH, Project Home, and Railway service
identity for later interactive SSH login shells. `OPENALICE_RAILWAY_CHANNEL`
accepts `stable` (the default),
`beta`, or `dev`; `OPENALICE_RAILWAY_VERSION` may pin only an in-channel stable
or beta version. Dev always resolves the latest completed dev manifest and
rejects an exact version. Subsequent boots reuse a release only after both
`openalice --version` and `openalice version --json` validate it. Set
`OPENALICE_RAILWAY_FORCE_INSTALL=1` for a deliberate refresh deploy, then clear
it after verifying the selected release. If that refresh cannot install but the
previous release still validates, the host starts the previous release. An
empty or damaged install with a failed bootstrap stops instead of running an
unverified fallback.

After selection, the image atomically replaces the persistent `openalice`,
`alice`, `alice-workspace`, `alice-uta`, and `traderhub` shims with its Railway
wrapper. The wrapper resolves the active immutable release directly, rebuilds
its provenance environment, and rejects update/rollback/uninstall mutations;
this keeps older published CLIs from bypassing Railway's release authority via
the persistent command path.

The entrypoint finally `exec`s `openalice server run`; it does not launch a
detached Server and sleep. Railway therefore observes and restarts the actual
Guardian service process. Railway places its platform init at PID 1, so the
image runs `tini -s -g` as a child subreaper: it forwards signals to the
complete process group and adopts/reaps orphaned descendants even though it is
not PID 1. The shared installer serializes mutations
with the platform kernel (`lockf` on macOS, `flock` on Linux); its persistent
guard inode contains no Project or credential data, and hard process death
releases ownership automatically.
Alice stays on loopback port `47331` (or the explicit
`OPENALICE_RAILWAY_PORT`), and this profile does not consume Railway's public
`PORT` contract.

Every Railway shell and service process derives one exact machine identity
from `RAILWAY_SERVICE_ID`; a conflicting configured identity fails startup.
Within one container, Runtime ownership still uses PID and process-start-time
identity. Across replacement-container PID namespaces on the same service
Volume, it never probes or signals the recorded PID: a fresh, explicit
heartbeat remains authoritative, while a stale explicit heartbeat may be
reclaimed atomically. Missing, invalid, or foreign identity/heartbeat evidence
fails closed. The image-owned entrypoint alone waits for this handoff before
preparing or spawning Guardian; ordinary SSH commands do not inherit that
privilege. Keep `OPENALICE_RAILWAY_WAIT_SECONDS` at 130 or higher (180 by
default). The same value separately bounds owner release and Runtime readiness;
for custom draining use at least `draining seconds + 100`, so the stale-heartbeat
window retains a bounded margin.

Agent Runtime installation remains a user action performed through Railway
SSH. Persistent locations `/data/home/.local/bin` and `/data/home/.bun/bin` are
already on `PATH`, but the image and OpenAlice installer do not place Claude,
Codex, OpenCode, Pi, or another Agent there. Their versions, credentials,
plugins, and upgrades remain outside the OpenAlice release transaction.

### Railway migration and restart acceptance

Local contract checks for this profile are:

```bash
bash -n scripts/railway/*.sh
pnpm exec vitest run \
  scripts/railway-entrypoint.spec.ts \
  packages/guardian-runtime/src/runtime-lock.spec.ts \
  packages/cli/src/lifecycle.spec.mjs \
  packages/cli/src/server-control.spec.mjs \
  packages/cli/src/remote.spec.mjs \
  packages/cli/src/project-transfer.spec.ts \
  packages/cli/src/project-transfer-ssh.spec.ts \
  packages/cli/src/project-transfer-stream.spec.ts
```

The entrypoint fixture must cover empty-volume bootstrap, verified-install
reuse without installer access, failed forced-refresh fallback, and fail-closed
empty bootstrap. It must also prove the fixed `/data/home` SSH/install layout,
system-only bootstrap `PATH`, Project-only `OPENALICE_HOME` selection, derived
Workspace root, Railway service identity, and rejection of mount/layout
mismatches or normalized escapes before installation. Ordinary SSH-managed
remote tests must cover stable/beta/pinned logical release matching across
different target artifacts, target-local checksum and content identity
validation, stale/unverifiable dev-manifest blocking, and dev installer handoff
bound to the remote target. Railway tests must instead prove that the laptop
command is inspection-only, never selects or mutates the service release, and
reports a verified fallback without confusing it with the configured selector.
Transfer tests must cover Git-aware inclusion, ignored dependency exclusion,
self-contained repository connectivity, fail-closed linked/nested/submodule or
external-object state, known Alice backup/session/install exclusions,
credential omission and resealing, receipt validation, and safe handling of
absolute or escaping symlinks.
Runtime ownership tests must also cover same-container PID identity,
legacy-to-stable Railway service identity handoff, fresh-versus-stale explicit
heartbeats across container namespaces, missing/invalid evidence that remains
blocked, entrypoint-only bounded waiting, and a proof that no cross-container
PID receives a signal.

A real Railway acceptance is still required before treating the profile as a
usable hosted product. Keep the clean-bootstrap and retained-data journeys
separate; never relabel or clear an existing user Volume merely to obtain an
empty-host result:

1. on a disposable service and empty `/data` Volume, bootstrap the image and
   prove that a failed initial install stops without an unverified fallback;
2. deploy the candidate non-destructively against the retained real `/data`
   Volume with no public domain; confirm no existing install or Project data was
   deleted, Start Command is empty, Serverless is off, Restart Policy is Always,
   replica count is one, and draining is at least 30 seconds;
3. use `railway ssh config` to create an OpenSSH alias, then verify
   `HOME=/data/home`, the persistent OpenAlice/Agent paths on `PATH`,
   `openalice version --json`, foreground Runtime logs, and an
   inspection-only `openalice remote <alias>` browser/tunnel journey;
4. stop a real source AliceProject and review/apply `openalice project transfer`
   into a new `/data/projects/<name>` Home, confirming the Git/credential
   boundary, destination absence/free space, and that the source data remains
   unchanged;
5. select the transferred Home with `OPENALICE_HOME`, redeploy, and verify its
   Workspace/configuration marker through the real Runtime;
6. install one chosen Agent Runtime through SSH into a persistent user path,
   authenticate it, and exercise a real Workspace Session without attributing
   that installation to OpenAlice;
7. normally restart and redeploy the service with the same Volume, then verify
   the CLI release, selected Home, Project files, Agent executable/login, SSH
   tunnel, and Runtime readiness survived while old PIDs and PTYs did not;
8. hard-kill the foreground service once and replace the container against the
   same Volume; prove PID reuse or stale owner metadata cannot fool CLI
   preflight or block safe recovery; and
9. force one installer failure with a known-valid prior release on the retained
   Volume and observe the bounded exact-release fallback.

This guide owns the acceptance contract, not a snapshot of one worktree or
service. Current pass/fail state, exact counts, and run-specific evidence live
only in [[plans/bun-cli-distribution.md]]. Local Docker evidence never substitutes
for the two hosted Volume journeys above.

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

For the Stage 1 SSH path, keep `47331` private on the host and use
`openalice ssh <host>` as described in [[docs/remote-access.md]]. The tunnel
targets host loopback; it does not expose the internal CLI/MCP or UTA ports.

## Health and Lifecycle

The image healthcheck calls the public `/api/version` route from container
loopback. `docker compose ps` should report `healthy` after Alice is ready.
`stop_grace_period: 30s` gives Guardian time to stop PTYs and optional services before Docker
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
