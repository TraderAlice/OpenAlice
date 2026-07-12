<p align="center">
  <img src="docs/images/alice-full.png" alt="OpenAlice" width="88">
</p>

<h1 align="center">OpenAlice</h1>

<p align="center">
  <strong>Your one-person Wall Street.</strong><br>
  OpenAlice turns coding agents into local trading agents by giving them a workspace, files, issues, market tools, and approval-gated trading primitives.
</p>

<p align="center">
  <a href="https://openalice.ai"><img src="https://img.shields.io/badge/Website-blue" alt="Website"></a> · <a href="https://openalice.ai/docs"><img src="https://img.shields.io/badge/Docs-green" alt="Docs"></a> · <a href="https://x.com/OpenAliceAI"><img src="https://img.shields.io/badge/X-000000?logo=x&logoColor=white" alt="X (Twitter)"></a> · <a href="https://discord.gg/zf4STmrQd8"><img src="https://img.shields.io/badge/Discord-5865F2?logo=discord&logoColor=white" alt="Discord"></a> · <a href="https://qm.qq.com/q/iSg6O4FmrC"><img src="https://img.shields.io/badge/QQ-12B7F5" alt="QQ"></a>
</p>

<p align="center">
  <img src="docs/images/ask-alice.jpg" alt="OpenAlice Ask Alice composer" width="760">
</p>

> [!CAUTION]
> **OpenAlice is experimental software in active development.** Many features and interfaces are incomplete and subject to breaking changes. The trading layer is especially beta. Do not use OpenAlice for live trading with real funds unless you fully understand and accept the risks involved. The authors provide no guarantees of correctness, reliability, profitability, or loss prevention.

## What is OpenAlice?

OpenAlice is a local trading workspace for coding agents.

The core idea is simple: coding agents became useful quickly because software work already has a collaboration substrate. Code has git, issues, markdown docs, review workflows, linters, terminals, logs, and reproducible project folders. A coding agent can enter that world and immediately understand how to inspect, modify, review, and report work.

Trading usually does not have that shape. A trader may read news, browse charts, hold broker positions, and keep private notes, but the work is rarely organized as a collaborative system that a human and multiple AI agents can share.

OpenAlice tries to make trading agent-operable by mapping trading work onto the tools coding agents already understand:

- **Workspaces** - each serious task gets a directory, git repo, terminal session, and native agent CLI.
- **Issues** - trading work becomes self-describing markdown tasks, similar to Linear tickets.
- **Tracked entities** - assets, sectors, topics, theses, and people become an Obsidian-like memory graph.
- **Inbox** - finished work is delivered as durable reports instead of disappearing into chat history.
- **Market tools** - data, news, fundamentals, technical analysis, and trading account state are exposed through CLIs and local tools.
- **Trading as Git** - optional account actions are staged, committed, reviewed, and pushed through an approval gate.

OpenAlice does not replace Claude Code, Codex, opencode, Pi, or other coding agents. It gives them a trading-shaped place to work.

## The Core Loop

Start with read-only research. You do not need a broker account to get value from OpenAlice.

1. **Ask Alice** for a market question, company overview, sector scan, or thesis check.
2. **Track what should persist** as entities and `[[wikilinks]]`.
3. **Create an issue** when the work should continue, recur, or be handed to an agent later.
4. **Schedule the issue** by writing timing and instructions into the same markdown file.
5. **Read the result in Inbox** when the agent has something worth showing you.

<table>
  <tr>
    <td><img src="docs/images/issue-board.jpg" alt="OpenAlice Issue Board"></td>
    <td><img src="docs/images/tracked.jpg" alt="OpenAlice Tracked Entities"></td>
  </tr>
  <tr>
    <td align="center"><strong>Issue Board</strong></td>
    <td align="center"><strong>Tracked Entities</strong></td>
  </tr>
  <tr>
    <td><img src="docs/images/inbox.jpg" alt="OpenAlice Inbox"></td>
    <td><img src="docs/images/market.jpg" alt="OpenAlice Market tools"></td>
  </tr>
  <tr>
    <td align="center"><strong>Inbox</strong></td>
    <td align="center"><strong>Market Tools</strong></td>
  </tr>
</table>

That loop is the main product surface today. A timer does not call a magic trading endpoint. It launches an agent against a self-describing workspace issue, using the same files, tools, memory, and reporting path an attended session uses.

## What You Get

| Surface | What it does |
| --- | --- |
| **Workspaces** | Per-task git repositories with a persistent terminal running `claude`, `codex`, `opencode`, `pi`, or `shell`. |
| **Issue Board** | Markdown-backed work items with status, priority, assignee, comments, links, and optional schedule metadata. |
| **Tracked Entities** | A durable graph for tickers, themes, sectors, people, risks, and theses. |
| **Inbox** | A delivery surface for reports, scheduled run output, and agent status updates. |
| **Market Data** | Equities, crypto, macro, fundamentals, symbol search, technical indicators, news, and RSS tools. |
| **Unified Trading Account** | Optional beta account abstraction for brokers such as Alpaca, IBKR, Longbridge, and CCXT venues. |
| **Trading as Git** | Stage, commit, review, and push account operations instead of letting an agent fire orders directly. |

## Why Local?

Trading involves private notes, account state, credentials, strategy, and real money. OpenAlice runs on your machine by default, stores state as files under `~/.openalice`, and keeps broker credentials sealed at rest.

There is no Postgres or Redis to provision. Config, sessions, issues, inbox entries, workspace artifacts, news archives, and trading history are ordinary files and git repositories. That makes the system easier to inspect, back up, debug, patch, and reason about.

## Quick Start

Pick the run path that matches your machine:

- **macOS** - use the signed Apple Silicon or Intel desktop build: [macOS install](https://openalice.ai/docs/getting-started/install-macos).
- **Windows** - choose the self-contained unsigned desktop beta or the source path: [Windows install](https://openalice.ai/docs/getting-started/install-windows).
- **Linux, contributors, debugging** - use the source path: [Source & Dev](https://openalice.ai/docs/getting-started/developer-setup).
- **Server or always-on machine** - use Docker Compose: [Docker deployment](https://openalice.ai/docs/deployment/docker).

The source path is still the best early-adopter path because it gives you logs and local code:

```bash
git clone https://github.com/TraderAlice/OpenAlice.git
cd OpenAlice
pnpm install
pnpm dev
```

Open the UI URL printed by the terminal, usually `http://localhost:5173`.

The packaged desktop includes managed Pi; the Docker image pins Claude Code,
Codex, opencode, and Pi. Both still need a model credential or supported CLI
login. Source installs need at least one host agent CLI. OpenAlice runs the
model loop inside that native runtime so you keep its conversation state,
provider login, and tool behavior.

## Documentation

The README is intentionally short. The real docs live at [openalice.ai/docs](https://openalice.ai/docs).

- [What is OpenAlice](https://openalice.ai/docs/getting-started/what-is-openalice) - the product model and current boundary.
- [Quick Start](https://openalice.ai/docs/getting-started/quick-start) - your first research, tracking, issue, schedule, and Inbox loop.
- [Installation Overview](https://openalice.ai/docs/getting-started/installation) - choose macOS, Windows, source, Docker, or remote access.
- [Workspaces](https://openalice.ai/docs/workspaces/workspaces) - the directory, git, CLI, and file-backed substrate.
- [Sessions & Collaboration](https://openalice.ai/docs/workspaces/sessions-and-collaboration) - durable Session identity, signatures, provenance, and attributable follow-up.
- [Lifecycle & Offboarding](https://openalice.ai/docs/workspaces/lifecycle) - handoff, departed desks, restore, purge, and Session retirement.
- [Workspace Automation](https://openalice.ai/docs/workspaces/automation) - scheduled runs through self-describing issues.
- [Unified Trading Account](https://openalice.ai/docs/core-concepts/unified-trading-account) - the beta account layer and safety warnings.
- [Trading as Git](https://openalice.ai/docs/core-concepts/trading-as-git) - staged, committed, approval-gated trading operations.
- [Data & Credentials](https://openalice.ai/docs/deployment/data-and-credentials) - state layout, sealed credentials, ports, and backup.

## Project Status

OpenAlice is useful today for research, issue-based work, tracked memory, scheduled reports, and Inbox delivery.

Treat broker execution as beta infrastructure. Start with simulator, paper, demo, or testnet accounts. If you hit UTA errors, broker connection failures, or confusing execution behavior, bring the error to Discord or open a GitHub issue so we can reproduce it.

## Getting Help

Stuck? The fastest path is usually:

1. **Ask an AI coding agent to inspect the repo** - OpenAlice is intentionally file-backed and agent-readable.
2. **Read the docs** - [openalice.ai/docs](https://openalice.ai/docs).
3. **Ask DeepWiki** - [deepwiki.com/TraderAlice/OpenAlice](https://deepwiki.com/TraderAlice/OpenAlice).
4. **Join the community** - [Discord](https://discord.gg/zf4STmrQd8) for English speakers, [QQ group](https://qm.qq.com/q/iSg6O4FmrC) for 中文开发者.

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=TraderAlice/OpenAlice&type=Date)](https://star-history.com/#TraderAlice/OpenAlice&Date)

## Contributors

OpenAlice is sharper for the people who dig into it with us: the bugs they
catch, the ideas they push, the UX edges they notice, the designs and reviews
they bring. High-signal issues and PR proposals count here. If a report,
suggestion, or implementation proposal changes the product, it gets credited.

<!-- Standouts first. Avatars come free from https://github.com/<handle>.png -->
<p>
  <a href="https://github.com/2233admin"><img src="https://github.com/2233admin.png" width="56" height="56" alt="@2233admin" /></a>
  <a href="https://github.com/lvysssss"><img src="https://github.com/lvysssss.png" width="56" height="56" alt="@lvysssss" /></a>
  <a href="https://github.com/walkonbothsides"><img src="https://github.com/walkonbothsides.png" width="56" height="56" alt="@walkonbothsides" /></a>
  <a href="https://github.com/bakabaka0613"><img src="https://github.com/bakabaka0613.png" width="56" height="56" alt="@bakabaka0613" /></a>
  <a href="https://github.com/JasonWang1124"><img src="https://github.com/JasonWang1124.png" width="56" height="56" alt="@JasonWang1124" /></a>
  <a href="https://github.com/bakabird"><img src="https://github.com/bakabird.png" width="56" height="56" alt="@bakabird" /></a>
  <a href="https://github.com/rudyll"><img src="https://github.com/rudyll.png" width="56" height="56" alt="@rudyll" /></a>
</p>

**See the full list and what each person shaped**: [CONTRIBUTORS.md](./CONTRIBUTORS.md)

## License

[AGPL-3.0](LICENSE)
