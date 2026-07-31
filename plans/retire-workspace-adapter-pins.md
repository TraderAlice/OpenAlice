# Retire Workspace Adapter Pins

Status: Completed

Related owner guides: [[docs/project-structure.md]], [[docs/workspace-lifecycle.md]]

## Scope

Retire the legacy `agents` array from active Workspace registry rows and
Workspace lifecycle catalog rows. Adapter availability is installation-wide:
every registered adapter is eligible in every active Workspace, while installed
runtime and credential readiness remain explicit launch-time checks.

This change does not add the future user preference for a default enabled
adapter set. That preference belongs in installation-level preferences rather
than Workspace identity.

## Decisions

- `WorkspaceMeta` and public Workspace payloads no longer contain an adapter
  allowlist.
- Explicit runtime requests validate against the live adapter registry, not
  historical Workspace metadata.
- Default runtime resolution uses installation preferences first and the live
  registered runtime order as fallback.
- Template `defaultAgents` remains a transient ordering hint during Workspace
  creation; it is not persisted into the Workspace.
- Legacy create payloads may still include `agents`, but the field has no
  pinning effect and is not persisted.
- Migration `0030` removes `agents` from both `workspaces.json` and
  `state/workspace-catalog.json` idempotently.
- Historical migration `0021` now derives its launcher root from the migration
  context, so isolated startup tests and alternate homes cannot rewrite the
  default `~/.openalice` catalog.

## Work

- [x] Remove `agents` from Workspace registry and catalog models.
- [x] Remove Workspace allowlist checks from spawn, Issue, conversation, and
      credential-readiness paths.
- [x] Make Chat, Quant, Workspace, and Issue selectors use the global adapter
      inventory.
- [x] Remove adapter arrays from Workspace API, CLI/MCP peer inventory, and demo
      contracts.
- [x] Add migration `0030_retire_workspace_agent_pins`, its tests, registry
      entry, and generated index row.
- [x] Update owner guides and agent-facing Workspace inventory guidance.
- [x] Verify the real Chat and Quant routes against durable legacy Workspaces.

## Verification

- `npx tsc --noEmit`
- `cd ui && npx tsc -b`
- `pnpm test`
- targeted migration, Workspace creator/registry/catalog, Quick Chat, Issue,
  conversation, and UI selector specs
- `pnpm build:migration-index`
- real `/chat` and `/auto-quant` browser checks using the main development
  instance

## Completion

The plan is complete when no production path reads a Workspace-level adapter
allowlist, persisted legacy fields are removed by migration, all registered
agent runtimes appear in Chat and Quant regardless of Workspace age, and the
change is merged into `dev`.

All implementation and verification criteria passed on 2026-07-31. The main
development data set was migrated with backups, and the real Chat and Quant
selectors both exposed Claude Code, Codex, opencode, and Pi from the
installation inventory.
