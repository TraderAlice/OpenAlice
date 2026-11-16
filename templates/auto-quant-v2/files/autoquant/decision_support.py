"""Point-in-time decision-support snapshots for immutable handoff artifacts."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .factor_claims import factor_outcome
from .factor_explorer import load_factor_diagnostics
from .portfolio_explorer import load_portfolio_diagnostics
from .rl_explorer import load_rl_diagnostics
from .runs import load_run
from .studies import hash_json
from .templates import OHLCV_STUDY_ID, PORTFOLIO_STUDY_ID, RL_STUDY_ID
from .workspace import (
    AutoQuantValidationError,
    ProjectContext,
    ValidationIssue,
)


LEADER_DECISION_SUPPORT_KIND = "autoquant-leader-decision-support"


def build_leader_decision_support(
    project: ProjectContext,
    run_id: str,
) -> dict[str, Any]:
    """Rebuild the bounded decision snapshot for one exact leader Run."""

    run = load_run(project, run_id)
    succeeded = run.result["status"] == "succeeded"
    factor_diagnostics = (
        load_factor_diagnostics(
            project,
            run_id,
            point_limit=40,
        )
        if succeeded and run.result["study"]["id"] == OHLCV_STUDY_ID
        else None
    )
    factor_qualification = (
        factor_diagnostics["factorQualification"]
        if factor_diagnostics is not None
        else None
    )
    factor_components = (
        factor_diagnostics["factorComponents"]
        if factor_diagnostics is not None
        else None
    )
    factor_input_availability = (
        factor_diagnostics["inputAvailability"]
        if factor_diagnostics is not None
        else None
    )
    portfolio_diagnostics = (
        load_portfolio_diagnostics(
            project,
            run_id,
            point_limit=40,
        )
        if succeeded and run.result["study"]["id"] == PORTFOLIO_STUDY_ID
        else None
    )
    mechanical_decision = (
        portfolio_diagnostics["mechanicalDecision"]
        if portfolio_diagnostics is not None
        else None
    )
    sizing_anatomy = (
        portfolio_diagnostics["sizingAnatomy"]
        if portfolio_diagnostics is not None
        else None
    )
    diversification_stress = (
        portfolio_diagnostics["diversificationStress"]
        if portfolio_diagnostics is not None
        else None
    )
    strategy_viability = (
        portfolio_diagnostics["strategyViability"]
        if portfolio_diagnostics is not None
        else None
    )
    signal_monetization = (
        portfolio_diagnostics["signalMonetization"]
        if portfolio_diagnostics is not None
        else None
    )
    rl_diagnostics = (
        load_rl_diagnostics(
            project,
            run_id,
            point_limit=40,
        )
        if succeeded and run.result["study"]["id"] == RL_STUDY_ID
        else None
    )
    rl_factor_fusion_diagnosis = (
        rl_diagnostics["factorFusionDiagnosis"]
        if rl_diagnostics is not None
        else None
    )
    return {
        "kind": LEADER_DECISION_SUPPORT_KIND,
        "runId": run.result["id"],
        "resultHash": run.manifest["resultHash"],
        "factorQualificationHash": (
            hash_json(factor_qualification)
            if factor_qualification is not None
            else None
        ),
        "factorQualification": factor_qualification,
        "factorComponentsHash": (
            hash_json(factor_components)
            if factor_components is not None
            else None
        ),
        "factorComponents": factor_components,
        "factorInputAvailabilityHash": (
            hash_json(factor_input_availability)
            if factor_input_availability is not None
            else None
        ),
        "factorInputAvailability": factor_input_availability,
        "portfolioMechanicalDecisionHash": (
            hash_json(mechanical_decision)
            if mechanical_decision is not None
            else None
        ),
        "portfolioMechanicalDecision": mechanical_decision,
        "portfolioSizingAnatomyHash": (
            hash_json(sizing_anatomy)
            if sizing_anatomy is not None
            else None
        ),
        "portfolioSizingAnatomy": sizing_anatomy,
        "portfolioDiversificationStressHash": (
            hash_json(diversification_stress)
            if diversification_stress is not None
            else None
        ),
        "portfolioDiversificationStress": diversification_stress,
        "portfolioStrategyViabilityHash": (
            hash_json(strategy_viability)
            if strategy_viability is not None
            else None
        ),
        "portfolioStrategyViability": strategy_viability,
        "portfolioSignalMonetizationHash": (
            hash_json(signal_monetization)
            if signal_monetization is not None
            else None
        ),
        "portfolioSignalMonetization": signal_monetization,
        "rlFactorFusionDiagnosisHash": (
            hash_json(rl_factor_fusion_diagnosis)
            if rl_factor_fusion_diagnosis is not None
            else None
        ),
        "rlFactorFusionDiagnosis": rl_factor_fusion_diagnosis,
    }


def verify_leader_decision_support(
    project: ProjectContext,
    value: Any,
    run_id: str,
    path: Path | str,
) -> dict[str, Any]:
    """Require one frozen snapshot to equal the current immutable Run bytes."""

    if not isinstance(value, dict):
        raise AutoQuantValidationError(
            [
                ValidationIssue(
                    str(path),
                    "decision-support.type",
                    "Leader decision support must be an object",
                )
            ]
        )
    expected = build_leader_decision_support(project, run_id)
    optional_pairs = (
        (
            "factorQualificationHash",
            "factorQualification",
        ),
        (
            "factorComponentsHash",
            "factorComponents",
        ),
        (
            "factorInputAvailabilityHash",
            "factorInputAvailability",
        ),
        (
            "portfolioSizingAnatomyHash",
            "portfolioSizingAnatomy",
        ),
        (
            "portfolioDiversificationStressHash",
            "portfolioDiversificationStress",
        ),
        (
            "portfolioStrategyViabilityHash",
            "portfolioStrategyViability",
        ),
        (
            "portfolioSignalMonetizationHash",
            "portfolioSignalMonetization",
        ),
        (
            "rlFactorFusionDiagnosisHash",
            "rlFactorFusionDiagnosis",
        ),
    )
    compatible_expected = dict(expected)
    complete_pairs = True
    for hash_key, object_key in optional_pairs:
        hash_present = hash_key in value
        object_present = object_key in value
        if hash_present != object_present:
            complete_pairs = False
            break
        if not hash_present:
            compatible_expected.pop(hash_key)
            compatible_expected.pop(object_key)
    if not complete_pairs or value != compatible_expected:
        raise AutoQuantValidationError(
            [
                ValidationIssue(
                    str(path),
                    "decision-support.mismatch",
                    "Frozen leader decision support differs from the immutable Run",
                )
            ]
        )
    return expected


def summarize_leader_decision_support(value: Any) -> dict[str, Any]:
    """Return a bounded Report-list/Studio projection without inventing evidence."""

    if not isinstance(value, dict):
        return {
            "available": False,
            "reason": "legacy-report",
            "runId": None,
            "resultHash": None,
            "factorQualificationHash": None,
            "factorComponentsHash": None,
            "factorInputAvailabilityHash": None,
            "portfolioMechanicalDecisionHash": None,
            "portfolioSizingAnatomyHash": None,
            "portfolioDiversificationStressHash": None,
            "portfolioStrategyViabilityHash": None,
            "portfolioSignalMonetizationHash": None,
            "rlFactorFusionDiagnosisHash": None,
            "portfolio": None,
            "factor": None,
            "rl": None,
        }
    decision = value.get("portfolioMechanicalDecision")
    factor_qualification = value.get("factorQualification")
    factor_components = value.get("factorComponents")
    factor_input_availability = value.get("factorInputAvailability")
    factor_summary = None
    if (
        isinstance(factor_qualification, dict)
        and factor_qualification.get("available")
    ):
        validation = factor_qualification["validation"]
        weakest_style_neutral_fold = validation[
            "weakestStyleNeutralFold"
        ]
        factor_summary = {
            "method": factor_qualification["method"],
            "claim": factor_qualification["claim"]["claim"],
            "knownStyle": factor_qualification["claim"]["knownStyle"],
            "outcome": factor_outcome(factor_qualification["claim"]),
            "stage": factor_qualification["diagnosis"]["stage"],
            "qualifiesForPortfolio": factor_qualification["diagnosis"][
                "qualifiesForPortfolio"
            ],
            "iterationFocus": factor_qualification["diagnosis"][
                "iterationFocus"
            ],
            "dominantStyle": factor_qualification["selection"][
                "dominantStyle"
            ],
            "rawRankIc": validation["candidate"]["meanRankIc"],
            "styleRankIc": validation["dominantStyle"]["meanRankIc"],
            "styleNeutralRankIc": validation[
                "styleNeutralCandidate"
            ]["meanRankIc"],
            "blendRankIc": validation["equalRankBlend"]["meanRankIc"],
            "styleNeutralIcRetention": validation["incremental"][
                "styleNeutralIcRetention"
            ],
            "styleNeutralIcDelta": validation["incremental"][
                "styleNeutralIcDelta"
            ],
            "blendUpliftVsStyle": validation["incremental"][
                "blendUpliftVsStyle"
            ],
            "weakestStyleNeutralFold": validation[
                "weakestStyleNeutralFold"
            ]["id"] if weakest_style_neutral_fold is not None else None,
            "weakestStyleNeutralFoldIc": validation[
                "weakestStyleNeutralFold"
            ]["meanRankIc"] if weakest_style_neutral_fold is not None else None,
            "components": (
                {
                    "count": factor_components["trialDisclosure"][
                        "materializedComponents"
                    ],
                    "crossSectionalScoreCount": factor_components[
                        "trialDisclosure"
                    ]["crossSectionalScoreComponents"],
                    "timestampContextCount": factor_components[
                        "trialDisclosure"
                    ]["timestampContextComponents"],
                    "pairwiseComparisons": factor_components[
                        "trialDisclosure"
                    ]["pairwiseComparisons"],
                    "strongestRawComponent": factor_components[
                        "validationDiagnosis"
                    ]["strongestRawComponent"],
                    "strongestRawMeanIc": factor_components[
                        "validationDiagnosis"
                    ]["strongestRawMeanIc"],
                    "strongestResidualComponent": factor_components[
                        "validationDiagnosis"
                    ]["strongestResidualComponent"],
                    "strongestResidualMeanIc": factor_components[
                        "validationDiagnosis"
                    ]["strongestResidualMeanIc"],
                    "removalMostImprovesFixedBlend": factor_components[
                        "validationDiagnosis"
                    ]["removalMostImprovesFixedBlend"],
                    "bestRemovalDeltaMeanIc": factor_components[
                        "validationDiagnosis"
                    ]["bestRemovalDeltaMeanIc"],
                }
                if isinstance(factor_components, dict)
                and factor_components.get("available")
                else None
            ),
            "inputAvailability": (
                {
                    "observationCoverage": factor_input_availability[
                        "observationCoverage"
                    ],
                    "completeTimestamps": factor_input_availability[
                        "completeTimestamps"
                    ],
                    "timestamps": factor_input_availability[
                        "timestamps"
                    ],
                    "inputAssetsPerTimestamp": factor_input_availability[
                        "assetsPerTimestamp"
                    ]["input"],
                    "eligibleFactorTimestamps": factor_input_availability[
                        "eligibleFactorTimestamps"
                    ],
                }
                if isinstance(factor_input_availability, dict)
                and factor_input_availability.get("available")
                else None
            ),
        }
    rl_diagnosis = value.get("rlFactorFusionDiagnosis")
    rl_summary = None
    if isinstance(rl_diagnosis, dict) and rl_diagnosis.get("available"):
        validation = rl_diagnosis["validation"]
        candidate = validation["candidateFactor"]
        transmission = validation["adaptiveTransmission"]
        stability = validation["stability"]
        rl_summary = {
            "method": rl_diagnosis["method"],
            "stage": rl_diagnosis["diagnosis"]["stage"],
            "iterationFocus": rl_diagnosis["diagnosis"][
                "iterationFocus"
            ],
            "candidateAssessment": candidate["assessment"],
            "candidateFixedSharpeDeltaVsBalanced": candidate[
                "fixedSleeveSharpeDeltaVsBalanced"
            ],
            "candidateLocalRewardDeltaVsBalanced": candidate[
                "meanLocalRewardDeltaVsBalanced"
            ],
            "candidateSelectedFrequency": candidate[
                "selectedFrequency"
            ],
            "candidateLocalBestFrequency": candidate[
                "localBestFrequency"
            ],
            "candidateOracleCaptureRate": candidate[
                "oracleCaptureRate"
            ],
            "grossActiveReturn": transmission[
                "meanTrialGrossActiveReturn"
            ],
            "incrementalCost": transmission[
                "meanTrialIncrementalCost"
            ],
            "netActiveReturn": transmission[
                "meanTrialNetActiveReturn"
            ],
            "sharpeAdvantage": transmission[
                "meanSharpeAdvantageVsSelectedBaseline"
            ],
            "positiveNetTrialRate": stability[
                "positiveNetTrialRate"
            ],
            "worstRegime": validation["lossLocator"][
                "worstRegime"
            ]["key"],
            "worstActionPair": validation["lossLocator"][
                "worstActionPair"
            ]["key"],
        }
    if not isinstance(decision, dict):
        if factor_summary is not None or rl_summary is not None:
            return {
                "available": True,
                "reason": None,
                "runId": value["runId"],
                "resultHash": value["resultHash"],
                "factorQualificationHash": value.get(
                    "factorQualificationHash"
                ),
                "factorComponentsHash": value.get(
                    "factorComponentsHash"
                ),
                "factorInputAvailabilityHash": value.get(
                    "factorInputAvailabilityHash"
                ),
                "portfolioMechanicalDecisionHash": value.get(
                    "portfolioMechanicalDecisionHash"
                ),
                "portfolioSizingAnatomyHash": value.get(
                    "portfolioSizingAnatomyHash"
                ),
                "portfolioDiversificationStressHash": value.get(
                    "portfolioDiversificationStressHash"
                ),
                "portfolioStrategyViabilityHash": value.get(
                    "portfolioStrategyViabilityHash"
                ),
                "portfolioSignalMonetizationHash": value.get(
                    "portfolioSignalMonetizationHash"
                ),
                "rlFactorFusionDiagnosisHash": value.get(
                    "rlFactorFusionDiagnosisHash"
                ),
                "portfolio": None,
                "factor": factor_summary,
                "rl": rl_summary,
            }
        return {
            "available": False,
            "reason": "no-supported-leader-diagnosis",
            "runId": value.get("runId"),
            "resultHash": value.get("resultHash"),
            "factorQualificationHash": value.get(
                "factorQualificationHash"
            ),
            "factorComponentsHash": value.get(
                "factorComponentsHash"
            ),
            "factorInputAvailabilityHash": value.get(
                "factorInputAvailabilityHash"
            ),
            "portfolioMechanicalDecisionHash": value.get(
                "portfolioMechanicalDecisionHash"
            ),
            "portfolioSizingAnatomyHash": value.get(
                "portfolioSizingAnatomyHash"
            ),
            "portfolioDiversificationStressHash": value.get(
                "portfolioDiversificationStressHash"
            ),
            "portfolioStrategyViabilityHash": value.get(
                "portfolioStrategyViabilityHash"
            ),
            "portfolioSignalMonetizationHash": value.get(
                "portfolioSignalMonetizationHash"
            ),
            "rlFactorFusionDiagnosisHash": value.get(
                "rlFactorFusionDiagnosisHash"
            ),
            "portfolio": None,
            "factor": None,
            "rl": None,
        }
    signal = decision["signalGate"]
    target = decision["targetGate"]
    execution = decision["executionGate"]
    sizing = value.get("portfolioSizingAnatomy")
    sizing_summary = None
    if isinstance(sizing, dict):
        construction = sizing["construction"]
        sizing_summary = {
            "method": sizing["method"],
            "rawGross": construction["rawGross"],
            "governedGross": construction["governedGross"],
            "executedGross": construction["executedGross"],
            "unfundedGross": construction["unfundedGross"],
            "atCapAssets": sum(
                len(side["atCapAssets"]) for side in sizing["sides"]
            ),
            "componentRiskAvailable": sizing["componentRisk"][
                "available"
            ],
            "componentRiskConcentrationHhi": sizing["componentRisk"][
                "absoluteConcentrationHhi"
            ],
            "largestAbsoluteComponentRiskContributor": sizing[
                "componentRisk"
            ]["largestAbsoluteContributor"],
        }
    viability = value.get("portfolioStrategyViability")
    viability_summary = None
    if isinstance(viability, dict):
        validation = viability["validation"]
        test = viability["test"]
        friction = validation["friction"]
        temporal = validation["temporal"]
        viability_summary = {
            "method": viability["method"],
            "stage": viability["diagnosis"]["stage"],
            "iterationFocus": viability["diagnosis"][
                "iterationFocus"
            ],
            "factorRankIc": validation["factorRankIc"],
            "grossSharpe": validation["gross"]["sharpe"],
            "netSharpe": validation["net"]["sharpe"],
            "grossToNetSharpeDelta": friction[
                "grossToNetSharpeDelta"
            ],
            "baseCostBps": friction["baseCostBps"],
            "breakEvenCost": friction["breakEvenCost"],
            "annualizedOneWayTurnover": friction[
                "annualizedOneWayTurnover"
            ],
            "positiveNetMonthRate": temporal[
                "positiveNetMonthRate"
            ],
            "maximumUnderwaterBars": temporal[
                "maximumUnderwaterBars"
            ],
            "netTotalReturnWithoutBestDays": temporal[
                "netTotalReturnWithoutBestDays"
            ],
            "testNetSharpe": test["net"]["sharpe"],
        }
    diversification = value.get("portfolioDiversificationStress")
    diversification_summary = None
    if isinstance(diversification, dict):
        current = diversification["current"]
        validation = diversification["validation"]
        test = diversification["test"]
        diversification_summary = {
            "method": diversification["method"],
            "state": current["state"],
            "activeAssets": current["activeAssets"],
            "sampleForecastAnnualized": current[
                "sampleForecastAnnualized"
            ],
            "perfectCorrelationForecastAnnualized": current[
                "perfectCorrelationForecastAnnualized"
            ],
            "stressMultiplier": current["stressMultiplier"],
            "ceilingAnnualized": current["ceilingAnnualized"],
            "stressBreachesCeiling": current[
                "stressBreachesCeiling"
            ],
            "absoluteComponentRiskHhi": current[
                "absoluteComponentRiskHhi"
            ],
            "effectiveRiskBets": current["effectiveRiskBets"],
            "largestAbsoluteComponentRiskContributor": current[
                "largestAbsoluteComponentRiskContributor"
            ],
            "validationStressBreachRate": validation[
                "stressBreachRate"
            ],
            "validationMedianEffectiveRiskBets": validation[
                "medianEffectiveRiskBets"
            ],
            "testStressBreachRate": test["stressBreachRate"],
        }
    monetization = value.get("portfolioSignalMonetization")
    monetization_summary = None
    if isinstance(monetization, dict):
        validation = monetization["validation"]
        stages = {
            item["id"]: item for item in validation["stages"]
        }
        monetization_summary = {
            "method": monetization["method"],
            "outcome": monetization["diagnosis"]["outcome"],
            "iterationFocus": monetization["diagnosis"][
                "iterationFocus"
            ],
            "largestAdverseStage": monetization["diagnosis"][
                "largestAdverseStage"
            ],
            "largestAdverseAnnualizedDelta": monetization["diagnosis"][
                "largestAdverseAnnualizedDelta"
            ],
            "equalIntentAnnualizedContribution": stages[
                "equalIntent"
            ]["annualizedContribution"],
            "executedGrossAnnualizedContribution": stages[
                "executedGross"
            ]["annualizedContribution"],
            "executedNetAnnualizedContribution": stages[
                "executedNet"
            ]["annualizedContribution"],
            "noTradeRetentionDates": validation["coverage"][
                "noTradeRetentionDates"
            ],
            "decisionDates": validation["coverage"]["decisionDates"],
        }
    return {
        "available": True,
        "reason": None,
        "runId": value["runId"],
        "resultHash": value["resultHash"],
        "factorQualificationHash": value.get(
            "factorQualificationHash"
        ),
        "factorComponentsHash": value.get("factorComponentsHash"),
        "factorInputAvailabilityHash": value.get(
            "factorInputAvailabilityHash"
        ),
        "portfolioMechanicalDecisionHash": value[
            "portfolioMechanicalDecisionHash"
        ],
        "portfolioSizingAnatomyHash": value.get(
            "portfolioSizingAnatomyHash"
        ),
        "portfolioDiversificationStressHash": value.get(
            "portfolioDiversificationStressHash"
        ),
        "portfolioStrategyViabilityHash": value.get(
            "portfolioStrategyViabilityHash"
        ),
        "portfolioSignalMonetizationHash": value.get(
            "portfolioSignalMonetizationHash"
        ),
        "rlFactorFusionDiagnosisHash": value.get(
            "rlFactorFusionDiagnosisHash"
        ),
        "portfolio": {
            "timestamp": decision["timestamp"],
            "family": signal["family"],
            "stateChanges": signal["stateChanges"],
            "riskGovernorScale": target["riskGovernorScale"],
            "proposedOneWayTurnover": execution[
                "proposedOneWayTurnover"
            ],
            "decisionEligible": execution["decisionEligible"],
            "decisionSchedule": execution["decisionSchedule"],
            "decisionSession": execution["decisionSession"],
            "decisionSource": execution["decisionSource"],
            "noTradeOneWay": execution["noTradeOneWay"],
            "rebalanced": execution["rebalanced"],
            "reason": execution["reason"],
            "positions": len(decision["positions"]),
            "tradingAuthority": decision["tradingAuthority"],
            "sizing": sizing_summary,
            "diversification": diversification_summary,
            "viability": viability_summary,
            "monetization": monetization_summary,
        },
        "factor": None,
        "rl": None,
    }


def _signed_percent(value: float) -> str:
    return f"{value:+.2%}"


def _signal_state(value: int) -> str:
    if value == 1:
        return "LONG"
    if value == -1:
        return "SHORT"
    return "FLAT"


def _trigger_label(trigger: dict[str, Any]) -> str:
    threshold = trigger["threshold"] * 100.0
    distance = trigger["distance"]
    buffer = (
        "rank unavailable"
        if distance is None
        else f"{distance * 100.0:.1f}pp buffer"
    )
    return (
        f"`{trigger['event']} {trigger['comparator']} P{threshold:.0f}` "
        f"({buffer})"
    )


def factor_input_availability_markdown_lines(
    support: dict[str, Any],
    *,
    heading: str,
    lane_name: str | None = None,
) -> list[str]:
    """Render frozen observed-only input breadth and coverage evidence."""

    availability = support.get("factorInputAvailability")
    if (
        not isinstance(availability, dict)
        or not availability.get("available")
    ):
        return []
    prefix = f"{lane_name}: " if lane_name else ""
    breadth = availability["assetsPerTimestamp"]["input"]
    eligible = " / ".join(
        f"h{item['horizon']}={item['timestamps']}"
        for item in availability["eligibleFactorTimestamps"]
    )
    return [
        heading,
        "",
        f"- {prefix}Method / missing-observation policy: "
        f"`{availability['method']}` / "
        f"`{availability['missingObservation']}`.",
        "- Observed / possible rows / coverage: "
        f"`{availability['observedRows']}` / "
        f"`{availability['possibleRows']}` / "
        f"`{availability['observationCoverage']:.2%}`.",
        "- Union / complete timestamps: "
        f"`{availability['timestamps']}` / "
        f"`{availability['completeTimestamps']}`.",
        "- Input assets per timestamp minimum / median / maximum: "
        f"`{breadth['minimum']}` / `{breadth['median']}` / "
        f"`{breadth['maximum']}`.",
        f"- Eligible paired Factor timestamps: `{eligible}`.",
        f"- Availability hash: "
        f"`{support['factorInputAvailabilityHash']}`.",
        "- Interpretation: absent rows remain absent; no forward fill, "
        "global timestamp intersection, or pre-listing history is inferred.",
        "",
    ]


def factor_qualification_markdown_lines(
    support: dict[str, Any],
    *,
    heading: str,
    lane_name: str | None = None,
) -> list[str]:
    """Render the frozen raw-to-style-neutral qualification funnel."""

    qualification = support.get("factorQualification")
    if (
        not isinstance(qualification, dict)
        or not qualification.get("available")
    ):
        return []
    diagnosis = qualification["diagnosis"]
    selection = qualification["selection"]
    claim = qualification["claim"]
    temporal = "temporal-neutralization" in qualification["method"]
    score_label = "temporal rank contribution" if temporal else "IC"
    raw_only_claim = claim["claim"] in {
        "decision-signal",
        "known-style-validation",
    }
    qualification_threshold_line = (
        "- Positive raw evidence requires validation HAC t "
        if raw_only_claim
        else "- Positive raw and residual layers require validation HAC t "
    )
    prefix = f"{lane_name}: " if lane_name else ""
    lines = [
        heading,
        "",
        f"- {prefix}Validation diagnosis / next research focus: "
        f"`{diagnosis['stage']}` / `{diagnosis['iterationFocus']}`",
        f"- Interpretation: {diagnosis['explanation']}",
        f"- Request-bound claim / known style: `{claim['claim']}` / "
        f"`{claim['knownStyle']}`.",
        f"- Fixed prediction outcome: `{factor_outcome(claim)}`; larger "
        "factor values predict larger outcome values.",
        "- Comparison style / selection rule: "
        f"`{selection['dominantStyle']}` / "
        f"`{selection['criterion']}`.",
        "- Neutralization: "
        + (
            "within-split temporal centered-rank OLS; "
            if temporal
            else "same-timestamp cross-sectional centered-rank OLS; "
        )
        + "forward targets do not enter the projection.",
        qualification_threshold_line
        + f"`>= {qualification['semantics']['diagnosticThresholds']['minimumPositiveHacTStatistic']}`; "
        + "Project-family selection-adjusted significance remains separately "
        + "required.",
        f"- Qualification hash: `{support['factorQualificationHash']}`",
        "- Authority: `research-prioritization-only`; validation sets the "
        "diagnosis; test is visible audit only; Factor promotion, RL "
        "admission, and trading authority remain `none`.",
        "",
        f"| Split / role | Raw candidate {score_label} | "
        f"Dominant style {score_label} | "
        f"Style-neutral {score_label} / delta | Equal-blend {score_label} / uplift vs style | "
        f"Weakest {'candidate' if raw_only_claim else 'residual'} fold |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for split_name, key in (
        ("validation", "validation"),
        ("test", "testAudit"),
    ):
        split = qualification[key]
        incremental = split["incremental"]
        worst = (
            split["weakestCandidateFold"]
            if raw_only_claim
            else split["weakestStyleNeutralFold"]
        )
        lines.append(
            f"| `{split_name}` / `{split['role']}` | "
            f"`{split['candidate']['meanRankIc']:+.4f}` | "
            f"`{split['dominantStyle']['meanRankIc']:+.4f}` | "
            f"`{split['styleNeutralCandidate']['meanRankIc']:+.4f}` / "
            f"`{incremental['styleNeutralIcDelta']:+.4f}` | "
            f"`{split['equalRankBlend']['meanRankIc']:+.4f}` / "
            f"`{incremental['blendUpliftVsStyle']:+.4f}` | "
            f"`{worst['id']}` / `{worst['meanRankIc']:+.4f}` |"
        )
    lines.extend(
        [
            "",
            "| Train style candidate | Mean rank overlap | "
            "Mean absolute overlap | Observations |",
            "| --- | --- | --- | --- |",
        ]
    )
    for candidate in selection["candidates"]:
        mean = candidate["meanRankCorrelation"]
        absolute = candidate["meanAbsoluteRankCorrelation"]
        lines.append(
            f"| `{candidate['style']}` | "
            f"`{mean:+.4f}` | `{absolute:.4f}` | "
            f"`{candidate['observations']}` |"
        )
    lines.append("")
    return lines


def factor_components_markdown_lines(
    support: dict[str, Any],
    *,
    heading: str,
    lane_name: str | None = None,
) -> list[str]:
    """Render the frozen candidate-declared component diagnosis."""

    evidence = support.get("factorComponents")
    if not isinstance(evidence, dict) or not evidence.get("available"):
        return []
    prefix = f"{lane_name}: " if lane_name else ""
    diagnosis = evidence["validationDiagnosis"]
    temporal = evidence["evaluationMode"] in {
        "single-asset-temporal",
        "two-asset-relative-value",
    }
    score_label = "temporal rank contribution" if temporal else "IC"

    def metric(value: Any) -> str:
        return "unavailable" if value is None else f"{float(value):+.4f}"

    lines = [
        heading,
        "",
        f"- {prefix}Method / component count / pairwise comparisons: "
        f"`{evidence['method']}` / "
        f"`{evidence['trialDisclosure']['materializedComponents']}` / "
        f"`{evidence['trialDisclosure']['pairwiseComparisons']}`.",
        "- Cross-sectional score / timestamp-context components: "
        f"`{evidence['trialDisclosure']['crossSectionalScoreComponents']}` / "
        f"`{evidence['trialDisclosure']['timestampContextComponents']}`.",
        f"- Strongest validation raw component / {score_label}: "
        f"`{diagnosis['strongestRawComponent']}` / "
        f"`{metric(diagnosis['strongestRawMeanIc'])}`.",
        f"- Strongest nearest-peer residual component / {score_label}: "
        f"`{diagnosis['strongestResidualComponent']}` / "
        f"`{diagnosis['strongestResidualMeanIc']}`.",
        "- Removal that most improves the fixed diagnostic blend / IC delta: "
        f"`{diagnosis['removalMostImprovesFixedBlend']}` / "
        f"`{diagnosis['bestRemovalDeltaMeanIc']}`.",
        f"- Component evidence hash: `{support['factorComponentsHash']}`.",
        "- Interpretation: components are candidate-declared, not inferred "
        "from source and not claimed to exhaustively reconstruct the final "
        "factor. Leave-one-out applies only to the fixed equal-rank diagnostic "
        "blend.",
        "- Authority: `research-prioritization-only`; validation diagnoses, "
        "test is visible audit only, and Portfolio, RL-action, order, account, "
        "and trading authority remain `none`.",
        "",
        "| Component | Role | Claimed intervals | Coverage | Validation evidence | "
        f"Nearest peer / residual {score_label} | Fixed-blend removal Δ | "
        f"Test raw {score_label} |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for component in evidence["components"]:
        validation = component["validation"]
        test = component["testAudit"]
        peer = component["nearestPeer"]
        residual = validation["nearestPeerResidual"]
        if component["role"] == "timestamp-context":
            context = validation["context"]
            occupancy = context["stateOccupancy"]
            validation_evidence = (
                "state occupancy "
                f"L/M/H={occupancy['low']['rate']!s}/"
                f"{occupancy['middle']['rate']!s}/"
                f"{occupancy['high']['rate']!s}; "
                f"transition={context['transitions']['rate']!s}"
            )
            test_raw = "context audit"
        else:
            validation_evidence = metric(validation["raw"]["meanRankIc"])
            test_raw = metric(test["raw"]["meanRankIc"])
        lines.append(
            f"| `{component['id']}` | "
            f"`{component['role']}` | "
            f"`{', '.join(component['intervals'])}` | "
            f"`{component['meanCoverage']:.2%}` | "
            f"`{validation_evidence}` | "
            f"`{peer['id']}` / "
            f"`{metric(residual['meanRankIc'] if residual is not None else None)}` | "
            f"`{validation['fixedBlendRemovalDeltaMeanIc']}` | "
            f"`{test_raw}` |"
        )
    lines.append("")
    return lines


def mechanical_decision_markdown_lines(
    support: dict[str, Any],
    *,
    heading: str,
    lane_name: str | None = None,
) -> list[str]:
    """Render the same frozen decision table for Report and Dossier Markdown."""

    decision = support.get("portfolioMechanicalDecision")
    if not isinstance(decision, dict):
        return []
    signal = decision["signalGate"]
    target = decision["targetGate"]
    execution = decision["executionGate"]
    prefix = f"{lane_name}: " if lane_name else ""
    ordinary = (
        "legacy unavailable"
        if execution["ordinaryRebalance"] is None
        else str(execution["ordinaryRebalance"])
    )
    risk_override = (
        "legacy unavailable"
        if execution["riskOverride"] is None
        else str(execution["riskOverride"])
    )
    lines = [
        heading,
        "",
        f"- {prefix}Leader Run / result hash: `{support['runId']}` / "
        f"`{support['resultHash']}`",
        f"- Decision timestamp / construction: `{decision['timestamp']}` / "
        f"`{signal['family']}`",
        f"- Signal state changes / unavailable scores / context assets: "
        f"`{signal['stateChanges']}` / `{signal['unavailableScores']}` / "
        f"`{signal['contextAssets']}`",
        f"- Pre-governor / governed target gross; risk scale / status: "
        f"`{target['preGovernorGross']}` / "
        f"`{target['governedTargetGross']}`; "
        f"`{target['riskGovernorScale']}` / "
        f"`{target['riskGovernorStatus']}`",
        f"- Proposed one-way turnover / no-trade band: "
        f"`{execution['proposedOneWayTurnover']}` / "
        f"`{execution['noTradeOneWay']}`",
        f"- Decision eligible / schedule / session / source: "
        f"`{execution['decisionEligible']}` / "
        f"`{json.dumps(execution['decisionSchedule'], sort_keys=True)}` / "
        f"`{execution['decisionSession']}` / "
        f"`{execution['decisionSource']}`",
        f"- Ordinary rebalance / risk override / final rebalance: "
        f"`{ordinary}` / `{risk_override}` / `{execution['rebalanced']}` "
        f"(`{execution['reason']}`)",
        f"- Decision hash: "
        f"`{support['portfolioMechanicalDecisionHash']}`",
        "- Authority: `quantitative-decision-support`; trading authority: "
        "`none`. Percentile buffers hold peer ranks fixed and are not price "
        "targets, forecasts, probabilities, orders, or account positions.",
        "",
        "| Asset / state | Score / event | Next permitted state conditions | "
        "Raw → governed target | Pretrade → executed | Historical action |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for position in decision["positions"]:
        triggers = (
            "; ".join(
                _trigger_label(trigger)
                for trigger in position["nextTriggers"]
            )
            if position["nextTriggers"]
            else "none — context-only, no position authority"
        )
        score = (
            f"P{position['score'] * 100.0:.0f}"
            if position["scoreAvailable"]
            else "unavailable"
        )
        state = (
            _signal_state(position["signalState"])
            if position["tradable"]
            else "CONTEXT"
        )
        lines.append(
            f"| `{position['asset']}` / {state} | {score} / "
            f"`{position['signalEvent']}` | {triggers} | "
            f"{_signed_percent(position['preGovernorTargetWeight'])} → "
            f"{_signed_percent(position['targetWeight'])} | "
            f"{_signed_percent(position['pretradeWeight'])} → "
            f"{_signed_percent(position['executedWeight'])} | "
            f"`{position['executionAction']}` / "
            f"`{position['executionReason']}` |"
        )
    lines.append("")
    return lines


def sizing_anatomy_markdown_lines(
    support: dict[str, Any],
    *,
    heading: str,
    lane_name: str | None = None,
) -> list[str]:
    """Render the frozen unequal-weight construction and risk anatomy."""

    sizing = support.get("portfolioSizingAnatomy")
    if not isinstance(sizing, dict):
        return []
    construction = sizing["construction"]
    component = sizing["componentRisk"]
    prefix = f"{lane_name}: " if lane_name else ""
    lines = [
        heading,
        "",
        f"- {prefix}Sizing method / timestamp: `{sizing['method']}` / "
        f"`{sizing['timestamp']}`",
        "- Fixed rule: percentile-distance conviction ÷ causal trailing "
        "volatility, then same-side capped water-fill.",
        f"- Raw / governed / executed gross; unfunded gross: "
        f"`{construction['rawGross']}` / "
        f"`{construction['governedGross']}` / "
        f"`{construction['executedGross']}`; "
        f"`{construction['unfundedGross']}`",
        f"- Default per-asset cap / covariance risk scale: "
        f"`{construction['maxAbsWeight']}` / "
        f"`{construction['riskGovernorScale']}`",
        "- Effective per-asset caps: "
        + ", ".join(
            f"`{asset}`=`{value}`"
            for asset, value in sorted(
                construction["assetMaxAbsWeights"].items()
            )
        ),
        "- Asset position roles: "
        + ", ".join(
            f"`{asset}`=`{role}`"
            for asset, role in sorted(
                construction["assetPositionRoles"].items()
            )
        ),
        f"- Long / short gross-side limits: "
        f"`{construction['longGrossLimit']}` / "
        f"`{construction['shortGrossLimit']}`",
        f"- Executed component-risk availability / absolute HHI / largest "
        f"contributor: `{component['available']}` / "
        f"`{component['absoluteConcentrationHhi']}` / "
        f"`{component['largestAbsoluteContributor'] or 'none'}`",
    ]
    for side in sizing["sides"]:
        lines.append(
            f"- {side['side'].title()} side: "
            f"`{side['activeAssets']}` active; "
            f"`{side['fundedRawBudget']}` / "
            f"`{side['configuredBudget']}` funded; "
            f"cap capacity `{side['capCapacity']}`; at cap "
            + (
                ", ".join(f"`{asset}`" for asset in side["atCapAssets"])
                if side["atCapAssets"]
                else "none"
            )
            + f"; feasible `{side['allocationFeasible']}`"
        )
    lines.extend(
        [
            f"- Sizing hash: `{support['portfolioSizingAnatomyHash']}`",
            "- Authority: `quantitative-decision-support`; trading authority: "
            "`none`. Diagonal risk budget is a sizing heuristic; component "
            "risk is a covariance decomposition of the historical executed "
            "book. Neither is a live account risk forecast.",
            "",
            "| Asset / side | Score / conviction / trailing vol | "
            "Same-side strength | Proportional → raw | Governor → executed | "
            "Diagonal risk → component risk |",
            "| --- | --- | --- | --- | --- | --- |",
        ]
    )
    for position in sizing["positions"]:
        score = (
            f"P{position['score'] * 100.0:.0f}"
            if position["score"] is not None
            else "unavailable"
        )
        volatility = (
            f"{position['trailingVolatility']:.2%}"
            if position["trailingVolatility"] is not None
            else "unavailable"
        )
        cap_note = (
            " · at cap"
            if position["atCap"]
            else " · proportional exceeded cap"
            if position["proportionalWeightExceedsCap"]
            else ""
        )
        component_risk = (
            f"{position['componentRiskShare']:+.2%}"
            if position["componentRiskAvailable"]
            else "unavailable"
        )
        lines.append(
            f"| `{position['asset']}` / {position['side'].upper()} | "
            f"{score} / `{position['conviction']:.4f}` / {volatility} | "
            f"`{position['riskStrength']:.4f}` "
            f"({position['sameSideStrengthShare']:.2%}) | "
            f"{_signed_percent(position['proportionalWeightBeforeCap'])} → "
            f"{_signed_percent(position['rawWeight'])}{cap_note} | "
            f"{_signed_percent(position['governedWeight'])} → "
            f"{_signed_percent(position['executedWeight'])} | "
            f"{position['diagonalRiskBudgetShare']:+.2%} → "
            f"{component_risk} |"
        )
    lines.append("")
    return lines


def diversification_stress_markdown_lines(
    support: dict[str, Any],
    *,
    heading: str,
    lane_name: str | None = None,
) -> list[str]:
    """Render frozen correlation-crowding and effective-risk-bet evidence."""

    stress = support.get("portfolioDiversificationStress")
    if not isinstance(stress, dict):
        return []
    current = stress["current"]
    prefix = f"{lane_name}: " if lane_name else ""
    scenario_labels = {
        item["id"]: item["label"]
        for item in stress["shock"]["scenarios"]
    }

    def value(number: float | None, suffix: str = "") -> str:
        return (
            "unavailable"
            if number is None
            else f"{number:.4f}{suffix}"
        )

    lines = [
        heading,
        "",
        f"- {prefix}Method / current state / timestamp: "
        f"`{stress['method']}` / `{current['state']}` / "
        f"`{current['timestamp']}`",
        "- Fixed shock ladder: observed covariance is blended 25%, 50%, and "
        "100% toward the perfect position-aligned correlation endpoint that "
        "makes PnL risk reinforce; no probability is assigned.",
        "- Current sample → perfect-correlation annualized volatility / "
        "multiplier: "
        f"`{current['sampleForecastAnnualized']:.4f}` → "
        f"`{current['perfectCorrelationForecastAnnualized']:.4f}` / "
        f"`{value(current['stressMultiplier'])}`",
        "- Current ceiling / upper-bound breach / covariance observations: "
        f"`{value(current['ceilingAnnualized'])}` / "
        f"`{current['stressBreachesCeiling']}` / "
        f"`{current['covarianceObservations']}`",
        "- Current absolute component-risk HHI / effective risk bets / "
        "largest contributor: "
        f"`{value(current['absoluteComponentRiskHhi'])}` / "
        f"`{value(current['effectiveRiskBets'])}` / "
        f"`{current['largestAbsoluteComponentRiskContributor'] or 'none'}`",
        f"- Diversification hash: "
        f"`{support['portfolioDiversificationStressHash']}`",
        "- Authority: `context-only`; validation and visible test do not "
        "enter selection or progression; trading authority: `none`.",
        "",
        "| Current scenario | Blend toward perfect alignment | "
        "Annualized volatility | Multiplier | Ceiling breach |",
        "| --- | --- | --- | --- | --- |",
    ]
    for scenario in current["scenarios"]:
        lines.append(
            f"| `{scenario_labels[scenario['id']]}` | "
            f"`{scenario['blendToPerfectCorrelation']:.0%}` | "
            f"`{scenario['forecastAnnualized']:.4f}` | "
            f"`{value(scenario['multiplier'])}` | "
            f"`{scenario['breachesCeiling']}` |"
        )
    lines.extend(
        [
            "",
        "| Split / role | Available / active / total dates | "
        "Perfect-endpoint breach | Stress multiplier median / p95 / max | "
        "Effective risk bets median / min | Maximum-stress date |",
        "| --- | --- | --- | --- | --- | --- |",
        ]
    )
    for split_name in ("validation", "test"):
        split = stress[split_name]
        maximum = split["maximumStressBook"]
        breach = (
            "unavailable"
            if split["stressBreachRate"] is None
            else (
                f"{split['stressBreachDates']} / "
                f"{split['stressBreachRate']:.2%}"
            )
        )
        lines.append(
            f"| `{split_name}` / `{split['role']}` | "
            f"`{split['availableDates']}` / `{split['activeDates']}` / "
            f"`{split['totalDates']}` | {breach} | "
            f"`{value(split['medianStressMultiplier'])}` / "
            f"`{value(split['p95StressMultiplier'])}` / "
            f"`{value(split['maximumStressMultiplier'])}` | "
            f"`{value(split['medianEffectiveRiskBets'])}` / "
            f"`{value(split['minimumEffectiveRiskBets'])}` | "
            + (
                f"`{maximum['timestamp']}` / "
                f"{value(maximum['stressMultiplier'])}×"
                if maximum is not None
                else "unavailable"
            )
            + " |"
        )
    lines.extend(
        [
            "",
            "| Split / scenario | Ceiling-breach dates / rate | "
            "Multiplier median / p95 / max |",
            "| --- | --- | --- |",
        ]
    )
    for split_name in ("validation", "test"):
        for scenario in stress[split_name]["scenarios"]:
            breach = (
                "unavailable"
                if scenario["stressBreachRate"] is None
                else (
                    f"{scenario['stressBreachDates']} / "
                    f"{scenario['stressBreachRate']:.2%}"
                )
            )
            lines.append(
                f"| `{split_name}` / "
                f"`{scenario_labels[scenario['id']]}` | {breach} | "
                f"`{value(scenario['medianMultiplier'])}` / "
                f"`{value(scenario['p95Multiplier'])}` / "
                f"`{value(scenario['maximumMultiplier'])}` |"
            )
    if current["state"] == "available":
        lines.extend(
            [
                "",
                "| Asset | Executed weight | Causal own vol | "
                "Signed / absolute component risk | "
                "Standalone annualized risk load | Stress-risk share |",
                "| --- | --- | --- | --- | --- | --- |",
            ]
        )
        for position in current["positions"]:
            own_volatility = position["causalOwnVolatility"]
            lines.append(
                f"| `{position['asset']}` | "
                f"{_signed_percent(position['executedWeight'])} | "
                + (
                    f"{own_volatility:.2%}"
                    if own_volatility is not None
                    else "unavailable"
                )
                + " | "
                f"{position['componentRiskShare']:+.2%} / "
                f"{position['absoluteComponentRiskShare']:.2%} | "
                f"{position['standaloneRiskLoadAnnualized']:.2%} | "
                f"{position['stressRiskShare']:.2%} |"
            )
    lines.append("")
    return lines


def strategy_viability_markdown_lines(
    support: dict[str, Any],
    *,
    heading: str,
    lane_name: str | None = None,
) -> list[str]:
    """Render the frozen factor → gross → friction → net diagnosis."""

    viability = support.get("portfolioStrategyViability")
    if not isinstance(viability, dict):
        return []
    diagnosis = viability["diagnosis"]
    prefix = f"{lane_name}: " if lane_name else ""
    lines = [
        heading,
        "",
        f"- {prefix}Validation diagnosis / next research focus: "
        f"`{diagnosis['stage']}` / `{diagnosis['iterationFocus']}`",
        f"- Interpretation: {diagnosis['explanation']}",
        "- Diagnosis authority: `research-prioritization-only`; selection "
        "split: `validation`; test enters diagnosis: `False`; trading "
        "authority: `none`.",
        f"- Viability hash: "
        f"`{support['portfolioStrategyViabilityHash']}`",
        "",
        "| Split / role | Factor rank IC | Gross Sharpe → net Sharpe | "
        "Annual turnover / cost | Break-even cost | Positive months / "
        "max underwater | Without best 5 days |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    for split_name in ("validation", "test"):
        split = viability[split_name]
        friction = split["friction"]
        temporal = split["temporal"]
        break_even = friction["breakEvenCost"]
        break_even_label = (
            f"{break_even['bps']:.2f} bps"
            if break_even["bps"] is not None
            else break_even["status"]
        )
        lines.append(
            f"| {split_name} / `{split['role']}` | "
            f"`{split['factorRankIc']:.4f}` | "
            f"`{split['gross']['sharpe']:.4f}` → "
            f"`{split['net']['sharpe']:.4f}` | "
            f"`{friction['annualizedOneWayTurnover']:.4f}` / "
            f"`{friction['totalCostDrag']:.2%}` | "
            f"{break_even_label} | "
            f"`{temporal['positiveNetMonthRate']:.2%}` / "
            f"`{temporal['maximumUnderwaterBars']}` bars | "
            f"`{temporal['netTotalReturnWithoutBestDays']:.2%}` |"
        )
    validation = viability["validation"]
    stress = ", ".join(
        f"{item['costBps']:.0f} bps → Sharpe {item['netSharpe']:.4f}"
        for item in validation["costStress"]
    )
    delay = validation["extraDelay"]
    lines.extend(
        [
            "",
            f"- Validation cost curve: {stress}.",
            f"- Validation extra-delay Sharpe / delta: "
            f"`{delay['netSharpe']:.4f}` / "
            f"`{delay['netSharpeDelta']:+.4f}`.",
            "- Return-per-turnover is arithmetic return basis points per unit "
            "of one-way portfolio replacement. Break-even cost is charged per "
            "traded notional on the frozen gross path; neither is a fill or "
            "impact estimate.",
            "",
        ]
    )
    return lines


def signal_monetization_markdown_lines(
    support: dict[str, Any],
    *,
    heading: str,
    lane_name: str | None = None,
) -> list[str]:
    """Render the frozen additive signal-to-portfolio transmission bridge."""

    monetization = support.get("portfolioSignalMonetization")
    if not isinstance(monetization, dict):
        return []
    diagnosis = monetization["diagnosis"]
    prefix = f"{lane_name}: " if lane_name else ""
    lines = [
        heading,
        "",
        f"- {prefix}Validation outcome / next research focus: "
        f"`{diagnosis['outcome']}` / `{diagnosis['iterationFocus']}`",
        f"- Largest adverse transformation / annualized additive delta: "
        f"`{diagnosis['largestAdverseStage']}` / "
        f"`{diagnosis['largestAdverseAnnualizedDelta']}`",
        f"- Interpretation: {diagnosis['explanation']}",
        "- Normalized-intent mode / construction: "
        f"`{monetization['semantics']['evaluationMode']}` / "
        f"`{monetization['semantics']['intentConstruction']}`. "
        "Contributions are additive weight × next-bar return, not separately "
        "compounded counterfactual portfolios.",
        "- Diagnosis authority: `research-prioritization-only`; selection "
        "split: `validation`; test enters diagnosis: `False`; trading "
        "authority: `none`.",
        f"- Monetization hash: "
        f"`{support['portfolioSignalMonetizationHash']}`",
        "",
        "| Split / role | Normalized intent | Sized raw | Governed target | "
        "Executed gross | Executed net | No-trade retention |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    for split_name in ("validation", "test"):
        split = monetization[split_name]
        stages = {item["id"]: item for item in split["stages"]}
        coverage = split["coverage"]
        lines.append(
            f"| `{split_name}` / `{split['role']}` | "
            f"{_signed_percent(stages['equalIntent']['annualizedContribution'])} | "
            f"{_signed_percent(stages['preGovernorSizing']['annualizedContribution'])} | "
            f"{_signed_percent(stages['governedTarget']['annualizedContribution'])} | "
            f"{_signed_percent(stages['executedGross']['annualizedContribution'])} | "
            f"{_signed_percent(stages['executedNet']['annualizedContribution'])} | "
            f"`{coverage['noTradeRetentionDates']}` / "
            f"`{coverage['decisionDates']}` dates |"
        )
    lines.extend(
        [
            "",
            "| Validation transformation | Annualized additive delta |",
            "| --- | --- |",
        ]
    )
    for delta in monetization["validation"]["deltas"]:
        lines.append(
            f"| {delta['label']} | "
            f"{_signed_percent(delta['annualizedContributionDelta'])} |"
        )
    lines.append("")
    return lines


def rl_factor_fusion_diagnosis_markdown_lines(
    support: dict[str, Any],
    *,
    heading: str,
    lane_name: str | None = None,
) -> list[str]:
    """Render the frozen candidate-to-adaptive-value diagnosis."""

    fusion = support.get("rlFactorFusionDiagnosis")
    if not isinstance(fusion, dict) or not fusion.get("available"):
        return []
    diagnosis = fusion["diagnosis"]
    validation = fusion["validation"]
    candidate = validation["candidateFactor"]
    transmission = validation["adaptiveTransmission"]
    stability = validation["stability"]
    losses = validation["lossLocator"]
    prefix = f"{lane_name}: " if lane_name else ""
    lines = [
        heading,
        "",
        f"- {prefix}Validation diagnosis / next research focus: "
        f"`{diagnosis['stage']}` / `{diagnosis['iterationFocus']}`",
        f"- Interpretation: {diagnosis['explanation']}",
        f"- Candidate factor assessment: `{candidate['assessment']}`; "
        "fixed-sleeve Sharpe delta versus balanced "
        f"`{candidate['fixedSleeveSharpeDeltaVsBalanced']}`; same-pretrade "
        "one-step reward delta versus balanced "
        f"`{candidate['meanLocalRewardDeltaVsBalanced']}`.",
        "- Candidate selected / locally best / local-best capture: "
        f"`{candidate['selectedFrequency']}` / "
        f"`{candidate['localBestFrequency']}` / "
        f"`{candidate['oracleCaptureRate']}`.",
        "- Validation mean-trial full-path gross edge / incremental cost / "
        "net active return: "
        f"`{transmission['meanTrialGrossActiveReturn']}` / "
        f"`{transmission['meanTrialIncrementalCost']}` / "
        f"`{transmission['meanTrialNetActiveReturn']}`.",
        "- Validation net-Sharpe advantage / information ratio / positive net "
        "trial-path rate: "
        f"`{transmission['meanSharpeAdvantageVsSelectedBaseline']}` / "
        f"`{transmission['informationRatio']}` / "
        f"`{stability['positiveNetTrialRate']}`.",
        "- Worst causal regime / action pair / switch state / asset gross "
        "contributor: "
        f"`{losses['worstRegime']['key']}` / "
        f"`{losses['worstActionPair']['key']}` / "
        f"`{losses['worstSwitchState']['key']}` / "
        f"`{losses['worstAssetGrossContribution']['asset']}`.",
        f"- Fusion diagnosis hash: "
        f"`{support['rlFactorFusionDiagnosisHash']}`",
        "- Local opportunity is a same-pretrade, one-step, ex-post audit. "
        "Adaptive transmission uses independent complete policy paths. "
        "Neither enters training, policy selection, KEEP/REVERT, or trading.",
        "- Authority: `research-prioritization-only`; selection split: "
        "`validation`; test enters diagnosis: `False`; trading authority: "
        "`none`.",
        "",
        "| Split / role | Candidate fixed Δ Sharpe | Candidate local Δ reward "
        "| Gross edge → net active | Sharpe advantage | Positive net trials |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for split_name, key in (
        ("validation", "validation"),
        ("test", "testAudit"),
    ):
        split = fusion[key]
        split_candidate = split["candidateFactor"]
        split_transmission = split["adaptiveTransmission"]
        split_stability = split["stability"]
        lines.append(
            f"| `{split_name}` / `{split['role']}` | "
            f"{split_candidate['fixedSleeveSharpeDeltaVsBalanced']:+.4f} | "
            f"{split_candidate['meanLocalRewardDeltaVsBalanced']:+.6f} | "
            f"{_signed_percent(split_transmission['meanTrialGrossActiveReturn'])} "
            f"→ {_signed_percent(split_transmission['meanTrialNetActiveReturn'])} | "
            f"{split_transmission['meanSharpeAdvantageVsSelectedBaseline']:+.4f} | "
            f"{split_stability['positiveNetTrialRate']:.2%} |"
        )
    lines.append("")
    return lines
