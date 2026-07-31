# Pi and Herdr CLI Architecture Reference

This is a non-authoritative research note for the OpenAlice Shell CLI and
Supervisor TUI. Product contracts belong to [[docs/cli-supervisor.md]],
[[docs/cli-installer.md]], [[docs/local-runtime.md]], and
[[docs/data-locations.md]].

## Reviewed snapshots and license boundary

The comparison was performed on 2026-07-30 against:

- Pi
  [`v0.83.0`](https://github.com/earendil-works/pi/tree/v0.83.0), especially
  [`packages/coding-agent/src/main.ts`](https://github.com/earendil-works/pi/blob/v0.83.0/packages/coding-agent/src/main.ts),
  [`packages/coding-agent/src/core/settings-manager.ts`](https://github.com/earendil-works/pi/blob/v0.83.0/packages/coding-agent/src/core/settings-manager.ts),
  [`packages/coding-agent/src/utils/version-check.ts`](https://github.com/earendil-works/pi/blob/v0.83.0/packages/coding-agent/src/utils/version-check.ts),
  and
  [`packages/tui`](https://github.com/earendil-works/pi/tree/v0.83.0/packages/tui);
- Herdr
  [`v0.7.5`](https://github.com/herdrdev/herdr/tree/v0.7.5), especially
  [`src/main.rs`](https://github.com/herdrdev/herdr/blob/v0.7.5/src/main.rs),
  [`src/server/autodetect.rs`](https://github.com/herdrdev/herdr/blob/v0.7.5/src/server/autodetect.rs),
  [`src/cli/status.rs`](https://github.com/herdrdev/herdr/blob/v0.7.5/src/cli/status.rs),
  and
  [`src/update.rs`](https://github.com/herdrdev/herdr/blob/v0.7.5/src/update.rs).

`@earendil-works/pi-tui` declares the MIT license and can be consumed as a
normal dependency with its notices preserved. Herdr declares
AGPL-3.0-or-later with a commercial option. OpenAlice uses Herdr as a behavioral
and interface reference; this note does not vendor Herdr source.

## Pi 0.80.3 to 0.83.0 compatibility audit

OpenAlice moved its managed Pi and direct `pi-tui` dependency from the original
`0.80.3` design baseline to `0.83.0`. The upstream range contains 371 commits
and three published breaking-change groups:

| Pi release | Upstream break | OpenAlice exposure | Outcome |
|---|---|---|---|
| `0.80.7` | Replaced `compat.sendSessionIdHeader` with `compat.sessionAffinityFormat` for OpenAI Responses models | OpenAlice neither emits nor owns Pi `models.json` compatibility fields | No migration required |
| `0.80.8` | Replaced SDK `authStorage`/`modelRegistry` construction with async `modelRuntime`; removed `AuthStorage` exports and changed registry APIs | OpenAlice launches Pi as a native CLI and does not embed the Pi agent SDK | No migration required |
| `0.83.0` | Removed deprecated bundled TypeBox aliases such as `Type.Base`, `Type.Promise`, `Type.Options`, and `Value.Mutate` | OpenAlice has no Pi extension using those aliases and its Supervisor imports only `pi-tui` | No migration required |

The exact `pi-tui` surface used by the Supervisor was compared at both tags.
`TUI.addChild()`, `start()`, `stop()`, `addInputListener()`, and
`requestRender()`; `ProcessTerminal.start()` and `stop()`; and `matchesKey()`
plus `KeyId` retain compatible signatures. `TUI` only gained an optional third
`logDirectory` constructor argument, which the OpenAlice Supervisor now uses to
keep its own diagnostics below the machine-wide Supervisor root. Both
coding-agent releases require Node `>=22.19.0`, so the runtime floor did not
move.

The upgrade is therefore the new OpenAlice baseline rather than a compatibility
fork. The release integration exposed two OpenAlice-owned drifts, both repaired:
the installer/desktop vendor hashes now identify the `0.83.0` release assets,
and the packaged-toolchain smoke derives its expected Pi version from the
packaged manifest instead of a stale literal. Real source, installed-CLI, PTY,
installer/uninstaller, and packaged-Electron paths have all launched Pi
`0.83.0`.

The range also contains changes that directly benefit the chosen architecture:
`0.81.0` repairs terminal shutdown cursor restoration, and `0.82.0` makes TUI
debug/crash logs honor a custom agent directory. The latter supports the
instance-private `PI_CODING_AGENT_DIR` used only when OpenAlice launches its
pinned managed Pi. Source-development and external Pi keep the user's native
agent directory. Future Pi extensions must still be checked for removed TypeBox
aliases before each Pi upgrade.

## Executive decision

OpenAlice does not choose between a TUI-first application and a scriptable CLI.
It ships one application core with two entry modes:

```text
openalice
  -> resolve launch context
  -> inspect or ensure selected Guardian Runtime
  -> start the pi-tui Supervisor application

openalice <command>
  -> resolve the same launch context
  -> call the same typed application service
  -> render human or schema-versioned JSON output
```

Pi is the primary reference for the TypeScript application shell, terminal
library, startup sequencing, first-run/settings presentation, and asynchronous
update notice. Herdr is the primary reference for persistent process
attachment, named Runtime selection, protocol/version reporting, command/API
symmetry, and running-update impact. OpenAlice's Guardian, complete-home model,
browser product, and installer trust chain remain authoritative where the
references differ.

## Reference matrix

| Concern | Pi lesson | Herdr lesson | OpenAlice decision |
|---|---|---|---|
| Bare command | Enter the interactive application after special commands and configuration resolve | Detect or spawn the persistent server, then attach a thin TUI client | Bare `openalice` always enters the Supervisor TUI; explicit subcommands bypass it |
| Language and TUI | Strict TypeScript application using the MIT `pi-tui` component/terminal package | Rust `ratatui` application with a server-rendered client protocol | Strict TypeScript with `pi-tui`; no React/Ink layer and no repository-owned terminal renderer |
| Command dispatch | Handle auth, package, config, print, and RPC-like modes before interactive startup | `maybe_run` intercepts stable CLI/API commands before default attach | One root parser dispatches explicit commands first; unknown commands never fall through into the TUI |
| Persistent ownership | Interactive process normally owns its own agent session | Detached server owns PTYs and state while clients attach/detach | Existing Guardian remains the sole Runtime/process-tree owner; the TUI is only a control client |
| Attach/start | Not the primary architecture | Probe the socket, validate protocol, start the daemon if absent, wait for readiness, then attach | Probe Guardian control, classify compatibility/ownership, attach if possible, and start only under explicit selected policy |
| Foreground escape hatch | Print/RPC/noninteractive modes | `--no-session` monolithic mode | `openalice run` explicitly owns foreground lifetime; it is not the default user entry |
| Settings | Global settings plus project settings, with later layers overriding and nested values merging | Platform config path, env path override, validation, diagnostics, and safe live reload | Resolve defaults < machine config < instance config < env < CLI once into `ResolvedLaunchContext`, retaining provenance |
| Instance isolation | `PI_CODING_AGENT_DIR` can replace the global Pi configuration root | Named sessions isolate sockets and persistent data | Named OpenAlice instances select complete homes; managed Pi gets an instance-local Pi root, external Pi stays native |
| First run | Reusable startup TUI and selectors | Native onboarding overlay | First run is a state inside the same Supervisor TUI, never a separate throwaway CLI wizard |
| Status | Interactive UI owns most presentation | Human and JSON status separate client/server versions, protocol, capabilities, and restart need | Human and versioned JSON report installed CLI, running Runtime, protocol compatibility, ownership, components, and pending activation |
| Logs/Doctor | Application diagnostics live in interactive surfaces | Stable socket API and config diagnostics | TUI panels and noninteractive commands reuse bounded, redacted presentation-neutral readers |
| Update discovery | Start the version request after TUI initialization; failure is silent; show changelog/update state | Background check only advertises availability and release notes; configurable channels | Async, disableable, cached notice after first render; no automatic mutation |
| Explicit update | Detect package manager and update the Pi package | Detect install manager; direct installs download/verify; enumerate running sessions; optionally hand off | Detect provenance; package-manager installs show manager guidance; direct installs invoke the verified OpenAlice multi-artifact transaction |
| Running update | Primarily updates the CLI package for the next process | Distinguishes updated client binary from old running server and reports restart need | Treat installed and running versions separately; stage first, then keep compatible instances or confirm restart for incompatible activation |
| Handoff | Not the reference | Capability-gated live server handoff with recovery classification | Do not promise live PTY handoff initially; use Guardian readiness-gated restart and rollback, leaving live handoff as a later capability |
| Version channels | Package/release version check | Stable/preview manifests plus package-manager restrictions | One OpenAlice product version; channel and artifact identities are metadata, not additional user-facing version sequences |
| Uninstall | Package-manager concern | Installer/package-manager concern rather than Runtime data deletion | Remove installer-owned CLI/Pi/Runtime assets and PATH integration; preserve every `OPENALICE_HOME` unless separately and explicitly deleted |
| Test seams | Dependency-injected app resources and isolated config roots | Fake available-version/release-note seams and protocol/update tests | Inject manifest provider, clock, process control, browser opener, and fault points; use isolated homes and real PTY/install A-to-B journeys |

## What is copied, adapted, and rejected

### Copy as a direct dependency or close structural pattern

- `@earendil-works/pi-tui` terminal lifecycle, differential rendering,
  components, overlays, Unicode-width handling, and Windows terminal support;
- Pi's entry ordering: special commands first, complete context resolution,
  resource/application creation, TUI start, then optional background checks;
- Herdr's separation of client version, server version, protocol,
  capabilities, compatibility, and restart-needed state;
- Herdr's default attach semantics and named persistent target grammar;
- Herdr's update planning across every running target before any process
  mutation.

### Adapt to OpenAlice

- Pi's global/project settings become machine/instance settings because an
  OpenAlice instance is a complete data and Runtime boundary, not a source
  repository preference;
- Herdr's server becomes the existing Guardian tree rather than a second
  daemon;
- Herdr's session vocabulary becomes `instance` because OpenAlice already uses
  Workspace Session as a product concept;
- Pi/Herdr update notices feed the OpenAlice installer-owned release
  transaction, which stages CLI, managed Pi, and the headless Runtime together;
- managed Pi isolation is applied only to Pi launched inside an OpenAlice
  instance.

### Reject

- keeping a non-TUI default entry until the TUI has every future panel;
- maintaining a handwritten `.mjs` terminal renderer or adding React/Ink above
  `pi-tui`;
- resolving configuration independently inside the CLI, Guardian, Alice, UTA,
  Connector, and managed Pi;
- copying Herdr's private whole-screen server-rendering protocol;
- using Pi's npm self-update or Herdr's single-binary rename for a multi-artifact
  OpenAlice release;
- storing the instance registry inside the currently selected
  `OPENALICE_HOME`;
- silently stopping active agents during update, uninstall, detach, or TUI
  quit.

## Required OpenAlice seams

The application core must make these production dependencies replaceable in
tests:

- configuration files, environment, CLI flags, current working directory, and
  clock;
- Guardian status/control transport and process launcher;
- browser opener and terminal capability detector;
- release manifest, artifact downloader, checksum/authenticity verifier, and
  installer runner;
- installed-layout and instance-registry stores;
- update fault injection at download, verify, stage, publish, pointer switch,
  restart, readiness, rollback, and cleanup boundaries.

The fast acceptance path uses those seams to install local release A, run its
Guardian, advertise local release B, exercise the real `openalice update`
command and TUI update state, and prove user data plus the prior runnable
release survive success and every injected failure. Published dev/stable
canaries remain separate network checks.
