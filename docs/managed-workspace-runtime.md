# Managed Workspace Runtime

This note captures the target design for making packaged OpenAlice usable on a
fresh machine without asking the user to install coding-agent command line
tools first.

The core product rule is simple: a desktop app distribution should not open
with "please install Node/npm/git/bash/pi". The packaged app should provide the
minimum managed runtime needed for a Workspace agent to start, edit files, run
commands, use Git, and call OpenAlice's injected `alice*` tools.

## Current Topology

OpenAlice is already much closer to this than a normal web app:

- Electron main is a Node-capable supervisor, not just a renderer shell.
- In packaged app mode, Electron starts Alice and UTA with:
  - `process.execPath`
  - `ELECTRON_RUN_AS_NODE=1`
- `OPENALICE_APP_HOME` points at the unpacked app resources
  (`Contents/Resources/app` on macOS, equivalent resources dir on Windows).
- `asar` is disabled, so shipped scripts and vendor binaries can be executed
  from the app resource tree.
- Built-in workspace templates are plain `.mjs` scripts and run on the
  Electron-bundled Node with `ELECTRON_RUN_AS_NODE=1`.
- Workspace bootstrap Git calls currently go through `dugite`.
- Agent tools are injected through PATH:
  - `src/workspaces/cli/bin` provides `alice`, `alice-uta`,
    `alice-workspace`, and `traderhub`.
  - Native coding agents reach OpenAlice by shelling out to these CLIs.

This means we do not need user-installed Node. Electron already gives us the
Node runtime for the backend and workspace bootstrap.

## Goals

- Packaged OpenAlice should include a managed Pi npm runtime on macOS and
  Windows.
- Windows packaged OpenAlice should include an incremental managed Git Bash
  runtime. Dugite's embedded Git payload is retained in the first slice and
  deduplicated only after the new runtime path is stable.
- The managed runtime must be discovered through explicit capability/profile
  injection, not scattered `process.platform` guesses.
- Existing Workspace semantics stay intact: Pi is a coding runtime, not a
  trading-permission gate.
- UTA/trading permissions remain enforced at the OpenAlice/UTA tool boundary.
- User-installed CLIs may still be used as overrides or fallbacks, but are not
  required for the default packaged path.

## Non-Goals

- Do not make Pi responsible for account/trading safety.
- Do not remove or rewrite dugite in the first managed Git Bash slice.
- Do not require WSL, Git for Windows, Node, npm, pnpm, or system Git as a
  first-run prerequisite.
- Do not rewrite every Git call in the first implementation if a smaller step
  can keep the release path stable.

## Platform Strategy

### macOS

Ship:

- Electron Node (already present)
- managed Pi npm runtime (`@earendil-works/pi-coding-agent`)
- existing managed Git path for workspace bootstrap and Git UI

Use:

- system `/bin/bash` or `/bin/sh` as the Pi shell path

Rationale:

- macOS already has a usable shell.
- The missing first-run piece is Pi itself, not Bash.
- Bundling Pi as a pinned npm runtime keeps the desktop app promise without
  introducing another native runtime family. Electron already gives us Node.

### Windows

Ship:

- Electron Node (already present)
- managed Pi npm runtime (`@earendil-works/pi-coding-agent`)
- one managed Git for Windows / PortableGit runtime that includes:
  - `git.exe`
  - `bash.exe`
  - `sh.exe`
  - required MSYS runtime DLLs
  - coreutils needed by normal agent shell commands

Use:

- managed `bash.exe` as Pi's `shellPath`
- the same managed Git runtime for agent shell commands and as the preferred
  `LOCAL_GIT_DIRECTORY` for existing dugite call sites

Rationale:

- Pi's npm package does not provide a shell. OpenAlice must provide one.
- The existing dugite Windows native payload contains Git and POSIX-ish tools,
  but not a reliable full Bash story.
- Shipping both dugite's embedded Git and PortableGit is wasteful, but this
  incremental slice accepts the temporary duplication so Windows gets a reliable
  Bash/toolchain without rewriting launcher Git semantics in the same change.

## Runtime Profile

Electron main should compute a normalized runtime profile and inject it into
Alice/UTA child process env. Alice-side modules should consume this profile
instead of re-discovering the runtime independently.

Suggested env keys:

```text
OPENALICE_RUNTIME_PROFILE=electron-packaged
OPENALICE_MANAGED_PI_PATH=/.../vendor/pi/node_modules/@earendil-works/pi-coding-agent/dist/cli.js
OPENALICE_MANAGED_PI_NODE_PATH=/.../OpenAlice(.exe)
OPENALICE_MANAGED_GIT_DIR=/.../vendor/git
OPENALICE_MANAGED_GIT_BIN=/.../vendor/git/.../git(.exe)
OPENALICE_MANAGED_SHELL_PATH=/.../vendor/git/.../bash(.exe)
OPENALICE_MANAGED_TOOLCHAIN_PATH=/.../vendor/git/.../bin:/.../vendor/git/.../usr/bin
```

In dev, these may be absent. In packaged app mode, they should be explicit
when the corresponding managed capability exists.

Alice should parse these centrally, likely in:

```text
src/core/runtime-profile.ts
```

Shape:

```ts
export interface RuntimeProfile {
  readonly launcher: 'dev' | 'electron-dev' | 'electron-packaged' | 'docker';
  readonly platform: NodeJS.Platform;
  readonly arch: NodeJS.Architecture;
  readonly appHome: string;
  readonly userDataHome: string;
  readonly nodeExecPath: string;
  readonly managedPiPath: string | null;
  readonly managedPiNodePath: string | null;
  readonly managedGitDir: string | null;
  readonly managedGitBin: string | null;
  readonly managedShellPath: string | null;
  readonly managedToolchainPath: readonly string[];
}
```

The profile should expose capabilities, not policy. Policy belongs in the
workspace launcher and adapters.

## Resolution Rules

### Agent Availability

For `/agents`, `pi` availability should resolve in this order:

1. `OPENALICE_MANAGED_PI_PATH` exists and is executable.
2. PATH contains `pi` / `pi.exe`.
3. Not installed.

The response should eventually distinguish source:

```ts
type AgentRuntimeSource = 'managed' | 'path' | 'missing';
```

The first implementation can keep the old boolean `installed` contract while
internally preferring the managed path.

### Pi Spawn Command

The Pi adapter should prefer the managed path without changing Workspace's
runtime model.

Current commands are shaped like:

```ts
['pi', '--session-id', id]
['pi', '-p', '--mode', 'json', prompt]
```

Managed npm mode should become:

```ts
[managedPiNodePath, managedPiPath, '--session-id', id]
[managedPiNodePath, managedPiPath, '-p', '--mode', 'json', prompt]
```

If a future standalone Pi binary is used instead, omit
`OPENALICE_MANAGED_PI_NODE_PATH` and spawn `[managedPiPath, ...]`.

On Windows, this avoids npm shim behavior and the `cmd.exe` wrapper path used
for `.cmd` files. The interactive and headless paths both spawn Electron in
Node mode directly.

### Spawn PATH

Workspace spawn env should prepend:

1. OpenAlice CLI shim dir: `src/workspaces/cli/bin`
2. managed Pi binary dir, if using a standalone binary
3. managed Git/shell bin dirs, if present
4. existing user/system PATH fallbacks

This belongs in `src/workspaces/spawn-env.ts` and should be driven by
`RuntimeProfile`. For the npm runtime, do not add Pi's `dist/` directory to
PATH; the adapter launches `cli.js` explicitly through Electron Node.

### Pi Shell Path

Pi reads `settings.json` from the Pi agent dir. OpenAlice already redirects
Pi's agent dir to per-workspace `.pi-agent` when a workspace provider override
exists.

When a managed shell exists, Pi config written by OpenAlice should include:

```json
{
  "defaultProvider": "workspace",
  "defaultModel": "...",
  "shellPath": "/absolute/path/to/bash-or-system-shell"
}
```

Rules:

- Windows packaged: use managed `bash.exe`.
- macOS packaged: use `/bin/bash` if it exists, else `/bin/sh`.
- Dev: do not force a shell path unless explicitly provided.

Important: this is not a permission boundary. It is runtime plumbing so Pi's
`bash` tool has a shell to execute.

## Git Strategy

There are two separate concerns:

1. Git executable/runtime payload
2. JS API used by Alice code and bootstrap scripts

### Phase 1: Incremental Windows Git Bash, Keep Dugite API

Keep `dugite.exec()` call sites initially:

- `src/workspaces/workspace-creator.ts`
- `src/workspaces/git-service.ts`
- `src/workspaces/templates/_common.mjs`

But on Windows packaged builds:

- ship the managed Git for Windows runtime as `vendor/git/...`
- set `LOCAL_GIT_DIRECTORY` to the managed Git dir before Alice starts
- keep dugite's own `node_modules/dugite/git/**` payload for now

Dugite supports `LOCAL_GIT_DIRECTORY`; with that env set, existing
`dugite.exec()` calls should resolve Git from the managed runtime instead of
dugite's embedded payload.

This gives Windows a reliable Bash/toolchain while preserving the established
API and test surface. Having both Git payloads in the package is a known
temporary cost, not the final topology.

### Phase 2: OpenAlice Git Wrapper

After Phase 1 is stable, introduce an OpenAlice-owned wrapper, for example:

```text
src/workspaces/git-runtime.ts
```

and a bootstrap-compatible JS helper for templates.

Then migrate call sites from `dugite.exec()` to `gitExec()` and consider
removing `dugite` entirely.

Do not combine this with Phase 1 unless necessary. Workspace creation is core
infrastructure; make the payload swap independently testable.

## Packaging Layout

Suggested packaged resource layout:

```text
app/
  dist/
  ui/dist/
  src/workspaces/cli/bin/
  src/workspaces/templates/
  services/uta/dist/
  vendor/
    pi/
      package.json
      package-lock.json
      node_modules/
        @earendil-works/pi-coding-agent/
          dist/cli.js
    git/
      win32-x64/
        cmd/git.exe
        bin/bash.exe
        usr/bin/...
      win32-arm64/
        ...
```

The runtime preparation should be scripted, pinned by version and checksum,
and run before `electron-builder`.

Script:

```text
scripts/vendor-managed-runtime.mjs
```

Responsibilities:

- download pinned Pi install package + lockfile from the Pi release
- verify checksums
- run an isolated `npm ci --omit=dev` under `vendor/pi`
- download pinned Git for Windows / PortableGit runtime on Windows only
- verify checksums
- unpack into a deterministic vendor directory
- prune docs/examples only if license obligations remain satisfied
- emit a machine-readable manifest:

```json
{
  "pi": {
    "version": "0.80.3",
    "mode": "npm",
    "cli": "vendor/pi/node_modules/@earendil-works/pi-coding-agent/dist/cli.js"
  },
  "git": {
    "win32-x64": {
      "version": "2.55.0.2",
      "distribution": "PortableGit",
      "path": "vendor/git/win32-x64",
      "gitBin": "cmd/git.exe",
      "shellPath": "bin/bash.exe",
      "shPath": "bin/sh.exe"
    }
  }
}
```

## Electron Main Injection

`apps/desktop/src/main.ts` already computes `homeEnv`.

Add managed runtime resolution nearby, before spawning Alice/UTA:

```ts
const runtimeEnv = resolveManagedRuntimeEnv({
  appHome: homeEnv.OPENALICE_APP_HOME,
  platform: process.platform,
  arch: process.arch,
});
```

Then merge into children:

```ts
env: {
  ...process.env,
  ELECTRON_RUN_AS_NODE: '1',
  ...homeEnv,
  ...runtimeEnv,
}
```

This must happen for Alice. UTA does not need Pi, but inheriting harmless
profile values is acceptable if it keeps the launcher simple.

## Code-Level Touch Points

Expected first implementation files:

- `apps/desktop/src/main.ts`
  - resolve managed runtime paths
  - inject runtime profile env
- `src/core/runtime-profile.ts`
  - parse env once
  - expose capability paths
- `src/workspaces/agent-detect.ts`
  - detect managed Pi before PATH Pi
- `src/workspaces/spawn-env.ts`
  - prepend managed Pi/toolchain paths
- `src/workspaces/adapters/pi.ts`
  - use managed Pi npm CLI path in commands
  - write `shellPath` into `.pi-agent/settings.json` when available
- `src/workspaces/service.ts`
  - thread runtime profile into adapter context if needed
- `package.json`
  - include `vendor/**` in `build.files`
  - add vendoring script to packaging flow
- `scripts/vendor-managed-runtime.mjs`
  - prepare pinned Pi npm runtime
- `scripts/desktop-packaged-smoke.mjs`
  - assert packaged profile and managed Pi availability

Potential later files:

- `src/workspaces/git-runtime.ts`
- `src/workspaces/templates/_common.mjs`
- `src/workspaces/git-service.ts`
- `src/workspaces/workspace-creator.ts`

## Tests

Unit tests:

- runtime profile parser:
  - no managed env in dev
  - packaged paths parse correctly
  - missing files are reported predictably
- agent detection:
  - managed Pi wins over PATH
  - PATH Pi works when managed Pi is absent
  - missing Pi reports missing
- spawn env:
  - OpenAlice CLI shim is first
  - standalone managed Pi dir and managed toolchain dirs are prepended
  - npm managed Pi does not add its `dist/` directory to PATH
  - existing PATH remains available
- Pi adapter:
  - command uses `[Electron Node, cli.js]` when npm managed Pi is provided
  - command uses managed binary path when standalone managed Pi is provided
  - `settings.json` includes `shellPath` only when profile provides it
  - reset behavior does not leave stale provider secrets

Packaged smoke tests:

- `pnpm electron:smoke:packaged --temp-data`
- verify `/agents` reports Pi installed from managed runtime
- create chat workspace
- spawn Pi session
- run:

```bash
alice --help
git --version
pwd
```

`pi --version` is not required to resolve as a shell command in npm managed
mode; the launcher starts Pi through `[Electron Node, cli.js]`.

Windows acceptance smoke:

- clean Windows VM with no Node, no npm, no Git for Windows, no WSL
- install OpenAlice
- open app
- configure one AI credential
- start Pi workspace
- ask Pi to run `alice --help`
- ask Pi to edit a file and run `git status`
- verify workspace creation works with PATH stripped
- verify paths with spaces and non-ASCII characters

## Rollout Plan

### Step 1: Design and Runtime Profile

- Add `RuntimeProfile` parser.
- Inject profile env from Electron main.
- No packaging behavior change yet.

### Step 2: Managed Pi on macOS

- Vendor Pi npm runtime.
- Add managed Pi detection and spawn.
- Packaged smoke on macOS.

### Step 3: Managed Pi on Windows

- Vendor Pi npm runtime.
- Prefer explicit `[Electron Node, cli.js]`.
- Confirm Pi starts in packaged app.

### Step 4: Windows Managed Git+Shell Runtime

- Vendor one Windows Git+Shell runtime.
- Set `LOCAL_GIT_DIRECTORY`.
- Set managed `shellPath` to `bash.exe`.
- Keep dugite's embedded Windows Git payload in this slice.
- Confirm PortableGit is packaged and the temporary dugite duplication is
  visible in package assertions/docs.

### Step 5: Optional Dugite API Removal

- Introduce OpenAlice `gitExec()`.
- Migrate code and template helper.
- Remove `dugite` only after packaged Windows/macOS smoke stays green.

## Open Questions

- When should the temporary Windows dugite + PortableGit duplication be removed?
- Can `LOCAL_GIT_DIRECTORY` fully cover every existing dugite call in packaged
  Windows, or do any call sites depend on dugite-specific env setup?
- Should managed Pi be updated only with app releases, or should OpenAlice
  support runtime updates independently later?
- How aggressively can we prune Pi docs/examples/assets while staying license
  compliant and preserving useful local help?
- Should `/agents` expose runtime source (`managed` vs `path`) immediately, or
  keep it internal for the first slice?

## Product Principle

OpenAlice can still support external CLIs for power users, but the packaged app
must have a coherent first-run path:

1. user installs OpenAlice
2. user configures AI credential
3. user opens Workspace
4. Alice can work

No Node/npm/Git/Bash/Pi prerequisite should appear before that loop.
