# @traderalice/ibkr

> **Re-export shim.** Phase 1a of the Rust migration plan
> ([RUST_MIGRATION_PLAN.v3.md](../../RUST_MIGRATION_PLAN.v3.md) §5) split
> the original `@traderalice/ibkr` package into two:
>
> - [`@traderalice/ibkr-types`](../ibkr-types/README.md) — pure data
>   models, sentinels, enums (no I/O).
> - [`@traderalice/ibkr-client`](../ibkr-client/README.md) — wire
>   protocol, connection, reader, decoder, request bridge, protobuf
>   wrappers.
>
> This package now contains only `src/index.ts`, which re-exports both.
> Existing call sites do not change:
>
> ```typescript
> import { EClient, DefaultEWrapper, Contract } from '@traderalice/ibkr'
> ```
>
> still resolves to the same symbols. The shim is intended to remain for
> at least one minor release per Phase 8 of the migration plan, after
> which it will be removed and consumers migrated to the two split
> packages directly.

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

For documentation on the wire protocol, the dual text/protobuf protocol,
the `client/` and `decoder/` subdivisions, the protobuf generator, the
e2e test harness, and the reference source, see
[`@traderalice/ibkr-client`](../ibkr-client/README.md). For documentation
on the data models, sentinels, and enums, see
[`@traderalice/ibkr-types`](../ibkr-types/README.md).

## License

AGPL-3.0
