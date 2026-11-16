from __future__ import annotations

import json
from pathlib import Path

import exchange_calendars as xcals
import numpy as np
import pandas as pd


INTAKE_ASSETS = ("AAPL", "MSFT", "NVDA", "QQQ", "SPY")


def write_intake_inputs(
    root: Path,
    *,
    observations: int = 260,
    assets: tuple[str, ...] = INTAKE_ASSETS,
    start: str = "2024-01-02",
    dataset_id: str = "bounded-us-equities",
    dataset_version: str = "2024-v1",
    portfolio_policy: dict[str, object] | None = None,
    benchmark_policy: dict[str, object] | None = None,
    horizon_policy: dict[str, object] | None = None,
    factor_policy: dict[str, object] | None = None,
    request_assets: tuple[str, ...] = ("AAPL", "MSFT"),
    asset_position_roles: dict[str, str] | None = None,
) -> tuple[Path, Path]:
    normalized_factor_policy = (
        dict(factor_policy) if factor_policy is not None else None
    )
    if (
        normalized_factor_policy is not None
        and normalized_factor_policy.get("claim") == "decision-signal"
        and "predictionAssets" not in normalized_factor_policy
    ):
        normalized_factor_policy["predictionAssets"] = [
            symbol
            for symbol in request_assets
            if asset_position_roles is None
            or asset_position_roles[symbol] != "context-only"
        ]
    source = root / "external-data"
    source.mkdir()
    dates = pd.bdate_range(start, periods=observations)
    time = np.arange(observations, dtype=float)
    asset_entries = []
    for number, symbol in enumerate(assets):
        log_returns = (
            0.00025
            + 0.0045 * np.sin(time / (5.0 + number))
            + 0.0020 * np.cos(time / (11.0 + number * 0.7))
        )
        close = (90.0 + number * 25.0) * np.exp(np.cumsum(log_returns))
        open_price = close * np.exp(
            -0.0015 * np.sin(time / (3.0 + number))
        )
        spread = 0.004 + 0.001 * np.cos(time / (7.0 + number))
        frame = pd.DataFrame(
            {
                "date": dates.strftime("%Y-%m-%d"),
                "open": open_price,
                "high": np.maximum(open_price, close) * (1.0 + spread),
                "low": np.minimum(open_price, close) * (1.0 - spread),
                "close": close,
                "volume": (
                    1_000_000.0
                    * (1.0 + number * 0.15)
                    * np.exp(
                        0.35 * np.sin(time / (8.0 + number) + number)
                    )
                ),
            }
        )
        filename = f"{symbol}.csv"
        frame.to_csv(source / filename, index=False)
        asset_entries.append(
            {
                "symbol": symbol,
                "venue": "US-COMPOSITE",
                "currency": "USD",
                "path": filename,
            }
        )
    package = {
        "schemaVersion": 1,
        "kind": "autoquant-ohlcv-dataset-package",
        "id": dataset_id,
        "version": dataset_version,
        "assetClass": "equity",
        "frequency": "1d",
        "market": {
            "clock": "session",
            "calendar": "XNYS",
            "timezone": "America/New_York",
        },
        "priceAdjustment": "provider-adjusted",
        "provider": {
            "name": "deterministic-test-provider",
            "retrievedAt": "2026-07-24T00:00:00Z",
            "sourceUri": None,
            "terms": "test fixture only",
        },
        "assets": asset_entries,
    }
    package_path = source / "dataset.json"
    package_path.write_text(
        json.dumps(package, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    request = {
        "schemaVersion": 1,
        "kind": "autoquant-research-request",
        "title": "US leadership durability",
        "question": "Does relative activity support a costed long allocation?",
        "decisionContext": "OpenAlice is reviewing a medium-term equity posture.",
        "assets": [
            {
                "symbol": symbol,
                "assetClass": "equity",
                "venue": "US-COMPOSITE",
                **(
                    {"positionRole": asset_position_roles[symbol]}
                    if asset_position_roles is not None
                    else {}
                ),
            }
            for symbol in request_assets
        ],
        "direction": "long",
        **(
            {"benchmarkPolicy": benchmark_policy}
            if benchmark_policy is not None
            else {}
        ),
        **(
            {"portfolioPolicy": portfolio_policy}
            if portfolio_policy is not None
            else {}
        ),
        **(
            {"horizonPolicy": horizon_policy}
            if horizon_policy is not None
            else {}
        ),
        **(
            {"factorPolicy": normalized_factor_policy}
            if normalized_factor_policy is not None
            else {}
        ),
        "horizon": "one to four weeks",
        "hypotheses": ["Relative activity may identify persistent leadership."],
        "constraints": ["No live trading authority."],
        "deliverables": ["Factor and portfolio evidence", "Decision-support report"],
        "source": {
            "system": "openalice",
            "workspaceId": "workspace-equities",
            "sessionId": "session-intake",
            "artifactPath": "research/us-leadership.md",
            "artifactRevision": "sha256:test-request",
        },
    }
    request_path = root / "request.json"
    request_path.write_text(
        json.dumps(request, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return request_path, package_path


def write_multi_interval_inputs(
    root: Path,
    *,
    observations: int = 288,
    assets: tuple[str, ...] = ("BTC", "ETH", "SOL", "XRP", "ADA"),
    horizon_policy: dict[str, object] | None = None,
) -> tuple[Path, Path]:
    source = root / "external-hourly-data"
    source.mkdir()
    timestamps = pd.date_range(
        "2026-01-01T01:00:00Z",
        periods=observations,
        freq="1h",
    )
    time = np.arange(observations, dtype=float)
    asset_entries = []
    for number, symbol in enumerate(assets):
        log_returns = (
            0.00008
            + 0.0025 * np.sin(time / (9.0 + number))
            + 0.0012 * np.cos(time / (21.0 + number))
        )
        close = (80.0 + number * 17.0) * np.exp(np.cumsum(log_returns))
        open_price = close * np.exp(-0.001 * np.sin(time / (4.0 + number)))
        spread = 0.0025 + 0.0005 * np.cos(time / (8.0 + number))
        frame = pd.DataFrame(
            {
                "timestamp": timestamps.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "open": open_price,
                "high": np.maximum(open_price, close) * (1.0 + spread),
                "low": np.minimum(open_price, close) * (1.0 - spread),
                "close": close,
                "volume": (
                    2_000_000.0
                    * (1.0 + number * 0.18)
                    * np.exp(0.25 * np.sin(time / (13.0 + number)))
                ),
            }
        )
        filename = f"{symbol}.csv"
        frame.to_csv(source / filename, index=False)
        asset_entries.append(
            {
                "symbol": symbol,
                "venue": "CRYPTO-COMPOSITE",
                "currency": "USD",
                "path": filename,
            }
        )
    package = {
        "schemaVersion": 2,
        "kind": "autoquant-ohlcv-dataset-package",
        "id": "bounded-crypto-hourly",
        "version": "2026-v1",
        "assetClass": "crypto",
        "baseInterval": "1h",
        "featureIntervals": ["3h", "4h", "6h", "12h", "1d"],
        "timestampSemantics": "bar-close",
        "aggregation": {
            "method": "complete-utc-midnight-bar-close-v1",
            "anchor": "00:00",
        },
        "market": {
            "clock": "continuous",
            "calendar": "24/7",
            "timezone": "UTC",
        },
        "priceAdjustment": "raw",
        "provider": {
            "name": "deterministic-hourly-test-provider",
            "retrievedAt": "2026-07-26T00:00:00Z",
            "sourceUri": None,
            "terms": "test fixture only",
        },
        "assets": asset_entries,
    }
    package_path = source / "dataset.json"
    package_path.write_text(
        json.dumps(package, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    request = {
        "schemaVersion": 1,
        "kind": "autoquant-research-request",
        "title": "Crypto multi-horizon persistence",
        "question": "Do completed higher-horizon bars improve hourly ranking?",
        "decisionContext": "OpenAlice is reviewing a conditional crypto posture.",
        "assets": [
            {
                "symbol": "BTC",
                "assetClass": "crypto",
                "venue": "CRYPTO-COMPOSITE",
            },
            {
                "symbol": "ETH",
                "assetClass": "crypto",
                "venue": "CRYPTO-COMPOSITE",
            },
        ],
        "direction": "long",
        **(
            {"horizonPolicy": horizon_policy}
            if horizon_policy is not None
            else {}
        ),
        "horizon": "one day to four weeks",
        "hypotheses": [
            "Completed daily and intraday trends may add causal information."
        ],
        "constraints": ["Use only completed bars and no live trading authority."],
        "deliverables": ["Multi-interval factor and portfolio evidence"],
        "source": {
            "system": "openalice",
            "workspaceId": "workspace-crypto",
            "sessionId": "session-multi-interval",
            "artifactPath": "research/crypto-multi-horizon.md",
            "artifactRevision": "sha256:test-multi-interval-request",
        },
    }
    request_path = root / "request.json"
    request_path.write_text(
        json.dumps(request, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return request_path, package_path


def write_observed_intraday_inputs(
    root: Path,
    *,
    observations: int = 420,
) -> tuple[Path, Path]:
    """Write one ragged future/index hourly panel with zero index volume."""

    source = root / "external-observed-hourly-data"
    source.mkdir()
    complete = pd.date_range(
        "2026-01-01T01:00:00Z",
        periods=observations,
        freq="1h",
    )
    gold_timestamps = complete[
        np.arange(observations) % 17 != 0
    ]
    assets = (
        (
            "GC=F",
            "future",
            "CMX",
            gold_timestamps,
            "provider-reported-nonnegative",
        ),
        (
            "DX-Y.NYB",
            "index",
            "NYB",
            complete,
            "unavailable-zero",
        ),
    )
    entries = []
    for number, (
        symbol,
        asset_class,
        venue,
        timestamps,
        volume_semantics,
    ) in enumerate(assets):
        time = np.arange(len(timestamps), dtype=float)
        returns = (
            0.0001
            + 0.002 * np.sin(time / (8.0 + number))
            + 0.001 * np.cos(time / (19.0 + number))
        )
        close = (100.0 + number * 20.0) * np.exp(np.cumsum(returns))
        open_price = close * np.exp(-0.0007 * np.sin(time / 5.0))
        spread = 0.002 + 0.0003 * np.cos(time / 11.0)
        frame = pd.DataFrame(
            {
                "timestamp": [
                    value.isoformat().replace("+00:00", "Z")
                    for value in timestamps
                ],
                "open": open_price,
                "high": np.maximum(open_price, close) * (1.0 + spread),
                "low": np.minimum(open_price, close) * (1.0 - spread),
                "close": close,
                "volume": (
                    1000.0 + 100.0 * np.sin(time / 7.0)
                    if volume_semantics
                    == "provider-reported-nonnegative"
                    else np.zeros(len(time))
                ),
            }
        )
        filename = (
            "GC%3DF.csv" if symbol == "GC=F" else f"{symbol}.csv"
        )
        frame.to_csv(source / filename, index=False)
        entries.append(
            {
                "symbol": symbol,
                "assetClass": asset_class,
                "venue": venue,
                "currency": "USD",
                "path": filename,
                "volumeSemantics": volume_semantics,
            }
        )
    package = {
        "schemaVersion": 5,
        "kind": "autoquant-ohlcv-dataset-package",
        "id": "bounded-gold-dollar-observed-hourly",
        "version": "2026-v1",
        "assetClass": "mixed",
        "baseInterval": "1h",
        "timestampSemantics": "bar-close",
        "panelPolicy": {
            "alignment": "observed-only",
            "missingObservation": "absent-no-fill",
            "horizonClock": "per-target-observed-bars",
        },
        "market": {
            "clock": "observed",
            "calendar": "provider-observed",
            "timezone": "UTC",
        },
        "priceAdjustment": "raw",
        "provider": {
            "name": "deterministic-observed-test-provider",
            "retrievedAt": "2026-07-29T00:00:00Z",
            "sourceUri": None,
            "terms": "test fixture only",
        },
        "assets": entries,
    }
    package_path = source / "dataset.json"
    package_path.write_text(
        json.dumps(package, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    request = {
        "schemaVersion": 1,
        "kind": "autoquant-research-request",
        "title": "Gold timing with dollar context",
        "question": "Does observed dollar context improve long gold timing?",
        "decisionContext": "OpenAlice is reviewing a research-only gold posture.",
        "assets": [
            {
                "symbol": "GC=F",
                "assetClass": "future",
                "venue": "CMX",
                "positionRole": "long-only",
            },
            {
                "symbol": "DX-Y.NYB",
                "assetClass": "index",
                "venue": "NYB",
                "positionRole": "context-only",
            },
        ],
        "direction": "long",
        "factorPolicy": {
            "claim": "decision-signal",
            "knownStyle": None,
            "predictionAssets": ["GC=F"],
        },
        "horizonPolicy": {
            "primaryForwardBars": 24,
            "diagnosticForwardBars": [6, 12, 24, 48],
        },
        "horizon": "Twenty-four subsequent observed gold bars.",
        "hypotheses": [
            "Causal dollar index context may improve temporal gold evidence."
        ],
        "constraints": [
            "Do not fill closures or infer contract-chain authority."
        ],
        "deliverables": ["Temporal Factor evidence"],
        "source": {
            "system": "openalice",
            "workspaceId": "workspace-gold",
            "sessionId": "session-observed-hourly",
            "artifactPath": None,
            "artifactRevision": None,
        },
    }
    request_path = root / "request.json"
    request_path.write_text(
        json.dumps(request, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return request_path, package_path


def write_cross_market_daily_inputs(
    root: Path,
    *,
    observations: int = 220,
) -> tuple[Path, Path]:
    """Write a causal Tokyo-target/New-York-context daily V5 panel.

    The target closes at 06:00Z and the context closes later at 21:00Z on
    each shared business date.  Toyota's next observed return is driven by
    the most recent *completed* SPY return, which is the prior business
    date's New York close when evaluated at the Tokyo close.
    """

    source = root / "external-cross-market-daily-data"
    source.mkdir()
    dates = pd.bdate_range("2024-01-02", periods=observations)
    context_timestamps = dates.tz_localize("UTC") + pd.Timedelta(hours=21)
    target_timestamps = dates.tz_localize("UTC") + pd.Timedelta(hours=6)
    time = np.arange(observations, dtype=float)

    context_log_returns = (
        0.00015
        + 0.0080 * np.sin(time / 7.0)
        + 0.0040 * np.cos(time / 3.0)
    )
    context_close = 100.0 * np.exp(np.cumsum(context_log_returns))

    target_log_returns = np.zeros(observations, dtype=float)
    target_log_returns[1] = 0.0001
    target_log_returns[2:] = (
        0.70 * context_log_returns[:-2]
        + 0.00015 * np.sin(time[2:] / 5.0)
    )
    target_close = 2_500.0 * np.exp(np.cumsum(target_log_returns))

    assets = (
        (
            "7203.T",
            "equity",
            "XTKS",
            "JPY",
            target_timestamps,
            target_close,
        ),
        (
            "SPY",
            "fund",
            "XNYS",
            "USD",
            context_timestamps,
            context_close,
        ),
    )
    entries = []
    for number, (
        symbol,
        asset_class,
        venue,
        currency,
        timestamps,
        close,
    ) in enumerate(assets):
        open_price = close * np.exp(-0.0005 * np.sin(time / (4.0 + number)))
        spread = 0.0020 + 0.0002 * np.cos(time / (8.0 + number))
        frame = pd.DataFrame(
            {
                "timestamp": timestamps.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "open": open_price,
                "high": np.maximum(open_price, close) * (1.0 + spread),
                "low": np.minimum(open_price, close) * (1.0 - spread),
                "close": close,
                "volume": (
                    1_000_000.0
                    * (1.0 + number * 0.5)
                    * np.exp(0.10 * np.sin(time / (9.0 + number)))
                ),
            }
        )
        filename = f"{symbol}.csv"
        frame.to_csv(source / filename, index=False)
        entries.append(
            {
                "symbol": symbol,
                "assetClass": asset_class,
                "venue": venue,
                "currency": currency,
                "path": filename,
                "volumeSemantics": "provider-reported-nonnegative",
            }
        )

    package = {
        "schemaVersion": 5,
        "kind": "autoquant-ohlcv-dataset-package",
        "id": "close-time-cross-market-daily",
        "version": "2024-v1",
        "assetClass": "mixed",
        "baseInterval": "1d",
        "timestampSemantics": "bar-close",
        "panelPolicy": {
            "alignment": "observed-only",
            "missingObservation": "absent-no-fill",
            "horizonClock": "per-target-observed-bars",
        },
        "market": {
            "clock": "observed",
            "calendar": "provider-observed",
            "timezone": "UTC",
        },
        "priceAdjustment": "provider-adjusted",
        "provider": {
            "name": "deterministic-cross-market-test-provider",
            "retrievedAt": "2026-08-02T00:00:00Z",
            "sourceUri": None,
            "terms": "test fixture only; timestamps are asserted bar closes",
        },
        "assets": entries,
    }
    package_path = source / "dataset.json"
    package_path.write_text(
        json.dumps(package, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    request = {
        "schemaVersion": 1,
        "kind": "autoquant-research-request",
        "title": "Tokyo timing with completed New York context",
        "question": (
            "Does the latest completed SPY daily return available at the "
            "Toyota close predict Toyota's next observed close return?"
        ),
        "decisionContext": (
            "OpenAlice is reviewing a research-only Toyota posture before "
            "New York has closed on the same civil date."
        ),
        "assets": [
            {
                "symbol": "7203.T",
                "assetClass": "equity",
                "venue": "XTKS",
                "positionRole": "long-only",
            },
            {
                "symbol": "SPY",
                "assetClass": "fund",
                "venue": "XNYS",
                "positionRole": "context-only",
            },
        ],
        "direction": "long",
        "factorPolicy": {
            "claim": "decision-signal",
            "knownStyle": None,
            "predictionAssets": ["7203.T"],
        },
        "horizonPolicy": {
            "primaryForwardBars": 1,
            "diagnosticForwardBars": [1, 5],
        },
        "horizon": "The next observed Toyota close.",
        "hypotheses": [
            "The latest completed New York return may carry into the next "
            "Tokyo close without using the later same-date New York close."
        ],
        "constraints": [
            "Use only completed close observations at or before each target "
            "timestamp; do not fill absent context or infer trading authority."
        ],
        "deliverables": ["Causal temporal Factor evidence"],
        "source": {
            "system": "openalice",
            "workspaceId": "workspace-cross-market",
            "sessionId": "session-cross-market-daily",
            "artifactPath": None,
            "artifactRevision": None,
        },
    }
    request_path = root / "request.json"
    request_path.write_text(
        json.dumps(request, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return request_path, package_path


def write_session_interval_inputs(
    root: Path,
    *,
    sessions: int = 45,
    assets: tuple[str, ...] = INTAKE_ASSETS,
    horizon_policy: dict[str, object] | None = None,
    portfolio_policy: dict[str, object] | None = None,
    base_interval: str = "1h",
    calendar_start: str = "2026-09-28",
) -> tuple[Path, Path]:
    """Write deterministic XNYS bars, including terminal partial bars."""

    interval_delta = {
        "15m": pd.Timedelta(minutes=15),
        "1h": pd.Timedelta(hours=1),
    }.get(base_interval)
    if interval_delta is None:
        raise ValueError("test XNYS fixture supports 15m or 1h bases")
    feature_intervals = (
        ["1h", "3h", "1d"]
        if base_interval == "15m"
        else ["3h", "1d"]
    )
    source = root / f"external-xnys-{base_interval}-data"
    source.mkdir()
    calendar = xcals.get_calendar(
        "XNYS",
        start=calendar_start,
        end="2026-12-15",
    )
    schedule = calendar.schedule.iloc[:sessions]
    timestamps: list[pd.Timestamp] = []
    for row in schedule.itertuples():
        bar_close = row.open + interval_delta
        while bar_close < row.close:
            timestamps.append(bar_close)
            bar_close += interval_delta
        timestamps.append(row.close)
    time = np.arange(len(timestamps), dtype=float)
    asset_entries = []
    for number, symbol in enumerate(assets):
        log_returns = (
            0.00006
            + 0.0018 * np.sin(time / (11.0 + number))
            + 0.0009 * np.cos(time / (23.0 + number))
        )
        close = (95.0 + number * 24.0) * np.exp(np.cumsum(log_returns))
        open_price = close * np.exp(-0.0008 * np.sin(time / (5.0 + number)))
        spread = 0.0018 + 0.0004 * np.cos(time / (9.0 + number))
        frame = pd.DataFrame(
            {
                "timestamp": [
                    stamp.isoformat().replace("+00:00", "Z")
                    for stamp in timestamps
                ],
                "open": open_price,
                "high": np.maximum(open_price, close) * (1.0 + spread),
                "low": np.minimum(open_price, close) * (1.0 - spread),
                "close": close,
                "volume": (
                    1_500_000.0
                    * (1.0 + number * 0.12)
                    * np.exp(0.22 * np.sin(time / (15.0 + number)))
                ),
            }
        )
        filename = f"{symbol}.csv"
        frame.to_csv(source / filename, index=False)
        asset_entries.append(
            {
                "symbol": symbol,
                "venue": "XNYS",
                "currency": "USD",
                "path": filename,
            }
        )
    package = {
        "schemaVersion": 3,
        "kind": "autoquant-ohlcv-dataset-package",
        "id": f"bounded-xnys-{base_interval}",
        "version": "2026-v1",
        "assetClass": "equity",
        "baseInterval": base_interval,
        "featureIntervals": feature_intervals,
        "timestampSemantics": "bar-close",
        "aggregation": {
            "method": "complete-xnys-regular-session-bar-close-v1",
            "anchor": "market-open",
            "terminalBucketPolicy": "complete-at-session-close",
        },
        "market": {
            "clock": "session",
            "calendar": "XNYS",
            "timezone": "America/New_York",
        },
        "priceAdjustment": "provider-adjusted",
        "provider": {
            "name": "deterministic-xnys-test-provider",
            "retrievedAt": "2026-07-27T00:00:00Z",
            "sourceUri": None,
            "terms": "test fixture only",
        },
        "assets": asset_entries,
    }
    package_path = source / "dataset.json"
    package_path.write_text(
        json.dumps(package, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    request = {
        "schemaVersion": 1,
        "kind": "autoquant-research-request",
        "title": "US intraday leadership durability",
        "question": "Do completed session bars improve equity ranking?",
        "decisionContext": "OpenAlice is reviewing a conditional equity posture.",
        "assets": [
            {"symbol": "AAPL", "assetClass": "equity", "venue": "XNYS"},
            {"symbol": "MSFT", "assetClass": "equity", "venue": "XNYS"},
        ],
        "direction": "long",
        **(
            {"portfolioPolicy": portfolio_policy}
            if portfolio_policy is not None
            else {}
        ),
        **(
            {"horizonPolicy": horizon_policy}
            if horizon_policy is not None
            else {}
        ),
        "horizon": "one day to four weeks",
        "hypotheses": ["Completed session trends may add causal information."],
        "constraints": [
            "Use regular-session completed bars and no live trading authority."
        ],
        "deliverables": ["Multi-interval factor and portfolio evidence"],
        "source": {
            "system": "openalice",
            "workspaceId": "workspace-xnys",
            "sessionId": "session-xnys-interval",
            "artifactPath": "research/xnys-multi-horizon.md",
            "artifactRevision": "sha256:test-xnys-interval-request",
        },
    }
    request_path = root / "request.json"
    request_path.write_text(
        json.dumps(request, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return request_path, package_path


def write_configurable_continuous_inputs(
    root: Path,
    *,
    observations: int = 320,
    horizon_policy: dict[str, object] | None = None,
) -> tuple[Path, Path]:
    """Adapt the deterministic crypto fixture to a V3 15-minute base."""

    request_path, package_path = write_multi_interval_inputs(
        root,
        observations=observations,
        horizon_policy=horizon_policy,
    )
    package = json.loads(package_path.read_text(encoding="utf-8"))
    timestamps = pd.date_range(
        "2026-01-01T00:15:00Z",
        periods=observations,
        freq="15min",
    )
    for asset in package["assets"]:
        path = package_path.parent / asset["path"]
        frame = pd.read_csv(path)
        frame["timestamp"] = timestamps.strftime("%Y-%m-%dT%H:%M:%SZ")
        frame.to_csv(path, index=False)
    package.update(
        {
            "schemaVersion": 3,
            "id": "bounded-crypto-fifteen-minute",
            "baseInterval": "15m",
            "featureIntervals": ["30m", "1h", "4h"],
            "aggregation": {
                "method": "complete-continuous-utc-midnight-bar-close-v2",
                "anchor": "00:00",
                "terminalBucketPolicy": "omit-incomplete",
            },
        }
    )
    package_path.write_text(
        json.dumps(package, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return request_path, package_path
