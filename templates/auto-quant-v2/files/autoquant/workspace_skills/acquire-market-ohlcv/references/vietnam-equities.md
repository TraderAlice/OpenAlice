# Vietnam Listed Equities (`HOSE`, `HNX`, `UPCoM`)

- Preserve the exact board (`HOSE`, `HNX`, or `UPCoM`) and `Asia/Ho_Chi_Minh` session dates separately.
- Verify VND currency scale (thousand-VND quotes vs full VND), share volume units, and corporate-action adjustments.

## Bundled Fetcher Routes

- `$fetch-vndirect-ohlcv`: Paginated daily route (`fetch_vndirect_daily.py`) for `HOSE`, `HNX`, or `UPCoM` supporting explicit `raw` or `provider-adjusted` prices; converts thousand-VND quotes to VND (`×1000`) and audits against traded value/volume.
- `$fetch-yahoo-ohlcv`: `.VN` route for `split-adjusted` or `split-and-dividend-adjusted` daily history.
