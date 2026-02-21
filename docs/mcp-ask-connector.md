# MCP Ask Connector

External agents can converse with Alice via a dedicated MCP server, without reducing Alice to a passive tool provider.

## Design Philosophy

1. **Alice stays autonomous** — External agents talk *to* Alice, not *through* her. Alice retains her own reasoning, memory, and decision-making. The caller is another conversation partner, not a puppet master.
2. **Isolated from tool MCP** — The Ask connector runs on a separate port from the main MCP server (which exposes internal tools). This prevents circular calls: Alice's own AI provider never discovers these tools because they are not registered in ToolCenter.
3. **Caller owns session identity, Alice owns storage** — The caller decides which session to use and when to start a new one. Alice persists conversation history, handles compaction, and maintains context across turns.
4. **Connector pattern** — The Ask connector is a first-class connector, identical in architecture to Telegram and Web. It registers with the ConnectorRegistry, records interactions via `touchInteraction()`, and participates in delivery routing.

## Architecture

```
External Agent (OpenClaw, etc.)
    │
    │  MCP protocol (Streamable HTTP)
    │  Port: askMcpPort (e.g. 3003)
    ▼
┌──────────────────────┐
│  MCP Ask Connector   │  ← Separate from main MCP server
│                      │
│  Tools:              │
│  - askWithSession    │  → engine.askWithSession()
│  - listSessions      │  → glob session files
│  - getSessionHistory │  → session.readActive()
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  Engine / AgentCenter │  ← Same AI pipeline as Telegram/Web
│  ProviderRouter       │
│  Session Store        │
└──────────────────────┘
```

**Separation from main MCP:**

| Server | Port | Purpose | Registered in ToolCenter? |
|--------|------|---------|---------------------------|
| Main MCP (`McpPlugin`) | `mcpPort` | Expose internal tools (trading, analysis, brain) | Yes |
| Ask MCP (`McpAskPlugin`) | `askMcpPort` | Expose conversation ability | No |

Because Ask tools are not in ToolCenter, Alice's AI provider (Vercel AI SDK or Claude Code) cannot see them. This structurally prevents circular invocation.

## Tools

### `askWithSession`

Send a message to Alice and receive a response within a persistent session.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `message` | string | yes | The message to send to Alice |
| `sessionId` | string | yes | Session identifier, managed by the caller |

**Returns:**

```json
{
  "text": "Alice's response...",
  "sessionId": "the-session-id"
}
```

**Behavior:**
- Creates a new session on first use of a `sessionId`, resumes on subsequent calls
- Routes through `engine.askWithSession()` — the same pipeline used by Telegram and Web
- Session history is persisted as JSONL in `data/sessions/mcp-ask__{sessionId}.jsonl`
- Automatic compaction applies when context grows large

### `listSessions`

List all sessions created through the Ask connector.

**Parameters:** none

**Returns:**

```json
{
  "sessions": [
    { "sessionId": "trading-analysis" },
    { "sessionId": "portfolio-review" }
  ]
}
```

### `getSessionHistory`

Read conversation history for a specific session.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `sessionId` | string | yes | Session identifier |
| `limit` | number | no | Max messages to return (default: 50) |

**Returns:**

```json
{
  "messages": [
    { "role": "user", "text": "What's the current BTC outlook?" },
    { "role": "assistant", "text": "Based on recent analysis..." }
  ]
}
```

## Configuration

Add `askMcpPort` to `data/config/engine.json`:

```json
{
  "pairs": ["BTC/USD", "ETH/USD"],
  "askMcpPort": 3003
}
```

The port is optional. When omitted, the Ask connector is not started.

You can also configure the port via the Web UI under **Settings > Connectivity > Ask MCP Port**.

## Session Management

Sessions are caller-managed (identity) and Alice-managed (storage):

- **Caller provides `sessionId`** — Can be any string. Use meaningful names (e.g. `"daily-review"`, `"risk-check"`) or generated UUIDs.
- **Alice persists on disk** — Each session is a JSONL file at `data/sessions/mcp-ask__{sessionId}.jsonl`, following the same format as Telegram and Web sessions.
- **Compaction applies** — Long sessions are automatically compacted (summarized) to stay within context limits.
- **No expiration** — Sessions persist indefinitely. The caller decides when to start fresh by using a new `sessionId`.

## File Inventory

```
src/
  connectors/
    mcp-ask/
      mcp-ask-plugin.ts    # MCP server, tool registration, session management
      index.ts              # Public export
data/
  sessions/
    mcp-ask__*.jsonl        # Per-session conversation history
```

## Example: OpenClaw Integration

An orchestration agent like OpenClaw can use the Ask connector to delegate trading decisions to Alice:

```
User → OpenClaw: "Should I buy more ETH?"
         │
         │  askWithSession({ message: "The user is asking about ETH. Current price is $3,200. What's your view?", sessionId: "user-123" })
         ▼
       Alice: "Based on the 4h RSI at 42 and declining volume, I'd wait for a pullback to $3,050 support..."
         │
         ▼
OpenClaw → User: "Alice suggests waiting for $3,050 support before adding. RSI is at 42 with declining volume."
```

Alice processes the question using her full toolkit (market data, indicators, position context, memory) and responds as an autonomous agent — not as a function returning a value.
