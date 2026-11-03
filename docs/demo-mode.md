# Demo mode

Use demo mode to inspect populated frontend states without configuring a
provider, broker, or coding agent. Browser and Electron share
`ui/src/demo/handlers/` and `ui/src/demo/fixtures/`.

## Native Electron

```bash
pnpm electron:demo            # from the repository root, after pnpm install
pnpm electron:demo --skip-build   # reopen the previous build
```

Builds the desktop shell plus a separate mock UI and opens Inbox in a
native window without the browser demo banner. Every launch starts fresh;
close the window to stop the fixture child; the printed `openalice-demo-*`
temp directory retains diagnostics.

What it validates: the same window factory, native chrome, preload, and
file IPC as the normal desktop. Requests traverse `app://` → Electron main
→ child IPC; the child resolves shared MSW handlers directly (no Service
Worker or localhost backend); Workspace files are seeded into the temporary
home so native file reads are real. It is development-only: no production
Guardian/Alice/UTA/Connector/agent CLIs; Electron profile, Workspace root,
and global state are isolated; no provider credentials reach the fixture
child; data-home switching and updates are disabled; unmocked APIs return
501; analytics are off. Suggested prompts stream predefined text through the
normal snapshot polling contract; market examples open the K-line panel with
recorded Alpaca-paper bars; the AutoQuant example opens its real Studio
frontend backed by an isolated synthetic snapshot
(`ui/public/demo-studio/PROVENANCE.md`; read-only, no managed process).
This checks rendering and desktop integration — not live agent execution,
broker behavior, or packaging (use the normal Electron acceptance lanes).

## Browser and checks

```bash
pnpm -F open-alice-ui dev:demo
pnpm electron:smoke:demo
```

The browser uses MSW's Service Worker; the native smoke checks app protocol,
preload, renderer isolation, Service Worker absence, Inbox-to-conversation
links, report/file-read agreement, path containment, unknown-route failure,
and React mounting. Native mock assets live in `ui/dist-demo/` and
`dist/demo/` (separate from `ui/dist/`). Add reusable scenarios to the
shared fixtures, preserving cross-links between Workspace, Session, Inbox,
Issue, run, and file identifiers; session names/agents/runtime settings
belong to the shared Workspace Session fixtures (no Issue-specific Session
copies or hardcoded resume responses).

## Scenario walkthroughs

- **Chat**: suggestions fill the composer so the visitor can read the
  request; prewritten answers live in
  `ui/src/demo/fixtures/chat-workflows.ts` (Chinese starters get Chinese
  replies; others English). Ordinary user/assistant messages, no fabricated
  tool events; illustrative analysis is distinguished from actual
  reads/saved files/jobs; unrecognized prompts keep the simulated
  conversation/permission flow.
- **Workspace preparation recovery** (browser): `?workspaceSetup=failed`,
  `preparing`, or `read-error` exercise the avatar blue dot → Settings
  Overview → Auto Quant preparation path; Retry simulates recovery without
  real files.
- **Machine settings**: `/settings/machines` with
  `?machineScenario=probe-error|blocked|apply-error`. Add Machine uses a
  read-only probe then explicit approval; probe/apply errors fail once then
  allow a fresh review; blocked plans never approve; all SSH/remote state
  is simulated through MSW.
- **Update overview**: `/settings?updates=ready` exercises the three-object
  overview and one-step Alice Project review/apply/completion; only
  in-memory Chat content changes — no real installation or remote Machine
  update.
