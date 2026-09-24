# Update lifecycle

Status: active. Owner guides: [[docs/alice-project.md]],
[[docs/harness-web-surfaces.md]], [[docs/workspace-template-upgrade.md]],
[[docs/local-runtime.md]], and [[docs/ui-interaction-and-motion.md]].

## Product decision

Opening the app activates preparation of its default Chat, Auto Quant, and
Auto Prediction Workspaces. New projects select all three. Preparation begins
after the first rendered frames, and
failures remain visible and retryable. No Agent or Studio is started.

The app checks for updates automatically and shows one small blue indicator by
Alice’s Settings when an actionable update exists. Settings gives the complete
status for this client, the selected backend, and individual Workspaces. A
single frontend lifecycle hook owns discovery state, refresh, and selection;
the existing owner-specific updater performs each action. The hook never
applies a Workspace merge or restarts the Runtime itself.

Auto Quant and Auto Prediction default to automatic source upgrades to their
upstream repositories' newest stable SemVer tags when safe. This explicit
product preference expands automatic updates beyond OpenAlice's verified
catalog; the UI and audit log continue to distinguish unverified upstream
releases.
The existing operation guard, active-runtime check, clean merge, manifest
validation, and transaction recovery remain authoritative. Blocked upgrades
surface a reason and wait for user action.

## Sequence

- [x] Start default Workspace preparation asynchronously after first UI paint;
      make retries durable and keep startup usable.
- [x] Add backend-owned preferences and a bounded, cached scan for app and
      Workspace updates; auto-apply safe AQ/AP updates per trust policy.
- [x] Add a shared frontend update lifecycle hook, Settings status, and a
      responsive, accessible Settings indicator.
- [x] Update owner guides, demo API, and proportional tests; inspect the real
      browser route and packaged startup behavior.

## Acceptance

Fresh and existing projects with no default Workspaces prepare them after
startup without delaying page readiness. Existing selected defaults are
retained. An unavailable source cannot block startup; retry is visible. UI
navigation remains responsive while update checks run. The Settings indicator
appears only for actionable updates, including AQ/AP, and clearing an update
removes it. Automatic AQ/AP apply never bypasses the source-upgrade safety
checks or forces a merge into an active Workspace.
