"""Fixed OHLCV opening-gap delayed-return event study."""

from __future__ import annotations

import csv
import json
import math
import os
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from autoquant.event_studies import (
    EVENT_STUDY_POLICY,
    load_event_study_policy,
)
from autoquant.intervals import (
    IntervalContractError,
    load_multi_interval_asset,
    timestamp_label,
)


REPORT_KIND = "autoquant-event-study-report"
REQUIRED_COLUMNS = ("timestamp", "open", "high", "low", "close", "volume")
EVENT_COLUMNS = (
    "eventIndex",
    "eventTimestamp",
    "entryTimestamp",
    "exitTimestamp",
    "gapReturn",
    "outcomeStatus",
    "primaryEligible",
    "overlapReason",
    "assetReturn",
    "referenceReturn",
    "excessReturn",
)
REFERENCE_COLUMNS = (
    "entryTimestamp",
    "exitTimestamp",
    "assetReturn",
    "referenceReturn",
    "excessReturn",
)


class JudgeFailure(ValueError):
    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


def _write_output(value: dict[str, Any]) -> None:
    Path(os.environ["AUTOQUANT_RUN_OUTPUT"]).write_text(
        json.dumps(value, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _load_asset(
    data_root: Path,
    asset: str,
    start: str,
    end: str,
) -> pd.DataFrame:
    try:
        multi = load_multi_interval_asset(
            data_root,
            asset,
            start=start,
            end=end,
        )
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
            raise JudgeFailure(
                "dataset.columns",
                f"{asset} columns must be exactly {', '.join(REQUIRED_COLUMNS)}",
            )
        frame["timestamp"] = pd.to_datetime(frame["timestamp"], errors="raise")
        frame = frame[
            (frame["timestamp"] >= pd.Timestamp(start))
            & (frame["timestamp"] <= pd.Timestamp(end))
        ].copy()
    for column in REQUIRED_COLUMNS[1:]:
        frame[column] = pd.to_numeric(frame[column], errors="raise")
    frame["timestamp"] = pd.to_datetime(frame["timestamp"], errors="raise")
    prices = frame.loc[:, ("open", "high", "low", "close")].to_numpy(
        dtype=float
    )
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
    return frame.reset_index(drop=True)


def _distribution(values: list[float]) -> dict[str, Any]:
    array = np.asarray(values, dtype=float)
    count = int(len(array))
    if count == 0:
        return {
            "count": 0,
            "mean": None,
            "median": None,
            "sampleStandardDeviation": None,
            "minimum": None,
            "quartile25": None,
            "quartile75": None,
            "maximum": None,
            "positiveRate": None,
        }
    return {
        "count": count,
        "mean": float(array.mean()),
        "median": float(np.median(array)),
        "sampleStandardDeviation": (
            float(array.std(ddof=1)) if count > 1 else None
        ),
        "minimum": float(array.min()),
        "quartile25": float(np.quantile(array, 0.25)),
        "quartile75": float(np.quantile(array, 0.75)),
        "maximum": float(array.max()),
        "positiveRate": float((array > 0).mean()),
    }


def _mean_uncertainty(values: list[float]) -> dict[str, Any]:
    count = len(values)
    if count < 2:
        return {
            "method": "normal-approximation-mean-v1",
            "count": count,
            "standardError": None,
            "confidenceLevel": 0.95,
            "lower": None,
            "upper": None,
        }
    array = np.asarray(values, dtype=float)
    standard_error = float(array.std(ddof=1) / math.sqrt(count))
    mean = float(array.mean())
    margin = 1.959963984540054 * standard_error
    return {
        "method": "normal-approximation-mean-v1",
        "count": count,
        "standardError": standard_error,
        "confidenceLevel": 0.95,
        "lower": mean - margin,
        "upper": mean + margin,
    }


def _write_csv(
    path: Path,
    columns: tuple[str, ...],
    rows: list[dict[str, Any]],
) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns, lineterminator="\n")
        writer.writeheader()
        for row in rows:
            writer.writerow(
                {
                    key: "" if row.get(key) is None else row.get(key)
                    for key in columns
                }
            )


def _study() -> tuple[dict[str, Any], Path, Path]:
    study_path = Path(os.environ["AUTOQUANT_STUDY_PATH"])
    try:
        study = json.loads(study_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise JudgeFailure("study.contract", f"Cannot read fixed Study: {error}") from error
    return (
        study,
        Path(os.environ["AUTOQUANT_PROJECT_ROOT"]).resolve(),
        Path(os.environ["AUTOQUANT_DATA_ROOT"]).resolve(),
    )


def _evaluate() -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]]]:
    study, project_root, data_root = _study()
    try:
        policy = load_event_study_policy(project_root / EVENT_STUDY_POLICY)
    except Exception as error:
        raise JudgeFailure("event-study.policy", str(error)) from error
    dataset = study["dataset"]
    event_asset = policy["event"]["asset"]
    reference_asset = policy["references"]["matchedAsset"]
    universe = dataset["universe"]
    if event_asset not in universe or reference_asset not in universe:
        raise JudgeFailure(
            "event-study.universe",
            "Event and reference assets must belong to the fixed Study universe",
        )
    event_frame = _load_asset(
        data_root,
        event_asset,
        dataset["time_range"]["start"],
        dataset["time_range"]["end"],
    ).set_index("timestamp")
    reference_frame = _load_asset(
        data_root,
        reference_asset,
        dataset["time_range"]["start"],
        dataset["time_range"]["end"],
    ).set_index("timestamp")
    common = event_frame.index.intersection(reference_frame.index).sort_values()
    aligned_event = event_frame.reindex(common)
    aligned_reference = reference_frame.reindex(common)
    if len(common) < (
        policy["timing"]["waitBars"] + policy["timing"]["holdingBars"] + 2
    ):
        raise JudgeFailure(
            "event-study.observations",
            "Dataset is too short for the fixed event clock",
        )
    gaps = aligned_event["open"].div(aligned_event["close"].shift(1)).sub(1.0)
    threshold = float(policy["event"]["thresholdReturn"])
    event_positions = np.flatnonzero(gaps.le(threshold).fillna(False).to_numpy())
    wait = int(policy["timing"]["waitBars"])
    holding = int(policy["timing"]["holdingBars"])
    rows: list[dict[str, Any]] = []
    last_primary_exit: int | None = None
    for number, event_position in enumerate(event_positions, start=1):
        entry_position = int(event_position + wait)
        exit_position = int(entry_position + holding)
        complete = exit_position < len(common)
        entry_timestamp = (
            timestamp_label(common[entry_position])
            if entry_position < len(common)
            else None
        )
        exit_timestamp = (
            timestamp_label(common[exit_position])
            if complete
            else None
        )
        primary = bool(
            complete
            and (
                last_primary_exit is None
                or entry_position >= last_primary_exit
            )
        )
        if primary:
            last_primary_exit = exit_position
        if not complete:
            reason = "right-censored"
        elif primary:
            reason = "eligible"
        else:
            reason = "overlapping-prior-primary"
        asset_return = (
            float(
                aligned_event["close"].iloc[exit_position]
                / aligned_event["close"].iloc[entry_position]
                - 1.0
            )
            if complete
            else None
        )
        reference_return = (
            float(
                aligned_reference["close"].iloc[exit_position]
                / aligned_reference["close"].iloc[entry_position]
                - 1.0
            )
            if complete
            else None
        )
        rows.append(
            {
                "eventIndex": number,
                "eventTimestamp": timestamp_label(common[event_position]),
                "entryTimestamp": entry_timestamp,
                "exitTimestamp": exit_timestamp,
                "gapReturn": float(gaps.iloc[event_position]),
                "outcomeStatus": "complete" if complete else "right-censored",
                "primaryEligible": primary,
                "overlapReason": reason,
                "assetReturn": asset_return,
                "referenceReturn": reference_return,
                "excessReturn": (
                    asset_return - reference_return
                    if complete
                    and asset_return is not None
                    and reference_return is not None
                    else None
                ),
            }
        )
    references: list[dict[str, Any]] = []
    for entry_position in range(len(common) - holding):
        exit_position = entry_position + holding
        asset_return = float(
            aligned_event["close"].iloc[exit_position]
            / aligned_event["close"].iloc[entry_position]
            - 1.0
        )
        reference_return = float(
            aligned_reference["close"].iloc[exit_position]
            / aligned_reference["close"].iloc[entry_position]
            - 1.0
        )
        references.append(
            {
                "entryTimestamp": timestamp_label(common[entry_position]),
                "exitTimestamp": timestamp_label(common[exit_position]),
                "assetReturn": asset_return,
                "referenceReturn": reference_return,
                "excessReturn": asset_return - reference_return,
            }
        )
    complete_rows = [row for row in rows if row["outcomeStatus"] == "complete"]
    primary_rows = [row for row in rows if row["primaryEligible"]]
    primary_asset = [float(row["assetReturn"]) for row in primary_rows]
    primary_reference = [float(row["referenceReturn"]) for row in primary_rows]
    primary_excess = [float(row["excessReturn"]) for row in primary_rows]
    unconditional_asset = [row["assetReturn"] for row in references]
    raw_asset = [float(row["assetReturn"]) for row in complete_rows]
    raw_excess = [float(row["excessReturn"]) for row in complete_rows]
    primary_distribution = _distribution(primary_asset)
    unconditional_distribution = _distribution(unconditional_asset)
    primary_excess_distribution = _distribution(primary_excess)
    minimum = int(policy["population"]["minimumEvents"])
    if len(primary_rows) < minimum:
        conclusion = "insufficient-events"
    elif (
        float(primary_distribution["mean"])
        > float(unconditional_distribution["mean"])
        and float(primary_excess_distribution["mean"]) > 0.0
    ):
        conclusion = "observed-advantage"
    else:
        conclusion = "no-observed-advantage"
    report = {
        "schemaVersion": 1,
        "kind": REPORT_KIND,
        "policy": policy,
        "dataset": {
            "id": dataset["id"],
            "version": dataset["version"],
            "asset": event_asset,
            "referenceAsset": reference_asset,
            "timeRange": dataset["time_range"],
            "alignedObservations": int(len(common)),
        },
        "populations": {
            "qualifyingEvents": int(len(rows)),
            "completeEvents": int(len(complete_rows)),
            "rightCensoredEvents": int(len(rows) - len(complete_rows)),
            "primaryEvents": int(len(primary_rows)),
            "overlapExcludedEvents": int(
                len(complete_rows) - len(primary_rows)
            ),
            "unconditionalObservations": int(len(references)),
        },
        "distributions": {
            "rawEventAsset": _distribution(raw_asset),
            "rawEventExcess": _distribution(raw_excess),
            "primaryEventAsset": primary_distribution,
            "primaryMatchedReference": _distribution(primary_reference),
            "primaryEventExcess": primary_excess_distribution,
            "unconditionalAsset": unconditional_distribution,
            "unconditionalReference": _distribution(
                [row["referenceReturn"] for row in references]
            ),
        },
        "comparisons": {
            "primaryMeanMinusUnconditionalAssetMean": (
                float(primary_distribution["mean"])
                - float(unconditional_distribution["mean"])
                if primary_asset
                else None
            ),
            "primaryMeanMatchedExcess": primary_excess_distribution["mean"],
        },
        "uncertainty": {
            "primaryEventAssetMean": _mean_uncertainty(primary_asset),
            "primaryEventExcessMean": _mean_uncertainty(primary_excess),
        },
        "conclusion": {
            "status": conclusion,
            "minimumEvents": minimum,
            "observedPrimaryEvents": len(primary_rows),
            "meaning": (
                "descriptive-historical-association-only"
            ),
            "tradingAuthority": "none",
        },
    }
    return report, rows, references


def main() -> None:
    try:
        artifacts = Path(os.environ["AUTOQUANT_ARTIFACTS_DIR"]).resolve()
        artifacts.mkdir(parents=True, exist_ok=True)
        report, events, references = _evaluate()
        (artifacts / "event-study-report.json").write_text(
            json.dumps(report, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        _write_csv(
            artifacts / "event-study-events.csv",
            EVENT_COLUMNS,
            events,
        )
        _write_csv(
            artifacts / "event-study-reference-distribution.csv",
            REFERENCE_COLUMNS,
            references,
        )
        primary_mean = report["distributions"]["primaryEventAsset"]["mean"]
        _write_output(
            {
                "schema_version": 1,
                "status": "succeeded",
                "summary": (
                    f"Price-event study {report['conclusion']['status']}; "
                    f"primary events={report['populations']['primaryEvents']}; "
                    f"primary mean={primary_mean}"
                ),
                "metrics": {
                    "primary_eligible_event_count": int(
                        report["populations"]["primaryEvents"]
                    ),
                    "complete_event_count": int(
                        report["populations"]["completeEvents"]
                    ),
                    "primary_event_mean_return": (
                        float(primary_mean) if primary_mean is not None else 0.0
                    ),
                    "primary_event_mean_excess_return": (
                        float(
                            report["distributions"][
                                "primaryEventExcess"
                            ]["mean"]
                        )
                        if report["distributions"][
                            "primaryEventExcess"
                        ]["mean"]
                        is not None
                        else 0.0
                    ),
                },
                "artifacts": [
                    {
                        "kind": "event-study-report",
                        "path": "event-study-report.json",
                        "description": (
                            "Fixed event populations, distributions, "
                            "references, uncertainty, and conclusion"
                        ),
                    },
                    {
                        "kind": "event-study-events",
                        "path": "event-study-events.csv",
                        "description": (
                            "Complete and right-censored event-level ledger"
                        ),
                    },
                    {
                        "kind": "event-study-reference-distribution",
                        "path": "event-study-reference-distribution.csv",
                        "description": (
                            "Unconditional aligned holding-return reference"
                        ),
                    },
                ],
                "errors": [],
            }
        )
    except JudgeFailure as error:
        _write_output(
            {
                "schema_version": 1,
                "status": "failed",
                "summary": str(error),
                "metrics": {},
                "artifacts": [],
                "errors": [{"code": error.code, "message": str(error)}],
            }
        )
    except Exception as error:
        _write_output(
            {
                "schema_version": 1,
                "status": "failed",
                "summary": f"Event Study raised {type(error).__name__}",
                "metrics": {},
                "artifacts": [],
                "errors": [
                    {
                        "code": "event-study.exception",
                        "message": f"{type(error).__name__}: {error}",
                    }
                ],
            }
        )


if __name__ == "__main__":
    main()
