# Workspace Manager

This guide owns the launcher-level Agent that audits and coordinates active
Workspaces. It is a control plane, not another business Workspace. Lifecycle,
provenance, and template semantics remain with their owning guides.

## Identity and cwd

The reserved product id is `workspace-manager`. Its cwd is the active floor at
`<launcherRoot>/workspaces/`, whose direct children are exactly active desks.
It is deliberately absent from `workspaces.json` and `WorkspaceRegistry`.

This layout is load-bearing:

- registry membership would make inventory self-referential;
- a dedicated child directory would hide peers from ordinary file tools;
- launcher root would mix active desks with state, departed desks, and config.

Manager Sessions use ordinary durable Session/resume registries under the
reserved id, so restart can reopen the exact native conversation. Secret-free AI
bindings live at `<launcherRoot>/state/workspace-manager-sessions/<resumeId>.json`.
They must not create `.alice/` at the active-floor root.

## Runtime and role contract

Manager launch uses the shared registered-Agent inventory, readiness,
credential, model, and effort controls as Quick Chat. The reserved Workspace
resolves config/readiness without becoming a business desk. Existing Manager
configuration wins over global defaults; native-managed runtimes report native
ownership rather than invented values.

Every runtime receives the same launcher-owned role contract. Web runtimes
append it as a system prompt and load `default/skills/workspace-manager` on every
start/resume. Native TUIs receive it in the fresh interactive seed and retain it
in the native transcript across resume.

The contract requires the Manager to:

- inspect and coordinate the active floor;
- use the embedded `alice` CLI instead of raw localhost APIs;
- ask attributable existing Sessions before reconstructing intent;
- preview lifecycle/template mutations before applying;
- never write research, reports, Issues, or other business artifacts at floor
  root;
- choose a target Workspace for durable work and commit approved direct edits
  inside that target.

Entering the dedicated Manager surface is the user's visible approval for its
control-plane cwd and bundled Skill. Native login, provider injection, install,
and trust behavior remain runtime-owned.

## Inventory and follow-up

Start with product indexes rather than crawling every checkout:

```bash
alice peer list
alice issue list --mode detailed
```

`peer list` exposes active Workspace ids/tags/templates, Session and live-work
counts, and bounded recent attributable Session titles/resumeIds. Departed desks
do not appear. Drill down only after selecting a target with `peer path`,
`peer sessions`, and `conversation ask`.

`--resume-id` continues an exact coworker and reports `resolution.mode: exact`.
`--ws-id` recruits a fresh worker; it does not recover absent historical memory.
Reconstruction guidance is explicit and must not make a fresh worker appear to
be the original author. Provenance selection remains owned by
[[docs/conversation-provenance.md]].

The Manager may read all peers. Existing protections still apply:
cross-Workspace mutations require an interactive Manager Session, and template
apply remains preview-first with its own activity/conflict gates.

## UI boundary

The Chat sidebar reuses ordinary Session controls under a distinct Manager
entry. The Manager page owns management quick start; paused Sessions never
auto-start. Web reopen requires adapter capability and carries the same role,
Skill, and cwd options. Shared `useAgentLaunchConfig` and `AgentLaunchControls`
own selection; do not fork them. Native terminal quirks stay in their adapter.

## Load-bearing paths

- `src/workspaces/manager-workspace.ts` — reserved identity and role contract.
- `src/workspaces/service.ts` — special runtime resolution and durable Sessions.
- `src/workspaces/adapters/` — native/Web role, Skill, and trust projection.
- `src/tool/workspace-list.ts` — active-floor inventory.
- `src/server/cli.ts` and `src/server/cli-commands.ts` — embedded CLI exposure.
- `src/webui/routes/workspaces.ts` — Manager status, launch, resume, diagnostics.
- `ui/src/hooks/useAgentLaunchConfig.ts` and
  `ui/src/components/workspace/AgentLaunchControls.tsx` — shared launch policy.
- `ui/src/pages/WorkspaceManagerPage.tsx` and
  `ui/src/components/workspace/ChatWorkspaceSection.tsx` — Manager surfaces.

## Verification gates

Run owning typechecks and focused inventory, AI config, and route specs. On the
real `/chat/manager` surface, cover changed launch/inventory/follow-up behavior,
preview-only upgrade, no floor-root artifacts, and paused/resumed identity for
each changed runtime/surface; one fake transport does not certify all runtimes.
