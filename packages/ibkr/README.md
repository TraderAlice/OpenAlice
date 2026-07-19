# @traderalice/ibkr

TypeScript port of the official IBKR TWS API v10.44.01.

Translated from the [official Python client](https://interactivebrokers.github.io/) — not a wrapper around a third-party library. Zero supply chain risk.

## Quick Start

```typescript
import { EClient, DefaultEWrapper, Contract } from '@traderalice/ibkr'

class MyWrapper extends DefaultEWrapper {
  currentTime(time: number) {
    console.log('Server time:', new Date(time * 1000))
  }
  contractDetails(reqId: number, details: ContractDetails) {
    console.log(details.contract.symbol, details.longName)
  }
}

const client = new EClient(new MyWrapper())
await client.connect('127.0.0.1', 7497, 0) // paper trading

client.reqCurrentTime()

const contract = new Contract()
contract.symbol = 'AAPL'
contract.secType = 'STK'
contract.exchange = 'SMART'
contract.currency = 'USD'
client.reqContractDetails(1, contract)
```

## Architecture

```
EClient  ──send──►  TWS/IB Gateway  ──respond──►  Decoder  ──call──►  EWrapper
(requests)          (localhost TCP)                (parse)             (callbacks)
```

**EClient** encodes and sends requests. **Decoder** parses responses (text or protobuf) and calls methods on your **EWrapper** implementation. You override only the callbacks you care about.

### Dual Protocol

Current TWS/Gateway versions can mix protobuf messages with the text protocol
(`\0`-delimited fields); older versions use text only. Both paths are
implemented and selected from the negotiated server version and message id.

The message id is a wire-envelope field and is removed by `EClient` before a
text payload reaches `Decoder.interpret()`. Decoder handlers begin at the first
payload field; they must not read or reconstruct the message id. See the
[IBKR wire protocol owner guide](../../docs/ibkr-wire-protocol.md) before
changing framing or text handlers.

## Project Structure

```
src/
├── client/                  # EClient — request encoding
│   ├── base.ts              # Connection, handshake, sendMsg
│   ├── encode.ts            # Shared contract field serialization
│   ├── market-data.ts       # reqMktData, reqTickByTick, etc.
│   ├── orders.ts            # placeOrder, cancelOrder, reqOpenOrders
│   ├── account.ts           # reqAccountSummary, reqPositions, reqPnL
│   ├── historical.ts        # reqHistoricalData, reqScanner, reqNews
│   └── index.ts             # Assembles mixins onto EClient
│
├── decoder/                 # Decoder — response parsing
│   ├── base.ts              # Decoder class, interpret(), processProtoBuf()
│   ├── market-data.ts       # Tick, depth, market data type handlers
│   ├── orders.ts            # Order status, open/completed order handlers
│   ├── account.ts           # Account, position, PnL handlers
│   ├── contract.ts          # Contract details, symbol samples handlers
│   ├── execution.ts         # Execution, commission report handlers
│   ├── historical.ts        # Historical data, realtime bars handlers
│   ├── misc.ts              # News, scanner, verify, WSH, config handlers
│   └── index.ts             # Assembles all handler groups
│
├── protobuf/                # Auto-generated from .proto (not in git)
│   └── *.ts                 # 203 files, generated via `pnpm generate:proto`
│
├── wrapper.ts               # EWrapper interface + DefaultEWrapper
├── order-decoder.ts         # Version-gated order field extraction
├── comm.ts                  # Message framing (length prefix + NULL fields)
├── connection.ts            # TCP socket wrapper (net.Socket)
├── reader.ts                # Socket data → framed messages
├── utils.ts                 # Field decode, formatting, validation
│
├── contract.ts, order.ts, execution.ts, ...  # Data models
├── const.ts, errors.ts, server-versions.ts   # Constants
├── message.ts               # IN/OUT message ID enums
└── index.ts                 # Public API re-exports
```

### Why the split?

Both `client/` and `decoder/` are split by message category (market-data, orders, account, etc.) instead of being single monolithic files. This keeps each file under 500 lines — manageable for both humans and AI-assisted development.

## Reference Source

`ref/` contains the official IBKR TWS API distribution (v10.44.01):

- `ref/source/proto/` — 203 `.proto` files (protocol source of truth)
- `ref/source/pythonclient/ibapi/` — Python client (translation reference)
- `ref/samples/Python/Testbed/` — Usage examples

Java/C++ sources are in `.gitignore` (available locally after extracting the TWS API zip).

## Testing

```bash
pnpm test          # Unit tests (no external dependencies)
pnpm test:e2e      # Integration tests (needs TWS/IB Gateway running)
pnpm test:all      # Both
```

E2e tests share a single TWS connection via `tests/e2e/setup.ts`. If TWS is not running, e2e tests skip automatically.

Text-decoder changes must include payload-only fixtures for the touched handler
category plus framing and malformed-message recovery coverage. Run the
[owner-guide verification ladder](../../docs/ibkr-wire-protocol.md#verification-ladder)
before live broker acceptance.

### TWS Ports

| Mode | TWS | IB Gateway |
|------|-----|------------|
| Paper | 7497 | 4002 |
| Live | 7496 | 4001 |

Configure via env: `TWS_HOST=127.0.0.1 TWS_PORT=7497 TWS_CLIENT_ID=91`.
Use a client id that does not collide with a running UTA connection.

## Protobuf Generation

The `src/protobuf/` directory is auto-generated and git-ignored. To regenerate:

```bash
brew install protobuf          # needs protoc
pnpm generate:proto            # runs protoc with ts-proto plugin
```

## Relationship to Official API

This is a mechanical translation of the official Python `ibapi` package. Method names, field names, and message IDs are kept identical for cross-reference. When debugging, you can compare any handler against the same-named method in `ref/source/pythonclient/ibapi/`.
