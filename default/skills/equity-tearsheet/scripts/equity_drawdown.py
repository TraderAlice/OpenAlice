#!/usr/bin/env python3
"""Reusable equity + underwater drawdown tearsheet.

Input: CSV with date,equity[,bench]. Output: HTML (primary), SVG, optional PNG/PDF.
stdlib + pandas required; matplotlib/plotly optional.
"""
from __future__ import annotations

import argparse
import json
import math
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

import pandas as pd


@dataclass(frozen=True)
class SeriesBundle:
    dates: list[str]
    equity: list[float]
    bench_scaled: list[float] | None
    drawdown: list[float]
    initial: float
    max_dd: float
    peak_i: int
    trough_i: int
    total_return: float
    bench_return: float | None


def _load_csv(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path)
    cols = {c.lower(): c for c in df.columns}
    if "date" not in cols or "equity" not in cols:
        raise SystemExit(f"CSV must include date,equity columns: {path}")
    out = pd.DataFrame(
        {
            "date": pd.to_datetime(df[cols["date"]]).dt.strftime("%Y-%m-%d"),
            "equity": pd.to_numeric(df[cols["equity"]], errors="coerce"),
        }
    )
    if "bench" in cols:
        out["bench"] = pd.to_numeric(df[cols["bench"]], errors="coerce")
    out = out.dropna(subset=["equity"]).reset_index(drop=True)
    if out.empty:
        raise SystemExit(f"empty equity series: {path}")
    return out


def _prepare(df: pd.DataFrame, initial: float | None) -> SeriesBundle:
    equity = df["equity"].astype(float).tolist()
    dates = df["date"].astype(str).tolist()
    start = float(initial) if initial is not None else float(equity[0])
    bench_scaled: list[float] | None = None
    bench_return: float | None = None
    if "bench" in df.columns and df["bench"].notna().any():
        b = df["bench"].astype(float)
        b0 = float(b.iloc[0])
        if b0 == 0 or math.isnan(b0):
            raise SystemExit("benchmark first value is zero/NaN; cannot scale")
        bench_scaled = (b / b0 * start).tolist()
        bench_return = float(b.iloc[-1] / b0 - 1.0)

    peak = equity[0]
    peak_i = 0
    dd: list[float] = []
    max_dd = 0.0
    max_peak_i = 0
    max_trough_i = 0
    for i, v in enumerate(equity):
        if v >= peak:
            peak = v
            peak_i = i
        cur = v / peak - 1.0 if peak else 0.0
        dd.append(cur)
        if cur < max_dd:
            max_dd = cur
            max_peak_i = peak_i
            max_trough_i = i

    return SeriesBundle(
        dates=dates,
        equity=equity,
        bench_scaled=bench_scaled,
        drawdown=dd,
        initial=start,
        max_dd=max_dd,
        peak_i=max_peak_i,
        trough_i=max_trough_i,
        total_return=equity[-1] / start - 1.0,
        bench_return=bench_return,
    )


def _x(i: int, n: int, left: float, width: float) -> float:
    if n <= 1:
        return left
    return left + width * i / (n - 1)


def _y(v: float, vmin: float, vmax: float, top: float, height: float) -> float:
    if vmax <= vmin:
        return top + height / 2
    return top + height * (1.0 - (v - vmin) / (vmax - vmin))


def _poly(xs: list[float], ys: list[float]) -> str:
    return " ".join(f"{x:.2f},{y:.2f}" for x, y in zip(xs, ys))


def render_svg(
    bundle: SeriesBundle,
    *,
    title: str,
    strategy_label: str,
    bench_label: str,
    width: int = 960,
    height: int = 640,
) -> str:
    pad_l, pad_r, pad_t, pad_b = 64, 24, 48, 36
    gap = 28
    panel_h = (height - pad_t - pad_b - gap) / 2
    n = len(bundle.dates)
    eq_vals = bundle.equity[:]
    if bundle.bench_scaled:
        eq_vals = eq_vals + bundle.bench_scaled
    eq_vals.append(bundle.initial)
    eq_min, eq_max = min(eq_vals), max(eq_vals)
    pad = (eq_max - eq_min) * 0.06 or 1.0
    eq_min -= pad
    eq_max += pad
    dd_min = min(bundle.drawdown + [0.0])
    dd_max = max(bundle.drawdown + [0.0])
    if dd_min == dd_max:
        dd_min, dd_max = -0.01, 0.01

    plot_w = width - pad_l - pad_r
    xs = [_x(i, n, pad_l, plot_w) for i in range(n)]
    eq_ys = [_y(v, eq_min, eq_max, pad_t, panel_h) for v in bundle.equity]
    dd_top = pad_t + panel_h + gap
    dd_ys = [_y(v, dd_min, dd_max, dd_top, panel_h) for v in bundle.drawdown]
    zero_y = _y(0.0, dd_min, dd_max, dd_top, panel_h)
    init_y = _y(bundle.initial, eq_min, eq_max, pad_t, panel_h)

    parts: list[str] = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">',
        "<style>",
        "text{font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:12px;fill:#1f2937}",
        ".muted{fill:#6b7280;font-size:11px}",
        ".title{font-size:16px;font-weight:600}",
        "</style>",
        f'<rect width="{width}" height="{height}" fill="#ffffff"/>',
        f'<text class="title" x="{pad_l}" y="28">{_esc(title)}</text>',
        f'<text class="muted" x="{pad_l}" y="44">Equity / NAV</text>',
        f'<line x1="{pad_l}" y1="{init_y:.2f}" x2="{pad_l + plot_w:.2f}" y2="{init_y:.2f}" '
        f'stroke="#9ca3af" stroke-dasharray="4 4" stroke-width="1"/>',
        f'<polyline fill="none" stroke="#2563eb" stroke-width="2" points="{_poly(xs, eq_ys)}"/>',
    ]
    if bundle.bench_scaled:
        b_ys = [_y(v, eq_min, eq_max, pad_t, panel_h) for v in bundle.bench_scaled]
        parts.append(
            f'<polyline fill="none" stroke="#f59e0b" stroke-width="1.75" points="{_poly(xs, b_ys)}"/>'
        )
    pk_x, pk_y = xs[bundle.peak_i], eq_ys[bundle.peak_i]
    tr_x, tr_y = xs[bundle.trough_i], eq_ys[bundle.trough_i]
    parts.extend(
        [
            f'<circle cx="{pk_x:.2f}" cy="{pk_y:.2f}" r="4" fill="#dc2626"/>',
            f'<circle cx="{tr_x:.2f}" cy="{tr_y:.2f}" r="4" fill="#dc2626"/>',
            f'<line x1="{pk_x:.2f}" y1="{pk_y:.2f}" x2="{tr_x:.2f}" y2="{tr_y:.2f}" '
            f'stroke="#dc2626" stroke-width="1" stroke-dasharray="3 3"/>',
            f'<text class="muted" x="{pad_l}" y="{dd_top - 8:.2f}">Underwater drawdown</text>',
            f'<line x1="{pad_l}" y1="{zero_y:.2f}" x2="{pad_l + plot_w:.2f}" y2="{zero_y:.2f}" '
            f'stroke="#d1d5db" stroke-width="1"/>',
            f'<polyline fill="none" stroke="#2563eb" stroke-width="2" points="{_poly(xs, dd_ys)}"/>',
            f'<text x="{pad_l}" y="{height - 12}">'
            f'{_esc(strategy_label)} · max DD {bundle.max_dd:.2%} '
            f'({bundle.dates[bundle.peak_i]} → {bundle.dates[bundle.trough_i]})'
            f'</text>',
        ]
    )
    legend_x = width - pad_r - 200
    parts.append(f'<text x="{legend_x}" y="28" fill="#2563eb">■ {_esc(strategy_label)}</text>')
    if bundle.bench_scaled:
        parts.append(f'<text x="{legend_x}" y="44" fill="#f59e0b">■ {_esc(bench_label)}</text>')
    parts.append("</svg>")
    return "\n".join(parts)


def _esc(s: str) -> str:
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def render_html(
    bundle: SeriesBundle,
    *,
    title: str,
    strategy_label: str,
    bench_label: str,
    metrics: dict[str, Any] | None,
    svg: str,
) -> str:
    # Plotly.js from CDN for zoom/hover when online; SVG remains the offline twin.
    eq_trace = {
        "x": bundle.dates,
        "y": bundle.equity,
        "name": strategy_label,
        "line": {"color": "#2563eb", "width": 2},
    }
    traces = [eq_trace]
    if bundle.bench_scaled:
        traces.append(
            {
                "x": bundle.dates,
                "y": bundle.bench_scaled,
                "name": bench_label,
                "line": {"color": "#f59e0b", "width": 1.75},
            }
        )
    dd_trace = {
        "x": bundle.dates,
        "y": [v * 100 for v in bundle.drawdown],
        "name": "Drawdown %",
        "line": {"color": "#2563eb", "width": 2},
        "xaxis": "x2",
        "yaxis": "y2",
        "showlegend": False,
    }
    shapes = [
        {
            "type": "line",
            "xref": "paper",
            "x0": 0,
            "x1": 1,
            "yref": "y",
            "y0": bundle.initial,
            "y1": bundle.initial,
            "line": {"color": "#9ca3af", "width": 1, "dash": "dash"},
        }
    ]
    annotations = [
        {
            "x": bundle.dates[bundle.peak_i],
            "y": bundle.equity[bundle.peak_i],
            "text": "DD peak",
            "showarrow": True,
            "arrowhead": 2,
            "ax": 0,
            "ay": -30,
            "font": {"color": "#dc2626", "size": 11},
        },
        {
            "x": bundle.dates[bundle.trough_i],
            "y": bundle.equity[bundle.trough_i],
            "text": f"max DD {bundle.max_dd:.1%}",
            "showarrow": True,
            "arrowhead": 2,
            "ax": 40,
            "ay": 30,
            "font": {"color": "#dc2626", "size": 11},
        },
    ]
    layout = {
        "title": {"text": title, "x": 0.02, "xanchor": "left"},
        "template": "plotly_white",
        "height": 720,
        "margin": {"l": 64, "r": 24, "t": 56, "b": 40},
        "hovermode": "x unified",
        "grid": {"rows": 2, "columns": 1, "pattern": "independent", "roworder": "top to bottom"},
        "xaxis": {"matches": "x2", "showticklabels": False},
        "yaxis": {"title": "Equity / NAV", "domain": [0.42, 1.0]},
        "xaxis2": {"anchor": "y2", "domain": [0, 1]},
        "yaxis2": {"title": "Drawdown %", "domain": [0, 0.32], "ticksuffix": "%"},
        "shapes": shapes,
        "annotations": annotations,
        "legend": {"orientation": "h", "y": 1.08},
    }
    metric_rows = [
        ("Total return", f"{bundle.total_return:.2%}"),
        ("Max drawdown", f"{bundle.max_dd:.2%}"),
        ("Max DD window", f"{bundle.dates[bundle.peak_i]} → {bundle.dates[bundle.trough_i]}"),
        ("Initial capital", f"{bundle.initial:,.2f}"),
        ("Final equity", f"{bundle.equity[-1]:,.2f}"),
    ]
    if bundle.bench_return is not None:
        metric_rows.insert(1, ("Benchmark return (scaled)", f"{bundle.bench_return:.2%}"))
        metric_rows.insert(2, ("Excess vs bench", f"{bundle.total_return - bundle.bench_return:.2%}"))
    if metrics:
        blob = metrics.get("metrics", metrics) if isinstance(metrics, dict) else {}
        for key in (
            "nRounds",
            "hitNRate",
            "s2EarlyExitRate",
            "s1Survived",
            "minEquity",
            "stockBuyHoldReturn",
        ):
            if key not in blob:
                continue
            val = blob[key]
            if isinstance(val, float) and (key.endswith("Rate") or key.endswith("Return")):
                metric_rows.append((key, f"{val:.2%}"))
            elif isinstance(val, float):
                metric_rows.append((key, f"{val:,.2f}"))
            else:
                metric_rows.append((key, str(val)))

    table = "\n".join(
        f"<tr><th>{_esc(k)}</th><td>{_esc(v)}</td></tr>" for k, v in metric_rows
    )
    payload = json.dumps({"data": traces + [dd_trace], "layout": layout}, ensure_ascii=False)
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>{_esc(title)}</title>
  <script src="https://cdn.plot.ly/plotly-2.35.2.min.js"></script>
  <style>
    body {{ margin: 0; font-family: Segoe UI, Helvetica, Arial, sans-serif; color: #111827; background: #f9fafb; }}
    main {{ max-width: 1100px; margin: 0 auto; padding: 24px; }}
    h1 {{ font-size: 1.25rem; margin: 0 0 8px; }}
    .note {{ color: #6b7280; font-size: 0.875rem; margin-bottom: 16px; }}
    table {{ border-collapse: collapse; width: 100%; background: #fff; margin: 16px 0 24px; }}
    th, td {{ border: 1px solid #e5e7eb; padding: 8px 10px; text-align: left; font-size: 0.875rem; }}
    th {{ width: 40%; background: #f3f4f6; }}
    #chart {{ background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; }}
    details {{ margin-top: 24px; background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; }}
    summary {{ cursor: pointer; font-weight: 600; }}
  </style>
</head>
<body>
<main>
  <h1>{_esc(title)}</h1>
  <p class="note">Interactive Plotly tearsheet (zoom/pan/hover). Offline twin: open the sibling <code>.svg</code>. Source of truth remains the equity CSV.</p>
  <table>{table}</table>
  <div id="chart"></div>
  <details>
    <summary>Embedded static SVG (offline)</summary>
    {svg}
  </details>
</main>
<script>
const spec = {payload};
Plotly.newPlot('chart', spec.data, spec.layout, {{responsive: true, displaylogo: false}});
</script>
</body>
</html>
"""


def try_matplotlib(
    bundle: SeriesBundle,
    out_stem: Path,
    *,
    title: str,
    strategy_label: str,
    bench_label: str,
) -> list[Path]:
    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        return []

    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(11, 7.2), sharex=True, gridspec_kw={"height_ratios": [1.4, 1]})
    x = [datetime.strptime(d, "%Y-%m-%d") for d in bundle.dates]
    ax1.plot(x, bundle.equity, color="#2563eb", lw=1.8, label=strategy_label)
    if bundle.bench_scaled:
        ax1.plot(x, bundle.bench_scaled, color="#f59e0b", lw=1.5, label=bench_label)
    ax1.axhline(bundle.initial, color="#9ca3af", ls="--", lw=1)
    ax1.scatter(
        [x[bundle.peak_i], x[bundle.trough_i]],
        [bundle.equity[bundle.peak_i], bundle.equity[bundle.trough_i]],
        color="#dc2626",
        zorder=5,
    )
    ax1.set_ylabel("Equity / NAV")
    ax1.set_title(title)
    ax1.legend(loc="upper left")
    ax1.grid(True, alpha=0.25)

    ax2.fill_between(x, [v * 100 for v in bundle.drawdown], 0, color="#2563eb", alpha=0.25)
    ax2.plot(x, [v * 100 for v in bundle.drawdown], color="#2563eb", lw=1.5)
    ax2.set_ylabel("Drawdown %")
    ax2.grid(True, alpha=0.25)
    fig.autofmt_xdate()
    fig.tight_layout()
    written: list[Path] = []
    png = out_stem.with_suffix(".png")
    pdf = out_stem.with_suffix(".pdf")
    fig.savefig(png, dpi=144)
    fig.savefig(pdf)
    plt.close(fig)
    written.extend([png, pdf])
    return written


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--csv", type=Path, required=True)
    ap.add_argument("--out-dir", type=Path, required=True)
    ap.add_argument("--stem", default="equity-drawdown-tearsheet")
    ap.add_argument("--title", default="Equity / drawdown tearsheet")
    ap.add_argument("--initial-capital", type=float, default=None)
    ap.add_argument("--strategy-label", default="Strategy")
    ap.add_argument("--bench-label", default="Benchmark (scaled)")
    ap.add_argument("--metrics", type=Path, default=None)
    args = ap.parse_args()

    df = _load_csv(args.csv)
    bundle = _prepare(df, args.initial_capital)
    metrics = None
    if args.metrics and args.metrics.exists():
        metrics = json.loads(args.metrics.read_text(encoding="utf-8"))

    args.out_dir.mkdir(parents=True, exist_ok=True)
    stem = args.out_dir / args.stem
    svg = render_svg(
        bundle,
        title=args.title,
        strategy_label=args.strategy_label,
        bench_label=args.bench_label,
    )
    svg_path = stem.with_suffix(".svg")
    svg_path.write_text(svg, encoding="utf-8")
    html = render_html(
        bundle,
        title=args.title,
        strategy_label=args.strategy_label,
        bench_label=args.bench_label,
        metrics=metrics,
        svg=svg,
    )
    html_path = stem.with_suffix(".html")
    html_path.write_text(html, encoding="utf-8")
    extra = try_matplotlib(
        bundle,
        stem,
        title=args.title,
        strategy_label=args.strategy_label,
        bench_label=args.bench_label,
    )
    print(f"wrote {html_path}")
    print(f"wrote {svg_path}")
    for p in extra:
        print(f"wrote {p}")
    if not extra:
        print("matplotlib not installed; skipped png/pdf (HTML+SVG are enough)")


if __name__ == "__main__":
    main()
