"""Strict bounded read model for immutable reported-book risk Runs."""

from __future__ import annotations

import csv
import json
import math
from pathlib import Path
from typing import Any

from .position_snapshots import validate_position_snapshot
from .runs import load_run
from .workspace import (
    SCHEMA_VERSION,
    AutoQuantValidationError,
    ProjectContext,
    ValidationIssue,
)


BOOK_RISK_DIAGNOSTICS_KIND = "autoquant-book-risk-diagnostics"
DEFAULT_BOOK_RISK_POINTS = 80
MIN_BOOK_RISK_POINTS = 20
MAX_BOOK_RISK_POINTS = 400
ARTIFACTS = {
    "book-risk-report": "book-risk-report.json",
    "book-risk-contributions": "book-risk-contributions.csv",
    "book-risk-reductions": "book-risk-reductions.csv",
    "book-risk-correlations": "book-risk-correlations.csv",
    "book-risk-path": "book-risk-path.csv",
    "book-risk-equity-path": "book-risk-equity-path.csv",
    "book-risk-scenario-comparisons": (
        "book-risk-scenario-comparisons.csv"
    ),
    "book-risk-scenario-contributions": (
        "book-risk-scenario-contributions.csv"
    ),
    "book-risk-sizing-lookbacks": "book-risk-sizing-lookbacks.csv",
    "book-risk-sizing-contributions": (
        "book-risk-sizing-contributions.csv"
    ),
}
CONTRIBUTION_COLUMNS = (
    "asset",
    "weight",
    "marginalVariance",
    "componentVariance",
    "signedRiskShare",
    "absoluteRiskShare",
)
REDUCTION_COLUMNS = (
    "rank",
    "asset",
    "startingWeight",
    "weightReduction",
    "resultingWeight",
    "resultingCashWeight",
    "annualizedVolatility",
    "volatilityReduction",
    "volatilityReductionPerWeight",
    "componentRiskHhi",
    "effectiveRiskBets",
)
CORRELATION_COLUMNS = ("leftAsset", "rightAsset", "correlation")
PATH_COLUMNS = (
    "timestamp",
    "observations",
    "annualizedVolatility",
    "componentRiskHhi",
    "effectiveRiskBets",
    "firstPrincipalComponentVarianceShare",
)
EQUITY_PATH_COLUMNS = (
    "timestamp",
    "portfolioReturn",
    "cumulativeReturn",
    "nav",
    "runningPeak",
    "drawdown",
)
SCENARIO_COMPARISON_COLUMNS = (
    "scenarioId",
    "scenarioName",
    "volatilityRank",
    "lookbackBars",
    "observations",
    "annualizedVolatility",
    "annualizedVolatilityDelta",
    "componentRiskHhi",
    "componentRiskHhiDelta",
    "effectiveRiskBets",
    "effectiveRiskBetsDelta",
    "largestAbsoluteRiskContributor",
    "largestAbsoluteRiskContributorShare",
)
SCENARIO_CONTRIBUTION_COLUMNS = (
    "scenarioId",
    "asset",
    "baselineWeight",
    "scenarioWeight",
    "weightDelta",
    "baselineComponentVariance",
    "scenarioComponentVariance",
    "componentVarianceDelta",
    "baselineAbsoluteRiskShare",
    "scenarioAbsoluteRiskShare",
    "absoluteRiskShareDelta",
)
SIZING_LOOKBACK_COLUMNS = (
    "lookbackBars",
    "observations",
    "annualizedVolatility",
    "annualizedVolatilityDelta",
    "componentRiskHhi",
    "effectiveRiskBets",
    "largestAbsoluteRiskContributor",
    "largestAbsoluteRiskContributorShare",
    "governing",
    "ceilingSatisfied",
)
SIZING_CONTRIBUTION_COLUMNS = (
    "asset",
    "baselineWeight",
    "resultingWeight",
    "weightDelta",
    "componentVariance",
    "signedRiskShare",
    "absoluteRiskShare",
)


def _issue(path: Path | str, code: str, message: str) -> ValidationIssue:
    return ValidationIssue(str(path), code, message)


def _fail(path: Path | str, code: str, message: str) -> None:
    raise AutoQuantValidationError([_issue(path, code, message)])


def _strict(
    value: Any,
    keys: set[str],
    path: Path | str,
) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != keys:
        _fail(path, "book-risk.schema", "Object fields differ from the fixed contract")
    return value


def _finite(value: Any, path: Path | str) -> float:
    if (
        not isinstance(value, (int, float))
        or isinstance(value, bool)
        or not math.isfinite(float(value))
    ):
        _fail(path, "book-risk.number", "Expected one finite number")
    return float(value)


def _csv_finite(value: str, path: Path | str) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        _fail(path, "book-risk.number", "Expected one finite CSV number")
    if not math.isfinite(result):
        _fail(path, "book-risk.number", "Expected one finite CSV number")
    return result


def _close(left: float, right: float, path: Path | str) -> None:
    if not math.isclose(left, right, rel_tol=1e-9, abs_tol=1e-12):
        _fail(path, "book-risk.reconcile", "Derived evidence does not reconcile")


def _read_object(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        _fail(path, "book-risk.json", f"Cannot read JSON evidence: {error}")
    if not isinstance(value, dict):
        _fail(path, "book-risk.type", "JSON evidence must be an object")
    return value


def _frozen_book_risk_dependency(
    run,
    *,
    flag: str,
    default: str,
    code: str,
) -> Path:
    frozen_study_path = run.root_dir / "inputs" / "study.json"
    frozen_study = _read_object(frozen_study_path)
    judge = frozen_study.get("judge")
    arguments = judge.get("arguments") if isinstance(judge, dict) else None
    if not isinstance(arguments, list) or not all(
        isinstance(item, str) for item in arguments
    ):
        _fail(frozen_study_path, code, "Frozen Study Judge arguments are invalid")
    positions = [index for index, item in enumerate(arguments) if item == flag]
    if len(positions) > 1 or (
        positions and positions[0] + 1 >= len(arguments)
    ):
        _fail(frozen_study_path, code, f"Frozen Study {flag} binding is invalid")
    relative = arguments[positions[0] + 1] if positions else default
    dependencies = run.result.get("dependencies")
    dependency_hashes = (
        dependencies.get("sourceHashes")
        if isinstance(dependencies, dict)
        else None
    )
    if (
        not isinstance(dependency_hashes, dict)
        or relative not in dependency_hashes
    ):
        _fail(
            run.root_dir / "inputs" / "dependency-sources",
            code,
            f"Book Risk Run did not freeze declared dependency {relative}",
        )
    return run.root_dir / "inputs" / "dependency-sources" / relative


def _csv_rows(
    path: Path,
    columns: tuple[str, ...],
    *,
    allow_empty: bool = False,
) -> list[dict[str, str]]:
    try:
        with path.open("r", encoding="utf-8", newline="") as handle:
            reader = csv.DictReader(handle)
            if tuple(reader.fieldnames or ()) != columns:
                _fail(
                    path,
                    "book-risk.csv-columns",
                    "CSV columns differ from the fixed contract",
                )
            rows = list(reader)
    except OSError as error:
        _fail(path, "book-risk.csv", f"Cannot read CSV evidence: {error}")
    if (not allow_empty and not rows) or any(
        None in row or any(value is None for value in row.values())
        for row in rows
    ):
        _fail(path, "book-risk.csv-width", "CSV evidence is empty or malformed")
    return rows


def _supports_drawdown_evidence(version: Any) -> bool:
    if not isinstance(version, str):
        return True
    try:
        parts = tuple(int(item) for item in version.split("."))
    except ValueError:
        return True
    return parts >= (0, 8, 19)


def _artifact_paths(run) -> tuple[dict[str, Path], bool]:
    legacy = not _supports_drawdown_evidence(
        run.result["harness"].get("version")
    )
    expected = {
        kind: filename
        for kind, filename in ARTIFACTS.items()
        if not legacy or kind != "book-risk-equity-path"
    }
    declared = {
        item["kind"]: item["path"]
        for item in run.result["artifacts"]
    }
    if set(declared) != set(expected):
        _fail(
            run.root_dir,
            "book-risk.artifacts",
            "Book Risk Run artifacts differ from the fixed inventory",
        )
    result: dict[str, Path] = {}
    for kind, filename in expected.items():
        relative = declared[kind]
        if relative != f"artifacts/{filename}":
            _fail(
                run.root_dir / relative,
                "book-risk.artifact-path",
                "Book Risk artifact path differs from the fixed contract",
            )
        result[kind] = run.root_dir / relative
    return result, legacy


def _sample(rows: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    if len(rows) <= limit:
        return rows
    indices = {
        round(index * (len(rows) - 1) / (limit - 1))
        for index in range(limit)
    }
    return [rows[index] for index in sorted(indices)]


def _csv_boolean(value: str, path: Path | str) -> bool:
    if value not in {"True", "False"}:
        _fail(path, "book-risk.boolean", "Expected True or False")
    return value == "True"


def _validate_position_sizing(
    value: Any,
    frozen_snapshot: dict[str, Any],
    method: dict[str, Any],
    baseline_lookbacks: list[dict[str, Any]],
    paths: dict[str, Path],
) -> dict[str, Any]:
    policy = frozen_snapshot["sizingPolicy"]
    if policy is None:
        if value != {"status": "not-requested"}:
            _fail(
                f"{paths['book-risk-report']}/positionSizing",
                "book-risk.position-sizing",
                "Unrequested sizing evidence must be empty",
            )
        if _csv_rows(
            paths["book-risk-sizing-lookbacks"],
            SIZING_LOOKBACK_COLUMNS,
            allow_empty=True,
        ) or _csv_rows(
            paths["book-risk-sizing-contributions"],
            SIZING_CONTRIBUTION_COLUMNS,
            allow_empty=True,
        ):
            _fail(
                paths["book-risk-sizing-lookbacks"],
                "book-risk.position-sizing",
                "Unrequested sizing artifacts must be empty",
            )
        return {"status": "not-requested"}
    value = _strict(
        value,
        {
            "status",
            "resultMeaning",
            "bindingConstraint",
            "policy",
            "quadratic",
            "result",
            "lookbacks",
            "contributions",
            "pairwiseCorrelations",
            "drawdown",
        },
        f"{paths['book-risk-report']}/positionSizing",
    )
    if value["policy"] != policy:
        _fail(
            f"{paths['book-risk-report']}/positionSizing/policy",
            "book-risk.position-sizing-policy",
            "Sizing policy differs from frozen caller authority",
        )
    status = value["status"]
    direction = policy["direction"]
    meanings = {
        "infeasible": "constrained-minimum-evidence-not-recommendation",
        **(
            {
                "sized": "smallest-compliant-decrease",
                "unchanged-compliant": "unchanged-compliant-book",
            }
            if direction == "decrease"
            else {
                "sized": "largest-compliant-increase",
                "fully-funded-compliant": (
                    "full-cash-allocation-compliant"
                ),
                "maximum-weight-compliant": (
                    "caller-maximum-weight-compliant"
                ),
            }
        ),
    }
    if status not in meanings or value["resultMeaning"] != meanings[status]:
        _fail(
            f"{paths['book-risk-report']}/positionSizing/status",
            "book-risk.position-sizing-status",
            "Sizing status semantics differ from the fixed contract",
        )
    quadratic = _strict(
        value["quadratic"],
        {
            "coefficientA",
            "coefficientB",
            "coefficientC",
            "domainMinimumWeight",
            "domainMaximumWeight",
            "targetVariance",
            "startingVariance",
            "minimumWeight",
            "minimumVariance",
        },
        f"{paths['book-risk-report']}/positionSizing/quadratic",
    )
    q = {
        key: _finite(
            item,
            f"{paths['book-risk-report']}/positionSizing/quadratic/{key}",
        )
        for key, item in quadratic.items()
    }
    asset = policy["asset"]
    starting_weight = float(frozen_snapshot["weights"].get(asset, 0.0))
    baseline_cash = float(frozen_snapshot["cashWeight"])
    funding_maximum = starting_weight + baseline_cash
    domain_minimum = (
        float(policy["minimumWeight"])
        if direction == "decrease"
        else starting_weight
    )
    domain_maximum = (
        starting_weight
        if direction == "decrease"
        else min(funding_maximum, float(policy["maximumWeight"]))
    )
    ceiling = float(policy["annualizedVolatilityCeiling"])

    def variance_at(weight: float) -> float:
        return (
            q["coefficientA"] * weight * weight
            + q["coefficientB"] * weight
            + q["coefficientC"]
        )

    _close(
        q["domainMinimumWeight"],
        domain_minimum,
        "positionSizing/domainMinimum",
    )
    _close(
        q["domainMaximumWeight"],
        domain_maximum,
        "positionSizing/domainMaximum",
    )
    _close(q["targetVariance"], ceiling**2, "positionSizing/targetVariance")
    _close(
        q["startingVariance"],
        variance_at(starting_weight),
        "positionSizing/startingVariance",
    )
    governing_baseline = next(
        (
            row
            for row in baseline_lookbacks
            if int(row["lookbackBars"]) == int(policy["lookbackBars"])
        ),
        None,
    )
    if governing_baseline is None:
        _fail(
            "positionSizing/lookbackBars",
            "book-risk.position-sizing-lookbacks",
            "Governing baseline lookback is unavailable",
        )
    _close(
        q["startingVariance"],
        float(governing_baseline["annualizedVolatility"]) ** 2,
        "positionSizing/startingVariance",
    )
    if q["coefficientA"] < -1e-15:
        _fail(
            "positionSizing/coefficientA",
            "book-risk.position-sizing-quadratic",
            "Sizing variance path must be convex",
        )
    expected_minimum = (
        min(
            max(
                -q["coefficientB"] / (2 * q["coefficientA"]),
                domain_minimum,
            ),
            domain_maximum,
        )
        if q["coefficientA"] > 1e-18
        else min(
            (domain_minimum, domain_maximum),
            key=variance_at,
        )
    )
    _close(q["minimumWeight"], expected_minimum, "positionSizing/minimumWeight")
    _close(
        q["minimumVariance"],
        variance_at(expected_minimum),
        "positionSizing/minimumVariance",
    )
    tolerance = max(1e-14, q["targetVariance"] * 1e-10)
    if status == "unchanged-compliant":
        if q["startingVariance"] > q["targetVariance"] + tolerance:
            _fail(
                "positionSizing/status",
                "book-risk.position-sizing-status",
                "Already-compliant status violates the variance ceiling",
            )
        expected_weight = starting_weight
        expected_binding = "current-book"
    elif status == "infeasible":
        if q["minimumVariance"] <= q["targetVariance"] + tolerance:
            _fail(
                "positionSizing/status",
                "book-risk.position-sizing-status",
                "Infeasible status has a compliant point on the path",
            )
        expected_weight = expected_minimum
        expected_binding = "no-compliant-weight"
    elif status == "fully-funded-compliant":
        if (
            direction != "increase"
            or domain_maximum < funding_maximum - 1e-12
            or variance_at(domain_maximum)
            > q["targetVariance"] + tolerance
        ):
            _fail(
                "positionSizing/status",
                "book-risk.position-sizing-status",
                "Fully funded status violates the variance ceiling",
            )
        expected_weight = domain_maximum
        expected_binding = "available-cash"
    elif status == "maximum-weight-compliant":
        if (
            direction != "increase"
            or domain_maximum >= funding_maximum - 1e-12
            or variance_at(domain_maximum)
            > q["targetVariance"] + tolerance
        ):
            _fail(
                "positionSizing/status",
                "book-risk.position-sizing-status",
                "Maximum-weight status differs from the caller boundary",
            )
        expected_weight = domain_maximum
        expected_binding = "caller-weight-bound"
    else:
        if (
            (
                direction == "decrease"
                and q["startingVariance"]
                <= q["targetVariance"] + tolerance
            )
            or (
                direction == "increase"
                and variance_at(domain_maximum)
                <= q["targetVariance"] + tolerance
            )
            or q["minimumVariance"] > q["targetVariance"] + tolerance
        ):
            _fail(
                "positionSizing/status",
                "book-risk.position-sizing-status",
                "Sized status does not straddle the variance ceiling",
            )
        discriminant = (
            q["coefficientB"] ** 2
            - 4
            * q["coefficientA"]
            * (q["coefficientC"] - q["targetVariance"])
        )
        if (
            q["coefficientA"] <= 1e-18
            and abs(q["coefficientB"]) <= 1e-18
        ) or discriminant < -tolerance:
            _fail(
                "positionSizing/quadratic",
                "book-risk.position-sizing-quadratic",
                "Sizing boundary cannot be rederived",
            )
        expected_weight = (
            (q["targetVariance"] - q["coefficientC"])
            / q["coefficientB"]
            if q["coefficientA"] <= 1e-18
            else (
                (
                    -q["coefficientB"]
                    + math.sqrt(max(discriminant, 0.0))
                )
                / (2 * q["coefficientA"])
            )
        )
        expected_weight = min(
            max(expected_weight, domain_minimum),
            domain_maximum,
        )
        _close(
            variance_at(expected_weight),
            q["targetVariance"],
            "positionSizing/sizedBoundary",
        )
        if (
            direction == "increase"
            and expected_weight <= starting_weight + 1e-12
        ) or (
            direction == "decrease"
            and expected_weight >= starting_weight - 1e-12
        ):
            _fail(
                "positionSizing/status",
                "book-risk.position-sizing-status",
                "Sized status must change the asset in the authorized direction",
            )
        expected_binding = "volatility-ceiling"
    if value["bindingConstraint"] != expected_binding:
        _fail(
            f"{paths['book-risk-report']}/positionSizing/bindingConstraint",
            "book-risk.position-sizing-binding",
            "Sizing binding constraint differs from the fixed path",
        )
    result = _strict(
        value["result"],
        {
            "asset",
            "startingWeight",
            "resultingWeight",
            "weightChange",
            "startingCashWeight",
            "resultingCashWeight",
            "cashWeightChange",
            "weights",
            "annualizedVolatility",
            "annualizedVariance",
            "annualizedVolatilityDelta",
            "componentRiskHhi",
            "effectiveRiskBets",
            "largestAbsoluteRiskContributor",
            "largestAbsoluteRiskContributorShare",
            "ceilingSatisfied",
        },
        f"{paths['book-risk-report']}/positionSizing/result",
    )
    numeric_fields = {
        key: _finite(
            result[key],
            f"{paths['book-risk-report']}/positionSizing/result/{key}",
        )
        for key in {
            "startingWeight",
            "resultingWeight",
            "weightChange",
            "startingCashWeight",
            "resultingCashWeight",
            "cashWeightChange",
            "annualizedVolatility",
            "annualizedVariance",
            "annualizedVolatilityDelta",
            "componentRiskHhi",
            "effectiveRiskBets",
            "largestAbsoluteRiskContributorShare",
        }
    }
    _close(numeric_fields["startingWeight"], starting_weight, "positionSizing/result")
    _close(numeric_fields["resultingWeight"], expected_weight, "positionSizing/result")
    _close(
        numeric_fields["weightChange"],
        expected_weight - starting_weight,
        "positionSizing/result",
    )
    _close(numeric_fields["startingCashWeight"], baseline_cash, "positionSizing/result")
    _close(
        numeric_fields["cashWeightChange"],
        starting_weight - expected_weight,
        "positionSizing/result",
    )
    _close(
        numeric_fields["resultingCashWeight"],
        baseline_cash + numeric_fields["cashWeightChange"],
        "positionSizing/result",
    )
    expected_assets = list(frozen_snapshot["weights"])
    if asset not in expected_assets:
        expected_assets.append(asset)
    if (
        result["asset"] != asset
        or not isinstance(result["weights"], dict)
        or set(result["weights"]) != set(expected_assets)
        or not isinstance(result["ceilingSatisfied"], bool)
        or not isinstance(result["largestAbsoluteRiskContributor"], str)
    ):
        _fail(
            "positionSizing/result",
            "book-risk.position-sizing-result",
            "Sizing result identity differs from the fixed path",
        )
    for symbol in expected_assets:
        baseline_weight = frozen_snapshot["weights"].get(symbol, 0.0)
        _close(
            _finite(result["weights"][symbol], f"positionSizing/weights/{symbol}"),
            expected_weight if symbol == asset else float(baseline_weight),
            f"positionSizing/weights/{symbol}",
        )
    _close(
        sum(float(result["weights"][symbol]) for symbol in expected_assets)
        + numeric_fields["resultingCashWeight"],
        1.0,
        "positionSizing/result/funding",
    )
    _close(
        numeric_fields["annualizedVariance"],
        variance_at(expected_weight),
        "positionSizing/result/annualizedVariance",
    )
    _close(
        numeric_fields["annualizedVolatility"] ** 2,
        numeric_fields["annualizedVariance"],
        "positionSizing/result/annualizedVolatility",
    )
    _close(
        numeric_fields["annualizedVolatility"]
        - float(governing_baseline["annualizedVolatility"]),
        numeric_fields["annualizedVolatilityDelta"],
        "positionSizing/result/annualizedVolatilityDelta",
    )
    if result["ceilingSatisfied"] != (
        numeric_fields["annualizedVolatility"] <= ceiling + 1e-12
    ):
        _fail(
            "positionSizing/result/ceilingSatisfied",
            "book-risk.position-sizing-ceiling",
            "Sizing ceiling flag is invalid",
        )
    raw_lookbacks = value["lookbacks"]
    if (
        not isinstance(raw_lookbacks, list)
        or len(raw_lookbacks) != len(method["lookbackBars"])
    ):
        _fail(
            "positionSizing/lookbacks",
            "book-risk.position-sizing-lookbacks",
            "Sizing lookback count differs from the fixed method",
        )
    lookback_keys = set(SIZING_LOOKBACK_COLUMNS)
    parsed_lookbacks: list[dict[str, Any]] = []
    for index, raw in enumerate(raw_lookbacks):
        raw = _strict(raw, lookback_keys, f"positionSizing/lookbacks/{index}")
        parsed = {
            key: (
                raw[key]
                if key == "largestAbsoluteRiskContributor"
                else raw[key]
                if key in {"governing", "ceilingSatisfied"}
                else _finite(raw[key], f"positionSizing/lookbacks/{index}/{key}")
            )
            for key in SIZING_LOOKBACK_COLUMNS
        }
        baseline = next(
            row
            for row in baseline_lookbacks
            if row["lookbackBars"] == parsed["lookbackBars"]
        )
        if (
            parsed["lookbackBars"] != method["lookbackBars"][index]
            or parsed["observations"] != parsed["lookbackBars"]
            or parsed["governing"]
            != (parsed["lookbackBars"] == policy["lookbackBars"])
            or parsed["ceilingSatisfied"]
            != (parsed["annualizedVolatility"] <= ceiling + 1e-12)
        ):
            _fail(
                f"positionSizing/lookbacks/{index}",
                "book-risk.position-sizing-lookbacks",
                "Sizing lookback evidence is invalid",
            )
        _close(
            parsed["annualizedVolatility"] - baseline["annualizedVolatility"],
            parsed["annualizedVolatilityDelta"],
            f"positionSizing/lookbacks/{index}",
        )
        _close(
            1 / parsed["componentRiskHhi"],
            parsed["effectiveRiskBets"],
            f"positionSizing/lookbacks/{index}",
        )
        parsed_lookbacks.append(parsed)
    governing = next(row for row in parsed_lookbacks if row["governing"])
    for field in (
        "annualizedVolatility",
        "componentRiskHhi",
        "effectiveRiskBets",
        "largestAbsoluteRiskContributorShare",
    ):
        _close(
            numeric_fields[field],
            _finite(governing[field], f"positionSizing/governing/{field}"),
            f"positionSizing/result/{field}",
        )
    if (
        result["largestAbsoluteRiskContributor"]
        != governing["largestAbsoluteRiskContributor"]
    ):
        _fail(
            "positionSizing/result/largestAbsoluteRiskContributor",
            "book-risk.position-sizing-contributor",
            "Sizing contributor leader differs from governing lookback",
        )
    csv_lookbacks: list[dict[str, Any]] = []
    for index, row in enumerate(
        _csv_rows(
            paths["book-risk-sizing-lookbacks"],
            SIZING_LOOKBACK_COLUMNS,
        )
    ):
        csv_lookbacks.append(
            {
                key: (
                    row[key]
                    if key == "largestAbsoluteRiskContributor"
                    else _csv_boolean(
                        row[key],
                        f"{paths['book-risk-sizing-lookbacks']}:{index + 2}/{key}",
                    )
                    if key in {"governing", "ceilingSatisfied"}
                    else _csv_finite(
                        row[key],
                        f"{paths['book-risk-sizing-lookbacks']}:{index + 2}/{key}",
                    )
                )
                for key in SIZING_LOOKBACK_COLUMNS
            }
        )
    if csv_lookbacks != parsed_lookbacks:
        _fail(
            paths["book-risk-sizing-lookbacks"],
            "book-risk.position-sizing-lookbacks",
            "Sizing lookback CSV differs from the report",
        )
    raw_contributions = value["contributions"]
    if (
        not isinstance(raw_contributions, list)
        or len(raw_contributions) != len(expected_assets)
    ):
        _fail(
            "positionSizing/contributions",
            "book-risk.position-sizing-contributions",
            "Sizing contribution count is invalid",
        )
    contributions: list[dict[str, Any]] = []
    for index, raw in enumerate(raw_contributions):
        raw = _strict(
            raw,
            set(SIZING_CONTRIBUTION_COLUMNS),
            f"positionSizing/contributions/{index}",
        )
        parsed = {
            key: (
                raw[key]
                if key == "asset"
                else _finite(raw[key], f"positionSizing/contributions/{index}/{key}")
            )
            for key in SIZING_CONTRIBUTION_COLUMNS
        }
        contributions.append(parsed)
    csv_contributions: list[dict[str, Any]] = []
    for index, row in enumerate(
        _csv_rows(
            paths["book-risk-sizing-contributions"],
            SIZING_CONTRIBUTION_COLUMNS,
        )
    ):
        csv_contributions.append(
            {
                key: (
                    row[key]
                    if key == "asset"
                    else _csv_finite(
                        row[key],
                        f"{paths['book-risk-sizing-contributions']}:{index + 2}/{key}",
                    )
                )
                for key in SIZING_CONTRIBUTION_COLUMNS
            }
        )
    if contributions != csv_contributions:
        _fail(
            paths["book-risk-sizing-contributions"],
            "book-risk.position-sizing-contributions",
            "Sizing contribution CSV differs from the report",
        )
    if [row["asset"] for row in contributions] != expected_assets:
        _fail(
            "positionSizing/contributions",
            "book-risk.position-sizing-contributions",
            "Sizing contribution assets differ from the frozen book",
        )
    for row in contributions:
        symbol = row["asset"]
        _close(
            row["baselineWeight"],
            float(frozen_snapshot["weights"].get(symbol, 0.0)),
            "positionSizing/contributions",
        )
        _close(
            row["resultingWeight"] - row["baselineWeight"],
            row["weightDelta"],
            "positionSizing/contributions",
        )
        _close(
            row["resultingWeight"],
            float(result["weights"][symbol]),
            "positionSizing/contributions",
        )
    _close(
        sum(row["componentVariance"] for row in contributions),
        numeric_fields["annualizedVariance"],
        "positionSizing/contributions",
    )
    _close(
        sum(row["signedRiskShare"] for row in contributions),
        1.0,
        "positionSizing/contributions",
    )
    _close(
        sum(row["absoluteRiskShare"] for row in contributions),
        1.0,
        "positionSizing/contributions",
    )
    _close(
        sum(row["absoluteRiskShare"] ** 2 for row in contributions),
        numeric_fields["componentRiskHhi"],
        "positionSizing/contributions",
    )
    largest = max(contributions, key=lambda row: row["absoluteRiskShare"])
    if largest["asset"] != result["largestAbsoluteRiskContributor"]:
        _fail(
            "positionSizing/contributions",
            "book-risk.position-sizing-contributor",
            "Sizing contribution leader differs from the result",
        )
    _close(
        largest["absoluteRiskShare"],
        numeric_fields["largestAbsoluteRiskContributorShare"],
        "positionSizing/contributions",
    )
    raw_correlations = value["pairwiseCorrelations"]
    expected_pairs = [
        (expected_assets[left], expected_assets[right])
        for left in range(len(expected_assets))
        for right in range(left + 1, len(expected_assets))
    ]
    if (
        not isinstance(raw_correlations, list)
        or len(raw_correlations) != len(expected_pairs)
    ):
        _fail(
            "positionSizing/pairwiseCorrelations",
            "book-risk.position-sizing-correlations",
            "Sizing correlation count differs from the resulting book",
        )
    pairwise_correlations: list[dict[str, Any]] = []
    for index, (raw, expected_pair) in enumerate(
        zip(raw_correlations, expected_pairs, strict=True)
    ):
        parsed = _strict(
            raw,
            {"leftAsset", "rightAsset", "correlation"},
            f"positionSizing/pairwiseCorrelations/{index}",
        )
        correlation = _finite(
            parsed["correlation"],
            f"positionSizing/pairwiseCorrelations/{index}/correlation",
        )
        if (
            (parsed["leftAsset"], parsed["rightAsset"])
            != expected_pair
            or abs(correlation) > 1 + 1e-12
        ):
            _fail(
                f"positionSizing/pairwiseCorrelations/{index}",
                "book-risk.position-sizing-correlations",
                "Sizing correlation identity or value is invalid",
            )
        pairwise_correlations.append(
            {**parsed, "correlation": correlation}
        )
    drawdown = _strict(
        value["drawdown"],
        {
            "method",
            "returnConvention",
            "initialNav",
            "maximumDrawdown",
            "peakTimestamp",
            "troughTimestamp",
            "recoveryTimestamp",
            "recovered",
        },
        "positionSizing/drawdown",
    )
    maximum_drawdown = _finite(
        drawdown["maximumDrawdown"],
        "positionSizing/drawdown/maximumDrawdown",
    )
    if (
        drawdown["method"] != "daily-constant-weight-close-to-close"
        or drawdown["returnConvention"]
        != (
            "Supplied asset weights are applied to each same-clock "
            "close-to-close simple-return row; cash return is zero."
        )
        or drawdown["initialNav"] != 1.0
        or maximum_drawdown > 1e-12
        or not isinstance(drawdown["peakTimestamp"], str)
        or not drawdown["peakTimestamp"]
        or not isinstance(drawdown["troughTimestamp"], str)
        or not drawdown["troughTimestamp"]
        or (
            drawdown["recoveryTimestamp"] is not None
            and (
                not isinstance(drawdown["recoveryTimestamp"], str)
                or not drawdown["recoveryTimestamp"]
            )
        )
        or not isinstance(drawdown["recovered"], bool)
        or drawdown["recovered"]
        != (drawdown["recoveryTimestamp"] is not None)
    ):
        _fail(
            "positionSizing/drawdown",
            "book-risk.position-sizing-drawdown",
            "Sizing drawdown evidence is invalid",
        )
    return {
        **value,
        "quadratic": q,
        "result": {
            **result,
            **numeric_fields,
        },
        "lookbacks": parsed_lookbacks,
        "contributions": contributions,
        "pairwiseCorrelations": pairwise_correlations,
        "drawdown": {
            **drawdown,
            "maximumDrawdown": maximum_drawdown,
        },
    }


def _validate_drawdown_evidence(
    report: dict[str, Any],
    paths: dict[str, Path],
    current: dict[str, float],
    dataset: dict[str, Any],
    lookbacks: list[dict[str, Any]],
    point_limit: int,
    *,
    legacy: bool,
) -> tuple[dict[str, Any], dict[str, Any]]:
    if legacy:
        unavailable = {
            "available": False,
            "reason": (
                "Run predates AutoQuant 0.8.19 fixed Book Risk drawdown "
                "evidence."
            ),
        }
        return unavailable, {
            **unavailable,
            "totalRows": 0,
            "sampledRows": 0,
            "points": [],
        }
    drawdown = _strict(
        report["drawdown"],
        {
            "method",
            "returnConvention",
            "initialNav",
            "maximumDrawdown",
            "peakTimestamp",
            "troughTimestamp",
            "recoveryTimestamp",
            "recovered",
        },
        f"{paths['book-risk-report']}/drawdown",
    )
    expected_return_convention = (
        "Supplied asset weights are applied to each same-clock close-to-close "
        "simple-return row; cash return is zero."
    )
    if (
        drawdown["method"] != "daily-constant-weight-close-to-close"
        or drawdown["returnConvention"] != expected_return_convention
        or drawdown["initialNav"] != 1.0
        or not isinstance(drawdown["peakTimestamp"], str)
        or not drawdown["peakTimestamp"]
        or not isinstance(drawdown["troughTimestamp"], str)
        or not drawdown["troughTimestamp"]
        or (
            drawdown["recoveryTimestamp"] is not None
            and (
                not isinstance(drawdown["recoveryTimestamp"], str)
                or not drawdown["recoveryTimestamp"]
            )
        )
        or not isinstance(drawdown["recovered"], bool)
        or drawdown["recovered"]
        != (drawdown["recoveryTimestamp"] is not None)
    ):
        _fail(
            f"{paths['book-risk-report']}/drawdown",
            "book-risk.drawdown",
            "Drawdown method or interval identity is invalid",
        )
    maximum_drawdown = _finite(
        drawdown["maximumDrawdown"],
        f"{paths['book-risk-report']}/drawdown/maximumDrawdown",
    )
    if maximum_drawdown > 1e-12:
        _fail(
            f"{paths['book-risk-report']}/drawdown/maximumDrawdown",
            "book-risk.drawdown",
            "Maximum drawdown must be non-positive",
        )
    rows: list[dict[str, Any]] = []
    previous_timestamp = ""
    previous_nav = 1.0
    previous_peak = 1.0
    for index, raw in enumerate(
        _csv_rows(
            paths["book-risk-equity-path"],
            EQUITY_PATH_COLUMNS,
        )
    ):
        row_path = f"{paths['book-risk-equity-path']}:{index + 2}"
        timestamp = raw["timestamp"]
        if not timestamp or timestamp <= previous_timestamp:
            _fail(
                f"{row_path}/timestamp",
                "book-risk.equity-path-order",
                "Book equity-path timestamps must be ordered and unique",
            )
        row = {
            "timestamp": timestamp,
            **{
                key: _csv_finite(raw[key], f"{row_path}/{key}")
                for key in EQUITY_PATH_COLUMNS[1:]
            },
        }
        if index == 0:
            for key, expected in {
                "portfolioReturn": 0.0,
                "cumulativeReturn": 0.0,
                "nav": 1.0,
                "runningPeak": 1.0,
                "drawdown": 0.0,
            }.items():
                _close(row[key], expected, f"{row_path}/{key}")
        else:
            if row["portfolioReturn"] <= -1.0:
                _fail(
                    f"{row_path}/portfolioReturn",
                    "book-risk.equity-path",
                    "Book path return must preserve positive NAV",
                )
            _close(
                row["nav"],
                previous_nav * (1.0 + row["portfolioReturn"]),
                f"{row_path}/nav",
            )
            _close(
                row["cumulativeReturn"],
                row["nav"] - 1.0,
                f"{row_path}/cumulativeReturn",
            )
            _close(
                row["runningPeak"],
                max(previous_peak, row["nav"]),
                f"{row_path}/runningPeak",
            )
            _close(
                row["drawdown"],
                row["nav"] / row["runningPeak"] - 1.0,
                f"{row_path}/drawdown",
            )
        previous_timestamp = timestamp
        previous_nav = row["nav"]
        previous_peak = row["runningPeak"]
        rows.append(row)
    primary_bars = int(current["lookbackBars"])
    evidence_bars = max(int(row["lookbackBars"]) for row in lookbacks)
    if (
        len(rows) != evidence_bars + 1
        or rows[-1]["timestamp"] != dataset["marketDataEnd"]
    ):
        _fail(
            paths["book-risk-equity-path"],
            "book-risk.equity-path-window",
            "Book equity path differs from the longest fixed lookback interval",
        )

    def normalized_window(bars: int) -> list[dict[str, Any]]:
        source = rows[-(bars + 1) :]
        normalized = [
            {
                "timestamp": source[0]["timestamp"],
                "portfolioReturn": 0.0,
                "cumulativeReturn": 0.0,
                "nav": 1.0,
                "runningPeak": 1.0,
                "drawdown": 0.0,
            }
        ]
        nav = 1.0
        running_peak = 1.0
        for source_row in source[1:]:
            portfolio_return = source_row["portfolioReturn"]
            nav *= 1.0 + portfolio_return
            running_peak = max(running_peak, nav)
            normalized.append(
                {
                    "timestamp": source_row["timestamp"],
                    "portfolioReturn": portfolio_return,
                    "cumulativeReturn": nav - 1.0,
                    "nav": nav,
                    "runningPeak": running_peak,
                    "drawdown": nav / running_peak - 1.0,
                }
            )
        return normalized

    primary_rows = normalized_window(primary_bars)
    trough_index = min(
        range(len(primary_rows)),
        key=lambda index: primary_rows[index]["drawdown"],
    )
    peak_index = max(
        range(trough_index + 1),
        key=lambda index: primary_rows[index]["nav"],
    )
    peak_nav = primary_rows[peak_index]["nav"]
    recovery_index = next(
        (
            index
            for index in range(trough_index, len(primary_rows))
            if primary_rows[index]["nav"] >= peak_nav * (1.0 - 1e-12)
        ),
        None,
    )
    expected_recovery = (
        primary_rows[recovery_index]["timestamp"]
        if recovery_index is not None
        else None
    )
    _close(
        maximum_drawdown,
        primary_rows[trough_index]["drawdown"],
        paths["book-risk-equity-path"],
    )
    if (
        drawdown["peakTimestamp"] != primary_rows[peak_index]["timestamp"]
        or drawdown["troughTimestamp"]
        != primary_rows[trough_index]["timestamp"]
        or drawdown["recoveryTimestamp"] != expected_recovery
    ):
        _fail(
            paths["book-risk-equity-path"],
            "book-risk.drawdown-interval",
            "Drawdown interval does not reconcile with the equity path",
        )
    _close(
        current["maximumDrawdown"],
        maximum_drawdown,
        f"{paths['book-risk-report']}/current/maximumDrawdown",
    )
    for lookback in lookbacks:
        bars = int(lookback["lookbackBars"])
        window = normalized_window(bars)
        derived_maximum = min(row["drawdown"] for row in window)
        _close(
            lookback["maximumDrawdown"],
            derived_maximum,
            (
                f"{paths['book-risk-report']}/lookbacks/"
                f"{lookback['lookbackBars']}/maximumDrawdown"
            ),
        )
    sampled = _sample(primary_rows, point_limit)
    return drawdown, {
        "available": True,
        "totalRows": len(primary_rows),
        "sampledRows": len(sampled),
        "points": sampled,
        "summary": drawdown,
    }


def load_book_risk_diagnostics(
    project: ProjectContext,
    run_id: str,
    *,
    point_limit: int = DEFAULT_BOOK_RISK_POINTS,
) -> dict[str, Any]:
    """Verify and project one immutable Book Risk Run."""

    if (
        not isinstance(point_limit, int)
        or isinstance(point_limit, bool)
        or not MIN_BOOK_RISK_POINTS <= point_limit <= MAX_BOOK_RISK_POINTS
    ):
        _fail(
            point_limit,
            "book-risk.point-limit",
            f"point_limit must be {MIN_BOOK_RISK_POINTS}..{MAX_BOOK_RISK_POINTS}",
        )
    run = load_run(project, run_id)
    if run.result["objective"]["metric"] != "current_component_risk_hhi":
        _fail(
            run.root_dir,
            "book-risk.run-kind",
            "Run is not a fixed Book Risk evaluation",
        )
    paths, legacy = _artifact_paths(run)
    report_keys = {
        "schemaVersion",
        "kind",
        "requestHash",
        "positionSnapshot",
        "authority",
        "method",
        "dataset",
        "lookbacks",
        "current",
        "contributions",
        "pairwiseCorrelations",
        "reductions",
        "scenarioComparison",
        "positionSizing",
        "rollingSummary",
    }
    if not legacy:
        report_keys.add("drawdown")
    report = _strict(
        _read_object(paths["book-risk-report"]),
        report_keys,
        paths["book-risk-report"],
    )
    if (
        report["schemaVersion"] != SCHEMA_VERSION
        or report["kind"] != "autoquant-book-risk-report"
    ):
        _fail(
            paths["book-risk-report"],
            "book-risk.report-kind",
            "Invalid Book Risk report identity",
        )
    frozen_snapshot_path = _frozen_book_risk_dependency(
        run,
        flag="--position-snapshot",
        default="strategies/position-snapshot.json",
        code="book-risk.position-snapshot-dependency",
    )
    frozen_snapshot = _read_object(frozen_snapshot_path)
    validate_position_snapshot(frozen_snapshot, frozen_snapshot_path)
    if report["positionSnapshot"] != frozen_snapshot:
        _fail(
            paths["book-risk-report"],
            "book-risk.position-snapshot",
            "Report position snapshot differs from the frozen dependency",
        )
    if report["requestHash"] != frozen_snapshot.get("source", {}).get(
        "requestHash"
    ):
        _fail(
            paths["book-risk-report"],
            "book-risk.request-hash",
            "Report request hash differs from the frozen position snapshot",
        )
    authority = {
        "positionTruth": "external-reported-not-authenticated",
        "marketEvidence": "content-locked-closed-ohlcv",
        "tradingAuthority": "none",
        "reductionMeaning": "standardized-historical-sensitivity",
        "scenarioMeaning": "caller-specified-historical-comparison",
        "sizingMeaning": "caller-bounded-historical-target-position",
    }
    if not legacy:
        authority["drawdownMeaning"] = (
            "static-weight-close-to-close-research-path"
        )
    if report["authority"] != authority:
        _fail(
            paths["book-risk-report"],
            "book-risk.authority",
            "Book Risk authority boundary differs from the fixed contract",
        )
    current_keys = {
        "observations",
        "annualizedVolatility",
        "annualizedVariance",
        "componentRiskHhi",
        "effectiveRiskBets",
        "firstPrincipalComponentVarianceShare",
        "largestAbsoluteRiskContributorShare",
        "lookbackBars",
        "grossExposure",
        "netExposure",
        "cashWeight",
    }
    if not legacy:
        current_keys.add("maximumDrawdown")
    current = _strict(
        report["current"],
        current_keys,
        f"{paths['book-risk-report']}/current",
    )
    current_numeric = {
        key: _finite(value, f"{paths['book-risk-report']}/current/{key}")
        for key, value in current.items()
    }
    if (
        current_numeric["observations"] < 20
        or current_numeric["annualizedVolatility"] <= 0
        or not 0 < current_numeric["componentRiskHhi"] <= 1
        or current_numeric["effectiveRiskBets"] < 1
        or not 0
        <= current_numeric["firstPrincipalComponentVarianceShare"]
        <= 1
        or not 0
        <= current_numeric["largestAbsoluteRiskContributorShare"]
        <= 1
    ):
        _fail(
            f"{paths['book-risk-report']}/current",
            "book-risk.current",
            "Current Book Risk evidence is outside valid bounds",
        )
    _close(
        current_numeric["annualizedVolatility"] ** 2,
        current_numeric["annualizedVariance"],
        f"{paths['book-risk-report']}/current/annualizedVariance",
    )
    _close(
        1.0 / current_numeric["componentRiskHhi"],
        current_numeric["effectiveRiskBets"],
        f"{paths['book-risk-report']}/current/effectiveRiskBets",
    )
    metric_map = {
        "current_component_risk_hhi": "componentRiskHhi",
        "current_effective_risk_bets": "effectiveRiskBets",
        "current_annualized_volatility": "annualizedVolatility",
        "current_first_pc_variance_share": (
            "firstPrincipalComponentVarianceShare"
        ),
        "largest_risk_contributor_share": (
            "largestAbsoluteRiskContributorShare"
        ),
        "primary_lookback_bars": "lookbackBars",
    }
    if not legacy:
        metric_map["current_maximum_drawdown"] = "maximumDrawdown"
    for metric, field in metric_map.items():
        _close(
            _finite(run.result["metrics"].get(metric), f"metrics/{metric}"),
            current_numeric[field],
            f"metrics/{metric}",
        )
    frozen_scenarios = frozen_snapshot["scenarios"]
    _close(
        _finite(
            run.result["metrics"].get("scenario_count"),
            "metrics/scenario_count",
        ),
        float(len(frozen_scenarios)),
        "metrics/scenario_count",
    )
    sizing_policy = frozen_snapshot["sizingPolicy"]
    expected_sizing_metrics = {
        "sizing_requested": float(sizing_policy is not None),
        "sizing_feasible": float(
            report["positionSizing"].get("status")
            in {
                "sized",
                "unchanged-compliant",
                "fully-funded-compliant",
                "maximum-weight-compliant",
            }
            if isinstance(report["positionSizing"], dict)
            else False
        ),
        "sizing_weight_change": float(
            report["positionSizing"].get("result", {}).get(
                "weightChange",
                0.0,
            )
            if isinstance(report["positionSizing"], dict)
            else 0.0
        ),
    }
    for metric, expected in expected_sizing_metrics.items():
        _close(
            _finite(run.result["metrics"].get(metric), f"metrics/{metric}"),
            expected,
            f"metrics/{metric}",
        )
    method = _strict(
        report["method"],
        {
            "schemaVersion",
            "kind",
            "lookbackBars",
            "primaryLookbackBars",
            "minimumObservations",
            "reductionWeight",
            "rollingStepBars",
        },
        f"{paths['book-risk-report']}/method",
    )
    if (
        method["schemaVersion"] != SCHEMA_VERSION
        or method["kind"] != "autoquant-book-risk-scenarios"
        or not isinstance(method["lookbackBars"], list)
        or not method["lookbackBars"]
        or not all(
            isinstance(item, int)
            and not isinstance(item, bool)
            and 20 <= item <= 2520
            for item in method["lookbackBars"]
        )
        or method["lookbackBars"] != sorted(set(method["lookbackBars"]))
        or method["primaryLookbackBars"] not in method["lookbackBars"]
        or not isinstance(method["minimumObservations"], int)
        or isinstance(method["minimumObservations"], bool)
        or not isinstance(method["rollingStepBars"], int)
        or isinstance(method["rollingStepBars"], bool)
        or not 20 <= method["minimumObservations"] <= max(method["lookbackBars"])
        or not 1 <= method["rollingStepBars"] <= 252
        or not 0 < _finite(
            method["reductionWeight"],
            f"{paths['book-risk-report']}/method/reductionWeight",
        ) <= 0.25
    ):
        _fail(
            f"{paths['book-risk-report']}/method",
            "book-risk.method",
            "Book Risk method differs from the bounded contract",
        )
    if (
        sizing_policy is not None
        and method["primaryLookbackBars"] != sizing_policy["lookbackBars"]
    ):
        _fail(
            f"{paths['book-risk-report']}/method/primaryLookbackBars",
            "book-risk.position-sizing-primary-lookback",
            "Book Risk primary window differs from the caller-fixed sizing lookback",
        )
    dataset = _strict(
        report["dataset"],
        {
            "id",
            "version",
            "assetClass",
            "universe",
            "heldAssets",
            "marketDataEnd",
            "annualizationPeriods",
        },
        f"{paths['book-risk-report']}/dataset",
    )
    if (
        not isinstance(dataset["id"], str)
        or not dataset["id"]
        or not isinstance(dataset["version"], str)
        or not dataset["version"]
        or not isinstance(dataset["assetClass"], str)
        or not dataset["assetClass"]
        or not isinstance(dataset["universe"], list)
        or not isinstance(dataset["heldAssets"], list)
        or not all(
            isinstance(item, str) and item
            for item in dataset["universe"] + dataset["heldAssets"]
        )
        or len(dataset["universe"]) != len(set(dataset["universe"]))
        or len(dataset["heldAssets"]) != len(set(dataset["heldAssets"]))
        or dataset["heldAssets"] != list(frozen_snapshot["weights"])
        or not set(dataset["heldAssets"]).issubset(dataset["universe"])
        or not isinstance(dataset["marketDataEnd"], str)
        or not dataset["marketDataEnd"]
        or not isinstance(dataset["annualizationPeriods"], int)
        or isinstance(dataset["annualizationPeriods"], bool)
        or dataset["annualizationPeriods"] <= 0
    ):
        _fail(
            f"{paths['book-risk-report']}/dataset",
            "book-risk.dataset",
            "Book Risk dataset description is invalid",
        )
    raw_lookbacks = report["lookbacks"]
    if (
        not isinstance(raw_lookbacks, list)
        or not raw_lookbacks
        or not all(isinstance(item, dict) for item in raw_lookbacks)
        or [item.get("lookbackBars") for item in raw_lookbacks]
        != method.get("lookbackBars")
    ):
        _fail(
            f"{paths['book-risk-report']}/lookbacks",
            "book-risk.lookbacks",
            "Lookback evidence differs from the declared method",
        )
    lookbacks: list[dict[str, Any]] = []
    lookback_ranking_flags = [
        "reductionRanking" in item for item in raw_lookbacks
    ]
    if any(lookback_ranking_flags) and not all(lookback_ranking_flags):
        _fail(
            f"{paths['book-risk-report']}/lookbacks",
            "book-risk.lookback-reduction-rankings",
            "Lookback reduction rankings must be present for every lookback",
        )
    has_lookback_rankings = all(lookback_ranking_flags)
    lookback_keys = {
        "lookbackBars",
        "observations",
        "annualizedVolatility",
        "annualizedVariance",
        "componentRiskHhi",
        "effectiveRiskBets",
        "firstPrincipalComponentVarianceShare",
        "largestAbsoluteRiskContributorShare",
        "largestAbsoluteRiskContributor",
        "firstReductionAsset",
        "firstReductionVolatilityPerWeight",
    }
    if not legacy:
        lookback_keys.add("maximumDrawdown")
    if has_lookback_rankings:
        lookback_keys.add("reductionRanking")
    for index, raw in enumerate(raw_lookbacks):
        item = _strict(
            raw,
            lookback_keys,
            f"{paths['book-risk-report']}/lookbacks/{index}",
        )
        parsed = {
            key: (
                item[key]
                if key
                in {
                    "largestAbsoluteRiskContributor",
                    "firstReductionAsset",
                    "reductionRanking",
                }
                else _finite(
                    item[key],
                    f"{paths['book-risk-report']}/lookbacks/{index}/{key}",
                )
            )
            for key in lookback_keys
        }
        if has_lookback_rankings:
            raw_ranking = parsed["reductionRanking"]
            if (
                not isinstance(raw_ranking, list)
                or not raw_ranking
                or not all(isinstance(row, dict) for row in raw_ranking)
            ):
                _fail(
                    (
                        f"{paths['book-risk-report']}/lookbacks/{index}/"
                        "reductionRanking"
                    ),
                    "book-risk.lookback-reduction-ranking",
                    "Lookback reduction ranking must be a non-empty list",
                )
            ranking: list[dict[str, Any]] = []
            for ranking_index, raw_row in enumerate(raw_ranking):
                row_path = (
                    f"{paths['book-risk-report']}/lookbacks/{index}/"
                    f"reductionRanking/{ranking_index}"
                )
                row = _strict(raw_row, set(REDUCTION_COLUMNS), row_path)
                if (
                    not isinstance(row["rank"], int)
                    or isinstance(row["rank"], bool)
                    or not isinstance(row["asset"], str)
                    or not row["asset"]
                ):
                    _fail(
                        row_path,
                        "book-risk.lookback-reduction-row",
                        "Lookback reduction row identity is invalid",
                    )
                ranking.append(
                    {
                        "rank": row["rank"],
                        "asset": row["asset"],
                        **{
                            key: _finite(row[key], f"{row_path}/{key}")
                            for key in REDUCTION_COLUMNS[2:]
                        },
                    }
                )
            if (
                [row["rank"] for row in ranking]
                != list(range(1, len(ranking) + 1))
                or len({row["asset"] for row in ranking}) != len(ranking)
                or any(
                    ranking[position]["volatilityReductionPerWeight"]
                    < ranking[position + 1][
                        "volatilityReductionPerWeight"
                    ]
                    - 1e-12
                    for position in range(len(ranking) - 1)
                )
                or ranking[0]["asset"] != parsed["firstReductionAsset"]
            ):
                _fail(
                    (
                        f"{paths['book-risk-report']}/lookbacks/{index}/"
                        "reductionRanking"
                    ),
                    "book-risk.lookback-reduction-order",
                    "Lookback reduction ranking is invalid",
                )
            parsed["reductionRanking"] = ranking
        if (
            parsed["observations"] != parsed["lookbackBars"]
            or parsed["annualizedVolatility"] <= 0
            or not 0 < parsed["componentRiskHhi"] <= 1
            or parsed["effectiveRiskBets"] < 1
            or not 0
            <= parsed["firstPrincipalComponentVarianceShare"]
            <= 1
            or not 0
            <= parsed["largestAbsoluteRiskContributorShare"]
            <= 1
            or (
                not legacy
                and parsed["maximumDrawdown"] > 1e-12
            )
            or not isinstance(
                parsed["largestAbsoluteRiskContributor"],
                str,
            )
            or not isinstance(parsed["firstReductionAsset"], str)
        ):
            _fail(
                f"{paths['book-risk-report']}/lookbacks/{index}",
                "book-risk.lookback",
                "Lookback evidence is outside valid bounds",
            )
        _close(
            parsed["annualizedVolatility"] ** 2,
            parsed["annualizedVariance"],
            f"{paths['book-risk-report']}/lookbacks/{index}",
        )
        _close(
            1.0 / parsed["componentRiskHhi"],
            parsed["effectiveRiskBets"],
            f"{paths['book-risk-report']}/lookbacks/{index}",
        )
        lookbacks.append(parsed)
    contribution_rows = _csv_rows(
        paths["book-risk-contributions"],
        CONTRIBUTION_COLUMNS,
    )
    contributions: list[dict[str, Any]] = []
    for index, row in enumerate(contribution_rows):
        parsed = {
            "asset": row["asset"],
            **{
                key: _csv_finite(
                    row[key],
                    f"{paths['book-risk-contributions']}:{index + 2}/{key}",
                )
                for key in CONTRIBUTION_COLUMNS[1:]
            },
        }
        contributions.append(parsed)
    if contributions != report["contributions"]:
        _fail(
            paths["book-risk-contributions"],
            "book-risk.contributions",
            "Contribution CSV differs from the report",
        )
    if len({row["asset"] for row in contributions}) != len(contributions):
        _fail(
            paths["book-risk-contributions"],
            "book-risk.contribution-assets",
            "Contribution assets must be unique",
        )
    _close(
        sum(row["absoluteRiskShare"] for row in contributions),
        1.0,
        paths["book-risk-contributions"],
    )
    _close(
        sum(row["signedRiskShare"] for row in contributions),
        1.0,
        paths["book-risk-contributions"],
    )
    reduction_rows = _csv_rows(
        paths["book-risk-reductions"],
        REDUCTION_COLUMNS,
    )
    reductions: list[dict[str, Any]] = []
    for index, row in enumerate(reduction_rows):
        reductions.append(
            {
                "rank": int(row["rank"]),
                "asset": row["asset"],
                **{
                    key: _csv_finite(
                        row[key],
                        f"{paths['book-risk-reductions']}:{index + 2}/{key}",
                    )
                    for key in REDUCTION_COLUMNS[2:]
                },
            }
        )
    if reductions != report["reductions"]:
        _fail(
            paths["book-risk-reductions"],
            "book-risk.reductions",
            "Reduction CSV differs from the report",
        )
    if (
        [row["rank"] for row in reductions]
        != list(range(1, len(reductions) + 1))
        or [row["asset"] for row in reductions]
        != [row["asset"] for row in contributions]
        and set(row["asset"] for row in reductions)
        != set(row["asset"] for row in contributions)
        or any(
            reductions[index]["volatilityReductionPerWeight"]
            < reductions[index + 1]["volatilityReductionPerWeight"] - 1e-12
            for index in range(len(reductions) - 1)
        )
    ):
        _fail(
            paths["book-risk-reductions"],
            "book-risk.reduction-order",
            "Reduction ranking is invalid",
        )
    correlation_rows = _csv_rows(
        paths["book-risk-correlations"],
        CORRELATION_COLUMNS,
        allow_empty=len(contributions) == 1,
    )
    correlations = [
        {
            "leftAsset": row["leftAsset"],
            "rightAsset": row["rightAsset"],
            "correlation": _csv_finite(
                row["correlation"],
                f"{paths['book-risk-correlations']}:{index + 2}/correlation",
            ),
        }
        for index, row in enumerate(correlation_rows)
    ]
    if (
        correlations != report["pairwiseCorrelations"]
        or len(correlations)
        != len(contributions) * (len(contributions) - 1) // 2
        or any(abs(row["correlation"]) > 1 + 1e-12 for row in correlations)
    ):
        _fail(
            paths["book-risk-correlations"],
            "book-risk.correlations",
            "Correlation evidence is invalid",
        )
    comparison = _strict(
        report["scenarioComparison"],
        {
            "comparisonUniverse",
            "baselineLookbacks",
            "scenarios",
            "ranking",
        },
        f"{paths['book-risk-report']}/scenarioComparison",
    )
    expected_comparison_universe = list(frozen_snapshot["weights"])
    for scenario in frozen_scenarios:
        for asset in scenario["weights"]:
            if asset not in expected_comparison_universe:
                expected_comparison_universe.append(asset)
    if comparison["comparisonUniverse"] != expected_comparison_universe:
        _fail(
            f"{paths['book-risk-report']}/scenarioComparison/comparisonUniverse",
            "book-risk.scenario-universe",
            "Scenario comparison universe differs from frozen books",
        )
    if comparison["ranking"] != {
        "metric": "annualizedVolatilityDelta",
        "direction": "minimize",
        "selectionAuthority": "none",
    }:
        _fail(
            f"{paths['book-risk-report']}/scenarioComparison/ranking",
            "book-risk.scenario-ranking",
            "Scenario ranking authority differs from the fixed contract",
        )
    raw_baseline_lookbacks = comparison["baselineLookbacks"]
    raw_scenario_results = comparison["scenarios"]
    if (
        not isinstance(raw_baseline_lookbacks, list)
        or not isinstance(raw_scenario_results, list)
        or len(raw_scenario_results) != len(frozen_scenarios)
        or (
            frozen_scenarios
            and len(raw_baseline_lookbacks) != len(method["lookbackBars"])
        )
        or (not frozen_scenarios and raw_baseline_lookbacks)
    ):
        _fail(
            f"{paths['book-risk-report']}/scenarioComparison",
            "book-risk.scenario-count",
            "Scenario comparison counts differ from frozen authority",
        )
    baseline_lookbacks: list[dict[str, Any]] = []
    baseline_keys = {
        "lookbackBars",
        "observations",
        "annualizedVolatility",
        "componentRiskHhi",
        "effectiveRiskBets",
    }
    for index, raw in enumerate(raw_baseline_lookbacks):
        raw = _strict(
            raw,
            baseline_keys,
            f"{paths['book-risk-report']}/scenarioComparison/"
            f"baselineLookbacks/{index}",
        )
        parsed = {
            key: _finite(
                value,
                f"{paths['book-risk-report']}/scenarioComparison/"
                f"baselineLookbacks/{index}/{key}",
            )
            for key, value in raw.items()
        }
        if (
            parsed["lookbackBars"] != method["lookbackBars"][index]
            or parsed["observations"] != parsed["lookbackBars"]
            or parsed["annualizedVolatility"] <= 0
            or not 0 < parsed["componentRiskHhi"] <= 1
            or parsed["effectiveRiskBets"] < 1
        ):
            _fail(
                f"{paths['book-risk-report']}/scenarioComparison/"
                f"baselineLookbacks/{index}",
                "book-risk.scenario-baseline",
                "Scenario baseline is outside valid bounds",
            )
        _close(
            1.0 / parsed["componentRiskHhi"],
            parsed["effectiveRiskBets"],
            f"{paths['book-risk-report']}/scenarioComparison/"
            f"baselineLookbacks/{index}",
        )
        matching = next(
            row
            for row in lookbacks
            if row["lookbackBars"] == parsed["lookbackBars"]
        )
        for key in (
            "annualizedVolatility",
            "componentRiskHhi",
            "effectiveRiskBets",
        ):
            _close(
                parsed[key],
                matching[key],
                f"{paths['book-risk-report']}/scenarioComparison/"
                f"baselineLookbacks/{index}/{key}",
            )
        baseline_lookbacks.append(parsed)
    baseline_by_lookback = {
        int(row["lookbackBars"]): row for row in baseline_lookbacks
    }
    scenario_lookback_keys = {
        "volatilityRank",
        "lookbackBars",
        "observations",
        "annualizedVolatility",
        "annualizedVolatilityDelta",
        "componentRiskHhi",
        "componentRiskHhiDelta",
        "effectiveRiskBets",
        "effectiveRiskBetsDelta",
        "largestAbsoluteRiskContributor",
        "largestAbsoluteRiskContributorShare",
    }
    parsed_scenarios: list[dict[str, Any]] = []
    for index, (raw, frozen) in enumerate(
        zip(raw_scenario_results, frozen_scenarios, strict=True)
    ):
        raw = _strict(
            raw,
            {"id", "name", "weights", "cashWeight", "lookbacks"},
            f"{paths['book-risk-report']}/scenarioComparison/scenarios/{index}",
        )
        if (
            raw["id"] != frozen["id"]
            or raw["name"] != frozen["name"]
            or raw["weights"] != frozen["weights"]
            or raw["cashWeight"] != frozen["cashWeight"]
            or not isinstance(raw["lookbacks"], list)
            or len(raw["lookbacks"]) != len(method["lookbackBars"])
        ):
            _fail(
                f"{paths['book-risk-report']}/scenarioComparison/"
                f"scenarios/{index}",
                "book-risk.scenario-identity",
                "Scenario result differs from the frozen hypothetical book",
            )
        parsed_lookbacks: list[dict[str, Any]] = []
        for lookback_index, lookback_raw in enumerate(raw["lookbacks"]):
            row_path = (
                f"{paths['book-risk-report']}/scenarioComparison/"
                f"scenarios/{index}/lookbacks/{lookback_index}"
            )
            lookback_raw = _strict(
                lookback_raw,
                scenario_lookback_keys,
                row_path,
            )
            if not isinstance(
                lookback_raw["largestAbsoluteRiskContributor"],
                str,
            ):
                _fail(
                    row_path,
                    "book-risk.scenario-contributor",
                    "Scenario contributor must be an asset symbol",
                )
            parsed = {
                key: (
                    lookback_raw[key]
                    if key == "largestAbsoluteRiskContributor"
                    else _finite(lookback_raw[key], f"{row_path}/{key}")
                )
                for key in scenario_lookback_keys
            }
            lookback = method["lookbackBars"][lookback_index]
            baseline = baseline_by_lookback.get(lookback)
            if (
                baseline is None
                or parsed["lookbackBars"] != lookback
                or parsed["observations"] != lookback
                or parsed["annualizedVolatility"] <= 0
                or not 0 < parsed["componentRiskHhi"] <= 1
                or parsed["effectiveRiskBets"] < 1
                or not 0
                <= parsed["largestAbsoluteRiskContributorShare"]
                <= 1
                or parsed["largestAbsoluteRiskContributor"]
                not in expected_comparison_universe
            ):
                _fail(
                    row_path,
                    "book-risk.scenario-lookback",
                    "Scenario lookback evidence is outside valid bounds",
                )
            _close(
                1.0 / parsed["componentRiskHhi"],
                parsed["effectiveRiskBets"],
                row_path,
            )
            for metric, delta in (
                ("annualizedVolatility", "annualizedVolatilityDelta"),
                ("componentRiskHhi", "componentRiskHhiDelta"),
                ("effectiveRiskBets", "effectiveRiskBetsDelta"),
            ):
                _close(
                    parsed[metric] - baseline[metric],
                    parsed[delta],
                    f"{row_path}/{delta}",
                )
            parsed_lookbacks.append(parsed)
        parsed_scenarios.append(
            {
                "id": raw["id"],
                "name": raw["name"],
                "weights": raw["weights"],
                "cashWeight": _finite(
                    raw["cashWeight"],
                    f"{paths['book-risk-report']}/scenarioComparison/"
                    f"scenarios/{index}/cashWeight",
                ),
                "lookbacks": parsed_lookbacks,
            }
        )
    for lookback_index, lookback in enumerate(method["lookbackBars"]):
        rows = [
            scenario["lookbacks"][lookback_index]
            for scenario in parsed_scenarios
        ]
        if (
            sorted(int(row["volatilityRank"]) for row in rows)
            != list(range(1, len(rows) + 1))
            or [
                row["annualizedVolatilityDelta"]
                for row in sorted(
                    rows,
                    key=lambda item: item["volatilityRank"],
                )
            ]
            != sorted(
                row["annualizedVolatilityDelta"] for row in rows
            )
        ):
            _fail(
                f"{paths['book-risk-report']}/scenarioComparison/"
                f"scenarios/*/lookbacks/{lookback_index}",
                "book-risk.scenario-rank",
                f"Scenario volatility ranking is invalid for {lookback}",
            )
    comparison_csv_raw = _csv_rows(
        paths["book-risk-scenario-comparisons"],
        SCENARIO_COMPARISON_COLUMNS,
        allow_empty=True,
    )
    comparison_csv: list[dict[str, Any]] = []
    for index, row in enumerate(comparison_csv_raw):
        comparison_csv.append(
            {
                "scenarioId": row["scenarioId"],
                "scenarioName": row["scenarioName"],
                "volatilityRank": int(row["volatilityRank"]),
                "lookbackBars": int(row["lookbackBars"]),
                "observations": int(row["observations"]),
                **{
                    key: (
                        row[key]
                        if key == "largestAbsoluteRiskContributor"
                        else _csv_finite(
                            row[key],
                            f"{paths['book-risk-scenario-comparisons']}:"
                            f"{index + 2}/{key}",
                        )
                    )
                    for key in SCENARIO_COMPARISON_COLUMNS[5:]
                },
            }
        )
    expected_comparison_csv = [
        {
            "scenarioId": scenario["id"],
            "scenarioName": scenario["name"],
            **row,
        }
        for scenario in parsed_scenarios
        for row in scenario["lookbacks"]
    ]
    if comparison_csv != expected_comparison_csv:
        _fail(
            paths["book-risk-scenario-comparisons"],
            "book-risk.scenario-comparisons",
            "Scenario comparison CSV differs from the report",
        )
    contribution_csv_raw = _csv_rows(
        paths["book-risk-scenario-contributions"],
        SCENARIO_CONTRIBUTION_COLUMNS,
        allow_empty=True,
    )
    scenario_contributions: list[dict[str, Any]] = []
    for index, row in enumerate(contribution_csv_raw):
        scenario_contributions.append(
            {
                "scenarioId": row["scenarioId"],
                "asset": row["asset"],
                **{
                    key: _csv_finite(
                        row[key],
                        f"{paths['book-risk-scenario-contributions']}:"
                        f"{index + 2}/{key}",
                    )
                    for key in SCENARIO_CONTRIBUTION_COLUMNS[2:]
                },
            }
        )
    if len(scenario_contributions) != (
        len(parsed_scenarios) * len(expected_comparison_universe)
    ):
        _fail(
            paths["book-risk-scenario-contributions"],
            "book-risk.scenario-contribution-count",
            "Scenario contribution row count is invalid",
        )
    baseline_weights = {
        asset: float(frozen_snapshot["weights"].get(asset, 0.0))
        for asset in expected_comparison_universe
    }
    baseline_contributions = {
        row["asset"]: row for row in contributions
    }
    primary_index = method["lookbackBars"].index(
        method["primaryLookbackBars"]
    )
    for scenario, frozen in zip(
        parsed_scenarios,
        frozen_scenarios,
        strict=True,
    ):
        rows = [
            row
            for row in scenario_contributions
            if row["scenarioId"] == scenario["id"]
        ]
        if [row["asset"] for row in rows] != expected_comparison_universe:
            _fail(
                paths["book-risk-scenario-contributions"],
                "book-risk.scenario-contribution-assets",
                "Scenario contribution assets differ from comparison universe",
            )
        scenario_weights = {
            asset: float(frozen["weights"].get(asset, 0.0))
            for asset in expected_comparison_universe
        }
        for row in rows:
            asset = row["asset"]
            _close(
                row["baselineWeight"],
                baseline_weights[asset],
                paths["book-risk-scenario-contributions"],
            )
            baseline_evidence = baseline_contributions.get(asset)
            _close(
                row["baselineComponentVariance"],
                (
                    baseline_evidence["componentVariance"]
                    if baseline_evidence is not None
                    else 0.0
                ),
                paths["book-risk-scenario-contributions"],
            )
            _close(
                row["baselineAbsoluteRiskShare"],
                (
                    baseline_evidence["absoluteRiskShare"]
                    if baseline_evidence is not None
                    else 0.0
                ),
                paths["book-risk-scenario-contributions"],
            )
            _close(
                row["scenarioWeight"],
                scenario_weights[asset],
                paths["book-risk-scenario-contributions"],
            )
            for left, right, delta in (
                ("scenarioWeight", "baselineWeight", "weightDelta"),
                (
                    "scenarioComponentVariance",
                    "baselineComponentVariance",
                    "componentVarianceDelta",
                ),
                (
                    "scenarioAbsoluteRiskShare",
                    "baselineAbsoluteRiskShare",
                    "absoluteRiskShareDelta",
                ),
            ):
                _close(
                    row[left] - row[right],
                    row[delta],
                    paths["book-risk-scenario-contributions"],
                )
        _close(
            sum(row["baselineAbsoluteRiskShare"] for row in rows),
            1.0,
            paths["book-risk-scenario-contributions"],
        )
        _close(
            sum(row["scenarioAbsoluteRiskShare"] for row in rows),
            1.0,
            paths["book-risk-scenario-contributions"],
        )
        primary_row = scenario["lookbacks"][primary_index]
        primary_baseline = baseline_lookbacks[primary_index]
        _close(
            sum(
                row["baselineAbsoluteRiskShare"] ** 2
                for row in rows
            ),
            primary_baseline["componentRiskHhi"],
            paths["book-risk-scenario-contributions"],
        )
        _close(
            sum(
                row["scenarioAbsoluteRiskShare"] ** 2
                for row in rows
            ),
            primary_row["componentRiskHhi"],
            paths["book-risk-scenario-contributions"],
        )
        _close(
            sum(row["baselineComponentVariance"] for row in rows),
            primary_baseline["annualizedVolatility"] ** 2,
            paths["book-risk-scenario-contributions"],
        )
        _close(
            sum(row["scenarioComponentVariance"] for row in rows),
            primary_row["annualizedVolatility"] ** 2,
            paths["book-risk-scenario-contributions"],
        )
        largest = max(
            rows,
            key=lambda row: row["scenarioAbsoluteRiskShare"],
        )
        if (
            primary_row["largestAbsoluteRiskContributor"]
            != largest["asset"]
        ):
            _fail(
                paths["book-risk-scenario-contributions"],
                "book-risk.scenario-contributor",
                "Scenario contributor leader differs from contribution rows",
            )
        _close(
            primary_row["largestAbsoluteRiskContributorShare"],
            largest["scenarioAbsoluteRiskShare"],
            paths["book-risk-scenario-contributions"],
        )
        scenario["primaryContributions"] = rows
    position_sizing = _validate_position_sizing(
        report["positionSizing"],
        frozen_snapshot,
        method,
        lookbacks,
        paths,
    )
    path_rows_raw = _csv_rows(paths["book-risk-path"], PATH_COLUMNS)
    path_rows: list[dict[str, Any]] = []
    previous = ""
    for index, row in enumerate(path_rows_raw):
        timestamp = row["timestamp"]
        if not timestamp or timestamp <= previous:
            _fail(
                f"{paths['book-risk-path']}:{index + 2}/timestamp",
                "book-risk.path-order",
                "Book Risk path timestamps must be ordered and unique",
            )
        previous = timestamp
        path_rows.append(
            {
                "timestamp": timestamp,
                **{
                    key: (
                        int(row[key])
                        if key == "observations"
                        else _csv_finite(
                            row[key],
                            f"{paths['book-risk-path']}:{index + 2}/{key}",
                        )
                    )
                    for key in PATH_COLUMNS[1:]
                },
            }
        )
    rolling = _strict(
        report["rollingSummary"],
        {
            "observations",
            "start",
            "end",
            "minimumEffectiveRiskBets",
            "maximumComponentRiskHhi",
        },
        f"{paths['book-risk-report']}/rollingSummary",
    )
    if (
        rolling["observations"] != len(path_rows)
        or rolling["start"] != path_rows[0]["timestamp"]
        or rolling["end"] != path_rows[-1]["timestamp"]
    ):
        _fail(
            paths["book-risk-path"],
            "book-risk.path-summary",
            "Rolling path summary does not reconcile",
        )
    _close(
        _finite(
            rolling["minimumEffectiveRiskBets"],
            "rollingSummary/minimumEffectiveRiskBets",
        ),
        min(row["effectiveRiskBets"] for row in path_rows),
        paths["book-risk-path"],
    )
    drawdown, equity_path = _validate_drawdown_evidence(
        report,
        paths,
        current_numeric,
        dataset,
        lookbacks,
        point_limit,
        legacy=legacy,
    )
    _close(
        _finite(
            rolling["maximumComponentRiskHhi"],
            "rollingSummary/maximumComponentRiskHhi",
        ),
        max(row["componentRiskHhi"] for row in path_rows),
        paths["book-risk-path"],
    )
    held_assets = set(frozen_snapshot["weights"])
    if (
        set(row["asset"] for row in contributions) != held_assets
        or set(row["asset"] for row in reductions) != held_assets
    ):
        _fail(
            paths["book-risk-report"],
            "book-risk.held-assets",
            "Book Risk evidence differs from reported held assets",
        )
    if any(
        row["largestAbsoluteRiskContributor"] not in held_assets
        or row["firstReductionAsset"] not in held_assets
        for row in lookbacks
    ):
        _fail(
            paths["book-risk-report"],
            "book-risk.lookback-assets",
            "Lookback priority evidence names an unreported asset",
        )
    if has_lookback_rankings and any(
        set(item["asset"] for item in row["reductionRanking"]) != held_assets
        for row in lookbacks
    ):
        _fail(
            paths["book-risk-report"],
            "book-risk.lookback-reduction-assets",
            "Lookback reduction rankings differ from reported held assets",
        )
    primary_lookback = next(
        (
            row
            for row in lookbacks
            if row["lookbackBars"] == current_numeric["lookbackBars"]
        ),
        None,
    )
    if (
        primary_lookback is None
        or primary_lookback["largestAbsoluteRiskContributor"]
        != contributions[0]["asset"]
        or primary_lookback["firstReductionAsset"]
        != reductions[0]["asset"]
        or (
            has_lookback_rankings
            and primary_lookback["reductionRanking"] != reductions
        )
    ):
        _fail(
            paths["book-risk-report"],
            "book-risk.primary-lookback",
            "Primary lookback priority does not reconcile",
        )
    sampled = _sample(path_rows, point_limit)
    return {
        "schemaVersion": SCHEMA_VERSION,
        "kind": BOOK_RISK_DIAGNOSTICS_KIND,
        "run": {
            "id": run.result["id"],
            "status": run.result["status"],
            "harness": run.result["harness"],
            "primaryMetric": run.result["objective"]["metric"],
            "primaryValue": run.result["metrics"][
                run.result["objective"]["metric"]
            ],
        },
        "positionSnapshot": frozen_snapshot,
        "authority": authority,
        "current": current,
        "lookbacks": lookbacks,
        "riskContributions": contributions,
        "reductionPriority": reductions,
        "pairwiseCorrelations": correlations,
        "scenarioComparison": {
            "comparisonUniverse": expected_comparison_universe,
            "baselineLookbacks": baseline_lookbacks,
            "scenarios": parsed_scenarios,
            "ranking": comparison["ranking"],
        },
        "positionSizing": position_sizing,
        "drawdown": drawdown,
        "equityPath": equity_path,
        "rollingPath": {
            "totalRows": len(path_rows),
            "sampledRows": len(sampled),
            "points": sampled,
            "summary": rolling,
        },
        "artifacts": {
            kind: {
                "path": f"artifacts/{filename}",
                "immutable": True,
            }
            for kind, filename in (
                (kind, path.name)
                for kind, path in paths.items()
            )
        },
    }


BOOK_RISK_DIAGNOSTICS_JSON_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "AutoQuant Book Risk diagnostics",
    "type": "object",
    "additionalProperties": False,
    "required": [
        "schemaVersion",
        "kind",
        "run",
        "positionSnapshot",
        "authority",
        "current",
        "lookbacks",
        "riskContributions",
        "reductionPriority",
        "pairwiseCorrelations",
        "scenarioComparison",
        "positionSizing",
        "drawdown",
        "equityPath",
        "rollingPath",
        "artifacts",
    ],
    "properties": {
        "schemaVersion": {"const": SCHEMA_VERSION},
        "kind": {"const": BOOK_RISK_DIAGNOSTICS_KIND},
        "run": {"type": "object"},
        "positionSnapshot": {"type": "object"},
        "authority": {"type": "object"},
        "current": {"type": "object"},
        "lookbacks": {"type": "array"},
        "riskContributions": {"type": "array"},
        "reductionPriority": {"type": "array"},
        "pairwiseCorrelations": {"type": "array"},
        "scenarioComparison": {"type": "object"},
        "positionSizing": {"type": "object"},
        "drawdown": {"type": "object"},
        "equityPath": {"type": "object"},
        "rollingPath": {"type": "object"},
        "artifacts": {"type": "object"},
    },
}
