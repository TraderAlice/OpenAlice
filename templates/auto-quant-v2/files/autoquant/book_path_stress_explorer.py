"""Strict read model for immutable reported-book Path Stress Runs."""

from __future__ import annotations

import csv
import json
import math
from pathlib import Path
from typing import Any

from .book_path_stress import load_book_path_stress_policy
from .position_snapshots import load_position_snapshot
from .runs import load_run
from .workspace import SCHEMA_VERSION, AutoQuantValidationError, ProjectContext, ValidationIssue


BOOK_PATH_STRESS_DIAGNOSTICS_KIND = "autoquant-book-path-stress-diagnostics"
REPORT_KIND = "autoquant-book-path-stress-report"
ARTIFACTS = {
    "book-path-stress-report": "book-path-stress-report.json",
    "book-path-stress-windows": "book-path-stress-windows.csv",
    "book-path-stress-episodes": "book-path-stress-episodes.csv",
    "book-path-stress-contributions": "book-path-stress-contributions.csv",
    "book-path-stress-paths": "book-path-stress-paths.csv",
}
WINDOW_COLUMNS = ("windowIndex", "startTimestamp", "endTimestamp", "terminalBookReturn", "worstInterimBookReturn", "worstInterimTimestamp", "selectedRank")
EPISODE_COLUMNS = ("rank", "startTimestamp", "endTimestamp", "terminalBookReturn", "worstInterimBookReturn", "worstInterimTimestamp", "dominantLossContributor")
CONTRIBUTION_COLUMNS = ("rank", "asset", "openingWeight", "terminalAssetReturn", "terminalContribution")
PATH_COLUMNS = ("rank", "offsetBars", "timestamp", "bookReturn", "asset", "assetReturn", "contribution")


def _issue(path: str | Path, code: str, message: str) -> ValidationIssue:
    return ValidationIssue(str(path), code, message)


def _fail(path: str | Path, code: str, message: str) -> None:
    raise AutoQuantValidationError([_issue(path, code, message)])


def _finite(value: Any, path: str | Path) -> float:
    if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(float(value)):
        _fail(path, "book-path-stress.number", "Expected one finite number")
    return float(value)


def _csv_float(value: str, path: str | Path) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        _fail(path, "book-path-stress.number", "Expected one finite CSV number")
    if not math.isfinite(result):
        _fail(path, "book-path-stress.number", "Expected one finite CSV number")
    return result


def _csv_int(value: str, path: str | Path) -> int:
    try:
        result = int(value)
    except (TypeError, ValueError):
        _fail(path, "book-path-stress.integer", "Expected one CSV integer")
    if str(result) != value:
        _fail(path, "book-path-stress.integer", "Expected canonical CSV integer")
    return result


def _close(left: float, right: float, path: str | Path) -> None:
    if not math.isclose(left, right, rel_tol=1e-9, abs_tol=1e-12):
        _fail(path, "book-path-stress.reconcile", "Derived evidence does not reconcile")


def _rows(path: Path, columns: tuple[str, ...]) -> list[dict[str, str]]:
    try:
        with path.open("r", encoding="utf-8", newline="") as handle:
            reader = csv.DictReader(handle)
            if tuple(reader.fieldnames or ()) != columns:
                _fail(path, "book-path-stress.csv-columns", "CSV columns differ from fixed contract")
            rows = list(reader)
    except OSError as error:
        _fail(path, "book-path-stress.csv", f"Cannot read CSV evidence: {error}")
    if not rows or any(None in row or any(value is None for value in row.values()) for row in rows):
        _fail(path, "book-path-stress.csv-width", "CSV evidence is empty or malformed")
    return rows


def _object(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        _fail(path, "book-path-stress.json", f"Cannot read JSON evidence: {error}")
    if not isinstance(value, dict):
        _fail(path, "book-path-stress.type", "JSON evidence must be an object")
    return value


def load_book_path_stress_diagnostics(project: ProjectContext, run_id: str) -> dict[str, Any]:
    """Verify selection, path arithmetic, attribution, and report identity."""

    run = load_run(project, run_id)
    if run.result["status"] != "succeeded" or run.result["study"]["id"] != "ohlcv-book-path-stress":
        _fail(run.root_dir, "book-path-stress.study", "Run is not a successful Path Stress Study")
    declared = {item["kind"]: item["path"] for item in run.result["artifacts"]}
    if set(declared) != set(ARTIFACTS):
        _fail(run.root_dir, "book-path-stress.artifacts", "Artifact inventory differs from fixed contract")
    paths: dict[str, Path] = {}
    for kind, filename in ARTIFACTS.items():
        expected = f"artifacts/{filename}"
        if declared[kind] != expected:
            _fail(run.root_dir / declared[kind], "book-path-stress.artifact-path", "Artifact path differs from fixed contract")
        paths[kind] = run.root_dir / expected
    dependencies = run.root_dir / "inputs" / "dependency-sources" / "strategies"
    policy = load_book_path_stress_policy(dependencies / "book-path-stress.json")
    snapshot = load_position_snapshot(dependencies / "position-snapshot.json")
    report = _object(paths["book-path-stress-report"])
    if set(report) != {"schemaVersion", "kind", "policy", "snapshot", "dataset", "summary", "episodes", "conclusion"}:
        _fail(paths["book-path-stress-report"], "book-path-stress.report-schema", "Report fields differ from fixed contract")
    if report["schemaVersion"] != SCHEMA_VERSION or report["kind"] != REPORT_KIND or report["policy"] != policy or report["snapshot"] != snapshot:
        _fail(paths["book-path-stress-report"], "book-path-stress.report", "Report identity or frozen authority is invalid")
    dataset = report["dataset"]
    if (
        not isinstance(dataset, dict)
        or set(dataset) != {"id", "version", "timeRange", "alignedObservations", "priceAdjustment"}
        or dataset["id"] != run.result["dataset"]["id"]
        or dataset["version"] != run.result["dataset"]["version"]
        or dataset["timeRange"] != run.result["dataset"]["time_range"]
        or dataset["priceAdjustment"] != "split-adjusted"
        or not isinstance(dataset["alignedObservations"], int)
        or isinstance(dataset["alignedObservations"], bool)
    ):
        _fail(paths["book-path-stress-report"], "book-path-stress.dataset", "Dataset does not reconcile with immutable Run")
    holding = int(policy["path"]["holdingBars"])
    expected_window_count = dataset["alignedObservations"] - holding
    raw_windows = _rows(paths["book-path-stress-windows"], WINDOW_COLUMNS)
    if len(raw_windows) != expected_window_count or expected_window_count < 1:
        _fail(paths["book-path-stress-windows"], "book-path-stress.window-count", "Complete window count is invalid")
    windows: list[dict[str, Any]] = []
    for index, row in enumerate(raw_windows, start=1):
        path = f"{paths['book-path-stress-windows']}/{index + 1}"
        if _csv_int(row["windowIndex"], path) != index:
            _fail(path, "book-path-stress.window-index", "Window indices must be sequential")
        selected_rank = None if row["selectedRank"] == "" else _csv_int(row["selectedRank"], path)
        worst = _csv_float(row["worstInterimBookReturn"], path)
        terminal = _csv_float(row["terminalBookReturn"], path)
        if worst > min(0.0, terminal) + 1e-12:
            _fail(path, "book-path-stress.interim", "Worst interim return cannot exceed start or terminal return")
        windows.append({
            "windowIndex": index,
            "startPosition": index - 1,
            "endPosition": index - 1 + holding,
            "startTimestamp": row["startTimestamp"],
            "endTimestamp": row["endTimestamp"],
            "terminalBookReturn": terminal,
            "worstInterimBookReturn": worst,
            "worstInterimTimestamp": row["worstInterimTimestamp"],
            "selectedRank": selected_rank,
        })
    starts = [row["startTimestamp"] for row in windows]
    if starts != sorted(starts) or len(starts) != len(set(starts)):
        _fail(paths["book-path-stress-windows"], "book-path-stress.timeline", "Window starts are not one strict timeline")
    ranked = sorted(windows, key=lambda row: (row["terminalBookReturn"], row["startPosition"]))
    expected_selected: list[dict[str, Any]] = []
    requested = int(policy["ranking"]["episodeCount"])
    for candidate in ranked:
        if all(candidate["endPosition"] < kept["startPosition"] or candidate["startPosition"] > kept["endPosition"] for kept in expected_selected):
            expected_selected.append(candidate)
            if len(expected_selected) == requested:
                break
    if len(expected_selected) != requested:
        _fail(paths["book-path-stress-windows"], "book-path-stress.episodes", "Requested episodes cannot be selected")
    expected_ranks = {row["windowIndex"]: rank for rank, row in enumerate(expected_selected, start=1)}
    if any(row["selectedRank"] != expected_ranks.get(row["windowIndex"]) for row in windows):
        _fail(paths["book-path-stress-windows"], "book-path-stress.selection", "Greedy ranking or overlap selection is invalid")
    raw_episodes = _rows(paths["book-path-stress-episodes"], EPISODE_COLUMNS)
    if len(raw_episodes) != requested:
        _fail(paths["book-path-stress-episodes"], "book-path-stress.episode-count", "Selected episode count differs from policy")
    episodes: list[dict[str, Any]] = []
    for rank, (row, selected) in enumerate(zip(raw_episodes, expected_selected), start=1):
        path = f"{paths['book-path-stress-episodes']}/{rank + 1}"
        episode = {
            "rank": _csv_int(row["rank"], path),
            "startTimestamp": row["startTimestamp"],
            "endTimestamp": row["endTimestamp"],
            "terminalBookReturn": _csv_float(row["terminalBookReturn"], path),
            "worstInterimBookReturn": _csv_float(row["worstInterimBookReturn"], path),
            "worstInterimTimestamp": row["worstInterimTimestamp"],
            "dominantLossContributor": row["dominantLossContributor"],
        }
        if episode["rank"] != rank or episode["startTimestamp"] != selected["startTimestamp"] or episode["endTimestamp"] != selected["endTimestamp"] or episode["worstInterimTimestamp"] != selected["worstInterimTimestamp"]:
            _fail(path, "book-path-stress.episode", "Episode identity differs from selected window")
        _close(episode["terminalBookReturn"], selected["terminalBookReturn"], path)
        _close(episode["worstInterimBookReturn"], selected["worstInterimBookReturn"], path)
        episodes.append(episode)
    assets = list(snapshot["weights"]) + ["CASH"]
    weights = {**{key: float(value) for key, value in snapshot["weights"].items()}, "CASH": float(snapshot["cashWeight"])}
    raw_contributions = _rows(paths["book-path-stress-contributions"], CONTRIBUTION_COLUMNS)
    if len(raw_contributions) != requested * len(assets):
        _fail(paths["book-path-stress-contributions"], "book-path-stress.contribution-count", "Contribution ledger cardinality is invalid")
    contributions: list[dict[str, Any]] = []
    for rank in range(1, requested + 1):
        group = raw_contributions[(rank - 1) * len(assets) : rank * len(assets)]
        parsed: list[dict[str, Any]] = []
        for row in group:
            path = f"{paths['book-path-stress-contributions']}/{len(contributions) + len(parsed) + 2}"
            item = {
                "rank": _csv_int(row["rank"], path), "asset": row["asset"],
                "openingWeight": _csv_float(row["openingWeight"], path),
                "terminalAssetReturn": _csv_float(row["terminalAssetReturn"], path),
                "terminalContribution": _csv_float(row["terminalContribution"], path),
            }
            if item["rank"] != rank or item["asset"] not in assets:
                _fail(path, "book-path-stress.contribution", "Contribution identity is invalid")
            _close(item["openingWeight"], weights[item["asset"]], path)
            _close(item["terminalContribution"], item["openingWeight"] * item["terminalAssetReturn"], path)
            if item["asset"] == "CASH" and (item["terminalAssetReturn"] != 0.0 or item["terminalContribution"] != 0.0):
                _fail(path, "book-path-stress.cash", "Cash return and contribution must be zero")
            parsed.append(item)
        if {item["asset"] for item in parsed} != set(assets):
            _fail(paths["book-path-stress-contributions"], "book-path-stress.contribution-assets", "Contribution assets differ from frozen book")
        _close(sum(item["terminalContribution"] for item in parsed), episodes[rank - 1]["terminalBookReturn"], paths["book-path-stress-contributions"])
        dominant = min((item for item in parsed if item["asset"] != "CASH"), key=lambda item: item["terminalContribution"])["asset"]
        if dominant != episodes[rank - 1]["dominantLossContributor"]:
            _fail(paths["book-path-stress-contributions"], "book-path-stress.dominant", "Dominant loss contributor is invalid")
        contributions.extend(parsed)
    raw_paths = _rows(paths["book-path-stress-paths"], PATH_COLUMNS)
    expected_path_count = requested * (holding + 1) * len(assets)
    if len(raw_paths) != expected_path_count:
        _fail(paths["book-path-stress-paths"], "book-path-stress.path-count", "Path ledger cardinality is invalid")
    path_points: list[dict[str, Any]] = []
    cursor = 0
    for rank in range(1, requested + 1):
        for offset in range(holding + 1):
            group = raw_paths[cursor : cursor + len(assets)]
            cursor += len(assets)
            parsed = []
            for row in group:
                path = f"{paths['book-path-stress-paths']}/{cursor + 1}"
                item = {
                    "rank": _csv_int(row["rank"], path), "offsetBars": _csv_int(row["offsetBars"], path),
                    "timestamp": row["timestamp"], "bookReturn": _csv_float(row["bookReturn"], path),
                    "asset": row["asset"], "assetReturn": _csv_float(row["assetReturn"], path),
                    "contribution": _csv_float(row["contribution"], path),
                }
                if item["rank"] != rank or item["offsetBars"] != offset or item["asset"] not in assets:
                    _fail(path, "book-path-stress.path", "Path point identity is invalid")
                _close(item["contribution"], weights[item["asset"]] * item["assetReturn"], path)
                parsed.append(item)
            if {item["asset"] for item in parsed} != set(assets) or len({item["timestamp"] for item in parsed}) != 1 or len({item["bookReturn"] for item in parsed}) != 1:
                _fail(paths["book-path-stress-paths"], "book-path-stress.path-group", "Path point group is inconsistent")
            _close(sum(item["contribution"] for item in parsed), parsed[0]["bookReturn"], paths["book-path-stress-paths"])
            if offset == 0 and any(abs(item["assetReturn"]) > 1e-12 for item in parsed):
                _fail(paths["book-path-stress-paths"], "book-path-stress.path-origin", "Every selected path must begin at zero")
            path_points.append({"rank": rank, "offsetBars": offset, "timestamp": parsed[0]["timestamp"], "bookReturn": parsed[0]["bookReturn"]})
        episode_points = [item for item in path_points if item["rank"] == rank]
        worst = min(episode_points, key=lambda item: (item["bookReturn"], item["offsetBars"]))
        terminal = episode_points[-1]
        _close(terminal["bookReturn"], episodes[rank - 1]["terminalBookReturn"], paths["book-path-stress-paths"])
        _close(worst["bookReturn"], episodes[rank - 1]["worstInterimBookReturn"], paths["book-path-stress-paths"])
        if worst["timestamp"] != episodes[rank - 1]["worstInterimTimestamp"]:
            _fail(paths["book-path-stress-paths"], "book-path-stress.interim-time", "Worst interim timestamp is invalid")
    dominants = [item["dominantLossContributor"] for item in episodes]
    summary = {
        "eligibleWindowCount": len(windows),
        "selectedEpisodeCount": len(episodes),
        "worstTerminalBookReturn": episodes[0]["terminalBookReturn"],
        "sameDominantLossContributorAcrossAllEpisodes": len(set(dominants)) == 1,
        "dominantLossContributorAcrossAllEpisodes": dominants[0] if len(set(dominants)) == 1 else None,
    }
    conclusion = {
        "meaning": "descriptive-historical-path-support-only",
        "positionTruth": "external-reported-not-authenticated",
        "forecastAuthority": "none",
        "tradingAuthority": "none",
    }
    if report["summary"] != summary or report["episodes"] != episodes or report["conclusion"] != conclusion:
        _fail(paths["book-path-stress-report"], "book-path-stress.report-reconcile", "Report does not reconcile with ledgers")
    expected_metrics = {"worst_terminal_book_return": summary["worstTerminalBookReturn"], "eligible_window_count": len(windows), "selected_episode_count": len(episodes)}
    if set(run.result["metrics"]) != set(expected_metrics):
        _fail(run.root_dir, "book-path-stress.metrics", "Run metrics differ from fixed contract")
    for key, expected in expected_metrics.items():
        _close(_finite(run.result["metrics"][key], f"{run.root_dir}/metrics/{key}"), float(expected), key)
    return {
        "schemaVersion": SCHEMA_VERSION,
        "kind": BOOK_PATH_STRESS_DIAGNOSTICS_KIND,
        "run": {"id": run.result["id"], "status": run.result["status"], "harness": run.result["harness"], "durationMs": run.result["durationMs"]},
        "dataset": dataset,
        "policy": policy,
        "snapshot": snapshot,
        "summary": summary,
        "episodes": episodes,
        "contributions": contributions,
        "paths": path_points,
        "artifacts": {kind: {"path": declared[kind], "description": next(item["description"] for item in run.result["artifacts"] if item["kind"] == kind)} for kind in ARTIFACTS},
        "warning": "Historical fixed-unit path evidence only; the reported book is unauthenticated and no forecast, account, Order, or trading authority is granted.",
    }


BOOK_PATH_STRESS_DIAGNOSTICS_JSON_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "AutoQuant reported-book Path Stress diagnostics",
    "type": "object",
    "additionalProperties": False,
    "required": ["schemaVersion", "kind", "run", "dataset", "policy", "snapshot", "summary", "episodes", "contributions", "paths", "artifacts", "warning"],
    "properties": {
        "schemaVersion": {"const": SCHEMA_VERSION}, "kind": {"const": BOOK_PATH_STRESS_DIAGNOSTICS_KIND},
        "run": {"type": "object"}, "dataset": {"type": "object"}, "policy": {"type": "object"},
        "snapshot": {"type": "object"}, "summary": {"type": "object"}, "episodes": {"type": "array"},
        "contributions": {"type": "array"}, "paths": {"type": "array"}, "artifacts": {"type": "object"},
        "warning": {"type": "string", "minLength": 1},
    },
}
