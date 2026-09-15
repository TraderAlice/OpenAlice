# AutoQuant Studio demo specimen

The HTML, CSS and JavaScript are copied from TraderAlice/Auto-Quant 0.9.34
(`autoquant/studio_assets`, commit `52d63148d826e6c35d48c3167d95a4cc7a4eb6c4`). The only presentation adaptations are relative
asset URLs, fetching the adjacent snapshot.json, and a visible synthetic-demo
notice. Business rendering remains owned by AutoQuant.

snapshot.json was produced by AutoQuant's StudioObservationTests._setup in an
isolated temporary directory and build_studio_snapshot. It contains the project's
synthetic test evaluator, not user portfolios or a live strategy backtest.
Temporary paths are normalized to /demo/research. No managed Studio process is
started by this specimen. Refresh returns the same recorded snapshot.
