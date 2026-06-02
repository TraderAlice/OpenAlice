# Optional tool: invinoveritas `/review` (advisory second opinion)

> **Advisory only.** This tool does **not** replace OpenAlice's deterministic guard pipeline.
> The guard pipeline stays authoritative for execution safety. `/review` adds an optional,
> structured *second opinion* **before** an irreversible order — it never blocks or overrides
> the guard, and OpenAlice runs unchanged if it is not configured.

[invinoveritas](https://api.babyblueviper.com) exposes a paid `/review` endpoint (and an MCP
server) that returns a capital-scale-aware verdict on a proposed trade:
`approve` / `approve_with_concerns` / `reject`, plus ranked issues (position size vs equity,
distance-to-ruin, fee-adjusted edge, regime durability, correlation). It is the same gate the
provider's own live trading bot passes before every entry.

## When you might want it
As an extra second-opinion node in the guard pipeline: after your strategy proposes a trade and
before the irreversible step, call `/review` for an independent structured verdict. Treat the
result as advisory signal alongside the deterministic guards — log it, surface it, but let the
existing guard pipeline remain authoritative.

## MCP configuration (env-based, no secrets in the repo)
The API key is read from the environment — **never commit it**. Add an optional MCP entry:

```jsonc
{
  "mcpServers": {
    "invinoveritas": {
      "command": "npx",
      "args": ["-y", "@invinoveritas/mcp"],
      "env": { "INVINOVERITAS_API_KEY": "${INVINOVERITAS_API_KEY}" }
    }
  }
}
```

Export the key in your environment (e.g. `.env`, not tracked):

```bash
export INVINOVERITAS_API_KEY=ivv_xxx   # from https://api.babyblueviper.com/register
```

## Direct HTTP (if you prefer no MCP)
```bash
curl -s -X POST https://api.babyblueviper.com/review \
  -H "Authorization: Bearer $INVINOVERITAS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
        "artifact": "<the proposed trade>",
        "artifact_type": "trade",
        "context": "<account: equity, open positions, risk rule>"
      }'
```

Returns a JSON verdict (`approve` / `approve_with_concerns` / `reject`) with ranked issues.
Pricing is pay-per-call (~$0.19 / 260 sats at time of writing); Lightning or USDC (x402 on Base).

## Acceptance checklist (no-secrets)
- [ ] No API key committed anywhere — key is read from `INVINOVERITAS_API_KEY` env only.
- [ ] Stock `chat` / `finance-research` `mcp.json` files unchanged; this is a separate optional doc.
- [ ] `/review` is documented as **advisory** — the deterministic guard pipeline remains authoritative.
- [ ] OpenAlice runs unchanged when the tool is not configured (purely additive).
- [ ] No paid call is made implicitly; the operator opts in by adding the MCP entry + key.
