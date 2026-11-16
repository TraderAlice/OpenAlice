"""Verified orchestration status for one canonical multi-Study Project."""

from __future__ import annotations

import json
import shlex
from pathlib import Path
from typing import Any

from .factor_explorer import load_factor_diagnostics
from .intake import PROJECT_REQUEST, load_project_intake
from .portfolio_explorer import load_portfolio_diagnostics
from .reports import list_reports
from .run_reports import list_run_reports
from .runs import list_runs, load_run, run_failure_disposition
from .sessions import list_sessions, load_session
from .studies import hash_json, load_study
from .workspace import (
    SCHEMA_VERSION,
    AutoQuantValidationError,
    ProjectContext,
    ValidationIssue,
)


RESEARCH_PROGRAM_MANIFEST = "research-program.json"
RESEARCH_PROGRAM_KIND = "autoquant-research-program"
RESEARCH_PROGRAM_STATUS_KIND = "autoquant-research-program-status"
RESEARCH_PROGRAM_ID = "factor-portfolio-rl"
RESEARCH_DESK_TEMPLATE = "ohlcv-research-desk"
RESEARCH_PROGRESSION_METHOD = (
    "report-bound-factor-portfolio-rl-admission-v1"
)
FACTOR_CLAIM_POSITIVE = "factor-claim-positive"
PORTFOLIO_VIABILITY_POSITIVE = "post-cost-edge-positive"
CANONICAL_LANES: tuple[dict[str, Any], ...] = (
    {
        "id": "factor",
        "name": "Factor quality",
        "studyId": "ohlcv-factor-quality",
        "role": "causal-predictive-evidence",
        "dependsOn": [],
        "editablePaths": ["factors/**"],
        "dependencyPaths": [
            "strategies/factor-claim.json",
            "strategies/factor-population.json",
            "strategies/research-horizon.json",
        ],
        "optional": False,
    },
    {
        "id": "portfolio",
        "name": "Portfolio implementation",
        "studyId": "ohlcv-portfolio-quality",
        "role": "mechanical-portfolio-evidence",
        "dependsOn": ["factor"],
        "editablePaths": ["factors/**"],
        "dependencyPaths": [
            "strategies/factor-claim.json",
            "strategies/factor-population.json",
            "strategies/portfolio-mandate.json",
            "strategies/research-horizon.json",
        ],
        "optional": False,
    },
    {
        "id": "rl",
        "name": "Governed RL value-add",
        "studyId": "ohlcv-rl-factor-policy",
        "role": "adaptive-policy-challenge",
        "dependsOn": ["portfolio"],
        "editablePaths": ["models/**"],
        "dependencyPaths": [
            "factors/**",
            "strategies/factor-claim.json",
            "strategies/factor-population.json",
            "strategies/portfolio-mandate.json",
            "strategies/research-horizon.json",
        ],
        "optional": True,
    },
)
INTEGRATION = {
    "factorToPortfolio": "shared-candidate-source",
    "rlFactorDependency": "content-locked-candidate-source",
    "portfolioMandate": "request-bound-shared-fixed-dependency",
    "factorPredictionUniverse": (
        "caller-owned-factor-population-fixed-dependency"
    ),
    "researchHorizon": "request-bound-shared-fixed-dependency",
    "factorClaim": "request-bound-factor-evaluation-authority",
    "tradingAuthority": "none",
}


def _issue(path: Path | str, code: str, message: str) -> ValidationIssue:
    return ValidationIssue(str(path), code, message)


def _fail(path: Path | str, code: str, message: str) -> None:
    raise AutoQuantValidationError([_issue(path, code, message)])


def _strict_keys(
    value: dict[str, Any],
    required: set[str],
    path: Path | str,
) -> list[ValidationIssue]:
    return [
        *(
            _issue(f"{path}/{key}", "schema.missing", f"Missing required field '{key}'")
            for key in sorted(required - value.keys())
        ),
        *(
            _issue(f"{path}/{key}", "schema.unknown", f"Unknown field '{key}'")
            for key in sorted(value.keys() - required)
        ),
    ]


def _read_object(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        _fail(
            path,
            "research-program.missing",
            "Project does not declare a multi-Study research program",
        )
    except (UnicodeDecodeError, json.JSONDecodeError):
        _fail(
            path,
            "research-program.json",
            "Research program must be one UTF-8 JSON object",
        )
    if not isinstance(value, dict):
        _fail(path, "research-program.type", "Research program must be an object")
    return value


def canonical_research_program_manifest() -> dict[str, Any]:
    return {
        "schemaVersion": SCHEMA_VERSION,
        "kind": RESEARCH_PROGRAM_KIND,
        "id": RESEARCH_PROGRAM_ID,
        "template": RESEARCH_DESK_TEMPLATE,
        "lanes": [dict(lane) for lane in CANONICAL_LANES],
        "integration": dict(INTEGRATION),
    }


def create_research_program_manifest(project: ProjectContext) -> Path:
    path = project.root_dir / RESEARCH_PROGRAM_MANIFEST
    if path.exists():
        _fail(
            path,
            "research-program.exists",
            "Research program manifest already exists",
        )
    path.write_text(
        json.dumps(
            canonical_research_program_manifest(),
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )
    return path


def _validate_manifest(value: dict[str, Any], path: Path) -> dict[str, Any]:
    required = {
        "schemaVersion",
        "kind",
        "id",
        "template",
        "lanes",
        "integration",
    }
    issues = _strict_keys(value, required, path)
    if value.get("schemaVersion") != SCHEMA_VERSION:
        issues.append(
            _issue(f"{path}/schemaVersion", "schema.version", "Expected V1")
        )
    if value.get("kind") != RESEARCH_PROGRAM_KIND:
        issues.append(
            _issue(
                f"{path}/kind",
                "research-program.kind",
                f"Expected {RESEARCH_PROGRAM_KIND}",
            )
        )
    if value.get("id") != RESEARCH_PROGRAM_ID:
        issues.append(
            _issue(
                f"{path}/id",
                "research-program.id",
                f"Expected canonical id {RESEARCH_PROGRAM_ID}",
            )
        )
    if value.get("template") != RESEARCH_DESK_TEMPLATE:
        issues.append(
            _issue(
                f"{path}/template",
                "research-program.template",
                f"Expected {RESEARCH_DESK_TEMPLATE}",
            )
        )
    lanes = value.get("lanes")
    canonical_lanes = [dict(lane) for lane in CANONICAL_LANES]
    if lanes != canonical_lanes:
        issues.append(
            _issue(
                f"{path}/lanes",
                "research-program.lanes",
                "Research program lanes differ from the canonical contract",
            )
        )
    if value.get("integration") != INTEGRATION:
        issues.append(
            _issue(
                f"{path}/integration",
                "research-program.integration",
                "Research program integration boundary differs from the canonical contract",
            )
        )
    if issues:
        raise AutoQuantValidationError(issues)
    return value


def _command(
    command_id: str,
    description: str,
    argv: list[str],
    effect: str,
) -> dict[str, Any]:
    return {
        "id": command_id,
        "description": description,
        "argv": argv,
        "display": shlex.join(argv),
        "effect": effect,
    }


def _current_report(lane: dict[str, Any]) -> dict[str, Any] | None:
    run = lane["latestRun"]
    reportable_scientific_limit = (
        lane.get("currentAttempt") is True
        and run is not None
        and run["status"] == "failed"
        and run.get("failureDisposition") == "scientific-limit"
    )
    if (not lane["currentRun"] and not reportable_scientific_limit) or run is None:
        return None
    return next(
        (
            report
            for report in reversed(lane["reports"])
            if report["leaderRunId"] == run["id"]
        ),
        None,
    )


def _gate(
    *,
    gate_id: str,
    upstream_lane_id: str,
    downstream_lane_id: str,
    required_stage: str,
    status: str,
    run_id: str | None,
    report_id: str | None,
    diagnosis_stage: str | None,
    iteration_focus: str,
    explanation: str,
) -> dict[str, Any]:
    return {
        "id": gate_id,
        "upstreamLaneId": upstream_lane_id,
        "downstreamLaneId": downstream_lane_id,
        "requiredStage": required_stage,
        "status": status,
        "runId": run_id,
        "reportId": report_id,
        "diagnosisStage": diagnosis_stage,
        "iterationFocus": iteration_focus,
        "explanation": explanation,
        "selectionSplit": "validation",
        "testEntersGate": False,
        "authority": "research-prioritization-only",
        "tradingAuthority": "none",
    }


def _factor_to_portfolio_gate(
    project: ProjectContext,
    lane: dict[str, Any],
) -> dict[str, Any]:
    run = lane["latestRun"]
    if (
        lane.get("currentAttempt")
        and run is not None
        and run["status"] == "failed"
    ):
        scientific_limit = run["failureDisposition"] == "scientific-limit"
        return _gate(
            gate_id="factor-to-portfolio",
            upstream_lane_id="factor",
            downstream_lane_id="portfolio",
            required_stage=FACTOR_CLAIM_POSITIVE,
            status=(
                "blocked-scientific-limit"
                if scientific_limit
                else "blocked-failed-evidence"
            ),
            run_id=run["id"],
            report_id=(
                _current_report(lane)["id"]
                if _current_report(lane) is not None
                else None
            ),
            diagnosis_stage=run["failureDisposition"],
            iteration_focus=(
                "bounded-research-handoff"
                if scientific_limit
                else "failure-inspection-and-repair"
            ),
            explanation=(
                "The current Factor Run establishes a scientific limit for "
                "the exact fixed Study; report that conclusion, but do not "
                "admit Portfolio research as if the Factor qualified."
                if scientific_limit
                else "The current Factor Run requires inspection or repair "
                "and cannot admit downstream Portfolio research."
            ),
        )
    if not lane["currentRun"] or run is None:
        return _gate(
            gate_id="factor-to-portfolio",
            upstream_lane_id="factor",
            downstream_lane_id="portfolio",
            required_stage=FACTOR_CLAIM_POSITIVE,
            status="waiting-current-evidence",
            run_id=run["id"] if run is not None else None,
            report_id=None,
            diagnosis_stage=None,
            iteration_focus="candidate-hypothesis-and-timing",
            explanation=(
                "Portfolio research waits for one current successful Factor "
                "Run with reconstructable qualification evidence."
            ),
        )
    diagnostics = load_factor_diagnostics(
        project,
        run["id"],
        point_limit=40,
    )
    qualification = diagnostics["factorQualification"]
    if not qualification["available"]:
        return _gate(
            gate_id="factor-to-portfolio",
            upstream_lane_id="factor",
            downstream_lane_id="portfolio",
            required_stage=FACTOR_CLAIM_POSITIVE,
            status="blocked-legacy-evidence",
            run_id=run["id"],
            report_id=None,
            diagnosis_stage=None,
            iteration_focus="candidate-hypothesis-and-timing",
            explanation=(
                "The current Factor Run predates reconstructable qualification "
                "evidence; create a current Run before downstream research."
            ),
        )
    diagnosis = qualification["diagnosis"]
    if diagnosis["qualifiesForPortfolio"] is not True:
        return _gate(
            gate_id="factor-to-portfolio",
            upstream_lane_id="factor",
            downstream_lane_id="portfolio",
            required_stage=FACTOR_CLAIM_POSITIVE,
            status="blocked-upstream-evidence",
            run_id=run["id"],
            report_id=None,
            diagnosis_stage=diagnosis["stage"],
            iteration_focus=diagnosis["iterationFocus"],
            explanation=diagnosis["explanation"],
        )
    report = _current_report(lane)
    if report is None:
        return _gate(
            gate_id="factor-to-portfolio",
            upstream_lane_id="factor",
            downstream_lane_id="portfolio",
            required_stage=FACTOR_CLAIM_POSITIVE,
            status="waiting-current-report",
            run_id=run["id"],
            report_id=None,
            diagnosis_stage=diagnosis["stage"],
            iteration_focus="factor-report-and-handoff",
            explanation=(
                "Factor qualification is positive, but Portfolio admission "
                "waits for an immutable Report freezing this exact leader Run."
            ),
        )
    adjustment = report["selectionIntegrity"].get(
        "selectionAdjustment"
    )
    if (
        not isinstance(adjustment, dict)
        or adjustment.get("status") != "available"
        or adjustment.get("passes") is not True
    ):
        return _gate(
            gate_id="factor-to-portfolio",
            upstream_lane_id="factor",
            downstream_lane_id="portfolio",
            required_stage=FACTOR_CLAIM_POSITIVE,
            status="blocked-selection-adjusted-evidence",
            run_id=run["id"],
            report_id=report["id"],
            diagnosis_stage=diagnosis["stage"],
            iteration_focus="independent-sample-and-effect-size",
            explanation=(
                "The current Factor claim passes its fixed validation funnel, "
                "but the Report's Project-family selection adjustment does "
                "not pass at 95%; use independent evidence before Portfolio."
            ),
        )
    return _gate(
        gate_id="factor-to-portfolio",
        upstream_lane_id="factor",
        downstream_lane_id="portfolio",
        required_stage=FACTOR_CLAIM_POSITIVE,
        status="passed",
        run_id=run["id"],
        report_id=report["id"],
        diagnosis_stage=diagnosis["stage"],
        iteration_focus="portfolio-monetization",
        explanation=(
            "The current reported Factor leader passes its declared claim "
            "and Project-family selection adjustment, admitting bounded "
            "mechanical Portfolio research."
        ),
    )


def _portfolio_to_rl_gate(
    project: ProjectContext,
    lane: dict[str, Any],
    factor_gate: dict[str, Any],
) -> dict[str, Any]:
    run = lane["latestRun"]
    if factor_gate["status"] != "passed":
        return _gate(
            gate_id="portfolio-to-rl",
            upstream_lane_id="portfolio",
            downstream_lane_id="rl",
            required_stage=PORTFOLIO_VIABILITY_POSITIVE,
            status="blocked-prerequisite",
            run_id=run["id"] if run is not None else None,
            report_id=None,
            diagnosis_stage=None,
            iteration_focus=factor_gate["iterationFocus"],
            explanation=(
                "Governed RL remains locked until the Factor-to-Portfolio "
                "evidence and Report gate passes."
            ),
        )
    if (
        lane.get("currentAttempt")
        and run is not None
        and run["status"] == "failed"
    ):
        scientific_limit = run["failureDisposition"] == "scientific-limit"
        return _gate(
            gate_id="portfolio-to-rl",
            upstream_lane_id="portfolio",
            downstream_lane_id="rl",
            required_stage=PORTFOLIO_VIABILITY_POSITIVE,
            status=(
                "blocked-scientific-limit"
                if scientific_limit
                else "blocked-failed-evidence"
            ),
            run_id=run["id"],
            report_id=(
                _current_report(lane)["id"]
                if _current_report(lane) is not None
                else None
            ),
            diagnosis_stage=run["failureDisposition"],
            iteration_focus=(
                "bounded-research-handoff"
                if scientific_limit
                else "failure-inspection-and-repair"
            ),
            explanation=(
                "The current Portfolio Run establishes a scientific limit for "
                "the exact fixed Study and cannot admit governed RL."
                if scientific_limit
                else "The current Portfolio Run requires inspection or repair "
                "and cannot admit governed RL."
            ),
        )
    if not lane["currentRun"] or run is None:
        return _gate(
            gate_id="portfolio-to-rl",
            upstream_lane_id="portfolio",
            downstream_lane_id="rl",
            required_stage=PORTFOLIO_VIABILITY_POSITIVE,
            status="waiting-current-evidence",
            run_id=run["id"] if run is not None else None,
            report_id=None,
            diagnosis_stage=None,
            iteration_focus="signal-to-portfolio",
            explanation=(
                "Governed RL waits for one current successful Portfolio Run "
                "that reconstructs post-cost mechanical viability."
            ),
        )
    diagnostics = load_portfolio_diagnostics(
        project,
        run["id"],
        point_limit=40,
    )
    diagnosis = diagnostics["strategyViability"]["diagnosis"]
    if diagnosis["stage"] != PORTFOLIO_VIABILITY_POSITIVE:
        return _gate(
            gate_id="portfolio-to-rl",
            upstream_lane_id="portfolio",
            downstream_lane_id="rl",
            required_stage=PORTFOLIO_VIABILITY_POSITIVE,
            status="blocked-upstream-evidence",
            run_id=run["id"],
            report_id=None,
            diagnosis_stage=diagnosis["stage"],
            iteration_focus=diagnosis["iterationFocus"],
            explanation=diagnosis["explanation"],
        )
    report = _current_report(lane)
    if report is None:
        return _gate(
            gate_id="portfolio-to-rl",
            upstream_lane_id="portfolio",
            downstream_lane_id="rl",
            required_stage=PORTFOLIO_VIABILITY_POSITIVE,
            status="waiting-current-report",
            run_id=run["id"],
            report_id=None,
            diagnosis_stage=diagnosis["stage"],
            iteration_focus="portfolio-report-and-handoff",
            explanation=(
                "Post-cost Portfolio viability is positive, but optional RL "
                "admission waits for a Report freezing this exact leader Run."
            ),
        )
    return _gate(
        gate_id="portfolio-to-rl",
        upstream_lane_id="portfolio",
        downstream_lane_id="rl",
        required_stage=PORTFOLIO_VIABILITY_POSITIVE,
        status="passed",
        run_id=run["id"],
        report_id=report["id"],
        diagnosis_stage=diagnosis["stage"],
        iteration_focus="optional-adaptive-value-challenge",
        explanation=(
            "The current reported mechanical Portfolio leader has positive "
            "post-cost validation evidence; governed RL is admitted as an "
            "optional challenge against that simpler policy."
        ),
    )


def _research_progression(
    project: ProjectContext,
    lane_by_id: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    factor_gate = _factor_to_portfolio_gate(project, lane_by_id["factor"])
    portfolio_gate = _portfolio_to_rl_gate(
        project,
        lane_by_id["portfolio"],
        factor_gate,
    )
    rl_lane = lane_by_id["rl"]
    if factor_gate["status"] != "passed":
        stage = "factor-evidence-required"
        focus_lane_id = "factor"
        explanation = factor_gate["explanation"]
        optional_lane_id = None
    elif portfolio_gate["status"] != "passed":
        stage = "portfolio-evidence-required"
        focus_lane_id = "portfolio"
        explanation = portfolio_gate["explanation"]
        optional_lane_id = None
    elif (
        rl_lane["latestSession"] is not None
        and rl_lane["latestSession"]["status"] == "active"
    ) or (
        rl_lane["currentRun"]
        and not bool(_current_report(rl_lane))
    ):
        stage = "optional-rl-in-progress"
        focus_lane_id = "rl"
        explanation = (
            "Required Factor and Portfolio research is complete. Finish the "
            "already-started optional governed RL challenge and freeze its "
            "result without allowing it to rewrite the simpler evidence."
        )
        optional_lane_id = "rl"
    else:
        stage = "required-research-complete"
        focus_lane_id = None
        explanation = (
            "Reported Factor qualification and positive post-cost Portfolio "
            "evidence complete the required research chain. Governed RL is "
            "admitted but optional; OpenAlice may consume the required-lane "
            "Dossier without running it."
        )
        optional_lane_id = "rl"
    return {
        "method": RESEARCH_PROGRESSION_METHOD,
        "stage": stage,
        "focusLaneId": focus_lane_id,
        "optionalLaneId": optional_lane_id,
        "explanation": explanation,
        "gates": [factor_gate, portfolio_gate],
        "selectionSplit": "validation",
        "testEntersProgression": False,
        "authority": "research-prioritization-only",
        "tradingAuthority": "none",
    }


def _run_summary(project: ProjectContext, run_id: str) -> dict[str, Any]:
    run = load_run(project, run_id)
    metric = run.result["objective"]["metric"]
    value = run.result["metrics"].get(metric)
    return {
        "id": run.result["id"],
        "status": run.result["status"],
        "failureDisposition": run_failure_disposition(run.result),
        "summary": run.result["summary"],
        "errors": run.result["errors"],
        "studyInputHash": run.result["studyInputHash"],
        "sourceHash": run.result["subject"]["sourceHash"],
        "metric": metric,
        "value": (
            float(value)
            if isinstance(value, (int, float)) and not isinstance(value, bool)
            else None
        ),
        "startedAt": run.result["startedAt"],
        "completedAt": run.result["completedAt"],
    }


def _lane_state(
    project: ProjectContext,
    lane: dict[str, Any],
    *,
    request_path: Path | None,
) -> dict[str, Any]:
    study = load_study(project, lane["studyId"])
    if study.definition.editable["paths"] != lane["editablePaths"]:
        _fail(
            study.manifest_path,
            "research-program.editable",
            f"{lane['id']} Study editable paths differ from program declaration",
        )
    dependency_paths = (
        study.definition.dependencies["paths"]
        if study.definition.dependencies is not None
        else []
    )
    if dependency_paths != lane["dependencyPaths"]:
        _fail(
            study.manifest_path,
            "research-program.dependencies",
            f"{lane['id']} Study dependency paths differ from program declaration",
        )
    run_summaries = list_runs(project, lane["studyId"])
    latest_run = None
    latest_attempt = None
    for summary in reversed(run_summaries):
        candidate = _run_summary(project, summary.id)
        if latest_attempt is None:
            latest_attempt = candidate
        if candidate["studyInputHash"] == study.input_hash:
            latest_run = candidate
            break
    if latest_run is None:
        latest_run = latest_attempt
    sessions = [
        item
        for item in list_sessions(project)
        if item.study_id == lane["studyId"]
    ]
    latest_session = sessions[-1] if sessions else None
    reports: list[dict[str, Any]] = []
    if latest_session is not None:
        session = load_session(project, latest_session.id)
        reports.extend(
            item.to_dict() for item in list_reports(project, session)
        )
    else:
        reports.extend(
            item.to_dict()
            for item in list_run_reports(project, lane["studyId"])
        )
    reports.sort(key=lambda item: (item["publishedAt"], item["id"]))
    current_attempt = (
        latest_run is not None
        and latest_run["studyInputHash"] == study.input_hash
    )
    current_run = current_attempt and latest_run["status"] == "succeeded"
    current_report = _current_report(
        {
            "latestRun": latest_run,
            "currentAttempt": current_attempt,
            "currentRun": current_run,
            "reports": reports,
        }
    )
    if latest_run is not None and not current_attempt:
        phase = "stale"
    elif current_attempt and latest_run["status"] == "failed":
        phase = latest_run["failureDisposition"]
    elif current_report is not None:
        phase = "reported"
    elif latest_session is not None and latest_session.status == "active":
        phase = "researching"
    elif latest_run is not None:
        phase = "baseline-ready"
    else:
        phase = "not-started"

    commands = [
        _command(
            "study.inspect",
            f"Inspect fixed authority for {lane['name']}.",
            [
                "aq",
                "study",
                "inspect",
                str(project.root_dir),
                "--study",
                lane["studyId"],
                "--json",
            ],
            "read-only",
        )
    ]
    if latest_run is None or not current_attempt:
        if not lane["editablePaths"]:
            commands.append(
                _command(
                    "run.execute",
                    f"Create current immutable baseline evidence for {lane['name']}.",
                    [
                        "aq",
                        "run",
                        "execute",
                        str(project.root_dir),
                        "--study",
                        lane["studyId"],
                        "--json",
                    ],
                    "creates-artifact",
                )
            )
    elif latest_run["status"] == "failed":
        commands.append(
            _command(
                "run.show",
                f"Inspect the current failed Run for {lane['name']} before any repair or changed research route.",
                [
                    "aq",
                    "run",
                    "show",
                    str(project.root_dir),
                    "--run",
                    latest_run["id"],
                    "--json",
                ],
                "read-only",
            )
        )
        if (
            latest_run["failureDisposition"] == "scientific-limit"
            and current_report is None
        ):
            commands.append(
                _command(
                    "report.publish",
                    f"Publish the bounded scientific-limit conclusion for {lane['name']}.",
                    [
                        "aq",
                        "report",
                        "publish",
                        str(project.root_dir),
                        "--study",
                        lane["studyId"],
                        "--run",
                        latest_run["id"],
                        "--analysis",
                        "report-analysis.json",
                        "--json",
                    ],
                    "creates-artifact",
                )
            )
        elif current_report is not None:
            commands.append(
                _command(
                    "report.show",
                    f"Inspect the reported scientific limit for {lane['name']}.",
                    [
                        "aq",
                        "report",
                        "show",
                        str(project.root_dir),
                        "--report",
                        current_report["id"],
                        "--json",
                    ],
                    "read-only",
                )
            )
    elif current_report is None:
        commands.append(
            _command(
                "report.publish",
                f"Publish analysis over the current immutable Run for {lane['name']} without creating a Session.",
                [
                    "aq",
                    "report",
                    "publish",
                    str(project.root_dir),
                    "--study",
                    lane["studyId"],
                    "--run",
                    latest_run["id"],
                    "--analysis",
                    "report-analysis.json",
                    "--json",
                ],
                "creates-artifact",
            )
        )
    start_argv = [
        "aq",
        "session",
        "start",
        str(project.root_dir),
        "--study",
        lane["studyId"],
    ]
    if request_path is not None:
        start_argv.extend(["--request", str(request_path)])
    start_argv.append("--json")
    start_command = _command(
        "session.start",
        f"Start governed delegated research for {lane['name']}.",
        start_argv,
        "creates-artifact",
    )
    if latest_session is None:
        if lane["editablePaths"] and (
            latest_run is None
            or not current_attempt
            or latest_run["status"] == "succeeded"
        ):
            commands.append(start_command)
    else:
        commands.append(
            _command(
                "session.show",
                f"Inspect current Session evidence for {lane['name']}.",
                [
                    "aq",
                    "session",
                    "show",
                    str(project.root_dir),
                    "--session",
                    latest_session.id,
                    "--json",
                ],
                "read-only",
            )
        )
        if reports:
            commands.append(
                _command(
                    "report.show",
                    f"Inspect the latest immutable Report for {lane['name']}.",
                    [
                        "aq",
                        "report",
                        "show",
                        str(project.root_dir),
                        "--session",
                        latest_session.id,
                        "--report",
                        reports[-1]["id"],
                        "--json",
                    ],
                    "read-only",
                )
            )
            if (
                latest_session.status == "active"
                and latest_session.baseline_run_id
                == latest_session.leader_run_id
                and reports[-1]["leaderRunId"]
                == latest_session.leader_run_id
            ):
                commands.append(
                    _command(
                        "session.complete",
                        f"Complete baseline-retaining research for {lane['name']}.",
                        [
                            "aq",
                            "session",
                            "complete",
                            str(project.root_dir),
                            "--session",
                            latest_session.id,
                            "--report",
                            reports[-1]["id"],
                            "--json",
                        ],
                        "creates-artifact",
                    )
                )
        if latest_session.status != "active":
            commands.append(start_command)
    return {
        **lane,
        "phase": phase,
        "study": {
            "id": study.definition.id,
            "name": study.definition.name,
            "description": study.definition.description,
            "inputHash": study.input_hash,
            "sourceHash": study.source_hash,
            "sourceHashes": study.editable_hashes,
            "dependencyHash": study.dependency_hash,
            "dependencySourceHashes": study.dependency_hashes,
            "datasetHash": study.dataset_hash,
            "objective": {
                "metric": study.definition.objective.metric,
                "direction": study.definition.objective.direction,
                "minimumImprovement": (
                    study.definition.objective.minimum_improvement
                ),
            },
            "dataset": {
                "id": study.definition.dataset.id,
                "version": study.definition.dataset.version,
                "assetClass": study.definition.dataset.asset_class,
                "universe": study.definition.dataset.universe,
                "timeRange": {
                    "start": study.definition.dataset.time_range.start,
                    "end": study.definition.dataset.time_range.end,
                },
            },
        },
        "latestRun": latest_run,
        "currentAttempt": current_attempt,
        "currentRun": current_run,
        "latestSession": (
            latest_session.to_dict() if latest_session is not None else None
        ),
        "reports": reports,
        "commands": commands,
    }


def load_research_program(
    project: ProjectContext,
    *,
    optional: bool = False,
) -> dict[str, Any] | None:
    """Verify and project the canonical multi-Study research program."""

    path = project.root_dir / RESEARCH_PROGRAM_MANIFEST
    if optional and not path.exists():
        return None
    manifest = _validate_manifest(_read_object(path), path)
    intake = load_project_intake(project)
    request_path = (
        project.root_dir / PROJECT_REQUEST
        if intake is not None
        else None
    )
    lanes = [
        _lane_state(project, lane, request_path=request_path)
        for lane in manifest["lanes"]
    ]
    dataset_hashes = {lane["study"]["datasetHash"] for lane in lanes}
    dataset_contracts = {
        json.dumps(lane["study"]["dataset"], sort_keys=True)
        for lane in lanes
    }
    if len(dataset_hashes) != 1 or len(dataset_contracts) != 1:
        _fail(
            path,
            "research-program.dataset",
            "Every research-program Study must bind the same dataset contract and bytes",
        )
    lane_by_id = {lane["id"]: lane for lane in lanes}
    factor_study = lane_by_id["factor"]["study"]
    portfolio_study = lane_by_id["portfolio"]["study"]
    rl_study = lane_by_id["rl"]["study"]
    if (
        factor_study["sourceHash"] != portfolio_study["sourceHash"]
        or factor_study["sourceHashes"] != portfolio_study["sourceHashes"]
    ):
        _fail(
            path,
            "research-program.factor-source",
            "Factor and Portfolio lanes must share the exact candidate factor source",
        )
    rl_factor_hashes = {
        path: digest
        for path, digest in rl_study["dependencySourceHashes"].items()
        if path.startswith("factors/")
    }
    if (
        hash_json(rl_factor_hashes) != factor_study["sourceHash"]
        or rl_factor_hashes != factor_study["sourceHashes"]
    ):
        _fail(
            path,
            "research-program.rl-factor-dependency",
            "RL dependency identity must equal the current Factor source identity",
        )

    progression = _research_progression(project, lane_by_id)

    active_by_path: dict[str, list[dict[str, str]]] = {}
    for lane in lanes:
        session = lane["latestSession"]
        if session is None or session["status"] != "active":
            continue
        for editable in lane["editablePaths"]:
            active_by_path.setdefault(editable, []).append(
                {"laneId": lane["id"], "sessionId": session["id"]}
            )
    conflicts = [
        {
            "kind": "writer-writer",
            "editablePath": editable,
            "sessions": sessions,
            "message": (
                "Concurrent active Sessions share one editable source surface; "
                "promotion order is ambiguous."
            ),
        }
        for editable, sessions in sorted(active_by_path.items())
        if len(sessions) > 1
    ]
    active_lanes = [
        lane
        for lane in lanes
        if lane["latestSession"] is not None
        and lane["latestSession"]["status"] == "active"
    ]
    reader_conflicts: dict[str, dict[str, dict[str, str]]] = {}
    for writer in active_lanes:
        writer_files = set(writer["study"]["sourceHashes"])
        writer_session = writer["latestSession"]
        for reader in active_lanes:
            if writer["id"] == reader["id"]:
                continue
            shared = writer_files & set(
                reader["study"]["dependencySourceHashes"]
            )
            for relative in shared:
                sessions = reader_conflicts.setdefault(relative, {})
                sessions[writer_session["id"]] = {
                    "laneId": writer["id"],
                    "sessionId": writer_session["id"],
                    "access": "writer",
                }
                reader_session = reader["latestSession"]
                sessions[reader_session["id"]] = {
                    "laneId": reader["id"],
                    "sessionId": reader_session["id"],
                    "access": "reader",
                }
    conflicts.extend(
        {
            "kind": "writer-reader",
            "editablePath": relative,
            "sessions": list(sessions.values()),
            "message": (
                "An active writer Session can change a factor pinned by an "
                "active reader Session; start a fresh reader Session after promotion."
            ),
        }
        for relative, sessions in sorted(reader_conflicts.items())
    )

    completion_lane = next(
        (
            lane
            for lane in lanes
            if any(
                command["id"] == "session.complete"
                for command in lane["commands"]
            )
        ),
        None,
    )
    recommended_lane = completion_lane
    if recommended_lane is None and progression["focusLaneId"] is not None:
        recommended_lane = lane_by_id[progression["focusLaneId"]]
    recommended_action = None
    if recommended_lane is not None:
        preferred_ids = (
            ("session.complete", "report.show", "session.show")
            if completion_lane is not None
            else (
                "report.publish",
                "report.show",
                "run.show",
                "study.inspect",
            )
            if recommended_lane["phase"] == "scientific-limit"
            else ("run.show", "study.inspect")
            if recommended_lane["phase"] == "repair-required"
            else (
                ("session.start", "run.execute", "session.show", "study.inspect")
                if recommended_lane["phase"] in {"not-started", "stale"}
                else (
                    "session.start",
                    "session.show",
                    "run.execute",
                    "study.inspect",
                )
            )
        )
        for command_id in preferred_ids:
            recommended_action = next(
                (
                    command
                    for command in recommended_lane["commands"]
                    if command["id"] == command_id
                ),
                None,
            )
            if recommended_action is not None:
                break

    phases = {
        phase: sum(lane["phase"] == phase for lane in lanes)
        for phase in (
            "not-started",
            "baseline-ready",
            "researching",
            "reported",
            "stale",
            "scientific-limit",
            "repair-required",
        )
    }
    warnings = [
        (
            "The governed RL lane pins the current factors/** source closure. "
            "After factor promotion, create fresh RL evidence or a new RL Session."
        )
    ]
    warnings.extend(conflict["message"] for conflict in conflicts)
    return {
        "schemaVersion": SCHEMA_VERSION,
        "kind": RESEARCH_PROGRAM_STATUS_KIND,
        "manifest": manifest,
        "project": {
            "id": project.manifest.id,
            "name": project.manifest.name,
            "rootDir": str(project.root_dir),
        },
        "request": (
            {
                "title": intake["request"]["title"],
                "question": intake["request"]["question"],
                "path": str(request_path),
                "requestHash": intake["manifest"]["requestHash"],
            }
            if intake is not None
            else None
        ),
        "dataset": lanes[0]["study"]["dataset"],
        "datasetHash": lanes[0]["study"]["datasetHash"],
        "lanes": lanes,
        "summary": {
            "lanes": len(lanes),
            "phases": phases,
            "activeSessions": sum(
                lane["latestSession"] is not None
                and lane["latestSession"]["status"] == "active"
                for lane in lanes
            ),
            "reports": sum(len(lane["reports"]) for lane in lanes),
            "conflicts": len(conflicts),
        },
        "conflicts": conflicts,
        "progression": progression,
        "recommendedLaneId": (
            recommended_lane["id"] if recommended_lane is not None else None
        ),
        "recommendedAction": recommended_action,
        "warnings": warnings,
    }


RESEARCH_PROGRAM_STATUS_JSON_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "AutoQuant verified multi-Study research program status",
    "type": "object",
    "additionalProperties": False,
    "required": [
        "schemaVersion",
        "kind",
        "manifest",
        "project",
        "request",
        "dataset",
        "datasetHash",
        "lanes",
        "summary",
        "conflicts",
        "progression",
        "recommendedLaneId",
        "recommendedAction",
        "warnings",
    ],
    "properties": {
        "schemaVersion": {"const": SCHEMA_VERSION},
        "kind": {"const": RESEARCH_PROGRAM_STATUS_KIND},
        "manifest": {"type": "object"},
        "project": {"type": "object"},
        "request": {"type": ["object", "null"]},
        "dataset": {"type": "object"},
        "datasetHash": {"type": "string", "pattern": "^[0-9a-f]{64}$"},
        "lanes": {
            "type": "array",
            "minItems": 3,
            "maxItems": 3,
            "items": {"type": "object"},
        },
        "summary": {"type": "object"},
        "conflicts": {"type": "array", "items": {"type": "object"}},
        "progression": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "method",
                "stage",
                "focusLaneId",
                "optionalLaneId",
                "explanation",
                "gates",
                "selectionSplit",
                "testEntersProgression",
                "authority",
                "tradingAuthority",
            ],
            "properties": {
                "method": {"const": RESEARCH_PROGRESSION_METHOD},
                "stage": {
                    "enum": [
                        "factor-evidence-required",
                        "portfolio-evidence-required",
                        "optional-rl-in-progress",
                        "required-research-complete",
                    ]
                },
                "focusLaneId": {
                    "type": ["string", "null"],
                    "enum": ["factor", "portfolio", "rl", None],
                },
                "optionalLaneId": {
                    "type": ["string", "null"],
                    "enum": ["rl", None],
                },
                "explanation": {"type": "string", "minLength": 1},
                "gates": {
                    "type": "array",
                    "minItems": 2,
                    "maxItems": 2,
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "required": [
                            "id",
                            "upstreamLaneId",
                            "downstreamLaneId",
                            "requiredStage",
                            "status",
                            "runId",
                            "reportId",
                            "diagnosisStage",
                            "iterationFocus",
                            "explanation",
                            "selectionSplit",
                            "testEntersGate",
                            "authority",
                            "tradingAuthority",
                        ],
                        "properties": {
                            "id": {
                                "enum": [
                                    "factor-to-portfolio",
                                    "portfolio-to-rl",
                                ]
                            },
                            "upstreamLaneId": {
                                "enum": ["factor", "portfolio"]
                            },
                            "downstreamLaneId": {
                                "enum": ["portfolio", "rl"]
                            },
                            "requiredStage": {"type": "string"},
                            "status": {
                                "enum": [
                                    "waiting-current-evidence",
                                    "blocked-legacy-evidence",
                                    "blocked-upstream-evidence",
                                    "blocked-selection-adjusted-evidence",
                                    "blocked-scientific-limit",
                                    "blocked-failed-evidence",
                                    "blocked-prerequisite",
                                    "waiting-current-report",
                                    "passed",
                                ]
                            },
                            "runId": {"type": ["string", "null"]},
                            "reportId": {"type": ["string", "null"]},
                            "diagnosisStage": {
                                "type": ["string", "null"]
                            },
                            "iterationFocus": {
                                "type": "string",
                                "minLength": 1,
                            },
                            "explanation": {
                                "type": "string",
                                "minLength": 1,
                            },
                            "selectionSplit": {"const": "validation"},
                            "testEntersGate": {"const": False},
                            "authority": {
                                "const": "research-prioritization-only"
                            },
                            "tradingAuthority": {"const": "none"},
                        },
                    },
                },
                "selectionSplit": {"const": "validation"},
                "testEntersProgression": {"const": False},
                "authority": {"const": "research-prioritization-only"},
                "tradingAuthority": {"const": "none"},
            },
        },
        "recommendedLaneId": {"type": ["string", "null"]},
        "recommendedAction": {"type": ["object", "null"]},
        "warnings": {
            "type": "array",
            "items": {"type": "string", "minLength": 1},
        },
    },
}
