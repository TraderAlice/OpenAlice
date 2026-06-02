---
version: 0.1.0
---

# Chat (CLI) — experimental

A variant of the **Chat** workspace that routes OpenAlice's market/data tools through the `alice` CLI (on the shell PATH) instead of MCP. The Inbox outbound channel stays on MCP.

## What's different from Chat

- **Tools:** reached via `alice <group> <verb> --flags` (JSON on stdout), documented by the bundled `openalice-cli` skill — not the `openalice` MCP tool server.
- **Inbox:** unchanged — `inbox_push` over MCP (`openalice-workspace`), so the agent can still hand finished work back to you.
- **Skills:** `openalice-cli` plus the same tool-agnostic research skills as Chat (`scan-value-chain`, `build-thesis`, `sector-rotation`).

## Why this exists

A testbed for the CLI context-injection mode (`injectMcp: "inbox"` in `template.json`). The agent runtimes inside a workspace are unix-CLI-native; this validates that they can do real market/data work through the `alice` CLI while keeping the stateful inbox channel on MCP. If it proves out, the same mode can be offered more broadly — and it generalizes to any future agent runtime with a shell, with no per-runtime MCP wiring.

## When to spawn this

- You want to dogfood / compare the CLI tool path against the MCP path.
- You're fine with trading and scheduling being unavailable here (they stay MCP-only and are not wired into this template).
