"""Fixed reported-book historical path stress judge."""

from __future__ import annotations

import csv
import json
import math
import os
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from autoquant.book_path_stress import (
    BOOK_PATH_STRESS_POLICY,
    load_book_path_stress_policy,
)
from autoquant.intervals import IntervalContractError, load_multi_interval_asset, timestamp_label
from autoquant.position_snapshots import POSITION_SNAPSHOT, load_position_snapshot


REPORT_KIND = "autoquant-book-path-stress-report"
REQUIRED_COLUMNS = ("timestamp", "open", "high", "low", "close", "volume")
WINDOW_COLUMNS = (
    "windowIndex", "startTimestamp", "endTimestamp", "terminalBookReturn",
    "worstInterimBookReturn", "worstInterimTimestamp", "selectedRank",
)
EPISODE_COLUMNS = (
    "rank", "startTimestamp", "endTimestamp", "terminalBookReturn",
    "worstInterimBookReturn", "worstInterimTimestamp", "dominantLossContributor",
)
CONTRIBUTION_COLUMNS = (
    "rank", "asset", "openingWeight", "terminalAssetReturn", "terminalContribution",
)
PATH_COLUMNS = (
    "rank", "offsetBars", "timestamp", "bookReturn", "asset", "assetReturn", "contribution",
)


class JudgeFailure(ValueError):
    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


def _write_output(value: dict[str, Any]) -> None:
    Path(os.environ["AUTOQUANT_RUN_OUTPUT"]).write_text(
        json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )


def _write_csv(path: Path, columns: tuple[str, ...], rows: list[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns, lineterminator="\n")
        writer.writeheader()
        for row in rows:
            writer.writerow({key: "" if row.get(key) is None else row.get(key) for key in columns})


def _load_asset(data_root: Path, asset: str, start: str, end: str) -> pd.DataFrame:
    try:
        multi = load_multi_interval_asset(data_root, asset, start=start, end=end)
    except IntervalContractError as error:
        raise JudgeFailure(error.code, str(error)) from error
    if multi is not None:
        frame = multi.loc[:, list(REQUIRED_COLUMNS)].copy()
    else:
        source = (data_root / "ohlcv" / f"{asset}.csv").resolve()
        if data_root not in source.parents or not source.is_file():
            raise JudgeFailure("dataset.asset", f"Missing confined OHLCV for {asset}")
        frame = pd.read_csv(source)
        if tuple(frame.columns) != REQUIRED_COLUMNS:
            raise JudgeFailure("dataset.columns", f"{asset} columns differ from OHLCV contract")
        frame["timestamp"] = pd.to_datetime(frame["timestamp"], errors="raise")
        frame = frame[(frame["timestamp"] >= pd.Timestamp(start)) & (frame["timestamp"] <= pd.Timestamp(end))].copy()
    frame["timestamp"] = pd.to_datetime(frame["timestamp"], errors="raise")
    for column in REQUIRED_COLUMNS[1:]:
        frame[column] = pd.to_numeric(frame[column], errors="raise")
    prices = frame.loc[:, ("open", "high", "low", "close")].to_numpy(dtype=float)
    volume = frame["volume"].to_numpy(dtype=float)
    if (
        frame.empty
        or frame["timestamp"].duplicated().any()
        or not frame["timestamp"].is_monotonic_increasing
        or not np.isfinite(prices).all()
        or (prices <= 0).any()
        or not np.isfinite(volume).all()
        or (volume < 0).any()
    ):
        raise JudgeFailure("dataset.asset", f"{asset} OHLCV is invalid")
    return frame.set_index("timestamp")


def _study() -> tuple[dict[str, Any], Path, Path]:
    study_path = Path(os.environ["AUTOQUANT_STUDY_PATH"])
    try:
        study = json.loads(study_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise JudgeFailure("study.contract", f"Cannot read fixed Study: {error}") from error
    return study, Path(os.environ["AUTOQUANT_PROJECT_ROOT"]).resolve(), Path(os.environ["AUTOQUANT_DATA_ROOT"]).resolve()


def _evaluate() -> tuple[dict[str, Any], dict[str, list[dict[str, Any]]]]:
    study, project_root, data_root = _study()
    try:
        policy = load_book_path_stress_policy(project_root / BOOK_PATH_STRESS_POLICY)
        snapshot = load_position_snapshot(project_root / POSITION_SNAPSHOT)
    except Exception as error:
        raise JudgeFailure("book-path-stress.authority", str(error)) from error
    if snapshot["scenarios"] or snapshot["sizingPolicy"] is not None:
        raise JudgeFailure("book-path-stress.snapshot", "Path Stress accepts the baseline snapshot only")
    dataset = study["dataset"]
    universe = set(dataset["universe"])
    weights = {asset: float(weight) for asset, weight in snapshot["weights"].items()}
    if not set(weights) <= universe:
        raise JudgeFailure("book-path-stress.universe", "Every reported holding must belong to the fixed Study universe")
    frames = {
        asset: _load_asset(data_root, asset, dataset["time_range"]["start"], dataset["time_range"]["end"])
        for asset in weights
    }
    common: pd.DatetimeIndex | None = None
    for frame in frames.values():
        common = frame.index if common is None else common.intersection(frame.index)
    assert common is not None
    common = common.sort_values()
    as_of = pd.Timestamp(snapshot["asOf"])
    if common.tz is None and as_of.tzinfo is not None:
        as_of = as_of.tz_localize(None)
    common = common[common <= as_of]
    holding = int(policy["path"]["holdingBars"])
    requested = int(policy["ranking"]["episodeCount"])
    if len(common) <= holding:
        raise JudgeFailure("book-path-stress.observations", "Dataset has no complete fixed-horizon window")
    closes = np.column_stack([frames[asset].reindex(common)["close"].to_numpy(dtype=float) for asset in weights])
    asset_names = list(weights)
    opening_weights = np.asarray([weights[asset] for asset in asset_names], dtype=float)
    windows: list[dict[str, Any]] = []
    paths_by_start: dict[int, np.ndarray] = {}
    returns_by_start: dict[int, np.ndarray] = {}
    for start in range(len(common) - holding):
        cumulative = closes[start : start + holding + 1] / closes[start] - 1.0
        book_path = cumulative @ opening_weights
        worst_offset = int(np.argmin(book_path))
        returns_by_start[start] = cumulative
        paths_by_start[start] = book_path
        windows.append({
            "windowIndex": start + 1,
            "startPosition": start,
            "endPosition": start + holding,
            "startTimestamp": timestamp_label(common[start]),
            "endTimestamp": timestamp_label(common[start + holding]),
            "terminalBookReturn": float(book_path[-1]),
            "worstInterimBookReturn": float(book_path[worst_offset]),
            "worstInterimTimestamp": timestamp_label(common[start + worst_offset]),
            "selectedRank": None,
        })
    ranked = sorted(windows, key=lambda row: (row["terminalBookReturn"], row["startPosition"]))
    selected: list[dict[str, Any]] = []
    for candidate in ranked:
        if all(
            candidate["endPosition"] < kept["startPosition"]
            or candidate["startPosition"] > kept["endPosition"]
            for kept in selected
        ):
            selected.append(candidate)
            candidate["selectedRank"] = len(selected)
            if len(selected) == requested:
                break
    if len(selected) != requested:
        raise JudgeFailure("book-path-stress.episodes", "Dataset cannot supply the requested non-overlapping episodes")
    episodes: list[dict[str, Any]] = []
    contributions: list[dict[str, Any]] = []
    path_rows: list[dict[str, Any]] = []
    dominants: list[str] = []
    tolerance = float(policy["attribution"]["reconciliationTolerance"])
    for rank, window in enumerate(selected, start=1):
        start = int(window["startPosition"])
        cumulative = returns_by_start[start]
        book_path = paths_by_start[start]
        terminal_contributions = cumulative[-1] * opening_weights
        if not math.isclose(float(terminal_contributions.sum()), float(book_path[-1]), rel_tol=0.0, abs_tol=tolerance):
            raise JudgeFailure("book-path-stress.reconcile", "Terminal attribution does not reconcile")
        dominant_index = int(np.argmin(terminal_contributions))
        dominant = asset_names[dominant_index]
        dominants.append(dominant)
        episodes.append({
            "rank": rank,
            "startTimestamp": window["startTimestamp"],
            "endTimestamp": window["endTimestamp"],
            "terminalBookReturn": window["terminalBookReturn"],
            "worstInterimBookReturn": window["worstInterimBookReturn"],
            "worstInterimTimestamp": window["worstInterimTimestamp"],
            "dominantLossContributor": dominant,
        })
        for asset_index, asset in enumerate(asset_names):
            contributions.append({
                "rank": rank,
                "asset": asset,
                "openingWeight": float(opening_weights[asset_index]),
                "terminalAssetReturn": float(cumulative[-1, asset_index]),
                "terminalContribution": float(terminal_contributions[asset_index]),
            })
        contributions.append({
            "rank": rank,
            "asset": "CASH",
            "openingWeight": float(snapshot["cashWeight"]),
            "terminalAssetReturn": 0.0,
            "terminalContribution": 0.0,
        })
        for offset in range(holding + 1):
            for asset_index, asset in enumerate(asset_names):
                path_rows.append({
                    "rank": rank,
                    "offsetBars": offset,
                    "timestamp": timestamp_label(common[start + offset]),
                    "bookReturn": float(book_path[offset]),
                    "asset": asset,
                    "assetReturn": float(cumulative[offset, asset_index]),
                    "contribution": float(cumulative[offset, asset_index] * opening_weights[asset_index]),
                })
            path_rows.append({
                "rank": rank,
                "offsetBars": offset,
                "timestamp": timestamp_label(common[start + offset]),
                "bookReturn": float(book_path[offset]),
                "asset": "CASH",
                "assetReturn": 0.0,
                "contribution": 0.0,
            })
    report = {
        "schemaVersion": 1,
        "kind": REPORT_KIND,
        "policy": policy,
        "snapshot": snapshot,
        "dataset": {
            "id": dataset["id"],
            "version": dataset["version"],
            "timeRange": dataset["time_range"],
            "alignedObservations": int(len(common)),
            "priceAdjustment": "split-adjusted",
        },
        "summary": {
            "eligibleWindowCount": len(windows),
            "selectedEpisodeCount": len(episodes),
            "worstTerminalBookReturn": episodes[0]["terminalBookReturn"],
            "sameDominantLossContributorAcrossAllEpisodes": len(set(dominants)) == 1,
            "dominantLossContributorAcrossAllEpisodes": dominants[0] if len(set(dominants)) == 1 else None,
        },
        "episodes": episodes,
        "conclusion": {
            "meaning": "descriptive-historical-path-support-only",
            "positionTruth": "external-reported-not-authenticated",
            "forecastAuthority": "none",
            "tradingAuthority": "none",
        },
    }
    public_windows = [{key: value for key, value in row.items() if key not in {"startPosition", "endPosition"}} for row in windows]
    return report, {"windows": public_windows, "episodes": episodes, "contributions": contributions, "paths": path_rows}


def main() -> None:
    try:
        artifacts = Path(os.environ["AUTOQUANT_ARTIFACTS_DIR"]).resolve()
        artifacts.mkdir(parents=True, exist_ok=True)
        report, rows = _evaluate()
        (artifacts / "book-path-stress-report.json").write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        _write_csv(artifacts / "book-path-stress-windows.csv", WINDOW_COLUMNS, rows["windows"])
        _write_csv(artifacts / "book-path-stress-episodes.csv", EPISODE_COLUMNS, rows["episodes"])
        _write_csv(artifacts / "book-path-stress-contributions.csv", CONTRIBUTION_COLUMNS, rows["contributions"])
        _write_csv(artifacts / "book-path-stress-paths.csv", PATH_COLUMNS, rows["paths"])
        summary = report["summary"]
        _write_output({
            "schema_version": 1,
            "status": "succeeded",
            "summary": f"Selected {summary['selectedEpisodeCount']} of {summary['eligibleWindowCount']} complete windows; worst terminal return={summary['worstTerminalBookReturn']}",
            "metrics": {
                "worst_terminal_book_return": float(summary["worstTerminalBookReturn"]),
                "eligible_window_count": int(summary["eligibleWindowCount"]),
                "selected_episode_count": int(summary["selectedEpisodeCount"]),
            },
            "artifacts": [
                {"kind": "book-path-stress-report", "path": "book-path-stress-report.json", "description": "Fixed authority, book, dataset, selected episodes, and bounded conclusion"},
                {"kind": "book-path-stress-windows", "path": "book-path-stress-windows.csv", "description": "Every eligible complete window and selected rank"},
                {"kind": "book-path-stress-episodes", "path": "book-path-stress-episodes.csv", "description": "Worst non-overlapping terminal-loss episodes"},
                {"kind": "book-path-stress-contributions", "path": "book-path-stress-contributions.csv", "description": "Exact terminal holding and cash contributions"},
                {"kind": "book-path-stress-paths", "path": "book-path-stress-paths.csv", "description": "Selected episode paths and point-in-time contributions"},
            ],
            "errors": [],
        })
    except JudgeFailure as error:
        _write_output({"schema_version": 1, "status": "failed", "summary": str(error), "metrics": {}, "artifacts": [], "errors": [{"code": error.code, "message": str(error)}]})
    except Exception as error:
        _write_output({"schema_version": 1, "status": "failed", "summary": f"Path Stress raised {type(error).__name__}", "metrics": {}, "artifacts": [], "errors": [{"code": "book-path-stress.exception", "message": f"{type(error).__name__}: {error}"}]})


if __name__ == "__main__":
    main()
