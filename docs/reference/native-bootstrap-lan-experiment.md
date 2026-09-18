# Native Bootstrap LAN experiment

**Date:** 2026-09-16
**Status:** native protocol accepted on Windows x64 and Linux x64; four target-native runs remain pending
**Scope:** non-trading OpenAlice CLI deployment to Windows and Linux over an ordinary LAN

## Question

Can an external coding Agent take a canonical OpenAlice source URL, identify an
unknown target without PowerShell, install an accepted native release, arrange
per-user persistence, survive the transport session ending, and return evidence
from the product itself rather than treating a script exit code as deployment?

## Test topology

| Role | Environment | Address or identity |
|---|---|---|
| Coordinator | OpenAlice development workstation | Windows 11 x64 |
| Windows target | `DESKTOP-AL7MNNO` | `192.168.20.42`, local user `14974` |
| Linux target | WSL2 user-systemd guest | Linux x86_64 |
| Product candidate | Official beta `0.93.1-beta` | GitHub/CDN native CLI assets |

No broker account, trading permission, credential, or live trading operation was
loaded. Both temporary native deployments were removed after acceptance. The
pre-existing Windows deployment was restored and left running.

## Deployment models covered

This experiment validates the **native host** model. It does not validate the
Docker image, packaged Electron app, or source-development workflow. Docker has
its own image, volume, healthcheck, bundled Agent runtimes, and acceptance path;
it does not use the platform persistence adapters tested here.

| Native target | Persistence design | Acceptance status |
|---|---|---|
| Windows x64 | Per-user Task Scheduler logon task | Accepted on a physical LAN target |
| Windows ARM64 | Same Task Scheduler adapter and ARM64 release contract | Target-native run pending |
| Linux x64 | Enabled `systemd --user` foreground service | Accepted in a WSL2 user-systemd guest |
| Linux ARM64 | Same user-systemd adapter and ARM64 release contract | Target-native run pending |
| macOS x64 | Per-user LaunchAgent in `gui/<uid>` | Target-native run pending |
| macOS ARM64 | Per-user LaunchAgent in `gui/<uid>` | Target-native run pending |

The macOS design intentionally follows the logged-in user lifecycle: it is a
LaunchAgent with `RunAtLoad`, not a root LaunchDaemon. The Linux design follows
the user systemd lifecycle: Bootstrap enables the unit, but an unattended host
must already keep that user manager alive outside login sessions. Windows uses a
least-privilege logon task. These are three adapters for one native transaction,
not three unrelated installers.

## Procedure and observations

### 1. Detect the target without PowerShell

Windows was probed with only `cmd.exe` and native environment variables:

```text
cmd.exe /d /s /c "echo __OA_OS__=windows&echo __OA_ARCH__=%PROCESSOR_ARCHITECTURE%&echo __OA_ARCH6432__=%PROCESSOR_ARCHITEW6432%"
```

The probe returned Windows `10.0.26200` and AMD64, normalized to `win32-x64`.
The POSIX probe used `/bin/sh`, `uname -s`, and `uname -m`; it returned Linux
x86_64, normalized to `linux-x64`. This is enough information to select a
cold-start Bootstrap and CLI archive. Package-manager, Node, Bun, and Agent
Runtime discovery are not target-identification prerequisites.

### 2. Bind exact product bytes

| Target | Archive SHA-256 | Payload content identity |
|---|---|---|
| Windows x64 | `1a5f058b2fba79a0b35018a259bcb4007143336d7d3a2fce9dea910bd3c7ada2` | `3368d23ed44020b5` |
| Linux x64 | `51c57e41f4873a28db888edfad52c202989cba16600da43917b76d5ff8946a49` | `7b9e7793ef9b9662` |

The archive digest binds transport bytes. The content identity binds the native
payload manifest: executable, UI, default assets, templates, modes, sizes, and
symlink targets. Both values matter; a version string alone is not an artifact
identity.

### 3. Exercise Windows persistence

Native acceptance used an install root containing spaces and isolated port
`47334`. The read-only plan reported `mutations: false`; apply returned
`status: "installed"`; and a second apply returned `status: "unchanged"`.
The receipt bound the accepted archive digest, content identity, immutable
release, Task Scheduler manager, and product-reported endpoint. The accepted
Runtime was PID `14684`.

The task definition is UTF-16LE with a BOM, resolves the current user by SID
through `whoami.exe /user /fo csv /nh`, and directly supervises the native
`openalice.exe server run` process. Its action contains neither `cmd.exe` nor
PowerShell. Five red acceptance and review failures materially tightened the
implementation: quoted batch invocation through Node corrupted `cmd.exe`
arguments; Task Scheduler rejected UTF-8 task XML; detached `server start` was
the wrong service-manager ownership model; the machine's pre-existing global
task name had to be isolated before testing; and persistence replacement needed
a fail-closed ownership check plus rollback that restarts the prior task. The
final harness removed the native test deployment and restored the prior
`~/.openalice` task. Product status then reported the original Runtime running
on port `47332` as PID `14520`.

### 4. Exercise Linux persistence and disconnect survival

The Linux acceptance used a second install root containing spaces and port
`47335`. Bootstrap registered an enabled user unit with `Type=simple` and
foreground `openalice server run` ownership. A separate WSL2 invocation then
reported the unit both enabled and active and returned native Runtime class
`running` from the same PID `346`. Apply returned `installed`, repeat apply
returned `unchanged`, and the receipt bound the Linux archive and content
identity. The unit and installation were disabled and removed after evidence was
copied out. This separated control transport from Runtime ownership: the invoking
session may end without owning or killing the deployed product.

### 5. Repeat the transaction

The compatibility script reused the same immutable release but still printed an
“Installed” result and refreshed `installedAt`. That is operationally misleading:
repeated convergence is not a new install, and provenance should identify the
original materialization time. The native Bootstrap therefore returns
`status: "unchanged"` and preserves the existing provenance document when all
artifact fields agree.

## Decision

The formal deployment protocol is now native Bootstrap-driven. Shell and
PowerShell installers remain compatibility surfaces for existing users, package
flows, updates, and recovery; they are no longer the protocol an Agent should
choose for a new target.

The boundary is intentionally narrow:

1. the external Agent owns connectivity, target probing, channel resolution,
   downloads, protected prompts, and any dependency remediation;
2. the cold-start Bootstrap owns local verification, installation, activation,
   persistence registration, readiness, rollback, and the final receipt;
3. the installed native CLI owns Runtime status and the usable endpoint; and
4. OpenAlice never embeds or silently installs another Agent Runtime.

This keeps the Bootstrap deep: one small executable provides one transactional
operation instead of exposing platform-specific copy, pointer, service, and
rollback steps to every Agent.

## Acceptance contract

A deployment is accepted only when all of the following are true:

- the Bootstrap executable matches the manifest SHA-256;
- release publication verifies the executable container and architecture and
  rejects a missing or incomplete current six-target Bootstrap matrix;
- the CLI archive matches its trusted SHA-256;
- platform, architecture, release version, payload identity, and complete file
  inventory verify before activation;
- dynamic launcher verification succeeds after activation;
- the selected persistence manager starts the Runtime, unless explicitly disabled;
- `openalice server status --json` reports `class: "running"`; and
- `<install-root>/deployment/latest.json` records the exact artifact, command,
  persistence manager, verification time, and endpoint.

An Agent log, process exit code, fixture response, or service-manager state without
native Runtime status is insufficient evidence.

## Alternatives considered

### Continue expanding Bash and PowerShell

Rejected as the formal protocol. Two large scripts duplicate archive validation,
activation, rollback, and quoting rules. PowerShell also becomes an unnecessary
bootstrap dependency on Windows and obscures cross-platform receipt semantics.

### Put deployment orchestration inside the installed CLI

Rejected for cold start. The installed CLI does not exist yet. The standalone
Bootstrap is small enough to verify and execute before an installation while
reusing the same release and activation contracts.

### Embed an Agent Runtime in OpenAlice

Rejected. Users normally arrive with an external Agent already supervising the
machine. Bundling an Agent Runtime would conflate product installation with model
credentials, provider policy, and a second lifecycle owner.

### Treat service registration as a follow-up

Rejected for formal deployment. “Files copied” is not “deployed.” Persistence and
product-reported readiness must be inside the same rollback-aware transaction.

## Residual risk and follow-up evidence

- macOS LaunchAgent behavior is covered by contract tests but still requires a
  target-native acceptance run before release promotion;
- Windows Task Scheduler and Linux user-systemd acceptance must be rerun with each
  release candidate, because mocked adapters cannot prove OS quoting or policy;
- historical stable/beta manifests may contain no native Bootstrap entries; the
  compatibility installers remain the explicit fallback for those releases; and
- installation does not prove an external Agent Runtime is installed or logged in.
  That remains an Agent-guided onboarding step after OpenAlice is reachable.

## Resulting implementation surfaces

- `packages/cli/src/native-bootstrap.mjs` — transaction and deployment receipt
- `packages/cli/src/bootstrap-service.mjs` — target normalization and persistence
- `scripts/build-native-bootstrap.ts` — target-native cold-start build and sidecar
- `scripts/prepare-cli-dev-assets.mjs` — immutable dev Bootstrap publication
- `scripts/prepare-desktop-release-assets.mjs` — stable/beta Bootstrap manifest
- `docs/cli-installer.md` — authoritative deployment contract
