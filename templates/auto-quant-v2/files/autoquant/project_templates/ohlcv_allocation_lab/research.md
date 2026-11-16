# Portfolio-native allocation research

## Research brief and clarification

Before running the fixed Study, rewrite the incoming assignment in this file
as a bounded English research brief. Preserve the caller's exact tradable and
context assets, construction method, covariance history, caps, volatility
ceiling, decision cadence, implementation assumptions, fixed weighted
reference, and intended evidence meaning. If any caller-owned ambiguity could
change the question, record it here and ask the delegating Agent or user before
intake or execution.
The caller may use any language; English is the internal working language of
the AutoQuant desk.

## Workbench contract

This Project was created for one fixed, non-predictive portfolio construction
question. Read the caller-bound `request.json`, immutable dataset snapshot, and
`strategies/allocation-policy.json` before interpreting the Run.

The Study constructs a long-only equal-risk-contribution portfolio from trailing
completed returns, applies caller-owned caps and a scale-down-only volatility
ceiling, and compares it with a complete fixed-weight reference portfolio on the
same rebalance clock, drift, no-trade, and cost convention.

This is quantitative decision support. It does not observe an account, emit an
Order, or hold trading authority.
