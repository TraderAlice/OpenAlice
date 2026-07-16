# Workspace Manager

This guide owns the launcher-level Agent that audits and coordinates every
active Workspace. It covers identity, cwd, Agent runtime startup, CLI inventory, UI
entry points, and the boundary that prevents the manager from becoming another
business desk.

Related guides: [[docs/workspace-lifecycle.md]],
[[docs/conversation-provenance.md]],
[[docs/workspace-agent-guidance.md]], and
[[docs/workspace-template-upgrade.md]].

## Product Shape

The Workspace Manager is the user's chief of staff. It can answer questions
such as:

- What does each active desk own, and where is work duplicated?
- Which Issue schedules are stale, failed, or missing an attributable owner?
- Which existing Session should explain an Inbox entry or historical decision?
- Which Workspace should receive a new task, direct edit, or template upgrade?

It is not a normal Chat Workspace. The UI gives it a distinct entry and a
management-specific quick start. Its runtime picker consumes the same registered
Agent list, saved default, install state, readiness, credential, model, and
context contract as Quick Chat. `useAgentLaunchConfig` owns that resolution and
the shared `AgentLaunchControls` components render it on both surfaces. Pi uses
WebPi; Claude, Codex, and OpenCode retain their native TUI surfaces.

For OpenCode and Pi, the summary describes the exact credential, model, and
context that the next launch will inject. An existing Manager config wins over
the global default and remembered choice. A usable hand-edited config (or one
whose original vault credential was later deleted) still reports its on-disk
model and context. Claude and Codex own their provider
state, so the UI says that model/context are CLI-managed instead of inventing a
value. The Manager's reserved Workspace resolves through
`resolveRuntimeWorkspace` for config/readiness reads and writes; it must not be
added to the business Workspace registry just to support this UI.

## Identity and Cwd

The manager has the reserved product id `workspace-manager`. Its cwd is the
active floor at `<launcherRoot>/workspaces/`, whose direct children are exactly
the Workspaces currently in service. It is deliberately absent from
`workspaces.json` and the ordinary `WorkspaceRegistry`.

The distinction is load-bearing:

- adding it to the registry would make inventory self-referential;
- creating a dedicated child directory would hide the peer desks from ordinary
  filesystem tools;
- using the launcher root would mix active desks with state, departed desks,
  configuration, and unrelated runtime files.

Manager Session and resume identities still use the ordinary durable registries
under the reserved id. A launcher restart can therefore reopen the exact native
conversation without inventing a new business Workspace.

## Runtime Contract

Every Manager runtime receives the same launcher-owned role contract. Pi appends
it as a system prompt and loads `default/skills/workspace-manager` on every WebPi
start, including resume after restart. Native TUIs receive the contract in the
fresh interactive seed because those CLIs do not share one portable system-
prompt flag; their durable native transcript carries it across later resumes.
The contract says:

- inspect and coordinate the active floor;
- use the embedded `alice-workspace` CLI instead of raw localhost APIs;
- ask attributable existing Sessions before reconstructing intent;
- preview lifecycle/template mutations before applying them;
- never write reports, research, Issues, or other business artifacts at the
  floor root;
- choose a target Workspace for durable work, and commit any approved direct
  edit inside that target.

WebPi explicitly approves this launcher-owned cwd. There is no TUI trust prompt
to render, and entering the dedicated manager surface is the user's visible
approval for the bundled skill and control-plane directory. Native runtimes keep
their existing login, provider-injection, install, and trust behavior.

## CLI Surface

Start a floor audit from product indexes:

```bash
alice-workspace peer list
alice-workspace issue list --mode detailed
```

`peer list` returns active Workspace ids, tags, templates, configured runtimes,
Session totals, live interactive counts, live headless counts, and a bounded
set of recent attributable Session titles and resume identities. Those titles
are the first-pass responsibility map; the manager must not replace the index
with a batch crawl of every desk. Departed desks intentionally do not appear.
Drill into one selected desk with:

```bash
alice-workspace peer path --id <workspaceId>
alice-workspace peer sessions --id <workspaceId>
alice-workspace conversation ask --resume-id <resumeId> --prompt "..." --await
# Fallback only when no attributable Session exists:
alice-workspace conversation ask --ws-id <workspaceId> --prompt "..." --await
alice-workspace template upgrade --id <workspaceId>
```

`--resume-id` continues the exact coworker and should report
`resolution.mode: exact`. `--ws-id` recruits or reconstructs a worker whose
answer may be useful but does not carry the historical owner's memory; the UI
and manager must preserve that distinction instead of presenting the fallback
as the original author.

The manager may read all peers. Existing command-level protections still apply:
cross-Workspace mutations require an interactive manager Session, and template
apply remains preview-first.

## Load-Bearing Code

- `src/workspaces/manager-workspace.ts` — reserved identity and system contract.
- `src/workspaces/service.ts` — special runtime resolution and durable Sessions.
- `src/workspaces/adapters/pi.ts` — explicit WebPi prompt/skill/trust flags.
- `src/tool/workspace-list.ts` — active floor inventory.
- `src/server/cli.ts` and `src/server/cli-commands.ts` — embedded CLI exposure.
- `src/webui/routes/workspaces.ts` — manager status, quick start, and resume.
- `ui/src/lib/agentRuntime.ts` — shared runtime-selection policy.
- `ui/src/hooks/useAgentLaunchConfig.ts` — shared readiness, credential,
  model, context, and launch-parameter resolution.
- `ui/src/components/workspace/AgentLaunchControls.tsx` — shared selectors and
  truthful launch summary.
- `ui/src/pages/WorkspaceManagerPage.tsx` — manager composer and WebPi/TUI shell.
- `ui/src/components/workspace/ChatWorkspaceSection.tsx` — Chat sidebar entry.

## Verification

At minimum:

```bash
npx tsc --noEmit
cd ui && npx tsc -b
pnpm vitest run src/tool/workspace-list.spec.ts \
  src/workspaces/adapters/ai-config.spec.ts \
  src/webui/routes/workspaces.spec.ts
```

Then use the real `/chat/manager` route with at least two available runtimes:

1. verify the runtime/provider picker agrees with Quick Chat and preserves the
   saved default;
2. on Pi or OpenCode, verify the visible model/context matches the Manager
   Workspace config, switch provider, and confirm the launch uses the new one;
3. start one Pi/WebPi and one native-TUI Manager Session, then reopen both;
4. inventory the active floor and confirm real `peer list` tool use;
5. compare a harmless `--ws-id` reconstruction with an exact `--resume-id`
   continuation and verify their resolution modes remain visible;
6. preview a peer template upgrade without `--apply`;
7. confirm no business artifact appeared at the floor root;
8. reload the manager conversation and confirm the same resume identity opens.
