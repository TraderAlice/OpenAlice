# Finance Research workspace

This workspace bundles **[himself65/finance-skills](https://github.com/himself65/finance-skills)** — a community SKILL.md collection by [@himself65](https://github.com/himself65) (面包) covering market data, valuation, earnings analysis, options payoff, and social/research feeds.

## How it's wired

Bootstrap clones the upstream finance-skills repo (latest `main`) into `./.finance-skills/` and copies each SKILL.md tree into:

- `.claude/skills/<name>/` — discovered automatically by **Claude Code** when launched here
- `.agents/skills/<name>/` — discovered automatically by **Codex** (per [developers.openai.com/codex/skills](https://developers.openai.com/codex/skills))

No global install, no marketplace registration, no `~/.claude/plugins/` writes. SKILL.md is a discovery format — files in well-known directories Just Work for both agents.

## What's installed

From three of the upstream plugin packs (skipping the ones off-scope for trading):

- **finance-market-analysis** → `yfinance-data`, `company-valuation`, `earnings-preview`, `earnings-recap`, `estimate-analysis`, `etf-premium`, `options-payoff`, `saas-valuation-compression`, `sepa-strategy`, `stock-correlation`, `stock-liquidity`
- **finance-social-readers** → `discord-reader`, `linkedin-reader`, `opencli-reader`, `telegram-reader`, `twitter-reader`, `yc-reader`
- **finance-data-providers** → `finance-sentiment`, `funda-data`, `hormuz-strait`, `tradingview-reader`

See `.openalice-finance-info` for the exact upstream commit and the actual list of skills installed for this workspace.

## Two data layers — when to use which

This workspace gives you **two market-data surfaces** that overlap. Use them deliberately:

1. **OpenAlice's own MCP tools** (`/mcp` → `openalice`) — quotes, fundamentals, indicators, news. These are the **Alice canonical layer** wired to FMP / typebb / OpenBB. **Use these when a number will inform a trading decision** (UTA, position sizing, order routing) so the data口径 stays consistent with what Alice's trading engine sees.
2. **finance-skills** — yfinance, Funda AI, opencli, social readers. **Use these to cover angles Alice doesn't ship** (Yahoo Finance historical depth, SaaS valuation compression, social sentiment, peer-screened correlation studies, etc.).

Don't cross the streams: don't quote yfinance to make a UTA order routing call. Don't quote Alice's MCP to do a Twitter sentiment scan.

## MCP wiring

`.mcp.json` points at OpenAlice's MCP server (`http://127.0.0.1:47332/mcp` by default, or `$OPENALICE_MCP_URL`). The full OpenAlice tool surface — trading, market data, news, indicators — is available alongside the bundled skills.

The same **Alice canonical layer** is also on your shell PATH as the `alice` CLI (`alice --help`, `alice market search --query AAPL`, `alice news grep --pattern …` → `alice news read --id …`). Use it for quick scripted lookups — it's the same data口径 as the `openalice` MCP tools (trading/cron stay MCP-only).

To verify on first attach:

1. Approve the MCP server when Claude Code / Codex prompts for trust
2. Run `/mcp` — you should see `openalice · ✓ connected`
3. Run `/skills` — you should see the bundled finance skills alongside any built-in ones

## Upstream relationship

`himself65/finance-skills` is an independent open-source project. We clone fresh from upstream on each new workspace creation — that gives the author visible GitHub traffic and ensures you always get their latest. We do not fork, mirror, or modify upstream. If a skill behaves unexpectedly, file the issue at the upstream repo, not OpenAlice.

## Recovery (if bootstrap missed any skills)

If `.openalice-finance-info` shows `skillsFailed: ...` (e.g. the clone failed), re-run the copy manually:

```bash
cd <this workspace>
git clone --depth=1 https://github.com/himself65/finance-skills.git .finance-skills
mkdir -p .claude/skills .agents/skills
for plugin in market-analysis social-readers data-providers; do
  for skill in .finance-skills/plugins/$plugin/skills/*/; do
    name=$(basename "$skill")
    cp -R "$skill" ".claude/skills/$name"
    cp -R "$skill" ".agents/skills/$name"
  done
done
```

Then your next `claude` / `codex` session in this dir picks them up — no restart of OpenAlice needed.
