# Remote Quickstart

Use this path when OpenAlice should run on a private Linux or macOS machine
that you can already reach with SSH, while the browser stays on your laptop.
The remote host owns Workspaces, native Agent processes, credentials, and
optional trading services; the laptop owns only the browser and SSH tunnel.

The lifecycle and security contract lives in [[docs/remote-access.md]]. For an
always-on container exposed through HTTPS, Tailscale, or a private proxy, use
the source-built server image in [[docs/docker-deployment.md]]. Railway also
has a native CLI SSH-host profile described below. These are parallel
deployment choices: none is a compatibility fallback for another.

## Choose a Deployment

| What you want | Use |
|---|---|
| Complete packaged desktop app | Electron |
| OpenAlice from a local source checkout | `openalice start` |
| Existing private machine reached through SSH | `openalice remote` |
| Railway service reached only through SSH | `Dockerfile.railway` + `openalice remote` |
| Existing compatible Server; tunnel only | `openalice ssh` |
| Container lifecycle, volume, healthcheck, and HTTPS | Docker |

`openalice remote` follows the Herdr-style ownership model: execution and
durable state stay on the machine with the files, while a replaceable local
client can disconnect and return. OpenAlice uses an ordinary loopback HTTP/WS
tunnel rather than Herdr's TUI protocol, so the normal browser UI remains the
client.

## Before You Start

On the laptop:

- macOS, Linux, or WSL;
- `curl` and OpenSSH;
- SSH access to the target.

On the remote host:

- Linux or macOS;
- Bash, `tar` with gzip support, `diff`, and a SHA-256 utility;
- `curl` for a network install;
- `lockf` on macOS or `flock` on Linux (normally from `util-linux`);
- enough disk and memory for the installed Runtime.

The same shared-installer prerequisites apply on the laptop when it installs
its local CLI. The Railway image supplies them explicitly; OpenAlice does not
silently add missing system packages on a generic host.

The native release does not require Node.js, Bun, Git, an Agent Runtime, or
source-build tools. If you explicitly select a source checkout, that separate
development path requires its normal Node/build prerequisites. OpenAlice does
not install Agent Runtimes or configure SSH keys for you.

## 1. Install the CLI on Your Laptop

```bash
curl -fsSL https://openalice.ai/install | bash
```

Run the shell-specific activation command printed after installation; it makes
the commands available in this terminal immediately, with no restart. Then
verify the installed commands:

```bash
openalice --version
openalice version --json
```

The installer records its channel/version, target, checksum, and immutable
content identity. On an ordinary SSH-managed host, managed remote selects the
same logical OpenAlice release for the target, then verifies that target's own
platform archive and content identity. Cross-platform archives are not expected
to be byte-identical. Dev uses one completed latest manifest for both local and
remote target selection and blocks mutation until the invoking dev CLI is
current. Railway is different: its service variables and entrypoint select the
release, while the laptop CLI only inspects the installed target-local Runtime
before tunneling. Neither path installs or changes Agent Runtime executables.

## 2. Give the Host a Useful SSH Name

OpenAlice delegates keys, agents, host verification, ports, and `ProxyJump` to
your normal OpenSSH configuration. A short alias keeps every later command
simple:

```sshconfig
Host openalice-box
  HostName server.example.com
  User alice
  IdentityFile ~/.ssh/id_ed25519
```

Verify the transport once:

```bash
ssh openalice-box
```

Exit that shell after it connects. OpenAlice will use the same host-key and
authentication policy.

### Railway host setup

For a volume-backed Railway host, connect the OpenAlice repository as the
service source and set `RAILWAY_DOCKERFILE_PATH` to:

```text
Dockerfile.railway
```

Attach a Railway Volume at `/data` before the first deploy. Do not configure a
pre-deploy install step: Railway mounts the Volume only when the service starts,
and the image entrypoint owns bootstrap on that mounted filesystem. Do not
generate a public domain or TCP proxy for Alice. The only client path in this
profile is Railway SSH plus OpenAlice's local loopback tunnel.

Set the service lifecycle explicitly in the Railway Dashboard:

- leave **Start Command** empty so Railway uses `Dockerfile.railway`'s
  `ENTRYPOINT` rather than replacing it;
- disable **Serverless** so an idle but persistent Agent Runtime is not put to
  sleep;
- set **Restart Policy** to **Always** so a foreground Guardian is restored
  after either clean or failed exit (choose a Railway plan that exposes this
  policy);
- keep the volume-backed service at exactly one replica; Guardian and one
  AliceProject Home are single-owner state, not a load-balanced workload; and
- set `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=30` or higher so Railway gives
  Guardian at least 30 seconds between `SIGTERM` and forced termination.

The image entrypoint holds an exclusive lifecycle `flock` on the mounted
Railway Volume directory inode for the whole foreground Runtime. A replacement
waits for that kernel lock before installing, selecting a Project, or starting;
heartbeat age is not takeover authority. Before any install-pointer or Project
mutation, the entrypoint also rejects retained legacy, malformed, or foreign
owner records across every discovered Project Home on the Volume. Alice, UTA,
and Connector validate and retain their own lifetime duplicates while removing
the capability from descendant environments; ordinary child processes, adapters,
Agents, and PTYs do not inherit them. Thus Guardian and every Project writer must
be gone before a replacement can acquire the fence. Ordinary Railway SSH shells are observer-only and
cannot start or reclaim a Runtime owner. Each service start gives the trusted
writer tree a fresh fencing-instance identity, so a replacement stays distinct
even when Railway reuses its hostname and PIDs. Lock release atomically retires
the canonical directory under the shared recoverable lock-mutation claim before
cleanup. Claim ownership is generation-specific: the UUID in its filename must
match its JSON token, and a recoverer can atomically retire only that exact
generation before canonical mutation. The Runtime must advertise `railway-runtime-lock-v2` in addition to
the retained-owner `railway-flock-v1` capability, so bootstrap cannot fall back
to an older binary that does not understand instance fencing. If a hard kill from older code left a
known ownerless directory, or v2 dies while publishing/releasing a claim,
preflight recovers only the exact empty/UUID-marker/write-temp shape after the
full Volume scan has no other blocker and descriptor-relative identity checks
still match. Unknown entries, duplicate claim markers or write temps, and
symlinked/malformed nodes fail closed.

For the first fenced deployment against a retained pre-fence Project, first
verify the old deployment is stopped. Inspect and move only these directories
when present: `state/guardian.lock`, `state/runtime.lock`,
`workspaces/state/runtime.lock`, and `data/state/config-bootstrap.lock`, all
relative to that exact Project Home. Preserve those relative paths beneath a
timestamped `/data/quarantine/<project>-<timestamp>/` directory so the cutover
is reversible. That quarantine tree is never a valid `OPENALICE_HOME`. Never
make `/data/quarantine` a symlink or file: it must be absent or a real directory
at that exact Volume-root path, and startup fails closed otherwise. Never
clear the Project or Volume; if an owner still matches a
running deployment, stop instead of quarantining it.

The default service variables select the latest stable native release, but the
currently public stable `v0.90.2` and beta `v0.91.0-beta.1` do not advertise the
required `railway-runtime-lock-v2` capability and are therefore rejected by
this profile. The dev manifest current before this change is also v1-only. Do
not deploy until this change has merged and its matching completed dev manifest
advertises v2; that later artifact may be used for candidate acceptance. Stable
or beta still requires a later explicit release, which this guide does not
authorize or perform. Use only the selectors needed for the intended host:

```text
OPENALICE_RAILWAY_CHANNEL=stable

# Accepted beta checkpoint instead:
OPENALICE_RAILWAY_CHANNEL=beta
OPENALICE_RAILWAY_VERSION=<accepted-beta-version>

# Rolling latest dev preview instead (no version variable):
OPENALICE_RAILWAY_CHANNEL=dev

# Optional Project selection; this is the only layout override:
OPENALICE_HOME=/data/projects/research
```

On the first install or a forced refresh, stable and beta may omit the version
to resolve the latest manifest or may pin an in-channel version. A later boot
reuses an already valid install instead of treating every restart as an update.
Dev always follows the completed latest dev manifest and refuses a version
override. Installation and Project data survive service replacement under
separate paths:

```text
/data/home                  fixed persistent Railway SSH HOME
/data/home/.openalice       native OpenAlice install root
/data/home/.local           persistent user-owned executable prefix
/data/home/.bun             optional persistent user-owned Bun root
/data/projects/default      OPENALICE_HOME
```

Those user paths and their persistent `PATH` are fixed by the image so Railway
SSH and Guardian see the same installation. Do not override `HOME`,
`OPENALICE_INSTALL_DIR`, `NPM_CONFIG_PREFIX`, `BUN_INSTALL`,
`OPENALICE_RAILWAY_VOLUME_ROOT`, or `AQ_LAUNCHER_ROOT`. The only layout selector
is `OPENALICE_HOME`; it must stay beneath `/data`, and the entrypoint always
derives `<OPENALICE_HOME>/workspaces` as `AQ_LAUNCHER_ROOT`. During bootstrap
the entrypoint uses system-only `PATH`, then restores the persistent user paths
after validating the native CLI.

Wait for the service log to report the foreground Runtime start, then add an
OpenSSH alias on the laptop with the Railway CLI:

```bash
railway ssh config --service openalice --alias openalice-railway
ssh openalice-railway 'openalice version --json'
```

Use the actual Railway service name in place of `openalice`. The generated
OpenSSH block preserves Railway account and deployment routing, so
`openalice-railway` can be used anywhere this guide shows `openalice-box`.
OpenAlice never installs an Agent Runtime into the service. If one is needed,
open a Railway SSH shell and install it into a persistent user location already
on `PATH`, such as `/data/home/.local/bin` or `/data/home/.bun/bin`; its login,
version, and updates remain yours.

AliceProject transfer can reuse Alice-owned AI, market-data-provider, broker,
and Connector credentials, but it does not copy Web authentication/sessions or
native Agent login/configuration. Git-ignored dependencies and Alice-owned
runtime, backup, Session, and install state are also excluded. Review the exact
contract and run `--plan` before apply as described in
[[docs/remote-access.md]].

## 3. Review the Plan

```bash
openalice remote openalice-box --plan
```

The read-only plan reports the remote platform, CLI, Runtime owner/provider,
ports, and every proposed change. On a new ordinary SSH-managed host it normally
includes:

1. install the matching native OpenAlice release;
2. verify and start the detached OpenAlice Server from that immutable Runtime;
3. open a local loopback tunnel.

The installed Runtime lives in the installer's immutable `cli/releases/`
release directory. You do not need to SSH in, clone the repository, install a
compiler, find an absolute source path, or repeat `--app-dir` on later
connections. Nothing changes until you approve the plan.

For a Railway target, the plan is inspection-only: it must not propose an
install, update, start, takeover, or stop. If bootstrap or Runtime consistency
is unhealthy, repair the service through Railway rather than approving a local
mutation.

## 4. Connect

```bash
openalice remote openalice-box
```

On an ordinary SSH-managed host, approve the displayed plan. The native archive
downloads and activates as one bounded transaction; failures include a bounded
diagnostic tail. On Railway there is no release or lifecycle approval at this
step: `openalice remote` verifies the service-owned foreground Runtime and opens
only the tunnel. When ready, OpenAlice opens a URL such as
`http://127.0.0.1:49891` in the local browser.

The browser, page APIs, and Workspace PTY WebSocket all cross the same SSH
tunnel. Alice itself remains bound to remote `127.0.0.1`.

## Everyday Use

Reconnect with the short command:

```bash
openalice remote openalice-box
```

OpenAlice prefers the last successful local port, so an existing browser tab
can recover on the same localhost origin. If that port is genuinely occupied,
the command chooses another one and tells you.

Inspect or stop a generic SSH-managed remote Server without writing raw SSH
commands:

```bash
openalice remote openalice-box --status
openalice remote openalice-box --stop
```

Status bundles the control lookup into one SSH round trip instead of repeating
the full bootstrap prerequisite scan. Stop uses the same control-only probe
before and after Guardian's structured shutdown.

On an ordinary SSH-managed host, closing the browser or pressing `Ctrl+C`
closes only the local tunnel. The detached Server, Workspaces, PTYs, and Agent
processes continue until you run `--stop`, the host stops, or Guardian shuts
them down.

The Railway profile deliberately runs `server run` in the foreground rather
than keeping a detached child. Closing the laptop tunnel still leaves it
running, and Railway is the only release and lifecycle authority. For a
Railway-identified target, `openalice remote` is status/connect-only and rejects
`--stop`, `--takeover`, and `--app-dir`; stop, restart, or redeploy the service
through Railway instead. On every start, the image-owned Railway wrapper
replaces the persistent command shims and refuses `openalice update`,
`rollback`, and `uninstall` before an installed release can mutate the
persistent pointer; change the service channel/version variables and redeploy,
or remove the service itself.

Known transient SSH transport interruptions are retried with a short,
platform-neutral message. Raw platform diagnostics are shown only when the
connection finally fails, so a provider's temporary SSH control-plane noise
does not become the normal OpenAlice experience.

## Installed Runtime and User-Owned Source

The default installed Runtime is maintained by the ordinary OpenAlice
installer:

- the CLI and every OpenAlice process role carry the same product/content
  identity;
- archives are selected for the remote platform and architecture;
- the archive checksum and internal file manifest are verified before
  activation;
- Agent Runtime executables remain user-owned and are discovered from `PATH`;
- reconnect reuses a compatible healthy Runtime without mutation.

For development or a deliberately pinned checkout, pass your own absolute
path:

```bash
openalice remote openalice-box \
  --app-dir /srv/OpenAlice
```

If that path does not exist, the plan can clone the selected source there. If
it already contains OpenAlice, it remains user-owned: managed remote prepares
and starts it but does not fetch, switch, reset, or overwrite it. A path that
exists but is not an OpenAlice checkout is refused.

Useful variations:

```bash
# Keep one explicit browser origin.
openalice remote openalice-box --local-port 49891

# Print the URL without opening a browser.
openalice remote openalice-box --no-open

# Use an identity without an SSH config alias.
openalice remote alice@server.example.com \
  --identity ~/.ssh/id_ed25519

# Put durable state on a mounted volume.
openalice remote openalice-box \
  --home /data/openalice-home
```

## Security and Persistence

- Never publish remote port `47331` directly for the SSH path.
- Never set `OPENALICE_DISABLE_AUTH=1` for remote access.
- Use a least-privilege remote account and normal SSH host-key discipline.
- Provider credentials, Workspace history, files, and Agent state live under
  the remote home; the browser is not a backup.
- On Railway, the SSH Home and user install paths are fixed below `/data/home`.
  Only `OPENALICE_HOME` may select a different Project beneath `/data`; the
  entrypoint derives its Workspace root, rejects normalized escapes, and
  rejects a Railway service that has no `/data` Volume.
- For an ephemeral VM or container, place `--home` on persistent storage. The
  Runtime can be reinstalled; the home is the durable state that must survive.
- A platform replacement can reattach a volume whose Guardian lock names the
  removed machine. OpenAlice refuses cross-machine takeover automatically;
  confirm the previous instance is gone before following the operator recovery
  guidance in [[docs/remote-access.md]].

## Docker Is a First-Class Alternative

Choose Docker when the container image, volume, healthcheck, bundled Agent
runtimes, and HTTPS/private-proxy lifecycle are benefits rather than overhead:

```bash
docker compose up -d --build
docker compose ps
```

The Docker image is not deprecated by managed remote, and remote users are not
expected to wrap their SSH host in Docker. Both surfaces run the same
Guardian/Alice product with different operational ownership. Continue with
[[docs/docker-deployment.md]] for authentication, backups, upgrades, and the
full container acceptance contract.

The Railway native CLI image is likewise not a replacement for this source
server image. It intentionally omits bundled Agent Runtimes, public Web
exposure, and the source-image health/auth deployment contract; its job is to
keep one install root and AliceProject Home durable behind SSH.
