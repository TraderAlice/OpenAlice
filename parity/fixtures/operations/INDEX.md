# Operation fixtures (Phase 0.1)

**Generated:** 240 cases by `parity/scripts/gen-operations.ts`.

Re-running the generator with no source edits produces byte-identical
output. Hand-editing fixtures is forbidden — edit the script and re-run.

## Coverage by category

| Category | Cases |
|---|---|
| `adversarial` | 40 |
| `cancelOrder` | 15 |
| `closePosition` | 40 |
| `core-buy` | 28 |
| `core-buy-extra` | 12 |
| `core-sell` | 28 |
| `core-sell-extra` | 12 |
| `modifyOrder` | 20 |
| `syncOrders` | 5 |
| `tpsl` | 36 |
| `tpsl-extra` | 4 |

**Total cases:** 240

## Decimal-edge classes

| Tag | Example qty | Example price | Notes |
|---|---|---|---|
| `std-2dp` | 100 | 50.25 | 2 dp |
| `btc-8dp` | 0.00012345 | 67234.50 | 8 dp |
| `usdt-12dp` | 0.000000123456 | 0.999875 | 12 dp |
| `eth-18dp` | 0.000000000000000001 | 3500.123456789012345 | 18 dp |
| `large` | 1e30 | 1.5 | 0 dp |
| `small` | 1e-30 | 0.0001 | 30 dp |

## Files

| # | File | Name |
|---|---|---|
| 1 | `case-001-buy-mkt-day-std-2dp-AAPL.json` | BUY MKT DAY on AAPL (std-2dp) |
| 2 | `case-002-buy-mkt-gtc-btc-8dp-TSLA.json` | BUY MKT GTC on TSLA (btc-8dp) |
| 3 | `case-003-buy-mkt-ioc-usdt-12dp-BTCUSDT.json` | BUY MKT IOC on BTC/USDT (usdt-12dp) |
| 4 | `case-004-buy-mkt-gtd-eth-18dp-ETHUSDT.json` | BUY MKT GTD on ETH/USDT (eth-18dp) |
| 5 | `case-005-buy-lmt-day-large-AAPL.json` | BUY LMT DAY on AAPL (large) |
| 6 | `case-006-buy-lmt-gtc-small-TSLA.json` | BUY LMT GTC on TSLA (small) |
| 7 | `case-007-buy-lmt-ioc-std-2dp-BTCUSDT.json` | BUY LMT IOC on BTC/USDT (std-2dp) |
| 8 | `case-008-buy-lmt-gtd-btc-8dp-ETHUSDT.json` | BUY LMT GTD on ETH/USDT (btc-8dp) |
| 9 | `case-009-buy-stp-day-usdt-12dp-AAPL.json` | BUY STP DAY on AAPL (usdt-12dp) |
| 10 | `case-010-buy-stp-gtc-eth-18dp-TSLA.json` | BUY STP GTC on TSLA (eth-18dp) |
| 11 | `case-011-buy-stp-ioc-large-BTCUSDT.json` | BUY STP IOC on BTC/USDT (large) |
| 12 | `case-012-buy-stp-gtd-small-ETHUSDT.json` | BUY STP GTD on ETH/USDT (small) |
| 13 | `case-013-buy-stp_lmt-day-std-2dp-AAPL.json` | BUY STP_LMT DAY on AAPL (std-2dp) |
| 14 | `case-014-buy-stp_lmt-gtc-btc-8dp-TSLA.json` | BUY STP_LMT GTC on TSLA (btc-8dp) |
| 15 | `case-015-buy-stp_lmt-ioc-usdt-12dp-BTCUSDT.json` | BUY STP_LMT IOC on BTC/USDT (usdt-12dp) |
| 16 | `case-016-buy-stp_lmt-gtd-eth-18dp-ETHUSDT.json` | BUY STP_LMT GTD on ETH/USDT (eth-18dp) |
| 17 | `case-017-buy-trail-day-large-AAPL.json` | BUY TRAIL DAY on AAPL (large) |
| 18 | `case-018-buy-trail-gtc-small-TSLA.json` | BUY TRAIL GTC on TSLA (small) |
| 19 | `case-019-buy-trail-ioc-std-2dp-BTCUSDT.json` | BUY TRAIL IOC on BTC/USDT (std-2dp) |
| 20 | `case-020-buy-trail-gtd-btc-8dp-ETHUSDT.json` | BUY TRAIL GTD on ETH/USDT (btc-8dp) |
| 21 | `case-021-buy-trail_limit-day-usdt-12dp-AAPL.json` | BUY TRAIL_LIMIT DAY on AAPL (usdt-12dp) |
| 22 | `case-022-buy-trail_limit-gtc-eth-18dp-TSLA.json` | BUY TRAIL_LIMIT GTC on TSLA (eth-18dp) |
| 23 | `case-023-buy-trail_limit-ioc-large-BTCUSDT.json` | BUY TRAIL_LIMIT IOC on BTC/USDT (large) |
| 24 | `case-024-buy-trail_limit-gtd-small-ETHUSDT.json` | BUY TRAIL_LIMIT GTD on ETH/USDT (small) |
| 25 | `case-025-buy-moc-day-std-2dp-AAPL.json` | BUY MOC DAY on AAPL (std-2dp) |
| 26 | `case-026-buy-moc-gtc-btc-8dp-TSLA.json` | BUY MOC GTC on TSLA (btc-8dp) |
| 27 | `case-027-buy-moc-ioc-usdt-12dp-BTCUSDT.json` | BUY MOC IOC on BTC/USDT (usdt-12dp) |
| 28 | `case-028-buy-moc-gtd-eth-18dp-ETHUSDT.json` | BUY MOC GTD on ETH/USDT (eth-18dp) |
| 29 | `case-029-buy-lmt-ioc-extra00-std-2dp-AAPL.json` | BUY LMT IOC extra 0 on AAPL (std-2dp) |
| 30 | `case-030-buy-lmt-ioc-extra01-btc-8dp-TSLA.json` | BUY LMT IOC extra 1 on TSLA (btc-8dp) |
| 31 | `case-031-buy-lmt-ioc-extra02-usdt-12dp-BTCUSDT.json` | BUY LMT IOC extra 2 on BTC/USDT (usdt-12dp) |
| 32 | `case-032-buy-lmt-ioc-extra03-eth-18dp-ETHUSDT.json` | BUY LMT IOC extra 3 on ETH/USDT (eth-18dp) |
| 33 | `case-033-buy-lmt-ioc-extra04-large-AAPL.json` | BUY LMT IOC extra 4 on AAPL (large) |
| 34 | `case-034-buy-lmt-ioc-extra05-small-TSLA.json` | BUY LMT IOC extra 5 on TSLA (small) |
| 35 | `case-035-buy-lmt-ioc-extra06-std-2dp-BTCUSDT.json` | BUY LMT IOC extra 6 on BTC/USDT (std-2dp) |
| 36 | `case-036-buy-lmt-ioc-extra07-btc-8dp-ETHUSDT.json` | BUY LMT IOC extra 7 on ETH/USDT (btc-8dp) |
| 37 | `case-037-buy-lmt-ioc-extra08-usdt-12dp-AAPL.json` | BUY LMT IOC extra 8 on AAPL (usdt-12dp) |
| 38 | `case-038-buy-lmt-ioc-extra09-eth-18dp-TSLA.json` | BUY LMT IOC extra 9 on TSLA (eth-18dp) |
| 39 | `case-039-buy-lmt-ioc-extra10-large-BTCUSDT.json` | BUY LMT IOC extra 10 on BTC/USDT (large) |
| 40 | `case-040-buy-lmt-ioc-extra11-small-ETHUSDT.json` | BUY LMT IOC extra 11 on ETH/USDT (small) |
| 41 | `case-041-sell-mkt-day-std-2dp-AAPL.json` | SELL MKT DAY on AAPL (std-2dp) |
| 42 | `case-042-sell-mkt-gtc-btc-8dp-TSLA.json` | SELL MKT GTC on TSLA (btc-8dp) |
| 43 | `case-043-sell-mkt-ioc-usdt-12dp-BTCUSDT.json` | SELL MKT IOC on BTC/USDT (usdt-12dp) |
| 44 | `case-044-sell-mkt-gtd-eth-18dp-ETHUSDT.json` | SELL MKT GTD on ETH/USDT (eth-18dp) |
| 45 | `case-045-sell-lmt-day-large-AAPL.json` | SELL LMT DAY on AAPL (large) |
| 46 | `case-046-sell-lmt-gtc-small-TSLA.json` | SELL LMT GTC on TSLA (small) |
| 47 | `case-047-sell-lmt-ioc-std-2dp-BTCUSDT.json` | SELL LMT IOC on BTC/USDT (std-2dp) |
| 48 | `case-048-sell-lmt-gtd-btc-8dp-ETHUSDT.json` | SELL LMT GTD on ETH/USDT (btc-8dp) |
| 49 | `case-049-sell-stp-day-usdt-12dp-AAPL.json` | SELL STP DAY on AAPL (usdt-12dp) |
| 50 | `case-050-sell-stp-gtc-eth-18dp-TSLA.json` | SELL STP GTC on TSLA (eth-18dp) |
| 51 | `case-051-sell-stp-ioc-large-BTCUSDT.json` | SELL STP IOC on BTC/USDT (large) |
| 52 | `case-052-sell-stp-gtd-small-ETHUSDT.json` | SELL STP GTD on ETH/USDT (small) |
| 53 | `case-053-sell-stp_lmt-day-std-2dp-AAPL.json` | SELL STP_LMT DAY on AAPL (std-2dp) |
| 54 | `case-054-sell-stp_lmt-gtc-btc-8dp-TSLA.json` | SELL STP_LMT GTC on TSLA (btc-8dp) |
| 55 | `case-055-sell-stp_lmt-ioc-usdt-12dp-BTCUSDT.json` | SELL STP_LMT IOC on BTC/USDT (usdt-12dp) |
| 56 | `case-056-sell-stp_lmt-gtd-eth-18dp-ETHUSDT.json` | SELL STP_LMT GTD on ETH/USDT (eth-18dp) |
| 57 | `case-057-sell-trail-day-large-AAPL.json` | SELL TRAIL DAY on AAPL (large) |
| 58 | `case-058-sell-trail-gtc-small-TSLA.json` | SELL TRAIL GTC on TSLA (small) |
| 59 | `case-059-sell-trail-ioc-std-2dp-BTCUSDT.json` | SELL TRAIL IOC on BTC/USDT (std-2dp) |
| 60 | `case-060-sell-trail-gtd-btc-8dp-ETHUSDT.json` | SELL TRAIL GTD on ETH/USDT (btc-8dp) |
| 61 | `case-061-sell-trail_limit-day-usdt-12dp-AAPL.json` | SELL TRAIL_LIMIT DAY on AAPL (usdt-12dp) |
| 62 | `case-062-sell-trail_limit-gtc-eth-18dp-TSLA.json` | SELL TRAIL_LIMIT GTC on TSLA (eth-18dp) |
| 63 | `case-063-sell-trail_limit-ioc-large-BTCUSDT.json` | SELL TRAIL_LIMIT IOC on BTC/USDT (large) |
| 64 | `case-064-sell-trail_limit-gtd-small-ETHUSDT.json` | SELL TRAIL_LIMIT GTD on ETH/USDT (small) |
| 65 | `case-065-sell-moc-day-std-2dp-AAPL.json` | SELL MOC DAY on AAPL (std-2dp) |
| 66 | `case-066-sell-moc-gtc-btc-8dp-TSLA.json` | SELL MOC GTC on TSLA (btc-8dp) |
| 67 | `case-067-sell-moc-ioc-usdt-12dp-BTCUSDT.json` | SELL MOC IOC on BTC/USDT (usdt-12dp) |
| 68 | `case-068-sell-moc-gtd-eth-18dp-ETHUSDT.json` | SELL MOC GTD on ETH/USDT (eth-18dp) |
| 69 | `case-069-sell-lmt-ioc-extra00-std-2dp-AAPL.json` | SELL LMT IOC extra 0 on AAPL (std-2dp) |
| 70 | `case-070-sell-lmt-ioc-extra01-btc-8dp-TSLA.json` | SELL LMT IOC extra 1 on TSLA (btc-8dp) |
| 71 | `case-071-sell-lmt-ioc-extra02-usdt-12dp-BTCUSDT.json` | SELL LMT IOC extra 2 on BTC/USDT (usdt-12dp) |
| 72 | `case-072-sell-lmt-ioc-extra03-eth-18dp-ETHUSDT.json` | SELL LMT IOC extra 3 on ETH/USDT (eth-18dp) |
| 73 | `case-073-sell-lmt-ioc-extra04-large-AAPL.json` | SELL LMT IOC extra 4 on AAPL (large) |
| 74 | `case-074-sell-lmt-ioc-extra05-small-TSLA.json` | SELL LMT IOC extra 5 on TSLA (small) |
| 75 | `case-075-sell-lmt-ioc-extra06-std-2dp-BTCUSDT.json` | SELL LMT IOC extra 6 on BTC/USDT (std-2dp) |
| 76 | `case-076-sell-lmt-ioc-extra07-btc-8dp-ETHUSDT.json` | SELL LMT IOC extra 7 on ETH/USDT (btc-8dp) |
| 77 | `case-077-sell-lmt-ioc-extra08-usdt-12dp-AAPL.json` | SELL LMT IOC extra 8 on AAPL (usdt-12dp) |
| 78 | `case-078-sell-lmt-ioc-extra09-eth-18dp-TSLA.json` | SELL LMT IOC extra 9 on TSLA (eth-18dp) |
| 79 | `case-079-sell-lmt-ioc-extra10-large-BTCUSDT.json` | SELL LMT IOC extra 10 on BTC/USDT (large) |
| 80 | `case-080-sell-lmt-ioc-extra11-small-ETHUSDT.json` | SELL LMT IOC extra 11 on ETH/USDT (small) |
| 81 | `case-081-buy-mkt-gtc-tp-only-std-2dp-0.json` | BUY MKT GTC TP-only on AAPL (std-2dp) #0 |
| 82 | `case-082-buy-mkt-gtc-tp-only-btc-8dp-1.json` | BUY MKT GTC TP-only on TSLA (btc-8dp) #1 |
| 83 | `case-083-buy-mkt-gtc-sl-only-usdt-12dp-0.json` | BUY MKT GTC SL-only on BTC/USDT (usdt-12dp) #0 |
| 84 | `case-084-buy-mkt-gtc-sl-only-eth-18dp-1.json` | BUY MKT GTC SL-only on ETH/USDT (eth-18dp) #1 |
| 85 | `case-085-buy-mkt-gtc-tpplussl-large-0.json` | BUY MKT GTC TP+SL on AAPL (large) #0 |
| 86 | `case-086-buy-mkt-gtc-tpplussl-small-1.json` | BUY MKT GTC TP+SL on TSLA (small) #1 |
| 87 | `case-087-buy-lmt-gtc-tp-only-std-2dp-0.json` | BUY LMT GTC TP-only on BTC/USDT (std-2dp) #0 |
| 88 | `case-088-buy-lmt-gtc-tp-only-btc-8dp-1.json` | BUY LMT GTC TP-only on ETH/USDT (btc-8dp) #1 |
| 89 | `case-089-buy-lmt-gtc-sl-only-usdt-12dp-0.json` | BUY LMT GTC SL-only on AAPL (usdt-12dp) #0 |
| 90 | `case-090-buy-lmt-gtc-sl-only-eth-18dp-1.json` | BUY LMT GTC SL-only on TSLA (eth-18dp) #1 |
| 91 | `case-091-buy-lmt-gtc-tpplussl-large-0.json` | BUY LMT GTC TP+SL on BTC/USDT (large) #0 |
| 92 | `case-092-buy-lmt-gtc-tpplussl-small-1.json` | BUY LMT GTC TP+SL on ETH/USDT (small) #1 |
| 93 | `case-093-buy-stp-gtc-tp-only-std-2dp-0.json` | BUY STP GTC TP-only on AAPL (std-2dp) #0 |
| 94 | `case-094-buy-stp-gtc-tp-only-btc-8dp-1.json` | BUY STP GTC TP-only on TSLA (btc-8dp) #1 |
| 95 | `case-095-buy-stp-gtc-sl-only-usdt-12dp-0.json` | BUY STP GTC SL-only on BTC/USDT (usdt-12dp) #0 |
| 96 | `case-096-buy-stp-gtc-sl-only-eth-18dp-1.json` | BUY STP GTC SL-only on ETH/USDT (eth-18dp) #1 |
| 97 | `case-097-buy-stp-gtc-tpplussl-large-0.json` | BUY STP GTC TP+SL on AAPL (large) #0 |
| 98 | `case-098-buy-stp-gtc-tpplussl-small-1.json` | BUY STP GTC TP+SL on TSLA (small) #1 |
| 99 | `case-099-sell-mkt-gtc-tp-only-std-2dp-0.json` | SELL MKT GTC TP-only on BTC/USDT (std-2dp) #0 |
| 100 | `case-100-sell-mkt-gtc-tp-only-btc-8dp-1.json` | SELL MKT GTC TP-only on ETH/USDT (btc-8dp) #1 |
| 101 | `case-101-sell-mkt-gtc-sl-only-usdt-12dp-0.json` | SELL MKT GTC SL-only on AAPL (usdt-12dp) #0 |
| 102 | `case-102-sell-mkt-gtc-sl-only-eth-18dp-1.json` | SELL MKT GTC SL-only on TSLA (eth-18dp) #1 |
| 103 | `case-103-sell-mkt-gtc-tpplussl-large-0.json` | SELL MKT GTC TP+SL on BTC/USDT (large) #0 |
| 104 | `case-104-sell-mkt-gtc-tpplussl-small-1.json` | SELL MKT GTC TP+SL on ETH/USDT (small) #1 |
| 105 | `case-105-sell-lmt-gtc-tp-only-std-2dp-0.json` | SELL LMT GTC TP-only on AAPL (std-2dp) #0 |
| 106 | `case-106-sell-lmt-gtc-tp-only-btc-8dp-1.json` | SELL LMT GTC TP-only on TSLA (btc-8dp) #1 |
| 107 | `case-107-sell-lmt-gtc-sl-only-usdt-12dp-0.json` | SELL LMT GTC SL-only on BTC/USDT (usdt-12dp) #0 |
| 108 | `case-108-sell-lmt-gtc-sl-only-eth-18dp-1.json` | SELL LMT GTC SL-only on ETH/USDT (eth-18dp) #1 |
| 109 | `case-109-sell-lmt-gtc-tpplussl-large-0.json` | SELL LMT GTC TP+SL on AAPL (large) #0 |
| 110 | `case-110-sell-lmt-gtc-tpplussl-small-1.json` | SELL LMT GTC TP+SL on TSLA (small) #1 |
| 111 | `case-111-sell-stp-gtc-tp-only-std-2dp-0.json` | SELL STP GTC TP-only on BTC/USDT (std-2dp) #0 |
| 112 | `case-112-sell-stp-gtc-tp-only-btc-8dp-1.json` | SELL STP GTC TP-only on ETH/USDT (btc-8dp) #1 |
| 113 | `case-113-sell-stp-gtc-sl-only-usdt-12dp-0.json` | SELL STP GTC SL-only on AAPL (usdt-12dp) #0 |
| 114 | `case-114-sell-stp-gtc-sl-only-eth-18dp-1.json` | SELL STP GTC SL-only on TSLA (eth-18dp) #1 |
| 115 | `case-115-sell-stp-gtc-tpplussl-large-0.json` | SELL STP GTC TP+SL on BTC/USDT (large) #0 |
| 116 | `case-116-sell-stp-gtc-tpplussl-small-1.json` | SELL STP GTC TP+SL on ETH/USDT (small) #1 |
| 117 | `case-117-tpsl-tight-buy-std-2dp-0.json` | BUY LMT GTC tight bracket #0 |
| 118 | `case-118-tpsl-tight-sell-btc-8dp-1.json` | SELL LMT GTC tight bracket #1 |
| 119 | `case-119-tpsl-tight-buy-usdt-12dp-2.json` | BUY LMT GTC tight bracket #2 |
| 120 | `case-120-tpsl-tight-sell-eth-18dp-3.json` | SELL LMT GTC tight bracket #3 |
| 121 | `case-121-close-AAPL-std-2dp-fullimp-00.json` | closePosition full-implicit AAPL (std-2dp) #0 |
| 122 | `case-122-close-TSLA-btc-8dp-partial-01.json` | closePosition partial TSLA (btc-8dp) #1 |
| 123 | `case-123-close-BTCUSDT-usdt-12dp-fullexp-02.json` | closePosition full-explicit BTC/USDT (usdt-12dp) #2 |
| 124 | `case-124-close-ETHUSDT-eth-18dp-fullexp2-03.json` | closePosition full-explicit-2 ETH/USDT (eth-18dp) #3 |
| 125 | `case-125-close-AAPL-large-fullimp-04.json` | closePosition full-implicit AAPL (large) #4 |
| 126 | `case-126-close-TSLA-small-partial-05.json` | closePosition partial TSLA (small) #5 |
| 127 | `case-127-close-BTCUSDT-std-2dp-fullexp-06.json` | closePosition full-explicit BTC/USDT (std-2dp) #6 |
| 128 | `case-128-close-ETHUSDT-btc-8dp-fullexp2-07.json` | closePosition full-explicit-2 ETH/USDT (btc-8dp) #7 |
| 129 | `case-129-close-AAPL-usdt-12dp-fullimp-08.json` | closePosition full-implicit AAPL (usdt-12dp) #8 |
| 130 | `case-130-close-TSLA-eth-18dp-partial-09.json` | closePosition partial TSLA (eth-18dp) #9 |
| 131 | `case-131-close-BTCUSDT-large-fullexp-10.json` | closePosition full-explicit BTC/USDT (large) #10 |
| 132 | `case-132-close-ETHUSDT-small-fullexp2-11.json` | closePosition full-explicit-2 ETH/USDT (small) #11 |
| 133 | `case-133-close-AAPL-std-2dp-fullimp-12.json` | closePosition full-implicit AAPL (std-2dp) #12 |
| 134 | `case-134-close-TSLA-btc-8dp-partial-13.json` | closePosition partial TSLA (btc-8dp) #13 |
| 135 | `case-135-close-BTCUSDT-usdt-12dp-fullexp-14.json` | closePosition full-explicit BTC/USDT (usdt-12dp) #14 |
| 136 | `case-136-close-ETHUSDT-eth-18dp-fullexp2-15.json` | closePosition full-explicit-2 ETH/USDT (eth-18dp) #15 |
| 137 | `case-137-close-AAPL-large-fullimp-16.json` | closePosition full-implicit AAPL (large) #16 |
| 138 | `case-138-close-TSLA-small-partial-17.json` | closePosition partial TSLA (small) #17 |
| 139 | `case-139-close-BTCUSDT-std-2dp-fullexp-18.json` | closePosition full-explicit BTC/USDT (std-2dp) #18 |
| 140 | `case-140-close-ETHUSDT-btc-8dp-fullexp2-19.json` | closePosition full-explicit-2 ETH/USDT (btc-8dp) #19 |
| 141 | `case-141-close-AAPL-usdt-12dp-fullimp-20.json` | closePosition full-implicit AAPL (usdt-12dp) #20 |
| 142 | `case-142-close-TSLA-eth-18dp-partial-21.json` | closePosition partial TSLA (eth-18dp) #21 |
| 143 | `case-143-close-BTCUSDT-large-fullexp-22.json` | closePosition full-explicit BTC/USDT (large) #22 |
| 144 | `case-144-close-ETHUSDT-small-fullexp2-23.json` | closePosition full-explicit-2 ETH/USDT (small) #23 |
| 145 | `case-145-close-AAPL-std-2dp-fullimp-24.json` | closePosition full-implicit AAPL (std-2dp) #24 |
| 146 | `case-146-close-TSLA-btc-8dp-partial-25.json` | closePosition partial TSLA (btc-8dp) #25 |
| 147 | `case-147-close-BTCUSDT-usdt-12dp-fullexp-26.json` | closePosition full-explicit BTC/USDT (usdt-12dp) #26 |
| 148 | `case-148-close-ETHUSDT-eth-18dp-fullexp2-27.json` | closePosition full-explicit-2 ETH/USDT (eth-18dp) #27 |
| 149 | `case-149-close-AAPL-large-fullimp-28.json` | closePosition full-implicit AAPL (large) #28 |
| 150 | `case-150-close-TSLA-small-partial-29.json` | closePosition partial TSLA (small) #29 |
| 151 | `case-151-close-BTCUSDT-std-2dp-fullexp-30.json` | closePosition full-explicit BTC/USDT (std-2dp) #30 |
| 152 | `case-152-close-ETHUSDT-btc-8dp-fullexp2-31.json` | closePosition full-explicit-2 ETH/USDT (btc-8dp) #31 |
| 153 | `case-153-close-AAPL-usdt-12dp-fullimp-32.json` | closePosition full-implicit AAPL (usdt-12dp) #32 |
| 154 | `case-154-close-TSLA-eth-18dp-partial-33.json` | closePosition partial TSLA (eth-18dp) #33 |
| 155 | `case-155-close-BTCUSDT-large-fullexp-34.json` | closePosition full-explicit BTC/USDT (large) #34 |
| 156 | `case-156-close-ETHUSDT-small-fullexp2-35.json` | closePosition full-explicit-2 ETH/USDT (small) #35 |
| 157 | `case-157-close-AAPL-std-2dp-fullimp-36.json` | closePosition full-implicit AAPL (std-2dp) #36 |
| 158 | `case-158-close-TSLA-btc-8dp-partial-37.json` | closePosition partial TSLA (btc-8dp) #37 |
| 159 | `case-159-close-BTCUSDT-usdt-12dp-fullexp-38.json` | closePosition full-explicit BTC/USDT (usdt-12dp) #38 |
| 160 | `case-160-close-ETHUSDT-eth-18dp-fullexp2-39.json` | closePosition full-explicit-2 ETH/USDT (eth-18dp) #39 |
| 161 | `case-161-modify-qty-std-2dp-00.json` | modifyOrder qty change (std-2dp) #0 |
| 162 | `case-162-modify-price-btc-8dp-01.json` | modifyOrder price change (btc-8dp) #1 |
| 163 | `case-163-modify-type-usdt-12dp-02.json` | modifyOrder type change (usdt-12dp) #2 |
| 164 | `case-164-modify-tif-eth-18dp-03.json` | modifyOrder tif change (eth-18dp) #3 |
| 165 | `case-165-modify-qty-large-04.json` | modifyOrder qty change (large) #4 |
| 166 | `case-166-modify-price-small-05.json` | modifyOrder price change (small) #5 |
| 167 | `case-167-modify-type-std-2dp-06.json` | modifyOrder type change (std-2dp) #6 |
| 168 | `case-168-modify-tif-btc-8dp-07.json` | modifyOrder tif change (btc-8dp) #7 |
| 169 | `case-169-modify-qty-usdt-12dp-08.json` | modifyOrder qty change (usdt-12dp) #8 |
| 170 | `case-170-modify-price-eth-18dp-09.json` | modifyOrder price change (eth-18dp) #9 |
| 171 | `case-171-modify-type-large-10.json` | modifyOrder type change (large) #10 |
| 172 | `case-172-modify-tif-small-11.json` | modifyOrder tif change (small) #11 |
| 173 | `case-173-modify-qty-std-2dp-12.json` | modifyOrder qty change (std-2dp) #12 |
| 174 | `case-174-modify-price-btc-8dp-13.json` | modifyOrder price change (btc-8dp) #13 |
| 175 | `case-175-modify-type-usdt-12dp-14.json` | modifyOrder type change (usdt-12dp) #14 |
| 176 | `case-176-modify-tif-eth-18dp-15.json` | modifyOrder tif change (eth-18dp) #15 |
| 177 | `case-177-modify-qty-large-16.json` | modifyOrder qty change (large) #16 |
| 178 | `case-178-modify-price-small-17.json` | modifyOrder price change (small) #17 |
| 179 | `case-179-modify-type-std-2dp-18.json` | modifyOrder type change (std-2dp) #18 |
| 180 | `case-180-modify-tif-btc-8dp-19.json` | modifyOrder tif change (btc-8dp) #19 |
| 181 | `case-181-cancel-00.json` | cancelOrder #0 |
| 182 | `case-182-cancel-01.json` | cancelOrder #1 |
| 183 | `case-183-cancel-02.json` | cancelOrder #2 |
| 184 | `case-184-cancel-03.json` | cancelOrder #3 |
| 185 | `case-185-cancel-04.json` | cancelOrder #4 |
| 186 | `case-186-cancel-05.json` | cancelOrder #5 |
| 187 | `case-187-cancel-06.json` | cancelOrder #6 |
| 188 | `case-188-cancel-07.json` | cancelOrder #7 |
| 189 | `case-189-cancel-08.json` | cancelOrder #8 |
| 190 | `case-190-cancel-09.json` | cancelOrder #9 |
| 191 | `case-191-cancel-10.json` | cancelOrder #10 |
| 192 | `case-192-cancel-11.json` | cancelOrder #11 |
| 193 | `case-193-cancel-12.json` | cancelOrder #12 |
| 194 | `case-194-cancel-13.json` | cancelOrder #13 |
| 195 | `case-195-cancel-14.json` | cancelOrder #14 |
| 196 | `case-196-sync-00.json` | syncOrders #0 |
| 197 | `case-197-sync-01.json` | syncOrders #1 |
| 198 | `case-198-sync-02.json` | syncOrders #2 |
| 199 | `case-199-sync-03.json` | syncOrders #3 |
| 200 | `case-200-sync-04.json` | syncOrders #4 |
| 201 | `case-201-adv-buy-mkt-qty-zero-AAPL-00.json` | BUY MKT adversarial qty-zero on AAPL — qty must be positive |
| 202 | `case-202-adv-buy-mkt-qty-negative-TSLA-01.json` | BUY MKT adversarial qty-negative on TSLA — qty must be positive |
| 203 | `case-203-adv-buy-mkt-price-zero-on-LMT-BTCUSDT-02.json` | BUY MKT adversarial price-zero-on-LMT on BTC/USDT — limit price must be positive |
| 204 | `case-204-adv-buy-mkt-qty-1e30-ETHUSDT-03.json` | BUY MKT adversarial qty-1e30 on ETH/USDT — large qty round-trips |
| 205 | `case-205-adv-buy-mkt-qty-1e-30-AAPL-04.json` | BUY MKT adversarial qty-1e-30 on AAPL — small qty round-trips |
| 206 | `case-206-adv-buy-mkt-qty-8dp-TSLA-05.json` | BUY MKT adversarial qty-8dp on TSLA — btc-style 8dp |
| 207 | `case-207-adv-buy-mkt-qty-12dp-BTCUSDT-06.json` | BUY MKT adversarial qty-12dp on BTC/USDT — usdt-style 12dp |
| 208 | `case-208-adv-buy-mkt-qty-18dp-ETHUSDT-07.json` | BUY MKT adversarial qty-18dp on ETH/USDT — eth-style 18dp |
| 209 | `case-209-adv-buy-mkt-price-12dp-AAPL-08.json` | BUY MKT adversarial price-12dp on AAPL — 12dp price |
| 210 | `case-210-adv-buy-mkt-price-18dp-TSLA-09.json` | BUY MKT adversarial price-18dp on TSLA — 18dp price |
| 211 | `case-211-adv-buy-lmt-qty-zero-BTCUSDT-10.json` | BUY LMT adversarial qty-zero on BTC/USDT — qty must be positive |
| 212 | `case-212-adv-buy-lmt-qty-negative-ETHUSDT-11.json` | BUY LMT adversarial qty-negative on ETH/USDT — qty must be positive |
| 213 | `case-213-adv-buy-lmt-price-zero-on-LMT-AAPL-12.json` | BUY LMT adversarial price-zero-on-LMT on AAPL — limit price must be positive |
| 214 | `case-214-adv-buy-lmt-qty-1e30-TSLA-13.json` | BUY LMT adversarial qty-1e30 on TSLA — large qty round-trips |
| 215 | `case-215-adv-buy-lmt-qty-1e-30-BTCUSDT-14.json` | BUY LMT adversarial qty-1e-30 on BTC/USDT — small qty round-trips |
| 216 | `case-216-adv-buy-lmt-qty-8dp-ETHUSDT-15.json` | BUY LMT adversarial qty-8dp on ETH/USDT — btc-style 8dp |
| 217 | `case-217-adv-buy-lmt-qty-12dp-AAPL-16.json` | BUY LMT adversarial qty-12dp on AAPL — usdt-style 12dp |
| 218 | `case-218-adv-buy-lmt-qty-18dp-TSLA-17.json` | BUY LMT adversarial qty-18dp on TSLA — eth-style 18dp |
| 219 | `case-219-adv-buy-lmt-price-12dp-BTCUSDT-18.json` | BUY LMT adversarial price-12dp on BTC/USDT — 12dp price |
| 220 | `case-220-adv-buy-lmt-price-18dp-ETHUSDT-19.json` | BUY LMT adversarial price-18dp on ETH/USDT — 18dp price |
| 221 | `case-221-adv-buy-stp-qty-zero-AAPL-20.json` | BUY STP adversarial qty-zero on AAPL — qty must be positive |
| 222 | `case-222-adv-buy-stp-qty-negative-TSLA-21.json` | BUY STP adversarial qty-negative on TSLA — qty must be positive |
| 223 | `case-223-adv-buy-stp-price-zero-on-LMT-BTCUSDT-22.json` | BUY STP adversarial price-zero-on-LMT on BTC/USDT — limit price must be positive |
| 224 | `case-224-adv-buy-stp-qty-1e30-ETHUSDT-23.json` | BUY STP adversarial qty-1e30 on ETH/USDT — large qty round-trips |
| 225 | `case-225-adv-buy-stp-qty-1e-30-AAPL-24.json` | BUY STP adversarial qty-1e-30 on AAPL — small qty round-trips |
| 226 | `case-226-adv-buy-stp-qty-8dp-TSLA-25.json` | BUY STP adversarial qty-8dp on TSLA — btc-style 8dp |
| 227 | `case-227-adv-buy-stp-qty-12dp-BTCUSDT-26.json` | BUY STP adversarial qty-12dp on BTC/USDT — usdt-style 12dp |
| 228 | `case-228-adv-buy-stp-qty-18dp-ETHUSDT-27.json` | BUY STP adversarial qty-18dp on ETH/USDT — eth-style 18dp |
| 229 | `case-229-adv-buy-stp-price-12dp-AAPL-28.json` | BUY STP adversarial price-12dp on AAPL — 12dp price |
| 230 | `case-230-adv-buy-stp-price-18dp-TSLA-29.json` | BUY STP adversarial price-18dp on TSLA — 18dp price |
| 231 | `case-231-adv-sell-lmt-qty-zero-AAPL-00.json` | SELL LMT adversarial qty-zero on AAPL — qty must be positive |
| 232 | `case-232-adv-sell-lmt-qty-negative-TSLA-01.json` | SELL LMT adversarial qty-negative on TSLA — qty must be positive |
| 233 | `case-233-adv-sell-lmt-price-zero-on-LMT-BTCUSDT-02.json` | SELL LMT adversarial price-zero-on-LMT on BTC/USDT — limit price must be positive |
| 234 | `case-234-adv-sell-lmt-qty-1e30-ETHUSDT-03.json` | SELL LMT adversarial qty-1e30 on ETH/USDT — large qty round-trips |
| 235 | `case-235-adv-sell-lmt-qty-1e-30-AAPL-04.json` | SELL LMT adversarial qty-1e-30 on AAPL — small qty round-trips |
| 236 | `case-236-adv-sell-lmt-qty-8dp-TSLA-05.json` | SELL LMT adversarial qty-8dp on TSLA — btc-style 8dp |
| 237 | `case-237-adv-sell-lmt-qty-12dp-BTCUSDT-06.json` | SELL LMT adversarial qty-12dp on BTC/USDT — usdt-style 12dp |
| 238 | `case-238-adv-sell-lmt-qty-18dp-ETHUSDT-07.json` | SELL LMT adversarial qty-18dp on ETH/USDT — eth-style 18dp |
| 239 | `case-239-adv-sell-lmt-price-12dp-AAPL-08.json` | SELL LMT adversarial price-12dp on AAPL — 12dp price |
| 240 | `case-240-adv-sell-lmt-price-18dp-TSLA-09.json` | SELL LMT adversarial price-18dp on TSLA — 18dp price |
