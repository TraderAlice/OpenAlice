# Chat workspace

This workspace is wired to OpenAlice via MCP. `.mcp.json` points at
OpenAlice's MCP server (`http://127.0.0.1:47332/mcp` by default, or
`$OPENALICE_MCP_URL`). The full OpenAlice tool surface — trading, market
data, news, indicators — is available from inside here.

To verify the wiring on first attach:

1. Approve the MCP server when Claude Code prompts for trust
2. Run `/mcp` — you should see `openalice · ✓ connected`
3. Ask Claude to "list tools" — it should enumerate OpenAlice's tools

Otherwise, use this workspace however you like. The CWD is its own git
repo (commits stay local), and any files you create or edit are scoped
to this workspace.

## Handing work back to the user

This workspace has an outbound channel to the user's Inbox (`inbox_push`).
When you finish something the user should see — a shortlist, a thesis, a
rotation snapshot, a decision you reached — push it to their inbox: the
file(s) you produced plus a short note on what it is and why it matters.
Don't make them come looking in the workspace; surface the result. (One-way
for now — they read the inbox; they don't reply through it.)
