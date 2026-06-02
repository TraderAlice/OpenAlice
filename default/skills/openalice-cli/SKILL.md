---
name: openalice-cli
description: >
  How to reach OpenAlice's market data from your shell via the `alice` CLI —
  news, market symbol search, equity fundamentals, macro/economy series, and
  technical indicators, as plain `alice <group> <verb> --flags` commands that
  print JSON. Use this whenever you need a number, a headline, a fundamental, or
  an indicator and this workspace exposes the `alice` command instead of (or
  alongside) the OpenAlice MCP tools: "look up AAPL", "find the symbol for
  bitcoin", "what's Apple's revenue", "search the news for the Fed", "compute
  RSI", "pull unemployment from FRED". Discover everything live with
  `alice --help` — do NOT guess flags.
---

# Using the `alice` CLI

`alice` is OpenAlice's market-data layer on your shell PATH. It talks to the
same backend the `openalice` MCP tools do — it's just the CLI front-end, handy
for piping, grepping, and quick scripted lookups. **Prefer it for data reads**
in this workspace.

## Discover, don't guess

The command tree and every flag are served live. Always start here rather than
guessing — the surface can change without this skill changing:

```bash
alice --help                  # list command groups
alice <group> --help          # list verbs in a group
alice <group> <verb> --help   # show a verb's flags (which are required)
```

## Shape

```
alice <group> <verb> [--flag value] [--flag=value]
```

- **Output is JSON on stdout.** Pipe it: `alice market search --query AAPL | jq '.results[0]'`.
- **A non-zero exit means it failed**; the error goes to stderr. Check it.
- Groups you'll typically see: `news`, `market`, `equity`, `economy`,
  `analysis`, `think` (confirm with `alice --help` — that's authoritative).

## Common workflows

**Find a symbol, then pull fundamentals:**

```bash
alice market search --query "apple"
alice equity profile --symbol AAPL
alice equity financials --symbol AAPL --type income --period annual --limit 5
```

**Scan news, then read one article by its stable id:**

```bash
alice news grep --pattern "interest rate" --lookback 2d
alice news read --id <id-from-the-results>
```

The `id` is stable — you do **not** need to repeat `--lookback` to read it.

**Macro and indicators:**

```bash
alice economy fred-search --query unemployment      # find the series id
alice economy fred-series --symbol UNRATE --limit 12
alice analysis indicator --asset equity --formula "RSI(CLOSE('AAPL','1d'),14)"
```

**Filter news by metadata** — `--meta` is repeatable and maps to the
metadata filter:

```bash
alice news grep --pattern BTC --meta source=coindesk --meta category=crypto
```

## What `alice` is NOT for

- **Trading and scheduling are not on the CLI** — placing/closing orders,
  cron, etc. stay on the OpenAlice MCP tools by design. If you need those and
  they aren't available here, say so rather than improvising.
- **Handing finished work back to the user** goes through the **inbox**
  (`inbox_push` MCP tool), not the CLI. `alice` is for reading data; the inbox
  is the outbound channel. Use each for its job.
