# Mainland China A shares

The current raw routes also accept caller-verified exchange-listed funds such
as `510300`. Preserve the per-asset `equity` or `fund` class; never infer it
from a six-digit provider code.

- Preserve `XSHG`, `XSHE`, or `XBSE` explicitly and keep the research symbol
  separate from each provider's prefixed/suffixed code.
- Use `Asia/Shanghai`; verify closures and suspensions without filling missing
  bars.
- State whether prices are raw, forward-adjusted, or backward-adjusted and
  freeze the provider's exact algorithm claim. These series answer different
  research questions.
- Verify whether volume is shares, lots, or another unit and whether amount is
  being substituted for volume.
- Keep price-limit and suspension observations; they are market behavior, not
  generic bad rows.

## Routes

- Eastmoney: observable route through `$fetch-eastmoney-ohlcv`. It preserves
  amount evidence for a strong lot-to-share audit, but connection closures or
  throttling must be recorded as degraded behavior.
- Tencent Finance: independent observable raw route through
  `$fetch-tencent-ohlcv`; compare its explicit lot-to-share conversion before
  accepting it.
- Sina Finance: independent recent raw route through `$fetch-sina-ohlcv`;
  unlike the current Tencent route it has returned post-migration `bj920...`
  Beijing symbols, but it is still provider evidence rather than XBSE
  authority.
- Sohu Finance: independent raw route through `$fetch-sohu-ohlcv`; it also
  returns post-migration Beijing `920` symbols, converts reported lots to
  shares, and checks traded value against OHLC.
- Yahoo: broad independent route through `$fetch-yahoo-ohlcv`; prove its
  symbol, freshness, split-adjustment, suspension, and history behavior on the
  same sample before acceptance.

No one of these is silently substituted for another. Route selection must
name the required adjustment, history, freshness, access behavior, and
evidence quality.
