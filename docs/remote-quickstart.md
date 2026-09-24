# Remote Quickstart

Use this path when OpenAlice runs on a private Linux or macOS machine reached
through SSH, while its GUI stays on your computer. The remote machine owns its
AliceProjects, Workspaces, Agent processes, credentials, and optional trading
services. The local CLI owns the GUI relay and its single selected target.
The lifecycle and security details live in [[docs/remote-access.md]].

## 1. Install the local CLI

```bash
curl -fsSL https://openalice.ai/install | bash
```

Run the shell activation command printed by the installer, then verify the CLI:

```bash
openalice --version
```

The SSH target needs OpenSSH access and the platform prerequisites for the
native OpenAlice release. OpenAlice uses your normal SSH keys, host verification,
ports, and `ProxyJump` configuration. It does not install Agent Runtime CLIs.

## 2. Register a Machine

Give the target an SSH alias if useful, then verify that ordinary SSH works:

```sshconfig
Host openalice-box
  HostName server.example.com
  User alice
  IdentityFile ~/.ssh/id_ed25519
```

Start `openalice`, open its Web GUI, then go to Settings → General → Machines.
Choose **Add Machine**, enter `openalice-box` and `Cloud`, and probe the target.
The preview lists the exact remote actions before you approve registration.
You can also use the CLI:

```bash
ssh openalice-box
openalice --remote openalice-box --plan
openalice machine add openalice-box --label "Cloud"
```

`--plan` is read-only. `machine add` probes the host, shows and confirms the
required install/start actions, checks Runtime health, then saves the SSH
profile. Use `--yes` only when you have already reviewed those actions. An
arbitrary SSH address is not a GUI target until it has passed this registration.
The matching native OpenAlice release is installed on the target when needed;
Agent Runtime executables and SSH credentials remain user-owned. An existing
Machine can be probed and upgraded from the same Settings section.

## 3. Select the remote AliceProject

Run `openalice`. Its TUI starts the local Web relay. Open the Web GUI from the
TUI, then choose **Cloud** and one of its running AliceProjects in Settings →
General → Where Alice is working. The same selection is shared by browser tabs
using that relay. For a GUI without the TUI, run `openalice relay`.

The browser always stays on the local relay origin. The relay opens and owns the
SSH loopback tunnel to the selected backend. Switching to another Machine or
AliceProject does not stop the previous Runtime. Closing the browser does not
stop the remote Runtime; closing the local relay ends its tunnel.

## Everyday controls

```bash
openalice machine list
openalice machine inspect Cloud
openalice --machine Cloud status --json
openalice --remote openalice-box --status
openalice --remote openalice-box --stop
```

`--machine` routes a command through a saved, enabled profile. `--remote`
remains available for read-only planning and explicit status/stop controls; its
old one-off browser attach is retired. `machine disable` prevents new selection
without stopping an already-running remote Runtime.

Never publish the remote Runtime port directly or disable authentication for
remote access. Durable data belongs under the remote AliceProject home. If that
machine is ephemeral, mount that home on persistent storage. For explicit
source-checkout or custom-home setup, see [[docs/remote-access.md]].
