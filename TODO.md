# TODO

Running list of deferred work and open questions. Add items here when they
come up in conversation but aren't the current focus. Delete or check off
once handled.

Format: `- [ ] <area>: <item> — <short why/context>`. Keep the why, drop
the item when done — git log is the history.

## Events / Automation

- [ ] `task.requested`: add optional `silent?: boolean` to the payload so
      headless callers (webhook scripts, monitoring) can opt out of the
      default `connectorCenter.notify`. Currently every task reply is
      pushed to the last-interacted connector, which is wrong for pure
      background jobs.
- [ ] `task-router`: support `sessionId` in the payload so different
      external callers get isolated conversation histories instead of
      sharing `task/default`.

## Security

- [ ] Broader API security audit. Only `/api/events/ingest` has auth
      today; the rest of `/api/*` (config mutation, cron CRUD, heartbeat
      trigger, chat, trading push, etc.) is unauthenticated and relies
      entirely on localhost binding. Needs a proper auth story (shared
      admin token? session cookies? per-route scopes?) before any of it
      is exposed beyond a single-user local machine.
- [ ] Webhook tokens: add admin UI for listing / adding / rotating
      tokens inside the Webhook tab instead of requiring hand-editing
      `data/config/webhook.json`. Config surface exists; just missing
      the form.
- [ ] Token scoping: a webhook token can currently fire any external
      event type. When more external types exist, let tokens declare
      which event types they're allowed to inject.

## Architecture

- [ ] Unified config hot-reload. Right now every consumer of a config
      section has to solve "did the user edit this?" on its own —
      Telegram/MCP-Ask via `reconnectConnectors`, opentypebb via lazy
      getters closing over `ctx.config` plus an `Object.assign` patch
      in the config PUT route, and anything holding a sub-reference
      (`const providers = ctx.config.marketData.providers` style) just
      goes stale. That's three different strategies living in one
      codebase, and the last patch (opentypebb lazy getters + ctx.config
      assign) is a band-aid that only works because `ctx.config`'s
      top-level object identity is preserved. What's missing: a single
      subscribe/publish surface over config sections (`configBus.on(
      'marketData', handler)` / `get('marketData')`) that writers hit
      once and consumers subscribe to, plus a file-watcher for the
      direct-edit case (people editing `data/config/*.json` in their
      editor bypass the PUT route entirely and still see stale behavior).
      Two-month-old config layer has been getting patched incrementally;
      worth doing one focused pass instead of another band-aid next time
      something goes stale.

## Bugs

- [ ] Snapshot / FX: after currency conversion, snapshot values
      occasionally come out as wildly wrong numbers (reported, cause
      unknown). Likely a direction mistake (multiply vs divide) or
      precision loss going through `number` instead of `Decimal`.
      Start: `src/domain/trading/snapshot/service.ts` (only file in
      snapshot/ that touches fx) + `src/domain/trading/fx-service.ts`.
      When next triggered, capture: (a) the raw `netLiquidation` /
      currency on the account, (b) the rate FxService returned, (c) the
      final displayed value — the TODO can't be narrowed without a
      concrete data point.

- [ ] Heartbeat dedup window lost on restart. `HeartbeatDedup.lastText`
      / `lastSentAt` (`src/task/heartbeat/heartbeat.ts:392-410`) live
      only in memory. Restart inside the 24h dedup window → identical
      heartbeat re-pushes. Fix: persist last-sent text + ts to a small
      JSON file (or derive from past `heartbeat.done` events in the
      EventLog — stronger but needs a load-on-init scan). Surfaced
      during the autonomous-loop discussion (see Architecture section)
      but stands on its own as a correctness bug.

- [ ] Cooldown guard state lost on restart. `CooldownGuard.lastTradeTime`
      (Map<symbol, ts>) at `src/domain/trading/guards/cooldown.ts:9,30`
      is in-memory only. If a trade fires at T-1s before restart, the
      next trade at T+30s post-restart bypasses the cooldown entirely.
      This is a real risk-control violation, not just a UX wrinkle.
      Fix: persist per-symbol last-trade-ts to disk on each set, reload
      on init. Or derive from past order-fill events.

- [ ] Trading git staging area lost on restart. `TradingGit.stagingArea`,
      `pendingMessage`, `pendingHash`, `currentRound` at
      `src/domain/trading/git/TradingGit.ts:41-46` are RAM-only. Stage
      orders, restart before push → user has to redo. Worse if a push
      was in flight: commit metadata is gone, can't tell what failed.
      Fix: write staging area to disk on each mutation.

- [ ] OKX UTA spot-holding fix needs live confirmation. The CcxtBroker
      now synthesizes spot balances into Position records (see
      `fetchSpotHoldings` in `src/domain/trading/brokers/ccxt/CcxtBroker.ts`)
      so OKX UTA users should now see BTC/ETH/etc. holdings instead of
      a USD-only view. Spec covers the path but no live OKX account was
      available — confirm on a real OKX UTA that snapshot.positions
      includes spot, totalCashValue sums all stablecoins, and
      netLiquidation matches the exchange's own equity figure.

## Architecture

- [ ] Autonomous-loop substrate (news watcher + sandbox + time machine).
      Long discussion documented below — this is a major architectural
      pillar, not a feature. Park until there's a dedicated multi-week
      block.

      **Origin.** `NewsCollectorStore.ingest()` writes to JSONL but emits
      no event. The natural next step is a Listener that subscribes to
      a new `news.ingested` event, judges relevance against the user's
      holdings, and pushes an alert. Mechanically straightforward
      (heartbeat is the closest existing pattern, modulo heartbeat being
      OpenClaw-era legacy that should not be used as a template — see
      memory `project_heartbeat_legacy.md`).

      **Why this can't ship as just a Listener.** Two compounding
      problems:

      1. **Sub-agent escalation.** A useful watcher doesn't only push
         text. When it judges "this might matter," it should be able
         to spawn a sub-agent task (check kline, scan recent events,
         re-grep news). Sub-agents read large slices of system state,
         so any replay/eval must freeze the entire observable
         environment, not just the watcher's immediate inputs.

      2. **Statefulness kills evaluation.** The watcher's decisions
         depend on prior state (which alerts already pushed, what's
         in brain, what the session looks like). Changing the prompt
         changes the decisions, which changes downstream state, which
         changes future decisions — classic off-policy evaluation. You
         can't measure prompt improvements without a way to replay
         decisions against frozen historical state.

      Both problems point at the same answer: **a TimeView abstraction
      + a powerless sandbox execution context**.

      **TimeView.** Interface like `getPositionsAt(t)`,
      `getNewsAt(t, lookback)`, `getBrainAt(t)`,
      `getRecentAlertsAt(t)`. Two implementations: `LiveTimeView`
      ("now" — current behavior) and `ReplayTimeView(t, eventLog)`
      (reconstruct from disk). All autonomous components consume
      TimeView, never call live services directly. Inventoried disk
      assets are mostly already replayable:
        - EventLog (`data/event-log/events.jsonl`)
        - Sessions (`data/sessions/*.jsonl`)
        - Tool call log (`data/tool-calls/tool-calls.jsonl`)
        - News (`data/news-collector/news.jsonl`)
        - Trading snapshots (`data/trading/{acct}/snapshots/`)
        - Brain commits (`data/brain/commit.json`)
      Gaps:
        - **Market data not persisted at all.** Kline / quotes are
          live API calls. Blocks any "did this alert correlate with a
          real move" evaluation; blocks quant-iterator entirely;
          blocks backtester resurrection. Needs a periodic kline
          snapshotter at minimum.
        - **Five JSONLs are independent timelines** — no cross-source
          index, no event → underlying-record pointer. Tolerable for
          window queries (watcher's use case); painful for "what was
          Alice thinking at 14:35".
        - **In-memory authoritative state** (heartbeat dedup, cooldown
          guard, trading staging) — see Bugs section, fix as standalone
          correctness issues regardless.
        - **Config files overwrite-only** — "what feeds were enabled
          at T?" not answerable without git history backup.
        - **Brain commits are a single JSON file with array append**,
          not true JSONL — fragile under concurrency at scale.

      **Powerless sandbox.** Capability-based execution context where
      writes are virtualized:
        - All reads through TimeView, pinned to T (including
          `Date.now()` inside tools — the tool layer's "now" must
          obey the pin).
        - All writes (ConnectorCenter, Brain commits, order
          submission, sub-agent spawn) go through capability
          handles. Live mode = real execution. Sandbox mode =
          captured as proposed actions, not executed.
        - Sub-agent spawning is recursive: parent in sandbox →
          child in sandbox. Otherwise the child calls a live broker
          and the bubble pops.
        - Third-party API calls (FMP, OpenBB, broker) need
          historical snapshots OR fail-fast in sandbox. Every live
          call site needs a capability gate.

      Mental model parallels: capability security, effect systems,
      React concurrent mode's speculative renders.

      **Why this is big.** The largest hidden cost is that **every
      tool in the tool layer has to become execution-context-aware**.
      OpenAlice's tool count is non-trivial; each one needs auditing
      for live-vs-sandbox behavior. This is not "add a listener."
      It's "virtualize the AI runtime." Probably multi-week
      dedicated work.

      **Two staging paths considered, both rejected as today-work:**
        - *v0-shadow watcher*: emit `news.alert.proposed` events with
          no push and no sub-agent spawn. Trivially replay-friendly
          (only state is event log). But Ame ruled this out as too
          weak to justify — without sub-agent escalation it's just
          "curated news in the UI."
        - *Foundation-only*: draft the TimeView interface, enumerate
          the capability surface, fix the in-memory bugs (already
          tracked above). Doesn't ship watcher value but de-risks the
          eventual build by ~1 week.

      **Open design questions** (from the discussion, none resolved):
        - Should TimeView v1 be narrow (only what news watcher needs)
          or pre-cover the quant-iterator surface? Leaning narrow.
        - LLM non-determinism in replay: re-call model vs use
          archived response — both modes are useful, suggests
          archiving raw model responses into the EventLog from day 1.
        - Cold start: when Alice restarts, should the watcher replay
          missed `news.ingested` events from before the restart, or
          only see new ones? Leaning skip + tell the LLM "you just
          woke up."
        - Asymmetric output protocol: brake bias (warn but never
          recommend trades from news alone). Different from
          heartbeat's STATUS:HEARTBEAT_OK/CHAT_YES which is
          symmetric/general.
        - Holdings + brain composition: holdings from
          `accountManager` (world-state, can't live in brain per the
          de-se principle), watchlist focus from brain frontal-lobe
          note. Watcher consumes both as TimeView inputs.

      **Standalone unblockers** (not strictly autonomous-loop but
      adjacent): see the three in-memory bugs in the Bugs section.
      Those should be fixed independently regardless of whether the
      watcher project ever lands.

## Rust trading-core migration

- [ ] **[migration]** PHASE0_PLAN.md §4 sentinel-coverage matrix attributes
      6 fields to `Contract` that actually live on `ContractDetails`
      (`minSize`, `sizeIncrement`, `suggestedSizeIncrement`, `minAlgoSize`,
      `lastPricePrecision`, `lastSizePrecision`); 1 field to `Execution`
      that actually lives on `ExecutionFilter` (`lastNDays`); and 5 fields
      to `OrderState` that actually live on `OrderAllocation` (`position`,
      `positionDesired`, `positionAfter`, `desiredAllocQty`, `allowedAllocQty`).
      Phase 0 fixtures correctly target `ContractDetails`/`ExecutionFilter`/
      `OrderAllocation`, so the deliverables are correct, but the plan
      document needs to be updated before Phase 1b (whose adapters will
      otherwise look for these fields on the wrong carriers). See
      parity/decimal-inventory.md "Cross-cuts to flag for Phase 1b" §0
      for the full breakdown. Action: update PHASE0_PLAN.md §4 matrix
      to reflect actual class membership.

- [ ] **[migration][platform-note]** Native-module dlopen requires a
      Node binary built without hardened runtime + library validation.
      Documented here so future migration phases shipping native modules
      (Phase 3 napi-rs `.node` artifacts, Phase 4f event stream) don't
      re-rediscover this from scratch.

      **Symptom (originally observed in Phase 0):** on macOS Sequoia
      (Darwin 25.x), `pnpm test` failed to start vitest because `dlopen`
      rejected the prebuilt `@rollup/rollup-darwin-arm64.node` with
      `not valid for use in process: mapping process and mapped file
      (non-platform) have different Team IDs`. Reproduced on a clean
      `master` checkout — not Phase-0-induced.

      **Root cause:** the offending Node binary at the front of `PATH`
      (Codex Node v24, `/Users/opcw05/.local/bin/node`) was built with
      `flags=runtime` (hardened runtime) and *without* the
      `com.apple.security.cs.disable-library-validation` entitlement.
      macOS Sequoia's library-validation policy then refuses any
      third-party native module whose code signature does not chain to
      the same Team ID as the host binary. `@rollup/rollup-darwin-arm64`
      is ad-hoc-signed (no Team ID), so library validation rejects it.
      pnpm's content-addressed store + `com.apple.provenance` xattr are
      red herrings — they show up in the diagnostics but are not the
      cause.

      **Resolved 2026-05-02:** install Homebrew Node 22
      (`brew install node@22`) and put `/opt/homebrew/opt/node@22/bin`
      ahead of any hardened-runtime Node on `PATH`. Homebrew Node is
      ad-hoc signed without hardened runtime, so library validation
      doesn't apply. `pnpm test src/domain/trading/git/TradingGit.spec.ts`
      → 45/45 passed in ~500ms. `npx tsc --noEmit` likewise unblocked
      because opentypebb's tsup uses the same rollup chain.

      **Things that did NOT work** (kept for institutional memory):
        1. Re-extracting just `@rollup+rollup-darwin-arm64`.
        2. `xattr -c` + `codesign --force --sign -` (signing succeeds,
           but library validation in the host process still rejects).
        3. Copy-out / delete / copy-back to break the hard link + strip
           xattr + re-sign.
        4. Full `rm -rf node_modules pnpm-lock.yaml && pnpm install`.

      **Forward guidance for future native-module phases:**
        - The dev-machine Node must be ad-hoc signed without hardened
          runtime, OR signed with the
          `com.apple.security.cs.disable-library-validation` entitlement.
          Homebrew Node and `nvm`-installed Node both qualify by default;
          notarized/distributed Node binaries (Codex Node, anaconda Node,
          some IDE-bundled Nodes) typically do not.
        - Phase 3 (napi-rs) ships its own `.node` artifact built locally
          via `cargo build` + `napi build`. Locally-built artifacts are
          ad-hoc signed and load fine. The risk surface is *prebuilt*
          third-party native modules pulled by transitive deps (rollup,
          esbuild's native fallback paths, etc.).
        - Document this as a precondition in any per-phase setup doc
          that says "install Node and pnpm" — be explicit about Node
          provenance.

## (seed more areas as they come up)
