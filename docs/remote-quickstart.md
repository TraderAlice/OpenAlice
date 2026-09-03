# Remote Quickstart

Use this path when OpenAlice should run on a private Linux or macOS machine
that you can already reach with SSH, while the browser stays on your laptop.
The remote host owns Workspaces, native Agent processes, credentials, and
optional trading services; the laptop owns only the browser and SSH tunnel.

The lifecycle and security contract lives in [[docs/remote-access.md]]. For an
always-on container exposed through HTTPS, Tailscale, or a private proxy, use
[[docs/docker-deployment.md]]. Remote and Docker are parallel deployment
choices: neither is a compatibility fallback for the other.

## Choose a Deployment

| What you want | Use |
|---|---|
| Complete packaged desktop app | Electron |
| OpenAlice from a local source checkout | `openalice start` |
| Existing private machine reached through SSH | `openalice remote` |
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
- `curl`, `tar`, and a SHA-256 utility;
- enough disk and memory for the installed Runtime.

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
content identity. Managed remote reproduces that same native OpenAlice release
on the target; it has no separate hidden release channel and does not install
or change the target's Agent Runtime executables.

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

## 3. Review the Plan

```bash
openalice remote openalice-box --plan
```

The read-only plan reports the remote platform, CLI, Runtime owner/provider,
ports, and every proposed change. On a new supported host it normally includes:

1. install the matching native OpenAlice release;
2. verify and start the detached OpenAlice Server from that immutable Runtime;
3. open a local loopback tunnel.

The installed Runtime lives in the installer's immutable `cli/releases/`
release directory. You do not need to SSH in, clone the repository, install a
compiler, find an absolute source path, or repeat `--app-dir` on later
connections. Nothing changes until you approve the plan.

## 4. Connect

```bash
openalice remote openalice-box
```

Approve the displayed plan. The native archive downloads and activates as one
bounded transaction; failures include a bounded diagnostic tail. When ready,
OpenAlice opens a URL such as
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

Inspect or stop the remote Server without writing raw SSH commands:

```bash
openalice remote openalice-box --status
openalice remote openalice-box --stop
```

Status bundles the control lookup into one SSH round trip instead of repeating
the full bootstrap prerequisite scan. Stop uses the same control-only probe
before and after Guardian's structured shutdown.

Closing the browser or pressing `Ctrl+C` closes only the local tunnel. The
detached Server, Workspaces, PTYs, and Agent processes continue on the remote
host until you run `--stop`, the host stops, or Guardian shuts them down.

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
