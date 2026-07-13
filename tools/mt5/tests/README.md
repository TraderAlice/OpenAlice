# MT5 manual harnesses

`JmbGoldmineDemoCanaryHarness.mq5` exercises the Task 6 gate and state modules without a trade gateway. It covers the immutable demo/server/symbol/magic bindings, local switches, rollout, volume, stop/risk, spread/session/news, exposure, duplicate observations, broker-day four-loss reset, durable-log failure, and reconciliation failure.

Manual operator gate:

1. Copy `tools/mt5/JmbGoldmineDemoCanary/` into an MT5 `MQL5/Experts/JmbGoldmineDemoCanary/` folder.
2. Copy `tools/mt5/tests/JmbGoldmineDemoCanaryHarness.mq5` into `MQL5/Experts/tests/`, retaining the relative include layout or adjusting only the local include paths.
3. In MetaEditor, compile both `JmbGoldmineDemoCanary.mq5` and `JmbGoldmineDemoCanaryHarness.mq5`.
4. Accept only `0 errors, 0 warnings` for both files.
5. Attach the harness to a demo chart and confirm every table row prints `PASS`, the broker-day reset prints `PASS`, and the final failure count is zero.

Codex does not launch MetaEditor or automate its compiler. Compilation and execution are a later operator-controlled gate. The Task 6 EA remains status-only even when `InpDemoExecutionEnabled` is true: it can publish `ready`, but it cannot submit, amend, or close anything.

The EA inputs must bind exactly to `hfmarkets` / `HFMarketsGlobal-Demo4` / magic `880101` or `icmarkets` / `ICMarketsSC-Demo` / magic `880201`, always on `XAUUSD`. The expected account login must be a positive in-memory binding. It must never appear in status, events, terminal comments, or exported artifacts.
