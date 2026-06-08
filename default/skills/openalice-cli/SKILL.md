---
name: openalice-cli
description: >
  How to reach OpenAlice from your shell via the `alice*` CLIs. Two binaries:
  `alice` for MARKET DATA (news, symbol search, equity fundamentals, macro/economy
  series, technical indicators) and `alice-workspace` for AGENT COLLABORATION
  (push finished work to the user's inbox, track entities). Both print JSON and
  are discoverable with `--help`. Use whenever you need a number/headline/
  fundamental/indicator, or want to hand work back to the user, and this
  workspace exposes the `alice*` commands instead of (or alongside) the OpenAlice
  MCP tools: "look up AAPL", "what's Apple's revenue", "search news for the Fed",
  "compute RSI", "push my findings to the inbox", "track this ticker". Discover
  everything live with `alice --help` / `alice-workspace --help` — do NOT guess flags.
---

# Using the `alice*` CLIs

OpenAlice exposes two CLIs on your shell PATH, split by what they touch. Both
talk to the same backend the `openalice` MCP tools do — they're the CLI
front-ends, handy for piping, grepping, and quick scripted use. **Prefer them in
this workspace** (especially if the MCP tools aren't reliably available to you).

| Binary | For | Groups |
|---|---|---|
| `alice` | **Market data** (read) | `news`, `market`, `equity`, `economy`, `analysis`, `think` |
| `alice-workspace` | **Agent collaboration** | `inbox`, `track` |

## Discover, don't guess

The command tree and every flag are served live, per binary. Always start here:

```bash
alice --help                       # market-data groups
alice <group> <verb> --help        # a verb's flags (which are required)
alice-workspace --help             # collaboration groups
alice-workspace <group> <verb> --help
```

## Shape

```
alice <group> <verb> [--flag value] [--flag=value]
alice-workspace <group> <verb> [--flag value]
```

- **Output is JSON on stdout.** Pipe it: `alice market search --query AAPL | jq '.results[0]'`.
- **A non-zero exit means it failed**; the error goes to stderr. Check it.

## Market data — `alice`

**Find a symbol, then pull fundamentals:**

```bash
alice market search --query "apple"
alice equity profile --symbol AAPL
alice equity financials --symbol AAPL --type income --period annual --limit 5
```

**Scan news, then read one article by its stable id** (the `id` is stable — you
do **not** need to repeat `--lookback` to read it):

```bash
alice news grep --pattern "interest rate" --lookback 2d
alice news read --id <id-from-the-results>
```

**Macro / indicators / metadata filters** (`--meta` is repeatable):

```bash
alice economy fred-series --symbol UNRATE --limit 12
alice analysis indicator --asset equity --formula "RSI(CLOSE('AAPL','1d'),14)"
alice news grep --pattern BTC --meta source=coindesk --meta category=crypto
```

## Collaboration — `alice-workspace`

**Hand finished work back to the user** — this is the outbound channel. It posts
to the user's Inbox tab:

```bash
alice-workspace inbox push --comments "Done — TSLA looks extended; details below."
```

(CLI `inbox push` is comment-only; to attach a rendered doc file, use the
`inbox_push` MCP tool's `docs` param instead.)

**Track entities** — the durable cross-workspace tracked index (`[[name]]`):

```bash
alice-workspace track search --query "uranium"
alice-workspace track add --name uranium-ccj --description "Cameco — uranium miner"
```

## What the CLIs are NOT for

- **Trading and scheduling are not on any CLI** — placing/closing orders, cron,
  etc. stay on the OpenAlice MCP tools by design (boundary review pending). If
  you need those and they aren't available here, say so rather than improvising.
