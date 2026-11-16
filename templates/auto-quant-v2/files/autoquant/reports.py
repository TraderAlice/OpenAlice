"""Immutable evidence-bound Research Reports."""

from __future__ import annotations

import json
import os
import re
import shutil
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any

from .decision_support import (
    build_leader_decision_support,
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
    verify_leader_decision_support,
)
from .research import list_campaigns, load_campaign
from .runs import load_run
from .sessions import (
    SessionContext,
    build_selection_integrity,
    list_experiments,
    load_experiment,
    load_session,
    validate_session_authority,
)
from .studies import hash_file, hash_json
from .workspace import (
    SCHEMA_VERSION,
    AutoQuantValidationError,
    ProjectContext,
    ValidationIssue,
    confined_path,
)


REPORT_ANALYSIS = "analysis.json"
REPORT_RESULT = "report.json"
REPORT_MARKDOWN = "report.md"
REPORT_MANIFEST = "manifest.json"
REPORT_ANALYSIS_KIND = "autoquant-research-report-analysis"
REPORT_ANALYSIS_AUTHORING_STATES = {"draft", "final"}
REPORT_DRAFT_FINDING_ID = "draft-replace-with-evidence-backed-finding"
REPORT_KIND = "autoquant-research-report"
REPORT_ID = re.compile(
    r"^report-[0-9]{8}T[0-9]{12}Z-[0-9a-f]{12}$"
)
FINDING_ID = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
CONFIDENCE_LEVELS = {"low", "medium", "high"}
EVIDENCE_KINDS = {"run", "experiment", "campaign"}
SHA256 = re.compile(r"^[0-9a-f]{64}$")


@dataclass(frozen=True)
class ReportContext:
    root_dir: Path
    manifest: dict[str, Any]
    report: dict[str, Any]
    analysis: dict[str, Any]


@dataclass(frozen=True)
class ReportSummary:
    id: str
    title: str
    session_id: str | None
    leader_run_id: str
    findings: int
    recommendations: int
    published_at: str
    path: str
    markdown_path: str
    executive_summary: str
    authority: str
    leader_decision_support: dict[str, Any]
    selection_integrity: dict[str, Any]
    anchor_kind: str = "session"
    study_id: str | None = None
    correction: dict[str, Any] | None = None
    current: bool | None = None
    superseded_by: str | None = None
    lineage_depth: int | None = None

    def to_dict(self) -> dict[str, Any]:
        value = {
            "id": self.id,
            "title": self.title,
            "sessionId": self.session_id,
            "anchor": {
                "kind": self.anchor_kind,
                "studyId": self.study_id,
                "runId": self.leader_run_id,
                "sessionId": self.session_id,
            },
            "leaderRunId": self.leader_run_id,
            "findings": self.findings,
            "recommendations": self.recommendations,
            "publishedAt": self.published_at,
            "path": self.path,
            "markdownPath": self.markdown_path,
            "executiveSummary": self.executive_summary,
            "authority": self.authority,
            "leaderDecisionSupport": self.leader_decision_support,
            "selectionIntegrity": self.selection_integrity,
        }
        if self.current is not None:
            value.update(
                {
                    "correction": self.correction,
                    "current": self.current,
                    "supersededBy": self.superseded_by,
                    "lineageDepth": self.lineage_depth,
                }
            )
        return value


def _issue(path: Path | str, code: str, message: str) -> ValidationIssue:
    return ValidationIssue(str(path), code, message)


def _strict_keys(
    value: dict[str, Any],
    required: set[str],
    path: Path | str,
    *,
    optional: set[str] | None = None,
) -> list[ValidationIssue]:
    allowed = required | (optional or set())
    issues = [
        _issue(f"{path}/{key}", "schema.missing", f"Missing required field '{key}'")
        for key in sorted(required - value.keys())
    ]
    issues.extend(
        _issue(f"{path}/{key}", "schema.unknown", f"Unknown field '{key}'")
        for key in sorted(value.keys() - allowed)
    )
    return issues


def _read_json(path: Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise AutoQuantValidationError(
            [_issue(path, f"{label}.missing", f"Missing {label}: {path}")]
        ) from None
    except json.JSONDecodeError as error:
        raise AutoQuantValidationError(
            [
                _issue(
                    path,
                    f"{label}.json",
                    f"Invalid JSON at line {error.lineno}, column "
                    f"{error.colno}: {error.msg}",
                )
            ]
        ) from None
    if not isinstance(value, dict):
        raise AutoQuantValidationError(
            [_issue(path, f"{label}.type", f"{label} must be a JSON object")]
        )
    return value


def _write_json(path: Path, value: Any) -> None:
    path.write_text(
        json.dumps(value, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _non_empty(value: Any, path: str) -> list[ValidationIssue]:
    if not isinstance(value, str) or not value.strip():
        return [_issue(path, "schema.string", "Must be a non-empty string")]
    return []


def _string_list(
    value: Any,
    path: str,
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
    path: str,
) -> tuple[list[dict[str, Any]], list[ValidationIssue]]:
    issues: list[ValidationIssue] = []
    if not isinstance(value, list) or not value:
        return [], [
            _issue(
                path,
                "schema.array",
                "evidenceRefs must contain at least one reference",
            )
        ]
    normalized: list[dict[str, Any]] = []
    identities: list[tuple[Any, Any, Any]] = []
    for index, reference in enumerate(value):
        ref_path = f"{path}/{index}"
        if not isinstance(reference, dict):
            issues.append(
                _issue(ref_path, "schema.type", "Evidence reference must be an object")
            )
            continue
        issues.extend(
            _strict_keys(reference, {"kind", "id", "artifactPath"}, ref_path)
        )
        if reference.get("kind") not in EVIDENCE_KINDS:
            issues.append(
                _issue(f"{ref_path}/kind", "schema.choice", "Invalid evidence kind")
            )
        issues.extend(_non_empty(reference.get("id"), f"{ref_path}/id"))
        artifact_path = reference.get("artifactPath")
        if artifact_path is not None:
            issues.extend(_non_empty(artifact_path, f"{ref_path}/artifactPath"))
            if isinstance(artifact_path, str):
                candidate = PurePosixPath(artifact_path)
                if (
                    candidate.is_absolute()
                    or ".." in candidate.parts
                    or "\\" in artifact_path
                ):
                    issues.append(
                        _issue(
                            f"{ref_path}/artifactPath",
                            "schema.path",
                            "artifactPath must be a confined POSIX relative path",
                        )
                    )
        if reference.get("kind") != "run" and artifact_path is not None:
            issues.append(
                _issue(
                    f"{ref_path}/artifactPath",
                    "report.artifact-kind",
                    "Only Run evidence may reference a declared artifact",
                )
            )
        normalized_ref = {
            "kind": reference.get("kind"),
            "id": reference.get("id"),
            "artifactPath": artifact_path,
        }
        normalized.append(normalized_ref)
        identities.append(
            (
                normalized_ref["kind"],
                normalized_ref["id"],
                normalized_ref["artifactPath"],
            )
        )
    if len(identities) != len(set(identities)):
        issues.append(
            _issue(path, "report.duplicate-evidence", "Evidence references must be unique")
        )
    return normalized, issues


def validate_report_analysis(
    value: dict[str, Any],
    path: Path | str = "report-analysis",
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
    issues = _strict_keys(
        value,
        required,
        path,
        optional={"authoringState"},
    )
    if value.get("schemaVersion") != SCHEMA_VERSION:
        issues.append(_issue(f"{path}/schemaVersion", "schema.version", "Expected V1"))
    if value.get("kind") != REPORT_ANALYSIS_KIND:
        issues.append(
            _issue(
                f"{path}/kind",
                "report.kind",
                f"Expected {REPORT_ANALYSIS_KIND}",
            )
        )
    for key in ("title", "executiveSummary"):
        issues.extend(_non_empty(value.get(key), f"{path}/{key}"))
    authoring_state = value.get("authoringState")
    if (
        authoring_state is not None
        and authoring_state not in REPORT_ANALYSIS_AUTHORING_STATES
    ):
        issues.append(
            _issue(
                f"{path}/authoringState",
                "schema.choice",
                "authoringState must be draft or final when declared",
            )
        )
    for key in ("limitations", "unresolvedQuestions"):
        issues.extend(
            _string_list(value.get(key), f"{path}/{key}", allow_empty=True)
        )

    findings = value.get("findings")
    normalized_findings: list[dict[str, Any]] = []
    finding_ids: list[str] = []
    if not isinstance(findings, list) or not findings:
        issues.append(
            _issue(
                f"{path}/findings",
                "schema.array",
                "Findings must contain at least one item",
            )
        )
        findings = []
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
        refs, ref_issues = _validate_evidence_refs(
            finding.get("evidenceRefs"),
            f"{finding_path}/evidenceRefs",
        )
        issues.extend(ref_issues)
        normalized_findings.append(
            {
                "id": finding_id,
                "claim": (
                    finding["claim"].strip()
                    if isinstance(finding.get("claim"), str)
                    else finding.get("claim")
                ),
                "confidence": finding.get("confidence"),
                "evidenceRefs": refs,
            }
        )
    if len(finding_ids) != len(set(finding_ids)):
        issues.append(
            _issue(f"{path}/findings", "report.duplicate-finding", "Finding ids must be unique")
        )

    recommendations = value.get("recommendations")
    normalized_recommendations: list[dict[str, Any]] = []
    if not isinstance(recommendations, list):
        issues.append(
            _issue(
                f"{path}/recommendations",
                "schema.array",
                "Recommendations must be an array",
            )
        )
        recommendations = []
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
        refs, ref_issues = _validate_evidence_refs(
            recommendation.get("evidenceRefs"),
            f"{recommendation_path}/evidenceRefs",
        )
        issues.extend(ref_issues)
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
                "evidenceRefs": refs,
            }
        )
    if issues:
        raise AutoQuantValidationError(issues)
    normalized = {
        "schemaVersion": SCHEMA_VERSION,
        "kind": REPORT_ANALYSIS_KIND,
        "title": value["title"].strip(),
        "executiveSummary": value["executiveSummary"].strip(),
        "findings": normalized_findings,
        "recommendations": normalized_recommendations,
        "limitations": [item.strip() for item in value["limitations"]],
        "unresolvedQuestions": [
            item.strip() for item in value["unresolvedQuestions"]
        ],
    }
    if authoring_state is not None:
        normalized["authoringState"] = authoring_state
    return normalized


def validate_publishable_report_analysis(
    value: dict[str, Any],
    path: Path | str = "report-analysis",
) -> dict[str, Any]:
    """Validate final Report analysis and reject an unfinished scaffold."""

    normalized = validate_report_analysis(value, path)
    issues: list[ValidationIssue] = []
    if normalized.get("authoringState") == "draft":
        issues.append(
            _issue(
                f"{path}/authoringState",
                "report.draft-incomplete",
                "Report draft cannot be published; replace every placeholder "
                "and set authoringState to final",
            )
        )
    if any(
        finding["id"] == REPORT_DRAFT_FINDING_ID
        for finding in normalized["findings"]
    ):
        issues.append(
            _issue(
                f"{path}/findings",
                "report.draft-placeholder",
                "Replace the reserved draft finding before publication",
            )
        )
    if issues:
        raise AutoQuantValidationError(issues)
    return normalized


def build_report_analysis_draft(
    run: Any,
    *,
    title: str,
) -> dict[str, Any]:
    """Build one schema-valid, explicitly non-publishable authoring scaffold."""

    references = [
        {
            "kind": "run",
            "id": run.result["id"],
            "artifactPath": artifact["path"],
        }
        for artifact in run.result.get("artifacts", [])
        if isinstance(artifact, dict)
        and isinstance(artifact.get("path"), str)
    ]
    if not references:
        references = [
            {
                "kind": "run",
                "id": run.result["id"],
                "artifactPath": None,
            }
        ]
    return validate_report_analysis(
        {
            "schemaVersion": SCHEMA_VERSION,
            "kind": REPORT_ANALYSIS_KIND,
            "authoringState": "draft",
            "title": f"DRAFT — {title}",
            "executiveSummary": (
                "Replace this scaffold with a concise conclusion supported "
                "by the selected immutable evidence."
            ),
            "findings": [
                {
                    "id": REPORT_DRAFT_FINDING_ID,
                    "claim": (
                        "Replace this instructional placeholder with one "
                        "evidence-backed finding."
                    ),
                    "confidence": "low",
                    "evidenceRefs": references,
                }
            ],
            "recommendations": [],
            "limitations": [
                "DRAFT SCAFFOLD: replace all placeholder prose and set "
                "authoringState to final before publication."
            ],
            "unresolvedQuestions": [],
        }
    )


def build_session_report_analysis_draft(
    project: ProjectContext,
    session_id: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Build a draft only after the delegated Session anchor is reportable."""

    session = load_session(project, session_id)
    if session.manifest["status"] != "active":
        raise AutoQuantValidationError(
            [
                _issue(
                    session.manifest_path,
                    "report.session-closed",
                    "Report drafts require one active Session",
                )
            ]
        )
    if session.delegation is None:
        raise AutoQuantValidationError(
            [
                _issue(
                    session.manifest_path,
                    "report.request-required",
                    "Report drafts require a delegated Session brief",
                )
            ]
        )
    validate_session_authority(project, session)
    anchor = {
        "kind": "session",
        "studyId": session.manifest["studyId"],
        "runId": session.leader_run.result["id"],
        "sessionId": session.manifest["id"],
    }
    return (
        build_report_analysis_draft(
            session.leader_run,
            title=f"{session.delegation['request']['title']} evidence conclusion",
        ),
        anchor,
    )


def load_report_analysis(path: str | Path) -> dict[str, Any]:
    analysis_path = Path(path).expanduser().absolute()
    return validate_report_analysis(
        _read_json(analysis_path, "report analysis"),
        analysis_path,
    )


def _reports_root(session: SessionContext, *, create: bool) -> Path:
    root = confined_path(session.root_dir, "reports", "session/reports")
    if root.is_symlink():
        raise AutoQuantValidationError(
            [_issue(root, "path.symlink", "Reports directory cannot be a symlink")]
        )
    if create:
        root.mkdir(exist_ok=True)
    if not root.is_dir():
        raise AutoQuantValidationError(
            [_issue(root, "report.directory", "Missing Session reports directory")]
        )
    return root


def _report_root(session: SessionContext, report_id: str) -> Path:
    if not REPORT_ID.fullmatch(report_id):
        raise AutoQuantValidationError(
            [_issue(report_id, "report.id", "Invalid Research Report id")]
        )
    return confined_path(_reports_root(session, create=False), report_id, report_id)


def _session_evidence(
    project: ProjectContext,
    session: SessionContext,
    *,
    selection_cutoff: str | None = None,
) -> tuple[dict[str, Any], dict[tuple[str, str], dict[str, Any]]]:
    experiments = [
        load_experiment(project, session, summary.id)
        for summary in list_experiments(project, session)
    ]
    campaigns = [
        load_campaign(project, session, summary.id)
        for summary in list_campaigns(project, session)
    ]
    run_ids = {
        session.manifest["baseline"]["runId"],
        session.manifest["leader"]["runId"],
        *(item.result["candidate"]["runId"] for item in experiments),
    }
    runs = [load_run(project, run_id) for run_id in sorted(run_ids)]
    catalog: dict[tuple[str, str], dict[str, Any]] = {}
    run_evidence: list[dict[str, Any]] = []
    for run in runs:
        item = {
            "id": run.result["id"],
            "resultHash": run.manifest["resultHash"],
            "status": run.result["status"],
            "summary": run.result["summary"],
            "subject": run.result["subject"],
            "dataset": run.result["dataset"],
            "objective": run.result["objective"],
            "metrics": run.result["metrics"],
            "artifacts": run.result["artifacts"],
            **(
                {"dependencies": run.result["dependencies"]}
                if "dependencies" in run.result
                else {}
            ),
        }
        run_evidence.append(item)
        catalog[("run", item["id"])] = item
    experiment_evidence: list[dict[str, Any]] = []
    for experiment in experiments:
        item = {
            "id": experiment.result["id"],
            "resultHash": experiment.manifest["resultHash"],
            "sequence": experiment.result["sequence"],
            "hypothesis": experiment.result["hypothesis"],
            "verdict": experiment.result["verdict"],
            "candidate": experiment.result["candidate"],
            "improvement": experiment.result["improvement"],
        }
        experiment_evidence.append(item)
        catalog[("experiment", item["id"])] = item
    campaign_evidence: list[dict[str, Any]] = []
    for campaign in campaigns:
        item = {
            "id": campaign.result["id"],
            "resultHash": campaign.manifest["resultHash"],
            "status": campaign.result["status"],
            "reason": campaign.result["reason"],
            "turnsCompleted": campaign.result["turnsCompleted"],
            "experiments": campaign.result["experiments"],
            "verdicts": campaign.result["verdicts"],
        }
        campaign_evidence.append(item)
        catalog[("campaign", item["id"])] = item
    snapshot = {
        "session": {
            "id": session.manifest["id"],
            "status": session.manifest["status"],
            "studyId": session.manifest["studyId"],
            "brief": session.manifest["brief"],
            "baseline": session.manifest["baseline"],
            "leader": session.manifest["leader"],
            "locks": {
                key: value
                for key, value in session.manifest["locks"].items()
                if key != "fixedHashes"
            },
        },
        "selectionIntegrity": build_selection_integrity(
            project,
            session.leader_run,
            [item.result["verdict"] for item in experiments],
            cutoff=selection_cutoff,
        ),
        "runs": run_evidence,
        "experiments": experiment_evidence,
        "campaigns": campaign_evidence,
        "leaderDecisionSupport": build_leader_decision_support(
            project,
            session.manifest["leader"]["runId"],
        ),
    }
    return snapshot, catalog


def _resolve_analysis_evidence(
    analysis: dict[str, Any],
    catalog: dict[tuple[str, str], dict[str, Any]],
    path: Path | str,
) -> None:
    issues: list[ValidationIssue] = []
    references = [
        reference
        for owner in [*analysis["findings"], *analysis["recommendations"]]
        for reference in owner["evidenceRefs"]
    ]
    for index, reference in enumerate(references):
        evidence = catalog.get((reference["kind"], reference["id"]))
        if evidence is None:
            issues.append(
                _issue(
                    f"{path}/evidenceRefs/{index}",
                    "report.unknown-evidence",
                    f"Unknown Session evidence: {reference['kind']}:{reference['id']}",
                )
            )
            continue
        artifact_path = reference["artifactPath"]
        if artifact_path is not None:
            available = {
                artifact["path"]
                for artifact in evidence.get("artifacts", [])
                if isinstance(artifact, dict) and isinstance(artifact.get("path"), str)
            }
            if artifact_path not in available:
                issues.append(
                    _issue(
                        f"{path}/evidenceRefs/{index}/artifactPath",
                        "report.unknown-artifact",
                        f"Run {reference['id']} does not declare artifact {artifact_path}",
                    )
                )
    if issues:
        raise AutoQuantValidationError(issues)


def _evidence_label(reference: dict[str, Any]) -> str:
    label = f"{reference['kind']}:{reference['id']}"
    if reference["artifactPath"] is not None:
        label += f"#{reference['artifactPath']}"
    return f"`{label}`"


def _render_markdown(report: dict[str, Any]) -> str:
    request = report["request"]
    analysis = report["analysis"]
    evidence = report["evidence"]
    baseline = evidence["session"]["baseline"]
    leader = evidence["session"]["leader"]
    leader_run = next(
        item for item in evidence["runs"] if item["id"] == leader["runId"]
    )
    mandate = leader_run["metrics"].get("portfolio_mandate")
    research_horizon = leader_run["metrics"].get("research_horizon")
    integrity = evidence["selectionIntegrity"]
    source = request["source"]
    source_identity = (
        f"{source['system']} workspace={source['workspaceId'] or 'unspecified'} "
        f"session={source['sessionId'] or 'unspecified'}"
    )
    assets = ", ".join(
        f"{item['symbol']} ({item['assetClass']}"
        + (f", {item['venue']}" if item["venue"] else "")
        + (
            f", {item['positionRole']}"
            if item.get("positionRole")
            else ""
        )
        + ")"
        for item in request["assets"]
    )
    lines = [
        f"# {analysis['title']}",
        "",
        "> Authority: quantitative decision support only. This report is not a",
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
            f"primary `{research_horizon['primaryForwardBars']}` decision "
            "bars; diagnostics "
            + ", ".join(
                f"`{item}`"
                for item in research_horizon["diagnosticForwardBars"]
            )
            + f" bars (`{research_horizon['source']['horizonPolicy']}`)"
            if isinstance(research_horizon, dict)
            else "**Numerical forward horizon:** unavailable"
        ),
        "",
        f"**Caller-supplied source:** {source_identity}",
        "",
        "## Executive summary",
        "",
        analysis["executiveSummary"],
        "",
        "## Evidence state",
        "",
        f"- Baseline: `{baseline['runId']}` — "
        f"{baseline['metric']}={baseline['value']}",
        f"- Leader: `{leader['runId']}` — "
        f"{leader['metric']}={leader['value']}",
        f"- Experiments: {len(evidence['experiments'])}",
        f"- Campaigns: {len(evidence['campaigns'])}",
        "",
    ]
    if isinstance(mandate, dict):
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
                "## Portfolio mandate",
                "",
                f"- Mandate: `{mandate['id']}`",
                f"- Requested direction / construction: "
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
                "- Context-only research assets: "
                + (
                    ", ".join(
                        f"`{item}`" for item in mandate["contextAssets"]
                    )
                    if mandate["contextAssets"]
                    else "none"
                ),
                f"- Gross limit / default per-asset cap / cash allowed: "
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
                f"- Shorting allowed / benchmark: "
                f"`{construction['shortAllowed']}` / "
                f"`{benchmark_label}`",
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
                    f"- Annualized volatility ceiling / covariance history: "
                    f"`{risk_policy['annualizedVolatilityCeiling']}` / "
                    f"`{risk_policy['covarianceWindow']}` bars "
                    f"(`{risk_policy['minimumObservations']}` required)",
                    f"- Scale-up permitted: `{risk_policy['scaleUp']}`",
                ]
            )
        capacity = leader_run["metrics"].get("liquidity_capacity")
        validation_capacity = (
            capacity.get("validation")
            if isinstance(capacity, dict)
            else None
        )
        conservative = (
            validation_capacity.get("capacity_1pct")
            if isinstance(validation_capacity, dict)
            else None
        )
        if isinstance(conservative, dict):
            lines.extend(
                [
                    "- Liquidity capacity: "
                    "`trailing-average-dollar-volume-capacity-v1` "
                    "(OHLCV participation envelope; contextual only)",
                    "- Validation 1% participation capacity "
                    f"minimum / p10 / median: "
                    f"`{conservative['minimum_nav']}` / "
                    f"`{conservative['tenth_percentile_nav']}` / "
                    f"`{conservative['median_nav']}`",
                    "- Capacity trade-date coverage / $1m breach rate: "
                    f"`{validation_capacity['trade_date_coverage']}` / "
                    f"`{conservative['reference_nav_breach_rate']}`",
                ]
            )
        execution_risk = leader_run["metrics"].get("execution_risk")
        validation_execution_risk = (
            execution_risk.get("validation")
            if isinstance(execution_risk, dict)
            else None
        )
        if isinstance(validation_execution_risk, dict):
            lines.extend(
                [
                    "- Executed-book risk: "
                    "`post-drift-executed-book-volatility-compliance-v1` "
                    "(contextual safety invariant)",
                    "- Validation forecast coverage / pretrade breaches / "
                    "risk-only overrides / executed breaches: "
                    f"`{validation_execution_risk['forecast_coverage']}` / "
                    f"`{validation_execution_risk['pretrade_breach_dates']}` / "
                    f"`{validation_execution_risk['risk_rebalance_override_dates']}` / "
                    f"`{validation_execution_risk['executed_breach_dates']}`",
                    "- Final executed weights are historical research "
                    "evidence only; no Broker, account, or order authority.",
                ]
            )
        lifecycle = leader_run["metrics"].get("position_lifecycle")
        validation_lifecycle = (
            lifecycle.get("validation")
            if isinstance(lifecycle, dict)
            else None
        )
        if isinstance(validation_lifecycle, dict):
            lines.extend(
                [
                    "- Mechanical position lifecycle: "
                    "`split-bounded-executed-position-episodes-v1` "
                    "(contextual episode evidence)",
                    "- Validation complete episodes / win rate / median "
                    "holding bars / payoff ratio: "
                    f"`{validation_lifecycle['complete_episodes']}` / "
                    f"`{validation_lifecycle['complete_episode_win_rate']}` / "
                    f"`{validation_lifecycle['median_complete_holding_bars']}` / "
                    f"`{validation_lifecycle['complete_payoff_ratio']}`",
                    "- Validation intent-mismatch rate / average segment "
                    "MFE / MAE: "
                    f"`{validation_lifecycle['intent_mismatch_rate']}` / "
                    f"`{validation_lifecycle['average_segment_mfe']}` / "
                    f"`{validation_lifecycle['average_segment_mae']}`",
                    "- Episode returns are additive portfolio contribution, "
                    "not standalone compounded trade returns; no trading authority.",
                ]
            )
        neighborhood = leader_run["metrics"].get(
            "parameter_neighborhood"
        )
        validation_neighborhood = (
            neighborhood.get("validation")
            if isinstance(neighborhood, dict)
            else None
        )
        aggregate = (
            validation_neighborhood.get("aggregate")
            if isinstance(validation_neighborhood, dict)
            else None
        )
        if isinstance(aggregate, dict):
            lines.extend(
                [
                    "- Mechanical parameter neighborhood: "
                    "`predeclared-signal-threshold-no-trade-neighborhood-v1` "
                    "(local context only; no parameter selection)",
                    "- Validation configurations / positive-Sharpe rate / "
                    "sign agreement with base: "
                    f"`{aggregate['configuration_count']}` / "
                    f"`{aggregate['positive_net_sharpe_rate']}` / "
                    f"`{aggregate['sign_agreement_with_base_rate']}`",
                    "- Validation minimum / median / maximum net Sharpe; "
                    "worst delta versus base: "
                    f"`{aggregate['minimum_net_sharpe']}` / "
                    f"`{aggregate['median_net_sharpe']}` / "
                    f"`{aggregate['maximum_net_sharpe']}`; "
                    f"`{aggregate['worst_net_sharpe_delta']}`",
                    "- The neighborhood is a predeclared robustness surface, "
                    "not an optimizer; no cell changes KEEP/REVERT or trading "
                    "authority.",
                ]
            )
        translation = leader_run["metrics"].get(
            "translation_robustness"
        )
        translation_diagnosis = (
            translation.get("diagnosis")
            if isinstance(translation, dict)
            else None
        )
        if isinstance(translation_diagnosis, dict):
            if translation.get("applicable") is True:
                lines.extend(
                    [
                        "- Target translation robustness: "
                        "`predeclared-temporal-translation-window-stability-v1` "
                        "(40/60/120 causal observations; context only; no window selection)",
                        "- Validation status / minimum active-state agreement / "
                        "maximum mean absolute target delta: "
                        f"`{translation_diagnosis['status']}` / "
                        f"`{translation_diagnosis['minimum_active_state_agreement_rate']}` / "
                        f"`{translation_diagnosis['maximum_mean_absolute_target_delta']}`",
                        "- Net-Sharpe range and sign agreement are descriptive; "
                        "the ordinary target policy remains the fixed 60/20 "
                        "translation and test never selects a window.",
                    ]
                )
            else:
                lines.append(
                    "- Target translation robustness: `not-applicable` "
                    "(cross-sectional scores have no temporal history window)."
                )
        lines.append("")
    leader_decision_support = evidence.get("leaderDecisionSupport")
    if isinstance(leader_decision_support, dict):
        lines.extend(
            factor_input_availability_markdown_lines(
                leader_decision_support,
                heading="## Frozen leader-Run Factor input availability",
            )
        )
        lines.extend(
            factor_qualification_markdown_lines(
                leader_decision_support,
                heading="## Frozen leader-Run factor qualification",
            )
        )
        lines.extend(
            factor_components_markdown_lines(
                leader_decision_support,
                heading="## Frozen leader-Run factor components",
            )
        )
        lines.extend(
            mechanical_decision_markdown_lines(
                leader_decision_support,
                heading="## Frozen leader-Run mechanical decision",
            )
        )
        lines.extend(
            sizing_anatomy_markdown_lines(
                leader_decision_support,
                heading="## Frozen leader-Run position sizing anatomy",
            )
        )
        lines.extend(
            diversification_stress_markdown_lines(
                leader_decision_support,
                heading=(
                    "## Frozen leader-Run diversification stress"
                ),
            )
        )
        lines.extend(
            strategy_viability_markdown_lines(
                leader_decision_support,
                heading="## Frozen leader-Run strategy viability",
            )
        )
        lines.extend(
            signal_monetization_markdown_lines(
                leader_decision_support,
                heading=(
                    "## Frozen leader-Run signal monetization bridge"
                ),
            )
        )
        lines.extend(
            rl_factor_fusion_diagnosis_markdown_lines(
                leader_decision_support,
                heading="## Frozen leader-Run RL factor-fusion diagnosis",
            )
        )
    policy_rationale = leader_run["metrics"].get("policy_rationale")
    validation_policy = (
        policy_rationale.get("validation")
        if isinstance(policy_rationale, dict)
        else None
    )
    if isinstance(validation_policy, dict):
        dominant_features = sorted(
            validation_policy["by_feature"].items(),
            key=lambda item: (
                -item[1]["dominant_rate"],
                item[0],
            ),
        )[:3]
        lines.extend(
            [
                "## RL policy behavior and rationale",
                "",
                "- Validation decisions / action runs / transition rate / "
                "mean run length: "
                f"`{validation_policy['decisions']}` / "
                f"`{validation_policy['action_runs']}` / "
                f"`{validation_policy['transition_rate']}` / "
                f"`{validation_policy['mean_action_run_length']}` bars",
                "- Validation median uncalibrated Q margin / tie rate / "
                "single-bar-run rate: "
                f"`{validation_policy['median_action_margin']}` / "
                f"`{validation_policy['tie_rate']}` / "
                f"`{validation_policy['single_bar_run_rate']}`",
                "- Most frequent dominant margin features: "
                + ", ".join(
                    f"`{name}` ({values['dominant_rate']})"
                    for name, values in dominant_features
                ),
                "- Q margins are uncalibrated linear-model scores, not "
                "probabilities or confidence. Chosen-versus-runner-up "
                "contributions are exact linear decompositions, not causal "
                "feature importance.",
                "- Action-conditioned returns are descriptive and endogenous; "
                "the policy remains contextual research evidence with no "
                "Broker, account, capital, or order authority.",
                "",
            ]
        )
    rl_configuration = leader_run["metrics"].get("configuration")
    if (
        isinstance(rl_configuration, dict)
        and rl_configuration.get("contextualRidgeMethod")
        == "iterative-same-pretrade-contextual-ridge-v1"
    ):
        lines.extend(
            [
                "## RL simple-policy challenger",
                "",
                "- Contextual baseline: "
                "`iterative-same-pretrade-contextual-ridge-v1`",
                "- Training scope / anchor / fixed iterations: "
                f"`{rl_configuration['contextualRidgeLabelScope']}` / "
                f"`{rl_configuration['contextualRidgeAnchorAction']}` / "
                f"`{rl_configuration['contextualRidgeIterations']}`",
                "- Every action label at one train timestamp starts from the "
                "same behavior-path pretrade book. The fitted policy is "
                "rerolled on train dates before the next fixed iteration and "
                "is frozen before validation.",
                "- This removes fixed-sleeve path confounding but remains a "
                "simple one-step comparator, not an ex-post oracle or trading "
                "policy.",
                "",
            ]
        )
    incremental = leader_run["metrics"].get("incremental_attribution")
    validation_incremental = (
        incremental.get("validation")
        if isinstance(incremental, dict)
        else None
    )
    if isinstance(validation_incremental, dict):
        largest_assets = sorted(
            validation_incremental["by_asset"].items(),
            key=lambda item: (
                -abs(item[1]["total_gross_active_contribution"]),
                item[0],
            ),
        )[:5]
        lines.extend(
            [
                "## RL incremental value attribution",
                "",
                "- Method: "
                "`selected-baseline-full-path-active-attribution-v1` "
                "(independent RL and validation-selected baseline paths)",
                "- Validation mean-trial-path gross edge / incremental cost / "
                "net active return: "
                f"`{validation_incremental['mean_trial_total_gross_active_return']}` / "
                f"`{validation_incremental['mean_trial_total_incremental_cost']}` / "
                f"`{validation_incremental['mean_trial_total_net_active_return']}`",
                "- Validation mean-trial annualized active return / tracking "
                "error / information ratio: "
                f"`{validation_incremental['annualized_active_return']}` / "
                f"`{validation_incremental['annualized_tracking_error']}` / "
                f"`{validation_incremental['information_ratio']}`",
                "- Validation active-day frequency / conditional win rate / "
                "mean relative maximum drawdown / fifth-percentile active day: "
                f"`{validation_incremental['active_decision_rate']}` / "
                f"`{validation_incremental['conditional_active_win_rate']}` / "
                f"`{validation_incremental['relative_maximum_drawdown']}` / "
                f"`{validation_incremental['p05_net_active_return']}`",
                "- Largest absolute asset gross contributions: "
                + ", ".join(
                    f"`{asset}` "
                    f"({values['total_gross_active_contribution']})"
                    for asset, values in largest_assets
                ),
                "- Gross edge minus incremental cost reconciles net active "
                "return; asset contributions reconcile gross edge. Regime and "
                "action-pair tables are descriptive diagnostics only.",
                "",
            ]
        )
    factor_opportunity = leader_run["metrics"].get("factor_opportunity")
    validation_opportunity = (
        factor_opportunity.get("validation")
        if isinstance(factor_opportunity, dict)
        else None
    )
    if isinstance(validation_opportunity, dict):
        candidate = validation_opportunity["candidate"]
        oracle_mix = sorted(
            validation_opportunity["by_action"].items(),
            key=lambda item: (-item[1]["oracle_frequency"], item[0]),
        )
        lines.extend(
            [
                "## RL one-step factor opportunity",
                "",
                "- Method: "
                "`actual-pretrade-one-step-governed-action-audit-v1` "
                "(actual policy pretrade book; no alternate path propagation)",
                "- Validation oracle-hit rate / mean selected rank / positive "
                "regret rate: "
                f"`{validation_opportunity['oracle_hit_rate']}` / "
                f"`{validation_opportunity['mean_selected_rank']}` / "
                f"`{validation_opportunity['positive_regret_rate']}`",
                "- Validation mean / p90 / maximum realized one-step regret: "
                f"`{validation_opportunity['mean_realized_regret']}` / "
                f"`{validation_opportunity['p90_realized_regret']}` / "
                f"`{validation_opportunity['maximum_realized_regret']}`",
                "- Candidate selected / locally best / missed-opportunity "
                "frequency: "
                f"`{candidate['selected_frequency']}` / "
                f"`{candidate['oracle_frequency']}` / "
                f"`{candidate['missed_opportunity_rate']}`",
                "- Candidate mean reward advantage versus selected / balanced; "
                "win rate versus balanced: "
                f"`{candidate['mean_vs_selected_reward']}` / "
                f"`{candidate['mean_vs_balanced_reward']}`; "
                f"`{candidate['win_rate_vs_balanced']}`",
                "- Ex-post local-best action mix: "
                + ", ".join(
                    f"`{name}` ({values['oracle_frequency']})"
                    for name, values in oracle_mix
                ),
                "- Oracle means an ex-post one-step audit upper bound, not an "
                "attainable strategy. This evidence cannot change KEEP/REVERT "
                "and carries no trading authority.",
                "",
            ]
        )
    lines.extend(
        [
            "## Research selection integrity",
            "",
            f"- Selection metric / split: `{integrity['selectionMetric']}` / "
            f"`{integrity['selectionSplit']}`",
            f"- Candidate trials / evaluated Runs: "
            f"{integrity['candidateTrials']} / {integrity['evaluatedRuns']}",
            f"- Verdicts: KEEP={integrity['verdicts']['KEEP']}, "
            f"REVERT={integrity['verdicts']['REVERT']}, "
            f"CRASH={integrity['verdicts']['CRASH']}",
            f"- Test role / enters selection: `{integrity['testRole']}` / "
            f"`{integrity['testEntersSelection']}`",
            f"- External holdout required: "
            f"`{integrity['externalHoldoutRequired']}`",
            *(
                [
                    f"- Test exposure state: "
                    f"`{integrity['testExposureState']}`",
                    f"- Candidate iterations after first candidate audit: "
                    f"`{integrity['postAuditCandidateIterations']}`",
                    f"- Test guidance observability: "
                    f"`{integrity['testGuidanceObservability']}`",
                    f"- External holdout reason: "
                    f"`{integrity['externalHoldoutReason']}`",
                ]
                if "testExposureState" in integrity
                else []
            ),
            f"- Warning: {integrity['warning']}",
        ]
    )
    family = integrity.get("researchFamily")
    adjustment = integrity.get("selectionAdjustment")
    if isinstance(family, dict):
        lines.extend(
            [
                f"- Research family: `{family['id']}` "
                f"(`{family['boundary']}`)",
                f"- Project-family unique trials / executions / duplicates: "
                f"{family['uniqueSourceTrials']} / "
                f"{family['totalExecutions']} / "
                f"{family['duplicateExecutions']}",
                f"- Successful / failed sources / reproducible: "
                f"{family['successfulSourceTrials']} / "
                f"{family['failedSourceTrials']} / "
                f"`{family['reproducible']}`",
            ]
        )
    if isinstance(adjustment, dict):
        lines.append(
            f"- Selection adjustment: "
            f"`{adjustment['method'] or adjustment['status']}`; "
            f"passes {adjustment['confidenceLevel']:.0%}="
            f"`{adjustment['passes']}`"
        )
        lines.append(
            f"- Adjustment interpretation: "
            f"{adjustment['interpretation']}"
        )
        statistics = adjustment.get("statistics")
        if (
            adjustment.get("method") == "bonferroni-hac-v1"
            and isinstance(statistics, dict)
        ):
            lines.append(
                f"- Family-wise HAC p / confidence: "
                f"`{statistics['familywiseAdjustedPValue']:.6g}` / "
                f"`{statistics['familywiseConfidence']:.2%}`"
            )
        elif (
            adjustment.get("method") == "deflated-sharpe-ratio-v1"
            and isinstance(statistics, dict)
        ):
            lines.extend(
                [
                    f"- PSR / DSR probability: "
                    f"`{statistics['probabilisticSharpeProbability']:.2%}` / "
                    f"`{statistics['deflatedSharpeProbability']:.2%}`",
                    f"- Observed / expected-max annualized Sharpe: "
                    f"`{statistics['observedAnnualizedSharpe']:.4f}` / "
                    f"`{statistics['expectedMaximumAnnualizedSharpe']:.4f}`",
                    f"- Observations / minimum track record / sufficient: "
                    f"{statistics['observations']} / "
                    f"{statistics['minimumTrackRecordObservations']} / "
                    f"`{statistics['trackRecordSufficient']}`",
                ]
            )
        elif adjustment.get("reason"):
            lines.append(
                f"- Adjustment unavailable reason: "
                f"`{adjustment['reason']}`"
            )
    lines.extend(["", "## Findings", ""])
    for finding in analysis["findings"]:
        refs = ", ".join(_evidence_label(item) for item in finding["evidenceRefs"])
        lines.extend(
            [
                f"### {finding['id']}",
                "",
                finding["claim"],
                "",
                f"Confidence: **{finding['confidence']}**. Evidence: {refs}.",
                "",
            ]
        )
    lines.extend(["## Recommendations", ""])
    if analysis["recommendations"]:
        for index, recommendation in enumerate(analysis["recommendations"], start=1):
            refs = ", ".join(
                _evidence_label(item) for item in recommendation["evidenceRefs"]
            )
            lines.extend(
                [
                    f"{index}. **{recommendation['action']}** — "
                    f"{recommendation['rationale']}",
                    "",
                    "   Conditions: "
                    + (
                        "; ".join(recommendation["conditions"])
                        if recommendation["conditions"]
                        else "none declared"
                    )
                    + f". Evidence: {refs}.",
                    "",
                ]
            )
    else:
        lines.extend(["No action recommendation was made.", ""])
    lines.extend(["## Limitations", ""])
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
            "## Reproducibility and handoff",
            "",
            f"- Report: `{report['id']}`",
            f"- Brief: `{report['brief']['id']}`",
            f"- Session: `{report['sessionId']}`",
            f"- Study: `{evidence['session']['studyId']}`",
            f"- Harness: `{report['harness']['id']}@{report['harness']['version']}` "
            f"commit `{report['harness']['commit']}`",
            f"- Dataset hash: `{evidence['session']['locks']['datasetHash']}`",
            *(
                [
                    "- Fixed dependency hash: "
                    f"`{evidence['session']['locks']['dependencyHash']}`"
                ]
                if "dependencyHash" in evidence["session"]["locks"]
                else []
            ),
            "",
            "Publish this exact Markdown through OpenAlice Inbox to let OpenAlice",
            "stamp authoritative Workspace, Session, and document-revision provenance.",
            "",
        ]
    )
    return "\n".join(lines)


def publish_report(
    project: ProjectContext,
    session_id: str,
    analysis: dict[str, Any],
) -> ReportContext:
    normalized = validate_publishable_report_analysis(analysis)
    session = load_session(project, session_id)
    if session.manifest["status"] != "active":
        raise AutoQuantValidationError(
            [
                _issue(
                    session.manifest_path,
                    "report.session-closed",
                    "Research Reports can be published only while the Session is active",
                )
            ]
        )
    if session.delegation is None:
        raise AutoQuantValidationError(
            [
                _issue(
                    session.manifest_path,
                    "report.request-required",
                    "Research Reports require a delegated Session brief",
                )
            ]
        )
    validate_session_authority(project, session)
    published = datetime.now(timezone.utc)
    evidence, catalog = _session_evidence(
        project,
        session,
        selection_cutoff=published.isoformat(),
    )
    _resolve_analysis_evidence(normalized, catalog, "analysis")
    stamp = published.strftime("%Y%m%dT%H%M%S%fZ")
    analysis_hash = hash_json(normalized)
    evidence_hash = hash_json(evidence)
    identity = hash_json(
        {
            "sessionId": session_id,
            "briefHash": session.manifest["brief"]["briefHash"],
            "analysisHash": analysis_hash,
            "evidenceHash": evidence_hash,
            "publishedAt": published.isoformat(),
        }
    )
    report_id = f"report-{stamp}-{identity[:12]}"
    reports_root = _reports_root(session, create=True)
    target = confined_path(reports_root, report_id, f"report/{report_id}")
    staging = reports_root / f".{report_id}.creating"
    if target.exists() or target.is_symlink() or staging.exists():
        raise AutoQuantValidationError(
            [_issue(target, "report.collision", "Research Report already exists")]
        )
    report = {
        "schemaVersion": SCHEMA_VERSION,
        "kind": REPORT_KIND,
        "id": report_id,
        "authority": "quantitative-decision-support",
        "tradingAuthority": "none",
        "publishedAt": published.isoformat(),
        "project": {
            "id": project.manifest.id,
            "name": project.manifest.name,
        },
        "sessionId": session_id,
        "brief": session.manifest["brief"],
        "request": session.delegation["request"],
        "harness": session.manifest["locks"]["harness"],
        "analysisHash": analysis_hash,
        "evidenceHash": evidence_hash,
        "analysis": normalized,
        "evidence": evidence,
        "openAliceHandoff": {
            "document": REPORT_MARKDOWN,
            "provenance": "openalice-authoritative-on-inbox-publication",
            "sourceContext": "caller-supplied-content-locked",
        },
    }
    try:
        staging.mkdir()
        _write_json(staging / REPORT_ANALYSIS, normalized)
        _write_json(staging / REPORT_RESULT, report)
        (staging / REPORT_MARKDOWN).write_text(
            _render_markdown(report),
            encoding="utf-8",
        )
        files = {
            path.name: hash_file(path)
            for path in sorted(staging.iterdir(), key=lambda item: item.name)
            if path.is_file()
        }
        manifest = {
            "schemaVersion": SCHEMA_VERSION,
            "id": report_id,
            "sessionId": session_id,
            "completed": True,
            "reportHash": files[REPORT_RESULT],
            "files": files,
        }
        _write_json(staging / REPORT_MANIFEST, manifest)
        os.replace(staging, target)
    except Exception:
        if staging.exists():
            shutil.rmtree(staging)
        raise
    return load_report(project, load_session(project, session_id), report_id)


def _report_files(root: Path) -> dict[str, str]:
    files: dict[str, str] = {}

    def visit(directory: Path) -> None:
        for path in sorted(directory.iterdir(), key=lambda item: item.name):
            if path == root / REPORT_MANIFEST:
                continue
            if path.is_symlink():
                raise AutoQuantValidationError(
                    [_issue(path, "report.entry", "Report entries cannot be symlinks")]
                )
            if path.is_dir():
                visit(path)
                continue
            if not path.is_file():
                raise AutoQuantValidationError(
                    [_issue(path, "report.entry", "Report entries must be real files")]
                )
            files[path.relative_to(root).as_posix()] = hash_file(path)

    visit(root)
    return files


def _validate_report_result(
    value: dict[str, Any],
    path: Path,
    report_id: str,
    session: SessionContext,
) -> None:
    required = {
        "schemaVersion",
        "kind",
        "id",
        "authority",
        "tradingAuthority",
        "publishedAt",
        "project",
        "sessionId",
        "brief",
        "request",
        "harness",
        "analysisHash",
        "evidenceHash",
        "analysis",
        "evidence",
        "openAliceHandoff",
    }
    issues = _strict_keys(value, required, path)
    if (
        value.get("schemaVersion") != SCHEMA_VERSION
        or value.get("kind") != REPORT_KIND
        or value.get("id") != report_id
        or value.get("sessionId") != session.manifest["id"]
        or value.get("authority") != "quantitative-decision-support"
        or value.get("tradingAuthority") != "none"
    ):
        issues.append(_issue(path, "report.identity", "Invalid Research Report identity"))
    if value.get("project") != {
        "id": session.manifest["projectId"],
        "name": session.baseline_run.result["project"]["name"],
    }:
        issues.append(_issue(f"{path}/project", "report.project", "Report Project differs"))
    if value.get("brief") != session.manifest.get("brief"):
        issues.append(_issue(f"{path}/brief", "report.brief", "Report Brief differs from Session"))
    if session.delegation is None or value.get("request") != session.delegation["request"]:
        issues.append(
            _issue(f"{path}/request", "report.request", "Report request differs from Session")
        )
    if value.get("harness") != session.manifest["locks"]["harness"]:
        issues.append(
            _issue(f"{path}/harness", "report.harness", "Report Harness differs from Session")
        )
    if value.get("openAliceHandoff") != {
        "document": REPORT_MARKDOWN,
        "provenance": "openalice-authoritative-on-inbox-publication",
        "sourceContext": "caller-supplied-content-locked",
    }:
        issues.append(
            _issue(
                f"{path}/openAliceHandoff",
                "report.handoff",
                "Invalid OpenAlice handoff boundary",
            )
        )
    analysis = value.get("analysis")
    if not isinstance(analysis, dict):
        issues.append(_issue(f"{path}/analysis", "schema.type", "Invalid analysis"))
    else:
        try:
            normalized = validate_report_analysis(analysis, f"{path}/analysis")
            if hash_json(normalized) != value.get("analysisHash"):
                issues.append(
                    _issue(f"{path}/analysisHash", "report.analysis-hash", "Analysis hash mismatch")
                )
        except AutoQuantValidationError as error:
            issues.extend(error.issues)
    evidence = value.get("evidence")
    if not isinstance(evidence, dict) or hash_json(evidence) != value.get("evidenceHash"):
        issues.append(
            _issue(f"{path}/evidenceHash", "report.evidence-hash", "Evidence hash mismatch")
        )
    for key in ("analysisHash", "evidenceHash"):
        if not isinstance(value.get(key), str) or not SHA256.fullmatch(value.get(key, "")):
            issues.append(_issue(f"{path}/{key}", "schema.hash", f"Invalid {key}"))
    published_at = value.get("publishedAt")
    if not isinstance(published_at, str):
        issues.append(_issue(f"{path}/publishedAt", "schema.string", "Invalid publishedAt"))
    else:
        try:
            published = datetime.fromisoformat(published_at)
            if published.utcoffset() is None or published.utcoffset().total_seconds() != 0:
                raise ValueError("publishedAt must be UTC")
            stamp = published.strftime("%Y%m%dT%H%M%S%fZ")
            identity = hash_json(
                {
                    "sessionId": session.manifest["id"],
                    "briefHash": session.manifest["brief"]["briefHash"],
                    "analysisHash": value.get("analysisHash"),
                    "evidenceHash": value.get("evidenceHash"),
                    "publishedAt": published_at,
                }
            )
            if report_id != f"report-{stamp}-{identity[:12]}":
                issues.append(
                    _issue(path, "report.derived-id", "Research Report id is not derived")
                )
        except ValueError:
            issues.append(
                _issue(f"{path}/publishedAt", "schema.datetime", "Invalid publishedAt")
            )
    if issues:
        raise AutoQuantValidationError(issues)


def _verify_frozen_evidence(
    project: ProjectContext,
    session: SessionContext,
    report: dict[str, Any],
    path: Path,
) -> None:
    evidence = report["evidence"]
    required = {
        "session",
        "selectionIntegrity",
        "runs",
        "experiments",
        "campaigns",
    }
    allowed = required | {"leaderDecisionSupport"}
    if not isinstance(evidence, dict):
        raise AutoQuantValidationError(
            [_issue(path, "report.evidence", "Evidence must be an object")]
        )
    issues = [
        _issue(
            f"{path}/evidence/{key}",
            "schema.missing",
            f"Missing required field '{key}'",
        )
        for key in sorted(required - evidence.keys())
    ]
    issues.extend(
        _issue(
            f"{path}/evidence/{key}",
            "schema.unknown",
            f"Unknown field '{key}'",
        )
        for key in sorted(evidence.keys() - allowed)
    )
    runs = evidence.get("runs")
    experiments = evidence.get("experiments")
    campaigns = evidence.get("campaigns")
    if not all(isinstance(items, list) for items in (runs, experiments, campaigns)):
        issues.append(
            _issue(f"{path}/evidence", "schema.array", "Evidence catalogs must be arrays")
        )
    if issues:
        raise AutoQuantValidationError(issues)
    catalog: dict[tuple[str, str], dict[str, Any]] = {}
    run_ids: list[str] = []
    for item in runs:
        if not isinstance(item, dict) or not isinstance(item.get("id"), str):
            issues.append(_issue(path, "report.run", "Invalid frozen Run evidence"))
            continue
        run = load_run(project, item["id"])
        expected = {
            "id": run.result["id"],
            "resultHash": run.manifest["resultHash"],
            "status": run.result["status"],
            "summary": run.result["summary"],
            "subject": run.result["subject"],
            "dataset": run.result["dataset"],
            "objective": run.result["objective"],
            "metrics": run.result["metrics"],
            "artifacts": run.result["artifacts"],
            **(
                {"dependencies": run.result["dependencies"]}
                if "dependencies" in run.result
                else {}
            ),
        }
        if item != expected:
            issues.append(
                _issue(path, "report.run-evidence", f"Frozen Run differs: {item['id']}")
            )
        catalog[("run", item["id"])] = item
        run_ids.append(item["id"])
    current_experiments = list_experiments(project, session)
    expected_leader = dict(session.manifest["baseline"])
    for index, item in enumerate(experiments):
        if not isinstance(item, dict) or not isinstance(item.get("id"), str):
            issues.append(_issue(path, "report.experiment", "Invalid frozen Experiment evidence"))
            continue
        experiment = load_experiment(project, session, item["id"])
        expected = {
            "id": experiment.result["id"],
            "resultHash": experiment.manifest["resultHash"],
            "sequence": experiment.result["sequence"],
            "hypothesis": experiment.result["hypothesis"],
            "verdict": experiment.result["verdict"],
            "candidate": experiment.result["candidate"],
            "improvement": experiment.result["improvement"],
        }
        if item != expected:
            issues.append(
                _issue(
                    path,
                    "report.experiment-evidence",
                    f"Frozen Experiment differs: {item['id']}",
                )
            )
        if index >= len(current_experiments) or current_experiments[index].id != item["id"]:
            issues.append(
                _issue(
                    path,
                    "report.experiment-prefix",
                    "Frozen Experiments must be a chronological Session-history prefix",
                )
            )
        if experiment.result["leader"] != expected_leader:
            issues.append(
                _issue(path, "report.leader-chain", "Frozen Experiment leader chain is invalid")
            )
        if experiment.result["verdict"] == "KEEP":
            expected_leader = dict(experiment.result["candidate"])
        catalog[("experiment", item["id"])] = item
    current_campaigns = list_campaigns(project, session)
    for index, item in enumerate(campaigns):
        if not isinstance(item, dict) or not isinstance(item.get("id"), str):
            issues.append(_issue(path, "report.campaign", "Invalid frozen Campaign evidence"))
            continue
        campaign = load_campaign(project, session, item["id"])
        expected = {
            "id": campaign.result["id"],
            "resultHash": campaign.manifest["resultHash"],
            "status": campaign.result["status"],
            "reason": campaign.result["reason"],
            "turnsCompleted": campaign.result["turnsCompleted"],
            "experiments": campaign.result["experiments"],
            "verdicts": campaign.result["verdicts"],
        }
        if item != expected:
            issues.append(
                _issue(
                    path,
                    "report.campaign-evidence",
                    f"Frozen Campaign differs: {item['id']}",
                )
            )
        if index >= len(current_campaigns) or current_campaigns[index].id != item["id"]:
            issues.append(
                _issue(
                    path,
                    "report.campaign-prefix",
                    "Frozen Campaigns must be a chronological Session-history prefix",
                )
            )
        catalog[("campaign", item["id"])] = item
    frozen_session = evidence.get("session")
    if not isinstance(frozen_session, dict):
        issues.append(_issue(path, "report.session", "Invalid frozen Session evidence"))
    else:
        issues.extend(
            _strict_keys(
                frozen_session,
                {
                    "id",
                    "status",
                    "studyId",
                    "brief",
                    "baseline",
                    "leader",
                    "locks",
                },
                f"{path}/evidence/session",
            )
        )
        expected_fixed = {
            "id": session.manifest["id"],
            "studyId": session.manifest["studyId"],
            "brief": session.manifest["brief"],
            "baseline": session.manifest["baseline"],
            "locks": {
                key: value
                for key, value in session.manifest["locks"].items()
                if key != "fixedHashes"
            },
        }
        for key, value in expected_fixed.items():
            if frozen_session.get(key) != value:
                issues.append(
                    _issue(path, "report.session-evidence", f"Frozen Session {key} differs")
                )
        if frozen_session.get("status") not in {"active", "promoted"}:
            issues.append(_issue(path, "report.session-status", "Invalid frozen Session status"))
        if frozen_session.get("leader") != expected_leader:
            issues.append(
                _issue(path, "report.leader-chain", "Frozen leader differs from KEEP prefix")
            )
        if "leaderDecisionSupport" in evidence:
            try:
                verify_leader_decision_support(
                    project,
                    evidence["leaderDecisionSupport"],
                    expected_leader["runId"],
                    f"{path}/evidence/leaderDecisionSupport",
                )
            except AutoQuantValidationError as error:
                issues.extend(error.issues)
        expected_run_ids = {
            session.manifest["baseline"]["runId"],
            expected_leader["runId"],
            *(
                item["candidate"].get("runId")
                for item in experiments
                if (
                    isinstance(item, dict)
                    and isinstance(item.get("candidate"), dict)
                    and isinstance(item["candidate"].get("runId"), str)
                )
            ),
        }
        if set(run_ids) != expected_run_ids or len(run_ids) != len(set(run_ids)):
            issues.append(
                _issue(
                    path,
                    "report.run-catalog",
                    "Frozen Runs must exactly cover the baseline and Experiment prefix",
                )
            )
        frozen_integrity = evidence.get("selectionIntegrity")
        expected_integrity = build_selection_integrity(
            project,
            load_run(project, expected_leader["runId"]),
            [
                item["verdict"]
                for item in experiments
                if isinstance(item, dict) and item.get("verdict") in {
                    "KEEP",
                    "REVERT",
                    "CRASH",
                }
            ],
            cutoff=report["publishedAt"],
        )
        selection_v3_keys = {
            "testExposureState",
            "postAuditCandidateIterations",
            "testGuidanceObservability",
            "declaredExternalHoldoutRule",
            "externalHoldoutReason",
        }
        if (
            isinstance(frozen_integrity, dict)
            and selection_v3_keys.isdisjoint(frozen_integrity)
        ):
            expected_integrity["externalHoldoutRule"] = (
                expected_integrity["declaredExternalHoldoutRule"]
            )
            if expected_integrity["externalHoldoutRequired"]:
                expected_integrity["warning"] = (
                    "Visible test evidence and candidate iteration share this "
                    "Session; use a new external holdout before a fresh "
                    "production-grade claim."
                )
            elif expected_integrity["selectionSplit"] != "unspecified":
                expected_integrity["warning"] = (
                    "Test evidence is visible diagnostic output; changing a "
                    "candidate after inspecting it consumes its holdout value."
                )
            for key in selection_v3_keys:
                expected_integrity.pop(key)
        selection_v2_keys = {
            "researchFamily",
            "selectionAdjustment",
            "verdictAuthority",
        }
        if (
            isinstance(frozen_integrity, dict)
            and selection_v2_keys.isdisjoint(frozen_integrity)
        ):
            expected_integrity = {
                key: value
                for key, value in expected_integrity.items()
                if key not in selection_v2_keys
            }
        if frozen_integrity != expected_integrity:
            issues.append(
                _issue(
                    path,
                    "report.selection-integrity",
                    "Frozen selection integrity differs from Experiment prefix",
                )
            )
    try:
        _resolve_analysis_evidence(report["analysis"], catalog, path)
    except AutoQuantValidationError as error:
        issues.extend(error.issues)
    if issues:
        raise AutoQuantValidationError(issues)


def load_report(
    project: ProjectContext,
    session: SessionContext,
    report_id: str,
) -> ReportContext:
    root = _report_root(session, report_id)
    if root.is_symlink() or not root.is_dir():
        raise AutoQuantValidationError(
            [_issue(root, "report.missing", f"Unknown Research Report: {report_id}")]
        )
    manifest = _read_json(root / REPORT_MANIFEST, "report manifest")
    required = {
        "schemaVersion",
        "id",
        "sessionId",
        "completed",
        "reportHash",
        "files",
    }
    issues = _strict_keys(manifest, required, root / REPORT_MANIFEST)
    if (
        manifest.get("schemaVersion") != SCHEMA_VERSION
        or manifest.get("id") != report_id
        or manifest.get("sessionId") != session.manifest["id"]
        or manifest.get("completed") is not True
    ):
        issues.append(_issue(root / REPORT_MANIFEST, "report.manifest", "Invalid terminal manifest"))
    files = manifest.get("files")
    actual = _report_files(root)
    if not isinstance(files, dict) or files != actual:
        issues.append(_issue(root, "report.tampered", "Research Report files changed"))
    if isinstance(files, dict) and files.get(REPORT_RESULT) != manifest.get("reportHash"):
        issues.append(_issue(root, "report.result-hash", "Research Report hash mismatch"))
    if issues:
        raise AutoQuantValidationError(issues)
    analysis = validate_report_analysis(
        _read_json(root / REPORT_ANALYSIS, "report analysis"),
        root / REPORT_ANALYSIS,
    )
    report = _read_json(root / REPORT_RESULT, "research report")
    _validate_report_result(report, root / REPORT_RESULT, report_id, session)
    if report["analysis"] != analysis:
        raise AutoQuantValidationError(
            [_issue(root, "report.analysis", "Stored analysis differs from report")]
        )
    if (root / REPORT_MARKDOWN).read_text(encoding="utf-8") != _render_markdown(report):
        raise AutoQuantValidationError(
            [_issue(root / REPORT_MARKDOWN, "report.markdown", "Report Markdown is not canonical")]
        )
    _verify_frozen_evidence(project, session, report, root / REPORT_RESULT)
    return ReportContext(root, manifest, report, analysis)


def list_reports(
    project: ProjectContext,
    session: SessionContext,
) -> list[ReportSummary]:
    root = session.root_dir / "reports"
    if not root.exists():
        return []
    root = _reports_root(session, create=False)
    summaries: list[ReportSummary] = []
    for entry in sorted(root.iterdir(), key=lambda item: item.name):
        if entry.name.startswith("."):
            continue
        if entry.is_symlink() or not entry.is_dir():
            raise AutoQuantValidationError(
                [_issue(entry, "report.entry", "Report entries must be real directories")]
            )
        report = load_report(project, session, entry.name)
        summaries.append(
            ReportSummary(
                id=report.report["id"],
                title=report.analysis["title"],
                session_id=report.report["sessionId"],
                leader_run_id=report.report["evidence"]["session"]["leader"]["runId"],
                findings=len(report.analysis["findings"]),
                recommendations=len(report.analysis["recommendations"]),
                published_at=report.report["publishedAt"],
                path=str(report.root_dir),
                markdown_path=str(report.root_dir / REPORT_MARKDOWN),
                executive_summary=report.analysis["executiveSummary"],
                authority=report.report["authority"],
                leader_decision_support=summarize_leader_decision_support(
                    report.report["evidence"].get(
                        "leaderDecisionSupport"
                    )
                ),
                selection_integrity=report.report["evidence"][
                    "selectionIntegrity"
                ],
                anchor_kind="session",
                study_id=session.manifest["studyId"],
            )
        )
    return summaries


EVIDENCE_REFERENCE_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "description": (
        "One exact Report-anchor evidence reference. Run artifactPath is null or "
        "must exactly match one path in that Run's result.artifacts array, "
        "for example artifacts/factor-report.json. Experiment and Campaign "
        "artifactPath must be null."
    ),
    "additionalProperties": False,
    "required": ["kind", "id", "artifactPath"],
    "examples": [
        {
            "kind": "run",
            "id": "run-20260730T120000000000Z-example",
            "artifactPath": "artifacts/factor-report.json",
        },
        {
            "kind": "experiment",
            "id": "exp-0001-example",
            "artifactPath": None,
        },
    ],
    "properties": {
        "kind": {
            "enum": sorted(EVIDENCE_KINDS),
            "description": (
                "Evidence identity kind available from the selected Report anchor. "
                "A direct Run anchor exposes only kind=run."
            ),
        },
        "id": {
            "type": "string",
            "minLength": 1,
            "description": (
                "Exact Run, Experiment, or Campaign id present in the selected anchor."
            ),
        },
        "artifactPath": {
            "description": (
                "For kind=run, null or an exact Run-declared relative path "
                "copied from result.artifacts[].path, such as "
                "artifacts/factor-report.json. Never prefix it with runs/<id>/ "
                "or use a Project/filesystem path. For kind=experiment or "
                "kind=campaign, this field must be null."
            ),
            "anyOf": [
                {"type": "null"},
                {"type": "string", "minLength": 1},
            ],
            "examples": [None, "artifacts/factor-report.json"],
        },
    },
    "allOf": [
        {
            "if": {
                "properties": {
                    "kind": {"enum": ["campaign", "experiment"]},
                },
                "required": ["kind"],
            },
            "then": {
                "properties": {
                    "artifactPath": {"const": None},
                }
            },
        }
    ],
}


REPORT_ANALYSIS_JSON_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "AutoQuant Agent-authored report analysis",
    "description": (
        "Strict complete analysis. An optional authoringState=draft marks a "
        "schema-valid scaffold that publication rejects until the Agent sets "
        "it to final and replaces reserved placeholders. Every recommendation requires action, "
        "rationale, conditions, and evidenceRefs; copy the complete example "
        "before replacing its evidence identity and prose."
    ),
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
        "kind": {"const": REPORT_ANALYSIS_KIND},
        "authoringState": {
            "enum": sorted(REPORT_ANALYSIS_AUTHORING_STATES),
            "description": (
                "Optional authoring lifecycle. Draft objects are valid editing "
                "scaffolds but cannot be published; omission preserves "
                "historical final analyses."
            ),
        },
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
                        "items": EVIDENCE_REFERENCE_JSON_SCHEMA,
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
                        "items": EVIDENCE_REFERENCE_JSON_SCHEMA,
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
    "examples": [
        {
            "schemaVersion": SCHEMA_VERSION,
            "kind": REPORT_ANALYSIS_KIND,
            "authoringState": "final",
            "title": "Bounded factor research conclusion",
            "executiveSummary": (
                "The fixed evidence does not support the tested hypothesis."
            ),
            "findings": [
                {
                    "id": "validation-edge-absent",
                    "claim": (
                        "The candidate did not improve validation evidence."
                    ),
                    "confidence": "medium",
                    "evidenceRefs": [
                        {
                            "kind": "run",
                            "id": (
                                "run-20260730T120000000000Z-0123456789ab"
                            ),
                            "artifactPath": "artifacts/factor-report.json",
                        }
                    ],
                }
            ],
            "recommendations": [
                {
                    "action": "Retain the current baseline.",
                    "rationale": (
                        "The tested candidate did not clear the fixed "
                        "validation objective."
                    ),
                    "conditions": [
                        "Reopen research only with a new bounded hypothesis."
                    ],
                    "evidenceRefs": [
                        {
                            "kind": "run",
                            "id": (
                                "run-20260730T120000000000Z-0123456789ab"
                            ),
                            "artifactPath": "artifacts/factor-report.json",
                        }
                    ],
                }
            ],
            "limitations": ["This conclusion covers one fixed candidate."],
            "unresolvedQuestions": [
                "Would a predeclared alternative survive new evidence?"
            ],
        }
    ],
}
