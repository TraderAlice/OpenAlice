# Demo mode

Use demo mode to inspect populated frontend states without configuring a
provider, broker, or coding agent. Browser and Electron share
`ui/src/demo/handlers/` and `ui/src/demo/fixtures/`.

## Native Electron

After `pnpm install`, run from the repository root:

```bash
pnpm electron:demo
```

This builds the desktop shell and a separate mock UI, then opens Inbox in a
1280 × 800 native window without the public browser demo banner. `pnpm electron:demo --skip-build` reopens the previous
build. After source changes, run the command without `--skip-build`. Close the
window to stop its fixture child. Every launch starts fresh; the printed
`openalice-demo-*` temporary directory retains local diagnostics for inspection.

The featured story is **AI power: from demand to delivery**: Inbox research and
risk checklist, a multi-turn Chat conversation, and the recurring Morning movers
scan under Issues. Existing market, trading and edge-case fixtures remain.
Research figures are illustrative, not live data.

## What this validates

The demo uses the same window factory, native chrome, preload and file IPC as
the normal desktop. Requests traverse `app://` → Electron main → child IPC.
The child resolves shared MSW handlers directly; no Service Worker or localhost
backend substitutes for the native transport. Workspace files are seeded into
the temporary home so native file reads remain real filesystem operations.

The entry is development-only. It does not start the production Guardian,
Alice, UTA, Connector or agent CLIs. Electron profile, Workspace root and global
state are isolated, with no provider credentials passed to the fixture child.
Data-home switching and updates are disabled. Unmocked APIs return 501 rather
than reaching a live backend. UI analytics are disabled in the native demo.

Suggested-prompt replies stream predefined text through the normal Web Session
snapshot polling contract; Stop clears the pending stream. Market examples open
the existing K-line panel with recorded Alpaca-paper bars. Replies render the
bundled Alice wave sticker through the normal Workspace-content renderer.

The AutoQuant example opens its real Studio frontend in the work panel, backed
by an isolated synthetic test snapshot. See `ui/public/demo-studio/PROVENANCE.md`.
This read-only specimen does not launch a managed Studio process; refresh returns
the same snapshot. Auto Prediction Studio and TUI remain placeholders. This mode checks rendering and desktop integration, not live
agent execution, broker behavior, packaging, or recorder cursor compatibility.
For those, use the normal Electron acceptance lanes.

## Browser and checks

```bash
pnpm -F open-alice-ui dev:demo
pnpm electron:smoke:demo
```

The browser uses MSW's Service Worker. The native smoke checks the app protocol,
preload, renderer isolation, absence of a Service Worker, Inbox-to-conversation
links, agreement between report API and native file reads, path containment,
unknown-route failure and React mounting. `--skip-build` is supported after a
successful demo build.

Native mock assets live in `ui/dist-demo/` and `dist/demo/`; normal `ui/dist/`
remains separate. Add reusable scenarios to the shared fixtures and preserve
cross-links between Workspace, Session, Inbox, Issue, run and file identifiers.

Session names, agents and initial runtime settings belong to the shared Workspace
Session fixtures. The resume directory and Issue owner projection derive from
those records; runtime edits use the same in-memory override map. Avoid adding
an Issue-specific copy of a Session or a hardcoded workspace resume response.
Auto Quant includes three assignable research Sessions; the missing CPI owner
remains an intentional recovery scenario.

## Chat entry walkthroughs

Demo Chat defaults to the standard GUI for capable runtimes; normal launches
retain their existing default. Suggested workflows still fill the composer so
the visitor can read the request before sending. Both pages of Chat suggestions
(and the Nano starters) have distinct prewritten answers in
`ui/src/demo/fixtures/chat-workflows.ts`, matched against the shared localized
starter catalog. Chinese starters use Chinese replies; other languages currently
use English example replies. Each answer finishes with the same installation
destination as the demo banner. These examples use ordinary user/assistant
messages, not a separate marketing renderer or fabricated tool events.

Replies distinguish illustrative analysis and proposed work from actual market
reads, saved files, scheduled jobs or backtests. Unrecognized prompts retain the
existing simulated conversation/permission flow. Browser and Electron resolve
the same fixtures through their normal demo transports.
