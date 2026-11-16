# European Union equity venues

“EU equities” is a routing label, not a market clock. First name the exact
listing venue, for example a specific Euronext market, Xetra, Borsa Italiana,
or Bolsa de Madrid.

- Preserve venue, local timezone, currency, and provider symbol separately.
- Verify venue-specific sessions, holidays, half-days, adjustment, and volume
  units.
- Distinguish the primary listing from an ADR, secondary listing, or
  cross-listed provider result.
- Do not extend one proved venue route to all EU venues.

## Routes

### Euronext Paris (`XPAR`)

- Euronext Live official historical download: use
  `$fetch-euronext-ohlcv` for explicit raw or provider-adjusted history. The
  current executable proof is confined to `XPAR`, EUR equities, and the
  displayed two-year history limit.
- Yahoo: use `$fetch-yahoo-ohlcv` as the independent broad route with
  `.PA` provider symbols and explicit split-adjusted or
  split-and-dividend-adjusted semantics.

Do not call `provider-adjusted` and `split-adjusted` equivalent merely because
ordinary overlap rows agree. XPAR is not accepted until the official route,
Yahoo route, package, strict intake, and fresh-worker handoff are recorded.
No XPAR result extends to XAMS, XBRU, XLIS, XDUB, XMIL, XETR, or another
European venue.
