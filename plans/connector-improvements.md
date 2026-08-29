# Plan: Connector Improvements

**Status:** active — feature-branch iteration hold on `feature/connector-improvements`; do not open or merge a PR until Ame says the branch is ready.
**Owner guides:** [[docs/connector-service.md]], [[docs/alice-project.md]], [[docs/development-workflow.md]]
**Delivery:** Keep verified increments on the owned feature branch. Serial and parallel execution may both be used, but one integrator owns the branch and `dev` remains untouched until explicit acceptance.

## Goal

Improve Connector reliability and operator experience from evidence gathered on
the real Default AliceProject. Preserve the Connector Service boundary: Inbox
and Workspace state remain Alice-owned, broker state remains UTA-owned, and
external adapters remain optional projections rather than sources of truth.

## Working Baseline

- AliceProject: `default` (`/Users/ame/.openalice`), selected explicitly through
  the Supervisor rather than using Demo or `office-lab`.
- Source: this feature branch, started against the Default AliceProject home.
- External-account actions: do not send test messages, commands, or probes
  without Ame's explicit permission. Local settings, health, journal, and
  recorded-replay inspection remain in scope.
- Secrets: never print or capture bot tokens, connector credentials, raw owner
  identifiers, or sealing material.

## Discovery Questions

1. Does the real Settings surface explain service state, adapter state, linking,
   capabilities, failures, and recovery clearly?
2. Do outbound Inbox delivery and phone-desk replies preserve content,
   provenance, formatting, and lifecycle across adapters?
3. Are health and logs actionable without exposing secrets or requiring source
   inspection?
4. Which gaps are shared Connector-core problems versus adapter-specific
   limitations that should remain explicit?
5. Which first increment provides a coherent user-visible improvement with a
   bounded acceptance surface?

## Decisions

1. **Real surface first.** Establish the Default AliceProject baseline before
   choosing an implementation increment.
2. **Feature-branch hold.** Do not open an early Draft PR. Push atomic verified
   commits to this branch and keep this plan current until maintainer acceptance.
3. **No speculative parity.** Discord, Slack, Telegram, and Feishu may expose
   different capabilities; improve shared ownership without pretending an
   unimplemented external path works.
4. **Design before UI edits.** For any Settings interaction change, record
   viable approaches, tradeoffs, the chosen interaction model, responsive
   behavior, accessibility, and shared primitive ownership before editing UI.
5. **Recorded evidence before live messages.** Use unit tests, journal replay,
   and isolated process smoke first. Live external DM confirmation remains an
   explicitly authorized acceptance lane.
6. **Connector lifecycle is explicit.** Each adapter exposes one accessible
   runtime switch. Starting it may turn on the global Connector Service, while
   stopping it preserves credentials, owner binding, Inbox preference, and
   chat configuration.
7. **Chat is a capability, not a desk users must understand.** Desk-capable
   adapters present `Chat on <connector>` with an independent switch and a
   Workspace choice before first enable. The durable Issue remains the internal
   execution specimen; heartbeat cadence and prompt are advanced chat settings.

## Ordered Work

- [x] Start this branch against the real Default AliceProject and record its
      current project, Connector service, and adapter health baseline.
- [x] Walk Settings > Connectors in the real browser route and capture concrete
      usability or diagnostic gaps without exposing credentials.
- [x] Trace the matching backend, protocol, adapter, journal, and Guardian paths
      for each observed gap.
- [x] Present the first coherent increment and alternatives to Ame before UI or
      interaction implementation.
- [ ] Implement accepted increments as atomic commits, updating this plan with
      evidence and remaining risks.
  - [x] Replace Start/Stop buttons with one per-adapter runtime switch.
  - [x] Replace visible phone-desk setup with `Chat on <connector>`, a Workspace
        choice, an independent switch, and collapsed heartbeat/prompt settings.
  - [x] Name newly created connector Issues `Chat on <label>` and use connector-chat
        copy in default What and domain/HTTP validation errors; do not rewrite existing Issues.
  - [ ] Revisit Connector status copy and owner-identifier disclosure as a
        separate accepted increment.
- [ ] Reconcile the accumulated branch with current `dev`, run full acceptance,
      and open a PR only after Ame says the branch is ready.

## Verification

Every code increment runs `npx tsc --noEmit` and `pnpm test`, plus the smallest
relevant Connector lanes:

- `pnpm test:connector-replay`
- `pnpm test:connector-service`
- Settings browser verification on the real Default AliceProject
- isolated Guardian enable/restart/disable recovery when lifecycle changes
- Docker/package assertions when process layout or distributed resources change

Live Telegram, Discord, Slack, or Feishu delivery is reported as skipped unless
Ame explicitly authorizes the external-account action.

## Non-goals

- turning a feature branch into a preview or release lane;
- moving Inbox, Workspace, or UTA ownership into Connector Service;
- exposing or copying connector credentials;
- submitting trading actions as part of ordinary Connector testing;
- claiming cross-adapter capability parity without real implementation.

## Completion

The branch has an accepted Connector outcome, the real Default AliceProject and
required isolated lanes verify the accumulated diff, stable conclusions are in
the owner guide, and Ame explicitly asks to open the PR to `dev`. Delete this
plan and its `PLANS.md` entry in the accepted integration change.
