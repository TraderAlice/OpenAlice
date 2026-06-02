# Chat (CLI) workspace

This is an **experimental** chat workspace. It's like the standard Chat
workspace, except OpenAlice's market/data tools are reached through the
**`alice` CLI on your shell PATH**, not through MCP. The Inbox stays on MCP
(see below).

## Reaching OpenAlice data — use the `alice` CLI

Market symbol search, news, equity fundamentals, macro/economy series, and
technical indicators are all available as `alice <group> <verb> --flags`
commands that print JSON. The bundled **openalice-cli** skill is the full
playbook; the short version:

```bash
alice --help                       # list command groups
alice market search --query AAPL   # find a symbol
alice equity financials --symbol AAPL --type income
alice news grep --pattern BTC      # search collected news, then…
alice news read --id <id>          # …read one article by its stable id
```

Output is JSON on stdout; a non-zero exit means it failed. Don't guess flags —
run `alice <group> <verb> --help`. There is **no `openalice` MCP tool server**
in this workspace; `alice` is how you read data here.

(Trading and scheduling are not on the CLI and are not wired here — if a task
needs them, say so rather than improvising.)

## Handing work back to the user — the Inbox (still MCP)

This workspace keeps the outbound Inbox channel (`inbox_push` MCP tool) — run
`/mcp` and you should see `openalice-workspace · ✓ connected`. When you finish
something the user should see — a shortlist, a thesis, a rotation snapshot, a
decision you reached — push it to their inbox: the file(s) you produced plus a
short note on what it is and why it matters. Don't make them come looking in the
workspace; surface the result. (One-way for now — they read the inbox; they
don't reply through it.)

Otherwise, use this workspace however you like. The CWD is its own git repo
(commits stay local), and any files you create or edit are scoped to this
workspace.
