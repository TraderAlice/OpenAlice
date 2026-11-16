"""Self-contained Project construction templates."""

from __future__ import annotations

import csv
import json
import math
import random
from datetime import date, timedelta
from importlib import resources
from pathlib import Path
from typing import TYPE_CHECKING, Any

from .allocation_policies import (
    ALLOCATION_POLICY,
    build_allocation_contract,
)
from .checks import PREFLIGHT_KIND, PREFLIGHT_MANIFEST
from .factor_claims import (
    FACTOR_CLAIM,
    build_factor_claim,
    known_style_candidate_source,
)
from .horizons import (
    RESEARCH_HORIZON,
    build_research_horizon,
)
from .event_studies import (
    EVENT_STUDY_POLICY,
    build_event_study_policy,
)
from .book_path_stress import (
    BOOK_PATH_STRESS_POLICY,
    build_book_path_stress_policy,
)
from .mandates import (
    PORTFOLIO_MANDATE,
    build_portfolio_mandate,
)
from .position_snapshots import (
    POSITION_SNAPSHOT,
    build_position_snapshot,
)
from .prediction_modes import (
    FACTOR_POPULATION,
    build_factor_population,
)
from .studies import (
    StudyContext,
    StudyDataset,
    StudyDefinition,
    StudyJudge,
    StudyObjective,
    StudySubject,
    StudyTimeRange,
    create_study,
    load_study,
)
from .workspace import (
    SCHEMA_VERSION,
    AutoQuantValidationError,
    ProjectContext,
    ValidationIssue,
)

if TYPE_CHECKING:
    from .intake import PreparedIntake


PROJECT_TEMPLATE_IDS = (
    "blank",
    "ohlcv-factor-lab",
    "ohlcv-portfolio-lab",
    "ohlcv-rl-factor-lab",
    "ohlcv-book-risk-lab",
    "ohlcv-event-study-lab",
    "ohlcv-book-path-stress-lab",
    "ohlcv-allocation-lab",
    "ohlcv-research-desk",
)
PROJECT_TEMPLATE_ROUTES: tuple[dict[str, Any], ...] = (
    {
        "id": "blank",
        "kind": "construction-site",
        "lanes": [],
        "purpose": "Clarify a new assignment before its quantitative method is known.",
        "fits": [
            "The caller-owned question is still materially ambiguous.",
            "No existing fixed Lab or coordinated desk contract is yet justified.",
        ],
        "doesNotFit": [
            "Do not use it to bypass an existing fixed quantitative contract.",
        ],
    },
    {
        "id": "ohlcv-factor-lab",
        "kind": "single-lane-lab",
        "lanes": ["factor"],
        "purpose": (
            "Evaluate one causal OHLCV factor against a caller-bound future "
            "return or realized-volatility outcome without downstream "
            "portfolio work."
        ),
        "fits": [
            "The deliverable is factor quality, qualification, or diagnostics only.",
            "The caller asks which causal OHLCV features forecast future realized risk.",
        ],
        "doesNotFit": [
            "The same Project must translate the factor into target weights or RL.",
        ],
    },
    {
        "id": "ohlcv-portfolio-lab",
        "kind": "single-lane-lab",
        "lanes": ["portfolio"],
        "purpose": "Evaluate target-weight construction from an already fixed forward-return factor contract.",
        "fits": [
            "Portfolio evidence is standalone and no Factor-to-Portfolio admission is required.",
        ],
        "doesNotFit": [
            "Factor evidence must be established, reported, or admitted before Portfolio work.",
            "A coordinated Dossier or optional governed-RL continuation is expected.",
            "The factor predicts risk rather than expected return.",
        ],
    },
    {
        "id": "ohlcv-rl-factor-lab",
        "kind": "single-lane-lab",
        "lanes": ["rl"],
        "purpose": "Evaluate one governed RL factor-policy Study with fixed dependencies.",
        "fits": [
            "The Factor and Portfolio dependencies are already fixed outside this Project.",
        ],
        "doesNotFit": [
            "The same Project must first establish Factor or Portfolio evidence.",
            "The factor predicts risk rather than expected return.",
        ],
    },
    {
        "id": "ohlcv-book-risk-lab",
        "kind": "fixed-lab",
        "lanes": ["book-risk"],
        "purpose": "Audit one caller-supplied funded position book or bounded cash sizing path.",
        "fits": [
            "The caller supplies the exact current or hypothetical funded weights.",
        ],
        "doesNotFit": [
            "The task is to discover a predictive factor or optimize an unrestricted portfolio.",
        ],
    },
    {
        "id": "ohlcv-event-study-lab",
        "kind": "fixed-lab",
        "lanes": ["event-study"],
        "purpose": "Measure post-event OHLCV behavior under one fixed event rule.",
        "fits": [
            "The event rule, horizon, overlap policy, and comparison meaning are fixed.",
        ],
        "doesNotFit": [
            "The caller needs continuous cross-sectional ranking or target weights.",
        ],
    },
    {
        "id": "ohlcv-book-path-stress-lab",
        "kind": "fixed-lab",
        "lanes": ["book-path-stress"],
        "purpose": "Find the worst non-overlapping fixed-unit historical paths for one reported book.",
        "fits": [
            "The caller supplies exact funded weights, a fixed horizon, and episode count.",
        ],
        "doesNotFit": [
            "The task asks for account reconstruction, forecasts, optimization, or execution.",
        ],
    },
    {
        "id": "ohlcv-allocation-lab",
        "kind": "fixed-lab",
        "lanes": ["allocation"],
        "purpose": "Evaluate fixed portfolio-native allocation against a fixed reference.",
        "fits": [
            "The construction is allocation-native and does not depend on a predictive factor.",
        ],
        "doesNotFit": [
            "Factor selection must precede target-weight construction.",
        ],
    },
    {
        "id": "ohlcv-research-desk",
        "kind": "coordinated-research-desk",
        "lanes": ["factor", "portfolio", "rl"],
        "purpose": "Coordinate Factor to Portfolio and optional governed-RL evidence in one Project.",
        "fits": [
            "Factor evidence must feed target-weight construction in the same assignment.",
            "Factor or Portfolio evidence may feed governed RL in the same assignment.",
            "The deliverable needs a coordinated multi-Study Dossier.",
        ],
        "doesNotFit": [
            "A single fixed Lab fully answers the question without cross-lane admission.",
            "The fixed Factor outcome is realized volatility; downstream lanes require forward return.",
        ],
    },
)


def project_template_routes() -> list[dict[str, Any]]:
    """Return the public ordered Project-construction route catalog."""

    return [
        {
            "id": route["id"],
            "kind": route["kind"],
            "lanes": list(route["lanes"]),
            "purpose": route["purpose"],
            "fits": list(route["fits"]),
            "doesNotFit": list(route["doesNotFit"]),
        }
        for route in PROJECT_TEMPLATE_ROUTES
    ]
OHLCV_STUDY_ID = "ohlcv-factor-quality"
PORTFOLIO_STUDY_ID = "ohlcv-portfolio-quality"
RL_STUDY_ID = "ohlcv-rl-factor-policy"
BOOK_RISK_STUDY_ID = "ohlcv-book-risk"
EVENT_STUDY_ID = "ohlcv-price-event-reaction"
BOOK_PATH_STRESS_STUDY_ID = "ohlcv-book-path-stress"
ALLOCATION_STUDY_ID = "ohlcv-risk-parity-allocation"
TEMPLATE_STUDY_IDS = {
    "ohlcv-factor-lab": OHLCV_STUDY_ID,
    "ohlcv-portfolio-lab": PORTFOLIO_STUDY_ID,
    "ohlcv-rl-factor-lab": RL_STUDY_ID,
    "ohlcv-book-risk-lab": BOOK_RISK_STUDY_ID,
    "ohlcv-event-study-lab": EVENT_STUDY_ID,
    "ohlcv-book-path-stress-lab": BOOK_PATH_STRESS_STUDY_ID,
    "ohlcv-allocation-lab": ALLOCATION_STUDY_ID,
    "ohlcv-research-desk": OHLCV_STUDY_ID,
}
TEMPLATE_STUDY_SEQUENCES = {
    "ohlcv-factor-lab": (OHLCV_STUDY_ID,),
    "ohlcv-portfolio-lab": (PORTFOLIO_STUDY_ID,),
    "ohlcv-rl-factor-lab": (RL_STUDY_ID,),
    "ohlcv-book-risk-lab": (BOOK_RISK_STUDY_ID,),
    "ohlcv-event-study-lab": (EVENT_STUDY_ID,),
    "ohlcv-book-path-stress-lab": (BOOK_PATH_STRESS_STUDY_ID,),
    "ohlcv-allocation-lab": (ALLOCATION_STUDY_ID,),
    "ohlcv-research-desk": (
        OHLCV_STUDY_ID,
        PORTFOLIO_STUDY_ID,
        RL_STUDY_ID,
    ),
}
OHLCV_ASSETS = ("ALPHA", "BRAVO", "CHARLIE", "DELTA", "ECHO", "FOXTROT")
OHLCV_START = date(2024, 1, 2)
OHLCV_OBSERVATIONS = 320
RL_OBSERVATIONS = 420


def _issue(path: Path | str, code: str, message: str) -> ValidationIssue:
    return ValidationIssue(str(path), code, message)


def _template_text(relative: str, *, template: str = "ohlcv_factor_lab") -> str:
    source = (
        resources.files("autoquant")
        .joinpath("project_templates")
        .joinpath(template)
        .joinpath(relative)
    )
    return source.read_text(encoding="utf-8")


def _write_preflight_source(project: ProjectContext, lane: str) -> str:
    relative = f"judges/preflight_{lane}.py"
    path = project.root_dir / relative
    path.write_text(
        _template_text(f"{lane}.py", template="preflight"),
        encoding="utf-8",
    )
    return relative


def _write_preflight_manifest(
    study: StudyContext,
    *,
    entrypoint: str,
    timeout_seconds: int = 8,
) -> None:
    value = {
        "schemaVersion": SCHEMA_VERSION,
        "kind": PREFLIGHT_KIND,
        "runner": {
            "kind": "python",
            "entrypoint": entrypoint,
            "paths": [entrypoint],
            "arguments": [],
            "timeoutSeconds": timeout_seconds,
        },
    }
    (study.root_dir / PREFLIGHT_MANIFEST).write_text(
        json.dumps(value, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _business_dates(start: date, observations: int) -> list[date]:
    result: list[date] = []
    current = start
    while len(result) < observations:
        if current.weekday() < 5:
            result.append(current)
        current += timedelta(days=1)
    return result


def _write_demo_ohlcv(
    project: ProjectContext,
    *,
    readme_template: str = "ohlcv_factor_lab",
) -> date:
    """Generate a small causal multi-asset fixture without external downloads."""

    output = project.root_dir / project.manifest.directories["data"] / "ohlcv"
    output.mkdir()
    dates = _business_dates(OHLCV_START, OHLCV_OBSERVATIONS)
    random_source = random.Random(20260724)
    closes = {
        asset: 70.0 + 13.0 * index
        for index, asset in enumerate(OHLCV_ASSETS)
    }
    prior_signals = {asset: 0.0 for asset in OHLCV_ASSETS}
    rows = {asset: [] for asset in OHLCV_ASSETS}

    for step, timestamp in enumerate(dates):
        raw_signals = {
            asset: random_source.gauss(0.0, 1.0)
            + 0.35 * math.sin(step / 9.0 + index * 0.8)
            for index, asset in enumerate(OHLCV_ASSETS)
        }
        mean_signal = sum(raw_signals.values()) / len(raw_signals)
        current_signals = {
            asset: value - mean_signal for asset, value in raw_signals.items()
        }
        market_return = 0.00015 + 0.0025 * math.sin(step / 31.0)
        for index, asset in enumerate(OHLCV_ASSETS):
            previous_close = closes[asset]
            overnight = random_source.gauss(0.0, 0.0015)
            open_price = previous_close * math.exp(overnight)
            close_return = (
                market_return
                + 0.010 * prior_signals[asset]
                + random_source.gauss(0.0, 0.004)
            )
            close_price = previous_close * math.exp(close_return)
            spread = abs(random_source.gauss(0.005, 0.0015))
            high = max(open_price, close_price) * (1.0 + spread)
            low = min(open_price, close_price) * (1.0 - spread)
            base_volume = 900_000.0 * (1.0 + index * 0.22)
            volume = base_volume * math.exp(
                0.55 * current_signals[asset]
                + 0.08 * math.sin(step / 17.0 + index)
            )
            rows[asset].append(
                [
                    timestamp.isoformat(),
                    f"{open_price:.8f}",
                    f"{high:.8f}",
                    f"{low:.8f}",
                    f"{close_price:.8f}",
                    f"{volume:.2f}",
                ]
            )
            closes[asset] = close_price
        prior_signals = current_signals

    for asset in OHLCV_ASSETS:
        with (output / f"{asset}.csv").open(
            "w",
            encoding="utf-8",
            newline="",
        ) as handle:
            writer = csv.writer(handle, lineterminator="\n")
            writer.writerow(["timestamp", "open", "high", "low", "close", "volume"])
            writer.writerows(rows[asset])
    (output / "README.md").write_text(
        _template_text("data-readme.md", template=readme_template),
        encoding="utf-8",
    )
    return dates[-1]


def _write_demo_event_ohlcv(project: ProjectContext) -> date:
    """Generate the ordinary fixture plus deterministic downside gaps."""

    end = _write_demo_ohlcv(
        project,
        readme_template="ohlcv_event_study_lab",
    )
    path = (
        project.root_dir
        / project.manifest.directories["data"]
        / "ohlcv"
        / f"{OHLCV_ASSETS[0]}.csv"
    )
    with path.open("r", encoding="utf-8", newline="") as handle:
        rows = list(csv.reader(handle))
    for position in (60, 64, 120, 180, 240, 316):
        prior_close = float(rows[position][4])
        rows[position + 1][1] = f"{prior_close * 0.94:.8f}"
        rows[position + 1][3] = (
            f"{min(float(rows[position + 1][3]), prior_close * 0.93):.8f}"
        )
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerows(rows)
    return end


def _write_event_study_policy(
    project: ProjectContext,
    request: dict[str, Any],
) -> None:
    path = project.root_dir / EVENT_STUDY_POLICY
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            build_event_study_policy(request),
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )


def _write_book_path_stress_policy(
    project: ProjectContext,
    request: dict[str, Any],
) -> None:
    path = project.root_dir / BOOK_PATH_STRESS_POLICY
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            build_book_path_stress_policy(request),
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )


def _write_allocation_contract(
    project: ProjectContext,
    request: dict[str, Any],
    universe: list[str],
    *,
    annualization_periods: int,
) -> None:
    path = project.root_dir / ALLOCATION_POLICY
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            build_allocation_contract(
                request,
                universe,
                annualization_periods=annualization_periods,
            ),
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )


def _write_rl_ohlcv(project: ProjectContext) -> date:
    """Generate causal alternating regimes for bounded policy verification."""

    output = project.root_dir / project.manifest.directories["data"] / "ohlcv"
    output.mkdir()
    dates = _business_dates(OHLCV_START, RL_OBSERVATIONS)
    random_source = random.Random(20260725)
    closes = {
        asset: 80.0 + 11.0 * index
        for index, asset in enumerate(OHLCV_ASSETS)
    }
    prior_activity = {asset: 0.0 for asset in OHLCV_ASSETS}
    prior_intraday = {asset: 0.0 for asset in OHLCV_ASSETS}
    prior_regime = 1
    rows = {asset: [] for asset in OHLCV_ASSETS}

    for step, timestamp in enumerate(dates):
        regime = 1 if (step // 42) % 2 == 0 else -1
        activity_raw = {
            asset: random_source.gauss(0.0, 1.0)
            + 0.20 * math.sin(step / 8.0 + index)
            for index, asset in enumerate(OHLCV_ASSETS)
        }
        intraday_raw = {
            asset: random_source.gauss(0.0, 1.0)
            + 0.20 * math.cos(step / 11.0 + index * 0.7)
            for index, asset in enumerate(OHLCV_ASSETS)
        }
        activity_mean = sum(activity_raw.values()) / len(activity_raw)
        intraday_mean = sum(intraday_raw.values()) / len(intraday_raw)
        activity = {
            asset: value - activity_mean
            for asset, value in activity_raw.items()
        }
        intraday = {
            asset: value - intraday_mean
            for asset, value in intraday_raw.items()
        }
        market_return = 0.00010 + 0.0015 * math.sin(step / 37.0)
        for index, asset in enumerate(OHLCV_ASSETS):
            previous_close = closes[asset]
            selected_signal = (
                prior_activity[asset]
                if prior_regime > 0
                else prior_intraday[asset]
            )
            close_return = (
                market_return
                + 0.012 * selected_signal
                + random_source.gauss(0.0, 0.003)
            )
            close_price = previous_close * math.exp(close_return)
            open_price = close_price / math.exp(0.010 * intraday[asset])
            spread = 0.003 + abs(random_source.gauss(0.0, 0.001))
            high = max(open_price, close_price) * (1.0 + spread)
            low = min(open_price, close_price) * (1.0 - spread)
            base_volume = 850_000.0 * (1.0 + index * 0.18)
            volume = base_volume * math.exp(
                0.55 * regime + 0.50 * activity[asset]
            )
            rows[asset].append(
                [
                    timestamp.isoformat(),
                    f"{open_price:.8f}",
                    f"{high:.8f}",
                    f"{low:.8f}",
                    f"{close_price:.8f}",
                    f"{volume:.2f}",
                ]
            )
            closes[asset] = close_price
        prior_activity = activity
        prior_intraday = intraday
        prior_regime = regime

    for asset in OHLCV_ASSETS:
        with (output / f"{asset}.csv").open(
            "w",
            encoding="utf-8",
            newline="",
        ) as handle:
            writer = csv.writer(handle, lineterminator="\n")
            writer.writerow(["timestamp", "open", "high", "low", "close", "volume"])
            writer.writerows(rows[asset])
    (output / "README.md").write_text(
        _template_text("data-readme.md", template="ohlcv_rl_factor_lab"),
        encoding="utf-8",
    )
    return dates[-1]


def _write_template_source(
    project: ProjectContext,
    relative: str,
    source: str,
    *,
    template: str = "ohlcv_factor_lab",
) -> None:
    target = project.root_dir / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        _template_text(source, template=template),
        encoding="utf-8",
    )


def _write_surface_aligned_factor_candidate(
    project: ProjectContext,
    intake: PreparedIntake | None,
    *,
    template: str,
) -> None:
    """Seed a baseline whose declared features exist on the intake surface."""

    source = _template_text("candidate.py", template=template)
    marker = 'AVAILABLE_FEATURE_INTERVALS = ["3h", "12h", "1d"]'
    if marker not in source:
        raise RuntimeError(
            f"{template} candidate is missing the interval seed marker"
        )
    surface = intake.interval_surface if intake is not None else None
    feature_intervals = (
        list(surface["featureIntervals"])
        if isinstance(surface, dict)
        else []
    )
    source = source.replace(
        marker,
        "AVAILABLE_FEATURE_INTERVALS = "
        + json.dumps(feature_intervals),
        1,
    )
    target = project.root_dir / "factors/candidate.py"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(source, encoding="utf-8")


def _write_portfolio_mandate(
    project: ProjectContext,
    intake: PreparedIntake | None,
    universe: list[str],
) -> dict[str, object]:
    mandate = build_portfolio_mandate(
        intake.request if intake is not None else None,
        universe,
        annualization_periods=(
            intake.annualization_periods if intake is not None else 252
        ),
    )
    (project.root_dir / PORTFOLIO_MANDATE).write_text(
        json.dumps(mandate, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return mandate


def _write_research_horizon(
    project: ProjectContext,
    intake: PreparedIntake | None,
) -> dict[str, object]:
    horizon = build_research_horizon(
        intake.request if intake is not None else None
    )
    (project.root_dir / RESEARCH_HORIZON).write_text(
        json.dumps(horizon, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return horizon


def _write_factor_claim(
    project: ProjectContext,
    intake: PreparedIntake | None,
) -> dict[str, object]:
    claim = build_factor_claim(
        intake.request if intake is not None else None
    )
    (project.root_dir / FACTOR_CLAIM).write_text(
        json.dumps(claim, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return claim


def _write_factor_population(
    project: ProjectContext,
    intake: PreparedIntake | None,
    universe: list[str],
) -> dict[str, object]:
    population = build_factor_population(
        intake.request if intake is not None else None,
        universe,
    )
    (project.root_dir / FACTOR_POPULATION).write_text(
        json.dumps(population, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return population


def _write_position_snapshot(
    project: ProjectContext,
    request: dict[str, object],
) -> dict[str, object]:
    snapshot = build_position_snapshot(request)
    (project.root_dir / POSITION_SNAPSHOT).write_text(
        json.dumps(snapshot, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return snapshot


def _seed_known_style_candidate(
    project: ProjectContext,
    intake: PreparedIntake | None,
) -> None:
    if intake is None:
        return
    source = known_style_candidate_source(intake.request)
    if source is not None:
        (project.root_dir / "factors" / "candidate.py").write_text(
            source,
            encoding="utf-8",
        )


def _intake_dataset(
    project: ProjectContext,
    intake: PreparedIntake,
    study_id: str,
) -> tuple[str, dict[str, object], str]:
    from .intake import materialize_intake_dataset

    _, snapshot_hash = materialize_intake_dataset(project, intake, study_id)
    return (
        intake.end,
        {
            "id": intake.package["id"],
            "version": intake.package["version"],
            "asset_class": intake.package["assetClass"],
            "universe": intake.universe,
            "start": intake.start,
        },
        snapshot_hash,
    )


def _time_range_value(value: date | str) -> str:
    return value if isinstance(value, str) else value.isoformat()


def _finalize_intake(
    project: ProjectContext,
    intake: PreparedIntake | None,
    study,
    snapshot_hash: str | None,
) -> None:
    if intake is None:
        return
    from .intake import finalize_project_intake

    assert snapshot_hash is not None
    finalize_project_intake(project, intake, study, snapshot_hash)


def _externalize_intake_guidance(
    project: ProjectContext,
    intake: PreparedIntake | None,
    program_path: Path,
) -> None:
    if intake is None:
        return
    replacements = {
        (
            "Do not modify the Study, Judge, program, dataset, or AutoQuant "
            "Core to improve a\ncandidate. Do not treat this synthetic "
            "benchmark as a real-market alpha claim."
        ): (
            "Do not modify the Study, Judge, program, dataset, or AutoQuant "
            "Core to improve a\ncandidate. These historical provider-supplied "
            "bars are research evidence, not proof of\nfuture alpha."
        ),
        (
            "This is a synthetic bar-target-weight simulation, not an L2 fill "
            "model, order\ninstruction, or live-trading recommendation."
        ): (
            "This is a historical bar-target-weight simulation, not an L2 fill "
            "model, order\ninstruction, or live-trading recommendation."
        ),
        (
            "The checked-in construction recipe\ngenerates a small "
            "deterministic synthetic fixture; it is a Harness benchmark,\nnot "
            "evidence about real markets."
        ): (
            "This Project was transactionally constructed from a caller-"
            "supplied, content-locked\ndaily OHLCV snapshot. Provider, "
            "calendar, and price-adjustment metadata are\ndisclosed claims, "
            "not authenticated by AutoQuant."
        ),
    }
    provider_summary = (
        ", ".join(
            source["provider"]["name"]
            for source in intake.package["sources"]
        )
        if "sources" in intake.package
        else intake.package["provider"]["name"]
    )
    disclosure = (
        "\n\n## External dataset authority\n\n"
        f"- Dataset: `{intake.package['id']}@{intake.package['version']}`\n"
        f"- Research universe: {', '.join(intake.universe)}\n"
        f"- Coverage: `{intake.start}` through `{intake.end}`\n"
        f"- Provider claim(s): `{provider_summary}`\n"
        f"- Adjustment claim: `{intake.package['priceAdjustment']}`\n\n"
        "The Study hashes canonical Project-local bytes. Do not add newer rows "
        "or replace the\nsnapshot during one Session; create a new intake/"
        "Study identity for a fresh holdout.\n"
    )
    for path in (
        project.root_dir / project.manifest.research_program,
        program_path,
    ):
        text = path.read_text(encoding="utf-8")
        for old, new in replacements.items():
            text = text.replace(old, new)
        if "## External dataset authority" not in text:
            text = text.rstrip() + disclosure
        path.write_text(text, encoding="utf-8")


def _apply_ohlcv_factor_lab(
    project: ProjectContext,
    intake: PreparedIntake | None = None,
) -> None:
    if intake is None:
        end = _write_demo_ohlcv(project)
        dataset = {
            "id": "synthetic-ohlcv-factor-fixture",
            "version": "v1",
            "asset_class": "synthetic-multi-asset",
            "universe": list(OHLCV_ASSETS),
            "start": OHLCV_START.isoformat(),
        }
        snapshot_hash = None
    else:
        end, dataset, snapshot_hash = _intake_dataset(
            project,
            intake,
            OHLCV_STUDY_ID,
        )
    _write_research_horizon(project, intake)
    _write_factor_claim(project, intake)
    _write_factor_population(
        project,
        intake,
        list(dataset["universe"]),
    )
    _write_surface_aligned_factor_candidate(
        project,
        intake,
        template="ohlcv_factor_lab",
    )
    _seed_known_style_candidate(project, intake)
    _write_template_source(project, "judges/ohlcv_factor.py", "judge.py")
    _write_template_source(
        project,
        "judges/factor_diagnostics.py",
        "factor_diagnostics.py",
    )
    preflight_entrypoint = _write_preflight_source(project, "factor")
    (project.root_dir / project.manifest.research_program).write_text(
        _template_text("research.md"),
        encoding="utf-8",
    )
    definition = StudyDefinition(
        schema_version=1,
        id=OHLCV_STUDY_ID,
        name="OHLCV Factor Quality",
        description=(
            "Mine a causal cross-sectional factor on a fixed synthetic OHLCV fixture"
            if intake is None
            else "Mine a causal cross-sectional factor on a content-locked market snapshot"
        ),
        program="program.md",
        subject=StudySubject("factor", "candidate-factor", "working"),
        editable={"paths": ["factors/**"]},
        judge=StudyJudge(
            "python",
            "judges/ohlcv_factor.py",
            [
                "judges/ohlcv_factor.py",
                "judges/factor_diagnostics.py",
            ],
            [],
            60,
        ),
        objective=StudyObjective("validation_mean_ic", "maximize", 0.01),
        dataset=StudyDataset(
            str(dataset["id"]),
            str(dataset["version"]),
            str(dataset["asset_class"]),
            list(dataset["universe"]),
            StudyTimeRange(str(dataset["start"]), _time_range_value(end)),
            ["ohlcv/**"],
        ),
        dependencies={
            "paths": [
                FACTOR_CLAIM,
                FACTOR_POPULATION,
                RESEARCH_HORIZON,
            ]
        },
    )
    study = create_study(project, definition)
    study.program_path.write_text(
        _template_text("program.md"),
        encoding="utf-8",
    )
    _write_preflight_manifest(study, entrypoint=preflight_entrypoint)
    _externalize_intake_guidance(project, intake, study.program_path)
    study = load_study(project, OHLCV_STUDY_ID)
    _finalize_intake(project, intake, study, snapshot_hash)


def _apply_ohlcv_portfolio_lab(
    project: ProjectContext,
    intake: PreparedIntake | None = None,
) -> None:
    template = "ohlcv_portfolio_lab"
    if intake is None:
        end = _write_demo_ohlcv(project, readme_template=template)
        dataset = {
            "id": "synthetic-ohlcv-portfolio-fixture",
            "version": "v1",
            "asset_class": "synthetic-multi-asset",
            "universe": list(OHLCV_ASSETS),
            "start": OHLCV_START.isoformat(),
        }
        snapshot_hash = None
    else:
        end, dataset, snapshot_hash = _intake_dataset(
            project,
            intake,
            PORTFOLIO_STUDY_ID,
        )
    _write_portfolio_mandate(
        project,
        intake,
        list(dataset["universe"]),
    )
    _write_factor_claim(project, intake)
    _write_factor_population(project, intake, list(dataset["universe"]))
    _write_research_horizon(project, intake)
    _write_surface_aligned_factor_candidate(
        project,
        intake,
        template=template,
    )
    _seed_known_style_candidate(project, intake)
    _write_template_source(
        project,
        "judges/ohlcv_portfolio.py",
        "judge.py",
        template=template,
    )
    _write_template_source(
        project,
        "judges/portfolio_core.py",
        "portfolio_core.py",
        template=template,
    )
    preflight_entrypoint = _write_preflight_source(project, "factor")
    (project.root_dir / project.manifest.research_program).write_text(
        _template_text("research.md", template=template),
        encoding="utf-8",
    )
    definition = StudyDefinition(
        schema_version=1,
        id=PORTFOLIO_STUDY_ID,
        name="OHLCV Portfolio Quality",
        description=(
            "Translate a causal factor into constrained, costed target weights"
        ),
        program="program.md",
        subject=StudySubject("factor", "portfolio-factor", "working"),
        editable={"paths": ["factors/**"]},
        judge=StudyJudge(
            "python",
            "judges/ohlcv_portfolio.py",
            [
                "judges/ohlcv_portfolio.py",
                "judges/portfolio_core.py",
            ],
            [],
            180,
        ),
        objective=StudyObjective("validation_net_sharpe", "maximize", 0.05),
        dataset=StudyDataset(
            str(dataset["id"]),
            str(dataset["version"]),
            str(dataset["asset_class"]),
            list(dataset["universe"]),
            StudyTimeRange(str(dataset["start"]), _time_range_value(end)),
            ["ohlcv/**"],
        ),
        dependencies={
            "paths": [
                FACTOR_CLAIM,
                FACTOR_POPULATION,
                PORTFOLIO_MANDATE,
                RESEARCH_HORIZON,
            ]
        },
    )
    study = create_study(project, definition)
    study.program_path.write_text(
        _template_text("program.md", template=template),
        encoding="utf-8",
    )
    _write_preflight_manifest(study, entrypoint=preflight_entrypoint)
    _externalize_intake_guidance(project, intake, study.program_path)
    study = load_study(project, PORTFOLIO_STUDY_ID)
    _finalize_intake(project, intake, study, snapshot_hash)


def _apply_ohlcv_rl_factor_lab(
    project: ProjectContext,
    intake: PreparedIntake | None = None,
) -> None:
    template = "ohlcv_rl_factor_lab"
    if intake is None:
        end = _write_rl_ohlcv(project)
        dataset = {
            "id": "synthetic-ohlcv-rl-regime-fixture",
            "version": "v1",
            "asset_class": "synthetic-multi-asset",
            "universe": list(OHLCV_ASSETS),
            "start": OHLCV_START.isoformat(),
        }
        snapshot_hash = None
    else:
        end, dataset, snapshot_hash = _intake_dataset(
            project,
            intake,
            RL_STUDY_ID,
        )
    _write_portfolio_mandate(
        project,
        intake,
        list(dataset["universe"]),
    )
    _write_factor_claim(project, intake)
    _write_factor_population(project, intake, list(dataset["universe"]))
    _write_research_horizon(project, intake)
    _write_template_source(
        project,
        "models/candidate.py",
        "candidate.py",
        template=template,
    )
    _write_surface_aligned_factor_candidate(
        project,
        intake,
        template="ohlcv_portfolio_lab",
    )
    _seed_known_style_candidate(project, intake)
    _write_template_source(
        project,
        "judges/ohlcv_rl_factor.py",
        "judge.py",
        template=template,
    )
    _write_template_source(
        project,
        "judges/rl_core.py",
        "rl_core.py",
        template=template,
    )
    _write_template_source(
        project,
        "judges/portfolio_core.py",
        "portfolio_core.py",
        template="ohlcv_portfolio_lab",
    )
    preflight_entrypoint = _write_preflight_source(project, "rl")
    (project.root_dir / project.manifest.research_program).write_text(
        _template_text("research.md", template=template),
        encoding="utf-8",
    )
    definition = StudyDefinition(
        schema_version=1,
        id=RL_STUDY_ID,
        name="Governed RL Factor Policy",
        description=(
            "Test causal state representations across a locked candidate "
            "factor and fixed reference sleeves"
        ),
        program="program.md",
        subject=StudySubject("model", "rl-state-encoder", "working"),
        editable={"paths": ["models/**"]},
        judge=StudyJudge(
            "python",
            "judges/ohlcv_rl_factor.py",
            [
                "judges/ohlcv_rl_factor.py",
                "judges/rl_core.py",
                "judges/portfolio_core.py",
            ],
            [],
            120,
        ),
        objective=StudyObjective(
            "validation_mean_net_sharpe",
            "maximize",
            0.20,
        ),
        dataset=StudyDataset(
            str(dataset["id"]),
            str(dataset["version"]),
            str(dataset["asset_class"]),
            list(dataset["universe"]),
            StudyTimeRange(str(dataset["start"]), _time_range_value(end)),
            ["ohlcv/**"],
        ),
        dependencies={
            "paths": [
                "factors/**",
                FACTOR_CLAIM,
                FACTOR_POPULATION,
                PORTFOLIO_MANDATE,
                RESEARCH_HORIZON,
            ]
        },
    )
    study = create_study(project, definition)
    study.program_path.write_text(
        _template_text("program.md", template=template),
        encoding="utf-8",
    )
    _write_preflight_manifest(study, entrypoint=preflight_entrypoint)
    _externalize_intake_guidance(project, intake, study.program_path)
    study = load_study(project, RL_STUDY_ID)
    _finalize_intake(project, intake, study, snapshot_hash)


def _apply_ohlcv_book_risk_lab(
    project: ProjectContext,
    intake: PreparedIntake | None = None,
) -> None:
    """Create a fixed reported-book and supplied-scenario covariance audit."""

    template = "ohlcv_book_risk_lab"
    if intake is None:
        end = _write_demo_ohlcv(project, readme_template=template)
        dataset = {
            "id": "synthetic-ohlcv-book-risk-fixture",
            "version": "v1",
            "asset_class": "synthetic-multi-asset",
            "universe": list(OHLCV_ASSETS),
            "start": OHLCV_START.isoformat(),
        }
        snapshot_hash = None
        request = {
            "schemaVersion": 1,
            "kind": "autoquant-research-request",
            "title": "Synthetic reported-book risk audit",
            "question": (
                "How concentrated is the reported model book and which "
                "one-percent reduction most reduces covariance risk?"
            ),
            "decisionContext": (
                "Harness fixture for a non-authenticated reported weight snapshot."
            ),
            "assets": [
                {
                    "symbol": asset,
                    "assetClass": "other",
                    "venue": None,
                    "positionRole": (
                        "long-only"
                        if asset in OHLCV_ASSETS[:4]
                        else "context-only"
                    ),
                }
                for asset in OHLCV_ASSETS
            ],
            "direction": "research-only",
            "positionSnapshot": {
                "kind": "hypothetical-weights",
                "asOf": f"{_time_range_value(end)}T00:00:00Z",
                "baseCurrency": "USD",
                "weights": {
                    asset: 0.25 for asset in OHLCV_ASSETS[:4]
                },
                "cashWeight": 0.0,
            },
            "horizon": "Current covariance state through the final closed bar.",
            "hypotheses": [
                "The reported assets share materially overlapping risk."
            ],
            "constraints": [
                "No Broker, account reconciliation, or order authority."
            ],
            "deliverables": [
                "Risk contribution, effective-risk-bet, and reduction evidence."
            ],
            "source": {
                "system": "local",
                "workspaceId": None,
                "sessionId": None,
                "artifactPath": None,
                "artifactRevision": None,
            },
        }
        (project.root_dir / "request.json").write_text(
            json.dumps(request, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
    else:
        if intake.request.get("positionSnapshot") is None:
            raise AutoQuantValidationError(
                [
                    _issue(
                        "request/positionSnapshot",
                        "request.position-snapshot-required",
                        "ohlcv-book-risk-lab requires one explicit reported "
                        "or hypothetical position snapshot",
                    )
                ]
            )
        end, dataset, snapshot_hash = _intake_dataset(
            project,
            intake,
            BOOK_RISK_STUDY_ID,
        )
        request = intake.request
    _write_position_snapshot(project, request)
    _write_template_source(
        project,
        "strategies/book-risk-scenarios.json",
        "scenarios.json",
        template=template,
    )
    _write_template_source(
        project,
        "judges/ohlcv_book_risk.py",
        "judge.py",
        template=template,
    )
    (project.root_dir / project.manifest.research_program).write_text(
        _template_text("research.md", template=template),
        encoding="utf-8",
    )
    definition = StudyDefinition(
        schema_version=1,
        id=BOOK_RISK_STUDY_ID,
        name="OHLCV Reported Book Risk",
        description=(
            "Audit one explicit reported book plus any caller-supplied "
            "complete scenarios under one fixed covariance model"
        ),
        program="program.md",
        subject=StudySubject("research", "reported-book-risk", "working"),
        editable={"paths": ["strategies/book-risk-scenarios.json"]},
        judge=StudyJudge(
            "python",
            "judges/ohlcv_book_risk.py",
            ["judges/ohlcv_book_risk.py"],
            [],
            30,
        ),
        objective=StudyObjective(
            "current_component_risk_hhi",
            "minimize",
            0.01,
        ),
        dataset=StudyDataset(
            str(dataset["id"]),
            str(dataset["version"]),
            str(dataset["asset_class"]),
            list(dataset["universe"]),
            StudyTimeRange(str(dataset["start"]), _time_range_value(end)),
            ["ohlcv/**"],
        ),
        dependencies={"paths": [POSITION_SNAPSHOT]},
    )
    study = create_study(project, definition)
    study.program_path.write_text(
        _template_text("program.md", template=template),
        encoding="utf-8",
    )
    _externalize_intake_guidance(project, intake, study.program_path)
    study = load_study(project, BOOK_RISK_STUDY_ID)
    _finalize_intake(project, intake, study, snapshot_hash)


def _apply_ohlcv_event_study_lab(
    project: ProjectContext,
    intake: PreparedIntake | None = None,
) -> None:
    """Create one fixed request-bound OHLCV price-event Study."""

    template = "ohlcv_event_study_lab"
    if intake is None:
        end = _write_demo_event_ohlcv(project)
        dataset = {
            "id": "synthetic-ohlcv-event-study-fixture",
            "version": "v1",
            "asset_class": "synthetic-multi-asset",
            "universe": list(OHLCV_ASSETS),
            "start": OHLCV_START.isoformat(),
        }
        snapshot_hash = None
        request = {
            "schemaVersion": 1,
            "kind": "autoquant-research-request",
            "title": "Synthetic downside-gap event study",
            "question": (
                "Does the fixed downside opening gap have a delayed "
                "five-bar historical advantage?"
            ),
            "decisionContext": (
                "Deterministic Harness fixture for fixed price-event evidence."
            ),
            "assets": [
                {
                    "symbol": OHLCV_ASSETS[0],
                    "assetClass": "other",
                    "venue": None,
                },
                {
                    "symbol": OHLCV_ASSETS[1],
                    "assetClass": "other",
                    "venue": None,
                },
            ],
            "direction": "research-only",
            "eventPolicy": {
                "kind": "opening-gap-delayed-close-return",
                "asset": OHLCV_ASSETS[0],
                "comparator": "less-than-or-equal",
                "thresholdReturn": -0.05,
                "waitBars": 2,
                "holdingBars": 5,
                "referenceAsset": OHLCV_ASSETS[1],
                "overlapPolicy": "keep-first-until-exit",
                "minimumEvents": 3,
            },
            "horizon": "Two-bar wait and five-bar close-to-close outcome.",
            "hypotheses": [
                "The fixed price event may have positive delayed returns."
            ],
            "constraints": [
                "No parameter search, order, or trading authority."
            ],
            "deliverables": [
                "Event ledger, references, uncertainty, and conclusion."
            ],
            "source": {
                "system": "local",
                "workspaceId": None,
                "sessionId": None,
                "artifactPath": None,
                "artifactRevision": None,
            },
        }
        (project.root_dir / "request.json").write_text(
            json.dumps(request, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
    else:
        if intake.request.get("eventPolicy") is None:
            raise AutoQuantValidationError(
                [
                    _issue(
                        "request/eventPolicy",
                        "request.event-policy-required",
                        "ohlcv-event-study-lab requires eventPolicy",
                    )
                ]
            )
        end, dataset, snapshot_hash = _intake_dataset(
            project,
            intake,
            EVENT_STUDY_ID,
        )
        request = intake.request
    _write_event_study_policy(project, request)
    _write_template_source(
        project,
        "judges/ohlcv_event_study.py",
        "judge.py",
        template=template,
    )
    (project.root_dir / project.manifest.research_program).write_text(
        _template_text("research.md", template=template),
        encoding="utf-8",
    )
    definition = StudyDefinition(
        schema_version=1,
        id=EVENT_STUDY_ID,
        name="OHLCV Price Event Reaction",
        description=(
            "Measure one caller-fixed opening-gap event with delayed "
            "close-to-close outcomes and explicit references"
        ),
        program="program.md",
        subject=StudySubject("research", "price-event-study", "fixed"),
        editable={"paths": []},
        judge=StudyJudge(
            "python",
            "judges/ohlcv_event_study.py",
            ["judges/ohlcv_event_study.py"],
            [],
            30,
        ),
        objective=StudyObjective(
            "primary_eligible_event_count",
            "maximize",
            1.0,
        ),
        dataset=StudyDataset(
            str(dataset["id"]),
            str(dataset["version"]),
            str(dataset["asset_class"]),
            list(dataset["universe"]),
            StudyTimeRange(str(dataset["start"]), _time_range_value(end)),
            ["ohlcv/**"],
        ),
        dependencies={"paths": [EVENT_STUDY_POLICY]},
    )
    study = create_study(project, definition)
    study.program_path.write_text(
        _template_text("program.md", template=template),
        encoding="utf-8",
    )
    _externalize_intake_guidance(project, intake, study.program_path)
    study = load_study(project, EVENT_STUDY_ID)
    _finalize_intake(project, intake, study, snapshot_hash)


def _apply_ohlcv_book_path_stress_lab(
    project: ProjectContext,
    intake: PreparedIntake | None = None,
) -> None:
    """Create one fixed reported-book historical path stress Study."""

    template = "ohlcv_book_path_stress_lab"
    if intake is None:
        end = _write_demo_ohlcv(project, readme_template=template)
        dataset = {
            "id": "synthetic-ohlcv-book-path-stress-fixture",
            "version": "v1",
            "asset_class": "synthetic-multi-asset",
            "universe": list(OHLCV_ASSETS),
            "start": OHLCV_START.isoformat(),
        }
        snapshot_hash = None
        request = {
            "schemaVersion": 1,
            "kind": "autoquant-research-request",
            "title": "Synthetic reported-book historical path stress",
            "question": (
                "Which five non-overlapping twenty-session paths produced "
                "the worst terminal losses for this fixed-unit book?"
            ),
            "decisionContext": "Deterministic Harness fixture for historical path evidence.",
            "assets": [
                {
                    "symbol": asset,
                    "assetClass": "other",
                    "venue": None,
                    "positionRole": "long-only" if asset in OHLCV_ASSETS[:3] else "context-only",
                }
                for asset in OHLCV_ASSETS
            ],
            "direction": "research-only",
            "positionSnapshot": {
                "kind": "hypothetical-weights",
                "asOf": f"{_time_range_value(end)}T00:00:00Z",
                "baseCurrency": "USD",
                "weights": {
                    OHLCV_ASSETS[0]: 0.40,
                    OHLCV_ASSETS[1]: 0.25,
                    OHLCV_ASSETS[2]: 0.20,
                },
                "cashWeight": 0.15,
            },
            "pathStressPolicy": {
                "kind": "fixed-unit-worst-terminal-loss-episodes",
                "holdingBars": 20,
                "episodeCount": 5,
                "overlapPolicy": "greedy-worst-terminal-loss-non-overlapping",
            },
            "horizon": "All complete twenty-session windows through the final closed bar.",
            "hypotheses": ["Loss episodes may be dominated by one repeated holding."],
            "constraints": ["No forecast, optimization, account reconstruction, Order, or trading authority."],
            "deliverables": ["Complete window ledger, selected paths, exact attribution, and dominance conclusion."],
            "source": {
                "system": "local",
                "workspaceId": None,
                "sessionId": None,
                "artifactPath": None,
                "artifactRevision": None,
            },
        }
        (project.root_dir / "request.json").write_text(
            json.dumps(request, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
    else:
        if intake.request.get("positionSnapshot") is None or intake.request.get("pathStressPolicy") is None:
            raise AutoQuantValidationError(
                [
                    _issue(
                        "request",
                        "request.path-stress-required",
                        "ohlcv-book-path-stress-lab requires positionSnapshot and pathStressPolicy",
                    )
                ]
            )
        end, dataset, snapshot_hash = _intake_dataset(
            project,
            intake,
            BOOK_PATH_STRESS_STUDY_ID,
        )
        request = intake.request
    _write_position_snapshot(project, request)
    _write_book_path_stress_policy(project, request)
    _write_template_source(
        project,
        "judges/ohlcv_book_path_stress.py",
        "judge.py",
        template=template,
    )
    (project.root_dir / project.manifest.research_program).write_text(
        _template_text("research.md", template=template),
        encoding="utf-8",
    )
    definition = StudyDefinition(
        schema_version=1,
        id=BOOK_PATH_STRESS_STUDY_ID,
        name="OHLCV Reported Book Historical Path Stress",
        description=(
            "Enumerate fixed-unit historical windows and select the worst "
            "non-overlapping terminal-loss episodes with exact attribution"
        ),
        program="program.md",
        subject=StudySubject("research", "reported-book-path-stress", "fixed"),
        editable={"paths": []},
        judge=StudyJudge(
            "python",
            "judges/ohlcv_book_path_stress.py",
            ["judges/ohlcv_book_path_stress.py"],
            [],
            30,
        ),
        objective=StudyObjective(
            "worst_terminal_book_return",
            "minimize",
            0.01,
        ),
        dataset=StudyDataset(
            str(dataset["id"]),
            str(dataset["version"]),
            str(dataset["asset_class"]),
            list(dataset["universe"]),
            StudyTimeRange(str(dataset["start"]), _time_range_value(end)),
            ["ohlcv/**"],
        ),
        dependencies={"paths": [POSITION_SNAPSHOT, BOOK_PATH_STRESS_POLICY]},
    )
    study = create_study(project, definition)
    study.program_path.write_text(
        _template_text("program.md", template=template),
        encoding="utf-8",
    )
    _externalize_intake_guidance(project, intake, study.program_path)
    study = load_study(project, BOOK_PATH_STRESS_STUDY_ID)
    _finalize_intake(project, intake, study, snapshot_hash)


def _apply_ohlcv_allocation_lab(
    project: ProjectContext,
    intake: PreparedIntake | None = None,
) -> None:
    """Create one fixed portfolio-native equal-risk-contribution Study."""

    template = "ohlcv_allocation_lab"
    if intake is None:
        end = _write_demo_ohlcv(project, readme_template=template)
        dataset = {
            "id": "synthetic-ohlcv-allocation-fixture",
            "version": "v1",
            "asset_class": "synthetic-multi-asset",
            "universe": list(OHLCV_ASSETS),
            "start": OHLCV_START.isoformat(),
        }
        snapshot_hash = None
        request = {
            "schemaVersion": 1,
            "kind": "autoquant-research-request",
            "title": "Synthetic equal-risk-contribution allocation",
            "question": "Does fixed ERC improve on a fixed 60/40 reference?",
            "decisionContext": "Deterministic Harness fixture.",
            "assets": [
                {
                    "symbol": asset,
                    "assetClass": "other",
                    "venue": None,
                    "positionRole": "long-only",
                }
                for asset in OHLCV_ASSETS
            ],
            "direction": "long",
            "allocationPolicy": {
                "kind": "equal-risk-contribution",
                "covarianceWindow": 60,
                "minimumObservations": 20,
                "contributionTolerance": 0.05,
                "scaleUp": False,
            },
            "portfolioPolicy": {
                "grossLimit": 1.0,
                "maxAbsWeight": 0.35,
                "assetMaxAbsWeights": {},
                "annualizedVolatilityCeiling": 0.15,
                "baseCostBps": 5.0,
                "noTradeOneWay": 0.02,
                "referenceNav": 250000.0,
                "decisionSchedule": {"kind": "calendar-month-end"},
            },
            "benchmarkPolicy": {
                "kind": "fixed-weights",
                "weights": {OHLCV_ASSETS[0]: 0.6, OHLCV_ASSETS[1]: 0.4},
            },
            "horizon": "Monthly allocation over the fixed fixture.",
            "hypotheses": ["ERC may improve validation net Sharpe."],
            "constraints": ["No prediction, Order, or trading authority."],
            "deliverables": ["Costed comparison and current research target."],
            "source": {
                "system": "local",
                "workspaceId": None,
                "sessionId": None,
                "artifactPath": None,
                "artifactRevision": None,
            },
        }
        (project.root_dir / "request.json").write_text(
            json.dumps(request, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        annualization = 252
    else:
        end, dataset, snapshot_hash = _intake_dataset(
            project,
            intake,
            ALLOCATION_STUDY_ID,
        )
        request = intake.request
        annualization = intake.annualization_periods
    _write_allocation_contract(
        project,
        request,
        list(dataset["universe"]),
        annualization_periods=annualization,
    )
    _write_template_source(
        project,
        "judges/ohlcv_allocation.py",
        "judge.py",
        template=template,
    )
    _write_template_source(
        project,
        "judges/allocation_core.py",
        "allocation_core.py",
        template=template,
    )
    _write_template_source(
        project,
        "judges/portfolio_core.py",
        "portfolio_core.py",
        template="ohlcv_portfolio_lab",
    )
    (project.root_dir / project.manifest.research_program).write_text(
        _template_text("research.md", template=template),
        encoding="utf-8",
    )
    definition = StudyDefinition(
        schema_version=1,
        id=ALLOCATION_STUDY_ID,
        name="OHLCV Risk Parity Allocation",
        description=(
            "Construct one causal equal-risk-contribution portfolio and compare "
            "it with one same-clock fixed-weight reference"
        ),
        program="program.md",
        subject=StudySubject("strategy", "equal-risk-contribution", "fixed"),
        editable={"paths": []},
        judge=StudyJudge(
            "python",
            "judges/ohlcv_allocation.py",
            [
                "judges/ohlcv_allocation.py",
                "judges/allocation_core.py",
                "judges/portfolio_core.py",
            ],
            [],
            120,
        ),
        objective=StudyObjective(
            "validation_net_sharpe_advantage",
            "maximize",
            0.0,
        ),
        dataset=StudyDataset(
            str(dataset["id"]),
            str(dataset["version"]),
            str(dataset["asset_class"]),
            list(dataset["universe"]),
            StudyTimeRange(str(dataset["start"]), _time_range_value(end)),
            ["ohlcv/**"],
        ),
        dependencies={"paths": [ALLOCATION_POLICY]},
    )
    study = create_study(project, definition)
    study.program_path.write_text(
        _template_text("program.md", template=template),
        encoding="utf-8",
    )
    _externalize_intake_guidance(project, intake, study.program_path)
    study = load_study(project, ALLOCATION_STUDY_ID)
    _finalize_intake(project, intake, study, snapshot_hash)


def _apply_ohlcv_research_desk(
    project: ProjectContext,
    intake: PreparedIntake | None = None,
) -> None:
    """Create one shared-data Project with Factor, Portfolio, and RL Studies."""

    if intake is None:
        end = _write_rl_ohlcv(project)
        dataset = {
            "id": "synthetic-ohlcv-research-desk-fixture",
            "version": "v1",
            "asset_class": "synthetic-multi-asset",
            "universe": list(OHLCV_ASSETS),
            "start": OHLCV_START.isoformat(),
        }
        snapshot_hash = None
    else:
        end, dataset, snapshot_hash = _intake_dataset(
            project,
            intake,
            OHLCV_STUDY_ID,
        )
    _write_portfolio_mandate(
        project,
        intake,
        list(dataset["universe"]),
    )
    _write_research_horizon(project, intake)
    _write_factor_claim(project, intake)
    _write_factor_population(project, intake, list(dataset["universe"]))

    # Write every fixed/editable source before creating any Study identity.
    _write_surface_aligned_factor_candidate(
        project,
        intake,
        template="ohlcv_portfolio_lab",
    )
    _seed_known_style_candidate(project, intake)
    _write_template_source(
        project,
        "models/candidate.py",
        "candidate.py",
        template="ohlcv_rl_factor_lab",
    )
    _write_template_source(
        project,
        "judges/ohlcv_factor.py",
        "judge.py",
        template="ohlcv_factor_lab",
    )
    _write_template_source(
        project,
        "judges/factor_diagnostics.py",
        "factor_diagnostics.py",
        template="ohlcv_factor_lab",
    )
    _write_template_source(
        project,
        "judges/ohlcv_portfolio.py",
        "judge.py",
        template="ohlcv_portfolio_lab",
    )
    _write_template_source(
        project,
        "judges/portfolio_core.py",
        "portfolio_core.py",
        template="ohlcv_portfolio_lab",
    )
    _write_template_source(
        project,
        "judges/ohlcv_rl_factor.py",
        "judge.py",
        template="ohlcv_rl_factor_lab",
    )
    _write_template_source(
        project,
        "judges/rl_core.py",
        "rl_core.py",
        template="ohlcv_rl_factor_lab",
    )
    factor_preflight = _write_preflight_source(project, "factor")
    rl_preflight = _write_preflight_source(project, "rl")
    (project.root_dir / project.manifest.research_program).write_text(
        _template_text("research.md", template="ohlcv_research_desk"),
        encoding="utf-8",
    )

    shared_dataset = StudyDataset(
        str(dataset["id"]),
        str(dataset["version"]),
        str(dataset["asset_class"]),
        list(dataset["universe"]),
        StudyTimeRange(str(dataset["start"]), _time_range_value(end)),
        ["ohlcv/**"],
    )
    definitions = (
        (
            StudyDefinition(
                schema_version=1,
                id=OHLCV_STUDY_ID,
                name="OHLCV Factor Quality",
                description="Mine causal factor evidence on the shared research snapshot",
                program="program.md",
                subject=StudySubject("factor", "candidate-factor", "working"),
                editable={"paths": ["factors/**"]},
                judge=StudyJudge(
                    "python",
                    "judges/ohlcv_factor.py",
                    [
                        "judges/ohlcv_factor.py",
                        "judges/factor_diagnostics.py",
                    ],
                    [],
                    60,
                ),
                objective=StudyObjective(
                    "validation_mean_ic",
                    "maximize",
                    0.01,
                ),
                dataset=shared_dataset,
                dependencies={
                    "paths": [
                        FACTOR_CLAIM,
                        FACTOR_POPULATION,
                        RESEARCH_HORIZON,
                    ]
                },
            ),
            "ohlcv_factor_lab",
        ),
        (
            StudyDefinition(
                schema_version=1,
                id=PORTFOLIO_STUDY_ID,
                name="OHLCV Portfolio Quality",
                description=(
                    "Translate the shared candidate factor into constrained, "
                    "costed target weights"
                ),
                program="program.md",
                subject=StudySubject("factor", "portfolio-factor", "working"),
                editable={"paths": ["factors/**"]},
                judge=StudyJudge(
                    "python",
                    "judges/ohlcv_portfolio.py",
                    [
                        "judges/ohlcv_portfolio.py",
                        "judges/portfolio_core.py",
                    ],
                    [],
                    180,
                ),
                objective=StudyObjective(
                    "validation_net_sharpe",
                    "maximize",
                    0.05,
                ),
                dataset=shared_dataset,
                dependencies={
                    "paths": [
                        FACTOR_CLAIM,
                        FACTOR_POPULATION,
                        PORTFOLIO_MANDATE,
                        RESEARCH_HORIZON,
                    ]
                },
            ),
            "ohlcv_portfolio_lab",
        ),
        (
            StudyDefinition(
                schema_version=1,
                id=RL_STUDY_ID,
                name="Governed RL Factor Policy",
                description=(
                    "Challenge a locked candidate factor and fixed reference "
                    "sleeves with a bounded adaptive state representation"
                ),
                program="program.md",
                subject=StudySubject("model", "rl-state-encoder", "working"),
                editable={"paths": ["models/**"]},
                judge=StudyJudge(
                    "python",
                    "judges/ohlcv_rl_factor.py",
                    [
                        "judges/ohlcv_rl_factor.py",
                        "judges/rl_core.py",
                        "judges/portfolio_core.py",
                    ],
                    [],
                    120,
                ),
                objective=StudyObjective(
                    "validation_mean_net_sharpe",
                    "maximize",
                    0.20,
                ),
                dataset=shared_dataset,
                dependencies={
                    "paths": [
                        "factors/**",
                        FACTOR_CLAIM,
                        FACTOR_POPULATION,
                        PORTFOLIO_MANDATE,
                        RESEARCH_HORIZON,
                    ]
                },
            ),
            "ohlcv_rl_factor_lab",
        ),
    )
    studies = []
    for definition, source_template in definitions:
        study = create_study(project, definition)
        study.program_path.write_text(
            _template_text("program.md", template=source_template),
            encoding="utf-8",
        )
        _write_preflight_manifest(
            study,
            entrypoint=(
                rl_preflight
                if definition.id == RL_STUDY_ID
                else factor_preflight
            ),
        )
        _externalize_intake_guidance(project, intake, study.program_path)
        studies.append(load_study(project, definition.id))

    _finalize_intake(project, intake, studies[0], snapshot_hash)
    from .research_program import create_research_program_manifest

    create_research_program_manifest(project)


def apply_project_template(
    project: ProjectContext,
    template_id: str,
    *,
    intake: PreparedIntake | None = None,
) -> None:
    if template_id not in PROJECT_TEMPLATE_IDS:
        raise AutoQuantValidationError(
            [
                _issue(
                    template_id,
                    "project.template",
                    "Unknown Project template. Expected one of: "
                    + ", ".join(PROJECT_TEMPLATE_IDS),
                )
            ]
        )
    if template_id == "blank":
        if intake is not None:
            raise AutoQuantValidationError(
                [
                    _issue(
                        template_id,
                        "intake.template",
                        "Blank Projects cannot receive OHLCV intake",
                    )
                ]
            )
        return
    if template_id == "ohlcv-factor-lab":
        _apply_ohlcv_factor_lab(project, intake)
    elif template_id == "ohlcv-portfolio-lab":
        _apply_ohlcv_portfolio_lab(project, intake)
    elif template_id == "ohlcv-rl-factor-lab":
        _apply_ohlcv_rl_factor_lab(project, intake)
    elif template_id == "ohlcv-book-risk-lab":
        _apply_ohlcv_book_risk_lab(project, intake)
    elif template_id == "ohlcv-event-study-lab":
        _apply_ohlcv_event_study_lab(project, intake)
    elif template_id == "ohlcv-book-path-stress-lab":
        _apply_ohlcv_book_path_stress_lab(project, intake)
    elif template_id == "ohlcv-allocation-lab":
        _apply_ohlcv_allocation_lab(project, intake)
    else:
        _apply_ohlcv_research_desk(project, intake)
