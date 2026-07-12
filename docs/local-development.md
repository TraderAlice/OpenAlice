# Local Development

This guide owns the contributor environment: toolchain prerequisites,
install/build/dev-loop mechanics, agent-CLI authentication (including the
Claude Code subscription path), sandboxed/CI installs, and dev-loop
troubleshooting. Process topology and state layout live in
[[docs/project-structure.md]]; branch and PR policy live in
[[docs/development-workflow.md]].

## Prerequisites

- **Node.js ≥ 22** — matches CI (`.github/workflows/ci.yml`) and the
  Docker image (`node:22-trixie`). The root `package.json` declares
  `engines.node >= 22`.
- **pnpm 11.x** — pinned by the `packageManager` field; `corepack enable`
  gives you the right version automatically.
- **Native build tools** — `node-pty` compiles from source when no prebuild
  matches (Python 3 + make/gcc on Linux, Xcode CLT on macOS, VS Build Tools
  on Windows).
- **At least one agent CLI** — `claude`, `codex`, `opencode`, or `pi` on
  `PATH`. Source installs do not ship a managed runtime; the packaged
  desktop's managed Pi is the exception ([[docs/managed-workspace-runtime.md]]).

## Install, Build, Verify

```bash
pnpm install              # full install, including the Electron binary
pnpm dev                  # Guardian -> UTA + Alice + Vite (UI URL is printed)
pnpm typecheck            # tsc --noEmit on src/
pnpm test                 # monorepo Vitest suite
pnpm build                # turbo packages + UI + UTA + tsup main bundle
```

Headless, proxied, or CI-like environments (containers, Claude Code on the
web) often cannot download the Electron binary, and don't need it:

```bash
ELECTRON_SKIP_BINARY_DOWNLOAD=1 pnpm install
```

Everything except `electron:*` packaging scripts works without the binary.
The tracked SessionStart hook (`.claude/hooks/session-start.sh`) applies this
automatically in Claude Code on the web sessions.

## Dev-Loop Environment Knobs

| Variable / flag | Effect |
|---|---|
| `OPENALICE_HOME` | User-state root; defaults to `~/.openalice`. `OPENALICE_HOME=$PWD pnpm dev` pins a checkout-local store for experiments that must not touch real data. |
| `OPENALICE_LITE_MODE=1` | Skip UTA entirely; Alice and the Workspace UI run read-only for trading. |
| `pnpm dev --takeover` | Replace a stale recorded Guardian owner (see Troubleshooting). |
| `AQ_LAUNCHER_ROOT` | Move only the Workspace launcher root. |
| `OPENALICE_GLOBAL_DIR` | Move the user-global `provider-keys.json` store. |
| `ELECTRON_SKIP_BINARY_DOWNLOAD=1` | Skip the Electron binary at install time. |

## Agent CLI Authentication

OpenAlice does not run a model loop in-process. Each Workspace spawns a
native agent CLI, and that CLI's own login is the default credential path.

**Claude Code (recommended: subscription login, no API key).** Run
`claude login` once; the CLI stores its OAuth credential globally and every
OpenAlice Workspace inherits it. This is the `claude-oauth` provider preset
("Use your Claude Pro/Max subscription") in `src/ai-providers/preset-catalog.ts`.
An Anthropic API key is only needed for the `claude-api` preset or a
third-party Anthropic-compatible gateway.

How the adapter keeps the subscription path clean
(`src/workspaces/adapters/claude.ts`):

- With no per-workspace override, the adapter writes **no** credential file
  and the spawned `claude` uses its global OAuth login.
- A per-workspace override writes `.claude/settings.local.json` inside the
  Workspace with `ANTHROPIC_API_KEY` (x-api-key mode) or
  `ANTHROPIC_AUTH_TOKEN` (bearer-gateway mode) — never both.
- Resetting the override deletes that file, falling back to OAuth.

**Readiness detection.** `src/workspaces/agent-detect.ts` resolves each CLI
on `PATH` (pure filesystem probe), and `src/workspaces/agent-runtime-readiness.ts`
runs a 45 s headless probe (`claude -p --output-format stream-json --verbose`)
to classify `ready` / `auth_required` / `provider_required`. The UI's repair
hint for an unauthenticated `claude` is CLI login, not an API key.

**MCP wiring.** Workspaces expose OpenAlice tools to the CLI via the
workspace `.mcp.json` (server default `http://127.0.0.1:47332/mcp`,
overridable with `OPENALICE_MCP_URL`). The Claude adapter injects
`enableAllProjectMcpServers` at spawn so fresh workspaces don't stall on the
MCP trust prompt.

## Troubleshooting

- **`pnpm install` fails in the Electron postinstall (403/network)** — use
  `ELECTRON_SKIP_BINARY_DOWNLOAD=1 pnpm install`; only `electron:*` scripts
  need the binary.
- **`Failed to switch pnpm to v11.7.0 … pnpm CLI is missing at …\bin` on
  Windows** — an older standalone pnpm (≤ 10.16) can't materialize pnpm 11's
  native `@pnpm/win-x64` artifact: it leaves the versioned tool dir without a
  `bin/pnpm` shim and aborts before any command runs. Resolve the
  `packageManager` pin through Corepack instead:
  `corepack prepare pnpm@11.7.0 --activate`, then run `corepack pnpm …` (or
  `corepack enable pnpm` to put it on `PATH`). Upgrading the standalone pnpm to
  11.x also fixes it.
- **`node-pty` build errors** — install Python 3 and a C/C++ toolchain, then
  reinstall. `postinstall` (`scripts/fix-pty-perms.mjs`) repairs helper
  permissions.
- **"runtime already running" at `pnpm dev`** — another Guardian owns the
  runtime lock. If it is genuinely dead, `pnpm dev --takeover`; verify
  recovery behavior with `pnpm test:guardian-recovery`.
- **Claude Workspace shows `auth_required`** — run `claude login` in any
  terminal (subscription), or set a per-workspace credential for gateway use.
- **A stray `sealing.key` appears at the repo root** — expected when
  `OPENALICE_HOME=$PWD`; it is gitignored and machine-bound. Delete it with
  the rest of the checkout-local store when done.
- **Trading routes return 502** — UTA is restarting or unavailable; Alice
  stays usable. Check Guardian output, or run lite mode if you don't need
  brokers.

## Verification Matrix

`pnpm typecheck` + `pnpm test` always. Then add the surface-specific checks
from the table in [[AGENTS.md]] (UI build, demo handlers, package typechecks,
UTA live scenarios, Guardian recovery, Electron smokes, migrations).
