# Shell CLI Supervisor

This guide owns the computer-level `openalice` command surface above Guardian:
background and foreground lifecycle, status presentation, relay GUI opening,
machine-readable envelopes, shell completion, compatibility aliases, and the
boundary of the Supervisor TUI.

Installer transactions belong to [[docs/cli-installer.md]]. Source preparation
and the native headless bundle provider belong to [[docs/alice-project.md]].
Remote orchestration belongs to [[docs/remote-access.md]]. Guardian lock,
takeover, and process-tree truth belong to [[docs/project-structure.md]] and
`packages/guardian-runtime/`.

## Product Boundary

The Shell Supervisor controls the local OpenAlice Runtime; it does not
reproduce the Web product. Lifecycle start/stop commands do not edit
Workspaces, broker state, trading permissions, or product configuration.
`project copy-ai-creds` is the explicit exception that merges one complete
home's AI vault into another. Browser closure and shell exit do not stop a
detached Runtime.

## Canonical Lifecycle Commands

```bash
openalice up [path] [options]
openalice run [path] [options]
openalice down [options]
openalice status [options]
openalice logs [options]
openalice doctor [options]
openalice relay [--port <port>] [--no-open]
openalice create alice-project [options]
openalice project [list|use|copy-ai-creds|transfer] [options]
openalice machine [list|add|rename|enable|disable|remove|inspect] [options]
```

Remote selectors and Machine preparation are defined in
[[docs/remote-access.md]].

Startup selection uses the current machine's **Default** pair in
`Supervisor/config.json.defaultTarget`. Only successful user attachment
changes it; restore, reconnect, polling, inventory, create and start do not.
`project use` explicitly changes this same Default. Implicit lifecycle
commands resolve the pair on the origin and send an explicit project over SSH;
the remote machine's own Default is never consulted. Lifecycle inspection
compares the installed native content identity with the running Guardian
provider; `status`, TUI polling, and an idempotent `up` expose a pending
activation when they differ.

| Command | Contract |
|---|---|
| `create alice-project` | Register a named complete home (`--name`, `--home`, optional `--product trader\|nano`). Product is immutable birth (Trader default; Nano never starts UTA). |
| `project list` / `use` | List registered AliceProjects and the local default; `use` records the local lifecycle default without starting, stopping, or copying anything. |
| `machine list/add/rename/enable/disable/remove` | Local SSH Machine profile registry; `add` prepares the remote Server then atomically saves the profile; remove never deletes remote data. `--json` is secret-free. |
| `machine inspect` | Typed Machine → AliceProject inventory; one bounded aggregate SSH command per enabled Machine. |
| `project copy-ai-creds` | Copy AI credential rows between complete homes. Matching vendor+key rows skipped; colliding slugs renamed. Workspace launch prefs, broker accounts, and `sealing.key` never copied; secrets never printed. |
| `project transfer` | Copy a stopped local AliceProject to a new Home on a registered SSH Machine. Portable config and Workspace/Git state transfer; Session/runtime/auth state does not. Credentials are re-sealed with a new remote key. Defaults unchanged. |
| `up` | Prepare the selected provider, start `cli-server` detached, return only after Guardian control plus Alice HTTP readiness. Idempotent for an already healthy matching owner. |
| `run` | Same `cli-server` owner in the foreground; Ctrl+C/SIGTERM stops that self-owned tree. |
| `down` | Ask a matching Guardian to stop itself, then wait for endpoint and ownership release. Idempotent with no owner. Ordinary start never signals another owner; `--takeover` delegates to Guardian's discover → TERM → grace → KILL → acquire ordering. |
| `status` | Read normalized status and activation state without mutation. |
| `logs` | Bounded, redacted tail from safe Runtime log rotations. |
| `doctor` | Read-only provenance, ownership, readiness, component, provider, update-metadata, and log-layout checks. |

For direct Bash installs, first successful readiness confirms the installer's
activation receipt; a first-start failure restores the exact retained pointer
without touching user data. A package-manager install is only reported as
pending because its manager owns the package files.

## Default and Compatibility Surface

- bare `openalice` enters the local Supervisor TUI and starts its Web relay;
  `openalice tui` is the explicit equivalent for tests and scripts;
- `openalice relay` runs the same Web controller without TUI presentation;
- old `openalice start` / `openalice open` shortcuts are retired and fail with
  replacement guidance;
- `openalice server run|start|status|stop` remains the compatibility surface
  for managed remote and existing scripts; `server status --json` retains its
  legacy raw payload;
- new code uses `run|up|status|down`. All surfaces launch the same
  `cli-server` Guardian owner.

TUI selection and Settings operate one relay target. Detaching (`q`, `Esc`,
`Ctrl+C`) closes the relay and its SSH tunnel, not the selected Runtime.

## TUI Presentation Invariants

- The TUI owns an alternate-screen canvas and restores screen, cursor, and
  mouse modes on detach or signal exit. Color-capable sessions paint the full
  viewport width so the host background can never bleed through. `NO_COLOR`,
  `TERM=dumb`, `OPENALICE_TUI_COLOR=0` opt out of decorative color without
  removing state text; `OPENALICE_TUI_DARK_CANVAS=0` returns the background to
  the host; `OPENALICE_TUI_MOUSE=0`, `OPENALICE_TUI_MOTION=0`, and
  `OPENALICE_TUI_BOOT=0` disable mouse reporting, motion animation, and the
  boot sequence respectively; `OPENALICE_TUI_START_VIEW=home` opens Home.
- All color-capable rendering consumes the semantic palette in
  `supervisor-tui-palette.ts` — the single owner for canvas, text, accents,
  lifecycle states, and rails. Never embed ANSI RGB literals; palette contrast
  tests keep text/surface pairings ≥ 4.5:1.
- The pre-connection Launcher resolves one launch intent; offline, blocked,
  or endpoint-less targets promote Refresh instead of a stale Start. During
  start or SSH connection a non-interactive Flight Recorder owns input; `q`
  can always detach.
- The connected workbench has exactly one active target; the command spine
  names Machine, AliceProject, transport, and Runtime signal on every page.
  Selecting another target closes the previous TUI-owned SSH forward; remote
  `x` Disconnect closes only the forward, never the remote Runtime.
- Target health is independent from tunnel ownership: a bounded
  `/api/auth/status` probe degrades an SSH target after one failed check and
  marks it unreachable after three, without closing the forward; only an
  authoritative absent result returns to the Launcher.
- Setup (`p`) and AliceProjects (`i`) overlays render over the same atomic
  configuration paths; pointer input is column-bounded, and there is no
  second persistence path.

## TUI Launch Context

Bare `openalice` and `openalice tui` accept `--project`, `--instance`
(deprecated alias), `--home`, `--port`, `--app-dir`, `--no-update-check`,
`--update-check`. Resolution order is defaults, installed Runtime, machine
Supervisor configuration, selected AliceProject configuration, environment,
then explicit CLI flags; the immutable resolver retains field provenance for
every layer.

Before terminal raw mode, the Supervisor reads a versioned machine-local
document at `<Supervisor root>/config.json` (machine defaults plus an
AliceProject map outside every selectable complete home). The same root may
contain `machines.json`, a separate versioned SSH Machine registry not
selected by `OPENALICE_HOME`, kept separate from the hashed
`remote-targets.json` tunnel-port cache. Writes are atomic and owner-private;
unknown additive fields survive rewrites; invalid known fields or a newer
`schemaVersion` fails visibly.

- If `config.json` cannot be parsed, bare `openalice` still opens a
  machine-level shell in Config recovery: no guessed project is inspected,
  started, or stopped. Explicit `--project`/`--home` still fails rather than
  silently targeting another home — automation must never run against a
  different Home.
- Setup (`p`) atomically edits the selected AliceProject's data home, port,
  and update-check policy in machine-default/per-project layers; blank or
  `Inherit` removes an override. Home/port are read-only while the affected
  Runtime is active. Environment- or flag-supplied values are locked; the TUI
  never writes a lower-priority value that appears to override them.
- AliceProjects (`i`) attaches a project and records it as the next bare-start
  Default only after successful connection; it never
  stops/moves/copies/deletes another project. An existing target must be empty
  or a recognizable OpenAlice complete home. An unavailable remembered Default
  leaves the Runtime detached.
- Environment overrides: `OPENALICE_PROJECT`, `OPENALICE_HOME`,
  `OPENALICE_WEB_PORT`, `OPENALICE_APP_HOME`, `OPENALICE_NO_UPDATE_CHECK`,
  `OPENALICE_SUPERVISOR_HOME`. Installer launchers supply the internal
  `OPENALICE_MANAGED_RUNTIME_PATH` / `OPENALICE_MANAGED_RUNTIME_CONTENT_IDENTITY`.

An inherited default Web port remains automatic for the source-backed built
Guardian (probes upward from 47331 together with unconfigured internal
ports); creating an AliceProject and the first Alice `loadConfig()` must not
write a default into `data/config/ports.json` — a written `web` value is a
pin. Explicit settings pin the port and fail visibly on collision. Stop and
restart wait for Guardian plus Alice ownership evidence to clear, not merely
for the control socket to disappear.

## Presentation-neutral Core

`packages/cli/src/lifecycle.mjs` owns complete-home resolution, idempotent
matching-owner discovery, source-provider preparation, detached/foreground
Guardian spawn, readiness and early-exit handling, structured start results
and lifecycle events, graceful stop delegation, and verified Web opening. It
returns structured values and does not decide human or JSON wording.
`packages/cli/src/lifecycle-command.mjs` owns top-level parsing, presentation,
help, completion, and JSON envelopes; `packages/cli/src/server.mjs` is the
legacy presenter. Human progress or log text is never parsed as state.

## Machine-readable Contract

Top-level `up`, `down`, and `status` accept `--json`. Successful and runtime-
failure output share one envelope (failures on stderr):

```json
{
  "schemaVersion": 1,
  "command": "status",
  "ok": true,
  "result": { "status": {} }
}
```

Failure uses `"ok": false` with `error: { "code": "EOWNED", "message": "..." }`.
Nested normalized status retains Guardian control compatibility, lifecycle
class, product version, provider identity, pending activation, bounded uptime,
selected home, sanitized owner, loopback Web endpoint, component summary,
capabilities, and safe diagnostics. `runtimeVersion` remains a compatibility
alias; `productVersion` is the user-facing identity. Status never includes
lock tokens, credentials, internal ports, or arbitrary environment values.

Exit behavior: `0` action completed (including already-running `up`,
already-absent `down`); `1` operational failure; `2` invalid syntax/option.
Scripts determine running versus absent from the status class, not from a
special nonzero `status` exit.

## Human Status

Human `status` reports lifecycle class and selected home, product version,
owner surface and PID, verified Web URL, Alice/UTA/Connector state, and safe
diagnostics. Source dev and built Guardian entries publish the same private
`runtime.status` contract, so a second process is useful for read-only
`status`/Doctor/`open` even though a second writer start exits with the
existing-owner diagnostic. Dev owners never advertise `runtime.stop`.

## Control Compatibility

Guardian control uses one local JSON-line request/response per connection.
The transport envelope remains `protocol: 1`; compatible additions do not
bump it — older clients ignore unknown result fields. The CLI must check an
advertised capability (e.g. `runtime.stop`) before requesting an optional
mutation. A server whose `minClientApiVersion` is newer than the CLI is
reported as `incompatible`; the CLI does not guess at stop semantics. A
breaking framing change requires a transport protocol bump; cross-version
fixtures preserve both directions.

## Logs

`openalice logs` reads only regular `server.log` and `server.log.<rotation>`
files inside `<home>/logs`; symlinks and unrelated names are rejected.
Bounded to ten recent rotations, 256 KiB per file, 1 MiB total, 5,000
requested lines. Output is redacted (authorization, token, API-key, password,
private-key, sealing-key, first-run admin-token forms) and terminal control
bytes are escaped. Redaction is defense-in-depth; logs can still contain
private product/trading context. The TUI projects the same bounded snapshot
into an Event stream/Lens (`f` filter, `y`/OSC 52 copy capped at 24 KiB);
it is navigation over a snapshot, not a follower — follow/pause/component
filtering must reuse this bounded reader.

## Doctor

`openalice doctor` is read-only: no install, update network request,
takeover, restart, configuration write, credential read, or broker action.
It checks CLI identity and install source, execution engine (embedded Bun vs
Node minimum), Guardian ownership/control compatibility/lifecycle, loopback
Web endpoint (bounded auth-status probe), Alice/UTA/Connector state, source
provider or bundle identity, cached update metadata, and safe log layout.
Human output uses PASS/WARN/FAIL rows; JSON uses the versioned root envelope.
Exit `1` on any failure, `0` for healthy/warning-only, `2` invalid syntax.
The TUI renders the unchanged report as a checklist plus Inspector; it never
synthesizes a repair.

## Shell Completion

`openalice completion bash|zsh|fish|powershell` prints to stdout, generated
from the root command registry, and never edits shell configuration.

## Project capability CLI

`openalice exec [--project <key> | --home <path>] <alice|traderhub|alice-uta>:<command>`
invokes the running Project's manifest-driven CLI. Explicit Project/home
selection clears inherited Workspace attribution; Project-only calls never
construct a synthetic Workspace or invoke scoped collaboration tools. UTA
owns all trading writes. Alice publishes ephemeral `state/cli-endpoint.json`;
missing/stale endpoints fail (no port scanning, no Runtime start), and the
gateway checks Project identity per request. `--output` writes a new file;
diagnostics go to stderr.

## Load-bearing Files

- `packages/cli/{bin/openalice.ts,src/main.ts}` — TypeScript entry and
  default-TUI/explicit-command dispatch.
- `packages/cli/src/launch-context.ts`, `supervisor-config.ts`,
  `machine-registry.ts`, `machine-inventory.ts`, `machine-command.ts`,
  `managed-source.ts` — launch precedence/provenance, versioned machine and
  project configuration, SSH Machine registry/inventory, managed checkout.
- `packages/cli/src/supervisor-tui.ts`, `pi-tui-loader.ts` — TUI shell and
  managed-Pi TUI resolution.
- `packages/cli/src/lifecycle{,-command}.mjs`, `logs.mjs`, `doctor.mjs`,
  `observability-command.mjs`, `server{,-control}.mjs` — lifecycle core,
  command presentation, bounded logs, diagnostics, legacy presenter, control
  client.
- `scripts/guardian/{control-server,prod}.mjs` and
  `packages/guardian-runtime/src/{control-server,runtime-status}.ts` —
  Guardian control transport and status envelope.
- `packages/cli/src/*.spec.mjs` — lifecycle/presentation/compatibility/control
  contracts.

## Verification

```bash
pnpm cli                      # real interactive TUI
pnpm cli status --json
pnpm cli doctor
pnpm -F @traderalice/openalice-cli test
```

The source entry installs nothing. When `pnpm dev` already owns the selected
home, the TUI and read-only commands discover that live Runtime. Config-
recovery and in-TUI update work must keep the Supervisor config and TUI specs
green (parser preservation, distinct newer-schema errors, recovery gating).
For launcher ownership, takeover, or existing-owner browser handoff:
`pnpm test:system:guardian` and `pnpm electron:smoke:existing-owner`. For a
distributed payload change: `pnpm test:system:installer`. Manually walk
`up`/`status`/`relay`/`down` in an isolated home and unused port, verify the
real `/api/auth/status`, prove the Runtime survives the starting shell, and
prove `down` leaves no Guardian/Alice child.
