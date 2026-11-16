# Reported Book Risk Lab

## Research brief and clarification

Rewrite the incoming assignment as a bounded English risk-research brief before
running the Study. Record the reported or hypothetical baseline weight
snapshot, its as-of time and provenance, the market-data authority, material
tax/lot or replacement constraints, and exactly what “reduce first” or “how
large can I open” means. For one-leg sizing, confirm the only adjustable asset,
explicit asset/cash direction, cash availability, fixed covariance window,
numerical ceiling, explicit direction-specific minimum or maximum resulting
weight, unchanged holdings, and acceptance of a no-solution result.
If the caller asks a conditional reallocation question, record every proposed
complete funded book and confirm that all proposals share the baseline time
and currency.
The caller may use any language; English is the internal working language of
the AutoQuant desk.
If any ambiguity can materially change the audit, ask the delegating Agent or
user before running it.

This Lab studies one explicitly supplied baseline and, when present, only the
complete hypothetical books explicitly supplied by the caller. It does not
query an account, prove that reported positions are current, generate nearby
books, optimize an executable portfolio, or create an order. OpenAlice/UTA
remains the authority for live positions and execution.

Historical drawdown is measured on the fixed daily constant-weight
close-to-close research path. Explain that this is not reconstructed account
equity, fill history, cash yield, taxes, or live broker performance.
