# OHLCV Price Event Study program

This fixed descriptive Study answers exactly the event/timing question frozen
in `strategies/event-study.json`.

The Judge must:

1. identify every qualifying opening-gap event causally;
2. align the fixed entry and exit closes without off-by-one reinterpretation;
3. preserve complete and right-censored events in one ledger;
4. expose raw and non-overlapping primary populations;
5. compare primary returns with unconditional same-asset and matched-date
   reference returns;
6. report sample-size and normal-approximation uncertainty limitations; and
7. retain `tradingAuthority: none`.

There is no editable strategy and no selection loop. Changing the event,
threshold, timing, reference, overlap rule, or minimum event count requires a
new intake and Study identity.
