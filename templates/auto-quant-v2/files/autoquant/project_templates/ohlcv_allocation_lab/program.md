# Fixed portfolio-native allocation Study

## Authority

The Judge, allocation contract, dataset snapshot, request, and copied runtime
sources are fixed evaluation authority. There is no editable candidate surface
and no Factor or RL Session in this Project.

## Method

- Use only completed returns known through each scheduled decision close.
- Estimate covariance with the caller-fixed trailing window and minimum history.
- Solve one deterministic non-negative equal-risk-contribution book.
- Enforce caller-owned position caps and disclose any resulting parity gap.
- Scale down, never up, to the caller's annualized volatility ceiling.
- Simulate the candidate and fixed-weight reference independently with identical
  schedule, drift, no-trade, and linear cost semantics.
- Select the conclusion from validation net Sharpe advantage only. Test remains
  a visible audit.

## Interpretation

The latest weights are mechanical research targets, not current account truth
and not executable instructions.
