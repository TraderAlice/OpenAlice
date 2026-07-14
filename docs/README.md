# OpenAlice Owner Guides

This directory holds durable subsystem truth. `AGENTS.md` is the compact
startup index; detailed rules belong here and should be loaded only when the
task touches their scope.

Use wikilinks as stable agent-facing routes and ordinary Markdown links for
GitHub navigation.

| Wikilink route | Guide | Owns |
|---|---|---|
| [[docs/project-structure.md]] | [Project structure](project-structure.md) | Process boundaries, source ownership, state roots, architectural entry points |
| [[docs/development-workflow.md]] | [Development workflow](development-workflow.md) | Branches, delivery modes, PRs, promotions, external review, risk gates |
| [[docs/managed-workspace-runtime.md]] | [Managed Workspace runtime](managed-workspace-runtime.md) | Electron packaging, managed Pi, PortableGit/Bash, runtime profile, Workspace PATH |
| [[docs/cli-installer.md]] | [CLI installer](cli-installer.md) | Bootstrap consent, installed layout, atomic updates, PATH integration, installer tests, and release checks |
| [[docs/local-runtime.md]] | [Local Runtime and CLI bootstrap](local-runtime.md) | Source-backed localhost startup, dependency bootstrap, Runtime ownership, and headless bundle boundary |
| [[docs/docker-deployment.md]] | [Docker deployment](docker-deployment.md) | Server image topology, remote-host safety, persistence, health, and container acceptance |
| [[docs/remote-access.md]] | [Remote access](remote-access.md) | SSH tunnel experiment, local/remote ownership, and staged remote-control boundaries |
| [[docs/connector-service.md]] | [Connector Service](connector-service.md) | Optional Discord/Telegram Inbox projection, adapters, secrets, health, Guardian lifecycle |
| [[docs/ui-interaction-and-motion.md]] | [UI interaction and motion](ui-interaction-and-motion.md) | Clickable affordances, shared motion tokens, entrances/disclosures, reduced-motion policy |
| [[docs/workspace-agent-guidance.md]] | [Workspace agent guidance](workspace-agent-guidance.md) | Always-loaded prompt contract, skill ownership, live CLI authority, guidance versioning |
| [[docs/workspace-lifecycle.md]] | [Workspace and Session lifecycle](workspace-lifecycle.md) | Offboarding, departed directories, handoff, restore/purge, Session retirement |
| [[docs/workspace-template-upgrade.md]] | [Workspace Template Upgrade](workspace-template-upgrade.md) | Managed-asset baselines, three-way review, apply transactions, recovery, and the future Merge/Absorb boundary |
| [[docs/workspace-issues-and-scheduling.md]] | [Workspace issues and scheduling](workspace-issues-and-scheduling.md) | Markdown issue contract, global board, schedule scanner, headless execution, Inbox delivery |
| [[docs/conversation-provenance.md]] | [Workspace Session and artifact provenance](conversation-provenance.md) | `resumeId` identity, artifact trails, Issue execution responsibility, and provenance-before-collaboration sequencing |
| [[docs/event-system.md]] | [Event-system retirement note](event-system.md) | Removed Alice event-bus scheduler and the remaining UTA journal boundary |
| [[docs/uta-live-testing.md]] | [UTA live testing](uta-live-testing.md) | Real broker/demo acceptance scenarios and trading invariants |
| [[docs/market-data-architecture.md]] | [Market data architecture](market-data-architecture.md) | TraderHub/reference data, BarService K-lines, and the private provider compatibility layer |

Other files under `docs/images/` are README/product assets rather than owner
guides.

Reference notes under `docs/reference/` are non-authoritative research
material. The [installer script note](reference/install-script/README.md)
records Claude Code and Codex upstream links and design lessons without
vendoring third-party code.

## Maintenance Rule

- Every owner guide states what it owns and points to the current load-bearing
  code paths.
- When code and a guide disagree, verify the runtime and update the guide in the
  same change.
- Do not copy an owner guide back into `AGENTS.md`; add or update its wikilink.
- Do not leave executable instructions in a retired guide. Keep a short
  tombstone when old external links need a destination.
- Prefer self-describing code/catalogs over copied provider, event, or route
  inventories that immediately drift.
