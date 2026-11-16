# Fixed reported-book path stress program

This Study has no editable candidate. Run the fixed judge once, inspect it through `aq run book-path-stress`, and publish a Run Report that answers the caller's bounded historical question.

The opening book is frozen by `strategies/position-snapshot.json`. The horizon, ranking, overlap, attribution, cash, and tie semantics are frozen by `strategies/book-path-stress.json`. Do not replace the Study with ad hoc notebook or pandas evidence.

Required interpretation:

- one bar means one common completed session;
- endpoint is exactly `holdingBars` following common sessions after the start;
- opening weights imply fixed opening units and no within-window rebalancing;
- cash return is zero;
- rank all complete windows by terminal book return ascending, tie earlier start;
- greedily keep the requested number whose inclusive intervals do not overlap;
- contribution is opening weight times holding cumulative return;
- the result is historical descriptive support only.
