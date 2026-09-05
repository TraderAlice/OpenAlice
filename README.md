<p align="center">
  <img src="docs/images/alice-full.png" alt="OpenAlice" width="88">
</p>

<h1 align="center">OpenAlice</h1>

<p align="center">
  <strong>The AI orchestrator for trading.</strong><br>
  Your one-person Wall Street — bring your AI agents, market tools, research, and trading accounts into one local workspace.
</p>

<p align="center">
  <a href="https://openalice.ai"><img src="https://img.shields.io/badge/Website-blue" alt="Website"></a> · <a href="https://openalice.ai/docs"><img src="https://img.shields.io/badge/Docs-green" alt="Docs"></a> · <a href="https://x.com/OpenAliceAI"><img src="https://img.shields.io/badge/X-000000?logo=x&logoColor=white" alt="X (Twitter)"></a> · <a href="https://discord.gg/zf4STmrQd8"><img src="https://img.shields.io/badge/Discord-5865F2?logo=discord&logoColor=white" alt="Discord"></a> · <a href="https://qm.qq.com/q/iSg6O4FmrC"><img src="https://img.shields.io/badge/QQ-12B7F5" alt="QQ"></a>
</p>

<p align="center">
  <a href="https://openalice.ai/docs/getting-started/installation">Install OpenAlice</a> · <a href="#features">Features</a> · <a href="https://openalice.ai/docs/getting-started/quick-start">Quick Start</a>
</p>

<p align="center">
  <img src="docs/images/ask-alice.jpg" alt="Ask Alice: choose a Workspace and agent, then start a market research task" width="960">
</p>

Research a company, test an idea, keep a thesis under review, or prepare a trade.
OpenAlice connects the agents you already use to market data, dedicated research
workspaces, scheduled tasks, and trading accounts. Work with one agent or several;
your files, research history, and follow-ups stay in place between sessions.

## Get Started

[Download the desktop app](https://github.com/TraderAlice/OpenAlice/releases/latest)
for macOS or Windows. The desktop app includes Pi; connect a model credential or
supported login to start researching. **You do not need a broker account.**

Prefer a terminal or server? See the [CLI installer](docs/cli-installer.md),
[remote quickstart](docs/remote-quickstart.md), or
[Docker setup](https://openalice.ai/docs/deployment/docker).
For platform details, see the [installation guide](https://openalice.ai/docs/getting-started/installation).

Try a first task in Ask Alice:

> Build a thesis on NVDA. Compare fundamentals with sector trends and price
> behavior, save the research in this Workspace, and explain what would prove
> the thesis wrong.

Continue with a follow-up, turn it into a recurring Issue, or take the idea into
AutoQuant for quantitative research. [Walk through your first research workflow →](https://openalice.ai/docs/getting-started/quick-start)

## Features

### Put your agents to work with market tools

Use Claude Code, Codex, OpenCode, Pi, Oh My Pi, and other supported native agents
with Alice's market data, fundamentals, news, and quantitative tools. Inspect the
same markets yourself in the UI, then ask an agent to investigate further.
Available data depends on your configured providers.

### Give each line of research a place to grow

Keep conversations, files, and Git history together in reusable Workspaces.
Use Chat for general research, AutoQuant for quantitative projects and experiments,
and Auto Prediction for prediction-market research. The specialist workspaces
have their own Studio interfaces and can be developed by the agent working inside them.

### Keep following the ideas that matter

Link research to assets and topics in Tracked. Turn follow-up work into Issues
with instructions and a schedule: a morning scan, a weekly macro review, or a
recurring check on a thesis. Scheduled runs use the Workspace's agent and context.

### Get results you can follow up on

Inbox brings together reports, questions, and updates from your Workspaces.
Open the research file or reply to the Session that produced it. Use Workspace
Manager to inspect who owns what, review scheduled work, and coordinate across
Workspaces when you need a wider view.

<table>
  <tr>
    <td><img src="docs/images/issue-board.jpg" alt="Issues with scheduled research, run status, and work awaiting human review"></td>
    <td><img src="docs/images/tracked.jpg" alt="Tracked graph connecting assets, research topics, notes, and Issues"></td>
  </tr>
  <tr>
    <td align="center"><strong>Keep research moving</strong><br>Issues, schedules, and work that needs attention.</td>
    <td align="center"><strong>Connect your research</strong><br>Assets, topics, and the work behind your ideas.</td>
  </tr>
  <tr>
    <td><img src="docs/images/inbox.jpg" alt="Inbox report with a research attachment and a reply to the originating Session"></td>
    <td><img src="docs/images/market.jpg" alt="Market view with price history, company profile, and fundamental metrics"></td>
  </tr>
  <tr>
    <td align="center"><strong>Read, then follow up</strong><br>Reports and a direct path back to their author.</td>
    <td align="center"><strong>Explore the market</strong><br>Prices, fundamentals, and context for your next question.</td>
  </tr>
</table>

### Bring research to a trading decision

Connect supported brokers through Unified Trading Account to inspect holdings,
orders, and account state. With AI trading enabled, agents can stage proposed
operations and commit their rationale. You review and approve execution through
Trading as Git.

> [!CAUTION]
> **Trading execution is beta.** Start with simulator, paper, demo, or testnet
> accounts. OpenAlice is experimental software; interfaces may change, and it
> provides no guarantees of correctness, reliability, profitability, or loss prevention.
> Use real funds only if you understand and accept the risks.

[Unified Trading Account](https://openalice.ai/docs/core-concepts/unified-trading-account) · [Trading as Git](https://openalice.ai/docs/core-concepts/trading-as-git)

## Local and Yours

OpenAlice runs on your machine by default. Workspaces are directories and Git
repositories you can inspect, edit, and back up. Alice stores its own state under
`~/.openalice` and seals broker credentials at rest. Your chosen agents and data
providers still use their configured services.

Native agents keep their own model loops and tool behavior. Workspace files,
skills, and dedicated research projects give them the context to do trading work.

[Data, credentials, and backups →](https://openalice.ai/docs/deployment/data-and-credentials)

## Documentation and Help

- [Documentation](https://openalice.ai/docs) — setup, research workflows, agents, and trading.
- [Discord](https://discord.gg/zf4STmrQd8) · [QQ group](https://qm.qq.com/q/iSg6O4FmrC) — questions and community.
- [GitHub Issues](https://github.com/TraderAlice/OpenAlice/issues) — report a bug or propose an improvement.
- [DeepWiki](https://deepwiki.com/TraderAlice/OpenAlice) — explore the codebase.

## Development

```bash
git clone https://github.com/TraderAlice/OpenAlice.git
cd OpenAlice
pnpm install
pnpm dev
```

Open the UI URL printed by the terminal. Source installs need at least one host
agent CLI and its model credentials or login.
See [Source & Dev](https://openalice.ai/docs/getting-started/developer-setup) for
setup and [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR.

## Star History

<p align="center">
  <a href="https://github.com/TraderAlice/OpenAlice">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="docs/images/star-history-dark.svg">
      <img src="docs/images/star-history.svg" alt="OpenAlice GitHub star history" width="900">
    </picture>
  </a>
</p>

<p align="center">
  <a href="https://github.com/TraderAlice/OpenAlice"><img src="https://img.shields.io/github/stars/TraderAlice/OpenAlice?style=flat-square&logo=github&label=Current%20stars" alt="Current GitHub stars"></a>
</p>

## Contributors

OpenAlice is sharper for the people who dig into it with us: the bugs they
catch, the ideas they push, the UX edges they notice, the designs and reviews
they bring. High-signal issues and PR proposals count here. If a report,
suggestion, or implementation proposal changes the product, it gets credited.

<!-- Standouts first. Avatars come free from https://github.com/<handle>.png -->
<p>
  <a href="https://github.com/bakabird"><img src="https://github.com/bakabird.png" width="56" height="56" alt="@bakabird" /></a>
  <a href="https://github.com/2233admin"><img src="https://github.com/2233admin.png" width="56" height="56" alt="@2233admin" /></a>
  <a href="https://github.com/lvysssss"><img src="https://github.com/lvysssss.png" width="56" height="56" alt="@lvysssss" /></a>
  <a href="https://github.com/walkonbothsides"><img src="https://github.com/walkonbothsides.png" width="56" height="56" alt="@walkonbothsides" /></a>
  <a href="https://github.com/bakabaka0613"><img src="https://github.com/bakabaka0613.png" width="56" height="56" alt="@bakabaka0613" /></a>
  <a href="https://github.com/JasonWang1124"><img src="https://github.com/JasonWang1124.png" width="56" height="56" alt="@JasonWang1124" /></a>
  <a href="https://github.com/rudyll"><img src="https://github.com/rudyll.png" width="56" height="56" alt="@rudyll" /></a>
  <a href="https://github.com/jalilsedna"><img src="https://github.com/jalilsedna.png" width="56" height="56" alt="@jalilsedna" /></a>
  <a href="https://github.com/dbydd"><img src="https://github.com/dbydd.png" width="56" height="56" alt="@dbydd" /></a>
  <a href="https://github.com/enderzcx"><img src="https://github.com/enderzcx.png" width="56" height="56" alt="@enderzcx" /></a>
</p>

**See the full list and what each person shaped**: [CONTRIBUTORS.md](./CONTRIBUTORS.md)

## License

[AGPL-3.0](LICENSE)
