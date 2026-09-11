# Plan: Web conversation surface for every structured Agent runtime

**Status:** active  
**Owner guides:** [[docs/web-conversation-surface.md]], [[docs/ui-interaction-and-motion.md]], [[docs/workspace-manager.md]]  
**Delivery:** PR `cursor/web-conversation-transports-1c9d` → `dev` (`area:workspace`, `area:ui`).

## Goal

WebPi proved that a browser conversation over a long-lived structured CLI
process is a better product surface than a PTY for many tasks. It shipped as a
Pi-only special case: the host spoke Pi's RPC protocol, the routes checked
`agent === 'pi'`, and the UI gated every affordance on the same literal.

This plan turns "WebPi" into one Web surface that any Agent runtime can join by
declaring a wire protocol. The browser keeps the adapter-neutral conversation
presentation from PR #1385; Alice gains a transport layer that normalizes each
runtime's live protocol into one message model, one phase model, and one
permission-request model.

## Alternatives considered

1. **One native host per runtime** (the WebPi approach repeated N times).
   Closest fit to each CLI, but N protocol parsers and N snapshot shapes, and
   the browser would need N presenters. Rejected as the primary structure.
2. **Everything through ACP** (Agent Client Protocol). One client covers
   cursor, grok, opencode, omp natively; claude, codex, and pi need an extra
   npm adapter package, agy has no trustworthy implementation, and ACP is the
   lowest common denominator (no compaction, model, or thinking controls
   without vendor `_meta`). Rejected as the only path, adopted as one transport.
3. **Hybrid (chosen):** a neutral `WebSessionHost` with pluggable transports.
   `pi-rpc` reuses the existing code for pi and omp; `acp` covers the three
   runtimes whose own binary speaks ACP; `claude-stream-json` and
   `codex-app-server` use the vendor protocols that are richer than ACP and
   need no extra install. Pi's minimal message shape becomes the neutral
   model because every other protocol maps onto it losslessly enough for
   presentation, and the browser presenter already understands it.

## Decisions

- The neutral model is presentation-grade, not a persisted store. Each
  runtime's own transcript remains the durable conversation; Alice keeps one
  live process per Session record, exactly as WebPi did.
- `SessionRecord.surface: 'webpi'` is a shipped persisted value (migration
  0040) and stays. It now means "structured web conversation" for any agent.
  HTTP paths move from `/webpi/*` to `/web/*` because UI and server ship
  together; no compatibility alias.
- Adapters opt in with `capabilities.web = { wire }` plus `composeWebCommand`.
  The UI reads the capability from `/api/workspaces/agents`; no runtime id
  literal decides whether a Web button exists.
- Permission prompts become first-class: transports surface
  `session/request_permission` (ACP), `can_use_tool` control requests
  (Claude), and `item/*/requestApproval` (Codex) as neutral requests with
  options; the browser answers through `POST .../web/respond`. Pi and omp
  keep launch-time approval (`--approve` / `--auto-approve`) because their RPC
  modes have no per-tool prompt.
- Fresh Web sessions are allowed for runtimes that create sessions in-band
  (ACP `session/new`, Codex `thread/start`, Claude `--session-id`, omp fresh
  RPC). The transport reports the native id and Alice binds it to the
  `resumeId` the same way PTY discovery does.
- agy stays TUI-only: its new `--input-format stream-json` has no permission
  round-trip and no native ACP; revisit when either lands.
- Workspace Manager Quick Start keeps opening Pi in Web and other runtimes in
  their TUI. A paused Manager Session of any web-capable runtime may be
  reopened in Web from its resume choice; the manager options travel with it
  and each adapter projects what its structured mode supports
  (`--append-system-prompt` for claude/omp/pi, `--rules` for grok).

## UI design decision

Alternatives for permission prompts: (a) inline as a transcript item, (b) a
modal dialog, (c) a card pinned above the composer. (c) is chosen: it keeps
the transcript an audit trail, does not steal focus from a user who is typing
a follow-up, and matches the compaction status treatment already pinned in
the same slot. Options render as buttons in the order the runtime supplies;
allow-style options are primary, reject-style are outline. Reduced motion is
inherited from the shared primitives.

## Work

- [x] Neutral message/request/snapshot model and transport contract
- [x] `WebSessionHost` with process supervision shared by all transports
- [x] `pi-rpc` transport (pi, omp) extracted from `WebPiSessionHost`
- [x] `acp` transport (cursor, grok, opencode) with permission requests
- [x] `claude-stream-json` transport with `can_use_tool` and interrupt
- [x] `codex-app-server` transport with approvals and `turn/interrupt`
- [x] Adapter capability declarations and `composeWebCommand` per runtime
- [x] Service/routes: `/web/*`, `respond`, native-id binding, capability checks
- [x] UI: generic hook/presenter/view, permission cards, capability gating, demo
- [x] Owner guide ([[docs/web-conversation-surface.md]]) + doc updates
- [x] Real-binary handshake and prompt-path smoke for every wire (see
  verification); fixed the Codex enum casing, permission-response shape, and
  Pi rejected-prompt phase it uncovered
- [ ] Credentialed live acceptance per runtime: tool-using prompt, answer the
  permission card, stop mid-turn, reopen in the TUI (see verification)

## Verification

- `npx tsc --noEmit`, `pnpm test`, `cd ui && npx tsc -b`.
- Transport specs drive fake child processes over stdio for every wire.
- Demo route (`pnpm -F open-alice-ui dev:demo`) walks open → prompt →
  permission request → respond → stop for a non-Pi runtime.
- Real-binary smoke (done once with `@earendil-works/pi-coding-agent` 0.85.1,
  `opencode-ai` 1.18.29, `@openai/codex` 0.153.4, `@anthropic-ai/claude-code`
  2.1.263 installed under a throwaway `HOME`, driving `WebSessionHost` with the
  argv each adapter composes):
  - every wire completes its handshake (`pi-rpc` `get_state`, ACP
    `initialize`→`session/new`, Codex `initialize`→`thread/start`, Claude
    stays live and binds the session id on `system/init`);
  - without credentials, Pi/Codex/Claude each surface the runtime's own
    auth error as `snapshot.error` and return to `idle` instead of sticking in
    `working`;
  - OpenCode's bundled free model completed a real turn over ACP (user →
    thinking → text), so that wire is accepted end to end.
  - Codex request/response shapes were checked against
    `codex app-server generate-json-schema` rather than memory.
- Credentialed acceptance still needs a maintainer machine: per runtime, open
  one Session in Web, send a prompt that needs a tool, answer the card, stop
  mid-turn, then reopen the same Session in the TUI and confirm the native
  transcript is shared.

## Completion

Delete this file and its [[PLANS.md]] bullet when the live acceptance is
recorded and the PR is accepted.

## Maintainer runtime audit (2026-09-06)

After #1392, exercised all seven installed Web-capable runtimes using their actual Adapter argv
in disposable working directories. Text probes explicitly prohibited tools and
file changes; native credentials remained owned by each CLI.

| Runtime | Installed version | Evidence |
|---|---|---|
| Claude | 2.1.229 | Native startup and login error; real CLI + isolated local Anthropic stub completed a turn and replayed the same native history after the fix. No credentialed Claude claim. |
| Codex | 0.147.0 | Handshake, actual text turn and exact-thread history replay with `gpt-5.6-sol` from its model/list. Global `gpt-6-astra` selection is too new for this installed CLI; global settings were not changed. |
| Cursor | 2026.09.02-c22c1a3 | Actual text turn and same-session history replay. |
| Grok | 1.0.13 | Actual text turn and same-session history replay (also verified in UI Setup in #1392). |
| OpenCode | 1.17.13 | Actual text turn and same-session replay. ACP rejected argv containing --model; process-local model config was verified through returned configOptions.currentValue. |
| OMP | 17.3.4 | Actual text turn and replay; fixed agent_end settlement and stale streaming copy. UI Setup also restored a TUI-created Session in Web and completed a second turn with no duplicate or stuck spinner. |
| Pi | 0.80.6 | Handshake and recorded session reopening; selected provider returned authentication failure. Fixed the swallowed asynchronous error. No successful credentialed Pi turn claimed. |

Corrections in this increment: native OpenCode model configuration for ACP,
OMP agent_end handling, Pi/OMP asynchronous model-error projection, and Claude
native-history replay through its active parent chain. Unit fixtures cover
these observed runtime shapes. Full tool-approval, cancellation and Web/TUI
acceptance remains open as listed above; these narrower probes do not close it.

Verification: full hermetic suite passed (739 files, 6657 tests, 3 skipped),
root typecheck passed, and the final targeted regression run passed (30 tests).
