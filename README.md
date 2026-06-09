<p align="center">
  <a href="https://www.atlascloud.ai/?utm_source=github&utm_medium=link&utm_campaign=openalice">
    <img src="docs/atlas-cloud-logo.png" alt="Atlas Cloud" width="200">
  </a>
</p>

> 🎁 **[Atlas Cloud](https://www.atlascloud.ai/?utm_source=github&utm_medium=link&utm_campaign=openalice)** is a full-modal AI inference platform — 59 frontier LLMs (DeepSeek-V4, Qwen3, Kimi K2, GPT-5, Gemini 2.5 Pro, Claude, Grok-4…) via a single OpenAI-compatible endpoint. Power OpenAlice's market analysis and trading decisions with Atlas Cloud. [View all models](https://www.atlascloud.ai/models) · [Coding Plan](https://www.atlascloud.ai/console/coding-plan)

<details>
<summary>📋 59 models available on Atlas Cloud</summary>

| Model | Type |
|-------|------|
| deepseek-ai/deepseek-v4-pro | LLM |
| deepseek-ai/deepseek-v4-0520 | LLM |
| deepseek-ai/deepseek-v4-flash | LLM |
| deepseek-ai/deepseek-r2 | LLM |
| deepseek-ai/deepseek-r2-0528 | LLM |
| deepseek-ai/deepseek-r1-0528 | LLM |
| deepseek-ai/deepseek-r1 | LLM |
| deepseek-ai/deepseek-prover-v2 | LLM |
| moonshot-ai/kimi-k2 | LLM |
| moonshot-ai/kimi-k2-0711 | LLM |
| moonshot-ai/kimi-k1.5-long | LLM |
| qwen/qwen3-235b-a22b | LLM |
| qwen/qwen3-30b-a3b | LLM |
| qwen/qwen3-32b | LLM |
| qwen/qwq-32b | LLM |
| openai/gpt-5 | LLM |
| openai/gpt-5-mini | LLM |
| openai/gpt-4.1 | LLM |
| openai/gpt-4o | LLM |
| openai/o3 | LLM |
| openai/o4-mini | LLM |
| openai/o3-mini | LLM |
| anthropic/claude-sonnet-4-5 | LLM |
| anthropic/claude-opus-4 | LLM |
| anthropic/claude-sonnet-4 | LLM |
| anthropic/claude-haiku-4-5 | LLM |
| google/gemini-2.5-pro | LLM |
| google/gemini-2.5-flash | LLM |
| google/gemini-2.5-flash-lite | LLM |
| google/gemini-2.0-flash | LLM |
| xai/grok-4 | LLM |
| xai/grok-3 | LLM |
| xai/grok-3-mini | LLM |
| meta-llama/llama-4-scout | LLM |
| meta-llama/llama-4-maverick | LLM |
| meta-llama/llama-3.3-70b | LLM |
| cohere/command-a | LLM |
| mistral/mistral-large | LLM |
| minimax/minimax-m1 | LLM |
| 01ai/yi-lightning | LLM |
| seedance/seedance-v1-pro | Video |
| seedance/seedance-v1-pro-fast | Video |
| seedance/seedance-v1-lite | Video |
| kling/kling-v2.1-pro | Video |
| kling/kling-v2.1-standard | Video |
| kling/kling-v1.6-pro | Video |
| kling/kling-v1.6-standard | Video |
| wan2/wan2.1-t2v-turbo | Video |
| wan2/wan2.1-i2v-turbo | Video |
| veo/veo3.1-fast | Video |
| veo/veo3-fast | Video |
| veo/veo3 | Video |
| runway/gen4-turbo | Video |
| stable-diffusion/sd3.5-large | Image |
| flux/flux1.1-pro-ultra | Image |
| flux/flux1.1-pro | Image |
| ideogram/ideogram-v3 | Image |
| recraft/recraft-v3 | Image |
| minimax/hailuo-i2v-01-live | Video |
</details>

---

<p align="center">
  <img src="docs/images/alice-full.png" alt="OpenAlice" width="140">
</p>

<h1 align="center">OpenAlice</h1>

<p align="center">
  <strong>Your one-person Wall Street.</strong><br>
  An AI trading agent covering equities, crypto, commodities, forex, and macro — from research through position entry, ongoing management, to exit.
</p>

<p align="center">
  <a href="https://openalice.ai"><img src="https://img.shields.io/badge/Website-blue" alt="Website"></a> · <a href="https://openalice.ai/docs"><img src="https://img.shields.io/badge/Docs-green" alt="Docs"></a> · <a href="https://x.com/OpenAliceAI"><img src="https://img.shields.io/badge/X-000000?logo=x&logoColor=white" alt="X (Twitter)"></a> · <a href="https://discord.gg/zf4STmrQd8"><img src="https://img.shields.io/badge/Discord-5865F2?logo=discord&logoColor=white" alt="Discord"></a> · <a href="https://qm.qq.com/q/iSg6O4FmrC"><img src="https://img.shields.io/badge/QQ-12B7F5" alt="QQ"></a>
</p>

<p align="center">
  <img src="docs/images/preview.png" alt="OpenAlice Preview" width="720">
</p>

- **Full-spectrum** — analyze and trade across asset classes. Multiple brokers combine into one unified workspace so you're never stuck with "I can see it but can't trade it."
- **Full-lifecycle** — not just entry signals. Research, position sizing, ongoing monitoring, risk management, and exit decisions — Alice covers the entire trading lifecycle, 24/7.
- **Full-control** — every trade goes through version history and safety checks, and requires your explicit approval before execution. You see every step, you can stop every step.

Alice runs on your own machine, because trading involves private keys and real money — that trust can't be outsourced.

> [!CAUTION]
> **OpenAlice is experimental software in active development.** Many features and interfaces are incomplete and subject to breaking changes. Do not use this software for live trading with real funds unless you fully understand and accept the risks involved. The authors provide no guarantees of correctness, reliability, or profitability, and accept no liability for financial losses.

## Features

### Trading

- **Unified Trading Account (UTA)** — multiple brokers (CCXT, Alpaca, Interactive Brokers) combine into unified workspaces. AI interacts with UTAs, never with brokers directly
- **Trading-as-Git** — stage orders, commit with a message, push to execute. Full history reviewable with commit hashes
- **Guard pipeline** — pre-execution safety checks (max position size, cooldown, symbol whitelist) per account
- **Account snapshots** — periodic and event-driven state capture with equity curve visualization

### Research & Analysis

- **Market data** — equity, crypto, commodity, currency, and macro data via TypeScript-native OpenBB engine. Unified cross-asset symbol search and technical indicator calculator
- **Fundamental research** — company profiles, financial statements, ratios, analyst estimates, earnings calendar, insider trading, and market movers. Currently deepest for equities, expanding to other asset classes
- **News** — background RSS collection with archive search

### Automation

Automation has two layers in OpenAlice. They're worth separating because each evolves on its own track:

**Scheduling — *what* fires an AI call.** A typed append-only event log + cron engine that emits events on a schedule. Stable, reusable across both old and new execution models.

- **Cron scheduling** — cron expressions, intervals, or one-shot timestamps
- **Heartbeat** — a periodic timer with active-hours filtering and a dedup window
- **Webhooks** — inbound event triggers from external systems (planned)

**Execution — *how* the trigger lands.** This layer is being rebuilt. The scheduling above is solid and the AI run itself works — a fired event drives an AI call whose reply lands in the Inbox. What's still in flight is the *last mile*: wiring a scheduled trigger into a workspace-resident execution (a one-shot task inside a Workspace, or continued dialog on a Workspace's persistent Session) depends on the Workspace scheduler landing. Until then, Automation runs but its end-to-end delivery is intentionally minimal. The scheduling layer is shared either way, so this rebuild doesn't touch *what* fires — only *where* it ultimately runs.

### Interface

- **Web UI** — workspace chat, the Inbox, a portfolio dashboard with equity curve, and full config management
- **Workspace** — a per-task directory + git repo + persistent terminal session running your chosen agent CLI (`claude` / `codex` / `shell`) with OpenAlice's MCP tools plumbed in. The recommended path for any non-trivial AI work — native prompt cache, native rendering, no protocol shim
- **Inbox** — workspace-to-user push channel. Agents call `inbox_push` from inside a workspace to surface a document (rendered live) plus a markdown comment in a dedicated tab; click the reply bar to jump back into the workspace and continue
- **MCP server** — tool exposure for external agents

### And More!

- **Multi-provider AI** — Claude (Agent SDK with OAuth or API key) or Vercel AI SDK (Anthropic, OpenAI, Google), switchable at runtime
- **Evolution mode** — permission escalation that gives Alice full project access including Bash, enabling self-modification


## Architecture

OpenAlice splits into **two long-lived processes** managed by a thin
supervisor:

```mermaid
graph TB
  subgraph Surfaces["Surfaces — where users interact"]
    WEB[Web UI]
    INB[Inbox tab]
    MCPS[MCP Server]
  end

  subgraph Workspace["Workspace — agent's home<br/>(dir + git + native CLI)"]
    WCLI[claude / codex / shell session]
  end

  subgraph Alice["Alice process — agent runtime + research"]
    subgraph Core["Core — orchestration"]
      GR[GenerateRouter<br/>provider routing]
      TC[ToolCenter<br/>+ Workspace ToolCenter]
      IS[InboxStore]
      AW[AgentWork<br/>cron / heartbeat runs]
    end
    subgraph AliceDomain["Domain — Alice-side"]
      MD[Market Data]
      AN[Analysis]
      NC[News]
    end
    SDK[UTA SDK<br/>HTTP client]
  end

  subgraph UTA["UTA service — broker carrier"]
    TG2[Trading Git]
    GD[Guards]
    BK[Brokers]
    FX[FX + Snapshots]
  end

  subgraph Sched["Scheduling — what fires"]
    CRON[Cron / Heartbeat / Webhook]
  end

  CRON --> AW
  AW --> GR
  AW -.delivers.-> IS

  WEB --> Workspace
  WEB --> INB
  SDK -.HTTP.-> UTA

  Workspace -->|.mcp.json| MCPS
  MCPS --> TC
  TC --> AliceDomain
  TC --> SDK
  Workspace -.inbox_push.-> IS
  IS --> INB
```

**Alice process** holds the agent runtime, research domain (market data,
analysis, news), workspace launcher, and all user-facing surfaces. Alice
**does not** hold broker credentials and does not talk to exchanges
directly. It owns the *deciding* — what to research, when to act, what
to say.

**UTA service** owns the broker connections, the git-like trading state
machine, guards, FX, and snapshot scheduling. AI tools and the
frontend reach it through a thin HTTP SDK — `ctx.utaManager.placeOrder()`
on the Alice side becomes a typed request to the UTA process. UTA owns
the *doing* — order construction, execution, state.

Today the two run on the same host (Docker container or `pnpm dev` on
your laptop) under a Guardian supervisor; tomorrow the UTA service is
designed to detach: run UTA on a phone, a home-network always-on box,
or any device you actually trust with your broker keys, while Alice
sits on a VPS, your desktop, or wherever's convenient. Same wire
protocol either way. The shape echoes a hardware wallet — the
credential-holding half is small, isolated, and stays put; the rich
client half can live wherever you want.

**Surfaces** — Web UI (workspace chat, the Inbox tab, portfolio
dashboards) and the MCP Server for external agents. Where users see
and steer Alice.

**Workspace** — A per-task directory + git repo + persistent terminal
session running a native agent CLI. The recommended substrate for
non-trivial AI work. Wired to OpenAlice via two MCP servers in
`.mcp.json`: a global one (full tool catalog) and a per-workspace one
(workspace-scoped tools like `inbox_push`, with the wsId carried in the
URL path so the agent never traffics its own identity).

**Core (Alice)** — GenerateRouter resolves AI calls to the active
provider. ToolCenter is the shared registry for global tools;
WorkspaceToolCenter holds per-workspace tool factories. AgentWork
drives scheduled (cron / heartbeat) AI runs through the router.
InboxStore is an append-only JSONL behind the Inbox tab — the single
push surface back to the user.

**Alice-side Domain** — Market Data, Analysis, and News. Each module is
exposed to AI through tool registrations and never touches broker code.

**UTA service (carrier)** — Owns the IBroker implementations (CCXT,
Alpaca, Interactive Brokers, Longbridge, MockBroker), the
Trading-as-Git state machine, guards, FxService, the snapshot scheduler,
and the broker catalog refresh loop. Binds `127.0.0.1` only — only the
co-located Alice process talks to it. v1 ships co-located; subsequent
versions support running UTA on a separate host or device entirely.

**Guardian** — The supervisor that brings the two processes up in
order, gates Alice's boot on UTA's `/__uta/health`, and respawns UTA
when broker config changes (it watches a control flag the UI writes
through Alice's BFF, so config updates don't require restarting Alice).
Same module is used by `pnpm dev` (orchestrator with Vite) and the
Docker entrypoint (with `tini` as PID 1).

**Scheduling** — Cron, the heartbeat timer, and webhook ingest fire
events on a schedule. *What* the event drives is the execution layer:
today a fired event runs through AgentWork, which calls the active
provider via GenerateRouter and delivers the reply to the Inbox (dotted
line). The direction we're moving in is workspace-resident execution,
where a scheduled event either fires a one-shot task inside a Workspace
or drives continued dialog on a persistent Session — that last mile is
what's being rebuilt.

## Key Concepts

**UTA (Unified Trading Account)** — The core trading abstraction. Each
UTA wraps a broker connection, operation history, guard pipeline, and
snapshot scheduler into a single self-contained account. AI and the
frontend interact with UTAs exclusively — brokers are internal
implementation details. Multiple UTAs work like independent
repositories: one for Alpaca US equities, one for Bybit crypto, each
with its own history and guards. UTAs live inside the **UTA service**
(see Architecture above) rather than in the Alice process — broker
credentials are isolated to that carrier and never visible to the
agent runtime that drives trading decisions.

**Trading-as-Git** — The workflow inside each UTA. Stage orders, commit with a message, then push to execute. Push runs guards, dispatches to the broker, snapshots account state, and records a commit with an 8-char hash. Full history is reviewable like `git log` / `git show`.

**Guard** — A pre-execution safety check that runs inside a UTA before orders reach the broker. Guards enforce limits (max position size, cooldown between trades, symbol whitelist) and are configured per-account. Think of it as ESLint for trading — automated rules that catch problems before they go live.

**Heartbeat** — A scheduling pattern: a recurring timer with an active-hours filter. The pattern is general; its delivery is being rebuilt alongside the rest of Automation, so a heartbeat tick currently runs its AI check without a user-facing push until the Workspace scheduler lands. The same scheduling primitive will then wire into workspace executions too.

**AI Provider** — The AI backend that powers Alice. Claude (via Agent SDK, supports OAuth login or API key) or Vercel AI SDK (Anthropic, OpenAI, Google). Switchable at runtime — no restart needed.

**Workspace** — A directory + git repo + persistent terminal session running a native agent CLI (`claude`, `codex`, or `shell`) of your choice. OpenAlice plumbs its MCP servers into the workspace via `.mcp.json`, so the agent inside sees the workspace's local files plus OpenAlice's full tool surface (trading, market data, news, analysis). Workspaces live under `~/.openalice/workspaces/<wsId>/` — each is its own self-contained scratch directory the agent can read, write, and `git commit` inside. This is the recommended substrate for any non-trivial AI work: native prompt cache, native CLI rendering, no protocol shim between you and the model. Capability extensions (browser automation, third-party CLIs, custom scrapers) ship as new workspace **templates** rather than `src/` dependencies, keeping the main repo small.

**Templates & satellite repos** — A workspace template is a bootstrap script + initial file set that materializes a workspace of a particular shape (today: `chat`, `auto-quant`). Templates are how OpenAlice's ecosystem grows without bloating the main repo: when a new capability (a research toolkit, a backtest harness, a custom MCP server) is worth packaging, it lives in its own **satellite repo** that a template clones at bootstrap time. The main repo deliberately doesn't accept ecosystem PRs — it owns the Trading domain and the workspace launcher; everything else routes through satellite repos referenced by templates. Means template authors can ship on their own cadence, and OpenAlice's `src/` stays small.

**Inbox** — Workspace-to-user push channel. Agents working inside a workspace call the `inbox_push` MCP tool to surface docs (rendered live from workspace files) plus markdown commentary in a dedicated Inbox tab. The user reads, then clicks the reply bar at the bottom of the entry to jump back into the workspace's session and continue the conversation there. Scheduled Automation runs (cron / heartbeat) deliver here too, under a synthetic automation workspace id — the Inbox is the single push surface.

## Workspace chat

Chatting with Alice happens inside a **workspace**: a directory + git repo + a persistent terminal session running the native CLI of your chosen agent (`claude`, `codex`, or `shell`). The CLI process handles all model interaction, prompt caching, and rendering — OpenAlice's job is to plumb its MCP server into the workspace and surface the terminal in the UI.

- **Native prompt cache.** Claude Code, Codex, and the other agent CLIs implement vendor-specific cache control we can't replicate. On a long conversation this is often a 10× cost reduction.
- **Native frontend.** TUI rendering, syntax highlighting, diff display — the CLI vendor has already tuned these for their model.
- **Full tool surface.** The CLI sees the workspace's local files plus OpenAlice's MCP tools (trading, market data, news, analysis). No "greatest-common-denominator" trimming.
- **No protocol shim.** Nothing sits between you and the model — whatever the CLI can do, you can do.

The only requirement: the CLI binary has to be installed on the host running OpenAlice (the Docker image bundles `claude` and `codex`).

## Quick Start

> **Heads up:** there's no native installer yet. To try OpenAlice today you
> clone the repo and run it from source — this section is the contributor /
> early-adopter path. A DMG (macOS) + Windows installer are in flight; once
> they ship, the steps below collapse to "download, open, done."

### 0. Tools you need

| Tool | Why | Install |
| --- | --- | --- |
| **Node.js 22+** | Runs the backend | [nodejs.org](https://nodejs.org/) · `brew install node` · `nvm install 22` |
| **pnpm 10+** | Workspace package manager | `npm install -g pnpm` · [pnpm.io/installation](https://pnpm.io/installation) |
| **git** | Clone the repo | Usually already installed. If not: [git-scm.com](https://git-scm.com/) |
| **Claude Code CLI** | The agent CLI that powers Workspace chats | [Install Claude Code](https://docs.anthropic.com/en/docs/claude-code), then run `claude` once to log in with your Claude Pro/Max subscription. **No API key needed.** |

Windows additionally needs a POSIX shell — see [Windows](#windows) below.

Sanity check:

```bash
node --version    # v22.x.x
pnpm --version    # 10.x.x or newer
claude --version  # 2.x.x (Claude Code 2.x)
```

### 1. Clone and install dependencies

```bash
git clone https://github.com/TraderAlice/OpenAlice.git
cd OpenAlice
pnpm install
```

First-time `pnpm install` pulls the full monorepo + native deps (notably
`node-pty` for terminal sessions). On a normal connection allow ~1 minute.

> pnpm may print *"Ignored build scripts: ccxt, esbuild, protobufjs"* — this
> is fine, those are optional native optimizations and OpenAlice doesn't need
> them. You can run `pnpm approve-builds` later if you want to opt in.

### 2. Start it

```bash
pnpm dev
```

The first lines of output are the three URLs the dev orchestrator picked:

```text
[dev] backend  →  http://localhost:47331
[dev] MCP      →  http://localhost:47332/mcp
[dev] UI       →  http://localhost:5173  (Vite picks +1 if taken)
```

Below that you'll see backend startup logs (brokers connecting, news feeds
fetching, plugins starting). When you see

```text
engine: started
web plugin listening on http://localhost:47331
```

…the backend is ready.

> You may also see a warning *"serveStatic: root path '.../ui/dist' is not
> found"* — that's expected in dev mode (the UI is served by Vite on 5173, not
> by the backend). Ignore it. The warning goes away after `pnpm build` if you
> ever switch to production mode.

### 3. Open the UI

Open the **UI** URL the terminal printed — by default
[http://localhost:5173](http://localhost:5173). Don't open the backend port
(47331) directly in dev mode; that path serves only the pre-built UI bundle,
which doesn't exist yet on a fresh checkout.

If port 5173 is busy, Vite auto-picks 5174 (or higher) and prints the actual
URL in the terminal — always trust the terminal output over the number in
this README.

You should see Alice's sidebar (Inbox / Workspaces / Chat / Market / News).
Click **Chat** and start typing — no API keys, no config files to edit. The
default provider routes through your local Claude Code login.

### 4. When things go wrong

| Symptom | Most likely cause + fix |
| --- | --- |
| `claude: command not found` during startup | Claude Code CLI isn't installed or isn't on PATH. Revisit Step 0. |
| Backend logs `Please log in to Claude` | Claude Code session expired. Run `claude` once in any terminal to re-authenticate, then restart `pnpm dev`. |
| Browser shows *"can't connect"* on 5173 | The backend is still booting. Wait for `engine: started`, then refresh. |
| Browser loads but everything says *"disconnected"* | The WebSocket can't reach the backend. Check the terminal — backend probably exited; restart `pnpm dev`. |
| Port 5173 / 47331 already in use | Vite and the orchestrator both auto-bump to the next free port. Read the URL the terminal actually printed, not the number in this README. |
| `pnpm: command not found` | Run `npm install -g pnpm` to install it globally. |

Still stuck → see [Getting Help](#getting-help).

### Windows

OpenAlice's Workspace feature spawns bash-based bootstrap scripts to materialize new workspaces, so a POSIX shell environment is required:

- **Recommended:** install [Git for Windows](https://gitforwindows.org/) and accept the default *"Use Git from the Windows Command Prompt"* option during setup — this puts `bash` plus the POSIX utilities the scripts depend on (`sed`, `cp`, `mkdir`, `basename`, `printf`, etc.) on your PATH.
- **Alternative:** run OpenAlice from inside [WSL2](https://learn.microsoft.com/en-us/windows/wsl/install) — the Linux env handles everything natively.

Native `cmd.exe` / PowerShell alone are not supported (no `bash`, no POSIX utilities). If `bash` isn't on PATH when you create a workspace, the bootstrap fails with an inline hint pointing back here.

Note: we don't currently dogfood OpenAlice on Windows, so the broader experience (PTY rendering, file watching, paths with spaces) may have rough edges. Bug reports very welcome.

## Authentication

OpenAlice has a single admin-token gate at the web boundary. Three modes,
keyed off whether the bound interface is loopback:

**Local dev** (`pnpm dev`) — zero friction. Requests from `127.0.0.1` /
`::1` skip the gate entirely. You won't see a login screen and don't need
to know auth exists. This passthrough is disabled if you set
`OPENALICE_TRUSTED_PROXIES` (because with a proxy in front, every request
looks like localhost to Alice — trusting it would let the public in).

**Server / Docker / LAN-exposed** — a 256-bit admin token is generated on
first boot and printed **once** to stdout. Grab it, paste it into the
login screen on first browser visit, the session cookie lasts 7 days.

```bash
# Find the token from your container or process logs:
docker logs openalice 2>&1 | grep -A1 'admin token'
```

**Rotate the token** — delete `data/config/auth.json` and restart. The
next boot prints a fresh token and revokes all existing sessions.

**Escape hatch** — `OPENALICE_DISABLE_AUTH=1` turns the gate off. Only
do this when something else guarantees the boundary (Tailscale ACL, VPN,
reverse-proxy auth). Refusing to start with `bind=0.0.0.0` and no token
is the default; this env flag is the explicit opt-out.

What the gate covers: every `/api/*` route, the workspace PTY WebSocket,
and CSRF (cross-origin mutations are 403'd via Origin allowlist). The
React bundle itself is public — otherwise the login page couldn't load.

## Run on a server (Docker)

For self-hosting on a VPS or always-on box. The image bundles `claude` and
`codex` CLIs — no host install needed.

```bash
git clone https://github.com/TraderAlice/OpenAlice.git
cd OpenAlice
docker compose up -d --build
```

First-time auth (one-shot — credentials persist in the data volume so the
container can be rebuilt without losing them):

```bash
docker exec -it openalice claude        # OAuth: paste URL into any browser
docker exec -it openalice codex login   # same dance for codex
```

Then open `http://<your-server>:47331` in a browser. You'll hit the
admin-token login screen — see [Authentication](#authentication) above
for how to retrieve the first-run token from `docker logs`.

**Notes**

- All state — config, workspaces, claude/codex credentials, logs — lives in
  the `openalice-data` named volume. `docker compose down -v` is the
  factory reset.
- Already have claude/codex auth on the host? Skip the `docker exec` step
  by uncommenting the bind-mount lines in `docker-compose.yml` to reuse
  your local `~/.claude` and `~/.codex`.
- The MCP server (port 47332) is intentionally **not** exposed externally;
  it's consumed by the CLIs running inside the container only.
- The base image is `node:22-trixie-slim` (Debian 13) because several
  native deps (notably `longbridge`) ship glibc 2.39 binaries that older
  Debians don't have, and workspace bootstrap scripts need `bash` + POSIX
  utils. Alpine doesn't qualify on either count (musl libc, no bash).

## Configuration

All config lives in `data/config/` as JSON files with Zod validation. Missing files fall back to sensible defaults. You can edit these files directly or use the Web UI.

**AI Provider** — The default provider is Claude (Agent SDK), which uses your local Claude Code login — no API key needed. To use the [Vercel AI SDK](https://sdk.vercel.ai/docs) instead (Anthropic, OpenAI, Google, etc.), switch `ai-provider.json` to `vercel-ai-sdk` and add your API key. Both can be switched at runtime via the Web UI.

**Trading** — Unified Trading Account (UTA) architecture. Each account in `accounts.json` becomes a UTA with its own broker connection, git history, and guard config. Broker-specific settings live in the `brokerConfig` field — each broker type declares its own schema and validates it internally.

| File | Purpose |
|------|---------|
| `engine.json` | Trading pairs, tick interval, timeframe |
| `agent.json` | Max agent steps, evolution mode toggle, Claude Code tool permissions |
| `ai-provider.json` | Active AI provider (`agent-sdk` or `vercel-ai-sdk`), login method, switchable at runtime |
| `accounts.json` | Trading accounts with `type`, `enabled`, `guards`, and `brokerConfig` (broker-specific settings) |
| `connectors.json` | Web/MCP server ports |
| `web-subchannels.json` | Web UI sub-channel definitions with per-channel AI provider overrides |
| `tools.json` | Tool enable/disable configuration |
| `market-data.json` | Data backend (`typebb-sdk` / `openbb-api`), per-asset-class providers, provider API keys, embedded HTTP server config |
| `news.json` | RSS feeds, fetch interval, retention period |
| `snapshot.json` | Account snapshot interval and retention |
| `compaction.json` | Context window limits, auto-compaction thresholds |
| `heartbeat.json` | Heartbeat enable/disable, interval, active hours |

Persona and heartbeat prompts use a **default + user override** pattern:

| Default (git-tracked) | User override (gitignored) |
|------------------------|---------------------------|
| `default/persona.default.md` | `data/brain/persona.md` |
| `default/heartbeat.default.md` | `data/brain/heartbeat.md` |

On first run, defaults are auto-copied to the user override path. Edit the user files to customize without touching version control.

## Project Structure

OpenAlice is a pnpm monorepo with Turborepo build orchestration. See [docs/project-structure.md](docs/project-structure.md) for the full file tree.

## Getting Help

Stuck? Here's the recommended path, roughly in order:

1. **Let an AI agent fix it** — Claude Code, Cursor, or any other coding agent can read the codebase and patch most issues directly. Fastest path for bugs and "how do I do X" questions
2. **[Ask DeepWiki](https://deepwiki.com/TraderAlice/OpenAlice)** — natural-language Q&A over the entire codebase, good for architectural questions and figuring out where to look
3. **Community** — [Discord](https://discord.gg/zf4STmrQd8) for English speakers, [QQ 群](https://qm.qq.com/q/iSg6O4FmrC) for 中文开发者. For things AI can't answer — design discussions, edge cases, or just hanging out

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=TraderAlice/OpenAlice&type=Date)](https://star-history.com/#TraderAlice/OpenAlice&Date)

## License

[AGPL-3.0](LICENSE)