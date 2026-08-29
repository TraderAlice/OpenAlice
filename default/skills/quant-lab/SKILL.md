---
name: quant-lab
description: >
  Quant Lab & LEAN Quantitative Research Engine — scaffold Python QCAlgorithm strategies,
  execute isolated event-driven LEAN backtests, optimize parameters across grid sweeps,
  perform academic research integrity audits (Deflated Sharpe Ratio, Walk-Forward Efficiency,
  Monte Carlo trade resampling, data snooping adjustments), and formalize trade journal hypotheses.
  Use via the `alice-quant` CLI or when the user mentions Quant Lab, LEAN backtesting,
  Forex algorithms, or quantitative strategy research.
---

# Quant Lab — LEAN Quantitative Research Engine

Quant Lab is OpenAlice's institutional-grade quantitative backtesting and research environment powered by QuantConnect LEAN (`quantconnect/lean:latest`) and an evidence-first research integrity framework.

## CLI Surface (`alice-quant`)

Every OpenAlice workspace agent has access to `alice-quant` on its shell PATH (backed by the loopback CLI gateway). Output is JSON on stdout.

```bash
alice-quant --help                      # Strategy, backtest, experiment, integrity, journal
alice-quant <group> <verb> --help       # Inspect parameter schemas for a specific command
```

### 1. Scaffold & Manage Strategies

```bash
# Create a strategy from a built-in template ('ema-cross', 'london-breakout', 'rsi-mean-reversion')
alice-quant strategy create --name "EURUSD EMA Cross" --templateId "ema-cross"

# Inspect or override strategy parameters
alice-quant strategy create --name "London Breakout" --templateId "london-breakout" --parameters '{"buffer_pips": 6, "rr_ratio": 2.0}'
```

### 2. Run Isolated LEAN Backtests

```bash
# Execute backtest on Forex Minute data (2024-01-02 to 2024-01-06)
alice-quant backtest run --strategyId "eurusd-ema-cross" --startDate "2024-01-02" --endDate "2024-01-06" --symbol "EURUSD"

# Retrieve closed trades, performance statistics, and drawdown
alice-quant backtest results --backtestId "<backtest-id>" --includeClosedTrades true
```

### 3. Parameter Optimization & Lineage

```bash
# Run a parameter sweep across bounded intervals
alice-quant backtest optimize --strategyId "eurusd-ema-cross" --startDate "2024-01-02" --endDate "2024-01-06" --parameterRanges '{"fast_period": {"min": 8, "max": 16, "step": 2}}'

# List and filter past experiments
alice-quant experiment list --limit 10
```

### 4. Evidence-First Research Integrity Audits

Evaluate in-sample vs out-of-sample degradation, Deflated Sharpe Ratio (DSR), Monte Carlo trade order resampling, and data snooping corrections (without arbitrary composite scores):

```bash
alice-quant integrity evaluate --experimentId "<experiment-id>" --monteCarloIterations 1000
```

### 5. Trade Journal & Hypothesis Formalization

```bash
# Record a discretionary trade hypothesis
alice-quant journal entry --action create --title "EURUSD Asian High Sweep" --symbol "EURUSD" --direction "long" --hypothesis "London open sweeps Asian high"

# Formalize into a systematic QCAlgorithm proposal
alice-quant journal formalize --journalId "<journal-entry-id>"
```
