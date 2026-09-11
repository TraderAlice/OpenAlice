# opencli registry discovery

The registry is the source of truth — never a hand-maintained site list.
This file covers the `opencli list -f json` schema and how to judge read vs
write. (Stable knowledge; command inventories themselves change weekly and
must always come from a live `opencli list`.)

## JSON entry schema

Each entry in `opencli list -f json` has roughly this shape:

```json
{
  "site": "yahoo-finance",
  "name": "quote",
  "aliases": [],
  "description": "Yahoo Finance stock quote",
  "strategy": "PUBLIC",
  "browser": false,
  "args": [
    { "name": "symbol", "type": "string", "required": true, "positional": true }
  ],
  "columns": ["symbol", "name", "price", "change", "changePercent", "volume"]
}
```

| Field | Meaning |
|---|---|
| `site` | Adapter namespace — first argument to `opencli <site> <command>` |
| `name` | Subcommand name (`aliases` lists alternatives) |
| `description` | Inspect before assuming read vs write |
| `strategy` | `PUBLIC` / `COOKIE` / `HEADER` / `INTERCEPT` / `UI` / `LOCAL` |
| `browser` | `true` if the command touches a browser target |
| `args` | Positional + flag arguments with types, defaults, help |
| `columns` | Canonical ordered output columns |

## Strategies — what each needs

| Strategy | Browser | Login | Latency |
|---|---|---|---|
| `PUBLIC` | No | No | Fast (plain HTTP) |
| `LOCAL` | No | No | Fast (local endpoint) |
| `COOKIE` | Yes | Yes | Fast (reuses the session cookie) |
| `HEADER` | Yes | Yes | Fast (captures one signed header) |
| `INTERCEPT` | Yes | Yes | Slow (opens an automation window) |
| `UI` | Yes | Yes | Slowest (scripts the DOM) |

Browser-backed strategies need Chrome logged into the target site plus the
OpenCLI extension from the
[Chrome Web Store](https://chromewebstore.google.com/detail/opencli/ildkmabpimmkaediidaifkhjpohdnifk).
`opencli doctor` verifies that bridge (daemon + extension + Chrome) — it is
NOT needed for `PUBLIC`/`LOCAL` adapters. Electron-app adapters (e.g.
`discord-app`, `chatgpt-app`) attach to the running desktop app over CDP —
the app must be running.

## Read vs write — how to tell

There is no formal `readonly` flag. Judge by:

1. **Name heuristics** — mutating verbs are writes. Never invoke: `post`,
   `reply`, `comment`, `like`, `unlike`, `upvote`, `downvote`, `save`,
   `unsave`, `subscribe`, `unsubscribe`, `follow`, `unfollow`, `block`,
   `unblock`, `delete`, `bookmark`, `unbookmark`, `send`, `create-draft`,
   `reply-dm`, `accept`, `hide-reply`.
2. **`description` field** — "fetch / read / get / list / search" → read;
   "post / send / submit / create" → write.
3. **Uncertain → don't run it.** Ask the user or skip.

## Discover → run, worked examples

```bash
# "read the front page of hackernews"
opencli hackernews --help
opencli hackernews top --limit 20 -f json

# "what's Xueqiu saying about BYD?"
opencli xueqiu --help
opencli xueqiu stock SZ002594 -f json
opencli xueqiu comments SZ002594 --limit 30 -f json

# "any unusual options flow on NVDA?"
opencli barchart --help
opencli barchart flow NVDA -f json
```

## Don'ts

- Don't paste a hand-maintained adapter list into a plan — it rots. Use live command help when selecting an adapter.
- Don't assume every adapter needs a browser — `strategy: PUBLIC` doesn't.
- `OPENCLI_DIAGNOSTIC=1` can help diagnose a failing adapter. Other available
  tools remain options for accessing the source.
- Don't invoke anything whose name or description suggests mutation.
