"""Immutable Project-level synthesis over verified lane Research Reports."""

from __future__ import annotations

import json
import os
import re
import shlex
import shutil
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .decision_support import (
    diversification_stress_markdown_lines,
    factor_components_markdown_lines,
    factor_input_availability_markdown_lines,
    factor_qualification_markdown_lines,
    mechanical_decision_markdown_lines,
    rl_factor_fusion_diagnosis_markdown_lines,
    signal_monetization_markdown_lines,
    sizing_anatomy_markdown_lines,
    strategy_viability_markdown_lines,
    summarize_leader_decision_support,
)
from .intake import load_project_intake
from .reports import REPORT_ID, list_reports, load_report
from .run_reports import list_run_reports, load_run_report
from .research_program import (
    RESEARCH_PROGRAM_MANIFEST,
    load_research_program,
)
from .runs import list_runs, load_run
from .sessions import list_sessions, load_session, validate_session_authority
from .studies import hash_file, hash_json, load_study
from .workspace import (
    SCHEMA_VERSION,
    AutoQuantValidationError,
    ProjectContext,
    ValidationIssue,
    confined_path,
)


DOSSIERS_DIRECTORY = "dossiers"
DOSSIER_ANALYSIS = "analysis.json"
DOSSIER_RESULT = "dossier.json"
DOSSIER_MARKDOWN = "dossier.md"
DOSSIER_MANIFEST = "manifest.json"
DOSSIER_ANALYSIS_KIND = "autoquant-research-dossier-analysis"
DOSSIER_KIND = "autoquant-research-dossier"
DOSSIER_STATUS_KIND = "autoquant-research-dossier-status"
DOSSIER_ID = re.compile(
    r"^dossier-[0-9]{8}T[0-9]{12}Z-[0-9a-f]{12}$"
)
FINDING_ID = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
LANE_ID = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
CONFIDENCE_LEVELS = {"low", "medium", "high"}


@dataclass(frozen=True)
class DossierContext:
    root_dir: Path
    manifest: dict[str, Any]
    dossier: dict[str, Any]
    analysis: dict[str, Any]


@dataclass(frozen=True)
class DossierSummary:
    id: str
    title: str
    published_at: str
    included_lanes: list[str]
    omitted_optional_lanes: list[str]
    findings: int
    recommendations: int
    path: str
    markdown_path: str
    executive_summary: str
    authority: str
    evidence_hash: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "publishedAt": self.published_at,
            "includedLanes": self.included_lanes,
            "omittedOptionalLanes": self.omitted_optional_lanes,
            "findings": self.findings,
            "recommendations": self.recommendations,
            "path": self.path,
            "markdownPath": self.markdown_path,
            "executiveSummary": self.executive_summary,
            "authority": self.authority,
            "evidenceHash": self.evidence_hash,
        }


def _issue(path: Path | str, code: str, message: str) -> ValidationIssue:
    return ValidationIssue(str(path), code, message)


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


def _read_json(path: Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise AutoQuantValidationError(
            [_issue(path, f"{label}.missing", f"Missing {label}: {path}")]
        ) from None
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise AutoQuantValidationError(
            [_issue(path, f"{label}.json", f"Invalid {label}: {error}")]
        ) from None
    if not isinstance(value, dict):
        raise AutoQuantValidationError(
            [_issue(path, f"{label}.type", f"{label} must be an object")]
        )
    return value


def _write_json(path: Path, value: Any) -> None:
    path.write_text(
        json.dumps(value, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _non_empty(value: Any, path: Path | str) -> list[ValidationIssue]:
    if not isinstance(value, str) or not value.strip():
        return [_issue(path, "schema.string", "Must be a non-empty string")]
    return []


def _string_list(
    value: Any,
    path: Path | str,
    *,
    allow_empty: bool,
) -> list[ValidationIssue]:
    if (
        not isinstance(value, list)
        or (not allow_empty and not value)
        or not all(isinstance(item, str) and item.strip() for item in value)
    ):
        return [
            _issue(
                path,
                "schema.array",
                "Must be an array of non-empty strings"
                + ("" if allow_empty else " with at least one item"),
            )
        ]
    return []


def _validate_evidence_refs(
    value: Any,
    path: Path | str,
) -> tuple[list[dict[str, Any]], list[ValidationIssue]]:
    if not isinstance(value, list) or not value:
        return [], [
            _issue(
                path,
                "schema.array",
                "evidenceRefs must contain at least one reference",
            )
        ]
    normalized: list[dict[str, Any]] = []
    issues: list[ValidationIssue] = []
    identities: list[tuple[Any, Any, Any]] = []
    for index, reference in enumerate(value):
        ref_path = f"{path}/{index}"
        if not isinstance(reference, dict):
            issues.append(
                _issue(ref_path, "schema.type", "Evidence reference must be an object")
            )
            continue
        issues.extend(
            _strict_keys(
                reference,
                {"laneId", "reportId", "findingId"},
                ref_path,
            )
        )
        lane_id = reference.get("laneId")
        report_id = reference.get("reportId")
        finding_id = reference.get("findingId")
        if not isinstance(lane_id, str) or not LANE_ID.fullmatch(lane_id):
            issues.append(
                _issue(f"{ref_path}/laneId", "schema.id", "Invalid laneId")
            )
        if not isinstance(report_id, str) or not REPORT_ID.fullmatch(report_id):
            issues.append(
                _issue(f"{ref_path}/reportId", "schema.id", "Invalid reportId")
            )
        if finding_id is not None and (
            not isinstance(finding_id, str)
            or not FINDING_ID.fullmatch(finding_id)
        ):
            issues.append(
                _issue(f"{ref_path}/findingId", "schema.id", "Invalid findingId")
            )
        item = {
            "laneId": lane_id,
            "reportId": report_id,
            "findingId": finding_id,
        }
        normalized.append(item)
        identities.append((lane_id, report_id, finding_id))
    if len(identities) != len(set(identities)):
        issues.append(
            _issue(
                path,
                "dossier.duplicate-evidence",
                "Dossier evidence references must be unique",
            )
        )
    return normalized, issues


def validate_dossier_analysis(
    value: dict[str, Any],
    path: Path | str = "dossier-analysis",
) -> dict[str, Any]:
    required = {
        "schemaVersion",
        "kind",
        "title",
        "executiveSummary",
        "findings",
        "recommendations",
        "limitations",
        "unresolvedQuestions",
    }
    issues = _strict_keys(value, required, path)
    if value.get("schemaVersion") != SCHEMA_VERSION:
        issues.append(_issue(f"{path}/schemaVersion", "schema.version", "Expected V1"))
    if value.get("kind") != DOSSIER_ANALYSIS_KIND:
        issues.append(
            _issue(
                f"{path}/kind",
                "dossier.kind",
                f"Expected {DOSSIER_ANALYSIS_KIND}",
            )
        )
    for key in ("title", "executiveSummary"):
        issues.extend(_non_empty(value.get(key), f"{path}/{key}"))
    for key in ("limitations", "unresolvedQuestions"):
        issues.extend(
            _string_list(value.get(key), f"{path}/{key}", allow_empty=True)
        )

    findings = value.get("findings")
    if not isinstance(findings, list) or not findings:
        issues.append(
            _issue(
                f"{path}/findings",
                "schema.array",
                "Findings must contain at least one item",
            )
        )
        findings = []
    normalized_findings: list[dict[str, Any]] = []
    finding_ids: list[str] = []
    for index, finding in enumerate(findings):
        finding_path = f"{path}/findings/{index}"
        if not isinstance(finding, dict):
            issues.append(
                _issue(finding_path, "schema.type", "Finding must be an object")
            )
            continue
        issues.extend(
            _strict_keys(
                finding,
                {"id", "claim", "confidence", "evidenceRefs"},
                finding_path,
            )
        )
        finding_id = finding.get("id")
        if not isinstance(finding_id, str) or not FINDING_ID.fullmatch(finding_id):
            issues.append(
                _issue(
                    f"{finding_path}/id",
                    "schema.id",
                    "Finding id must be lowercase kebab-case",
                )
            )
        else:
            finding_ids.append(finding_id)
        issues.extend(_non_empty(finding.get("claim"), f"{finding_path}/claim"))
        if finding.get("confidence") not in CONFIDENCE_LEVELS:
            issues.append(
                _issue(
                    f"{finding_path}/confidence",
                    "schema.choice",
                    "Invalid confidence",
                )
            )
        references, reference_issues = _validate_evidence_refs(
            finding.get("evidenceRefs"),
            f"{finding_path}/evidenceRefs",
        )
        issues.extend(reference_issues)
        normalized_findings.append(
            {
                "id": finding_id,
                "claim": (
                    finding["claim"].strip()
                    if isinstance(finding.get("claim"), str)
                    else finding.get("claim")
                ),
                "confidence": finding.get("confidence"),
                "evidenceRefs": references,
            }
        )
    if len(finding_ids) != len(set(finding_ids)):
        issues.append(
            _issue(
                f"{path}/findings",
                "dossier.duplicate-finding",
                "Finding ids must be unique",
            )
        )

    recommendations = value.get("recommendations")
    if not isinstance(recommendations, list):
        issues.append(
            _issue(
                f"{path}/recommendations",
                "schema.array",
                "Recommendations must be an array",
            )
        )
        recommendations = []
    normalized_recommendations: list[dict[str, Any]] = []
    for index, recommendation in enumerate(recommendations):
        recommendation_path = f"{path}/recommendations/{index}"
        if not isinstance(recommendation, dict):
            issues.append(
                _issue(
                    recommendation_path,
                    "schema.type",
                    "Recommendation must be an object",
                )
            )
            continue
        issues.extend(
            _strict_keys(
                recommendation,
                {"action", "rationale", "conditions", "evidenceRefs"},
                recommendation_path,
            )
        )
        for key in ("action", "rationale"):
            issues.extend(
                _non_empty(
                    recommendation.get(key),
                    f"{recommendation_path}/{key}",
                )
            )
        issues.extend(
            _string_list(
                recommendation.get("conditions"),
                f"{recommendation_path}/conditions",
                allow_empty=True,
            )
        )
        references, reference_issues = _validate_evidence_refs(
            recommendation.get("evidenceRefs"),
            f"{recommendation_path}/evidenceRefs",
        )
        issues.extend(reference_issues)
        normalized_recommendations.append(
            {
                "action": (
                    recommendation["action"].strip()
                    if isinstance(recommendation.get("action"), str)
                    else recommendation.get("action")
                ),
                "rationale": (
                    recommendation["rationale"].strip()
                    if isinstance(recommendation.get("rationale"), str)
                    else recommendation.get("rationale")
                ),
                "conditions": [
                    item.strip()
                    for item in (
                        recommendation["conditions"]
                        if isinstance(recommendation.get("conditions"), list)
                        else []
                    )
                ],
                "evidenceRefs": references,
            }
        )
    if issues:
        raise AutoQuantValidationError(issues)
    return {
        "schemaVersion": SCHEMA_VERSION,
        "kind": DOSSIER_ANALYSIS_KIND,
        "title": value["title"].strip(),
        "executiveSummary": value["executiveSummary"].strip(),
        "findings": normalized_findings,
        "recommendations": normalized_recommendations,
        "limitations": [item.strip() for item in value["limitations"]],
        "unresolvedQuestions": [
            item.strip() for item in value["unresolvedQuestions"]
        ],
    }


def load_dossier_analysis(path: str | Path) -> dict[str, Any]:
    analysis_path = Path(path).expanduser().absolute()
    return validate_dossier_analysis(
        _read_json(analysis_path, "dossier analysis"),
        analysis_path,
    )


def _blocker(code: str, message: str, lane_id: str | None = None) -> dict[str, Any]:
    return {
        "code": code,
        "laneId": lane_id,
        "message": message,
    }


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


def _run_projection(run) -> dict[str, Any]:
    return {
        "id": run.result["id"],
        "resultHash": run.manifest["resultHash"],
        "status": run.result["status"],
        "study": run.result["study"],
        "studyInputHash": run.result["studyInputHash"],
        "subject": run.result["subject"],
        "dataset": run.result["dataset"],
        "harness": run.result["harness"],
        "objective": run.result["objective"],
        "metrics": run.result["metrics"],
        "artifacts": run.result["artifacts"],
        **(
            {"dependencies": run.result["dependencies"]}
            if "dependencies" in run.result
            else {}
        ),
    }


def _report_projection(report) -> dict[str, Any]:
    run_bound = report.report.get("kind") == "autoquant-run-research-report"
    if run_bound:
        anchor = report.report["anchor"]
        frozen_run = report.report["evidence"]["run"]
        metric = frozen_run["objective"]["metric"]
        leader = {
            "runId": anchor["runId"],
            "metric": metric,
            "value": frozen_run["metrics"].get(metric),
            "sourceHash": frozen_run["subject"]["sourceHash"],
        }
        brief = None
        session_id = None
    else:
        frozen_session = report.report["evidence"]["session"]
        anchor = {
            "kind": "session",
            "studyId": frozen_session["studyId"],
            "runId": frozen_session["leader"]["runId"],
            "sessionId": report.report["sessionId"],
        }
        leader = frozen_session["leader"]
        brief = report.report["brief"]
        session_id = report.report["sessionId"]
    projection = {
        "id": report.report["id"],
        "reportHash": report.manifest["reportHash"],
        "analysisHash": report.report["analysisHash"],
        "evidenceHash": report.report["evidenceHash"],
        "publishedAt": report.report["publishedAt"],
        "anchor": anchor,
        "sessionId": session_id,
        "brief": brief,
        "title": report.analysis["title"],
        "executiveSummary": report.analysis["executiveSummary"],
        "analysis": report.analysis,
        "selectionIntegrity": report.report["evidence"]["selectionIntegrity"],
        "harness": report.report["harness"],
        "leader": leader,
        "authority": report.report["authority"],
    }
    if "leaderDecisionSupport" in report.report["evidence"]:
        projection["leaderDecisionSupport"] = report.report["evidence"][
            "leaderDecisionSupport"
        ]
    return projection


def _status_report_projection(report) -> dict[str, Any]:
    run_bound = report.report.get("kind") == "autoquant-run-research-report"
    anchor = (
        report.report["evidence"]["anchor"]
        if run_bound
        else {
            "kind": "session",
            "studyId": report.report["evidence"]["session"]["studyId"],
            "runId": report.report["evidence"]["session"]["leader"]["runId"],
            "sessionId": report.report["sessionId"],
        }
    )
    projection = {
        "id": report.report["id"],
        "title": report.analysis["title"],
        "executiveSummary": report.analysis["executiveSummary"],
        "anchor": anchor,
        "sessionId": anchor["sessionId"],
        "leaderRunId": anchor["runId"],
        "publishedAt": report.report["publishedAt"],
        "findings": [
            {
                "id": finding["id"],
                "claim": finding["claim"],
                "confidence": finding["confidence"],
            }
            for finding in report.analysis["findings"]
        ],
    }
    if "leaderDecisionSupport" in report.report["evidence"]:
        projection["leaderDecisionSupport"] = (
            summarize_leader_decision_support(
                report.report["evidence"]["leaderDecisionSupport"]
            )
        )
    return projection


def _current_lane_report(
    project: ProjectContext,
    lane: dict[str, Any],
    request: dict[str, Any],
) -> tuple[Any | None, Any | None, Any | None, list[dict[str, Any]]]:
    blockers: list[dict[str, Any]] = []
    study = load_study(project, lane["studyId"])
    current_run = None
    for summary in reversed(list_runs(project, lane["studyId"])):
        candidate = load_run(project, summary.id)
        if (
            candidate.result["status"] == "succeeded"
            and candidate.result["studyInputHash"] == study.input_hash
        ):
            current_run = candidate
            break
    summaries = [
        item
        for item in list_sessions(project)
        if item.study_id == lane["studyId"]
    ]
    if not summaries:
        for summary in reversed(list_run_reports(project, lane["studyId"])):
            report = load_run_report(project, summary.id)
            if (
                current_run is not None
                and report.report["request"] == request
                and report.report["anchor"]["runId"]
                == current_run.result["id"]
            ):
                return None, report, current_run, []
        return (
            None,
            None,
            current_run,
            [
                _blocker(
                    "dossier.report-missing",
                    (
                        f"{lane['name']} has current Run evidence but no current Run-bound Report"
                        if current_run is not None
                        else f"{lane['name']} has no current Run or delegated Session evidence"
                    ),
                    lane["id"],
                )
            ],
        )
    session = load_session(project, summaries[-1].id)
    if session.delegation is None or session.delegation["request"] != request:
        blockers.append(
            _blocker(
                "dossier.request-mismatch",
                f"{lane['name']} Session does not bind the Project request",
                lane["id"],
            )
        )
    try:
        validate_session_authority(project, session)
    except AutoQuantValidationError as error:
        blockers.append(
            _blocker(
                "dossier.session-stale",
                f"{lane['name']} Session authority is stale: "
                + "; ".join(issue.message for issue in error.issues),
                lane["id"],
            )
        )
    reports = list_reports(project, session)
    current_report = None
    for summary in reversed(reports):
        report = load_report(project, session, summary.id)
        if (
            report.report["request"] == request
            and report.report["evidence"]["session"]["leader"]
            == session.manifest["leader"]
        ):
            current_report = report
            break
    if current_report is None:
        blockers.append(
            _blocker(
                "dossier.report-missing",
                f"{lane['name']} has no Report for the current Session leader",
                lane["id"],
            )
        )
        return session, None, None, blockers
    leader_run = load_run(
        project,
        current_report.report["evidence"]["session"]["leader"]["runId"],
    )
    if leader_run.result["status"] != "succeeded":
        blockers.append(
            _blocker(
                "dossier.leader-failed",
                f"{lane['name']} Report leader is not a successful Run",
                lane["id"],
            )
        )
    return session, current_report, leader_run, blockers


def _factor_dependency_hash(result: dict[str, Any]) -> str | None:
    dependencies = result.get("dependencies")
    source_hashes = (
        dependencies.get("sourceHashes")
        if isinstance(dependencies, dict)
        else None
    )
    if not isinstance(source_hashes, dict):
        return None
    factor_hashes = {
        path: content_hash
        for path, content_hash in source_hashes.items()
        if path.startswith("factors/")
    }
    return hash_json(factor_hashes) if factor_hashes else None


def _portfolio_mandate_id(result: dict[str, Any]) -> str | None:
    mandate = result.get("metrics", {}).get("portfolio_mandate")
    return mandate.get("id") if isinstance(mandate, dict) else None


def _research_horizon_id(result: dict[str, Any]) -> str | None:
    horizon = result.get("metrics", {}).get("research_horizon")
    return horizon.get("id") if isinstance(horizon, dict) else None


def _program_lane_admission(
    program: dict[str, Any],
    lane_id: str,
) -> dict[str, Any]:
    gates = {
        gate["id"]: gate for gate in program["progression"]["gates"]
    }
    factor_gate = gates["factor-to-portfolio"]
    portfolio_gate = gates["portfolio-to-rl"]
    if lane_id == "factor":
        return {
            "admitted": True,
            "required": True,
            "gateId": None,
            "status": "required",
            "explanation": (
                "Factor is the first required evidence lane for every "
                "request-driven research program."
            ),
        }
    if lane_id == "portfolio":
        admitted = factor_gate["status"] == "passed"
        return {
            "admitted": admitted,
            "required": admitted,
            "gateId": factor_gate["id"],
            "status": "required" if admitted else "gated-context-only",
            "explanation": factor_gate["explanation"],
        }
    admitted = portfolio_gate["status"] == "passed"
    return {
        "admitted": admitted,
        "required": False,
        "gateId": portfolio_gate["id"],
        "status": "optional-admitted" if admitted else "gated-context-only",
        "explanation": portfolio_gate["explanation"],
    }


def _readiness(
    project: ProjectContext,
) -> tuple[dict[str, Any], dict[str, Any] | None, dict[str, Any]]:
    program = load_research_program(project)
    assert program is not None
    intake = load_project_intake(project)
    top_blockers: list[dict[str, Any]] = []
    if intake is None:
        top_blockers.append(
            _blocker(
                "dossier.intake-required",
                "Research Dossiers require verified request-driven Project intake",
            )
        )
    request = intake["request"] if intake is not None else None
    lane_states: list[dict[str, Any]] = []
    for lane in program["lanes"]:
        admission = _program_lane_admission(program, lane["id"])
        required = admission["required"]
        session = report = leader_run = None
        blockers: list[dict[str, Any]] = []
        inspect_lane = admission["admitted"]
        if not inspect_lane:
            inspect_lane = any(
                item.study_id == lane["studyId"]
                for item in list_sessions(project)
            )
        if request is not None and inspect_lane:
            session, report, leader_run, blockers = _current_lane_report(
                project,
                lane,
                request,
            )
            if not admission["admitted"] and report is None:
                blockers = [
                    _blocker(
                        "dossier.lane-gated",
                        admission["explanation"],
                        lane["id"],
                    )
                ]
        elif request is not None:
            blockers.append(
                _blocker(
                    "dossier.lane-gated",
                    admission["explanation"],
                    lane["id"],
                )
            )
        else:
            blockers.append(
                _blocker(
                    "dossier.intake-required",
                    "Project request is unavailable",
                    lane["id"],
                )
            )
        state = {
            "id": lane["id"],
            "name": lane["name"],
            "role": lane["role"],
            "required": required,
            "status": "ready" if not blockers else ("blocked" if required else "omitted"),
            "admission": admission,
            "study": lane["study"],
            "session": (
                {
                    "id": session.manifest["id"],
                    "status": session.manifest["status"],
                    "leader": session.manifest["leader"],
                }
                if session is not None
                else None
            ),
            "report": (
                _status_report_projection(report)
                if report is not None
                else None
            ),
            "leaderRun": (
                {
                    "id": leader_run.result["id"],
                    "resultHash": leader_run.manifest["resultHash"],
                    "sourceHash": leader_run.result["subject"]["sourceHash"],
                    "dependencyHash": (
                        leader_run.result.get("dependencies", {}).get("hash")
                        if isinstance(leader_run.result.get("dependencies"), dict)
                        else None
                    ),
                    "factorDependencyHash": _factor_dependency_hash(
                        leader_run.result
                    ),
                    "portfolioMandateId": _portfolio_mandate_id(
                        leader_run.result
                    ),
                    "researchHorizonId": _research_horizon_id(
                        leader_run.result
                    ),
                    "datasetHash": leader_run.result["dataset"]["hash"],
                    "objective": leader_run.result["objective"],
                }
                if leader_run is not None
                else None
            ),
            "blockers": blockers,
            "_reportContext": report,
            "_leaderRunContext": leader_run,
        }
        lane_states.append(state)

    lane_by_id = {lane["id"]: lane for lane in lane_states}
    factor = lane_by_id.get("factor")
    portfolio = lane_by_id.get("portfolio")
    if (
        factor
        and portfolio
        and factor["status"] == "ready"
        and portfolio["status"] == "ready"
        and factor["leaderRun"]["sourceHash"]
        != portfolio["leaderRun"]["sourceHash"]
    ):
        mismatch = _blocker(
            "dossier.factor-source-mismatch",
            "Factor and Portfolio Reports do not use the same candidate factor source",
        )
        top_blockers.append(mismatch)
    rl = lane_by_id.get("rl")
    if (
        factor
        and rl
        and factor["status"] == "ready"
        and rl["status"] == "ready"
        and rl["leaderRun"]["factorDependencyHash"]
        != factor["leaderRun"]["sourceHash"]
    ):
        rl["status"] = "omitted"
        rl["blockers"].append(
            _blocker(
                "dossier.rl-dependency-mismatch",
                "RL Report does not pin the included Factor Report source",
                "rl",
            )
        )
    if (
        portfolio
        and rl
        and portfolio["status"] == "ready"
        and rl["status"] == "ready"
        and portfolio["leaderRun"]["portfolioMandateId"]
        != rl["leaderRun"]["portfolioMandateId"]
    ):
        rl["status"] = "omitted"
        rl["blockers"].append(
            _blocker(
                "dossier.portfolio-mandate-mismatch",
                "RL Report does not use the included Portfolio Report mandate",
                "rl",
            )
        )
    ready_horizon_ids = {
        lane["leaderRun"]["researchHorizonId"]
        for lane in lane_states
        if lane["status"] == "ready" and lane["leaderRun"] is not None
    }
    if ready_horizon_ids and (
        len(ready_horizon_ids) != 1 or None in ready_horizon_ids
    ):
        top_blockers.append(
            _blocker(
                "dossier.research-horizon-mismatch",
                "Included lane Reports do not use one exact Horizon Mandate",
            )
        )

    included = [lane for lane in lane_states if lane["status"] == "ready"]
    required_blockers = [
        blocker
        for lane in lane_states
        if lane["required"]
        for blocker in lane["blockers"]
    ]
    blockers = [*top_blockers, *required_blockers]
    ready = not blockers
    omitted = [
        {
            "id": lane["id"],
            "name": lane["name"],
            "reason": (
                "; ".join(blocker["message"] for blocker in lane["blockers"])
                or "Optional lane was not included"
            ),
        }
        for lane in lane_states
        if not lane["required"] and lane["status"] != "ready"
    ]

    next_action = None
    if ready:
        next_action = _command(
            "dossier.publish",
            "Publish cross-lane analysis over the verified current Report set.",
            [
                "aq",
                "dossier",
                "publish",
                str(project.root_dir),
                "--analysis",
                "dossier-analysis.json",
                "--json",
            ],
            "creates-artifact",
        )
    else:
        first_blocked = next(
            (lane for lane in lane_states if lane["required"] and lane["blockers"]),
            None,
        )
        if first_blocked is not None:
            lane_program = next(
                lane
                for lane in program["lanes"]
                if lane["id"] == first_blocked["id"]
            )
            if (
                first_blocked["session"] is None
                and first_blocked["leaderRun"] is not None
            ):
                next_action = _command(
                    "report.publish",
                    f"Publish analysis over the current immutable Run for {first_blocked['name']} without creating a Session.",
                    [
                        "aq",
                        "report",
                        "publish",
                        str(project.root_dir),
                        "--study",
                        first_blocked["study"]["id"],
                        "--run",
                        first_blocked["leaderRun"]["id"],
                        "--analysis",
                        "report-analysis.json",
                        "--json",
                    ],
                    "creates-artifact",
                )
            elif first_blocked["session"] is None:
                next_action = next(
                    (
                        command
                        for command in lane_program["commands"]
                        if command["id"] == "session.start"
                    ),
                    lane_program["commands"][0],
                )
            else:
                next_action = _command(
                    "report.publish",
                    f"Publish a current lane Report for {first_blocked['name']}.",
                    [
                        "aq",
                        "report",
                        "publish",
                        str(project.root_dir),
                        "--session",
                        first_blocked["session"]["id"],
                        "--analysis",
                        "report-analysis.json",
                        "--json",
                    ],
                    "creates-artifact",
                )

    public_lanes = [
        {key: value for key, value in lane.items() if not key.startswith("_")}
        for lane in lane_states
    ]
    status = {
        "schemaVersion": SCHEMA_VERSION,
        "kind": DOSSIER_STATUS_KIND,
        "ready": ready,
        "project": {
            "id": project.manifest.id,
            "name": project.manifest.name,
            "rootDir": str(project.root_dir),
        },
        "request": (
            {
                "title": request["title"],
                "question": request["question"],
                "requestHash": intake["manifest"]["requestHash"],
                "source": request["source"],
            }
            if intake is not None
            else None
        ),
        "dataset": (
            {
                "id": intake["dataset"]["id"],
                "version": intake["dataset"]["version"],
                "assetClass": intake["dataset"]["assetClass"],
                "universe": intake["dataset"]["universe"],
                "timeRange": intake["dataset"]["timeRange"],
                **(
                    {
                        "intervalSurface": intake["dataset"][
                            "intervalSurface"
                        ]
                    }
                    if "intervalSurface" in intake["dataset"]
                    else {}
                ),
                "datasetHash": intake["manifest"]["datasetHash"],
                "snapshotHash": intake["manifest"]["datasetSnapshotHash"],
            }
            if intake is not None
            else None
        ),
        "program": {
            "id": program["manifest"]["id"],
            "manifestHash": hash_file(
                project.root_dir / RESEARCH_PROGRAM_MANIFEST
            ),
            "datasetHash": program["datasetHash"],
            "progression": program["progression"],
        },
        "lanes": public_lanes,
        "includedLaneIds": [lane["id"] for lane in included],
        "omittedOptionalLanes": omitted,
        "blockers": blockers,
        "latestDossier": None,
        "nextAction": next_action,
    }
    internal = {
        "program": program,
        "intake": intake,
        "laneStates": lane_states,
        "included": included,
        "omitted": omitted,
    }
    return status, intake, internal


def _publication_evidence(
    project: ProjectContext,
    intake: dict[str, Any],
    internal: dict[str, Any],
) -> dict[str, Any]:
    program = internal["program"]
    lanes: list[dict[str, Any]] = []
    for lane in internal["included"]:
        report = lane["_reportContext"]
        leader_run = lane["_leaderRunContext"]
        lanes.append(
            {
                "id": lane["id"],
                "name": lane["name"],
                "role": lane["role"],
                "required": lane["required"],
                "admission": lane["admission"],
                "study": lane["study"],
                "report": _report_projection(report),
                "leaderRun": _run_projection(leader_run),
            }
        )
    return {
        "request": intake["request"],
        "requestHash": intake["manifest"]["requestHash"],
        "dataset": intake["dataset"],
        "datasetSnapshotHash": intake["manifest"]["datasetSnapshotHash"],
        "datasetHash": intake["manifest"]["datasetHash"],
        "program": {
            "manifest": program["manifest"],
            "manifestHash": hash_file(
                project.root_dir / RESEARCH_PROGRAM_MANIFEST
            ),
            "datasetHash": program["datasetHash"],
        },
        "lanes": lanes,
        "omittedOptionalLanes": internal["omitted"],
    }


def _resolve_analysis_evidence(
    analysis: dict[str, Any],
    evidence: dict[str, Any],
    path: Path | str,
) -> None:
    issues: list[ValidationIssue] = []
    catalog: dict[str, dict[str, Any]] = {
        lane["id"]: lane for lane in evidence["lanes"]
    }
    finding_lane_ids: set[str] = set()
    for owner_kind, owners in (
        ("findings", analysis["findings"]),
        ("recommendations", analysis["recommendations"]),
    ):
        for owner_index, owner in enumerate(owners):
            for ref_index, reference in enumerate(owner["evidenceRefs"]):
                ref_path = (
                    f"{path}/{owner_kind}/{owner_index}/evidenceRefs/{ref_index}"
                )
                lane = catalog.get(reference["laneId"])
                if lane is None:
                    issues.append(
                        _issue(
                            ref_path,
                            "dossier.unknown-lane",
                            f"Unknown included lane: {reference['laneId']}",
                        )
                    )
                    continue
                if reference["reportId"] != lane["report"]["id"]:
                    issues.append(
                        _issue(
                            ref_path,
                            "dossier.report-mismatch",
                            f"Reference does not select the frozen {lane['id']} Report",
                        )
                    )
                    continue
                finding_id = reference["findingId"]
                if finding_id is not None and finding_id not in {
                    finding["id"]
                    for finding in lane["report"]["analysis"]["findings"]
                }:
                    issues.append(
                        _issue(
                            ref_path,
                            "dossier.unknown-finding",
                            f"Unknown finding {finding_id} in {lane['id']} Report",
                        )
                    )
                if owner_kind == "findings":
                    finding_lane_ids.add(lane["id"])
    included_ids = {lane["id"] for lane in evidence["lanes"]}
    missing = included_ids - finding_lane_ids
    if missing:
        issues.append(
            _issue(
                path,
                "dossier.lane-coverage",
                "Dossier findings must reference every included lane: "
                + ", ".join(sorted(missing)),
            )
        )
    if issues:
        raise AutoQuantValidationError(issues)


def load_dossier_status(
    project: ProjectContext,
    *,
    optional: bool = False,
) -> dict[str, Any] | None:
    if optional and not (project.root_dir / RESEARCH_PROGRAM_MANIFEST).exists():
        return None
    status, intake, internal = _readiness(project)
    dossiers = list_dossiers(project)
    if dossiers:
        latest = dossiers[-1]
        current_evidence_hash = (
            hash_json(_publication_evidence(project, intake, internal))
            if status["ready"] and intake is not None
            else None
        )
        status["latestDossier"] = {
            **latest.to_dict(),
            "current": latest.evidence_hash == current_evidence_hash,
        }
        if latest.evidence_hash == current_evidence_hash:
            status["nextAction"] = _command(
                "dossier.show",
                "Verify the current immutable Research Dossier.",
                [
                    "aq",
                    "dossier",
                    "show",
                    str(project.root_dir),
                    "--dossier",
                    latest.id,
                    "--json",
                ],
                "read-only",
            )
    return status


def _evidence_label(reference: dict[str, Any]) -> str:
    label = f"{reference['laneId']}:{reference['reportId']}"
    if reference["findingId"] is not None:
        label += f"#{reference['findingId']}"
    return f"`{label}`"


def _render_markdown(dossier: dict[str, Any]) -> str:
    analysis = dossier["analysis"]
    evidence = dossier["evidence"]
    request = evidence["request"]
    supplied_horizon_policy = request.get("horizonPolicy")
    request_horizon_policy = (
        supplied_horizon_policy
        if isinstance(supplied_horizon_policy, dict)
        else {
            "primaryForwardBars": 1,
            "diagnosticForwardBars": [1, 5, 10],
        }
    )
    source = request["source"]
    assets = ", ".join(
        f"{item['symbol']} ({item['assetClass']}"
        + (f", {item['venue']}" if item["venue"] else "")
        + ")"
        for item in request["assets"]
    )
    source_identity = (
        f"{source['system']} workspace={source['workspaceId'] or 'unspecified'} "
        f"session={source['sessionId'] or 'unspecified'}"
    )
    lines = [
        f"# {analysis['title']}",
        "",
        "> Authority: quantitative decision support only. This Dossier is not a",
        "> trade order, broker confirmation, or authenticated OpenAlice origin.",
        "",
        "## Research request",
        "",
        f"**Question:** {request['question']}",
        "",
        f"**Decision context:** {request['decisionContext']}",
        "",
        f"**Assets:** {assets}",
        "",
        f"**Direction / horizon:** {request['direction']} / {request['horizon']}",
        "",
        (
            "**Numerical forward horizon:** "
            f"primary `{request_horizon_policy['primaryForwardBars']}` "
            "decision bars; diagnostics "
            + ", ".join(
                f"`{item}`"
                for item in request_horizon_policy["diagnosticForwardBars"]
            )
            + (
                " bars (`caller-supplied`)"
                if isinstance(supplied_horizon_policy, dict)
                else " bars (`reference-default`)"
            )
        ),
        "",
        f"**Caller-supplied source:** {source_identity}",
        "",
        "## Executive synthesis",
        "",
        analysis["executiveSummary"],
        "",
        "## Program evidence",
        "",
        "| Lane | Study | Report | Leader Run | Selection integrity |",
        "| --- | --- | --- | --- | --- |",
    ]
    for lane in evidence["lanes"]:
        integrity = lane["report"]["selectionIntegrity"]
        family = integrity.get("researchFamily")
        adjustment = integrity.get("selectionAdjustment")
        family_summary = (
            f"; family={family['uniqueSourceTrials']} unique"
            if isinstance(family, dict)
            else ""
        )
        adjustment_summary = (
            f"; adjusted pass={adjustment['passes']}"
            if isinstance(adjustment, dict)
            else ""
        )
        test_summary = (
            f"test={integrity['testExposureState']}; "
            if "testExposureState" in integrity
            else ""
        )
        lines.append(
            f"| {lane['name']} | `{lane['study']['id']}` | "
            f"`{lane['report']['id']}` | `{lane['leaderRun']['id']}` | "
            f"{integrity['selectionMetric']} / {integrity['selectionSplit']}; "
            f"{integrity['candidateTrials']} trials; "
            f"{test_summary}"
            f"holdout required={integrity['externalHoldoutRequired']}"
            f"{family_summary}{adjustment_summary} |"
        )
    mandates: dict[str, dict[str, Any]] = {}
    horizons: dict[str, dict[str, Any]] = {}
    for lane in evidence["lanes"]:
        mandate = lane["leaderRun"]["metrics"].get("portfolio_mandate")
        if isinstance(mandate, dict) and isinstance(mandate.get("id"), str):
            mandates[mandate["id"]] = mandate
        horizon = lane["leaderRun"]["metrics"].get("research_horizon")
        if isinstance(horizon, dict) and isinstance(horizon.get("id"), str):
            horizons[horizon["id"]] = horizon
    if horizons:
        lines.extend(["", "## Numerical research horizon", ""])
        for horizon in horizons.values():
            lines.extend(
                [
                    f"- Horizon Mandate: `{horizon['id']}`",
                    f"- Human horizon: `{horizon['source']['horizon']}`",
                    f"- Primary forward target: "
                    f"`{horizon['primaryForwardBars']}` decision bars",
                    "- Diagnostic forward targets: "
                    + ", ".join(
                        f"`{item}`"
                        for item in horizon["diagnosticForwardBars"]
                    )
                    + " decision bars",
                    f"- Policy source: "
                    f"`{horizon['source']['horizonPolicy']}`",
                    "- Portfolio and RL retain sequential one-bar accounting; "
                    "this Horizon Mandate does not claim a forced holding "
                    "period or direct multi-bar execution.",
                ]
            )
    if mandates:
        lines.extend(["", "## Portfolio mandate", ""])
        for mandate in mandates.values():
            construction = mandate["construction"]
            implementation = mandate["implementationPolicy"]
            decision_policy = implementation["decisionPolicy"]
            decision_schedule_label = (
                "calendar month-end"
                if decision_policy["kind"] == "calendar-month-end"
                else (
                    f"every {decision_policy['bars']} base bars / "
                    f"{decision_policy['anchor']}"
                )
            )
            benchmark = construction["benchmark"]
            benchmark_label = (
                f"{benchmark['asset']} long"
                if benchmark["kind"] == "single-asset-long"
                else benchmark["kind"]
            )
            named_caps = {
                asset: value
                for asset, value in construction[
                    "assetMaxAbsWeights"
                ].items()
                if asset in mandate["tradableAssets"]
                and value != construction["maxAbsWeight"]
            }
            lines.extend(
                [
                    f"- Mandate: `{mandate['id']}`",
                    f"- Direction / construction: "
                    f"`{mandate['source']['direction']}` / "
                    f"`{construction['family']}`",
                    "- Authorized positions: "
                    + ", ".join(f"`{item}`" for item in mandate["tradableAssets"]),
                    "- Asset position roles: "
                    + ", ".join(
                        f"`{asset}`=`{role}`"
                        for asset, role in construction[
                            "assetPositionRoles"
                        ].items()
                    ),
                    f"- Role source / long-side limit / short-side limit: "
                    f"`{mandate['source']['assetPositionRoles']}` / "
                    f"`{construction['longGrossLimit']}` / "
                    f"`{construction['shortGrossLimit']}`",
                    "- Context-only assets: "
                    + (
                        ", ".join(
                            f"`{item}`" for item in mandate["contextAssets"]
                        )
                        if mandate["contextAssets"]
                        else "none"
                    ),
                    f"- Gross limit / default per-asset cap / cash: "
                    f"`{construction['grossLimit']}` / "
                    f"`{construction['maxAbsWeight']}` / "
                    f"`{construction['cashAllowed']}`",
                    "- Named per-asset cap overrides: "
                    + (
                        ", ".join(
                            f"`{asset}`=`{value}`"
                            for asset, value in named_caps.items()
                        )
                        if named_caps
                        else "none"
                    ),
                    f"- Benchmark: `{benchmark_label}`",
                    f"- Benchmark source / authority: "
                    f"`{benchmark['source']}` / evaluation-only",
                    f"- Portfolio policy source: "
                    f"`{mandate['source']['portfolioPolicy']}`",
                    f"- Base cost / one-way no-trade band / reference NAV: "
                    f"`{implementation['baseCostBps']}` bps / "
                    f"`{implementation['noTradeOneWay']}` / "
                    f"`{implementation['referenceNav']}`",
                    f"- Decision schedule / source: "
                    f"`{decision_schedule_label}` / "
                    f"`{decision_policy['source']}`",
                    "- Off-schedule bars hold signal intent and ordinary "
                    "positions; only mandatory risk scale-down may trade.",
                    "- These are content-locked research assumptions, not "
                    "authenticated Broker fees, account capital, or trading "
                    "authority.",
                ]
            )
            risk_policy = construction.get("riskPolicy")
            if isinstance(risk_policy, dict):
                lines.extend(
                    [
                        f"- Risk governor: `{risk_policy['method']}`",
                        f"- Annualized volatility ceiling / covariance "
                        f"history: "
                        f"`{risk_policy['annualizedVolatilityCeiling']}` / "
                        f"`{risk_policy['covarianceWindow']}` bars "
                        f"(`{risk_policy['minimumObservations']}` required)",
                        f"- Scale-up permitted: `{risk_policy['scaleUp']}`",
                    ]
                )
            lines.append("")
    for lane in evidence["lanes"]:
        support = lane["report"].get("leaderDecisionSupport")
        if isinstance(support, dict):
            lines.extend(
                factor_input_availability_markdown_lines(
                    support,
                    heading="### Factor input availability",
                    lane_name=lane["name"],
                )
            )
            lines.extend(
                factor_qualification_markdown_lines(
                    support,
                    heading="## Frozen factor qualification",
                    lane_name=lane["name"],
                )
            )
            lines.extend(
                factor_components_markdown_lines(
                    support,
                    heading="## Frozen factor components",
                    lane_name=lane["name"],
                )
            )
            lines.extend(
                mechanical_decision_markdown_lines(
                    support,
                    heading="## Frozen mechanical portfolio decision",
                    lane_name=lane["name"],
                )
            )
            lines.extend(
                sizing_anatomy_markdown_lines(
                    support,
                    heading="## Frozen portfolio sizing anatomy",
                    lane_name=lane["name"],
                )
            )
            lines.extend(
                diversification_stress_markdown_lines(
                    support,
                    heading=(
                        "## Frozen portfolio diversification stress"
                    ),
                    lane_name=lane["name"],
                )
            )
            lines.extend(
                strategy_viability_markdown_lines(
                    support,
                    heading="## Frozen portfolio strategy viability",
                    lane_name=lane["name"],
                )
            )
            lines.extend(
                signal_monetization_markdown_lines(
                    support,
                    heading="## Frozen signal monetization bridge",
                    lane_name=lane["name"],
                )
            )
            lines.extend(
                rl_factor_fusion_diagnosis_markdown_lines(
                    support,
                    heading="## Frozen RL factor-fusion diagnosis",
                    lane_name=lane["name"],
                )
            )
    capacity_lanes = [
        lane
        for lane in evidence["lanes"]
        if isinstance(
            lane["leaderRun"]["metrics"].get("liquidity_capacity"),
            dict,
        )
    ]
    if capacity_lanes:
        lines.extend(["## Liquidity capacity", ""])
        for lane in capacity_lanes:
            capacity = lane["leaderRun"]["metrics"]["liquidity_capacity"]
            validation = capacity["validation"]
            conservative = validation["capacity_1pct"]
            lines.extend(
                [
                    f"- {lane['name']}: validation 1% participation capacity "
                    f"minimum / p10 / median = "
                    f"`{conservative['minimum_nav']}` / "
                    f"`{conservative['tenth_percentile_nav']}` / "
                    f"`{conservative['median_nav']}`",
                    f"- {lane['name']}: trade-date coverage / $1m breach "
                    f"rate = `{validation['trade_date_coverage']}` / "
                    f"`{conservative['reference_nav_breach_rate']}`",
                    f"- {lane['name']}: OHLCV participation envelope only; "
                    "contextual, not impact, fill, or capital authority.",
                ]
            )
        lines.append("")
    execution_risk_lanes = [
        lane
        for lane in evidence["lanes"]
        if isinstance(
            lane["leaderRun"]["metrics"].get("execution_risk"),
            dict,
        )
    ]
    if execution_risk_lanes:
        lines.extend(["## Executed-book risk compliance", ""])
        for lane in execution_risk_lanes:
            validation = lane["leaderRun"]["metrics"][
                "execution_risk"
            ]["validation"]
            lines.extend(
                [
                    f"- {lane['name']}: validation forecast coverage / "
                    f"pretrade breaches / risk-only overrides / executed "
                    f"breaches = `{validation['forecast_coverage']}` / "
                    f"`{validation['pretrade_breach_dates']}` / "
                    f"`{validation['risk_rebalance_override_dates']}` / "
                    f"`{validation['executed_breach_dates']}`",
                    f"- {lane['name']}: post-drift executed-book compliance "
                    "is contextual research evidence, not Broker, account, "
                    "capital, or order authority.",
                ]
            )
        lines.append("")
    policy_behavior_lanes = [
        lane
        for lane in evidence["lanes"]
        if isinstance(
            lane["leaderRun"]["metrics"].get("policy_rationale"),
            dict,
        )
    ]
    if policy_behavior_lanes:
        lines.extend(["## RL policy behavior and rationale", ""])
        for lane in policy_behavior_lanes:
            rationale = lane["leaderRun"]["metrics"]["policy_rationale"]
            validation = rationale["validation"]
            dominant = sorted(
                validation["by_feature"].items(),
                key=lambda item: (
                    -item[1]["dominant_rate"],
                    item[0],
                ),
            )[:3]
            lines.extend(
                [
                    f"- {lane['name']}: validation decisions / action runs / "
                    f"transition rate / mean run length = "
                    f"`{validation['decisions']}` / "
                    f"`{validation['action_runs']}` / "
                    f"`{validation['transition_rate']}` / "
                    f"`{validation['mean_action_run_length']}` bars",
                    f"- {lane['name']}: median uncalibrated Q margin / tie "
                    f"rate / single-bar-run rate = "
                    f"`{validation['median_action_margin']}` / "
                    f"`{validation['tie_rate']}` / "
                    f"`{validation['single_bar_run_rate']}`",
                    f"- {lane['name']}: dominant margin features = "
                    + ", ".join(
                        f"`{name}` ({values['dominant_rate']})"
                        for name, values in dominant
                    ),
                    f"- {lane['name']}: chosen-versus-runner-up feature "
                    "contributions exactly decompose an uncalibrated linear "
                    "Q margin; they are not confidence, probability, causal "
                    "importance, or trading authority.",
                ]
            )
        lines.append("")
    opportunity_lanes = [
        lane
        for lane in evidence["lanes"]
        if isinstance(
            lane["leaderRun"]["metrics"].get("factor_opportunity"),
            dict,
        )
    ]
    if opportunity_lanes:
        lines.extend(["## RL one-step factor opportunity", ""])
        for lane in opportunity_lanes:
            opportunity = lane["leaderRun"]["metrics"][
                "factor_opportunity"
            ]["validation"]
            candidate = opportunity["candidate"]
            oracle_mix = sorted(
                opportunity["by_action"].items(),
                key=lambda item: (
                    -item[1]["oracle_frequency"],
                    item[0],
                ),
            )
            lines.extend(
                [
                    f"- {lane['name']}: validation oracle-hit rate / mean "
                    f"selected rank / mean realized regret = "
                    f"`{opportunity['oracle_hit_rate']}` / "
                    f"`{opportunity['mean_selected_rank']}` / "
                    f"`{opportunity['mean_realized_regret']}`",
                    f"- {lane['name']}: candidate selected / locally best / "
                    f"missed-opportunity frequency = "
                    f"`{candidate['selected_frequency']}` / "
                    f"`{candidate['oracle_frequency']}` / "
                    f"`{candidate['missed_opportunity_rate']}`",
                    f"- {lane['name']}: candidate mean reward advantage versus "
                    f"selected / balanced; win rate versus balanced = "
                    f"`{candidate['mean_vs_selected_reward']}` / "
                    f"`{candidate['mean_vs_balanced_reward']}`; "
                    f"`{candidate['win_rate_vs_balanced']}`",
                    f"- {lane['name']}: ex-post local-best action mix = "
                    + ", ".join(
                        f"`{name}` ({values['oracle_frequency']})"
                        for name, values in oracle_mix
                    ),
                    f"- {lane['name']}: all alternatives start from the actual "
                    "policy pretrade book and end after one bar. The oracle is "
                    "a hindsight audit upper bound, not a strategy, selection "
                    "input, or trading authority.",
                ]
            )
        lines.append("")
    neighborhood_lanes = [
        lane
        for lane in evidence["lanes"]
        if isinstance(
            lane["leaderRun"]["metrics"].get(
                "parameter_neighborhood"
            ),
            dict,
        )
    ]
    if neighborhood_lanes:
        lines.extend(["## Mechanical parameter neighborhood", ""])
        for lane in neighborhood_lanes:
            neighborhood = lane["leaderRun"]["metrics"][
                "parameter_neighborhood"
            ]
            validation = neighborhood["validation"]["aggregate"]
            lines.extend(
                [
                    f"- {lane['name']}: validation configurations / "
                    f"positive-Sharpe rate / sign agreement with base = "
                    f"`{validation['configuration_count']}` / "
                    f"`{validation['positive_net_sharpe_rate']}` / "
                    f"`{validation['sign_agreement_with_base_rate']}`",
                    f"- {lane['name']}: minimum / median / maximum net "
                    f"Sharpe; worst delta versus base = "
                    f"`{validation['minimum_net_sharpe']}` / "
                    f"`{validation['median_net_sharpe']}` / "
                    f"`{validation['maximum_net_sharpe']}`; "
                    f"`{validation['worst_net_sharpe_delta']}`",
                    f"- {lane['name']}: predeclared local neighborhood only; "
                    "no cell is selected, promoted, or granted trading "
                    "authority.",
                ]
            )
        lines.append("")
    lifecycle_lanes = [
        lane
        for lane in evidence["lanes"]
        if isinstance(
            lane["leaderRun"]["metrics"].get("position_lifecycle"),
            dict,
        )
    ]
    if lifecycle_lanes:
        lines.extend(["## Mechanical position lifecycle", ""])
        for lane in lifecycle_lanes:
            validation = lane["leaderRun"]["metrics"][
                "position_lifecycle"
            ]["validation"]
            lines.extend(
                [
                    f"- {lane['name']}: validation complete episodes / win "
                    f"rate / median holding bars / payoff ratio = "
                    f"`{validation['complete_episodes']}` / "
                    f"`{validation['complete_episode_win_rate']}` / "
                    f"`{validation['median_complete_holding_bars']}` / "
                    f"`{validation['complete_payoff_ratio']}`",
                    f"- {lane['name']}: validation intent-mismatch rate / "
                    f"average segment MFE / MAE = "
                    f"`{validation['intent_mismatch_rate']}` / "
                    f"`{validation['average_segment_mfe']}` / "
                    f"`{validation['average_segment_mae']}`",
                    f"- {lane['name']}: split-bounded position episodes are "
                    "contextual additive contribution evidence, not "
                    "standalone trade returns or trading authority.",
                ]
            )
        lines.append("")
    lines.extend(["", "## Lane summaries", ""])
    for lane in evidence["lanes"]:
        integrity = lane["report"]["selectionIntegrity"]
        family = integrity.get("researchFamily")
        adjustment = integrity.get("selectionAdjustment")
        lines.extend(
            [
                f"### {lane['name']}",
                "",
                lane["report"]["executiveSummary"],
                "",
                f"Report: `{lane['report']['id']}`. "
                f"Leader: `{lane['leaderRun']['id']}`. "
                f"Harness: `{lane['report']['harness']['id']}@"
                f"{lane['report']['harness']['version']}`.",
                "",
                f"Selection warning: "
                f"{integrity['warning']}",
                *(
                    [
                        f"Test exposure: "
                        f"`{integrity['testExposureState']}`; "
                        f"post-audit candidate iterations="
                        f"`{integrity['postAuditCandidateIterations']}`; "
                        "actual test guidance is "
                        f"`{integrity['testGuidanceObservability']}`.",
                    ]
                    if "testExposureState" in integrity
                    else []
                ),
                "",
            ]
        )
        if isinstance(family, dict):
            lines.extend(
                [
                    f"Research family: `{family['id']}`; "
                    f"{family['uniqueSourceTrials']} unique sources across "
                    f"{family['totalExecutions']} executions; "
                    f"reproducible=`{family['reproducible']}`.",
                    "",
                ]
            )
        if isinstance(adjustment, dict):
            lines.extend(
                [
                    f"Selection adjustment: "
                    f"`{adjustment['method'] or adjustment['status']}`; "
                    f"passes {adjustment['confidenceLevel']:.0%}="
                    f"`{adjustment['passes']}`"
                    + (
                        f"; reason=`{adjustment['reason']}`."
                        if adjustment.get("reason")
                        else "."
                    ),
                    "",
                    f"Selection interpretation: "
                    f"{adjustment['interpretation']}",
                    "",
                ]
            )
    lines.extend(["## Cross-lane findings", ""])
    for finding in analysis["findings"]:
        references = ", ".join(
            _evidence_label(reference) for reference in finding["evidenceRefs"]
        )
        lines.extend(
            [
                f"### {finding['id']}",
                "",
                finding["claim"],
                "",
                f"Confidence: **{finding['confidence']}**. Evidence: "
                f"{references}.",
                "",
            ]
        )
    lines.extend(["## Recommendations", ""])
    if analysis["recommendations"]:
        for index, recommendation in enumerate(
            analysis["recommendations"],
            start=1,
        ):
            references = ", ".join(
                _evidence_label(reference)
                for reference in recommendation["evidenceRefs"]
            )
            conditions = (
                "; ".join(recommendation["conditions"])
                if recommendation["conditions"]
                else "none declared"
            )
            lines.extend(
                [
                    f"{index}. **{recommendation['action']}** — "
                    f"{recommendation['rationale']}",
                    "",
                    f"   Conditions: {conditions}. Evidence: {references}.",
                    "",
                ]
            )
    else:
        lines.extend(["No action recommendation was made.", ""])
    lines.extend(["## Omitted gated or optional lanes", ""])
    if evidence["omittedOptionalLanes"]:
        lines.extend(
            f"- **{lane['name']}** (`{lane['id']}`): {lane['reason']}"
            for lane in evidence["omittedOptionalLanes"]
        )
    else:
        lines.append("- No gated or optional lane was omitted.")
    lines.extend(["", "## Limitations", ""])
    lines.extend(
        [f"- {item}" for item in analysis["limitations"]]
        or ["- No additional limitations were declared."]
    )
    lines.extend(["", "## Unresolved questions", ""])
    lines.extend(
        [f"- {item}" for item in analysis["unresolvedQuestions"]]
        or ["- No unresolved questions were declared."]
    )
    lines.extend(
        [
            "",
            "## Reproducibility and OpenAlice handoff",
            "",
            f"- Dossier: `{dossier['id']}`",
            f"- Request hash: `{evidence['requestHash']}`",
            f"- Dataset hash: `{evidence['datasetHash']}`",
            f"- Dataset snapshot hash: `{evidence['datasetSnapshotHash']}`",
            f"- Research Program hash: `{evidence['program']['manifestHash']}`",
            f"- Included lanes: "
            + ", ".join(f"`{lane['id']}`" for lane in evidence["lanes"]),
            "",
            "Publish this exact Markdown through OpenAlice Inbox to let OpenAlice",
            "stamp authoritative Workspace, Session, and document-revision provenance.",
            "",
        ]
    )
    return "\n".join(lines)


def _dossiers_root(project: ProjectContext, *, create: bool) -> Path:
    root = confined_path(
        project.root_dir,
        DOSSIERS_DIRECTORY,
        "project/dossiers",
    )
    if root.is_symlink():
        raise AutoQuantValidationError(
            [_issue(root, "path.symlink", "Dossiers directory cannot be a symlink")]
        )
    if create:
        root.mkdir(exist_ok=True)
    if not root.is_dir():
        raise AutoQuantValidationError(
            [_issue(root, "dossier.directory", "Missing Project dossiers directory")]
        )
    return root


def _dossier_root(project: ProjectContext, dossier_id: str) -> Path:
    if not DOSSIER_ID.fullmatch(dossier_id):
        raise AutoQuantValidationError(
            [_issue(dossier_id, "dossier.id", "Invalid Research Dossier id")]
        )
    return confined_path(
        _dossiers_root(project, create=False),
        dossier_id,
        f"dossier/{dossier_id}",
    )


def _dossier_files(root: Path) -> dict[str, str]:
    files: dict[str, str] = {}
    for path in sorted(root.iterdir(), key=lambda item: item.name):
        if path.name == DOSSIER_MANIFEST:
            continue
        if path.is_symlink() or not path.is_file():
            raise AutoQuantValidationError(
                [_issue(path, "dossier.entry", "Dossier entries must be real files")]
            )
        files[path.name] = hash_file(path)
    return files


def publish_dossier(
    project: ProjectContext,
    analysis: dict[str, Any],
) -> DossierContext:
    normalized = validate_dossier_analysis(analysis)
    status, intake, internal = _readiness(project)
    if not status["ready"] or intake is None:
        raise AutoQuantValidationError(
            [
                _issue(
                    project.root_dir,
                    blocker["code"],
                    blocker["message"],
                )
                for blocker in status["blockers"]
            ]
            or [
                _issue(
                    project.root_dir,
                    "dossier.not-ready",
                    "Research Dossier evidence is not ready",
                )
            ]
        )
    evidence = _publication_evidence(project, intake, internal)
    _resolve_analysis_evidence(normalized, evidence, "analysis")
    published = datetime.now(timezone.utc)
    published_at = published.isoformat()
    stamp = published.strftime("%Y%m%dT%H%M%S%fZ")
    analysis_hash = hash_json(normalized)
    evidence_hash = hash_json(evidence)
    identity = hash_json(
        {
            "projectId": project.manifest.id,
            "requestHash": evidence["requestHash"],
            "analysisHash": analysis_hash,
            "evidenceHash": evidence_hash,
            "publishedAt": published_at,
        }
    )
    dossier_id = f"dossier-{stamp}-{identity[:12]}"
    root = _dossiers_root(project, create=True)
    target = confined_path(root, dossier_id, f"dossier/{dossier_id}")
    staging = root / f".{dossier_id}.creating"
    if target.exists() or target.is_symlink() or staging.exists():
        raise AutoQuantValidationError(
            [_issue(target, "dossier.collision", "Research Dossier already exists")]
        )
    dossier = {
        "schemaVersion": SCHEMA_VERSION,
        "kind": DOSSIER_KIND,
        "id": dossier_id,
        "authority": "quantitative-decision-support",
        "tradingAuthority": "none",
        "publishedAt": published_at,
        "project": {
            "id": project.manifest.id,
            "name": project.manifest.name,
        },
        "analysisHash": analysis_hash,
        "evidenceHash": evidence_hash,
        "analysis": normalized,
        "evidence": evidence,
        "openAliceHandoff": {
            "document": DOSSIER_MARKDOWN,
            "provenance": "openalice-authoritative-on-inbox-publication",
            "sourceContext": "caller-supplied-content-locked",
        },
    }
    try:
        staging.mkdir()
        _write_json(staging / DOSSIER_ANALYSIS, normalized)
        _write_json(staging / DOSSIER_RESULT, dossier)
        (staging / DOSSIER_MARKDOWN).write_text(
            _render_markdown(dossier),
            encoding="utf-8",
        )
        files = {
            path.name: hash_file(path)
            for path in sorted(staging.iterdir(), key=lambda item: item.name)
            if path.is_file()
        }
        manifest = {
            "schemaVersion": SCHEMA_VERSION,
            "id": dossier_id,
            "projectId": project.manifest.id,
            "completed": True,
            "dossierHash": files[DOSSIER_RESULT],
            "files": files,
        }
        _write_json(staging / DOSSIER_MANIFEST, manifest)
        os.replace(staging, target)
    except Exception:
        if staging.exists():
            shutil.rmtree(staging)
        raise
    return load_dossier(project, dossier_id)


def _validate_dossier_result(
    project: ProjectContext,
    dossier_id: str,
    dossier: dict[str, Any],
    path: Path,
) -> None:
    required = {
        "schemaVersion",
        "kind",
        "id",
        "authority",
        "tradingAuthority",
        "publishedAt",
        "project",
        "analysisHash",
        "evidenceHash",
        "analysis",
        "evidence",
        "openAliceHandoff",
    }
    issues = _strict_keys(dossier, required, path)
    if (
        dossier.get("schemaVersion") != SCHEMA_VERSION
        or dossier.get("kind") != DOSSIER_KIND
        or dossier.get("id") != dossier_id
        or dossier.get("authority") != "quantitative-decision-support"
        or dossier.get("tradingAuthority") != "none"
    ):
        issues.append(
            _issue(path, "dossier.identity", "Invalid Research Dossier identity")
        )
    if dossier.get("project") != {
        "id": project.manifest.id,
        "name": project.manifest.name,
    }:
        issues.append(
            _issue(f"{path}/project", "dossier.project", "Dossier Project differs")
        )
    if dossier.get("openAliceHandoff") != {
        "document": DOSSIER_MARKDOWN,
        "provenance": "openalice-authoritative-on-inbox-publication",
        "sourceContext": "caller-supplied-content-locked",
    }:
        issues.append(
            _issue(
                f"{path}/openAliceHandoff",
                "dossier.handoff",
                "Invalid OpenAlice handoff boundary",
            )
        )
    analysis = dossier.get("analysis")
    if not isinstance(analysis, dict):
        issues.append(_issue(f"{path}/analysis", "schema.type", "Invalid analysis"))
    else:
        try:
            normalized = validate_dossier_analysis(
                analysis,
                f"{path}/analysis",
            )
            if hash_json(normalized) != dossier.get("analysisHash"):
                issues.append(
                    _issue(
                        f"{path}/analysisHash",
                        "dossier.analysis-hash",
                        "Analysis hash mismatch",
                    )
                )
        except AutoQuantValidationError as error:
            issues.extend(error.issues)
    evidence = dossier.get("evidence")
    if (
        not isinstance(evidence, dict)
        or hash_json(evidence) != dossier.get("evidenceHash")
    ):
        issues.append(
            _issue(
                f"{path}/evidenceHash",
                "dossier.evidence-hash",
                "Evidence hash mismatch",
            )
        )
    for key in ("analysisHash", "evidenceHash"):
        if not isinstance(dossier.get(key), str) or not SHA256.fullmatch(
            dossier.get(key, "")
        ):
            issues.append(_issue(f"{path}/{key}", "schema.hash", f"Invalid {key}"))
    published_at = dossier.get("publishedAt")
    if not isinstance(published_at, str):
        issues.append(
            _issue(f"{path}/publishedAt", "schema.string", "Invalid publishedAt")
        )
    else:
        try:
            published = datetime.fromisoformat(published_at)
            if (
                published.utcoffset() is None
                or published.utcoffset().total_seconds() != 0
            ):
                raise ValueError("publishedAt must be UTC")
            stamp = published.strftime("%Y%m%dT%H%M%S%fZ")
            identity = hash_json(
                {
                    "projectId": project.manifest.id,
                    "requestHash": (
                        dossier.get("evidence", {}).get("requestHash")
                        if isinstance(dossier.get("evidence"), dict)
                        else None
                    ),
                    "analysisHash": dossier.get("analysisHash"),
                    "evidenceHash": dossier.get("evidenceHash"),
                    "publishedAt": published_at,
                }
            )
            if dossier_id != f"dossier-{stamp}-{identity[:12]}":
                issues.append(
                    _issue(
                        path,
                        "dossier.derived-id",
                        "Research Dossier id is not derived",
                    )
                )
        except ValueError:
            issues.append(
                _issue(
                    f"{path}/publishedAt",
                    "schema.datetime",
                    "Invalid publishedAt",
                )
            )
    if issues:
        raise AutoQuantValidationError(issues)


def _verify_frozen_evidence(
    project: ProjectContext,
    dossier: dict[str, Any],
    path: Path,
) -> None:
    evidence = dossier["evidence"]
    required = {
        "request",
        "requestHash",
        "dataset",
        "datasetSnapshotHash",
        "datasetHash",
        "program",
        "lanes",
        "omittedOptionalLanes",
    }
    if not isinstance(evidence, dict):
        raise AutoQuantValidationError(
            [_issue(path, "dossier.evidence", "Evidence must be an object")]
        )
    issues = _strict_keys(evidence, required, f"{path}/evidence")
    intake = load_project_intake(project)
    if intake is None:
        issues.append(
            _issue(path, "dossier.intake", "Project intake is no longer available")
        )
    else:
        expected_intake = {
            "request": intake["request"],
            "requestHash": intake["manifest"]["requestHash"],
            "dataset": intake["dataset"],
            "datasetSnapshotHash": intake["manifest"]["datasetSnapshotHash"],
            "datasetHash": intake["manifest"]["datasetHash"],
        }
        for key, value in expected_intake.items():
            if evidence.get(key) != value:
                issues.append(
                    _issue(
                        path,
                        "dossier.intake-evidence",
                        f"Frozen {key} differs from Project intake",
                    )
                )
    program_path = project.root_dir / RESEARCH_PROGRAM_MANIFEST
    program_manifest = _read_json(program_path, "research program manifest")
    expected_program = {
        "manifest": program_manifest,
        "manifestHash": hash_file(program_path),
        "datasetHash": evidence.get("datasetHash"),
    }
    if evidence.get("program") != expected_program:
        issues.append(
            _issue(
                path,
                "dossier.program-evidence",
                "Frozen Research Program identity differs",
            )
        )
    lanes = evidence.get("lanes")
    if not isinstance(lanes, list) or not lanes:
        issues.append(
            _issue(path, "dossier.lanes", "Dossier must freeze included lanes")
        )
        lanes = []
    lane_ids: list[str] = []
    for lane in lanes:
        if not isinstance(lane, dict):
            issues.append(_issue(path, "dossier.lane", "Invalid frozen lane"))
            continue
        lane_id = lane.get("id")
        lane_ids.append(lane_id)
        report_projection = lane.get("report", {})
        anchor = report_projection.get("anchor", {})
        report_id = report_projection.get("id")
        if not isinstance(report_id, str) or not isinstance(anchor, dict):
            issues.append(
                _issue(path, "dossier.report", "Invalid frozen lane Report identity")
            )
            continue
        if anchor.get("kind") == "run" and anchor.get("sessionId") is None:
            report = load_run_report(project, report_id)
        elif (
            anchor.get("kind") == "session"
            and isinstance(anchor.get("sessionId"), str)
        ):
            session = load_session(project, anchor["sessionId"])
            report = load_report(project, session, report_id)
        else:
            issues.append(
                _issue(path, "dossier.report-anchor", "Invalid frozen lane Report anchor")
            )
            continue
        expected_report = _report_projection(report)
        if lane.get("report") != expected_report:
            issues.append(
                _issue(
                    path,
                    "dossier.report-evidence",
                    f"Frozen Report differs for lane {lane_id}",
                )
            )
        leader_id = lane.get("leaderRun", {}).get("id")
        if not isinstance(leader_id, str):
            issues.append(
                _issue(path, "dossier.leader", f"Invalid leader for lane {lane_id}")
            )
            continue
        run = load_run(project, leader_id)
        if lane.get("leaderRun") != _run_projection(run):
            issues.append(
                _issue(
                    path,
                    "dossier.run-evidence",
                    f"Frozen leader Run differs for lane {lane_id}",
                )
            )
        if expected_report["leader"]["runId"] != leader_id:
            issues.append(
                _issue(
                    path,
                    "dossier.leader-report",
                    f"Lane {lane_id} leader differs from its Report",
                )
            )
    if len(lane_ids) != len(set(lane_ids)):
        issues.append(
            _issue(path, "dossier.duplicate-lane", "Frozen lane ids must be unique")
        )
    required_ids = {"factor"}
    factor_lane = next(
        (
            lane
            for lane in lanes
            if isinstance(lane, dict) and lane.get("id") == "factor"
        ),
        None,
    )
    factor_support = (
        factor_lane.get("report", {}).get("leaderDecisionSupport")
        if isinstance(factor_lane, dict)
        else None
    )
    factor_qualification = (
        factor_support.get("factorQualification")
        if isinstance(factor_support, dict)
        else None
    )
    factor_diagnosis = (
        factor_qualification.get("diagnosis")
        if isinstance(factor_qualification, dict)
        and factor_qualification.get("available")
        else None
    )
    if (
        isinstance(factor_diagnosis, dict)
        and factor_diagnosis.get("qualifiesForPortfolio") is True
    ):
        required_ids.add("portfolio")
    if not required_ids.issubset(set(lane_ids)):
        issues.append(
            _issue(
                path,
                "dossier.required-lanes",
                "Frozen Dossier does not cover every required lane",
            )
        )
    omitted = evidence.get("omittedOptionalLanes")
    if not isinstance(omitted, list):
        issues.append(
            _issue(
                path,
                "dossier.omitted-lanes",
                "omittedOptionalLanes must be an array",
            )
        )
    try:
        _resolve_analysis_evidence(dossier["analysis"], evidence, path)
    except AutoQuantValidationError as error:
        issues.extend(error.issues)
    if issues:
        raise AutoQuantValidationError(issues)


def load_dossier(
    project: ProjectContext,
    dossier_id: str,
) -> DossierContext:
    root = _dossier_root(project, dossier_id)
    if root.is_symlink() or not root.is_dir():
        raise AutoQuantValidationError(
            [_issue(root, "dossier.missing", f"Unknown Research Dossier: {dossier_id}")]
        )
    manifest = _read_json(root / DOSSIER_MANIFEST, "dossier manifest")
    required = {
        "schemaVersion",
        "id",
        "projectId",
        "completed",
        "dossierHash",
        "files",
    }
    issues = _strict_keys(manifest, required, root / DOSSIER_MANIFEST)
    if (
        manifest.get("schemaVersion") != SCHEMA_VERSION
        or manifest.get("id") != dossier_id
        or manifest.get("projectId") != project.manifest.id
        or manifest.get("completed") is not True
    ):
        issues.append(
            _issue(
                root / DOSSIER_MANIFEST,
                "dossier.manifest",
                "Invalid terminal Dossier manifest",
            )
        )
    files = manifest.get("files")
    actual = _dossier_files(root)
    if not isinstance(files, dict) or files != actual:
        issues.append(_issue(root, "dossier.tampered", "Research Dossier files changed"))
    if isinstance(files, dict) and files.get(DOSSIER_RESULT) != manifest.get(
        "dossierHash"
    ):
        issues.append(
            _issue(root, "dossier.result-hash", "Research Dossier hash mismatch")
        )
    if issues:
        raise AutoQuantValidationError(issues)
    analysis = validate_dossier_analysis(
        _read_json(root / DOSSIER_ANALYSIS, "dossier analysis"),
        root / DOSSIER_ANALYSIS,
    )
    dossier = _read_json(root / DOSSIER_RESULT, "research dossier")
    _validate_dossier_result(project, dossier_id, dossier, root / DOSSIER_RESULT)
    if dossier["analysis"] != analysis:
        raise AutoQuantValidationError(
            [_issue(root, "dossier.analysis", "Stored analysis differs from Dossier")]
        )
    if (root / DOSSIER_MARKDOWN).read_text(encoding="utf-8") != _render_markdown(
        dossier
    ):
        raise AutoQuantValidationError(
            [
                _issue(
                    root / DOSSIER_MARKDOWN,
                    "dossier.markdown",
                    "Dossier Markdown is not canonical",
                )
            ]
        )
    _verify_frozen_evidence(project, dossier, root / DOSSIER_RESULT)
    return DossierContext(root, manifest, dossier, analysis)


def list_dossiers(project: ProjectContext) -> list[DossierSummary]:
    root = project.root_dir / DOSSIERS_DIRECTORY
    if not root.exists():
        return []
    root = _dossiers_root(project, create=False)
    summaries: list[DossierSummary] = []
    for entry in sorted(root.iterdir(), key=lambda item: item.name):
        if entry.name.startswith("."):
            continue
        if entry.is_symlink() or not entry.is_dir():
            raise AutoQuantValidationError(
                [_issue(entry, "dossier.entry", "Dossier entries must be real directories")]
            )
        dossier = load_dossier(project, entry.name)
        summaries.append(
            DossierSummary(
                id=dossier.dossier["id"],
                title=dossier.analysis["title"],
                published_at=dossier.dossier["publishedAt"],
                included_lanes=[
                    lane["id"] for lane in dossier.dossier["evidence"]["lanes"]
                ],
                omitted_optional_lanes=[
                    lane["id"]
                    for lane in dossier.dossier["evidence"][
                        "omittedOptionalLanes"
                    ]
                ],
                findings=len(dossier.analysis["findings"]),
                recommendations=len(dossier.analysis["recommendations"]),
                path=str(dossier.root_dir),
                markdown_path=str(dossier.root_dir / DOSSIER_MARKDOWN),
                executive_summary=dossier.analysis["executiveSummary"],
                authority=dossier.dossier["authority"],
                evidence_hash=dossier.dossier["evidenceHash"],
            )
        )
    return summaries


DOSSIER_EVIDENCE_REFERENCE_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["laneId", "reportId", "findingId"],
    "properties": {
        "laneId": {"type": "string", "pattern": LANE_ID.pattern},
        "reportId": {"type": "string", "pattern": REPORT_ID.pattern},
        "findingId": {
            "anyOf": [
                {"type": "null"},
                {"type": "string", "pattern": FINDING_ID.pattern},
            ]
        },
    },
}


DOSSIER_ANALYSIS_JSON_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "AutoQuant Agent-authored cross-lane Dossier analysis",
    "type": "object",
    "additionalProperties": False,
    "required": [
        "schemaVersion",
        "kind",
        "title",
        "executiveSummary",
        "findings",
        "recommendations",
        "limitations",
        "unresolvedQuestions",
    ],
    "properties": {
        "schemaVersion": {"const": SCHEMA_VERSION},
        "kind": {"const": DOSSIER_ANALYSIS_KIND},
        "title": {"type": "string", "minLength": 1},
        "executiveSummary": {"type": "string", "minLength": 1},
        "findings": {
            "type": "array",
            "minItems": 1,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["id", "claim", "confidence", "evidenceRefs"],
                "properties": {
                    "id": {"type": "string", "pattern": FINDING_ID.pattern},
                    "claim": {"type": "string", "minLength": 1},
                    "confidence": {"enum": sorted(CONFIDENCE_LEVELS)},
                    "evidenceRefs": {
                        "type": "array",
                        "minItems": 1,
                        "items": DOSSIER_EVIDENCE_REFERENCE_JSON_SCHEMA,
                    },
                },
            },
        },
        "recommendations": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["action", "rationale", "conditions", "evidenceRefs"],
                "properties": {
                    "action": {"type": "string", "minLength": 1},
                    "rationale": {"type": "string", "minLength": 1},
                    "conditions": {
                        "type": "array",
                        "items": {"type": "string", "minLength": 1},
                    },
                    "evidenceRefs": {
                        "type": "array",
                        "minItems": 1,
                        "items": DOSSIER_EVIDENCE_REFERENCE_JSON_SCHEMA,
                    },
                },
            },
        },
        "limitations": {
            "type": "array",
            "items": {"type": "string", "minLength": 1},
        },
        "unresolvedQuestions": {
            "type": "array",
            "items": {"type": "string", "minLength": 1},
        },
    },
}


DOSSIER_STATUS_JSON_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "AutoQuant Project Research Dossier readiness",
    "type": "object",
    "additionalProperties": False,
    "required": [
        "schemaVersion",
        "kind",
        "ready",
        "project",
        "request",
        "dataset",
        "program",
        "lanes",
        "includedLaneIds",
        "omittedOptionalLanes",
        "blockers",
        "latestDossier",
        "nextAction",
    ],
    "properties": {
        "schemaVersion": {"const": SCHEMA_VERSION},
        "kind": {"const": DOSSIER_STATUS_KIND},
        "ready": {"type": "boolean"},
        "project": {"type": "object"},
        "request": {"type": ["object", "null"]},
        "dataset": {"type": ["object", "null"]},
        "program": {"type": "object"},
        "lanes": {"type": "array", "items": {"type": "object"}},
        "includedLaneIds": {
            "type": "array",
            "items": {"type": "string", "pattern": LANE_ID.pattern},
        },
        "omittedOptionalLanes": {
            "type": "array",
            "items": {"type": "object"},
        },
        "blockers": {"type": "array", "items": {"type": "object"}},
        "latestDossier": {"type": ["object", "null"]},
        "nextAction": {"type": ["object", "null"]},
    },
}


DOSSIER_RESULT_JSON_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "AutoQuant immutable Project Research Dossier",
    "type": "object",
    "additionalProperties": False,
    "required": [
        "schemaVersion",
        "kind",
        "id",
        "authority",
        "tradingAuthority",
        "publishedAt",
        "project",
        "analysisHash",
        "evidenceHash",
        "analysis",
        "evidence",
        "openAliceHandoff",
    ],
    "properties": {
        "schemaVersion": {"const": SCHEMA_VERSION},
        "kind": {"const": DOSSIER_KIND},
        "id": {"type": "string", "pattern": DOSSIER_ID.pattern},
        "authority": {"const": "quantitative-decision-support"},
        "tradingAuthority": {"const": "none"},
        "publishedAt": {"type": "string", "minLength": 1},
        "project": {"type": "object"},
        "analysisHash": {"type": "string", "pattern": SHA256.pattern},
        "evidenceHash": {"type": "string", "pattern": SHA256.pattern},
        "analysis": DOSSIER_ANALYSIS_JSON_SCHEMA,
        "evidence": {"type": "object"},
        "openAliceHandoff": {"type": "object"},
    },
}
