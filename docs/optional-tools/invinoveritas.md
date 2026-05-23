# Optional Invinoveritas MCP Review Tool

Invinoveritas is an optional external MCP server for structured second-opinion
reviews before an irreversible action. It can review a trade proposal, plan,
configuration change, or arbitrary text and return an advisory verdict.

Invinoveritas is not part of OpenAlice's deterministic guard pipeline. Use it as
a paid, opt-in review layer for agent reasoning. OpenAlice's local safeguards
remain authoritative for position size, cooldowns, allowlists, stale data,
broker validity, idempotency, and reconciliation.

## MCP Entry

Add this to a workspace MCP config when you want to try the external review
server:

```json
{
  "mcpServers": {
    "invinoveritas": {
      "type": "streamable-http",
      "url": "https://api.babyblueviper.com/mcp",
      "headers": {
        "Authorization": "Bearer ${INVINOVERITAS_KEY}"
      }
    }
  }
}
```

Store the token in the `INVINOVERITAS_KEY` environment variable. Do not commit
real tokens to `mcp.json`, workspace templates, shell history, or documentation.

## Tool Contract

The review tool accepts a proposed artifact and optional context:

```json
{
  "artifact": "Buy 0.25 ETH if the breakout holds above the trigger.",
  "artifact_type": "trade_proposal",
  "context": "Account risk cap is 1% per trade. ETH position is currently flat.",
  "concerns": ["stale data", "position sizing", "execution timing"]
}
```

It returns structured JSON similar to:

```json
{
  "verdict": "approve_with_concerns",
  "confidence": 0.72,
  "issues": [
    {
      "severity": "medium",
      "message": "Confirm the market data timestamp before staging the order."
    }
  ]
}
```

Treat the verdict as advisory. A positive verdict should never bypass local
OpenAlice checks.

## Guard Boundary Example

The review can run before staging or executing a trade, but deterministic guards
still decide whether execution is allowed:

```ts
const review = await invinoveritas.review({
  artifact: JSON.stringify(tradeProposal),
  artifact_type: "trade_proposal",
  context: "Pre-trade review before staging an order.",
  concerns: ["size", "cooldown", "stale data", "symbol allowlist"],
});

if (review.verdict === "reject") {
  throw new Error("External review rejected the proposal");
}

// OpenAlice guard checks remain authoritative even after an external approval.
await guardPipeline.assertCanStage(tradeProposal);
await tradingGit.stageOrder(tradeProposal);
```

## Auth And Cost

- Register with the upstream service to receive an API token.
- `/register` currently returns 250 starter sats.
- A `/review/external` call currently costs about 390 sats, so the starter
  balance does not cover a live review call by design.
- Top up via Lightning before evaluating against a live trade.
- Keep this disabled in automated loops unless cost controls and logging are
  configured.

## Acceptance Checklist

- The integration is opt-in and external.
- No API token is committed.
- No signup or token is required for OpenAlice itself.
- No telemetry is added to OpenAlice by this docs-only integration.
- The endpoint is compatible with OpenAlice's MIT-licensed codebase because it
  is consumed as an optional external service.
- OpenAlice's deterministic guard pipeline remains the execution authority.
- Runtime templates remain unchanged unless maintainers intentionally add the
  optional server to a specific workspace template later.
