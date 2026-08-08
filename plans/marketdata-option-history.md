# MarketData Historical Option Chains

Status: completed

Owner guides: [[docs/market-data-architecture.md]], [[docs/workspace-agent-guidance.md]]

## Scope

- Add MarketData.app as the keyed provider for filtered historical equity-option chains.
- Expose the read through MCP and `traderhub options history`.
- Add the credential to Market Data settings without logging or persisting it elsewhere.
- Keep current execution quotes broker-owned; do not use MarketData for orders.

## Decisions

- Require date, expiration, side, and bounded strikes at the agent tool boundary to control credits.
- Reuse the existing `OptionsChains` model and derivatives client.
- Treat missing credentials, unavailable dates, authentication failures, and rate limits as distinct errors.

## Checklist

- [x] Provider, credentials, MCP/CLI tool, and settings UI
- [x] Focused tests and full required verification
- [x] Real CLI/MCP smoke with the missing-key failure contract

## Completion

OpenAlice can discover and invoke one filtered historical equity-option chain request through MCP/CLI, and the user can configure the provider token in Settings.
