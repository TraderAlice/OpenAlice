"""Fast bounded contract checks for an editable OHLCV factor candidate."""

from __future__ import annotations

import importlib
import json
import os
from pathlib import Path

import pandas as pd

from autoquant.prediction_modes import (
    FACTOR_POPULATION,
    load_factor_population,
)
from autoquant.factor_components import (
    FactorComponentError,
    validate_factor_component_metadata,
)
from autoquant.factor_runtime import (
    FactorRuntimeError,
    build_factor_panel,
    evaluate_factor,
)
from autoquant.intervals import IntervalContractError, load_multi_interval_asset

OUTPUT = Path(os.environ["AUTOQUANT_CHECK_OUTPUT"])
PROJECT = Path(os.environ["AUTOQUANT_PROJECT_ROOT"])
DATA = Path(os.environ["AUTOQUANT_DATA_ROOT"])
STUDY = Path(os.environ["AUTOQUANT_STUDY_PATH"])
MAX_DECISION_ASSETS = 2
MAX_TIMESTAMPS = 256


class CheckFailure(ValueError):
    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


def _write(status: str, checks: list[dict[str, str]], errors: list[dict[str, str]]) -> None:
    summary = (
        "Candidate satisfies the bounded factor contract"
        if status == "passed"
        else errors[0]["message"]
    )
    OUTPUT.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "status": status,
                "summary": summary,
                "checks": checks,
                "errors": errors,
            },
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )


def _fixed_reference_assets(
    study: dict[str, object],
    study_universe: list[str],
) -> list[str]:
    """Load Factor context and optional Portfolio benchmark symbols."""

    manifest_path = PROJECT / "autoquant.json"
    try:
        project_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        strategies = project_manifest["directories"]["strategies"]
    except (OSError, KeyError, TypeError, json.JSONDecodeError):
        return []
    population_relative = f"{strategies}/factor-population.json"
    mandate_relative = f"{strategies}/portfolio-mandate.json"
    dependencies = study.get("dependencies")
    if not isinstance(dependencies, dict):
        return []
    dependency_paths = dependencies.get("paths")
    if (
        not isinstance(dependency_paths, list)
        or population_relative not in dependency_paths
    ):
        return []
    try:
        population = load_factor_population(PROJECT / population_relative)
        context_assets = population["contextAssets"]
    except Exception as error:
        raise CheckFailure(
            "data.reference-contract",
            f"Cannot read fixed Factor context assets: {error}",
        ) from error
    if not isinstance(context_assets, list) or any(
        not isinstance(symbol, str) or not symbol
        for symbol in context_assets
    ):
        raise CheckFailure(
            "data.reference-contract",
            "Fixed mandate contextAssets must be an array of symbols",
        )
    requested = list(context_assets)
    if mandate_relative in dependency_paths:
        mandate_path = PROJECT / mandate_relative
        try:
            mandate = json.loads(mandate_path.read_text(encoding="utf-8"))
            benchmark_asset = mandate["construction"]["benchmark"]["asset"]
        except (OSError, KeyError, TypeError, json.JSONDecodeError) as error:
            raise CheckFailure(
                "data.reference-contract",
                f"Cannot read fixed Portfolio benchmark asset: {error}",
            ) from error
    else:
        benchmark_asset = None
    if benchmark_asset is not None:
        if not isinstance(benchmark_asset, str) or not benchmark_asset:
            raise CheckFailure(
                "data.reference-contract",
                "Fixed mandate benchmark asset must be a symbol or null",
            )
        requested.append(benchmark_asset)
    requested_set = set(requested)
    return [symbol for symbol in study_universe if symbol in requested_set]


def _bounded_universe(
    study: dict[str, object],
    study_universe: list[str],
) -> tuple[list[str], list[str], list[str], int]:
    references = _fixed_reference_assets(study, study_universe)
    reference_set = set(references)
    prediction_assets = [
        symbol
        for symbol in study_universe
        if symbol not in reference_set
    ]
    if not prediction_assets:
        prediction_assets = list(study_universe)
    decisions = prediction_assets[:MAX_DECISION_ASSETS]
    selected = set(decisions) | reference_set
    universe = [
        symbol
        for symbol in study_universe
        if symbol in selected
    ]
    return universe, decisions, references, len(prediction_assets)


def main() -> None:
    checks: list[dict[str, str]] = []
    try:
        study = json.loads(STUDY.read_text(encoding="utf-8"))
        study_universe = study["dataset"]["universe"]
        (
            universe,
            decision_assets,
            reference_assets,
            prediction_asset_count,
        ) = _bounded_universe(study, study_universe)
        if not universe:
            raise CheckFailure("data.universe", "Study universe is empty")
        module = importlib.import_module("factors.candidate")
        try:
            validate_factor_component_metadata(module)
        except FactorComponentError as error:
            raise CheckFailure(error.code, str(error)) from error
        frames: dict[str, pd.DataFrame] = {}
        for symbol in universe:
            time_range = study["dataset"]["time_range"]
            try:
                frame = load_multi_interval_asset(
                    DATA,
                    symbol,
                    start=time_range["start"],
                    end=time_range["end"],
                )
            except IntervalContractError as error:
                raise CheckFailure(error.code, str(error)) from error
            if frame is None:
                frame = pd.read_csv(DATA / "ohlcv" / f"{symbol}.csv")
                frame["timestamp"] = pd.to_datetime(
                    frame["timestamp"],
                    utc=True,
                    errors="raise",
                )
            frames[symbol] = frame.iloc[:MAX_TIMESTAMPS].reset_index(drop=True)
        try:
            panel = build_factor_panel(frames, universe=universe)
            evaluate_factor(module, panel)
        except FactorRuntimeError as error:
            raise CheckFailure(error.code, str(error)) from error
        checks.append(
            {
                "id": "factor-contract",
                "status": "passed",
                "message": (
                    "Panel API, identity, immutability, alignment, numeric, "
                    "deterministic, component declaration, and bounded "
                    "panel-prefix causality checks passed; bounded decision "
                    f"sample {', '.join(decision_assets)} "
                    f"({len(decision_assets)} of {prediction_asset_count} "
                    "prediction assets); fixed Factor-context "
                    f"assets {', '.join(reference_assets) or 'none'}; "
                    f"at most {MAX_TIMESTAMPS} timestamps"
                ),
            }
        )
        _write("passed", checks, [])
    except CheckFailure as error:
        checks.append(
            {"id": error.code, "status": "failed", "message": str(error)}
        )
        _write("failed", checks, [{"code": error.code, "message": str(error)}])
    except Exception as error:
        message = f"Unexpected preflight error: {type(error).__name__}: {error}"
        _write(
            "failed",
            [{"id": "preflight-error", "status": "failed", "message": message}],
            [{"code": "preflight.error", "message": message}],
        )


if __name__ == "__main__":
    main()
