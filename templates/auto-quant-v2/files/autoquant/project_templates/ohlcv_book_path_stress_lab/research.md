# Reported-book historical path stress

## Research brief and clarification

Before running the fixed Study, rewrite the incoming assignment in this file
as a bounded English research brief. Preserve the caller's exact reported
weights and as-of time, history, completed-session clock, holding horizon,
episode count, overlap rule, price-adjustment meaning, attribution question,
and intended descriptive evidence boundary. The caller may use any language;
English is the internal working language of the AutoQuant desk.

If any caller-owned ambiguity could change the fixed window population,
buy-and-hold path, episode selection, contribution arithmetic, or evidence
meaning, record it here and ask the delegating Agent or user before intake or
execution. Do not infer live account truth, forecast, optimization, Order, or
trading authority from a reported snapshot.

## Fixed question

Which non-overlapping fixed-horizon historical paths produced the worst terminal losses for the caller-reported funded book, and which holdings caused those losses?

## Boundary

This is a descriptive historical Study. The reported weights are not authenticated account truth. It does not forecast, optimize, reconstruct an account, create an Order, or grant trading authority.

## Evidence

The immutable Run enumerates every complete common-session window, applies the fixed opening units without rebalancing, selects the requested worst non-overlapping episodes, and reconciles holding contributions to the book path.
