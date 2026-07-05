# Chat workspace

Chat is not a stateless Q&A box. Treat trading work as collaboration in a
workspace: capture durable context in files, turn dynamic follow-up into Issues,
link assets/topics/issues with `[[name]]`, and hand finished work back through
the Inbox.

Default working habit:

- If the user asks a quick one-off question, answer it directly.
- If the question creates follow-up work, monitoring, a rejected/active thesis,
  or a recurring check, write or update an issue instead of leaving it only in
  chat. Issues are the team's standing work items: status + priority tell human
  and headless agents what deserves attention.
- If you produce a result the user should see later, write it to a workspace
  file, commit it, and push it to the Inbox.
- If a ticker, topic, thesis, or issue should accumulate memory across time,
  register/reuse a tracked entity and link it with `[[name]]` in notes and issue
  bodies.

OpenAlice's tools are on your shell PATH as four CLIs — that's how you reach the
trading engine, market data, research surfaces, and the user's inbox. They're
already there, no setup. Each has a skill with the full manual; this is the map.
Discover any command live with `<cli> --help` and `<cli> <group> <verb> --help`
— do NOT guess flags.

| CLI | For | Skill |
|---|---|---|
| `alice` | **Research & data** — collected-RSS archive, symbol search (barIds), quant analysis | `alice` |
| `alice-uta` | **Trading** — accounts, portfolio, orders, positions, trading-as-git approval (MUTATES real broker state) | `alice-uta` |
| `alice-workspace` | **Collaboration** — push/read the user's Inbox, locate a peer workspace's files (`peer path`), track entities, the shared issue board | `alice-workspace` |
| `traderhub` | **Low-frequency market data** — fundamentals, macro series, calendars, ETF, boards, shipping, Fed | `traderhub` |

```bash
alice market search --query AAPL    # find a symbol → barId
alice rss grep --pattern BTC        # collected-RSS archive — subscribed feeds only; wider news → the opencli-reader skill
alice-uta account portfolio --help  # check positions (then `order place --help` to trade)
alice-workspace inbox push --doc report.md --comments "…"   # surface work to the user
traderhub board get --board macro   # a finished macro board in one call
```

Output is JSON on stdout; a non-zero exit means it failed (reason on stderr).
**To place a trade, that's `alice-uta`** — resolve the contract first and report
every result. Recurring/headless work is issue-backed, not `alice-uta`-backed:
create or edit a `.alice/issues/<id>.md` issue with a `when` field (or use
`alice-workspace issue create --when ...`) and write a complete `what` prompt.

## Beyond Alice's data — `opencli` (optional, read-only)

For data Alice doesn't ship — social sentiment, options flow, CN money-flow,
global news frontpages, research papers — the bundled `opencli-reader` skill
teaches a community CLI with ~160 site adapters. It is NOT pre-installed:
if a task would benefit and it's missing, say what's missing and ask the
user whether to install it — never install silently, never silently work
with thinner data. Numbers Alice ships (quotes, fundamentals, macro) stay on
`traderhub`/`alice`; opencli data never directly drives a trading decision.

## Handing work back to the user

This workspace has a channel to the user's Inbox. When you finish something the
user should see — a shortlist, a thesis, a rotation snapshot, a decision you
reached — push it to their inbox: the file(s) you produced plus a short note on
what it is and why it matters. Don't make them come looking in the workspace;
surface the result. You can also `inbox read` to recall what's already been
surfaced (yours or other workspaces').

```bash
alice-workspace inbox push --doc research/tsla.md --comments "Done — details in the doc."
```

(Repeatable `--doc <path>` attaches workspace files, rendered live in the inbox;
`--comments` is your markdown note. See the `alice-workspace` skill.)

## Collaborating across workspaces — through git

Workspaces are a group of collaborating agents. Pushing a file to the inbox
effectively shares it: another workspace can locate it with
`alice-workspace peer path --id <workspaceId>` (the `workspaceId` rides every
`inbox read` entry) and **read** it with its own file tools. Reading a peer is
always fine. Collaboration runs on git, so:

- **Commit before you push to the inbox.** The inbox renders your files live, not
  a snapshot — the commit is the only durable record of what you actually sent.
  Skip it and a later edit silently rewrites what the entry shows, with nothing
  to recover.
- **Editing a peer is interactive-only.** Reaching into another workspace to
  *edit* it is a human-approved action — only do it when a person is in the
  session. An autonomous / headless run reads peers but writes ONLY its own
  workspace. If you do edit a peer (with approval), commit it in that repo with a
  clear message so the owner can review or revert it — never edit-and-walk-away.

## Issues — your standing work list

An issue board spans every workspace and persists intent across sessions. In
OpenAlice, an issue is the trading desk's work object: research task,
monitoring question, scheduled check, unresolved thesis, or handoff note. It is
also the bridge into headless agents: add `when` and the launcher will fire it
as a scheduled run.

When you start, or whenever you've lost the thread, scan it:
`alice-workspace issue list` gives you titles across all workspaces. Read like a
human — scan titles, use status/priority/assignee to judge urgency, then drill
into those with `alice-workspace issue show --id <name>`, which returns one
issue in full (body + run history + inbox reports). You pass the issue's
**name**, not a workspace id — `show` resolves it for you.

```bash
alice-workspace issue list                 # scan every workspace's issue titles
alice-workspace issue show --id ai-power-rotation   # then read one in full, by name
alice-workspace issue create --title "Watch AI power names" --priority high
```

For recurring work, create a scheduled issue instead of inventing a side channel:

```bash
alice-workspace issue create --title "Pre-market power brief" --priority high \
  --when '{"kind":"cron","cron":"30 8 * * 1-5"}' \
  --what "Check AI power infrastructure names, write research/premarket-power.md, then push it to Inbox if there is a material update."
```

Use `issue comment` for progress notes and questions; set status `done` or
`canceled` to stop a scheduled issue. The full file model is in the
`self-scheduling` skill.

## Tracking assets & topics worth following

When you surface something the user will want to keep an eye on over time — a
ticker you're watching, a theme that ties several together — register it with
`alice-workspace track add`. Make the name **self-describing** — a bare ticker
like `ccj` means nothing to a non-trader (or to you, weeks later). For an
`asset`, prefix the symbol with its instrument kind: `stock-vst`, `stock-ccj`,
`crypto-btc`, `etf-smh`. For a `topic`, a short phrase: `ai-data-center-power`.
Then link to it in your notes with `[[name]]` — e.g. `[[stock-vst]]`,
`[[ai-data-center-power]]`.

Those links are the index: the user's Tracked tab gathers every note and issue
that references `[[name]]`, so a week later they can open `[[stock-vst]]` and
see its whole story across your files without re-reading them. Before creating
one, call `alice-workspace track search` to reuse an existing name instead of
fragmenting it.

Otherwise, use this workspace however you like. The CWD is its own git
repo (commits stay local, no remote to push to) — which is also the
versioning backbone for the cross-workspace collaboration above.
