# Session Activity and Terminal Delivery

Status: Draft proposal — do not merge pending design review

Related reports:

- [TraderAlice discussion #718](https://github.com/orgs/TraderAlice/discussions/718)
- Local OpenCode Quick Chat launch failure reproduced on 2026-08-09

Owner guides:

- [[../docs/managed-workspace-runtime.md]]
- [[../docs/model-semantics-and-runtime-injection.md]]
- [[../docs/conversation-provenance.md]]
- [[../docs/ui-interaction-and-motion.md]]

## Topic

Make a persistent native Agent Session report its real work state and deliver
its terminal output reliably without treating a live TUI process as evidence
that the Agent is still generating.

## Problem

OpenAlice currently projects a live `PersistentSession` PTY as `running`. That
is a process-lifecycle fact: an interactive OpenCode or Pi TUI is intentionally
kept alive after one turn completes. Product surfaces can therefore leave the
Session looking busy forever even when the native Agent has returned to its
prompt. The final `transcript.session.captured` event only records the native
conversation identity and is not a completion signal.

The same boundary owns a second reliability concern. Quick Chat can submit its
first prompt before a browser terminal attaches, so the PTY mirror and replay
path must preserve the visible initial reply and recover it after a WebSocket
disconnect. A successful model request is not sufficient if the user-facing
terminal never receives the response.

A local prerequisite was also reproduced for OpenCode: its interactive TUI is
currently launched with a `--variant` option that only `opencode run` accepts,
so the child exits before activity or output behavior can be exercised.
That immediate startup defect is deliberately isolated in Draft PR #1037 and
is not part of the lifecycle proposal's acceptance decision.

## Open Design Questions

1. Should product Session state remain a two-axis model (`running/paused` PTY
   lifecycle plus transient Agent activity), or should the public contract
   expose one richer state machine?
2. Is a native runtime hook the minimum acceptable source of activity truth,
   or should OpenAlice offer a documented lower-confidence fallback for
   runtimes that expose no events?
3. Should the last activity observation disappear on process restart, as this
   prototype does, or become durable Session metadata with staleness rules?
4. Is a Workspace-local managed OpenCode/Pi hook an acceptable ownership
   boundary, or should adapters integrate through a non-file registration
   surface when the runtime provides one?

## Acceptance Criteria

1. Session lifecycle and Agent activity are separate public concepts. A live
   PTY remains resumable/running while activity can be starting, working,
   waiting, unavailable, failed, or stopped.
2. OpenCode and Pi publish native turn transitions. Completing a turn while the
   TUI stays alive moves the Session to waiting/idle instead of leaving it
   visibly working.
3. A real native turn start is visibly working. Adapters without activity
   support degrade to an explicit unavailable/terminal-ready state and never
   fabricate progress from process liveness or output quietness.
4. Quick Chat's first visible response survives a late terminal attach in
   source dev and Docker-shaped HTTP mode. A WebSocket reconnect replays the
   authoritative current terminal screen plus current activity state.
5. `transcript.session.captured` remains solely a native Session identity event;
   no UI or runtime code interprets it as turn completion.
6. OpenCode interactive launch uses only arguments accepted by its TUI while
   headless `opencode run` retains supported model/variant injection.
7. Tests cover OpenCode and Pi start/settle transitions, live-process idle
   behavior, late attach, reconnect/replay, stale or malformed activity input,
   and the resulting UI presentation.
8. The real Chat route is verified in the browser, and the matching Electron /
   PTY smoke proves the desktop transport still launches and reconnects.

## Design Alternatives

### A. Infer completion from terminal output quietness

Observe PTY writes and mark a Session idle after a debounce window.

- Advantage: no native runtime integration.
- Rejected because TUI redraws, terminal queries, resize/focus events, streaming
  pauses, and long tool calls make silence neither necessary nor sufficient for
  completion. It would create another timing heuristic at the exact boundary
  this topic is meant to make reliable.

### B. Treat process exit as completion or replace the TUI with headless runs

End the child after each prompt, or route Quick Chat through a one-shot API.

- Advantage: lifecycle and work state become superficially identical.
- Rejected because persistent native TUI Sessions are a product contract. This
  changes resume behavior and removes the visible TUI handoff that teaches the
  user how OpenAlice controls a native runtime.

### C. Bridge native Agent activity through the terminal transport

Install OpenAlice-owned, Workspace-local OpenCode/Pi activity hooks. The hooks
emit a versioned private terminal control sequence keyed to `AQ_SESSION_ID`.
The headless terminal mirror consumes it, `PersistentSession` stores the latest
activity, and REST/WebSocket projections deliver lifecycle and activity as
separate facts.

- Advantage: native lifecycle truth, no polling, works before browser attach,
  and preserves the existing PTY/TUI architecture.
- Cost: each adapter must own and test a small native hook, with an explicit
  unavailable fallback when a runtime version cannot provide the events.
- Selected because it is the only option that is both semantically accurate and
  compatible with a long-lived interactive terminal.

## Interaction Model

- Running/paused remains a Session lifecycle control used for opening,
  resuming, and stopping the PTY.
- Activity is a secondary status: starting, working, waiting for the user,
  unavailable, failed, or stopped. It must not reuse the primary lifecycle
  label or make an idle live TUI appear dead.
- On reconnect, the client receives the activity snapshot in the same attach
  handshake as terminal cursor/screen state, before relying on future events.
- Reduced-motion behavior is unchanged; status changes use existing shared
  feedback primitives and do not add continuous animation.
- Runtime-specific event capture belongs to adapters. Framing, validation,
  replay, and public protocol ownership belong to the shared terminal layer.

## Non-goals

- Replacing native TUI Sessions with an in-process Agent loop.
- Making `transcript.session.captured` a generic lifecycle event.
- Promising exact activity for third-party adapters that expose no native
  lifecycle hooks.
- Redesigning the paused/open-TUI transition screen beyond the status facts
  required by this topic.
- General transcript parsing, billing state, or token-progress estimation.

## Work

### 1. Baseline and contract

- [ ] Preserve source-dev, Docker-shaped HTTP, and Electron/PT​​Y reproduction
      evidence for initial output, reconnect, and completed-turn behavior.
- [x] Define the versioned activity phases and private adapter-to-terminal
      framing, including identity validation and unsupported fallback.
- [x] Remove the unsupported OpenCode interactive `--variant` argument while
      preserving its headless projection.

### 2. Native adapter activity

- [x] Add a managed Pi extension that emits start/settled activity only for the
      interactive Session path.
- [ ] Decide whether Pi exposes a trustworthy native failure event or whether
      child-exit failure is the only supported failure boundary.
- [x] Add a reversible Workspace-local OpenCode plugin that emits
      working/idle/error activity without overwriting user-owned plugins.
- [x] Prove managed files are locally excluded, conflict-safe, and carry no
      credential or prompt content.

### 3. Terminal and public protocol

- [x] Parse and validate private activity frames in the shared headless terminal
      layer without exposing control bytes as product content.
- [x] Store the latest activity in `PersistentSession` and include it in attach,
      reconnect, and lifecycle projections.
- [x] Extend REST, WebSocket, Electron IPC, demo, and UI types without changing
      the meaning of `SessionRecord.state`.

### 4. Product behavior

- [x] Present live-process waiting separately from working in the Session row
      and paused/open-TUI surface.
- [x] Keep unknown adapters honest and preserve accessible status semantics.
- [x] Verify late attach and repeated reconnect show the same final response and
      current activity without a reload.

### 5. Verification and delivery

- [x] Add focused adapter, terminal snapshot, PersistentSession, route/protocol,
      and UI regression tests.
- [x] Run root/UI typechecks and the monorepo test suite.
- [ ] Walk the real Chat route in `pnpm dev` and a Docker-shaped HTTP launch.
- [x] Run the relevant Electron/PT​​Y smoke and record platform-only residual
      risk without invoking release signing.
- [x] Open one labeled Draft PR targeting `dev`; keep it unmerged pending topic
      acceptance.

## Verification Evidence

Recorded on 2026-08-09 against the proposal branch:

- `pnpm exec vitest run src/workspaces/persistent-session.spec.ts` — 15 tests
  passed, including a first reply emitted before attach, output emitted while
  disconnected, cold reconnect replay, current activity replay, and identity /
  activity separation.
- `npx tsc --noEmit`, `cd ui && npx tsc -b`, and
  `npx tsc -p apps/desktop/tsconfig.json --noEmit` — passed.
- `pnpm electron:build` — passed as an unsigned development build.
- `CSC_IDENTITY_AUTO_DISCOVERY=false pnpm electron:smoke:pty --skip-build` —
  passed with a real Electron IPC PTY attach and CLI socket round trip.
- `pnpm docker:smoke` — passed after building an isolated image, opening the
  HTTP Workspace PTY WebSocket, executing the injected `alice` CLI, and
  offboarding the temporary Workspace. No AI credential or broker was loaded.

The real Chat route remains an explicit manual acceptance item. The in-app
browser automation surface rejected interaction with the existing localhost
tab under its URL security policy, so this proposal does not claim visual
browser acceptance from that route.

## Completion Criteria

- A completed OpenCode or Pi turn with a live TUI is waiting, not working.
- A new turn transitions to working from native runtime evidence.
- Quick Chat output is visible after late attach and after WebSocket reconnect.
- Public Session projections never conflate activity with PTY lifecycle.
- The unsupported OpenCode interactive option no longer prevents launch.
- Focused tests, required typechecks/tests, browser verification, and the
  Electron/PT​​Y acceptance lane are recorded on the Draft PR.
