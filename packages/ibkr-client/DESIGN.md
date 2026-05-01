# IBKR TWS API TypeScript Port — Design Notes

This document captures the exploration, decisions, and trade-offs made during the development of `@traderalice/ibkr`. If you're wondering "why is it done this way?", this is where to look.

## Background

OpenAlice needed IBKR trading support. The Unified Trading Account system was already designed in IBKR's style, so the data model was a natural fit. The question was how to connect.

## Evaluating Connection Options

### Option 1: `@stoqey/ib` (community npm package)

A community TypeScript implementation of the TWS socket protocol.

- **Pros**: Ready to use, npm install and go.
- **Cons**: 340 GitHub stars at the time of evaluation. OpenAlice itself had 1100+. Depending on a smaller project for a critical path (real-money trading) was deemed too risky. Supply chain concerns: single maintainer, infrequent updates, unclear maintenance commitment.

**Decision**: Rejected due to supply chain risk.

### Option 2: Client Portal REST API

IBKR provides a separate REST gateway (Client Portal) that exposes JSON endpoints on localhost.

- **Pros**: Zero dependencies, just `fetch()`. Simple to implement.
- **Cons**: Requires running an additional Java process (separate from IB Gateway/TWS). Session timeout requires periodic `/tickle` keepalive. Feature coverage is a subset of the full TWS API. SSL certificate handling is awkward (self-signed certs).

**Decision**: Considered as a pragmatic fallback, but ultimately not chosen because the full TWS API port turned out to be feasible.

### Option 3: Self-built TWS socket protocol

Port the official IBKR client directly to TypeScript. The official distribution includes clients in Java, Python, and C++ — all implementing the same wire protocol.

- **Pros**: Zero third-party dependencies. Full feature coverage. Complete control. Can be verified against official source line-by-line.
- **Cons**: Significant upfront work. Need to understand the protocol. Ongoing maintenance when IBKR updates.

**Decision**: Chosen. The official Python client was selected as the translation source because Python → TypeScript is the shortest translation distance.

## Understanding the Official Distribution

The TWS API is distributed as a zip file from `interactivebrokers.github.io`. It contains:

```
IBJts/
├── source/
│   ├── proto/           # 203 .proto files — THE protocol source of truth
│   ├── pythonclient/    # Python client implementation
│   ├── JavaClient/      # Java client (original, 244k lines)
│   └── cppclient/       # C++ client
└── samples/             # Usage examples per language
```

Key discovery: the `.proto` files are the canonical protocol definition. All language clients are generated from or aligned with these protos. IBKR distributes compiled `_pb2.py` files but also includes the raw `.proto` source — this meant we could auto-generate TypeScript protobuf bindings.

### The dual protocol

TWS API v10.44 supports two wire formats:

1. **Legacy text protocol**: `\0`-delimited string fields, position-based. Used for 20+ years. Every field must be sent in exact order. New fields can only be appended. Version-gated with `if serverVersion >= MIN_SERVER_VER_XXX`.

2. **Protobuf protocol** (v201+): Self-describing, field-number-based. Added starting with server version 201. Each message type has its own `.proto` definition. Backward-compatible by design.

The client negotiates a version range at handshake. Modern TWS (v222) responds with protobuf for most messages. The protocol offset is simple: protobuf message IDs = text message ID + 200.

## Translation Strategy

### Source selection

Python was chosen over Java because:
- Python → TypeScript translation distance is shorter (both dynamic, similar syntax)
- Python client is 17.5k lines vs Java's 244k lines (Java is extremely verbose)
- Python is the most readable reference for protocol details

### File structure: mirror then modularize

Initial plan was to mirror the Python file structure 1:1. This worked well for data models and constants. But `client.py` (7,502 lines) and `decoder.py` (2,971 lines) were too large for AI-assisted development — agents would hit output token limits trying to translate them in one shot.

**Solution**: Split by message category.

```
Python                    TypeScript
client.py (7502 lines) →  client/base.ts + market-data.ts + orders.ts + account.ts + historical.ts
decoder.py (2971 lines) → decoder/base.ts + market-data.ts + orders.ts + account.ts + contract.ts + execution.ts + historical.ts + misc.ts
```

Each file stays under 500 lines. This is not just an AI constraint — it's better architecture. Changes to market data handling don't require reading order logic.

### Mixin pattern for client methods

Python's `EClient` is a single class with 100+ methods. In TypeScript, these are split across files using prototype extension:

```typescript
// client/market-data.ts
export function applyMarketData(Client: typeof EClient): void {
  Client.prototype.reqMktData = function(this: EClient, ...) { ... }
}

// client/index.ts
applyMarketData(EClient)
applyOrders(EClient)
applyAccount(EClient)
applyHistorical(EClient)
```

### Handler registration for decoder

Similarly, the decoder uses a registration pattern:

```typescript
// decoder/market-data.ts
export function applyMarketDataHandlers(decoder: Decoder): void {
  decoder.registerText(IN.TICK_PRICE, (d, fields) => { ... })
  decoder.registerProto(IN.TICK_PRICE, (d, buf) => { ... })
}
```

Each handler file registers both text and protobuf handlers for its message category.

## Key Adaptations from Python

### Threading → Event loop

Python uses a background thread (`EReader`) to read from the socket and put messages into a `queue.Queue`. The main thread polls the queue in `client.run()`.

Node.js doesn't need this. Instead:
- `socket.on('data')` accumulates bytes
- Complete frames are extracted via `readMsg()`
- Messages are dispatched directly to the decoder
- No threads, no queue

### `struct.pack/unpack` → `Buffer`

Python: `struct.pack("!I", size)` / `struct.unpack("!I", buf[0:4])`
TypeScript: `buf.writeUInt32BE(size)` / `buf.readUInt32BE(0)`

### `next(fields)` iterator → typed decode functions

Python uses a generic `decode(the_type, fields)` that calls `next()` on an iterator and converts based on type. TypeScript uses separate typed functions:

```typescript
decodeStr(fields)      // → string
decodeInt(fields)      // → number
decodeFloat(fields)    // → number
decodeBool(fields)     // → boolean
decodeDecimal(fields)  // → Decimal
```

### Protobuf bindings

Python's `_pb2.py` files are generated by `protoc --python_out`. We use `ts-proto` (`protoc --ts_proto_out`) to generate TypeScript equivalents from the same `.proto` files. The generated API:

```typescript
const proto = CurrentTimeProto.decode(buf)  // Uint8Array → typed object
proto.currentTime  // number | undefined
```

## Testing Strategy

### Unit tests (`.spec.ts`)

Ported from the official Python tests (which were very thin — 447 lines total, mostly `print()` statements). We expanded significantly:

- `comm.spec.ts` — Encode/decode round-trips (from Python's `test_comm.py`)
- `utils.spec.ts` — Decode functions, formatting, validation
- `models.spec.ts` — Data model construction and defaults
- `order-condition.spec.ts` — Condition hierarchy + encode/decode round-trip
- `protobuf-decode.spec.ts` — Protobuf message parsing → wrapper callback verification

### E2E tests (`.e2e.spec.ts`)

Integration tests against a live TWS/IB Gateway instance:

- `connect.e2e.spec.ts` — Handshake, server version, nextValidId, managedAccounts, currentTime
- `contract-details.e2e.spec.ts` — reqContractDetails("AAPL") full round-trip

All e2e tests share a single TWS connection via `tests/e2e/setup.ts`. If TWS is not running, tests skip automatically (checked via TCP probe). This means `pnpm test` always succeeds regardless of environment.

## What's not implemented

### Protobuf request encoding (`client_utils.py`)

The client currently sends all requests using the text protocol. TWS accepts this even at v222 — it's backward compatible. The protobuf request path (`client_utils.py` / `createXxxRequestProto()`) is not yet translated. This means we send text, receive protobuf. It works, but is slightly less efficient than pure protobuf.

### `sync_wrapper.py`

Python's synchronous wrapper (threading.Event-based request/response correlation) was not ported. Alice's adapter layer (`IbkrAccount`) will implement its own Promise-based equivalent.

## Reference

- Official TWS API: https://interactivebrokers.github.io/
- Proto files: `ref/source/proto/*.proto`
- Python client: `ref/source/pythonclient/ibapi/`
- Python samples: `ref/samples/Python/Testbed/`
