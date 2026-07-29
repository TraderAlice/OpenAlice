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

The current Runtime provider remains source-backed. `up` and `run` therefore
accept the checkout, preparation, rebuild, home, port, wait, and takeover
options documented in [[docs/local-runtime.md]]. `up` is browserless by default;
`--open` performs a separate verified browser open after readiness.

## Default and Compatibility Surface

During the migration toward the Supervisor TUI:

- bare `openalice` and `openalice start` retain the existing foreground,
  browser-oriented source launcher;
- `openalice server run|start|status|stop` remains available for managed remote
  and existing scripts;
- new code uses `run|up|status|down`;
- `server status --json` retains its legacy raw status payload;
- the future change that makes bare `openalice` enter the TUI requires its own
  PTY acceptance and compatibility decision.

The top-level commands and the `server` compatibility surface launch the same
`cli-server` Guardian owner. They are presenters over one lifecycle rather than
separate daemons.

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

## TUI Renderer and PTY Test Foundation

The current tree ships the terminal foundation for the later Supervisor TUI,
but does not yet expose `openalice tui` or change bare `openalice`. The boundary
is deliberately small:

- `createSupervisorFrame` is a pure projection from a structured control model
  to fixed-width terminal rows;
- `AnsiTerminalRenderer` owns alternate-screen entry, row-level diffs, cursor
  visibility, style reset, and alternate-screen exit;
- `createTerminalSession` owns TTY refusal, raw-mode setup/restoration, resize,
  Ctrl+C/SIGINT/SIGTERM cleanup, and renderer-error cleanup;
- product actions and polling remain outside the renderer and will call the
  same lifecycle services as non-interactive commands.

The frame sanitizes control bytes, accounts for grapheme clusters, emoji, and
East Asian display width, switches to a narrow projection below 60 columns,
and honors `NO_COLOR` and `TERM=dumb`. After the first draw, unchanged rows
emit no bytes and an ordinary state change rewrites only changed rows.

### Renderer selection evidence

A disposable spike compared Ink 7.1.1 plus React 19 with a repository-owned
ANSI renderer against the same fake control model and PTY journey. Measurements
were taken on 2026-07-30 with Node 22.22.1 on Darwin arm64; they are selection
evidence rather than release performance promises:

| Measure | Repository renderer | Ink 7.1.1 |
|---|---:|---:|
| cold start median, two eight-run samples | 98–118 ms | 313–314 ms |
| CPU during a one-second idle/resize journey | 8–10 ms | 26–27 ms |
| journey output | 497 bytes | 962 bytes |
| retained renderer/frame/session source or installed dependency closure | 9.8 KiB | 22,368 KiB |

Both candidates restored cursor/raw/alternate-screen state, rendered the
Unicode fixture, honored the narrow projection, and remained idle between
events. Ink provides a maintained React/Yoga layout system, but the first
Supervisor has a fixed information architecture and low-frequency updates; its
extra dependency and startup surface did not buy a needed capability. The
rejected spike and its dependencies are not retained.

### PTY harness

`packages/cli/test/pty-harness.mjs` owns an isolated `HOME` and
`OPENALICE_HOME`, launches the fixture through a real `node-pty`, mirrors bytes
through `@xterm/headless`, records input/output/resize/screen checkpoints, and
includes the complete transcript in timeout diagnostics. The fixture also
writes a structured result inside the isolated harness root after cleanup, so
raw-mode restoration and the terminal byte stream are independent evidence;
terminal writes are drained before fixture exit. Acceptance covers normal
detach, Ctrl+C, SIGTERM where supported, resize, Unicode/no-color, renderer
failure, and control disconnect without TUI exit. The Windows matrix also
launches the fixture as a Git for Windows Bash child and requires Bash to
propagate the Node fixture's real exit status before accepting the renderer.

## Load-bearing Files

- `packages/cli/bin/openalice.mjs` — root dispatch and process exit mapping.
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
- `packages/cli/src/tui-frame.mjs` — pure wide/narrow frame projection and
  Unicode-width/control-byte handling.
- `packages/cli/src/tui-renderer.mjs` — alternate-screen row-diff renderer.
- `packages/cli/src/tui-session.mjs` — raw-mode, resize, signal, and restoration
  guard.
- `packages/cli/test/pty-harness.mjs` — isolated real-PTY/xterm acceptance
  harness.
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

For TUI rendering, input, or cleanup changes:

```bash
pnpm test:cli-tui
```

The Windows cross-platform suite must exercise the Git Bash journey before a
renderer selection or terminal-lifecycle change is considered complete.

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
