"""Verified evidence-driven experiment briefs for AI research operators."""

from __future__ import annotations

from typing import Any

from .factor_explorer import load_factor_diagnostics
from .portfolio_explorer import load_portfolio_diagnostics
from .rl_explorer import load_rl_diagnostics
from .runs import load_run
from .workspace import SCHEMA_VERSION, ProjectContext


RESEARCH_AGENDA_KIND = "autoquant-evidence-driven-research-agenda"
RESEARCH_AGENDA_METHOD = "verified-lane-diagnostics-to-bounded-moves-v2"
MAX_RESEARCH_MOVES = 3
RESEARCH_AGENDA_MOVE_ROLES = {
    "current-research-guidance",
    "optional-follow-up",
    "unavailable",
}

_OBJECTIVE_LANES = {
    "validation_mean_ic": "factor",
    "validation_net_sharpe": "portfolio",
    "validation_mean_net_sharpe": "rl",
}


def _evidence(
    path: str,
    label: str,
    value: float | None,
    unit: str,
    *,
    role: str = "selection",
) -> dict[str, Any]:
    return {
        "path": path,
        "label": label,
        "value": value,
        "unit": unit,
        "role": role,
    }


def _move(
    *,
    priority: int,
    move_id: str,
    title: str,
    hypothesis: str,
    rationale: str,
    editable_paths: list[str],
    components: list[str] | None,
    evidence_refs: list[dict[str, Any]],
    objective_metric: str,
    required_checks: list[str],
    stop_conditions: list[str],
) -> dict[str, Any]:
    return {
        "priority": priority,
        "id": move_id,
        "title": title,
        "hypothesis": hypothesis,
        "rationale": rationale,
        "target": {
            "editablePaths": list(editable_paths),
            "components": list(components or []),
        },
        "evidenceRefs": evidence_refs,
        "evaluation": {
            "objectiveMetric": objective_metric,
            "selectionSplit": "validation",
            "requiredChecks": required_checks,
            "stopConditions": stop_conditions,
            "testRole": "visible-audit-only",
        },
    }


def _authority(*, has_run: bool) -> dict[str, Any]:
    return {
        "source": (
            "verified-immutable-run"
            if has_run
            else "none"
        ),
        "prioritization": "diagnostic-only",
        "selectionSplit": "validation",
        "testRole": "visible-audit-only",
        "testEntersPrioritization": False,
        "automaticExecution": False,
        "automaticPromotion": False,
        "tradingAuthority": "none",
    }


def _agenda(
    *,
    status: str,
    lane_id: str | None,
    run: dict[str, str] | None,
    diagnosis: dict[str, str] | None,
    moves: list[dict[str, Any]],
    reason: str | None,
) -> dict[str, Any]:
    bounded = moves[:MAX_RESEARCH_MOVES]
    return {
        "schemaVersion": SCHEMA_VERSION,
        "kind": RESEARCH_AGENDA_KIND,
        "method": RESEARCH_AGENDA_METHOD,
        "status": status,
        "reason": reason,
        "laneId": lane_id,
        "run": run,
        "diagnosis": diagnosis,
        "moves": bounded,
        "moveRole": (
            "current-research-guidance"
            if bounded
            else "unavailable"
        ),
        "authority": _authority(has_run=run is not None),
    }


def waiting_research_agenda(
    lane_id: str | None,
    *,
    reason: str = "No current successful verified Run is available.",
) -> dict[str, Any]:
    """Return the explicit no-evidence agenda state."""

    return _agenda(
        status="waiting-evidence",
        lane_id=lane_id,
        run=None,
        diagnosis=None,
        moves=[],
        reason=reason,
    )


def failed_run_research_agenda(
    project: ProjectContext,
    run_id: str,
    *,
    lane_id: str | None,
    disposition: str,
) -> dict[str, Any]:
    """Expose failed immutable evidence without inventing another trial."""

    run = load_run(project, run_id)
    scientific_limit = disposition == "scientific-limit"
    explanation = (
        "The current immutable Run establishes a scientific limit for the "
        "exact fixed Study. Report or inspect that bounded conclusion; a "
        "new hypothesis, route, authority, or dataset is separate work."
        if scientific_limit
        else "The current immutable Run requires repair. Inspect its exact "
        "errors before changing source, fixed authority, or runtime; an "
        "unchanged repeat is not a new research attempt."
    )
    return _agenda(
        status=("scientific-limit" if scientific_limit else "repair-required"),
        lane_id=lane_id,
        run={"id": run.result["id"], "inputHash": run.result["inputHash"]},
        diagnosis={
            "stage": disposition,
            "iterationFocus": (
                "bounded-research-handoff"
                if scientific_limit
                else "failure-inspection-and-repair"
            ),
            "explanation": explanation,
        },
        moves=[],
        reason=explanation,
    )


def descriptive_audit_agenda(
    project: ProjectContext,
    run_id: str,
    *,
    lane_id: str,
    reason: str,
    test_role: str = "lookback-and-rolling-context",
) -> dict[str, Any]:
    """Close a fixed descriptive audit without inventing research moves."""

    run = load_run(project, run_id)
    return {
        **_agenda(
            status="descriptive-audit-complete",
            lane_id=lane_id,
            run={
                "id": run.result["id"],
                "inputHash": run.result["inputHash"],
            },
            diagnosis={
                "stage": "descriptive-audit-complete",
                "iterationFocus": "verified-evidence-review",
                "explanation": reason,
            },
            moves=[],
            reason=reason,
        ),
        "authority": {
            "source": "verified-immutable-run",
            "prioritization": "none",
            "selectionSplit": "none",
            "testRole": test_role,
            "testEntersPrioritization": False,
            "automaticExecution": False,
            "automaticPromotion": False,
            "tradingAuthority": "none",
        },
    }


def _component_by_id(
    components: dict[str, Any],
    component_id: str | None,
) -> dict[str, Any] | None:
    if component_id is None:
        return None
    return next(
        (
            item
            for item in components.get("components", [])
            if item["id"] == component_id
        ),
        None,
    )


def _factor_stage_move(
    diagnostics: dict[str, Any],
    editable_paths: list[str],
    *,
    priority: int,
) -> dict[str, Any]:
    qualification = diagnostics["factorQualification"]
    diagnosis = qualification["diagnosis"]
    validation = qualification["validation"]
    stage = diagnosis["stage"]
    raw_ic = validation["candidate"]["meanRankIc"]
    raw_t = validation["candidate"]["hacTStatistic"]
    residual_ic = validation["styleNeutralCandidate"]["meanRankIc"]
    residual_t = validation["styleNeutralCandidate"]["hacTStatistic"]
    common_evidence = [
        _evidence(
            "/factorQualification/validation/candidate/meanRankIc",
            "Validation raw rank IC",
            raw_ic,
            "rank-ic",
        ),
        _evidence(
            "/factorQualification/validation/candidate/hacTStatistic",
            "Validation raw HAC t-statistic",
            raw_t,
            "t-statistic",
        ),
    ]
    if stage == "raw-predictive-edge-absent":
        title = "Repair the factor sign or forecast timing"
        hypothesis = (
            "One predeclared causal sign and forecast-horizon change produces "
            "positive validation raw rank IC without look-ahead."
        )
        rationale = (
            "The first qualification layer is non-positive, so combination, "
            "Portfolio, and RL complexity are premature."
        )
    elif stage == "raw-statistical-evidence-weak":
        title = "Increase raw effect size with one simpler hypothesis"
        hypothesis = (
            "A simpler candidate centered on one declared behavior raises "
            "validation raw rank IC and its HAC t-statistic above the fixed "
            "diagnostic threshold."
        )
        rationale = (
            "The direction is positive but dependence-aware validation "
            "evidence is still weak."
        )
    elif stage == "style-neutral-edge-absent":
        title = "Build distinct information beyond the dominant style"
        hypothesis = (
            "A candidate centered on one causally distinct component retains "
            "positive validation rank IC after fixed style neutralization."
        )
        rationale = (
            "Raw validation edge disappears after removing the train-selected "
            "dominant style exposure."
        )
        common_evidence.append(
            _evidence(
                "/factorQualification/validation/styleNeutralCandidate/meanRankIc",
                "Validation style-neutral rank IC",
                residual_ic,
                "rank-ic",
            )
        )
    elif stage == "style-neutral-statistical-evidence-weak":
        title = "Strengthen the distinct residual effect"
        hypothesis = (
            "A simplified distinct candidate preserves positive "
            "style-neutral validation IC with dependence-aware evidence."
        )
        rationale = (
            "The residual direction is positive, but its fixed HAC threshold "
            "is not met."
        )
        common_evidence.extend(
            [
                _evidence(
                    "/factorQualification/validation/styleNeutralCandidate/meanRankIc",
                    "Validation style-neutral rank IC",
                    residual_ic,
                    "rank-ic",
                ),
                _evidence(
                    "/factorQualification/validation/styleNeutralCandidate/hacTStatistic",
                    "Validation style-neutral HAC t-statistic",
                    residual_t,
                    "t-statistic",
                ),
            ]
        )
    elif stage == "blend-uplift-absent":
        title = "Test one predeclared factor combination"
        hypothesis = (
            "One fixed candidate combination improves validation rank IC over "
            "the dominant style while retaining positive style-neutral edge."
        )
        rationale = (
            "The candidate is distinct, but the fixed equal-rank blend does "
            "not add validation value over the style baseline."
        )
    else:
        title = "Test temporal robustness without reading the holdout"
        hypothesis = (
            "One causal regime or persistence representation keeps "
            "style-neutral validation rank IC positive in every fixed "
            "chronological fold."
        )
        rationale = (
            "Aggregate residual evidence is positive but at least one fixed "
            "validation fold is non-positive."
        )
    return _move(
        priority=priority,
        move_id=f"factor-{stage}",
        title=title,
        hypothesis=hypothesis,
        rationale=rationale,
        editable_paths=editable_paths,
        components=[],
        evidence_refs=common_evidence,
        objective_metric="validation_mean_ic",
        required_checks=[
            "Pass the bounded deterministic and prefix-causal candidate check.",
            "Improve the formal validation objective versus the current leader.",
            "Reinspect the fixed qualification stage using validation only.",
        ],
        stop_conditions=[
            "Stop if the changed candidate fails causal preflight.",
            "Revert if the formal Judge does not KEEP the candidate.",
            "Do not use visible test-audit movement to rescue the hypothesis.",
        ],
    )


def _factor_external_move(
    diagnostics: dict[str, Any],
) -> dict[str, Any]:
    qualification = diagnostics["factorQualification"]
    validation = qualification["validation"]
    return _move(
        priority=1,
        move_id="factor-freeze-and-external-holdout",
        title="Freeze the factor and test mechanical monetization",
        hypothesis=(
            "The frozen factor retains its qualified edge under fixed "
            "Portfolio mechanics and a fresh external holdout."
        ),
        rationale=(
            "Raw, style-neutral, blend-uplift, and chronological validation "
            "layers are positive; more in-sample factor tuning would spend "
            "selection budget instead of answering the next research question."
        ),
        editable_paths=[],
        components=[],
        evidence_refs=[
            _evidence(
                "/factorQualification/validation/candidate/meanRankIc",
                "Validation raw rank IC",
                validation["candidate"]["meanRankIc"],
                "rank-ic",
            ),
            _evidence(
                "/factorQualification/validation/styleNeutralCandidate/meanRankIc",
                "Validation style-neutral rank IC",
                validation["styleNeutralCandidate"]["meanRankIc"],
                "rank-ic",
            ),
        ],
        objective_metric="validation_mean_ic",
        required_checks=[
            "Do not modify the qualified factor for this move.",
            "Run the fixed Portfolio lane before interpreting RL value.",
            "Obtain a fresh external holdout before a production claim.",
        ],
        stop_conditions=[
            "Return to Factor research only if fixed Portfolio evidence fails to monetize the signal.",
            "Never treat the currently visible test audit as a fresh holdout.",
        ],
    )


def _factor_risk_external_move(
    diagnostics: dict[str, Any],
) -> dict[str, Any]:
    qualification = diagnostics["factorQualification"]
    validation = qualification["validation"]
    return _move(
        priority=1,
        move_id="factor-freeze-risk-forecast-and-external-holdout",
        title="Freeze the risk forecast and test a fresh external holdout",
        hypothesis=(
            "The frozen factor retains positive association with the same "
            "forward realized-volatility outcome on a fresh later sample."
        ),
        rationale=(
            "The fixed validation funnel supports a risk forecast. More "
            "in-sample tuning would spend selection budget, while Portfolio "
            "or RL translation would incorrectly treat risk as expected return."
        ),
        editable_paths=[],
        components=[],
        evidence_refs=[
            _evidence(
                "/factorQualification/validation/candidate/meanRankIc",
                "Validation raw risk-outcome rank IC",
                validation["candidate"]["meanRankIc"],
                "rank-ic",
            ),
            _evidence(
                "/factorQualification/validation/candidate/hacTStatistic",
                "Validation raw HAC t-statistic",
                validation["candidate"]["hacTStatistic"],
                "t-statistic",
            ),
        ],
        objective_metric="validation_mean_ic",
        required_checks=[
            "Do not modify the frozen factor for this move.",
            "Use the identical explicit forward-realized-volatility outcome.",
            "Keep Portfolio, RL, and trading authority absent.",
        ],
        stop_conditions=[
            "Do not use the currently visible test audit as a fresh holdout.",
            "Do not reinterpret high predicted risk as positive expected return.",
        ],
    )


def factor_research_agenda(
    diagnostics: dict[str, Any],
    editable_paths: list[str],
) -> dict[str, Any]:
    """Build deterministic Factor experiment briefs from verified diagnostics."""

    qualification = diagnostics["factorQualification"]
    run = diagnostics["run"]
    if not qualification["available"]:
        return _agenda(
            status="waiting-evidence",
            lane_id="factor",
            run={"id": run["id"], "inputHash": run["inputHash"]},
            diagnosis=None,
            moves=[],
            reason=(
                "The Factor Run predates reconstructable qualification "
                "evidence; create a current Run before prioritizing experiments."
            ),
        )
    diagnosis = qualification["diagnosis"]
    diagnosis_projection = {
        "stage": diagnosis["stage"],
        "iterationFocus": diagnosis["iterationFocus"],
        "explanation": diagnosis["explanation"],
    }
    if diagnosis["stage"] == "risk-forecast-positive":
        return _agenda(
            status="no-further-in-sample-tuning",
            lane_id="factor",
            run={"id": run["id"], "inputHash": run["inputHash"]},
            diagnosis=diagnosis_projection,
            moves=[_factor_risk_external_move(diagnostics)],
            reason=(
                "Qualified future-risk evidence should be frozen and tested "
                "on an external holdout; it has no automatic Portfolio or RL "
                "translation."
            ),
        )
    if diagnosis["qualifiesForPortfolio"] is True:
        return _agenda(
            status="no-further-in-sample-tuning",
            lane_id="factor",
            run={"id": run["id"], "inputHash": run["inputHash"]},
            diagnosis=diagnosis_projection,
            moves=[_factor_external_move(diagnostics)],
            reason=(
                "Qualified validation evidence should advance to mechanical "
                "Portfolio research rather than invite another factor edit."
            ),
        )
    claim = qualification.get("claim")
    if (
        isinstance(claim, dict)
        and claim.get("claim") == "known-style-validation"
        and diagnosis["stage"] == "raw-statistical-evidence-weak"
    ):
        return _agenda(
            status="no-further-in-sample-tuning",
            lane_id="factor",
            run={"id": run["id"], "inputHash": run["inputHash"]},
            diagnosis=diagnosis_projection,
            moves=[_factor_independent_sample_move(diagnostics)],
            reason=(
                "The predeclared known-style implementation is identified, "
                "but dependence-aware validation evidence is weak; freeze "
                "source and obtain genuinely independent evidence."
            ),
        )

    moves: list[dict[str, Any]] = []
    components = diagnostics["factorComponents"]
    temporal_components = (
        components.get("evaluationMode")
        in {"single-asset-temporal", "two-asset-relative-value"}
    )
    component_measure_label = (
        "temporal rank contribution"
        if temporal_components
        else "rank IC"
    )
    component_measure_unit = (
        "rank-correlation-contribution"
        if temporal_components
        else "rank-ic"
    )
    component_diagnosis = (
        components["validationDiagnosis"]
        if components["available"]
        else None
    )
    stage = diagnosis["stage"]

    if component_diagnosis is not None:
        preferred_id = (
            component_diagnosis["strongestRawComponent"]
            if stage
            in {"raw-predictive-edge-absent", "raw-statistical-evidence-weak"}
            else component_diagnosis["strongestResidualComponent"]
        )
        preferred = _component_by_id(components, preferred_id)
        preferred_is_final = (
            preferred is not None
            and preferred.get("compositeAssociation", {})
            .get("validation", {})
            .get("meanAbsoluteRankAssociation")
            is not None
            and preferred["compositeAssociation"]["validation"][
                "meanAbsoluteRankAssociation"
            ]
            >= 0.999
        )
        if preferred is not None and not (
            stage == "raw-statistical-evidence-weak"
            and preferred_is_final
        ):
            use_residual = (
                stage
                not in {
                    "raw-predictive-edge-absent",
                    "raw-statistical-evidence-weak",
                }
                and preferred["validation"]["nearestPeerResidual"] is not None
            )
            evidence_path = (
                "/factorComponents/validationDiagnosis/"
                "strongestResidualMeanIc"
                if use_residual
                else "/factorComponents/validationDiagnosis/"
                "strongestRawMeanIc"
            )
            evidence_value = (
                component_diagnosis["strongestResidualMeanIc"]
                if use_residual
                else component_diagnosis["strongestRawMeanIc"]
            )
            moves.append(
                _move(
                    priority=1,
                    move_id=(
                        "factor-isolate-residual-component"
                        if use_residual
                        else "factor-isolate-raw-component"
                    ),
                    title=f"Center one candidate on {preferred['label']}",
                    hypothesis=preferred["hypothesis"],
                    rationale=(
                        f"{preferred['id']} has the strongest validation "
                        f"{'nearest-peer residual' if use_residual else 'raw'} "
                        "evidence among explicitly declared components. This "
                        "does not claim the declaration reconstructs the final "
                        "factor."
                    ),
                    editable_paths=editable_paths,
                    components=[preferred["id"]],
                    evidence_refs=[
                        _evidence(
                            evidence_path,
                            (
                                "Validation nearest-peer residual "
                                f"{component_measure_label}"
                                if use_residual
                                else "Validation raw component "
                                f"{component_measure_label}"
                            ),
                            evidence_value,
                            component_measure_unit,
                        )
                    ],
                    objective_metric="validation_mean_ic",
                    required_checks=[
                        "Make one candidate change centered on the declared hypothesis.",
                        "Pass bounded component and final-factor prefix causality.",
                        "Judge the final factor with the unchanged validation objective and qualification funnel.",
                    ],
                    stop_conditions=[
                        "Stop if the component becomes nondeterministic, sparse, or look-ahead.",
                        "Revert unless the formal final-factor Judge returns KEEP.",
                        "Do not select the move from visible test-audit evidence.",
                    ],
                )
            )

        removal_id = component_diagnosis[
            "removalMostImprovesFixedBlend"
        ]
        removal_delta = component_diagnosis["bestRemovalDeltaMeanIc"]
        removal = _component_by_id(components, removal_id)
        if (
            stage == "blend-uplift-absent"
            and removal is not None
            and removal_delta is not None
            and removal_delta > 0
        ):
            moves.append(
                _move(
                    priority=len(moves) + 1,
                    move_id="factor-challenge-fixed-blend-inclusion",
                    title=f"Challenge {removal['label']} in a new candidate",
                    hypothesis=(
                        f"A newly declared candidate that excludes or "
                        f"downweights {removal['id']} improves the formal "
                        "validation objective."
                    ),
                    rationale=(
                        "Removing this component improves only the fixed "
                        "equal-rank diagnostic blend. It is not an ablation of "
                        "arbitrary compute_factor(...) and must be retested as "
                        "a complete candidate."
                    ),
                    editable_paths=editable_paths,
                    components=[removal["id"]],
                    evidence_refs=[
                        _evidence(
                            "/factorComponents/validationDiagnosis/"
                            "bestRemovalDeltaMeanIc",
                            "Validation fixed-blend removal delta",
                            removal_delta,
                            "rank-ic-delta",
                        )
                    ],
                    objective_metric="validation_mean_ic",
                    required_checks=[
                        "Predeclare one exclusion or weight change; do not search several variants.",
                        "Evaluate the complete final factor with the unchanged Judge.",
                        "Reinspect raw, style-neutral, and chronological validation evidence.",
                    ],
                    stop_conditions=[
                        "Stop if the formal candidate fails to beat the current leader.",
                        "Do not describe the prior diagnostic blend delta as final-factor causality.",
                        "Do not use visible test-audit movement to choose a weight.",
                    ],
                )
            )

        redundant = component_diagnosis["mostRedundantPair"]
        if (
            stage
            in {
                "style-neutral-edge-absent",
                "style-neutral-statistical-evidence-weak",
                "blend-uplift-absent",
            }
            and
            redundant is not None
            and redundant["trainMeanAbsoluteRankAssociation"] >= 0.8
        ):
            moves.append(
                _move(
                    priority=len(moves) + 1,
                    move_id="factor-orthogonalize-redundant-components",
                    title=(
                        f"Separate {redundant['left']} from "
                        f"{redundant['right']}"
                    ),
                    hypothesis=(
                        "One predeclared causal residual representation or one "
                        "representative component improves validation "
                        "style-neutral evidence versus carrying both raw."
                    ),
                    rationale=(
                        "The pair has high target-free train rank association; "
                        "train identifies redundancy while validation must "
                        "judge the new factor."
                    ),
                    editable_paths=editable_paths,
                    components=[redundant["left"], redundant["right"]],
                    evidence_refs=[
                        _evidence(
                            "/factorComponents/validationDiagnosis/"
                            "mostRedundantPair/"
                            "trainMeanAbsoluteRankAssociation",
                            "Train mean absolute rank association",
                            redundant[
                                "trainMeanAbsoluteRankAssociation"
                            ],
                            "rank-association",
                            role="train-context",
                        )
                    ],
                    objective_metric="validation_mean_ic",
                    required_checks=[
                        "Choose one residual or representative rule before evaluation.",
                        (
                            "Keep the transformation causal and within-split."
                            if temporal_components
                            else "Keep the transformation causal and same-timestamp."
                        ),
                        "Use validation, never train association, for the formal verdict.",
                    ],
                    stop_conditions=[
                        "Stop if redundancy falls only because coverage collapses.",
                        "Revert unless final-factor validation evidence improves.",
                        "Do not tune the residual rule on visible test audit.",
                    ],
                )
            )

        primary_horizon = diagnostics.get("researchHorizon", {}).get(
            "primaryForwardBars",
            1,
        )
        context_candidates: list[tuple[float, int, dict[str, Any], dict[str, float]]] = []
        for index, component in enumerate(components["components"]):
            if component.get("role") != "timestamp-context":
                continue
            context = component.get("validation", {}).get("context")
            if not isinstance(context, dict):
                continue
            profile = next(
                (
                    row
                    for row in context.get(
                        "conditionalFactorHorizonProfile",
                        [],
                    )
                    if row.get("horizon") == primary_horizon
                ),
                None,
            )
            if not isinstance(profile, dict):
                continue
            state_ics = {
                state: profile.get(state, {}).get("meanRankIc")
                for state in ("low", "middle", "high")
                if profile.get(state, {}).get("meanRankIc") is not None
            }
            if len(state_ics) < 2:
                continue
            gap = max(state_ics.values()) - min(state_ics.values())
            context_candidates.append(
                (float(gap), index, component, state_ics)
            )
        if (
            stage
            in {
                "residual-temporal-instability",
                "known-style-temporal-instability",
            }
            and context_candidates
        ):
            gap, index, context_component, state_ics = max(
                context_candidates,
                key=lambda item: (item[0], item[2]["id"]),
            )
            if gap > 0.0:
                strongest_state = max(state_ics, key=state_ics.get)
                weakest_state = min(state_ics, key=state_ics.get)
                conditional_label = (
                    "conditional temporal rank-contribution range"
                    if temporal_components
                    else "conditional factor-IC range"
                )
                context_move = _move(
                        priority=min(
                            len(moves) + 1,
                            MAX_RESEARCH_MOVES,
                        ),
                        move_id="factor-test-context-interaction",
                        title=(
                            "Test one fixed interaction with "
                            f"{context_component['label']}"
                        ),
                        hypothesis=(
                            f"The complete candidate preserves more next-bar "
                            f"rank information in `{strongest_state}` than "
                            f"`{weakest_state}` "
                            f"{context_component['id']} states, and one "
                            "predeclared causal interaction improves the "
                            "unchanged validation objective."
                        ),
                        rationale=(
                            "Train-only tertiles fix the context states and "
                            "validation shows the largest declared conditional "
                            f"{conditional_label} ({gap:+.4f}). This is a regime "
                            "hypothesis, not a standalone predictive score or "
                            "permission to tune state thresholds."
                        ),
                        editable_paths=editable_paths,
                        components=[context_component["id"]],
                        evidence_refs=[
                            _evidence(
                                f"/factorComponents/components/{index}/"
                                "validation/context/"
                                "conditionalFactorHorizonProfile",
                                f"Validation {conditional_label}",
                                gap,
                                (
                                    "rank-correlation-contribution-range"
                                    if temporal_components
                                    else "rank-ic-range"
                                ),
                            )
                        ],
                        objective_metric="validation_mean_ic",
                        required_checks=[
                            "Predeclare one causal interaction using the existing context value.",
                            "Keep the fixed train-tertile thresholds unchanged.",
                            "Judge the complete final factor on the unchanged validation objective.",
                        ],
                        stop_conditions=[
                            "Stop if context varies across assets at one timestamp.",
                            "Stop if the apparent range is supported by fewer than two finite states.",
                            "Do not choose or tune the interaction from visible test-audit evidence.",
                        ],
                    )
                if len(moves) >= MAX_RESEARCH_MOVES:
                    moves[-1] = context_move
                else:
                    moves.append(context_move)

    if not moves:
        moves.append(
            _factor_stage_move(
                diagnostics,
                editable_paths,
                priority=1,
            )
        )
    return _agenda(
        status="available",
        lane_id="factor",
        run={"id": run["id"], "inputHash": run["inputHash"]},
        diagnosis=diagnosis_projection,
        moves=moves,
        reason=None,
    )


def _factor_independent_sample_move(
    diagnostics: dict[str, Any],
) -> dict[str, Any]:
    qualification = diagnostics["factorQualification"]
    validation = qualification["validation"]
    return _move(
        priority=1,
        move_id="factor-freeze-and-independent-sample",
        title="Freeze the known style and obtain independent evidence",
        hypothesis=(
            "The request-predeclared known style retains positive raw rank "
            "information with dependence-aware support in a genuinely new "
            "period or independently versioned dataset."
        ),
        rationale=(
            "The candidate already matches the request-predeclared style, and "
            "both validation folds are positive, but aggregate HAC evidence "
            "is below the fixed threshold. Editing this implementation or "
            "adding blend/context complexity would change the question or "
            "spend more in-sample selection budget."
        ),
        editable_paths=[],
        components=[],
        evidence_refs=[
            _evidence(
                "/factorQualification/validation/candidate/meanRankIc",
                "Validation raw rank IC",
                validation["candidate"]["meanRankIc"],
                "rank-ic",
            ),
            _evidence(
                "/factorQualification/validation/candidate/hacTStatistic",
                "Validation raw HAC t-statistic",
                validation["candidate"]["hacTStatistic"],
                "t-statistic",
            ),
        ],
        objective_metric="validation_mean_ic",
        required_checks=[
            "Keep the current candidate source and request-bound claim unchanged.",
            "Create a new intake/Study identity for a fresh period or independent dataset.",
            "Apply the same raw HAC and chronological-fold contract without using the current test audit for selection.",
        ],
        stop_conditions=[
            "Do not relabel the known style as a novel factor.",
            "Do not tune the candidate, context thresholds, or horizon on current validation/test evidence.",
            "Do not advance to Portfolio while the Core-owned claim gate remains blocked.",
        ],
    )


def _portfolio_external_move(
    diagnostics: dict[str, Any],
) -> dict[str, Any]:
    viability = diagnostics["strategyViability"]["validation"]
    return _move(
        priority=1,
        move_id="portfolio-freeze-and-external-holdout",
        title="Freeze the mechanical strategy and challenge it out of sample",
        hypothesis=(
            "The frozen signal and fixed Portfolio mechanics retain positive "
            "post-cost performance under fresh external data and declared "
            "capacity constraints."
        ),
        rationale=(
            "Validation factor, gross, and post-cost layers are positive; "
            "further in-sample signal tuning spends selection budget."
        ),
        editable_paths=[],
        components=[],
        evidence_refs=[
            _evidence(
                "/strategyViability/validation/factorRankIc",
                "Validation factor rank IC",
                viability["factorRankIc"],
                "rank-ic",
            ),
            _evidence(
                "/strategyViability/validation/net/sharpe",
                "Validation net Sharpe",
                viability["net"]["sharpe"],
                "sharpe",
            ),
        ],
        objective_metric="validation_net_sharpe",
        required_checks=[
            "Keep factor source and fixed Portfolio mechanics unchanged.",
            "Obtain a fresh external holdout before a production claim.",
            "Recheck temporal, parameter, diversification, and capacity evidence.",
        ],
        stop_conditions=[
            "Return to factor research if external rank IC fails.",
            "Return to transmission research if gross or net monetization fails.",
            "Never relabel the current visible test audit as fresh evidence.",
        ],
    )


def portfolio_research_agenda(
    diagnostics: dict[str, Any],
    editable_paths: list[str],
) -> dict[str, Any]:
    """Build factor-only moves that respond to verified Portfolio evidence."""

    run = diagnostics["run"]
    viability = diagnostics["strategyViability"]
    monetization = diagnostics["signalMonetization"]
    translation_robustness = diagnostics.get("translationRobustness")
    diagnosis = viability["diagnosis"]
    monetization_diagnosis = monetization["diagnosis"]
    diagnosis_projection = {
        "stage": diagnosis["stage"],
        "iterationFocus": diagnosis["iterationFocus"],
        "explanation": diagnosis["explanation"],
    }
    translation_diagnosis = (
        translation_robustness.get("diagnosis")
        if isinstance(translation_robustness, dict)
        and translation_robustness.get("applicable") is True
        else None
    )
    if (
        isinstance(translation_diagnosis, dict)
        and translation_diagnosis.get("status")
        == "translation-sensitive-target-path"
    ):
        move = _move(
            priority=1,
            move_id="portfolio-stabilize-temporal-factor-representation",
            title="Stabilize the causal temporal factor representation",
            hypothesis=(
                "One predeclared causal factor representation preserves its "
                "validation signal states and target direction across the fixed "
                "40/60/120 history-window stress without changing the production "
                "60/20 translation contract."
            ),
            rationale=(
                "The current target path changes materially across nearby fixed "
                "causal history windows. The response is to improve the Factor's "
                "temporal representation, not select the best stress window."
            ),
            editable_paths=editable_paths,
            components=[],
            evidence_refs=[
                _evidence(
                    "/translationRobustness/diagnosis/"
                    "minimumActiveStateAgreementRate",
                    "Minimum active-state agreement across fixed windows",
                    translation_diagnosis[
                        "minimumActiveStateAgreementRate"
                    ],
                    "rate",
                ),
                _evidence(
                    "/translationRobustness/diagnosis/"
                    "maximumMeanAbsoluteTargetDelta",
                    "Maximum mean absolute target-weight delta",
                    translation_diagnosis[
                        "maximumMeanAbsoluteTargetDelta"
                    ],
                    "weight",
                ),
            ],
            objective_metric="validation_net_sharpe",
            required_checks=[
                "Change only the declared factor closure.",
                "Keep the ordinary 60/20 target translation and Portfolio Mandate fixed.",
                "Use all 40/60/120 profiles as context; do not select or promote a stress window.",
                "Pass bounded factor causality before formal Portfolio evaluation.",
            ],
            stop_conditions=[
                "Stop if validation target-path stability does not improve under the fixed thresholds.",
                "Revert unless the formal Portfolio Judge returns KEEP.",
                "Do not use visible test audit or the best window for selection.",
            ],
        )
        return _agenda(
            status="available",
            lane_id="portfolio",
            run={"id": run["id"], "inputHash": run["inputHash"]},
            diagnosis=diagnosis_projection,
            moves=[move],
            reason=(
                "Validation target translation is locally sensitive; repair the "
                "causal Factor representation before freezing or attributing the "
                "60-bar target path as structurally robust."
            ),
        )
    if diagnosis["stage"] == "post-cost-edge-positive":
        return _agenda(
            status="no-further-in-sample-tuning",
            lane_id="portfolio",
            run={"id": run["id"], "inputHash": run["inputHash"]},
            diagnosis=diagnosis_projection,
            moves=[_portfolio_external_move(diagnostics)],
            reason=(
                "Positive post-cost validation evidence should be frozen for "
                "external holdout and capacity research."
            ),
        )

    outcome = monetization_diagnosis["outcome"]
    adverse = monetization_diagnosis["largestAdverseStage"]
    factor_ic = viability["validation"]["factorRankIc"]
    gross_sharpe = viability["validation"]["gross"]["sharpe"]
    net_sharpe = viability["validation"]["net"]["sharpe"]
    if outcome == "signal-intent-negative":
        move_id = "portfolio-repair-signal-intent"
        title = "Repair signal direction, separation, or breadth"
        hypothesis = (
            "One causal factor representation produces positive normalized "
            "signal-intent contribution under the fixed Mandate and thresholds."
        )
        rationale = (
            "The failure occurs before sizing, risk, execution, and cost, so "
            "fixed Portfolio mechanics are not the first demonstrated cause."
        )
    elif adverse in {"tradingCost", "executionRetention"}:
        move_id = "portfolio-increase-signal-persistence"
        title = "Increase causal signal persistence under fixed execution"
        hypothesis = (
            "One predeclared causal smoothing or persistence feature reduces "
            "rank churn enough to preserve positive validation net Sharpe "
            "under the existing no-trade band and costs."
        )
        rationale = (
            "Positive upstream intent or gross performance is being lost at "
            "execution retention or trading cost. The fixed mechanics remain "
            "evaluation pressure, not editable parameters."
        )
    elif adverse == "riskGovernor":
        move_id = "portfolio-reduce-factor-crowding"
        title = "Reduce factor crowding under the fixed risk ceiling"
        hypothesis = (
            "A broader, less correlated factor ranking retains prediction "
            "while requiring less one-sided risk-governor scale-down."
        )
        rationale = (
            "Risk governance is the largest adverse transmission layer; the "
            "valid response is a different signal covariance structure, not a "
            "looser request-bound volatility ceiling."
        )
    elif adverse == "sizingAndCaps":
        move_id = "portfolio-improve-cross-sectional-breadth"
        title = "Improve cross-sectional breadth under fixed caps"
        hypothesis = (
            "A more differentiated factor ranking monetizes across more "
            "Mandate-permitted assets under the existing caps and "
            "inverse-volatility sizing."
        )
        rationale = (
            "Sizing and caps remove the most normalized signal contribution; "
            "the experiment must improve the signal that enters those fixed "
            "rules rather than edit them."
        )
    elif diagnosis["stage"] == "cost-fragile":
        move_id = "portfolio-increase-signal-persistence"
        title = "Increase causal signal persistence under fixed execution"
        hypothesis = (
            "One predeclared causal smoothing or persistence feature reduces "
            "rank churn enough to preserve positive validation net Sharpe "
            "under the existing no-trade band and costs."
        )
        rationale = (
            "Gross validation performance is positive but post-cost "
            "performance is non-positive. The fixed mechanics remain "
            "evaluation pressure, not editable parameters."
        )
    else:
        move_id = "portfolio-improve-mechanical-transmission"
        title = "Improve rank separation under fixed mechanical triggers"
        hypothesis = (
            "A factor with more persistent cross-sectional separation turns "
            "positive validation IC into positive gross Portfolio Sharpe under "
            "the unchanged state machine and sizing rules."
        )
        rationale = (
            "The factor predicts cross-sectionally but does not survive the "
            "fixed conversion from ranks to constrained target weights."
        )
    move = _move(
        priority=1,
        move_id=move_id,
        title=title,
        hypothesis=hypothesis,
        rationale=rationale,
        editable_paths=editable_paths,
        components=[],
        evidence_refs=[
            _evidence(
                "/strategyViability/validation/factorRankIc",
                "Validation factor rank IC",
                factor_ic,
                "rank-ic",
            ),
            _evidence(
                "/strategyViability/validation/gross/sharpe",
                "Validation gross Sharpe",
                gross_sharpe,
                "sharpe",
            ),
            _evidence(
                "/strategyViability/validation/net/sharpe",
                "Validation net Sharpe",
                net_sharpe,
                "sharpe",
            ),
            _evidence(
                "/signalMonetization/diagnosis/"
                "largestAdverseAnnualizedDelta",
                "Largest adverse annualized transmission delta",
                monetization_diagnosis[
                    "largestAdverseAnnualizedDelta"
                ],
                "annualized-return-delta",
            ),
        ],
        objective_metric="validation_net_sharpe",
        required_checks=[
            "Change only the declared factor closure.",
            "Pass bounded factor causality before formal Portfolio evaluation.",
            "Improve validation net Sharpe under unchanged Mandate, sizing, risk, execution, and cost rules.",
        ],
        stop_conditions=[
            "Stop if predictive rank IC is lost while reducing implementation pressure.",
            "Revert unless the formal Portfolio Judge returns KEEP.",
            "Do not tune fixed mechanics or use visible test audit for selection.",
        ],
    )
    return _agenda(
        status="available",
        lane_id="portfolio",
        run={"id": run["id"], "inputHash": run["inputHash"]},
        diagnosis=diagnosis_projection,
        moves=[move],
        reason=None,
    )


def _rl_external_move(
    diagnostics: dict[str, Any],
) -> dict[str, Any]:
    validation = diagnostics["factorFusionDiagnosis"]["validation"]
    transmission = validation["adaptiveTransmission"]
    return _move(
        priority=1,
        move_id="rl-freeze-and-external-holdout",
        title="Freeze the encoder and challenge adaptive value externally",
        hypothesis=(
            "The frozen encoder retains positive post-cost adaptive value and "
            "seed/fold breadth on fresh external data under the same governed "
            "action set."
        ),
        rationale=(
            "Validation gross, net, risk-adjusted, and trial-breadth evidence "
            "is positive; more in-sample encoder tuning would spend selection "
            "budget."
        ),
        editable_paths=[],
        components=[],
        evidence_refs=[
            _evidence(
                "/factorFusionDiagnosis/validation/adaptiveTransmission/"
                "meanTrialNetActiveReturn",
                "Validation mean trial net active return",
                transmission["meanTrialNetActiveReturn"],
                "return",
            ),
            _evidence(
                "/factorFusionDiagnosis/validation/adaptiveTransmission/"
                "meanSharpeAdvantageVsSelectedBaseline",
                "Validation mean Sharpe advantage",
                transmission[
                    "meanSharpeAdvantageVsSelectedBaseline"
                ],
                "sharpe-delta",
            ),
        ],
        objective_metric="validation_mean_net_sharpe",
        required_checks=[
            "Keep encoder, fixed factors, action sleeves, and learning contract unchanged.",
            "Obtain a fresh external holdout before a production claim.",
            "Recheck seed/fold stability, turnover cost, active risk, and capacity.",
        ],
        stop_conditions=[
            "Return to encoder research if fresh trial breadth or net adaptive value fails.",
            "Never use the current visible test audit as fresh evidence.",
        ],
    )


def rl_research_agenda(
    diagnostics: dict[str, Any],
    editable_paths: list[str],
) -> dict[str, Any]:
    """Build encoder-only moves from verified governed-RL evidence."""

    run = diagnostics["run"]
    fusion = diagnostics["factorFusionDiagnosis"]
    if not fusion["available"]:
        return _agenda(
            status="waiting-evidence",
            lane_id="rl",
            run={"id": run["id"], "inputHash": run["inputHash"]},
            diagnosis=None,
            moves=[],
            reason=(
                "The RL Run lacks reconstructable candidate-factor fusion "
                "evidence; create a current governed Run first."
            ),
        )
    diagnosis = fusion["diagnosis"]
    diagnosis_projection = {
        "stage": diagnosis["stage"],
        "iterationFocus": diagnosis["iterationFocus"],
        "explanation": diagnosis["explanation"],
    }
    if diagnosis["stage"] == "adaptive-value-positive":
        return _agenda(
            status="no-further-in-sample-tuning",
            lane_id="rl",
            run={"id": run["id"], "inputHash": run["inputHash"]},
            diagnosis=diagnosis_projection,
            moves=[_rl_external_move(diagnostics)],
            reason=(
                "Positive adaptive validation evidence should be frozen for "
                "external holdout and capacity research."
            ),
        )
    validation = fusion["validation"]
    transmission = validation["adaptiveTransmission"]
    stability = validation["stability"]
    stage = diagnosis["stage"]
    if stage == "adaptive-book-selection-negative":
        move_id = "rl-improve-causal-state-capture"
        title = "Improve causal state capture for fixed sleeve choice"
        hypothesis = (
            "One bounded causal state field distinguishes when the candidate "
            "or another fixed sleeve has train-supported advantage, improving "
            "validation gross active return."
        )
        rationale = (
            "Adaptive book selection is negative before incremental cost, so "
            "implementation is not the first demonstrated failure."
        )
    elif stage == "implementation-cost-destroys-edge":
        move_id = "rl-increase-switch-persistence"
        title = "Increase switch persistence without changing actions"
        hypothesis = (
            "A bounded encoder using previous action and target-distance "
            "context preserves gross selection edge while reducing "
            "incremental switching cost."
        )
        rationale = (
            "Validation adaptive gross edge is positive but incremental "
            "implementation cost destroys net active return."
        )
    elif stage == "risk-adjusted-adaptive-value-absent":
        move_id = "rl-control-active-risk"
        title = "Encode pretrade active-risk context"
        hypothesis = (
            "A bounded encoder using pretrade exposure, concentration, or "
            "volatility context improves validation Sharpe advantage without "
            "altering fixed sleeve targets."
        )
        rationale = (
            "Net active return is positive but risk-adjusted advantage versus "
            "the selected mechanical baseline is absent."
        )
    else:
        move_id = "rl-simplify-train-only-learning"
        title = "Simplify the encoder for seed/fold stability"
        hypothesis = (
            "A smaller bounded state representation with fewer interactions "
            "retains positive validation net active return across at least "
            "half of fixed seed/fold trials."
        )
        rationale = (
            "Aggregate adaptive evidence is positive but the fixed trial "
            "breadth threshold is not met."
        )
    move = _move(
        priority=1,
        move_id=move_id,
        title=title,
        hypothesis=hypothesis,
        rationale=rationale,
        editable_paths=editable_paths,
        components=[],
        evidence_refs=[
            _evidence(
                "/factorFusionDiagnosis/validation/adaptiveTransmission/"
                "meanTrialGrossActiveReturn",
                "Validation mean trial gross active return",
                transmission["meanTrialGrossActiveReturn"],
                "return",
            ),
            _evidence(
                "/factorFusionDiagnosis/validation/adaptiveTransmission/"
                "meanTrialNetActiveReturn",
                "Validation mean trial net active return",
                transmission["meanTrialNetActiveReturn"],
                "return",
            ),
            _evidence(
                "/factorFusionDiagnosis/validation/adaptiveTransmission/"
                "meanSharpeAdvantageVsSelectedBaseline",
                "Validation mean Sharpe advantage",
                transmission[
                    "meanSharpeAdvantageVsSelectedBaseline"
                ],
                "sharpe-delta",
            ),
            _evidence(
                "/factorFusionDiagnosis/validation/stability/"
                "positiveNetTrialRate",
                "Validation positive-net trial rate",
                stability["positiveNetTrialRate"],
                "fraction",
            ),
        ],
        objective_metric="validation_mean_net_sharpe",
        required_checks=[
            "Change only models/** and preserve the pure bounded encoder API.",
            "Keep factors, action sleeves, rewards, learning rules, Mandate, and Portfolio mechanics fixed.",
            "Judge mean validation net Sharpe and inspect fixed seed/fold breadth.",
        ],
        stop_conditions=[
            "Stop if any declared seed/fold fails or the encoder becomes nondeterministic.",
            "Revert unless the formal governed-RL Judge returns KEEP.",
            "Do not select features from test audit or ex-post local best actions.",
        ],
    )
    return _agenda(
        status="available",
        lane_id="rl",
        run={"id": run["id"], "inputHash": run["inputHash"]},
        diagnosis=diagnosis_projection,
        moves=[move],
        reason=None,
    )


def build_research_agenda(
    project: ProjectContext,
    run_id: str | None,
    *,
    lane_id: str | None,
    editable_paths: list[str],
) -> dict[str, Any]:
    """Load verified Run evidence and dispatch to one bounded lane recipe."""

    if run_id is None:
        return waiting_research_agenda(lane_id)
    run = load_run(project, run_id)
    if run.result["status"] != "succeeded":
        return waiting_research_agenda(
            lane_id,
            reason=(
                "The latest Run did not succeed; no scientific agenda can be "
                "derived from incomplete evidence."
            ),
        )
    metric = run.result["objective"]["metric"]
    canonical_lane = _OBJECTIVE_LANES.get(metric)
    run_projection = {
        "id": run.result["id"],
        "inputHash": run.result["inputHash"],
    }
    if canonical_lane is None:
        return _agenda(
            status="unsupported-study",
            lane_id=lane_id,
            run=run_projection,
            diagnosis=None,
            moves=[],
            reason=(
                f"Objective metric {metric} has no evidence-driven agenda "
                "recipe."
            ),
        )
    if lane_id is not None and lane_id != canonical_lane:
        return _agenda(
            status="unsupported-study",
            lane_id=lane_id,
            run=run_projection,
            diagnosis=None,
            moves=[],
            reason=(
                f"Focus lane {lane_id} does not match verified objective "
                f"{metric}."
            ),
        )
    if canonical_lane == "factor":
        return factor_research_agenda(
            load_factor_diagnostics(project, run_id),
            editable_paths,
        )
    if canonical_lane == "portfolio":
        return portfolio_research_agenda(
            load_portfolio_diagnostics(project, run_id),
            editable_paths,
        )
    return rl_research_agenda(
        load_rl_diagnostics(project, run_id),
        editable_paths,
    )


EVIDENCE_REF_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["path", "label", "value", "unit", "role"],
    "properties": {
        "path": {"type": "string", "pattern": "^/"},
        "label": {"type": "string", "minLength": 1},
        "value": {"type": ["number", "null"]},
        "unit": {"type": "string", "minLength": 1},
        "role": {"enum": ["selection", "train-context"]},
    },
}

RESEARCH_MOVE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "priority",
        "id",
        "title",
        "hypothesis",
        "rationale",
        "target",
        "evidenceRefs",
        "evaluation",
    ],
    "properties": {
        "priority": {"type": "integer", "minimum": 1, "maximum": 3},
        "id": {"type": "string", "minLength": 1},
        "title": {"type": "string", "minLength": 1},
        "hypothesis": {"type": "string", "minLength": 1},
        "rationale": {"type": "string", "minLength": 1},
        "target": {
            "type": "object",
            "additionalProperties": False,
            "required": ["editablePaths", "components"],
            "properties": {
                "editablePaths": {
                    "type": "array",
                    "uniqueItems": True,
                    "items": {"type": "string", "minLength": 1},
                },
                "components": {
                    "type": "array",
                    "uniqueItems": True,
                    "items": {"type": "string", "minLength": 1},
                },
            },
        },
        "evidenceRefs": {
            "type": "array",
            "minItems": 1,
            "items": EVIDENCE_REF_SCHEMA,
        },
        "evaluation": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "objectiveMetric",
                "selectionSplit",
                "requiredChecks",
                "stopConditions",
                "testRole",
            ],
            "properties": {
                "objectiveMetric": {"type": "string", "minLength": 1},
                "selectionSplit": {"const": "validation"},
                "requiredChecks": {
                    "type": "array",
                    "minItems": 1,
                    "items": {"type": "string", "minLength": 1},
                },
                "stopConditions": {
                    "type": "array",
                    "minItems": 1,
                    "items": {"type": "string", "minLength": 1},
                },
                "testRole": {"const": "visible-audit-only"},
            },
        },
    },
}

RESEARCH_AGENDA_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "schemaVersion",
        "kind",
        "method",
        "status",
        "reason",
        "laneId",
        "run",
        "diagnosis",
        "moves",
        "moveRole",
        "authority",
    ],
    "properties": {
        "schemaVersion": {"const": SCHEMA_VERSION},
        "kind": {"const": RESEARCH_AGENDA_KIND},
        "method": {"const": RESEARCH_AGENDA_METHOD},
        "status": {
            "enum": [
                "available",
                "waiting-evidence",
                "unsupported-study",
                "no-further-in-sample-tuning",
                "descriptive-audit-complete",
                "scientific-limit",
                "repair-required",
            ]
        },
        "reason": {"type": ["string", "null"]},
        "laneId": {"type": ["string", "null"]},
        "run": {
            "oneOf": [
                {"type": "null"},
                {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["id", "inputHash"],
                    "properties": {
                        "id": {"type": "string", "minLength": 1},
                        "inputHash": {"type": "string", "minLength": 1},
                    },
                },
            ]
        },
        "diagnosis": {
            "oneOf": [
                {"type": "null"},
                {
                    "type": "object",
                    "additionalProperties": False,
                    "required": [
                        "stage",
                        "iterationFocus",
                        "explanation",
                    ],
                    "properties": {
                        "stage": {"type": "string", "minLength": 1},
                        "iterationFocus": {
                            "type": "string",
                            "minLength": 1,
                        },
                        "explanation": {"type": "string", "minLength": 1},
                    },
                },
            ]
        },
        "moves": {
            "type": "array",
            "maxItems": MAX_RESEARCH_MOVES,
            "items": RESEARCH_MOVE_SCHEMA,
        },
        "moveRole": {
            "enum": sorted(RESEARCH_AGENDA_MOVE_ROLES),
        },
        "authority": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "source",
                "prioritization",
                "selectionSplit",
                "testRole",
                "testEntersPrioritization",
                "automaticExecution",
                "automaticPromotion",
                "tradingAuthority",
            ],
            "properties": {
                "source": {
                    "enum": ["verified-immutable-run", "none"]
                },
                "prioritization": {
                    "enum": ["diagnostic-only", "none"]
                },
                "selectionSplit": {
                    "enum": ["validation", "none"]
                },
                "testRole": {
                    "enum": [
                        "visible-audit-only",
                        "lookback-and-rolling-context",
                    ]
                },
                "testEntersPrioritization": {"const": False},
                "automaticExecution": {"const": False},
                "automaticPromotion": {"const": False},
                "tradingAuthority": {"const": "none"},
            },
        },
    },
    "allOf": [
        {
            "if": {
                "properties": {
                    "status": {"const": "descriptive-audit-complete"}
                },
                "required": ["status"],
            },
            "then": {
                "properties": {
                    "run": {"type": "object"},
                    "diagnosis": {"type": "object"},
                    "moves": {"maxItems": 0},
                    "moveRole": {"const": "unavailable"},
                    "authority": {
                        "properties": {
                            "source": {
                                "const": "verified-immutable-run"
                            },
                            "prioritization": {"const": "none"},
                            "selectionSplit": {"const": "none"},
                            "testRole": {
                                "const": "lookback-and-rolling-context"
                            },
                        }
                    },
                }
            },
        },
        {
            "if": {
                "properties": {
                    "status": {
                        "enum": [
                            "available",
                            "no-further-in-sample-tuning",
                        ]
                    }
                },
                "required": ["status"],
            },
            "then": {
                "properties": {
                    "run": {"type": "object"},
                    "diagnosis": {"type": "object"},
                    "moves": {"minItems": 1},
                    "moveRole": {
                        "enum": [
                            "current-research-guidance",
                            "optional-follow-up",
                        ]
                    },
                }
            },
        },
        {
            "if": {
                "properties": {
                    "status": {
                        "enum": [
                            "waiting-evidence",
                            "unsupported-study",
                        ]
                    }
                },
                "required": ["status"],
            },
            "then": {
                "properties": {
                    "moves": {"maxItems": 0},
                    "moveRole": {"const": "unavailable"},
                }
            },
        },
    ],
}
