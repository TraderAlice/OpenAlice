# Shell CLI Supervisor

This guide owns the computer-level `openalice` command surface above Guardian:
background and foreground lifecycle, status presentation, browser opening,
machine-readable envelopes, shell completion, compatibility aliases, and the
boundary of the planned Supervisor TUI.

Installer transactions belong to [[docs/cli-installer.md]]. Source preparation
and the future headless bundle provider belong to [[docs/local-runtime.md]].
Remote orchestration belongs to [[docs/remote-access.md]]. Guardian lock,
takeover, and process-tree truth belong to [[docs/project-structure.md]] and
`packages/guardian-runtime/`.

The active multi-increment TUI and headless-release work is tracked in
[[plans/shell-first-cli-supervisor.md]]. This guide describes only behavior
already shipped in the current tree.

## Product Boundary

The Shell Supervisor controls the local OpenAlice Runtime. It does not reproduce
the OpenAlice Web product:

```text
openalice lifecycle command
  -> presentation-neutral lifecycle core
      -> Guardian control endpoint and lease
          -> Alice + optional UTA + optional Connector

browser / Electron
  -> product interaction
```

Lifecycle commands do not edit Workspaces, credentials, broker state, trading
permissions, or product configuration. Browser closure and shell exit do not
stop a detached Runtime.

## Canonical Lifecycle Commands

The top-level lifecycle surface is:

```bash
openalice up [path] [options]
openalice run [path] [options]
openalice down [options]
openalice status [options]
openalice logs [options]
openalice doctor [options]
openalice open [options]
```

| Command | Contract |
|---|---|
| `up` | Prepare the source provider when needed, start `cli-server` detached, and return only after Guardian control plus Alice HTTP readiness |
| `run` | Start the same `cli-server` owner in the foreground without opening a browser; normal Ctrl+C/SIGTERM stops that self-owned tree |
| `down` | Ask a matching Guardian to stop itself, then wait for endpoint and ownership release |
| `status` | Read normalized status without mutation |
| `logs` | Read a bounded, redacted tail from safe Runtime log rotations |
| `doctor` | Run read-only provenance, ownership, readiness, component, provider, update-metadata, and log-layout checks |
| `open` | Require an advertised Web endpoint and a successful `/api/auth/status` probe before invoking the platform browser opener |

`up` is idempotent for an already healthy matching owner. `down` is idempotent
when no owner exists. Ordinary start never signals another owner. `--takeover`
delegates replacement to Guardian's established discover, TERM, grace, KILL,
wait, then acquire ordering.

Stable installs use the verified bundle provider. `up` and `run` remain
browserless lifecycle commands and accept home, port, wait, and takeover
options; `--app-dir` is an advanced source override with the preparation and
rebuild options documented in [[docs/local-runtime.md]]. `--open` performs a
separate verified browser open after readiness.

## Default and Compatibility Surface

- bare `openalice` enters the local Supervisor TUI;
- `openalice tui` is the explicit equivalent for tests and scripts;
- `openalice start` retains the existing foreground, browser-oriented
  compatibility launcher and also selects the installed bundle by default;
- `openalice server run|start|status|stop` remains available for managed remote
  and existing scripts;
- new code uses `run|up|status|down`;
- `server status --json` retains its legacy raw status payload.

The top-level commands and the `server` compatibility surface launch the same
`cli-server` Guardian owner. They are presenters over one lifecycle rather than
separate daemons.

The TypeScript TUI reports and polls the selected Runtime, detaches with `q`,
`Esc`, or `Ctrl+C`, and exposes the same presentation-neutral operations as the
explicit commands. Its ordinary path is intentionally parameter-free:

- Enter starts the persistent Runtime and opens the verified Web endpoint when
  stopped, or opens the endpoint when already running;
- `s` starts the persistent Runtime in the background without opening a
  browser;
- `o` opens an advertised, verified Web endpoint;
- `x` stops and `r` restarts only a `cli-server` owner, after an impact
  confirmation;
- `l` reads the bounded, redacted log tail;
- `d` runs read-only Doctor checks;
- `u` performs an advisory product-update check;
- `i` lists the implicit default plus registered instances, selects one without
  stopping another instance, or creates a separate named complete home;
- `p` opens Setup for data home, browser port, update checks, and resolved
  Runtime/config provenance. Setup can edit either the selected instance or
  machine defaults inherited by instances;
- `m` is an advanced control that confirms, prepares, remembers, and starts an installer-managed source
  aligned to the installed CLI branch/version;
- `c` is an advanced control that chooses and remembers the selected instance's source checkout;
- `?`, Tab, and the horizontal arrows expose help and detail panels.

The TUI refuses to stop or restart Electron, development, incompatible, or
otherwise foreign owners. Its stop/restart confirmation states that active Web
and agent sessions will disconnect. Detaching never implies stopping. Update
discovery runs in the background and cannot block lifecycle controls.

The installed Runtime is the default provider below stored configuration and
above cwd discovery. TUI start therefore works from any directory and shows a
small ordinary action bar. A configured instance source,
`OPENALICE_APP_HOME`, or `--app-dir` overrides the bundle; `m` and `c` remain
advanced source controls. The managed source path is
`<install root>/sources/<install-source identity>/OpenAlice`.

For an older or development install without a bundled Runtime, Enter still
owns the ordinary path. If current-directory source discovery fails, it reads
the installed branch/version provenance and opens the same managed-source
confirmation as `m`; accepting prepares and remembers that source, starts
OpenAlice, and opens the browser. `c` remains the explicit manual-checkout
path. A source-run CLI with no installed provenance falls back to the source
path editor instead of pretending it can manage an install root.

## TUI Launch Context

The TypeScript entry resolves launch-affecting values before starting terminal
raw mode. Bare `openalice` and `openalice tui` accept:

```text
--instance <name>
--home <path>
--port <port>
--app-dir <path>
--no-update-check
--update-check
```

Resolution order is defaults, installed Runtime, machine Supervisor
configuration, selected instance configuration, environment, then explicit CLI
flags. The immutable
resolver retains field provenance for every layer. Before terminal raw mode,
the Supervisor reads a versioned machine-local document at
`<Supervisor root>/config.json`. It contains machine defaults and an instance
map outside every selectable complete home.

The `p` Setup overlay atomically edits the selected instance's data home,
browser port, and update-check policy. Its first row switches between `This
instance` and `Machine defaults`. A blank Home or port and the `Inherit` update
value remove that layer's override, exposing the next lower-priority value
immediately. Named instances must retain an explicit, separate complete home;
only the implicit `default` may inherit its Home. Home and port remain
read-only while the selected Runtime is active when the edited layer affects
that Runtime. A machine default may still be changed while a higher instance,
environment, or flag layer shields the running instance.

Any selected-instance value supplied by an environment variable or explicit
CLI flag is shown with its resolved value and a locked provenance message; the
TUI never writes a lower-priority instance value that appears to override it.
Machine-default editing remains available because it intentionally changes the
lower layer for future or inheriting launches. The overview reports the
resolved field provenance, and Setup identifies the installed Runtime by the
single OpenAlice product version plus diagnostic content identity rather than
presenting its filesystem path as a second product concept.

The `i` instance overlay reads the same atomic registry, always shows the
implicit `default`, and adds every configured named instance. Selecting one
switches the live Supervisor view and records it as the next bare-start
default; it does not stop, move, copy, or delete another instance. Creating an
instance collects a validated lowercase name and separate complete home
inside the TUI, rejects equal or nested registered homes, and selects the new
entry atomically. An existing target must be empty or recognizable as an
OpenAlice complete home; an unrelated non-empty directory is rejected. A new
target is created and canonicalized when registered, so a later missing
registered Home is never silently recreated. A bare TUI launch falls back to
the first available instance, keeps the unavailable registry entry intact,
and shows a persistent notice directing the user to `i Instances`; selecting
the displayed fallback repairs the remembered default. An explicit
environment/flag selection still fails instead of falling back because
automation must never run against a different Home. The suggested Home is a
sibling such as
`~/.openalice-research` and remains editable before creation. A session whose
instance or complete home came from `OPENALICE_INSTANCE`,
`OPENALICE_HOME`, `--instance`, or `--home` shows the registry read-only
instead of pretending that a lower-priority selection can win.

The `c` editor validates an OpenAlice checkout, atomically saves it as the
selected instance's `appDir`, and starts the Runtime. If
`OPENALICE_APP_HOME` or `--app-dir` supplied the source, the TUI reports that
higher-priority override instead of overwriting it. `openalice config check`,
live reload with last-known-good retention, registry-entry removal, and full
component/instance dashboards remain later increments.

`OPENALICE_INSTANCE`, `OPENALICE_HOME`, `OPENALICE_WEB_PORT`,
`OPENALICE_APP_HOME`, and `OPENALICE_NO_UPDATE_CHECK` are the corresponding
environment overrides. `OPENALICE_SUPERVISOR_HOME` may relocate the
machine-wide Supervisor root, which remains outside every selectable complete
home. Installer launchers supply the lower-priority internal pair
`OPENALICE_MANAGED_RUNTIME_PATH` and
`OPENALICE_MANAGED_RUNTIME_CONTENT_IDENTITY`; ordinary users do not need to set
them.

Only an installer-owned Runtime carrying `OPENALICE_MANAGED_PI_PATH` receives
instance-private `PI_CODING_AGENT_DIR` and `PI_CODING_AGENT_SESSION_DIR`
values. Source development and an external Pi retain their native user
configuration and session roots.

The same stored resolver selects homes for `up`, `run`, `down`, `status`,
`open`, `logs`, and `doctor`; those commands also accept
`--instance <name>` and load a Home registered through the TUI.
Consequently a Runtime started through the TUI and one started by
`openalice up` receive the same managed-Pi environment, source, Web-port
policy, and update-check setting unless an explicit command option overrides
them. The transitional `start` and `server` compatibility presenters still
own their legacy option parsing and output until the root parser conversion is
complete.

An inherited default Web port remains automatic for the source-backed built
Guardian: it probes upward from 47331 together with unconfigured
MCP/local-tool, UTA, and Connector ports. Consequently multiple complete homes
or the desktop app may occupy historical defaults without breaking a CLI
Runtime. A machine/instance setting, environment value, or explicit flag pins
the Web port and fails visibly on collision, as do explicit internal
environment or `data/config/ports.json` values. Stop and restart wait for
Guardian plus Alice ownership evidence to clear, not merely for the control
socket to disappear.

## Presentation-neutral Core

`packages/cli/src/lifecycle.mjs` owns:

- complete-home resolution;
- idempotent matching-owner discovery;
- source-provider preparation;
- detached or foreground Guardian spawn;
- readiness and early-exit handling;
- structured start results and lifecycle events;
- graceful stop delegation;
- verified Web opening.

It returns structured values and does not decide human or JSON wording.
`packages/cli/src/lifecycle-command.mjs` owns top-level parsing, presentation,
help, completion, and JSON envelopes. `packages/cli/src/server.mjs` is the
legacy presenter.

Source preparation may emit bounded progress through an output sink supplied by
the presenter. Lifecycle truth still comes only from Guardian control and
readiness probes; human progress or log text is never parsed as state.

## Machine-readable Contract

Top-level `up`, `down`, and `status` accept `--json`. Successful output uses:

```json
{
  "schemaVersion": 1,
  "command": "status",
  "ok": true,
  "result": {
    "status": {}
  }
}
```

Runtime failures after parsing use the same envelope on stderr:

```json
{
  "schemaVersion": 1,
  "command": "down",
  "ok": false,
  "error": {
    "code": "EOWNED",
    "message": "..."
  }
}
```

The nested normalized status retains Guardian transport/control compatibility,
lifecycle class, product version, provider identity, pending activation,
bounded uptime, selected home, sanitized owner, loopback Web endpoint,
component summary/detail, capabilities, and safe diagnostic detail.
`runtimeVersion` remains as a compatibility alias while `productVersion` is
the user-facing release identity. Status never includes lock tokens,
credentials, internal ports, or arbitrary environment values.

Exit behavior is:

- `0`: the requested action completed, including already-running `up`,
  already-absent `down`, or a successfully inspected non-running status;
- `1`: Runtime, control, readiness, browser, or other operational failure;
- `2`: invalid lifecycle syntax, option, shell name, or root command.

Scripts determine running versus absent from the status class, not from a
special nonzero `status` exit.

## Human Status

Human `status` reports:

- lifecycle class and selected complete home;
- running Runtime product version when available;
- owner surface and PID;
- verified advertised Web URL;
- Alice, UTA, and Connector state;
- source launch root and safe diagnostic detail when available.

An Electron-owned or dev-owned Runtime may be inspected and opened, but
`down` refuses it. Only a matching `cli-server` that advertises
`runtime.stop` accepts the stop transaction.

## Control Compatibility

Guardian control uses one local JSON-line request and response per connection.
The transport envelope remains `protocol: 1`. Compatible additions do not bump
that number: older clients ignore unknown result fields and newer clients
default missing additive metadata to control API 1.

Normalized status includes:

```json
{
  "protocol": 1,
  "control": {
    "apiVersion": 1,
    "minClientApiVersion": 1,
    "capabilities": ["runtime.status", "runtime.stop"]
  }
}
```

The CLI must check an advertised capability before requesting an optional
mutation. A future server whose `minClientApiVersion` is newer than the CLI is
reported as `incompatible`; the CLI does not guess at stop semantics. A
breaking framing or response-envelope change requires a transport protocol
bump. Cross-version fixtures preserve both directions: the current client
normalizes the legacy protocol-1 result, and a legacy request reads the
additive current result.

## Logs

`openalice logs` reads only regular `server.log` and `server.log.<rotation>`
files inside `<home>/logs`. Symlinked directories/files and unrelated names are
rejected or ignored. Reads are bounded to ten recent rotations, 256 KiB per
file, 1 MiB total, and 5,000 requested lines. It never follows arbitrary paths.

Before terminal or JSON output, the reader redacts common authorization,
token, API-key, password, private-key, sealing-key, and first-run admin-token
forms. Terminal control bytes are escaped. Redaction is a defense-in-depth
safety net; Runtime logs can still contain private product or trading context
and should not be published blindly.

The current command is a snapshot tail:

```bash
openalice logs --lines 200
openalice logs --lines 200 --json
```

Follow, pause, component filtering, and TUI log navigation belong to the later
Logs/TUI increment and must reuse this bounded reader.

## Doctor

`openalice doctor` is read-only. It performs no install, update discovery
network request, takeover, restart, configuration write, credential read, or
broker action. It checks:

- CLI product version, install source, and installed content identity;
- the Node.js minimum;
- Guardian ownership, control compatibility, and lifecycle state;
- the advertised loopback Web endpoint with a bounded auth-status probe;
- Alice, UTA, and Connector state;
- source-provider version and required built artifacts, or advertised bundle
  content identity;
- locally cached stable-update metadata;
- safe Runtime log discovery.

Human output uses explicit PASS/WARN/FAIL rows. JSON uses the same versioned
root envelope as lifecycle commands. A completed Doctor run exits `1` when it
contains failures, `0` for healthy or warning-only results, and `2` for invalid
syntax.

## Shell Completion

Completion is generated from the root command registry:

```bash
openalice completion bash
openalice completion zsh
openalice completion fish
openalice completion powershell
```

The command prints to stdout and never edits shell configuration. The root
commands and lifecycle option names share the same registry used by generated
completion; detailed shell installation remains user-owned.

## Load-bearing Files

- `packages/cli/bin/openalice.ts` and `packages/cli/src/main.ts` — TypeScript
  application entry and default-TUI/explicit-command dispatch.
- `packages/cli/src/launch-context.ts` — immutable launch precedence,
  provenance, instance roots, and managed-Pi environment projection.
- `packages/cli/src/supervisor-config.ts` — versioned machine/instance
  configuration parsing, atomic persistence, and stored-context resolution.
- `packages/cli/src/managed-source.ts` — local managed checkout identity,
  validation, collision safety, and atomic preparation.
- `packages/cli/src/supervisor-tui.ts` — `pi-tui` Supervisor application shell.
- `packages/cli/src/pi-tui-loader.ts` — workspace and installed managed-Pi TUI
  resolution.
- `packages/cli/bin/openalice.mjs` — transitional presenter for existing
  non-interactive commands while their source moves to TypeScript.
- `packages/cli/src/lifecycle.mjs` — presentation-neutral lifecycle.
- `packages/cli/src/lifecycle-command.mjs` — canonical command parsing and
  presentation.
- `packages/cli/src/logs.mjs` — bounded log discovery, tailing, control-byte
  escaping, and credential redaction.
- `packages/cli/src/doctor.mjs` — read-only structured diagnostic checks.
- `packages/cli/src/observability-command.mjs` — logs/Doctor parsing and
  human/JSON presentation.
- `packages/cli/src/server.mjs` — legacy `server` presenter.
- `packages/cli/src/server-control.mjs` — local control client and normalized
  status.
- `scripts/guardian/control-server.mjs` — Guardian control server.
- `scripts/guardian/prod.mjs` — built Runtime owner/status source.
- `packages/cli/src/lifecycle{,-command}.spec.mjs` — lifecycle and presentation
  contracts.
- `packages/cli/src/server{,-control}.spec.mjs` — compatibility and control
  contracts.

## Verification

For command-only changes:

```bash
pnpm -F @traderalice/openalice-cli test
npx tsc --noEmit
pnpm test
```

For launcher ownership or takeover changes:

```bash
pnpm test:guardian-recovery
```

For a distributed payload change:

```bash
pnpm test:install:docker
```

Manually use an isolated home and unused port to walk:

```bash
openalice up --home <temporary-home> --port <unused-port>
openalice status --home <temporary-home>
openalice status --home <temporary-home> --json
openalice open --home <temporary-home>
openalice down --home <temporary-home>
```

Verify the real `/api/auth/status` and root page after `up`, prove the Runtime
survives the starting shell, and prove `down` leaves no Guardian/Alice child.
When shared Runtime or dependency topology changes, add the matching Electron
PTY/package smoke even though this CLI does not own Electron.
