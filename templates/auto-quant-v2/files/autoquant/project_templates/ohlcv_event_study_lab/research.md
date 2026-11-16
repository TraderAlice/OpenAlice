# OHLCV Price Event Study

## Research brief and clarification

Before running the fixed Study, rewrite the incoming assignment in this file
as a bounded English research brief. Preserve the caller's exact event,
threshold, wait, holding period, references, and intended evidence meaning.
The caller may use any language; English is the internal working language of
the AutoQuant desk.
If any caller-owned ambiguity could change that fixed question or evidence
meaning, record it here and ask the delegating Agent or user before intake or
execution.

This Project was transactionally constructed from a caller-supplied,
content-locked OHLCV snapshot. Provider, calendar, and price-adjustment
metadata are disclosed claims, not authenticated by AutoQuant.

## Workbench contract

- The fixed Study is `ohlcv-price-event-reaction`.
- `strategies/event-study.json` is immutable request-derived authority.
- The Judge owns causal event selection, delayed close-to-close alignment,
  raw and primary overlap populations, unconditional same-asset and
  matched-date reference returns, descriptive uncertainty, and artifacts.
- No candidate source, Session, parameter search, Order, or trading authority
  exists in this lane.
- Completed Runs are immutable. Use strict Event Explorer output rather than
  trusting mutable summaries or opening an artifact without verification.

## First commands

```bash
aq study inspect . --study ohlcv-price-event-reaction --json
aq run execute . --study ohlcv-price-event-reaction --json
```
