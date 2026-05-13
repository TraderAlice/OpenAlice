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

## Architecture — MCP / ToolCenter

- [ ] Document the workspaces `.mcp.json` URL/transport convention in
      the README. The codex adapter's `mcp_servers.<name>.url`
      translation is now a permanent contract — chat template's
      `.mcp.json` is the public surface for "an MCP-aware agent inside
      a workspace can call OpenAlice". Future template authors need to
      know what shape to ship.

## Security

- [ ] Broader API security audit. Only `/api/events/ingest` has auth
      today; the rest of `/api/*` (config mutation, cron CRUD, heartbeat
      trigger, chat, trading push, etc.) is unauthenticated and relies
      entirely on localhost binding. Needs a proper auth story (shared
      admin token? session cookies? per-route scopes?) before any of it
      is exposed beyond a single-user local machine.
- [ ] Retire `PUT /api/trading/config/uta/:id` once all on-disk UTAs
      have derived ids. The route still accepts a full `UTAConfig` body
      including credentials (we unmask masked values from the existing
      record before re-saving) — that's a credential-handling surface
      we'd rather not keep around long-term. Replacement: a narrower
      `PATCH /uta/:id` that only allows label / guards / enabled
      changes; credential rotation goes via DELETE + new POST. Wait
      until the user-typed-id legacy UTAs have all migrated naturally
      so we don't break edits on existing accounts.
- [ ] Webhook tokens: add admin UI for listing / adding / rotating
      tokens inside the Webhook tab instead of requiring hand-editing
      `data/config/webhook.json`. Config surface exists; just missing
      the form.
- [ ] Token scoping: a webhook token can currently fire any external
      event type. When more external types exist, let tokens declare
      which event types they're allowed to inject.

## Architecture

- [ ] Broker raw-upstream recorder + no-connect replay harness (Layer 2
      bug debug surface). When a community user reports a broker-specific
      normalize bug — IBKR's `request-bridge.ts:470 .abs()`, the proto
      decoder's empty `if (cp.secType !== undefined)` body, a hypothetical
      CCXT `entryPrice` mis-parse — code-reading alone is slow and
      imprecise. Add a dev-mode raw-upstream recorder per broker (IBKR:
      EWrapper callback args; CCXT: `fetchBalance` / `fetchPositions`
      return values; Alpaca: REST response bodies), append-only JSONL to
      `data/trading/<id>/upstream/session-<timestamp>.jsonl`. Pair with a
      replay tool that constructs the broker without network (currently
      `init()` forces connect) and re-fires the recorded events through
      the same normalize pipeline, returning `getPositions` /
      `getAccount`. Prerequisite: factor `init()` to allow no-connect
      construction for IBKR / CCXT / Alpaca. Lets future broker-bug
      diagnosis happen offline against a recorded session instead of
      requiring live broker re-attachment. Companion harness ideas in
      `~/.claude/plans/simulator-moonlit-otter.md`.
- [ ] Extract `derivePositionMath(raw): { marketValue, unrealizedPnL }`
      shared util. Today's IBroker contract requires every broker's
      `getPositions` to multiply by `multiplier` when computing
      marketValue / unrealizedPnL — but it's documentation-only, no
      enforcement. Production brokers happen to dodge it because their
      primary markets all have multiplier=1 (CCXT spot/perp) or the
      upstream API hands back pre-multiplied values (Alpaca, IBKR).
      First broker to grow custom OPT/FUT math will repeat Mock's
      bug shape (cash-flow / marketValue / PnL all need multiplier).
      Replace per-broker computation with one shared derive call;
      brokers emit raw fields (qty, markPrice, multiplier, side,
      avgCost) and downstream math is contract-uniform.
- [ ] Native Anthropic full provider — replaces `agent-sdk` for the
      api-key chat path so non-subscription Anthropic credentials
      (Claude API, MiniMax, GLM, Kimi, DeepSeek) stop spawning a
      Claude Code subprocess every chat turn. Subscription credentials
      (loginMethod=claudeai) physically need agent-sdk and stay there.
      Shape: parallel to `CodexProvider` (~270 lines) — uses
      `@anthropic-ai/sdk` directly, manual tool loop with
      tool_use/tool_result content blocks, streaming events, history
      serialization, Vercel→Anthropic tool format conversion. Then
      wires into `GenerateRouter` (likely as new backend value
      `anthropic-native`, or replaces `agent-sdk` for non-claudeai
      profiles via the preset's chat adapter declaration once
      preset-driven chat routing lands). Cleans up the per-vendor
      `/v1` baseUrl hack in preset-catalog along the way (native SDK
      hits `/v1/messages` by default, all four Anthropic-compat
      vendors accept that path). ~4-6h focused work.
- [ ] Native OpenAI Chat Completions full provider — companion to the
      Anthropic native work. Reuses the `openai` SDK we already have
      (codex provider uses `client.responses.stream()`; this would
      use `client.chat.completions.stream()`). Lets us drop
      `vercel-openai` adapter entirely and gives Custom + OpenAI-compat
      third parties (Together, Groq, vLLM, LM Studio, Ollama) a
      proper light chat path. Same structural shape as the Anthropic
      one. ~3-4h.
- [ ] **Profile + AI Provider model needs structural rethink.**
      Surfaced 2026-05-13 during workspaces' per-workspace codex
      override testing (commit `6b52853`). `ai-provider-manager.json`
      profiles (Kimi/MiniMax/DeepSeek/Claude Pro) are **claude-shaped**
      — each profile's `baseUrl` is the vendor's Anthropic-compat
      endpoint (e.g. `https://api.moonshot.ai/anthropic`) and `model`
      is the Anthropic-side model name. Applying the same profile to
      codex via `WorkspaceAIConfigModal`'s shared Apply-from-profile
      quick-pick silently produces invalid configs: codex speaks
      OpenAI Responses shape, POSTs against an Anthropic endpoint →
      `POST /anthropic/responses` → 404.

      The shape mismatch isn't a quick-fix item — disabling
      Apply-in-codex-tab or adding "no `/anthropic` in baseUrl"
      sanity checks just covers one foot-gun each. "AI Provider"
      today conflates four concepts that have started to diverge:
      Anthropic-API endpoints, OpenAI-API endpoints, **vendor
      identity** (Moonshot/DeepSeek/etc., one credential, multiple
      endpoint shapes), and the `(baseUrl, model)` triple stored
      per-profile. Each consumer (chat path / workspace claude /
      workspace codex / future Anthropic-native / future
      OpenAI-native) needs a different slice. Bolting more
      `(baseUrl, apiKey, model)` triples onto the profile struct
      keeps stacking the conflation.

      Adjacent work that should design together (don't ship in
      isolation): the **Native Anthropic / Native OpenAI provider**
      TODOs above — their concrete client-side input shapes
      clarify what profile dimensions actually need to exist. The
      per-workspace override modal (just shipped) hits the same
      foot-gun and would benefit from the redesigned profile model
      directly. Land all three in one focused pass.

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

- [ ] IBKR `getNativeKey` may use the wrong field for nativeKey. Surfaced
      2026-05-07 during the Phase-3 revert (`afddd41`) when articulating
      the per-broker uniqueness scheme. IBKR's `Contract.symbol` and
      `Contract.localSymbol` aren't reliably unique — one symbol "AAPL"
      matches the underlying stock + every option chain expiry + every
      weekly + every LEAP. The actual primary key is `conId` (numeric).
      If `IbkrBroker.getNativeKey` currently returns `localSymbol ||
      symbol`, it works only by accident — the moment users hold the
      same underlying across multiple expiries, aliceId starts colliding.
      Audit `src/domain/trading/brokers/ibkr/IbkrBroker.ts` (look for
      `getNativeKey`); change to `String(contract.conId)` if not already.
      Also extend the same audit to Alpaca / LeverUp / Bybit-direct
      brokers — each should have an explicit getNativeKey returning the
      broker's documented primary key, not a lazy `localSymbol ||
      symbol` fallback.

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
      a pre-workspace-era template that should not be cloned wholesale —
      see memory `project_heartbeat_legacy.md`).

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
      `getNewsAt(t, lookback)`, `getRecentAlertsAt(t)`. Two
      implementations: `LiveTimeView` ("now" — current behavior) and
      `ReplayTimeView(t, eventLog)` (reconstruct from disk). All
      autonomous components consume TimeView, never call live services
      directly. Inventoried disk assets are mostly already replayable:
        - EventLog (`data/event-log/events.jsonl`)
        - Sessions (`data/sessions/*.jsonl`)
        - Tool call log (`data/tool-calls/tool-calls.jsonl`)
        - News (`data/news-collector/news.jsonl`)
        - Trading snapshots (`data/trading/{acct}/snapshots/`)
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

## Brokers — others/leverup

- [ ] LeverUp limit orders. The OCT relayer doc only exposes
      `send-open-position` (market) and `send-close-position`. Limit
      orders require either (a) a future LeverUp OCT endpoint or (b)
      a separate on-chain code path calling
      `openLimitOrderWithPyth(OpenDataInput, priceUpdateData)` directly
      via viem walletClient (which brings back gas/Pyth-fee complexity
      we deliberately punted). Currently `placeOrder` rejects non-MKT.
- [ ] LeverUp partial close. `closeTrade(bytes32)` is whole-position;
      LeverUp protocol doesn't expose a partial-close primitive yet.
      `closePosition(qty)` ignores qty and closes the matched position
      in full. Add when LeverUp adds it.
- [ ] LeverUp EIP-712 type schema verification. Docs ship two
      conflicting versions (flat `OneClickOpenPosition` vs nested
      `OneClickOpenDataInput`). Current code defaults to nested per
      the doc's viem code example; first real testnet round-trip
      should confirm. Once verified, delete the losing variant from
      `eip712.ts` and the variant flip-test from the spec.
- [ ] LeverUp testnet pair list. Currently `TESTNET_PAIRS` aliases to
      `MAINNET_PAIRS`. Confirm with Monad team whether testnet hosts
      the same 23 pairs at the same addresses or a subset; replace
      placeholder if needed.
- [ ] LeverUp `unrealizedPnL` from positions REST is currently 0 in
      `getPositions()`. Compute from (mark - entry) * qty * direction
      once we have a stable mark-price source for non-Pyth-feed pairs.

## Workspaces (launcher integration)

- [ ] `AQ_*` env prefix rename to `OPENALICE_WORKSPACE_*`. Kept as `AQ_*`
      for the initial cp from auto-quant-launcher to minimize churn; the
      decision was to rename in a dedicated cleanup PR (plan §D8). Affects
      `src/workspaces/config.ts` (AQ_LAUNCHER_ROOT, AQ_TEMPLATE_DIR,
      AQ_BOOTSTRAP_SCRIPT, AQ_TEMPLATES_DIR, AQ_SHARED_DATA_DIR,
      AQ_BOOTSTRAP_TIMEOUT_MS) plus `spawn-env.ts` extras (AQ_WS_ID,
      AQ_LAUNCHER_REPO_ROOT) and `bootstrap.sh` env references.
- [ ] Top-level `CLAUDE.md` is stale in two places after the workspaces
      integration: (a) Project Structure section still references
      `src/plugins/mcp.ts` — moved to `src/server/mcp.ts` earlier;
      (b) Project Structure should add `src/workspaces/` (composition
      root + adapters + templates + cp'd domain modules) and the
      `src/webui/routes/workspaces.ts` + `src/webui/workspaces-ws.ts`
      adapters.
- [ ] auto-quant template end-to-end. Requires
      `export AQ_TEMPLATE_DIR=/path/to/Auto-Quant` before creating a
      workspace from that template. Currently only the chat template was
      smoke-tested live; auto-quant template only verified the
      env-empty-fails-loudly path via bootstrap.sh's `:?` check.
- [ ] User-added template overlay at
      `~/.openalice/workspaces/templates/`. Today templates ship from
      `src/workspaces/templates/` only (compile-time fixed). An overlay
      path read at runtime would let users add custom templates without
      forking OpenAlice.
- [ ] xterm `TypeError: Cannot read properties of undefined (reading
      'dimensions')` fires once per fresh terminal mount (xterm's
      `Viewport.syncScrollArea` reads `_renderService.dimensions`
      before the renderer attaches). Non-fatal — terminal renders
      correctly once dimensions settle — but pollutes the console.
      Fix: gate fit on `onRender` or defer to next microtask after
      `open()`.
- [x] ~~Dev-mode Vite WS proxy~~ — resolved 2026-05-12 by upgrading
      `ui/vite.config.ts`'s `/api` proxy from string-form to
      `{ target, ws: true }`. WS upgrade now forwards in dev mode on
      port 5173.
- [ ] `ui/src/components/workspace/` is OpenAlice's first sub-folder
      under `components/`. If we adopt this pattern for other complex
      features, document the convention; otherwise reconsider whether
      to flatten when the workspaces feature stabilizes.
- [ ] Workspaces sidebar lacks an `Actions` header button (the
      OpenAlice sidebar pattern, mirroring `NewChannelButton`). The
      inline create form inside the launcher's `Sidebar.tsx` covers
      the function, but a header `+` would visually match other
      activities.

## (seed more areas as they come up)
