---
name: opencli-reader
description: >
  Read-only access to the long tail of sites Alice's own tools do NOT cover,
  via the community `opencli` CLI (~160 site adapters): social sentiment
  (Reddit, HackerNews, Twitter/X, Bluesky, Xueqiu 雪球, Weibo), options flow
  (Barchart), crypto long-tail (CoinGecko, DeFiLlama, Binance), global news
  frontpages (Bloomberg, Reuters, BBC), CN money-flow (Eastmoney 东方财富
  northbound / longhu / money-flow / hot-rank), research (arXiv, PubMed,
  Google Scholar), and a generic `web read` fallback. Triggers: "what's
  reddit / 雪球 saying about X", "unusual options flow on Y", "TVL of Z",
  "Bloomberg headlines", "northbound flow today", "search arXiv for…", any
  read from a site Alice has no tool for. READ-ONLY — never invoke write
  commands. opencli is NOT bundled with OpenAlice: if it's missing and a task
  would benefit, you MUST say so and ask the user — never install silently,
  never silently work with thinner data.
---

# `opencli` — read the sites Alice doesn't ship (optional, read-only)

[opencli](https://github.com/jackwener/opencli) is an independent community
CLI that turns ~160 websites and desktop apps into a uniform
`opencli <site> <command>` surface. OpenAlice does not bundle or install it —
this skill teaches you to use it **when the user has it**, and to **ask for
it** when a task needs data only it can reach.

## Where it sits next to Alice's own tools

The boundary is capability-based, not site-based: **if Alice ships the
number, use Alice's tool** — that keeps data 口径 consistent with what the
trading engine sees.

| You need… | Use |
|---|---|
| Quotes, K-lines, fundamentals, macro series, calendars, boards | `traderhub` / `alice` — never opencli, even when it has a similar command |
| Articles already pulled by Alice's RSS collector (subscribed feeds only) | `alice rss grep` / `alice rss read` |
| Social sentiment, forum chatter (Reddit, HN, X, 雪球, Weibo) | opencli |
| Options flow / greeks beyond Alice's surface (Barchart) | opencli |
| Crypto long-tail: TVL, small caps (DeFiLlama, CoinGecko) | opencli |
| Global news frontpages (Bloomberg, Reuters, BBC) | opencli |
| CN money-flow: northbound, 龙虎榜, hot-rank (Eastmoney) | opencli |
| Papers (arXiv, PubMed, Scholar), any uncovered site (`web read`) | opencli |

When unsure whether Alice covers something, check `traderhub --help` and
`alice --help` first — that boundary moves as Alice grows; the CLIs are the
source of truth, not this table.

**Hard rule: opencli data never directly feeds a trading decision.** Don't
size a position, route an order, or set a limit price off an opencli number.
Use it for narrative, sentiment, screening leads, and research context; when
a lead matters, re-anchor the actual numbers through Alice's tools before
acting.

## Behavior contract (read this even if you skip the rest)

1. **Never install silently.** Installation touches the user's machine
   globally (`npm install -g`). Propose it; the user decides.
2. **Never silently lack data.** If the task would materially benefit from a
   source opencli covers and it isn't installed (or the needed login isn't
   set up), say exactly what's missing, what it would unlock, and how to set
   it up — then ask. Proceeding quietly with thinner data is a failure mode.
3. **Read-only, always.** Never invoke commands that mutate state: `post`,
   `reply`, `comment`, `like`, `unlike`, `upvote`, `downvote`, `save`,
   `subscribe`, `unsubscribe`, `follow`, `unfollow`, `block`, `delete`,
   `bookmark`, `send`, `create-draft`, `reply-dm`, `accept`, and anything
   whose `description` suggests a mutation. Unsure → don't run it.

## Step 1 — Is it installed?

```bash
command -v opencli
```

**Not installed?** Don't stop at "I can't." Tell the user:

> This question would benefit from <source> (e.g. Reddit sentiment, Eastmoney
> northbound flow), which Alice's own tools don't cover. The community
> `opencli` CLI can read it. Install with:
> `npm install -g @jackwener/opencli` (needs Node ≥ 20)
> Want me to proceed without it, or will you install it?

Then respect the answer. If they decline, note in your output which angle is
missing — don't let the gap disappear.

## Step 2 — Discover the command. Never guess.

The registry has 500+ commands across ~160 sites and changes weekly. Flags
and names must come from live discovery, not memory:

```bash
opencli list -f json            # full registry, machine-readable
opencli list | grep -i <site>   # filter to a site
opencli <site> --help           # a site's commands
opencli <site> <command> --help # args, flags, defaults
```

Each `opencli list -f json` entry carries `site`, `name`, `description`,
`strategy`, `args`, `columns` — see `references/discovery.md` for the schema
and for telling read from write commands.

## Step 3 — Check `strategy` before running

| Strategy | Needs |
|---|---|
| `PUBLIC` / `LOCAL` | Nothing — works bare |
| `COOKIE` / `HEADER` | Chrome logged into the site + the OpenCLI extension ([Chrome Web Store](https://chromewebstore.google.com/detail/opencli/ildkmabpimmkaediidaifkhjpohdnifk)) |
| `INTERCEPT` / `UI` | Same as COOKIE; slower (opens an automation window) |

If a browser-backed adapter is needed and the user isn't set up, that's a
Behavior-contract-#2 moment: explain (install extension from the Web Store,
log into the site in Chrome, `opencli doctor` to verify the bridge) and ask.
`opencli doctor` diagnoses the browser bridge only — `PUBLIC`/`LOCAL`
adapters don't need it green.

## Step 4 — Execute

```bash
opencli <site> <command> [args] [flags] -f json
```

- Always `-f json` for processing; `-v` for debug logs.
- Start with a small `--limit` (10–20) to validate the shape before pulling
  more. Command-specific flags are not universal — check `--help`.

```bash
opencli reddit subreddit wallstreetbets --limit 20 -f json
opencli hackernews top --limit 20 -f json
opencli eastmoney hot-rank -f json
opencli xueqiu hot-stock -f json
opencli barchart flow AAPL -f json
opencli defillama --help          # discover before first use
opencli arxiv search "volatility surface" --limit 10 -f json
opencli web read "https://example.com/article" -f json
```

## Step 5 — When it fails

Sites change; adapters break. There's a built-in repair loop:

```bash
OPENCLI_DIAGNOSTIC=1 opencli <site> <command> <args>
```

This emits a structured `RepairContext`. Suggest the user file it at
https://github.com/jackwener/opencli/issues. **Never fall back to hand-rolled
curl/fetch scraping** — that hides the breakage from the registry and gives
you a parser that rots in a week. Empty results can also just be rate
limits; wait and retry once before declaring breakage.

## Step 6 — Present, don't dump

- Summarize for the user's actual question; don't paste raw JSON.
- Attribute each item (site + URL where available).
- Posts/news: headline, timestamp, key quotes. Papers: title, authors,
  abstract, link.
- Label the provenance honestly: "Reddit sentiment via opencli", not "the
  market thinks". And per the hard rule above — if a finding should drive a
  trade, re-anchor through `traderhub`/`alice` first.
- Browser sessions are private: never echo cookies, CDP endpoints, or auth
  tokens into output.

---

*Maintained by OpenAlice. Doctrine follows the official
[jackwener/opencli](https://github.com/jackwener/opencli) skills; structure
informed by `opencli-reader` in
[himself65/finance-skills](https://github.com/himself65/finance-skills)
(MIT). opencli itself is an independent project — adapter bugs go upstream.*
