# Documentation media audit

This file is the working inventory for
[`#55`](https://github.com/TraderAlice/alice-landing/issues/55). It follows
`SUMMARY.md` order and must continue to account for every MDX page, including
reference pages near the end of the navigation.

For asset-level descriptions, recovered recording recipes, source availability
and current references, see the [video catalog](../../media/videos/README.md).
The baseline and acceptance statuses below are historical; the catalog audit
does not mark these product workflows as re-verified.

## Baseline

- Audit date: 2026-08-24
- Landing branch: `codex/ask-alice-demo` at `b124272`
- Product source used for the current hands-on pass: OpenAlice at `5967b89a`
- Pages: 52
- Pages with any media: 19
- Pages with a `ProductDemo`: 8
- Text-only pages: 33

Status values:

- `done` — truthful asset exists and is integrated.
- `partial` — useful evidence exists, but the planned claim or full QA pass is
  incomplete.
- `todo` — not captured, integrated, or verified yet.
- `n/a` — the status does not apply until an asset exists.

Every row is classified as **demo**, **screenshot**, or **diagram**. A future
`no visual` classification must include a written rationale in the row; there
are currently no pages for which text alone is the clearest explanation.

## Getting Started and installation

| Page | Pri | Class | Intended claim or workflow | Source surface | Planned or existing asset | Capture | Integrate | Desktop | 390px |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [What is OpenAlice](/docs/getting-started/what-is-openalice) | P1 | diagram | Show the boundary between coding agent, Workspace, UTA, and broker. | Product architecture + Ask Alice | System-boundary diagram; current Ask Alice screenshot remains supporting evidence. | partial | partial | todo | todo |
| [Quick Start](/docs/getting-started/quick-start) | P3 | demo | Complete the first read-only Ask Alice loop and recognize its result. | Ask Alice, Tracked, Issues, Inbox, Trading settings | Real Codex run plus four focused screenshots. | done | done | done | done |
| [Installation Overview](/docs/getting-started/installation) | P0 | diagram | Choose the right install path and recognize each success state. | Download page, installers, terminal | Install-path decision diagram plus one success-state image per path. | todo | todo | n/a | n/a |
| [macOS](/docs/getting-started/install-macos) | P0 | demo | Install, pass first launch, detect a runtime, and reach Ask Alice. | DMG / installed desktop app | Short first-launch walkthrough with sharp poster. | todo | todo | n/a | n/a |
| [Windows](/docs/getting-started/install-windows) | P0 | demo | Install from the Windows path and reach a usable first screen. | Windows installer or PowerShell + desktop app | Short install and first-launch walkthrough, including real security prompt if present. | todo | todo | n/a | n/a |
| [Source & Dev](/docs/getting-started/developer-setup) | P0 | demo | Install dependencies, start services, and recognize a healthy Ask Alice UI. | Terminal + source UI | Terminal-to-browser walkthrough with success output. | todo | todo | n/a | n/a |
| [Docker](/docs/deployment/docker) | P3 | screenshot | Start Docker, sign in, reach Ask Alice, and configure an AI provider. | Docker deployment | Three existing focused screenshots. | done | done | todo | todo |
| [CLI & Remote Access](/docs/deployment/remote-access) | P1 | demo | Review a remote-access plan, apply it, connect, and reach the remote UI. | Terminal + remote UI | Read-only review-to-connect walkthrough. | todo | todo | n/a | n/a |
| [AliceProjects](/docs/deployment/alice-projects) | P1 | demo | Create/select a project and launch the corresponding isolated home. | Terminal + project UI | Create → select → launch walkthrough. | todo | todo | n/a | n/a |
| [Data & Credentials](/docs/deployment/data-and-credentials) | P1 | diagram | Distinguish durable data, sealed credentials, replaceable runtime state, and backup scope. | Filesystem + credential model | Data-root and recovery-boundary diagram. | todo | todo | n/a | n/a |

## Core Features

| Page | Pri | Class | Intended claim or workflow | Source surface | Planned or existing asset | Capture | Integrate | Desktop | 390px |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [Trading as Collaboration](/docs/core-concepts/trading-as-collaboration) | P1 | diagram | Explain how durable work moves through Workspace, Issue, Session, Inbox, and Tracked. | Product data model | Lifecycle diagram sharing the same object identifiers as the product example. | todo | todo | n/a | n/a |
| [Workspaces](/docs/workspaces/workspaces) | P1 | demo | Distinguish a new conversation from a new durable Workspace. | Ask Alice + Workspace templates | Two-path product walkthrough; existing template screenshot is supporting evidence. | partial | partial | todo | todo |
| [AutoQuant](/docs/workspaces/autoquant) | P3 | demo | Open the Workspace-owned Studio and inspect validation gates and the next experiment. | Quant + AutoQuant Studio | Existing real Studio walkthrough. | done | done | todo | todo |
| [Auto Prediction](/docs/workspaces/auto-prediction) | P3 | demo | Open the research-only Studio and inspect market discovery and evidence preflight. | Prediction + Auto Prediction Studio | Existing real Studio walkthrough. | done | done | todo | todo |
| [Workspace Manager](/docs/workspaces/manager) | P0 | demo | Ask Manager for a read-only cross-workspace audit and receive durable results. | Ask Alice / Workspace Manager | Select Manager → send audit → inspect returned desk or Issue results. | todo | todo | n/a | n/a |
| [Sessions & Collaboration](/docs/workspaces/sessions-and-collaboration) | P0 | demo | Resume the same coding-agent coworker with its identity and AI binding intact. | Ask Alice session roster + Session settings | Open existing Session → inspect binding → pause/resume exact Session. | todo | todo | n/a | n/a |
| [Office · Beta](/docs/workspaces/office) | P2 | demo | Enable Office, enter a coworker or cabinet, and replay occupancy. | Office | Short spatial interaction walkthrough. | todo | todo | n/a | n/a |
| [Issue Board](/docs/workspaces/issues) | P1 | demo | Create or schedule an Issue, inspect run history, and open its Inbox result. | Issues + Inbox | Real scheduled Issue lifecycle; current board screenshot remains supporting evidence. | partial | partial | todo | todo |
| [Entities & Tracking](/docs/workspaces/entities) | P3 | demo | Move from one tracked item to the relationship graph and linked notes. | Tracked | Existing real relationship-graph walkthrough. | done | done | todo | todo |
| [Inbox](/docs/workspaces/inbox) | P1 | demo | Open a report, reply to its sender, and continue the exact Session. | Inbox + Session | Report-to-reply walkthrough; current Inbox screenshot remains supporting evidence. | partial | partial | todo | todo |

## Analysis

| Page | Pri | Class | Intended claim or workflow | Source surface | Planned or existing asset | Capture | Integrate | Desktop | 390px |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [Data Hub](/docs/market-data/data-hub) | P2 | screenshot | Read provider, origin, as-of, and staleness beside a market result. | Market / Data Hub | Annotated version of the existing Market screenshot plus resolution-chain diagram. | partial | partial | todo | todo |
| [FX Workbench](/docs/market-data/fx-workbench) | P1 | screenshot | Recognize pair view, rate inputs, forwards, and caveats. | FX Workbench | One high-resolution annotated product state. | todo | todo | n/a | n/a |
| [Symbol Search](/docs/market-data/symbol-search) | P1 | demo | Search a symbol, compare provenance, and select the right contract or bar id. | Symbol Search | AAPL/BTC search-to-selection walkthrough. | todo | todo | n/a | n/a |
| [Equity Research](/docs/market-data/equity-research) | P1 | demo | Move from symbol to profile, financials, ratios, and an agent-usable result. | Equity Research + Agent output | Read-only research walkthrough. | todo | todo | n/a | n/a |
| [Quant Calculator](/docs/market-data/technical-analysis) | P1 | demo | Turn bars and an expression into a visible series or panel result. | Quant Calculator | Search bars → expression → result walkthrough. | todo | todo | n/a | n/a |
| [Retrospective / Time Machine](/docs/market-data/retrospective) | P1 | demo | Preserve one historical as-of boundary through snapshot, simulation, and dated news. | Retrospective | As-of walkthrough plus compact timeline annotation. | todo | todo | n/a | n/a |
| [Sector Rotation](/docs/market-data/sector-rotation) | P3 | demo | Inspect source-aware sector breadth, leadership, and as-of context. | Market / Sector Rotation | Existing real market walkthrough. | done | done | todo | todo |
| [News & RSS](/docs/market-data/news-and-rss) | P2 | screenshot | Recognize the local archive, source filters, and freshness context. | News | Existing screenshot; optional filter-to-article recut later. | done | done | todo | todo |

## Workspace Reference

| Page | Pri | Class | Intended claim or workflow | Source surface | Planned or existing asset | Capture | Integrate | Desktop | 390px |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [Structure](/docs/workspaces/structure) | P2 | diagram | Explain launcher, Workspace, Session, terminal, WebPi, and headless-run hierarchy. | Runtime architecture | Layered ownership and process diagram. | todo | todo | n/a | n/a |
| [Lifecycle & Offboarding](/docs/workspaces/lifecycle) | P1 | demo | Depart to an archived state and restore safely; show purge confirmation without executing it. | Workspace settings / lifecycle | Depart → archive → restore walkthrough plus purge confirmation screenshot. | todo | todo | n/a | n/a |
| [Workspace Upgrades & Absorb](/docs/workspaces/upgrades-and-absorb) | P1 | demo | Preview a template diff before applying it and understand absorb boundaries. | Workspace upgrade UI / CLI | Preview → apply walkthrough plus absorb boundary diagram. | todo | todo | n/a | n/a |
| [CLI Injection](/docs/workspaces/cli-injection) | P2 | diagram | Show how identity, binaries, and skills enter an agent Session. | Terminal + runtime architecture | Injection-chain diagram with focused terminal proof. | todo | todo | n/a | n/a |
| [Settings Injection](/docs/workspaces/settings-injection) | P2 | diagram | Explain template settings, Workspace override, and Session binding precedence. | Settings + files | Precedence diagram and before/after settings screenshots. | todo | todo | n/a | n/a |
| [Self-Describing Issues](/docs/workspaces/self-describing-issues) | P2 | diagram | Follow one Markdown Issue through Board, scheduler, and Session. | Filesystem + Issues | Object-lifecycle diagram using one stable Issue name. | todo | todo | n/a | n/a |
| [Automation](/docs/workspaces/automation) | P3 | demo | Follow a scheduled Issue through run history to its Inbox report. | Issues + Inbox | Existing real scheduled-work walkthrough. | done | done | todo | todo |
| [Webhook](/docs/workspaces/webhook) | P1 | demo | POST work, receive a task id, await it, and identify the resulting output. | Terminal + Inbox or result | Request → 202 → poll/await → result walkthrough. | todo | todo | n/a | n/a |
| [Templates](/docs/workspaces/templates) | P2 | screenshot | Connect a template directory to the resulting Workspace. | Template catalog + files | Existing catalog screenshot plus planned before/after annotation. | partial | partial | todo | todo |

## Unified Trading Account

| Page | Pri | Class | Intended claim or workflow | Source surface | Planned or existing asset | Capture | Integrate | Desktop | 390px |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [What is UTA](/docs/core-concepts/unified-trading-account) | P3 | demo | Inspect one connected account boundary from equity and cash to positions and history. | Trading / account detail | Existing real account walkthrough. | done | done | todo | todo |
| [Trading Setup](/docs/trading/accounts-and-brokers) | P0 | demo | Add a Mock or demo account, test it, save it, and recognize healthy state. | Trading settings wizard | No-credential setup walkthrough; current entry screenshot remains supporting evidence. | partial | partial | todo | todo |
| [Broker Packs](/docs/trading/broker-packs) | P1 | demo | Install a Pack and distinguish progress, ready, degraded, and repair states. | Trading settings / Pack manager | Install-to-ready walkthrough plus degraded screenshot. | todo | todo | n/a | n/a |
| [Trading as Git](/docs/core-concepts/trading-as-git) | P3 | demo | Inspect a proposed operation diff and stop at the second human confirmation. | Trading as Git | Existing safe demo-account approval walkthrough. | done | done | todo | todo |
| [Orders & Execution](/docs/trading/orders-and-execution) | P0 | demo | Stage, commit, approve, push only to Mock/demo, then sync and inspect history. | Trading as Git + account history | End-to-end non-live execution walkthrough. | partial | partial | todo | todo |
| [Snapshots & Equity](/docs/trading/snapshots-and-equity) | P2 | demo | Switch account or period and recognize aggregate equity and snapshots. | Portfolio | Short walkthrough; existing portfolio screenshot is supporting evidence. | partial | partial | todo | todo |
| [Guards & Risk](/docs/trading/guards-and-risk) | P0 | demo | Configure a whitelist or size guard and see a staged operation rejected with a reason. | Trading settings + Trading as Git | Guard configuration → rejection walkthrough using Mock/demo state. | todo | todo | n/a | n/a |

## Configuration and integration

| Page | Pri | Class | Intended claim or workflow | Source surface | Planned or existing asset | Capture | Integrate | Desktop | 390px |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [AI Providers](/docs/integration/ai-providers) | P0 | demo | Add or test a credential, choose runtime/model access, and launch a successful Session. | Settings + Ask Alice | Credential-to-Session walkthrough; current settings screenshot remains supporting evidence. | partial | partial | todo | todo |
| [External Connectors](/docs/integration/external-connectors) | P1 | demo | Receive a channel message, bind it to Session/Inbox work, and return the result. | Telegram or Discord + OpenAlice | Redacted channel-to-result walkthrough plus privacy data-flow diagram. | todo | todo | n/a | n/a |
| [MCP Server](/docs/connectors/mcp-integration) | P1 | demo | Enable MCP, discover OpenAlice tools, call one, and verify its result. | MCP client + OpenAlice | Discovery-to-read-only-call walkthrough plus data-flow diagram. | todo | todo | n/a | n/a |
| [File-based State](/docs/core-concepts/file-based-state) | P1 | diagram | Show which files change when durable Issue work runs and where provenance stays. | Filesystem + product result | Before/after file tree with provenance callouts. | todo | todo | n/a | n/a |
| [Configuration Reference](/docs/configuration/configuration-reference) | P2 | diagram | Explain configuration ownership and load precedence, then map a UI field to JSON. | Settings + config files | Precedence diagram plus focused UI/JSON pair. | todo | todo | n/a | n/a |

## Extending OpenAlice

| Page | Pri | Class | Intended claim or workflow | Source surface | Planned or existing asset | Capture | Integrate | Desktop | 390px |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [Custom Brokers](/docs/extending/custom-brokers) | P2 | diagram | Explain Core, Pack, and preset boundaries and recognize passing adapter tests. | Extension architecture + terminal | Architecture diagram plus pass/fail test output. | todo | todo | n/a | n/a |
| [Custom Guards](/docs/extending/custom-guards) | P1 | screenshot | Connect one Guard configuration to a real rejected operation and reason. | Code/config + Trading as Git | Annotated configuration/result pair. | todo | todo | n/a | n/a |
| [Custom Tools](/docs/extending/custom-tools) | P2 | demo | Register a custom tool, let an agent discover it, and inspect the returned result. | Code + coding-agent Session | Bridge-pattern diagram plus terminal/product walkthrough. | todo | todo | n/a | n/a |

## Next capture queue

The next three recordings should maximize understanding of the coding-agent
operating model before adding more decorative coverage:

1. **Sessions & Collaboration** — resume the same coworker and make identity,
   runtime, model/access binding, and continuity visible.
2. **Workspace Manager** — run the page's existing read-only audit prompt and
   show its real cross-workspace result.
3. **Orders & Execution** — reuse the current approval evidence, then complete
   the success state only against Mock simulator or a demo account.

Trading Setup follows immediately after these because its Mock-simulator path
is high value and does not require credentials.

## Required passes

- [x] Content pass: all 52 pages are present and classified.
- [ ] Hands-on pass: each user-facing category has been exercised against the
  current product source recorded in the baseline.
- [ ] Capture pass: every planned asset has truthful provenance and a poster
  where applicable.
- [ ] Integration pass: all sections, including Configuration, Connectors, and
  Extending, have been revisited after embedding assets.
- [ ] Desktop render pass: every changed route has been inspected in the real
  docs site.
- [ ] 390px render pass: every changed route has been inspected without page
  overflow and with poster-only mobile behavior for demos.
- [ ] Final coverage pass: counts have been regenerated and every remaining
  text-only page has an explicit status.
