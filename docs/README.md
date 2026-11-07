# OpenAlice Documentation Index

`docs/` is the single documentation source of truth for both the OpenAlice
website (`apps/landing`, rendered at `/docs`) and repository engineering
contracts (`AGENTS.md`).

Documentation is partitioned into two zones:

- **`docs/guides/`** — User-facing product guides (installation, Workspaces,
  market analysis, UTA trading setup, configuration).
- **`docs/architecture/`** — Core architecture concepts, Workspace internals,
  subsystem owner guides, extension guides, and engineering workflows.

Navigation order for the website lives in [`docs/SUMMARY.md`](SUMMARY.md).

## Subsystem Owner Guides (`docs/architecture/`)

Use wikilinks as stable agent-facing routes and ordinary Markdown links for
GitHub navigation.

| Wikilink route | Guide | Owns |
|---|---|---|
| [[docs/architecture/project-structure.md]] | [Project structure](architecture/project-structure.md) | Process boundaries, source ownership, state roots, architectural entry points |
| [[docs/architecture/alice-project.md]] | [AliceProject and local runtime](architecture/alice-project.md) | Top-level runtime identity, complete-home data locations, concurrency, and source-backed/native local bootstrap |
| [[docs/architecture/development-workflow.md]] | [Development workflow](architecture/development-workflow.md) | Branches, delivery modes, PRs, promotions, external review, risk gates |
| [[docs/architecture/testing.md]] | [Testing](architecture/testing.md) | Unit/integration/E2E scope and suite registration, required gates/run receipts, ownership, execution conditions, and selectors |
| [[docs/architecture/workspace-lifecycle.md]] | [Workspace and Session lifecycle](architecture/workspace-lifecycle.md) | Workspace Manager, unified Session execution, provenance (`resumeId`), Web conversation surface, template upgrade, absorb, and offboarding |
| [[docs/architecture/alice-harness.md]] | [Alice Harness and runtime injection](architecture/alice-harness.md) | Project CLI runtime, AI credential/model semantics, Workspace agent guidance, Skill/sticker distribution, and Harness web surfaces |
| [[docs/architecture/workspace-issues-and-scheduling.md]] | [Workspace issues, scheduling, and Inbox](architecture/workspace-issues-and-scheduling.md) | Markdown issue contract, schedule scanner, headless execution, Inbox content publication, and Product Activity Journal |
| [[docs/architecture/cli-supervisor.md]] | [Shell CLI Supervisor](architecture/cli-supervisor.md) | Top-level Runtime lifecycle, status/JSON presentation, browser opening, completion, compatibility aliases, and TUI boundary |
| [[docs/architecture/remote-access.md]] | [Remote Runtime and access](architecture/remote-access.md) | Server lifecycle, SSH transport, managed remote bootstrap, client authority, AliceProject transfer, and staged Studio protocol |
| [[docs/architecture/cli-installer.md]] | [CLI installer, channels, and updates](architecture/cli-installer.md) | Bootstrap consent, installed layout, package-manager channels, update lifecycle coordination, and Windows code signing |
| [[docs/architecture/managed-workspace-runtime.md]] | [Desktop packaging and managed runtime](architecture/managed-workspace-runtime.md) | Electron packaging, managed Pi/Git/Bash runtime, Desktop companion floating window, and isolated demo mode |
| [[docs/architecture/uta-live-testing.md]] | [UTA, Broker Packs, and IBKR](architecture/uta-live-testing.md) | Broker/trading invariants, optional Broker Packs, IBKR wire-protocol framing/decoder contract, and live acceptance scenarios |
| [[docs/architecture/market-data-architecture.md]] | [Market data architecture](architecture/market-data-architecture.md) | TraderHub/reference data, BarService K-lines, RSS archive, and the private provider compatibility layer |
| [[docs/architecture/connector-service.md]] | [Connector Service](architecture/connector-service.md) | Optional external Inbox projection, phone-desk chat, adapters, secrets, health, and Guardian lifecycle |
| [[docs/architecture/ui-interaction-and-motion.md]] | [UI interaction and motion](architecture/ui-interaction-and-motion.md) | Clickable affordances, shared motion tokens, entrances/disclosures, and reduced-motion policy |

Public website (`apps/landing/`) ownership and contributor rules live next to the
code at [[apps/landing/AGENTS.md]] ([`apps/landing/AGENTS.md`](../apps/landing/AGENTS.md)).
Other files under `docs/images/` are README/product assets.

Generated migration inventory: [[src/migrations/INDEX.md]]
([Migration index](../src/migrations/INDEX.md)).

## Maintenance Rule

- **`docs/guides/`** holds user-facing product guides and workflows. Keep them
  concise, task-oriented, and free of internal implementation jargon.
- **`docs/architecture/`** holds subsystem boundaries, cross-process contracts,
  non-obvious state and security invariants, and load-bearing entry paths.
  Do not append PR changelogs, restate TypeScript types in prose, list per-flag
  CLI manuals, or record one-off CI/release run links.
