# @traderalice/ibkr-types

Pure data models, sentinels, and enums for the IBKR TWS API.

This package is the types-only half of what was previously `@traderalice/ibkr`.
It contains:

- Sentinels and constants: `UNSET_INTEGER`, `UNSET_DOUBLE`, `UNSET_LONG`,
  `UNSET_DECIMAL`, `NO_VALID_ID`, `MAX_MSG_LEN`, `MIN_SERVER_VER_*`, error
  code/message pairs (`CodeMsgPair`), wire message tags (`IN`, `OUT`),
  news constants.
- Data classes: `Order`, `OrderState`, `OrderAllocation`, `OrderCancel`,
  `OrderCondition`, `Contract`, `ContractDetails`, `ComboLeg`,
  `DeltaNeutralContract`, `ContractDescription`, `Execution`,
  `ExecutionFilter`, `CommissionAndFeesReport`, `ScannerSubscription`,
  `ScanData`, `TagValue`, `SoftDollarTier`, `IneligibilityReason`, plus the
  `common.ts` types (`BarData`, `RealTimeBar`, `HistogramData`, `TickAttrib`,
  `WshEventData`, `PROTOBUF_MSG_IDS`).
- Enums and tag tables: `TickType`, `TickTypeEnum`, `tickTypeToString`,
  `AccountSummaryTags`, `AllTags`.
- The callback contract: `EWrapper` interface and the no-op base class
  `DefaultEWrapper`.

There is **no I/O** here: no `node:net`, no `node:events`, no socket, no
protobuf encode/decode, no wire framing. For those, see
[`@traderalice/ibkr-client`](../ibkr-client/README.md).

## Why split

Phase 1a of the Rust migration plan
([`RUST_MIGRATION_PLAN.v3.md`](../../RUST_MIGRATION_PLAN.v3.md) §5) splits
the original `@traderalice/ibkr` package so consumers (the OpenAlice
host's broker layer, parity scripts, future Rust bindings) can import only
the types they need without pulling in the wire client. The legacy
`@traderalice/ibkr` package remains as a re-export shim that re-exports
both `ibkr-types` and `ibkr-client` so existing call sites continue to
work unchanged.

## Build

```sh
pnpm --filter @traderalice/ibkr-types build
pnpm --filter @traderalice/ibkr-types test
```

## License

AGPL-3.0
