# Optional tool: invinoveritas `/review` (advisory pre-trade second opinion)

> **Status: optional, opt-in, advisory only.** This is a third-party paid MCP server.
> OpenAlice's deterministic guard pipeline (size, cooldown, whitelist) remains the
> **authoritative** layer for execution safety. `/review` only adds a structured
> second-opinion *before* the irreversible order push — it never replaces a guard and
> never gates execution on its own.

## What it adds

invinoveritas exposes a Lightning-paid MCP server that returns a structured second-opinion
verdict on a proposed trade — on the *same* proposal your guard pipeline already evaluates:

- **Verdict**: `approve | approve_with_concerns | reject`
- **Ranked issues** (position size vs equity, drawdown exposure, regime durability, fee-adjusted edge)
- **Confidence score**

It's the same gate the maintainer's own live trading bot passes on every entry. Use it as an
extra, advisory opinion in front of the guard pipeline — not as a replacement for it.

## Where it fits in the guard pipeline

```
proposal
   │
   ▼
deterministic guards (size, cooldown, whitelist)   ← AUTHORITATIVE (unchanged)
   │
   ├─(optional)─►  invinoveritas /review  ──►  advisory verdict + issues + confidence
   │                                            (logged; does NOT block on its own)
   ▼
order push
```

If `/review` is unreachable, errors, or is not configured, the pipeline behaves exactly as it
does today — the optional call is fail-open by design.

## MCP entry (env-based, no secrets in `mcp.json`)

The Bearer token is read from the environment; it is **never** committed to `mcp.json`:

```jsonc
{
  "mcpServers": {
    "invinoveritas": {
      "url": "https://api.babyblueviper.com/mcp",
      "transport": "http",
      "headers": { "Authorization": "Bearer ${INVINOVERITAS_KEY}" }
    }
  }
}
```

```bash
# Provide the key at runtime only — keep it out of version control.
export INVINOVERITAS_KEY="ivv_..."   # free to register; see below
```

Get a key: `POST https://api.babyblueviper.com/register` (free, instant, no signup form). Fund
the balance with Lightning, USDC (x402 on Base), or card before paid calls.

## Example call

```bash
curl -s -X POST https://api.babyblueviper.com/review/external \
  -H "Authorization: Bearer $INVINOVERITAS_KEY" \
  -H "Content-Type: application/json" \
  -d '{
        "subject": "trade_plan",
        "content": "Long 0.4 BTC at 67,500, stop 65,800, target 71,000; account equity 1.9 BTC; regime=expansion"
      }'
# → { "verdict": "approve_with_concerns",
#     "issues": ["position is ~21% of equity — above a 10% per-trade guideline", ...],
#     "confidence": 0.74 }
```

## No-secrets acceptance checklist

- [x] No secrets in `mcp.json` — Bearer token supplied via `INVINOVERITAS_KEY` env var only
- [x] **Advisory only** — OpenAlice's deterministic guards stay authoritative; `/review` cannot block or push orders
- [x] **Opt-in** — nothing changes unless a maintainer adds the MCP entry; stock `chat` / `finance-research` configs are untouched
- [x] **Fail-open** — if the endpoint is down or unconfigured, the pipeline runs exactly as today
- [x] No telemetry, no required signup, no data retained beyond a redacted audit hash
- [x] Endpoint is opt-in and usable under OpenAlice's existing license terms

## Pricing (honest)

`/review/external` is a paid call (on the order of a few hundred sats; see live
`GET https://api.babyblueviper.com/prices` for the current number). Registration and the
balance check are free. There is no subscription and no minimum — you pay per call only when
you choose to make one.

---

*Maintainers: this doc intentionally leaves the stock templates unchanged. If you'd like the
optional paid tool discoverable in a template, that can be a separate, clearly-scoped follow-up
so the optional-paid-tool boundary stays explicit.*
