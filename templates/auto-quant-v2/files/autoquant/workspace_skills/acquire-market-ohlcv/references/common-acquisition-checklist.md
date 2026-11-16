# Common acquisition checklist

## Before fetching

- Recover the research question before choosing data.
- Name the economic instrument, provider symbol, listing venue, quote
  currency, and asset class separately.
- Use a bounded date range and completed bars only.
- State whether prices must be raw, split-adjusted,
  split-and-dividend-adjusted, or only provider-adjusted.
- State whether the Study needs a common aligned panel or observed-only bars.
- Prefer two independently usable sources. Select by task fitness rather than
  a permanent global priority.
- Do not reduce the requested universe, history, or semantics because staged
  data happens to exist. Reacquiring duplicate task-complete bytes is valid.

## Preserve

- The exact executed script and arguments.
- Provider source URI and terms/access claim.
- Retrieval timestamp when known.
- Raw response or the closest provider-delivered file.
- SHA-256 for raw and normalized files.
- Symbol and venue mapping evidence.
- Transformation rules, especially timestamp and adjustment changes.
- Missing, duplicate, zero-volume, non-positive, and invalid-OHLC counts.

## Reject or disclose

- A forming current bar.
- Naive intraday timestamps or an invented bar-close shift.
- Forward-filled closures or suspensions.
- Adjusted close combined silently with raw open/high/low.
- A total-return claim inferred only from a field named “adjusted.”
- A venue/calendar claim inferred only from a ticker suffix.
- A “free” or redistribution-rights claim not supported by current terms.
- Current-constituent universes represented as survivorship-free history.

## Compare two sources

For an overlapping sample, compare dates, row counts, split/dividend regions,
OHLC returns, volume scale, latest completed date, and missing observations.
Explain differences; do not average conflicting providers.
Use numerical comparison only for compatible adjustment claims. Use explicit
coverage-only comparison for incompatible raw/adjusted packages.

When an independently attempted provider command fails, preserve the standard
route-failure audit through `scripts/run_route_attempt.py`; do not handwrite a
success-shaped package or describe one local failure as global unavailability.

## Hand off

Use `$package-autoquant-ohlcv`. A successful download is not yet a valid
AutoQuant dataset, and a valid dataset package does not authenticate provider
truth.
