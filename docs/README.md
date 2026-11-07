# OpenAlice Owner Guides

This directory holds durable subsystem truth. `AGENTS.md` is the compact
startup index; detailed rules belong here and should be loaded only when the
task touches their scope.

Use wikilinks as stable agent-facing routes and ordinary Markdown links for
GitHub navigation.

| Wikilink route | Guide | Owns |
|---|---|---|
| [[docs/project-structure.md]] | [Project structure](project-structure.md) | Process boundaries, source ownership, state roots, architectural entry points |
| [[docs/alice-project.md]] | [AliceProject and local runtime](alice-project.md) | Top-level runtime identity, complete-home data locations, concurrency, and source-backed/native local bootstrap |
| [[docs/development-workflow.md]] | [Development workflow](development-workflow.md) | Branches, delivery modes, PRs, promotions, external review, risk gates |
| [[docs/testing.md]] | [Testing](testing.md) | Unit/integration/E2E scope and suite registration, required gates/run receipts, ownership, execution conditions, and selectors |
| [[docs/workspace-lifecycle.md]] | [Workspace and Session lifecycle](workspace-lifecycle.md) | Workspace Manager, unified Session execution, provenance (`resumeId`), Web conversation surface, template upgrade, absorb, and offboarding |
| [[docs/alice-harness.md]] | [Alice Harness and runtime injection](alice-harness.md) | Project CLI runtime, AI credential/model semantics, Workspace agent guidance, Skill/sticker distribution, and Harness web surfaces |
| [[docs/workspace-issues-and-scheduling.md]] | [Workspace issues, scheduling, and Inbox](workspace-issues-and-scheduling.md) | Markdown issue contract, schedule scanner, headless execution, Inbox content publication, and Product Activity Journal |
| [[docs/cli-supervisor.md]] | [Shell CLI Supervisor](cli-supervisor.md) | Top-level Runtime lifecycle, status/JSON presentation, browser opening, completion, compatibility aliases, and TUI boundary |
| [[docs/remote-access.md]] | [Remote Runtime and access](remote-access.md) | Server lifecycle, SSH transport, managed remote bootstrap, client authority, AliceProject transfer, and staged Studio protocol |
| [[docs/cli-installer.md]] | [CLI installer, channels, and updates](cli-installer.md) | Bootstrap consent, installed layout, package-manager channels, update lifecycle coordination, and Windows code signing |
| [[docs/managed-workspace-runtime.md]] | [Desktop packaging and managed runtime](managed-workspace-runtime.md) | Electron packaging, managed Pi/Git/Bash runtime, Desktop companion floating window, and isolated demo mode |
| [[docs/uta-live-testing.md]] | [UTA, Broker Packs, and IBKR](uta-live-testing.md) | Broker/trading invariants, optional Broker Packs, IBKR wire-protocol framing/decoder contract, and live acceptance scenarios |
| [[docs/market-data-architecture.md]] | [Market data architecture](market-data-architecture.md) | TraderHub/reference data, BarService K-lines, RSS archive, and the private provider compatibility layer |
| [[docs/connector-service.md]] | [Connector Service](connector-service.md) | Optional external Inbox projection, phone-desk chat, adapters, secrets, health, and Guardian lifecycle |
| [[docs/ui-interaction-and-motion.md]] | [UI interaction and motion](ui-interaction-and-motion.md) | Clickable affordances, shared motion tokens, entrances/disclosures, and reduced-motion policy |

Public website (`apps/landing/`) ownership and contributor rules live next to the
code at [[apps/landing/AGENTS.md]] ([`apps/landing/AGENTS.md`](../apps/landing/AGENTS.md)).
Other files under `docs/images/` are README/product assets rather than owner
guides.

Generated migration inventory: [[src/migrations/INDEX.md]]
([Migration index](../src/migrations/INDEX.md)).

## User Quickstarts

- [[docs/remote-quickstart.md]] — [Remote quickstart](remote-quickstart.md):
  install the stable CLI, prepare a private SSH host, connect and reconnect,
  understand Server lifetime and security, and see the design inspiration
  behind the remote path.

## Maintenance Rule

Owner guides hold only subsystem boundaries, cross-process/cross-owner
contracts, non-obvious state and security invariants, and load-bearing entry
paths. Update a guide only when one of those boundaries, contracts, invariants,
or paths actually changes.

Do not append PR changelogs, restate TypeScript types or code branches in prose,
list per-flag CLI manuals, transcribe UI pixel/CSS layouts, or record one-off
CI/release run links in `docs/*.md`. Code and `.spec.ts` files own implementation
detail; Git history and Issues own incident/release logs;
`apps/landing/content/docs/` owns user-facing tutorials.

Keep each contract in one owner guide and link to it rather than copying it.
When current code and a guide disagree, verify runtime behavior and update the
guide in the same change. Do not copy guides back into `AGENTS.md`; maintain
their wikilinks here.
