# U.S. listed equities

- Name the listing venue (`XNYS`, `XNAS`, `ARCX`, or another exact venue)
  rather than using “U.S.” as a calendar.
- For ordinary consolidated daily research, use `America/New_York` and verify
  the requested session calendar against the actual instruments.
- Distinguish raw, split-adjusted, and dividend-adjusted history. Never adjust
  only close while leaving raw OHLC.
- Preserve zero-volume observations for investigation; do not assume every
  listed instrument trades every session.
- Treat current index/ETF constituents as a current-universe sample, not a
  survivorship-free historical universe.
- Choose package panel semantics before retrieval. Fixed Event, Book Risk,
  Allocation, Portfolio, and RL Studies require `aligned`; use
  `observed-only` for Factor research only when the question must retain
  ragged histories. Yahoo and Nasdaq daily procedures support this choice;
  Yahoo's strict XNYS `1h` procedure is aligned V3 only.

## Routes

- `$fetch-nasdaq-ohlcv`: independent split-adjusted display-history route for
  named equities and ETFs. It can emit aligned V1 or observed-only V4 packages;
  it does not authenticate primary venue and is distinct from credentialed
  Nasdaq Data Link Bars.
- `$fetch-yahoo-ohlcv`: broad split-adjusted or
  split-and-dividend-adjusted historical Chart route; adjustment and venue
  metadata remain external claims. Its daily procedure emits V1/V4. Its
  separate XNYS `1h` procedure either emits exact aligned V3 or durable
  no-authority evidence; Yahoo's bucket starts, 730-day limit, null/gap rows,
  and early-close markers are validated rather than trusted.
- Compare the same split-adjusted assets and dates before route selection when
  both routes cover the same interval. The bundled Nasdaq route is an
  independent daily peer, not historical-hourly confirmation. When an hourly
  question lacks a second executable route, disclose single-source authority
  and stop if Yahoo cannot satisfy the exact panel. Credentialed alternatives
  may still be preferable for history, completeness, freshness, adjustment, or
  entitlement.
