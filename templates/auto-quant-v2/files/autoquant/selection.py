"""Project-wide research families and selection-adjusted evidence."""

from __future__ import annotations

import math
import statistics
from dataclasses import dataclass
from datetime import datetime
from statistics import NormalDist
from typing import Any

from .runs import RunContext, list_runs, load_run
from .studies import hash_json
from .workspace import ProjectContext


FAMILY_KIND = "autoquant-research-family"
FAMILY_BOUNDARY = "project-fixed-evaluation-v1"
TRIAL_COUNT_ASSUMPTION = "unique-source-upper-bound"
CONFIDENCE_LEVEL = 0.95
EULER_MASCHERONI = 0.5772156649015329
NORMAL = NormalDist()


@dataclass(frozen=True)
class ResearchFamily:
    projection: dict[str, Any]
    successful_values: tuple[float, ...]


def _finite_number(value: Any) -> float | None:
    if (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(float(value))
    ):
        return float(value)
    return None


def _timestamp(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def research_family_boundary(result: dict[str, Any]) -> dict[str, Any]:
    """Return the fixed evaluator/data identity shared by comparable trials."""

    dependencies = result.get("dependencies")
    dependency_hash = (
        dependencies.get("hash") if isinstance(dependencies, dict) else None
    )
    return {
        "kind": FAMILY_KIND,
        "boundary": FAMILY_BOUNDARY,
        "studyId": result["study"]["id"],
        "programHash": result["study"]["programHash"],
        "judgeHash": result["judge"]["hash"],
        "datasetHash": result["dataset"]["hash"],
        "dependencyHash": dependency_hash,
        "objective": result["objective"],
    }


def research_family_id(result: dict[str, Any]) -> str:
    return f"family-{hash_json(research_family_boundary(result))[:16]}"


def _matching_runs(
    project: ProjectContext,
    anchor: RunContext,
    cutoff: str | None,
) -> list[RunContext]:
    family_id = research_family_id(anchor.result)
    cutoff_time = _timestamp(cutoff) if cutoff is not None else None
    runs: list[RunContext] = []
    for summary in list_runs(project, anchor.result["study"]["id"]):
        run = load_run(project, summary.id)
        if research_family_id(run.result) != family_id:
            continue
        if (
            cutoff_time is not None
            and _timestamp(run.result["completedAt"]) > cutoff_time
        ):
            continue
        runs.append(run)
    return sorted(
        runs,
        key=lambda item: (item.result["completedAt"], item.result["id"]),
    )


def build_research_family(
    project: ProjectContext,
    anchor: RunContext,
    *,
    cutoff: str | None = None,
) -> ResearchFamily:
    """Build the complete verified family ledger at one point in time."""

    matching = _matching_runs(project, anchor, cutoff)
    by_source: dict[str, list[RunContext]] = {}
    for run in matching:
        by_source.setdefault(run.result["subject"]["sourceHash"], []).append(run)

    records: list[dict[str, Any]] = []
    successful_values: list[float] = []
    inconsistent = 0
    failed_sources = 0
    metric = anchor.result["objective"]["metric"]
    for source_hash, executions in sorted(by_source.items()):
        successes = [
            run for run in executions if run.result["status"] == "succeeded"
        ]
        values = [
            value
            for run in successes
            if (value := _finite_number(run.result["metrics"].get(metric)))
            is not None
        ]
        statuses = {run.result["status"] for run in executions}
        reproducible = (
            len(statuses) == 1
            and (
                not values
                or max(values) - min(values) <= 1e-12
            )
        )
        if not reproducible:
            inconsistent += 1
        if values:
            successful_values.append(values[0])
        else:
            failed_sources += 1
        records.append(
            {
                "sourceHash": source_hash,
                "executions": [
                    {
                        "id": run.result["id"],
                        "resultHash": run.manifest["resultHash"],
                        "status": run.result["status"],
                        "primaryValue": _finite_number(
                            run.result["metrics"].get(metric)
                        ),
                    }
                    for run in executions
                ],
                "successful": bool(values),
                "reproducible": reproducible,
                "primaryValue": values[0] if values else None,
            }
        )

    unique_sources = len(records)
    successful_sources = len(successful_values)
    projection = {
        "schemaVersion": 1,
        "kind": FAMILY_KIND,
        "id": research_family_id(anchor.result),
        "boundary": FAMILY_BOUNDARY,
        "ledgerHash": hash_json(records),
        "cutoff": cutoff if cutoff is not None else "current",
        "trialCountAssumption": TRIAL_COUNT_ASSUMPTION,
        "totalExecutions": len(matching),
        "uniqueSourceTrials": unique_sources,
        "successfulSourceTrials": successful_sources,
        "failedSourceTrials": failed_sources,
        "duplicateExecutions": len(matching) - unique_sources,
        "reproducible": inconsistent == 0,
        "inconsistentSourceTrials": inconsistent,
    }
    return ResearchFamily(projection, tuple(successful_values))


def probabilistic_sharpe_probability(
    observed_sharpe: float,
    benchmark_sharpe: float,
    observations: int,
    skewness: float,
    kurtosis: float,
) -> float:
    """Bailey/López de Prado PSR using per-observation Sharpe values."""

    values = (
        observed_sharpe,
        benchmark_sharpe,
        skewness,
        kurtosis,
    )
    if (
        observations < 2
        or not all(math.isfinite(value) for value in values)
        or kurtosis < 1.0
    ):
        raise ValueError("Invalid Probabilistic Sharpe inputs")
    variance_term = (
        1.0
        - skewness * observed_sharpe
        + ((kurtosis - 1.0) / 4.0) * observed_sharpe**2
    )
    if variance_term <= 0.0:
        raise ValueError("Probabilistic Sharpe variance term is non-positive")
    z_score = (
        (observed_sharpe - benchmark_sharpe)
        * math.sqrt(observations - 1)
        / math.sqrt(variance_term)
    )
    return float(NORMAL.cdf(z_score))


def expected_maximum_sharpe(
    successful_sharpes: list[float],
    unique_trials: int,
) -> tuple[float, float]:
    """Return expected maximum and population dispersion in Sharpe units."""

    if unique_trials < 1 or not successful_sharpes:
        raise ValueError("Expected maximum Sharpe requires observed trials")
    if not all(math.isfinite(value) for value in successful_sharpes):
        raise ValueError("Sharpe trials must be finite")
    dispersion = float(statistics.pstdev(successful_sharpes))
    if unique_trials == 1 or dispersion <= 1e-15:
        return 0.0, dispersion
    maximum_z = (
        (1.0 - EULER_MASCHERONI)
        * NORMAL.inv_cdf(1.0 - 1.0 / unique_trials)
        + EULER_MASCHERONI
        * NORMAL.inv_cdf(1.0 - 1.0 / (unique_trials * math.e))
    )
    return dispersion * maximum_z, dispersion


def _unsupported(reason: str, family: ResearchFamily) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "status": "unsupported",
        "method": None,
        "reason": reason,
        "interpretation": (
            "The verified evidence does not justify a selection-adjusted "
            "statistic for this objective family."
        ),
        "confidenceLevel": CONFIDENCE_LEVEL,
        "passes": None,
        "verdictAuthority": "diagnostic-only",
        "trialCountAssumption": family.projection["trialCountAssumption"],
        "statistics": None,
    }


def _factor_adjustment(
    leader: RunContext,
    family: ResearchFamily,
) -> dict[str, Any]:
    validation = leader.result["metrics"].get("validation")
    hac = validation.get("hac") if isinstance(validation, dict) else None
    raw_p = (
        _finite_number(hac.get("normal_approximation_p_value"))
        if isinstance(hac, dict)
        else None
    )
    observed = (
        _finite_number(validation.get("mean_ic"))
        if isinstance(validation, dict)
        else None
    )
    if raw_p is None or observed is None:
        return _unsupported("missing-factor-hac-evidence", family)
    trials = max(1, family.projection["uniqueSourceTrials"])
    adjusted_p = min(1.0, raw_p * trials)
    passes = observed > 0.0 and adjusted_p <= 1.0 - CONFIDENCE_LEVEL
    return {
        "schemaVersion": 1,
        "status": "available",
        "method": "bonferroni-hac-v1",
        "reason": None,
        "interpretation": (
            "Selected validation mean IC survives the 95% family-wise HAC "
            "threshold."
            if passes
            else "Selected validation mean IC does not survive the 95% "
            "family-wise HAC threshold."
        ),
        "confidenceLevel": CONFIDENCE_LEVEL,
        "passes": passes,
        "verdictAuthority": "diagnostic-only",
        "trialCountAssumption": family.projection["trialCountAssumption"],
        "statistics": {
            "observedMeanIc": observed,
            "rawHacPValue": raw_p,
            "familywiseAdjustedPValue": adjusted_p,
            "familywiseConfidence": 1.0 - adjusted_p,
            "uniqueTrials": trials,
        },
    }


def _portfolio_adjustment(
    leader: RunContext,
    family: ResearchFamily,
) -> dict[str, Any]:
    portfolio = leader.result["metrics"].get("portfolio")
    validation = (
        portfolio.get("validation") if isinstance(portfolio, dict) else None
    )
    net = validation.get("net") if isinstance(validation, dict) else None
    required = {
        "observations",
        "annualization_periods",
        "period_sharpe",
        "return_skewness",
        "return_kurtosis",
    }
    if not isinstance(net, dict) or not required.issubset(net):
        return _unsupported("missing-portfolio-return-moments", family)
    observations = net["observations"]
    annualization = net["annualization_periods"]
    period_sharpe = _finite_number(net["period_sharpe"])
    skewness = _finite_number(net["return_skewness"])
    kurtosis = _finite_number(net["return_kurtosis"])
    if (
        not isinstance(observations, int)
        or isinstance(observations, bool)
        or observations < 2
        or not isinstance(annualization, int)
        or isinstance(annualization, bool)
        or annualization < 1
        or period_sharpe is None
        or skewness is None
        or kurtosis is None
    ):
        return _unsupported("invalid-portfolio-return-moments", family)
    if not family.projection["reproducible"]:
        return _unsupported("non-reproducible-research-family", family)
    if (
        family.projection["uniqueSourceTrials"] > 1
        and len(family.successful_values) < 2
    ):
        return _unsupported(
            "insufficient-successful-sharpe-trials",
            family,
        )
    successful_period_sharpes = [
        value / math.sqrt(annualization)
        for value in family.successful_values
    ]
    try:
        expected_maximum, dispersion = expected_maximum_sharpe(
            successful_period_sharpes,
            max(1, family.projection["uniqueSourceTrials"]),
        )
        psr = probabilistic_sharpe_probability(
            period_sharpe,
            0.0,
            observations,
            skewness,
            kurtosis,
        )
        dsr = probabilistic_sharpe_probability(
            period_sharpe,
            expected_maximum,
            observations,
            skewness,
            kurtosis,
        )
    except ValueError:
        return _unsupported("invalid-probabilistic-sharpe-domain", family)

    variance_term = (
        1.0
        - skewness * period_sharpe
        + ((kurtosis - 1.0) / 4.0) * period_sharpe**2
    )
    difference = period_sharpe - expected_maximum
    minimum_observations = None
    if difference > 0.0:
        minimum_observations = int(
            math.ceil(
                1.0
                + variance_term
                * (
                    NORMAL.inv_cdf(CONFIDENCE_LEVEL)
                    / difference
                )
                ** 2
            )
        )
    record_sufficient = (
        minimum_observations is not None
        and observations >= minimum_observations
    )
    passes = dsr >= CONFIDENCE_LEVEL and record_sufficient
    return {
        "schemaVersion": 1,
        "status": "available",
        "method": "deflated-sharpe-ratio-v1",
        "reason": None,
        "interpretation": (
            "Selected validation net Sharpe survives the 95% deflated-Sharpe "
            "and minimum-track-record checks."
            if passes
            else "Selected validation net Sharpe does not survive both the "
            "95% deflated-Sharpe and minimum-track-record checks."
        ),
        "confidenceLevel": CONFIDENCE_LEVEL,
        "passes": passes,
        "verdictAuthority": "diagnostic-only",
        "trialCountAssumption": family.projection["trialCountAssumption"],
        "statistics": {
            "observations": observations,
            "annualizationPeriods": annualization,
            "observedPeriodSharpe": period_sharpe,
            "observedAnnualizedSharpe": period_sharpe
            * math.sqrt(annualization),
            "returnSkewness": skewness,
            "returnKurtosis": kurtosis,
            "successfulSharpeTrials": len(successful_period_sharpes),
            "uniqueTrials": family.projection["uniqueSourceTrials"],
            "trialSharpeDispersionPeriod": dispersion,
            "trialSharpeDispersionAnnualized": dispersion
            * math.sqrt(annualization),
            "expectedMaximumPeriodSharpe": expected_maximum,
            "expectedMaximumAnnualizedSharpe": expected_maximum
            * math.sqrt(annualization),
            "probabilisticSharpeProbability": psr,
            "deflatedSharpeProbability": dsr,
            "minimumTrackRecordObservations": minimum_observations,
            "trackRecordSufficient": record_sufficient,
        },
    }


def build_selection_adjustment(
    leader: RunContext,
    family: ResearchFamily,
) -> dict[str, Any]:
    metric = leader.result["objective"]["metric"]
    if metric == "validation_mean_ic":
        return _factor_adjustment(leader, family)
    if metric == "validation_net_sharpe":
        return _portfolio_adjustment(leader, family)
    if metric == "validation_mean_net_sharpe":
        return _unsupported(
            "aggregate-dependent-fold-seed-objective",
            family,
        )
    return _unsupported("unsupported-objective-family", family)
