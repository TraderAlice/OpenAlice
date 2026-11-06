# Longbridge Native Decimal Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure every Longbridge order-write Decimal field is an instance of the SDK's native `Decimal` class so N-API can unwrap submitted and replacement orders.

**Architecture:** Keep `decimal.js` as OpenAlice's internal arithmetic type and convert only at the Longbridge write boundary. A single adapter-local `toLongbridgeDecimal` function converts through a decimal string, preserving precision while producing the exact native class expected by `TradeContext`.

**Tech Stack:** TypeScript, Vitest, `decimal.js`, Longbridge Node.js SDK 4.0.5, pnpm

## Global Constraints

- Preserve ESM imports with `.js` extensions for local modules.
- Do not change order validation, order-type translation, error handling, or the Broker Pack API.
- Convert through `Decimal#toString()`; never convert financial values through JavaScript `number`.
- Cover submit and replace quantity, price, trigger-price, and trailing-percent write fields.
- Never run live-paper acceptance until the configured Longbridge account is independently confirmed as paper/demo and cleanup to its pre-run baseline is possible.

---

### Task 1: Enforce the Longbridge Native Decimal Boundary

**Files:**
- Modify: `services/uta/src/domain/trading/brokers/longbridge/LongbridgeBroker.spec.ts`
- Modify: `services/uta/src/domain/trading/brokers/longbridge/LongbridgeBroker.ts`

**Interfaces:**
- Consumes: OpenAlice `decimal.js` values from `Order` and `Partial<Order>`.
- Produces: `toLongbridgeDecimal(value: Decimal): LongbridgeDecimal` and native Decimal values in `SubmitOrderOptions` and `ReplaceOrderOptions`.

- [ ] **Step 1: Add the SDK Decimal test double and failing class-identity assertions**

Extend the `longbridge` mock and import its Decimal class:

```ts
import { Decimal as LongbridgeDecimal } from 'longbridge'

vi.mock('longbridge', () => {
  class MockLongbridgeDecimal {
    private readonly value: string

    constructor(value: string | number) {
      this.value = String(value)
    }

    toString(): string {
      return this.value
    }
  }

  const OrderSide = { Unknown: 0, Buy: 1, Sell: 2 } as const
  const OrderType = {
    Unknown: 0, LO: 1, ELO: 2, MO: 3, AO: 4, ALO: 5, ODD: 6,
    LIT: 7, MIT: 8, TSLPAMT: 9, TSLPPCT: 10, TSMAMT: 11, TSMPCT: 12, SLO: 13,
  } as const
  const TimeInForceType = { Unknown: 0, Day: 1, GoodTilCanceled: 2, GoodTilDate: 3 } as const
  const Market = { Unknown: 0, US: 1, HK: 2, CN: 3, SG: 4, Crypto: 5 } as const

  return {
    Decimal: MockLongbridgeDecimal,
    Config: { fromApikey: vi.fn(() => ({ __config: true })) },
    TradeContext: {
      new: vi.fn(() => ({
        accountBalance: vi.fn(),
        stockPositions: vi.fn(),
        submitOrder: vi.fn(),
        cancelOrder: vi.fn(),
        replaceOrder: vi.fn(),
        orderDetail: vi.fn(),
      })),
    },
    QuoteContext: {
      new: vi.fn(() => ({
        quote: vi.fn(),
        depth: vi.fn(),
        staticInfo: vi.fn(),
        tradingSession: vi.fn(),
      })),
    },
    OrderSide,
    OrderType,
    TimeInForceType,
    Market,
  }
})
```

Add this assertion helper and two boundary-focused tests:

```ts
function expectLongbridgeDecimal(value: unknown, expected: string): void {
  expect(value).toBeInstanceOf(LongbridgeDecimal)
  expect(String(value)).toBe(expected)
}

it('converts decimal.js submit values to SDK Decimal instances', async () => {
  const broker = makeBroker()
  const { trade } = attachMockContexts(broker)
  trade.submitOrder.mockResolvedValue({ orderId: 'decimal-submit' })
  const contract = makeContract('AAPL.US')
  const order = new Order()
  order.action = 'BUY'
  order.orderType = 'TRAIL LIMIT'
  order.totalQuantity = new Decimal('1.25')
  order.lmtPrice = new Decimal('201.125')
  order.auxPrice = new Decimal('199.875')
  order.trailingPercent = new Decimal('1.5')
  order.tif = 'DAY'

  await broker.placeOrder(contract, order)

  const sent = trade.submitOrder.mock.calls[0][0]
  expectLongbridgeDecimal(sent.submittedQuantity, '1.25')
  expectLongbridgeDecimal(sent.submittedPrice, '201.125')
  expectLongbridgeDecimal(sent.triggerPrice, '199.875')
  expectLongbridgeDecimal(sent.trailingPercent, '1.5')
})

it('converts decimal.js replacement values to SDK Decimal instances', async () => {
  const broker = makeBroker()
  const { trade } = attachMockContexts(broker)
  trade.replaceOrder.mockResolvedValue(undefined)

  await broker.modifyOrder('ord-1', {
    totalQuantity: new Decimal('2.5'),
    lmtPrice: new Decimal('202.25'),
    auxPrice: new Decimal('198.75'),
  })

  const sent = trade.replaceOrder.mock.calls[0][0]
  expectLongbridgeDecimal(sent.quantity, '2.5')
  expectLongbridgeDecimal(sent.price, '202.25')
  expectLongbridgeDecimal(sent.triggerPrice, '198.75')
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
pnpm vitest run services/uta/src/domain/trading/brokers/longbridge/LongbridgeBroker.spec.ts
```

Expected: FAIL because payload fields are `decimal.js` instances rather than the mocked SDK `LongbridgeDecimal` class.

- [ ] **Step 3: Add the minimal adapter conversion and replace unsafe casts**

Import the SDK class with an unambiguous name:

```ts
import {
  Decimal as LongbridgeDecimal,
  Config,
  TradeContext,
  QuoteContext,
  OrderSide,
  OrderType as LbOrderType,
  TimeInForceType,
  type SubmitOrderOptions,
  type ReplaceOrderOptions,
} from 'longbridge'
```

Add one adapter-local converter near the Longbridge constants:

```ts
function toLongbridgeDecimal(value: Decimal): LongbridgeDecimal {
  return new LongbridgeDecimal(value.toString())
}
```

Use it for every current write-side cast:

```ts
submittedQuantity: toLongbridgeDecimal(order.totalQuantity)
opts.submittedPrice = toLongbridgeDecimal(order.lmtPrice)
opts.triggerPrice = toLongbridgeDecimal(order.auxPrice)
opts.trailingPercent = toLongbridgeDecimal(order.trailingPercent)
quantity: toLongbridgeDecimal(changes.totalQuantity)
opts.price = toLongbridgeDecimal(changes.lmtPrice)
opts.triggerPrice = toLongbridgeDecimal(changes.auxPrice)
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```powershell
pnpm vitest run services/uta/src/domain/trading/brokers/longbridge/LongbridgeBroker.spec.ts
```

Expected: the Longbridge spec passes with all native-class and exact-string assertions green.

- [ ] **Step 5: Commit the tested implementation**

```powershell
git add services/uta/src/domain/trading/brokers/longbridge/LongbridgeBroker.ts services/uta/src/domain/trading/brokers/longbridge/LongbridgeBroker.spec.ts
git commit -m "fix(longbridge): use SDK Decimal for order writes"
```

### Task 2: Verify and Deliver the Contribution

**Files:**
- Verify: `services/uta/src/domain/trading/brokers/longbridge/LongbridgeBroker.ts`
- Verify: `services/uta/src/domain/trading/brokers/longbridge/LongbridgeBroker.spec.ts`
- Verify: `packages/uta-broker-longbridge/`

**Interfaces:**
- Consumes: the implementation commit from Task 1.
- Produces: local verification evidence and an upstream pull request from `fanfpy/OpenAlice` to `TraderAlice/OpenAlice:dev`.

- [ ] **Step 1: Run TypeScript and package-specific checks**

```powershell
npx tsc --noEmit
pnpm -F @traderalice/uta-broker-longbridge typecheck
```

Expected: both commands exit 0 without new diagnostics.

- [ ] **Step 2: Run the repository suite**

```powershell
pnpm test
```

Expected: all configured Vitest projects pass. Report unrelated pre-existing failures instead of changing unrelated files.

- [ ] **Step 3: Inspect the final contribution**

```powershell
git status -sb
git diff origin/dev...HEAD --check
git diff --stat origin/dev...HEAD
git log --oneline origin/dev..HEAD
```

Expected: only the design, plan, Longbridge adapter, and Longbridge spec are changed; the worktree is clean after commits.

- [ ] **Step 4: Record the live-paper boundary**

Do not set `OPENALICE_UTA_LIVE_PAPER=1` unless a Longbridge account configuration has first been verified as paper/demo without exposing credentials. If no verified account is available, record `Not run: no independently verified Longbridge paper account` in the PR verification section.

- [ ] **Step 5: Push to the fork and open the upstream PR**

```powershell
git push -u fanfpy fix/longbridge-native-decimal
gh pr create --repo TraderAlice/OpenAlice --base dev --head fanfpy:fix/longbridge-native-decimal --title "fix(longbridge): use native Decimal for order writes"
```

The PR body must include the runtime class mismatch, exact verification commands and results, `Boundary touch: trading`, and the live-paper status from Step 4. Because this is an external fork contribution, leave the PR open for upstream review rather than merging it.
