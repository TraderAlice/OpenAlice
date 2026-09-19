---
name: equity-tearsheet
description: >
  Build a reusable equity/drawdown tearsheet from a backtest CSV (date, equity,
  optional bench). Use when the user wants an equity curve, underwater chart,
  NAV plot, or a browser-openable report like equity-drawdown-tearsheet.html.
  Do not use for live orders or for inventing prices.
---

# Equity / drawdown tearsheet

Turn a saved equity CSV into the standard two-panel report: equity/NAV on top,
underwater drawdown below. The CSV is the evidence. The chart is a view.

## Input

CSV columns:

- `date` (required) — `YYYY-MM-DD`
- `equity` (required) — account equity / NAV
- `bench` (optional) — benchmark level, scaled to the same starting capital

## Run

Use the **AutoQuant Workspace** Python, which has `pandas` and `matplotlib`.
Do not use a bare system Python.

From that Workspace root:

```bash
uv run python .agents/skills/equity-tearsheet/scripts/equity_drawdown.py \
  --csv <absolute-or-workspace-path>/equity-curve.csv \
  --out-dir <report-directory> \
  --title "<short title>" \
  --initial-capital <number> \
  --strategy-label "Strategy" \
  --bench-label "Benchmark (scaled)" \
  --metrics <report-summary.json>
```

`--metrics` is optional. Omit `--bench-label` handling is not needed when the
CSV has no `bench` column.

If this skill was copied into Chat, still run it with the AutoQuant
Workspace's `uv run` (or that Workspace's `.venv` Python) so matplotlib is
available. Point `--csv` and `--out-dir` at the AutoQuant Project paths.

## Deliver

Write into the Report directory, next to the other evidence:

| file | role |
|---|---|
| `equity-drawdown-tearsheet.html` | **primary** — browser, zoom and hover |
| `equity-drawdown-tearsheet.svg` | static vector |
| `equity-drawdown-tearsheet.png` / `.pdf` | written when matplotlib imports |

Reply with the absolute HTML path and a `file:///` URL using forward slashes.
Trading authority stays `none`. Do not treat the picture as a new backtest.
