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
- Node.js `22.19.0` or newer;
- `curl` and OpenSSH;
- SSH access to the target.

On the remote host:

- Linux or macOS;
- Node.js `22.19.0` or newer;
- `curl`;
- enough disk and memory for the source Runtime.

The remote plan can install missing Git, Python 3, make, and C++ tools on
supported Linux hosts after showing the exact package-manager command. On
macOS, install Command Line Tools locally with `xcode-select --install` when
the plan asks for them. OpenAlice does not install Node.js or configure SSH
keys for you.

## 1. Install the CLI on Your Laptop

```bash
curl -fsSL https://openalice.ai/install | bash
```

Open a new terminal and verify the installed commands:

```bash
openalice --version
openalice version --json
pi --version
```

The installer records its branch, tag, or commit and an immutable payload
identity. Managed remote reproduces that same CLI and Pi on the target; it has
no separate hidden release channel.

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

The read-only plan reports the remote platform, Node.js, CLI and Pi, Runtime
owner, source location, build tools, ports, and every proposed change. On a
new host it normally includes:

1. install the matching OpenAlice CLI and managed Pi;
2. install missing Linux source-build tools, when needed;
3. clone a matching managed source checkout;
4. build and start the detached OpenAlice Server;
5. open a local loopback tunnel.

The managed checkout lives below the selected remote `OPENALICE_HOME`, under a
selector-specific `sources/` directory. You do not need to SSH in, clone the
repository, find its absolute path, or repeat `--app-dir` on later connections.
Nothing changes until you approve the plan.

## 4. Connect

```bash
openalice remote openalice-box
```

Approve the displayed plan. First preparation can take several minutes;
successful install and build phases stay compact, while failures include a
bounded diagnostic tail. When ready, OpenAlice opens a URL such as
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

## Managed and User-Owned Source

The default managed checkout is maintained by OpenAlice:

- a missing checkout is cloned atomically after consent;
- a clean branch checkout is compared with its selected upstream on reconnect;
- an available fast-forward is shown in the plan, then applied with a Server
  restart and source rebuild;
- tracked local changes block the managed update instead of being overwritten.

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

# Put durable state and the managed source on a mounted volume.
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
  managed source then follows that home onto the same volume.
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
