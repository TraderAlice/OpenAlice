# Managed Workspace Runtime

This guide owns the packaged-desktop runtime contract for Workspace agents:
desktop packaging, agent discovery, Pi launch behavior, the Windows
shell/toolchain, and the `OPENALICE_MANAGED_*` environment keys. Related:
[[docs/project-structure.md]],
[[docs/model-semantics-and-runtime-injection.md]], and
[[docs/development-workflow.md]].

## Product Contract

A packaged OpenAlice install must open a Workspace on a fresh supported
machine without asking the user to install Node, npm, Git, Bash, or an agent
CLI first. Default packaged path: OpenAlice supplies a managed Pi runtime; the
user configures an API-key credential in **Settings → AI Provider**; the
Workspace records the secret-free credential reference, model, and effort in
`.alice/settings.json`; OpenAlice resolves the secret just in time and
projects it into each Pi process. Bundling Pi removes the CLI/toolchain
prerequisite — it does not bundle a model account. User-installed Claude
Code, Codex, opencode, or Pi remain supported with their own login/config.

Source development and the native CLI do not inherit the packaged desktop's
managed-agent promise; the direct installer supplies a native OpenAlice
Runtime and clears desktop-managed Pi variables. Electron's managed
Pi/Git/Bash/search-tool payload is a separate boundary ([[docs/cli-installer.md]],
[[docs/local-runtime.md]]).

### AI credential setup contract

**Settings → AI Provider** is an account-to-runtime setup flow. Before a key
is saved it must make explicit: the issuing provider account, the
region/endpoint, which Workspace Agent runtimes can consume the endpoint's
protocol, the exact model ID to test and remember, and whether that
key+endpoint+protocol+model combination passes a live probe. Provider presets
own key/region/model guidance; runtime compatibility derives from the preset's
wire map. Protocol names and raw endpoints stay behind advanced detail unless
**Custom** is chosen.

Non-obvious wire invariants:

- Google Gemini uses the native `google-generative-ai` wire (`AQ.` and legacy
  `AIza` keys sent as `x-goog-api-key`). Never route the built-in Gemini
  preset through Google's OpenAI-compatibility endpoint (Bearer auth does not
  reliably accept authorization keys).
- A stored credential may declare multiple wires; the per-Workspace editor
  must let the user choose the protocol and write the matching Pi `api` or
  opencode `@ai-sdk/*` provider. Anthropic-wire credentials carry header mode:
  first-party `x-api-key` vs gateway `Authorization: Bearer` (never both).
- **Default Workspace credentials** is a deprecated installation-level seed;
  changing it never rewrites an existing Workspace.
- Claude Code's global onboarding/trust gates expose no supported status
  command: OpenAlice reads only the existing completion booleans and shows an
  advisory, never writing them; unknown native state fails open.
- Model catalogs are suggestions, not allowlists — keep the free-text model
  field. Editing must round-trip stored `lastModel` and non-matching
  endpoints; a catalog refresh never silently replaces them.
- Credential model semantics resolve from the offline registry; only unknown
  free-typed models expose a reasoning override ([[docs/model-semantics-and-runtime-injection.md]]).

### Desktop data-location selection

The desktop uses the Supervisor's shared Machine/AliceProject Default. An
unavailable Default opens the startup chooser without silently selecting
another home or acquiring its lock; verified attachment precedes saving the
shared Default (no independent Electron Recent setting). The old Electron
data-location preference is migration input only; `OPENALICE_HOME` remains an
explicit invocation override ([[docs/alice-project.md]],
[[docs/data-locations.md]]). `pnpm electron:smoke:startup` validates this
boundary; `pnpm electron:smoke:credential-pi` is the credential + native Pi
execution gate (drives the real Settings UI, then a headless Pi reply through
`POST /api/workspaces/:id/headless`). `--onboarding` remains a deprecated
alias for the latter.

## Platform Payloads

macOS ships Electron's Node, pinned managed Pi under `vendor/pi/`, pinned
`fd`/`ripgrep` under `vendor/tools/darwin-<arch>/`, and the packaged Git path.
Windows additionally ships pinned PortableGit under
`vendor/git/<platform>-<arch>/` (git/bash/sh plus Pi's CLI tools); Workspace
children receive the PortableGit command directories on `PATH`, so the
packaged flow needs no Node, npm, Git for Windows, WSL, or system agent CLI.
A minimal Windows GUI `PATH` is augmented with per-user Bun/npm/pnpm/WinGet
and native-agent directories; `OPENALICE_EXTRA_AGENT_PATH` covers non-standard
installs.

Windows shim safety: npm agent shims are never evaluated as command text —
native `.exe`/`.com` run directly, npm/pnpm `.cmd` shims reduce to their JS
entrypoint on the current Node, other batch shims may use their extensionless
POSIX sibling with `shell: false`; a batch-only shim is rejected with
`unsupported_windows_batch_shim`. Workspace-facing commands (`alice`,
`alice-workspace`, `traderhub`, `alice-uta`) execute the explicit
`openalice-cli.cjs` payload through `OPENALICE_MANAGED_PI_NODE_PATH` with
`ELECTRON_RUN_AS_NODE=1` (POSIX launcher normalizes paths via `cygpath` from
Git Bash; `/cli` must not become a Git path). Keep them as launchers — direct
extensionless JS execution depends on host Node and nearest `package.json`
module type.

Windows keeps one machine-local Workspace shell preference
(`~/.openalice/state/workspace-shell.json`, outside a portable install's
`data/`): **Custom** stores an absolute `bash.exe` exposed as
`OPENALICE_WORKSPACE_SHELL_PATH`; **Auto** uses
`OPENALICE_MANAGED_SHELL_PATH` (packaged) or discovered Git Bash (dev). An
invalid custom path fails explicitly — no silent fallback to Auto. The
mirrored `.pi/settings.json` value is a derived cache; the machine preference
is the source of truth.

## Packaging and Runtime Flow

`scripts/vendor-managed-runtime.mjs` downloads and checksum-verifies Pi
(pinned package + lockfile, isolated `npm ci --omit=dev` under `vendor/pi/`),
`fd`/`ripgrep` (published from one shared `vendor/tools/<platform>-<arch>/bin`
so Pi never downloads per-Workspace tools), and PortableGit, writing
`vendor/manifest.json`. Versions, URLs, and checksums stay pinned there.

`pnpm electron:pack` enables `asar`: JS entrypoints and dependencies live in
`app.asar`; backend children load it via `ELECTRON_RUN_AS_NODE=1`.
`extraResources` copies vendor/CLI/template/UI assets to the physical
`Resources/runtime` tree that `OPENALICE_APP_HOME` points at — code paths stay
relative to the archive; never derive a backend entrypoint from
`OPENALICE_APP_HOME`. The `afterPack` hook projects product metadata into
`runtime/package.json` (it cannot be an extraResource). `asarUnpack` retains
node-pty and dugite's embedded Git. Windows installed-version polling reads
authoritative `app.asar/package.json` and clears the ASAR header cache between
polls (NSIS replaces in place); a partial archive stays retryable.

`apps/desktop/src/main.ts` injects only the capabilities it actually finds
(`OPENALICE_RUNTIME_PROFILE=electron-packaged`,
`OPENALICE_MANAGED_PI_PATH`, `OPENALICE_MANAGED_PI_NODE_PATH`,
`OPENALICE_MANAGED_GIT_DIR/BIN`, `OPENALICE_MANAGED_SHELL_PATH`,
`OPENALICE_MANAGED_TOOLCHAIN_PATH`, `LOCAL_GIT_DIRECTORY` — platform
specific). `src/core/runtime-profile.ts` parses these into `RuntimeProfile`;
Workspace code consumes the profile, never scattered platform guesses. The
profile describes capabilities, not permission: managed Pi/shell grant no
trading access.

Agent launch: `src/workspaces/agent-detect.ts` treats managed Pi as installed
before `PATH` fallback; `src/workspaces/spawn-env.ts` puts OpenAlice CLI
shims first (canonicalizing `Path`/`PATH` on Windows);
`CliAdapter.lifecycle.prepareWorkspace` is the single idempotent preparation
hook used by every surface; `src/workspaces/adapters/pi.ts` launches
`[managedPiNodePath, managedPiPath, ...args]`. The managed npm runtime is
never added to `PATH` as a fake `pi` binary. Headless failures before `spawn`
retain a typed `launchErrorCode`; structured launcher logs never include
prompts, complete argv, credentials, or environment values.

### Workspace launch-plan disclosure

**Workspace Settings → Launch** is a read-only explanation of the next fresh
session (composed argv/runtime path/cwd/launcher-owned environment groups).
Reading a plan never runs `prepareWorkspace`, writes config, or starts a
process; secret-like values are redacted and `PATH` summarized by entry
count. Keep its redaction aligned with structured-log rules.

### Pi trust and theme boundary

- Before TUI/Web startup the Pi adapter records genuinely undecided
  OpenAlice-managed Workspaces in the trust store (a fresh Quick Chat must
  not stall behind a terminal-only selector). An explicit saved allow/deny
  decision is authoritative and never flipped.
- Interactive argv never receives `--approve`; packaged headless sessions do
  (OpenAlice controls the pinned Pi and Workspace contents). External Pi
  version/upgrade policy belongs to the user — compatibility for the packaged
  app is maintained by pinning/upgrading bundled Pi with the release.
- Terminal theme: OpenAlice writes Pi's built-in `light/dark` automatic pair
  only when no user theme exists; supplies palette facts via xterm OSC/DSR
  and mode 2031; never generates palette-specific themes. OpenCode gets
  `{ "theme": "system" }` in `tui.json` only when unconfigured; Codex probes
  OSC 10/11 itself (relaunch a running Codex TUI after a light/dark switch).
- Provider overrides never write Pi's user agent directory: a managed
  extension under `.pi/extensions/` plus `.pi/settings.json` selection keeps
  the user's global state intact. Old `.pi-agent/` trees are migrated before
  launch.

### Codex launch permissions

Codex TUI, Web, and headless launches explicitly select full host access and
no tool approval, including exact resume. This is process-local adapter policy,
not a global config rewrite; OS/enterprise restrictions and UTA trading
permissions remain authoritative. The shared contract belongs to
[[docs/model-semantics-and-runtime-injection.md]].

## Workspace Bootstrap and Skills

Built-in templates run `bootstrap.mjs` on Electron's Node; the packaged
backend re-enters its archived entrypoint with
`--openalice-internal-bootstrap` and the launcher-owned Git executor. Do not
add new Bash bootstraps (`bootstrap.sh` is a third-party fallback only). A
source-backed Harness receives only template-catalog-approved
repository/release/commit tuples (AutoQuant V2 verifies ancestry, branches a
research branch, writes `.alice/harness-source.json`; bootstrap installs no
dependencies — the Coding Agent owns setup). Skills copy to
`.claude/skills/` (Claude Code) and `.agents/skills/` (Codex, Pi, shared
readers); never restore a duplicate `.pi/skills/`. Pi's provider state lives
in `.pi/openalice-provider.json`; the deprecated native-config export is
node-owned with rollback sidecars and stays in local git excludes.

## Packaging Invariants

**Settings → General → About OpenAlice** is the single user-facing
version/channel/update-owner surface, derived from installed provenance and
runtime profile — invalid provenance fails closed as custom/non-updating.
Passive `GET /api/version`; explicit `POST /api/version/check` bypasses cache;
neither crosses the running surface's authority. Service-managed, dev,
pinned, and custom contexts make no Web manifest request and never render an
update instruction their owner cannot apply. Packaged Electron's
`electron-updater` check runs through the narrow preload bridge; the update
UI distinguishes determinate download progress from the native installer
handoff (`preparing`/`stopping-services`/`releasing-runtime`/`handing-off`;
no invented install percentage).

Electron atomically records `openalice-update-attempt.json` in machine-local
`userData`; the approved version clears it via the shared release-evidence
verifier, an unapproved version archives it as failed. This marker is updater
evidence, not user state — it does not belong under `OPENALICE_HOME`. Alice
stderr is tee'd to a bounded `desktop.log`; a failed backend must never
present as an unexplained desktop flash-and-exit.

Keep these true together:

- `vendor/**` and external assets in `extraResources`; `asar` enabled;
  `OPENALICE_APP_HOME` is the physical tree; entrypoints in the archive,
  native payloads unpacked; never disable RunAsNode.
- `dugite` stays in `pnpm.onlyBuiltDependencies` (macOS uses its embedded
  Git); Windows excludes `node_modules/dugite/git/**` but keeps the JS
  wrapper routed through PortableGit — keep that FileSet anchored by the
  positive `package.json` pattern before the Git exclusion (a pure exclusion
  becomes an all-files matcher).
- Pi and tool versions/URLs/checksums pinned in
  `scripts/vendor-managed-runtime.mjs`; Pi remains network-capable (managed
  tools only prevent redundant downloads; no `PI_OFFLINE`, no patching Pi).
- Every packaged Workspace CLI ships `openalice-cli.cjs` + POSIX launcher +
  Windows `.cmd` twin; a runtime version bump updates assertions and packaged
  smoke in the same change; Windows keeps a single case-insensitive `PATH`
  entry.

## Verification

`pnpm electron:smoke:workspace` is the release-facing definition of a usable
packaged Workspace (isolated temporary data, deterministic local provider):
it proves (1) a preload PTY shell session resolves the packaged CLIs, loads
manifests over the Electron tool socket, and creates/reads an issue via the
real `alice` shim, and (2) a one-shot scheduled Issue dispatches managed Pi
whose deterministic tool call creates an observable side-effect Issue visible
from `/api/issues` — process-backed, not a model claim. A Windows toolchain
smoke runs a real Git cycle through PortableGit with no embedded dugite Git.

Local diagnostics: a native archive, browser session, and packaged app are
different resource layouts — acceptance of one certifies none of the others.
`pnpm electron:smoke:packaged` defaults to isolated stores (`--real-data`
opts in explicitly). Package failures: classify resource layout vs native
dependency/command resolution vs signing before rebuilding. Focused tests:

```bash
pnpm vitest run src/core/runtime-profile.spec.ts \
  src/workspaces/agent-detect.spec.ts src/workspaces/spawn-env.spec.ts \
  tests/integration/agent-configuration/ai-config.spec.ts \
  scripts/vendor-managed-runtime.spec.mjs scripts/assert-desktop-package.spec.ts
```

N-1 desktop upgrade acceptance: every Desktop Package Smoke job also runs the
newest published differing release against an isolated home, then opens the
same home with the candidate (Workspace ids/metadata survive; new Workspaces
creatable; versioned JSON receipt). macOS release candidates expand the final
signed ZIP; Windows installs N-1 then runs the final NSIS installer. This
gate proves N-1 state compatibility and shipped bytes — not ShipIt
replacement or signing (native release mechanics). Release gates are owned by
[[docs/development-workflow.md]].

Package artifact ownership: a package-producing smoke owns its temp dir;
`--keep-package`, `--skip-pack`, and `--package-root <path>` (requires
`--skip-pack`) are the explicit escape hatches; `pnpm electron:pack` and CI
intentionally keep `dist/electron-app`. On Windows, `electron-builder`
rebuilds native dependencies and needs VS Build Tools with the C++ workload
(source-build prerequisite only). macOS release builds stay per-architecture
(Apple Silicon `latest-mac.yml`; Intel `latest-mac-intel.yml`). A
release-facing change should also walk the clean-machine flow (no system
Node/Git/Bash/Pi, one credential, Chat Workspace, paths with spaces and
non-ASCII, Windows shell-preference switch and invalid-path handling).

`pnpm electron:demo` previews the native frontend with shared mock data
without managed agents or trading ([[docs/demo-mode.md]]).
