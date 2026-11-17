# South Korea Listed Equities (`XKRX`)

- Preserve board/listing identity (KOSPI vs KOSDAQ) and `Asia/Seoul` (`XKRX` calendar) session dates; keep suspended sessions absent rather than forward-filled.
- Confirm price adjustment mode, KRW currency, and share volume units.

## Bundled Fetcher Routes

- `$fetch-naver-ohlcv`: Provider-adjusted KRW daily history (`fetch_naver_daily.py`), automatically omitting zero-volume no-trade placeholders and auditing 1-KRW integer rounding bounds.
- `$fetch-daum-ohlcv`: Paginated raw KRW daily history (`fetch_daum_daily.py`) with share volume and accumulated trade-value diagnostics.
- `$fetch-yahoo-ohlcv`: `.KS` (KOSPI) and `.KQ` (KOSDAQ) `split-adjusted` or `split-and-dividend-adjusted` daily history.
