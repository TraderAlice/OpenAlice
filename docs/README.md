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
| [[docs/workspace-issues-and-scheduling.md]] | [Workspace issues and scheduling](workspace-issues-and-scheduling.md) | Markdown issue contract, global board, schedule scanner, headless execution, Inbox delivery |
| [[docs/event-system.md]] | [Event-system retirement note](event-system.md) | Removed Alice event-bus scheduler and the remaining UTA journal boundary |
| [[docs/uta-live-testing.md]] | [UTA live testing](uta-live-testing.md) | Real broker/demo acceptance scenarios and trading invariants |
| [[docs/market-data-architecture.md]] | [Market data architecture](market-data-architecture.md) | TraderHub/reference data, BarService K-lines, and the private provider compatibility layer |
| [[docs/mcp-ask-connector.md]] | [MCP Ask retirement note](mcp-ask-connector.md) | Historical redirect for the removed connector/chat architecture |

Other files under `docs/images/` are README/product assets rather than owner
guides.

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
