# MCP Ask Connector (Retired)

The MCP Ask connector described by older versions of this document no longer
exists. It depended on the retired in-process AgentCenter, ConnectorCenter,
Telegram/Web chat connectors, and `askWithSession` model loop.

Do not recreate its configuration, ports, session files, or plugin tree. The
current architecture is documented in:

- [[docs/project-structure.md]] — [Project structure](project-structure.md)
- [[docs/managed-workspace-runtime.md]] — [Managed Workspace runtime](managed-workspace-runtime.md)

Current integrations use different boundaries:

- humans and agents work inside durable Workspaces running native coding-agent
  CLIs;
- OpenAlice capabilities reach those agents through injected `alice*` and
  `traderhub` CLIs plus shared skills;
- attended and scheduled work report through Inbox;
- external tool consumers use the main MCP/tool export, not an Alice chat
  persona exposed as a connector.

The tombstone remains so historical links fail safely instead of teaching a
deleted architecture. Git history preserves the former design if archaeology
is required.
