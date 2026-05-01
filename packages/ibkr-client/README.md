# @traderalice/ibkr-client

Wire client for the IBKR TWS API: connection, reader, decoder, request
bridge, and protobuf message wrappers.

This package is the wire-layer half of what was previously
`@traderalice/ibkr`. It depends on
[`@traderalice/ibkr-types`](../ibkr-types/README.md) for all data classes
and constants, and re-exports those names so a consumer can do everything
they could before via a single import:

```ts
import { EClient, Order, Contract, UNSET_DECIMAL } from '@traderalice/ibkr-client'
```

`Order`, `Contract`, and the `UNSET_*` constants come from
`@traderalice/ibkr-types`; `EClient` comes from this package. For
mocking/test isolation prefer importing types from
`@traderalice/ibkr-types` directly so a mock substituted for one symbol
does not unintentionally affect the other.

## Contents

- `src/comm.ts` — wire framing (`makeMsg`, `makeMsgProto`, `makeField`,
  `readMsg`, `readFields`).
- `src/connection.ts` — TCP socket I/O (`Connection` class, `node:net` /
  `node:events`).
- `src/reader.ts` — message reader (`EReader`).
- `src/utils.ts` — wire decoding helpers (`decodeStr`, `decodeInt`,
  `decodeFloat`, `decodeDecimal`, `decodeBool`, `decodeLong`),
  formatting helpers, and runtime error classes used by the wire layer.
- `src/order-decoder.ts` — `OrderDecoder` consumed by `decoder/orders.ts`.
- `src/client/` — `EClient` and its mixins (`account`, `historical`,
  `market-data`, `orders`).
- `src/decoder/` — `Decoder` and its handlers for each message family.
- `src/protobuf/` — generated protobuf message wrappers (DO NOT EDIT;
  regenerate via `bash generate-proto.sh`).

## Build

```sh
pnpm --filter @traderalice/ibkr-client build
pnpm --filter @traderalice/ibkr-client test
pnpm --filter @traderalice/ibkr-client test:e2e   # requires TWS / Gateway
```

## License

AGPL-3.0
