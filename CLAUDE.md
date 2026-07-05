# OpenAlice

AI trading agent. From a code-writing perspective, the Alice process is two
things: a **Workspace launcher** (PTY sessions running native agent CLIs —
`claude`, `codex`, `opencode`, `pi`, `shell`; capability extension ships as
workspace templates + satellite repos, not `src/` deps) and a
**Trading-context injector** (market data, analysis, news, and the UTA SDK —
surfaced into those workspaces via MCP). Broker credentials and trading state
live in a separate process (UTA). All persisted state lives as files — no
database.

## Quick Start

```bash
pnpm install                                       # Local dev (full, ~1.7G)
pnpm install --filter='!@traderalice/desktop'      # Cloud / agent sessions (~748M, skips Electron shell)
pnpm dev          # Dev: Guardian spawns UTA (47333) + Alice (47331) + Vite (5173)
pnpm build        # Production: turbo (packages + UI + services/uta) + tsup (Alice)
pnpm test         # Vitest across the monorepo (src/, packages/, services/, ui/)
```

Less-common: `pnpm test:watch` / `test:e2e` / `test:bbProvider` / `start` /
`electron:dev` / `build:migration-index`.

## Pre-commit Verification

Four typecheck scopes; run the ones your change touched.

```bash
npx tsc --noEmit                        # Alice src/ — always run
cd ui && npx tsc -b && cd ..            # UI strict types (only if you touched ui/)
pnpm -F @traderalice/<pkg> typecheck    # a workspace package you touched
pnpm test                               # behavior across the monorepo — always run
```

- `pnpm build` runs lenient tsup for Alice and proper `tsc -b` for the UI —
  so `npx tsc --noEmit` from root is the canonical Alice strict-check.
- `pnpm test` catches behavior, not type drift (Vitest transpiles via esbuild).
- `services/uta` standalone typecheck has known errors (ANG-65) — not a gate.

## Cross-platform workspace bootstrap

Workspace bootstrap is **cross-platform Node**: built-in templates ship
`src/workspaces/templates/<name>/bootstrap.mjs` (plain ESM, no TS syntax),
spawned on the Electron-bundled Node (`process.execPath` +
`ELECTRON_RUN_AS_NODE`), and **all git goes through bundled git (`dugite`)**
via `_common.mjs`'s `git()` helper — works on bare Windows/Mac with no bash
and no system git. When adding a template: write `bootstrap.mjs`, import
`../_common.mjs` (`initWorkspaceDir` / `copyReadme` / `setupGitExcludes` /
`git`), and route every git call through `git()` — never `spawn('git')`.
`bootstrap.sh` remains a fallback for third-party/satellite templates only
(needs bash on PATH); don't add new `.sh` bootstraps in-repo. Packaging
invariant: `dugite` must stay in `pnpm.onlyBuiltDependencies` (its
postinstall fetches the per-platform git; release CI asserts it's present).

## Rules & skills (where the details live)

- Git rules (branch safety, external-PR quarantine, contributor credit) → `.claude/rules/git-workflow.md` (always loaded)
- UTA rules → `.claude/rules/uta.md` (loads when touching `services/uta/**`)
- UI rules incl. demo-handler duty → `.claude/rules/ui.md` (loads when touching `ui/**`)
- **Session start**: run the `openalice-session-start` skill checklist before touching code
- **After trading-path changes**: run the `uta-test-scenarios` skill — canonical catalog at [docs/uta-live-testing.md](docs/uta-live-testing.md) (S1–S14, demo accounts)
- `/api/*` surface changes: `openalice-demo-mode` skill (MSW handler sync)
- Event / Listener / Producer system → [docs/event-system.md](docs/event-system.md) — read before adding an event type, Listener, or Producer

## Future work — Linear, not TODO.md

Out-of-scope findings go to Linear: team `Angelkawaii` (ANG), project
`TODO from AI Code` — https://linear.app/angelkawaii/project/todo-from-ai-code-0f966d818f84.
Each issue: **symptom / suspected location (file + rough lines) / why
deferred / cross-references**. Don't file product feature requests or
trigger-less tech debt. If the current PR can handle it, just handle it.

## README.md

Public-facing positioning artifact. Audit it **right after** a large-scale
change ships (new top-level concept, retired module, reshaped layer,
generation bump — not bug fixes or internal renames). **Ask the user how to
frame changes before editing**; don't churn the tagline / pillars / hero copy.

## Migrations

Any upgrade-time transformation of user data goes through `src/migrations/`
(`NNNN_short_name/index.ts` + sibling spec; append to `registry.ts`; then
`pnpm build:migration-index`). Idempotency at two layers: the journal in
`data/config/_meta.json` and an in-body self-check. Files outside
`data/config/` use raw `fs/promises` and declare `affects`. Never inline
one-time cleanup in `main.ts` / bootstrap — a real incident left orphan cron
jobs firing every 15 min for weeks.

## Project Structure

pnpm monorepo. Two long-running processes (Alice + UTA), supervised by
Guardian, sharing one `data/` volume.

```
src/                    # Alice process — agent runtime
├── main.ts             # Composition root
├── core/               # ToolCenter + workspace-tool-center + InboxStore +
│                       #   session store + event-log + listener/producer +
│                       #   config (central credential vault) +
│                       #   credential-inference
├── ai-providers/       # Preset catalog ONLY (vault form suggestions — the
│                       #   in-process AI loop was deleted in 0.40)
├── domain/             # market-data / analysis / news / thinking
│                       #   (trading → services/uta; brain retired, mig 0006)
├── tool/               # AI tool definitions: thin domain→ToolCenter bridges
├── workspaces/         # Workspace launcher: PTY pool, scrollback, template
│                       #   registry, adapters/{claude,codex,opencode,pi,shell},
│                       #   templates/{auto-quant,chat} (bootstrap.mjs — see
│                       #   Cross-platform above)
├── services/           # auth / uta-client (SDK mirrors) / uta-supervisor
├── server/             # mcp.ts + opentypebb.ts
├── webui/              # Hono plugin: routes (~23), auth middleware,
│                       #   workspaces-ws.ts; trading routes BFF-proxy to UTA
├── migrations/         # Versioned data migrations (see ## Migrations)
└── task/               # cron, metrics

services/uta/           # UTA process — broker carrier. ALL broker/git-state/
                        #   FX/snapshot logic in src/domain/trading/
packages/               # uta-protocol (the ONLY cross-process shape) /
                        #   ibkr (UTA-owned) / opentypebb
scripts/guardian/       # L2 supervisor: dev.ts / prod.mjs / shared.ts
ui/                     # React frontend (Vite); auth/ ships separately

data/                   # PORTABLE user state — the backup/migrate/share unit,
                        #   ~/.openalice/data by default, ONE global store for
                        #   dev/start/packaged app. OPENALICE_HOME moves THIS
                        #   root only (Docker: /data; OPENALICE_HOME="$PWD"
                        #   pins a checkout-local store — otherwise migrations
                        #   run against the real store!). accounts.json +
                        #   auth.json sealed at rest; the AES key lives BESIDE
                        #   data/ (~/.openalice/sealing.key) so a data/-only
                        #   backup can't decrypt. Subdirs via dataPath():
                        #   config/, _backup/, sessions/ (web/admin — NOT
                        #   workspace sessions), trading/<id>/, control/,
                        #   cron/, event-log/, tool-calls/, news-collector/,
                        #   inbox/, entities/, media/, cache/, brain/ (dormant)

workspaces/             # WORKSPACE LAUNCHER ROOT — a SIBLING global root at
                        #   ~/.openalice/workspaces, governed by
                        #   AQ_LAUNCHER_ROOT and deliberately NOT following
                        #   OPENALICE_HOME (workspaces are user-level
                        #   git-heavy assets kept across checkouts; no
                        #   migrations run there). Holds workspaces.json,
                        #   state/sessions/<wsId>.json (PTY resume — the
                        #   OTHER session store), state/scrollback/,
                        #   state/headless-tasks.json + headless-logs/,
                        #   workspaces/<wsId>/ (one checkout per workspace),
                        #   auto-quant-mirror/. Sibling under ~/.openalice:
                        #   provider-keys.json (user-global vendor keys,
                        #   OPENALICE_GLOBAL_DIR; data/config values win)
```

## Key Architecture

### Workspaces — the cost-curve-inversion mechanism

`src/workspaces/` is the most important architectural surface. A workspace is
a managed persistent shell session (PTY-backed, scrollback-replayed,
template-bootstrapped) inside which an AI agent runs a capability end-to-end.
The launcher stays small; new capabilities ship as **new templates / satellite
repos, not new `src/` modules** (the old chat-hook layer burned ~50% of dev
time before this pivot). Workspaces are sandboxable and are the natural
boundary for "AI autonomous" vs "human approves".
Load-bearing files: `service.ts`, `session-pool.ts`, `session-registry.ts`,
`scrollback-store.ts`, `template-registry.ts`, `adapters/*.ts`, `protocol.ts`.

### Alice ↔ UTA split

Broker domain runs as a separate process. Alice owns the agent runtime; UTA
owns broker connections, git-like trade approval state, FX, snapshots, all
`IBroker` impls. HTTP via `@traderalice/uta-protocol` only. Co-located on
`127.0.0.1` today; the protocol exists so UTA can detach to a separate device.
UTA restart = flag-file protocol (`data/control/restart-uta.flag`, Guardian).

### Inbox — Workspace → user push channel

Agents call the `inbox_push` MCP tool to surface a document + comment in the
Inbox tab; the user replies back into the workspace session. `core/inbox-store.ts`
(append-only JSONL) + `tool/inbox-push.ts`, wired through
`core/workspace-tool-center.ts` (wsId bound per workspace). The Inbox is the
only push surface — cron-fired headless workspace runs deliver here too.

### AI execution — native CLIs + credential vault

The model loop runs **inside** the native workspace CLIs. Alice has no
in-process AI loop (deleted in 0.40). Alice owns: the **central credential
vault** (`core/config.ts`, credentials declare wire capabilities; injected
via `workspaces/credential-injection.ts`, `pickAgentWire`: claude→anthropic,
codex→openai-responses), **wire shapes** (`ai-providers/preset-catalog.ts`:
anthropic / openai-chat / openai-responses), and the one-shot key test
(`workspaces/agent-probe.ts`). Legacy chat path (AgentCenter, connectors,
`/chat` SSE) was removed in 0.30 — see migration 0007. Don't resurrect either.

### ToolCenter

`src/tool/*` register via `ToolCenter.register()`; exports Vercel-tool and MCP
shapes. Workspace-scoped registration goes through
`core/workspace-tool-center.ts` — that's how Trading-context injection lands
inside a workspace.

## Conventions

- ESM only (`.js` extensions in imports), path alias `@/*` → `./src/*`
- Strict TypeScript, ES2023 target
- Zod for config, TypeBox for tool parameter schemas
- `decimal.js` for financial math
- Logging: the workspace launcher writes structured JSON to
  `logs/workspace-sessions.log` (`src/workspaces/logger.ts`); the main
  process logs via `console`. (`pino` is a declared dep but currently
  unused — don't assume a central pino sink exists.)
