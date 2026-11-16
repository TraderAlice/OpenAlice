"""Immutable Project-owned Research Reports over one current Study Run."""

from __future__ import annotations

import json
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .book_risk_studies import BOOK_RISK_STUDY_SOURCES
from .briefs import load_research_request
from .decision_support import (
    build_leader_decision_support,
    summarize_leader_decision_support,
    verify_leader_decision_support,
)
from .intake import load_project_intake
from .position_snapshots import validate_position_snapshot
from .reports import (
    REPORT_ANALYSIS,
    REPORT_ID,
    REPORT_MANIFEST,
    REPORT_MARKDOWN,
    REPORT_RESULT,
    SHA256,
    ReportContext,
    ReportSummary,
    _read_json,
    _report_files,
    _resolve_analysis_evidence,
    _strict_keys,
    _write_json,
    build_report_analysis_draft,
    validate_publishable_report_analysis,
    validate_report_analysis,
)
from .runs import list_runs, load_run, run_failure_disposition
from .sessions import build_selection_integrity, list_sessions
from .studies import hash_file, hash_json, load_study
from .workspace import (
    SCHEMA_VERSION,
    AutoQuantValidationError,
    ProjectContext,
    ValidationIssue,
    confined_path,
)


RUN_REPORT_KIND = "autoquant-run-research-report"
RUN_REPORTS_DIRECTORY = "reports"
REPORT_CORRECTION_KIND = "autoquant-research-report-correction"
GOVERNING_REVIEW_DIRECTORY = "governing-review"


def _issue(path: Path | str, code: str, message: str) -> ValidationIssue:
    return ValidationIssue(str(path), code, message)


def _run_projection(run) -> dict[str, Any]:
    projection = {
        "id": run.result["id"],
        "resultHash": run.manifest["resultHash"],
        "status": run.result["status"],
        "study": run.result["study"],
        "studyInputHash": run.result["studyInputHash"],
        "subject": run.result["subject"],
        "dataset": run.result["dataset"],
        "objective": run.result["objective"],
        "metrics": run.result["metrics"],
        "artifacts": run.result["artifacts"],
        "harness": run.result["harness"],
        **(
            {"dependencies": run.result["dependencies"]}
            if "dependencies" in run.result
            else {}
        ),
        **(
            {"researchRequest": run.result["researchRequest"]}
            if "researchRequest" in run.result
            else {}
        ),
        **(
            {"upstreamEvidence": run.result["upstreamEvidence"]}
            if "upstreamEvidence" in run.result
            else {}
        ),
    }
    if run.result["status"] == "failed":
        projection.update(
            {
                "summary": run.result["summary"],
                "errors": run.result["errors"],
                "failureDisposition": run_failure_disposition(run.result),
            }
        )
    return projection


def _reports_root(project: ProjectContext, *, create: bool) -> Path:
    root = confined_path(project.root_dir, RUN_REPORTS_DIRECTORY, "project/reports")
    if root.is_symlink():
        raise AutoQuantValidationError(
            [_issue(root, "path.symlink", "Project Reports directory cannot be a symlink")]
        )
    if create:
        root.mkdir(exist_ok=True)
    if not root.is_dir():
        raise AutoQuantValidationError(
            [_issue(root, "report.directory", "Missing Project Reports directory")]
        )
    return root


def _report_root(project: ProjectContext, report_id: str) -> Path:
    if not REPORT_ID.fullmatch(report_id):
        raise AutoQuantValidationError(
            [_issue(report_id, "report.id", "Invalid Research Report id")]
        )
    return confined_path(_reports_root(project, create=False), report_id, report_id)


def _anchor(
    project: ProjectContext,
    study_id: str,
    run_id: str,
) -> tuple[dict[str, Any], Any, Any, dict[str, Any] | None]:
    study = load_study(project, study_id)
    intake = load_project_intake(project)
    if intake is None and study.definition.research_request is None:
        raise AutoQuantValidationError(
            [
                _issue(
                    project.root_dir,
                    "report.request-required",
                    "Run-bound Research Reports require verified Project intake "
                    "or an exact Study-owned research request",
                )
            ]
        )
    run = load_run(project, run_id)
    issues: list[ValidationIssue] = []
    if any(
        summary.study_id == study_id
        for summary in list_sessions(project)
    ):
        issues.append(
            _issue(
                project.root_dir,
                "report.session-history",
                "Run-bound Reports cannot omit existing Session history for the Study",
            )
        )
    if run.result["study"]["id"] != study_id:
        issues.append(
            _issue(
                run.root_dir,
                "report.study-run",
                "Run does not belong to the selected Study",
            )
        )
    reportable_scientific_limit = (
        run.result["status"] == "failed"
        and run_failure_disposition(run.result) == "scientific-limit"
    )
    if run.result["status"] != "succeeded" and not reportable_scientific_limit:
        issues.append(
            _issue(
                run.root_dir,
                "report.run-failed",
                "Run-bound Reports require a successful Run or an explicitly "
                "classified scientific-limit Run",
            )
        )
    if run.result["studyInputHash"] != study.input_hash:
        issues.append(
            _issue(
                run.root_dir,
                "report.run-stale",
                "Run does not match the current Study, source, dependency, or dataset identity",
            )
        )
    current_run_id = None
    for summary in reversed(list_runs(project, study_id)):
        candidate = load_run(project, summary.id)
        if candidate.result["studyInputHash"] == study.input_hash:
            current_run_id = summary.id
            break
    if current_run_id is not None and current_run_id != run_id:
        issues.append(
            _issue(
                run.root_dir,
                "report.run-superseded",
                "A newer matching Run attempt is the current immutable Study evidence",
            )
        )
    if run.result["dataset"]["hash"] != study.dataset_hash:
        issues.append(
            _issue(
                run.root_dir,
                "report.dataset",
                "Run dataset differs from the selected Study dataset",
            )
        )
    if issues:
        raise AutoQuantValidationError(issues)
    anchor = {
        "kind": "run",
        "studyId": study_id,
        "runId": run_id,
        "sessionId": None,
        "resultHash": run.manifest["resultHash"],
        "studyInputHash": run.result["studyInputHash"],
    }
    return anchor, study, run, intake


def _evidence(
    project: ProjectContext,
    run,
    *,
    published_at: str,
) -> tuple[dict[str, Any], dict[tuple[str, str], dict[str, Any]]]:
    projection = _run_projection(run)
    evidence = {
        "anchor": {
            "kind": "run",
            "studyId": run.result["study"]["id"],
            "runId": run.result["id"],
            "sessionId": None,
        },
        "run": projection,
        "selectionIntegrity": build_selection_integrity(
            project,
            run,
            [],
            cutoff=published_at,
        ),
        "leaderDecisionSupport": build_leader_decision_support(
            project,
            run.result["id"],
        ),
    }
    return evidence, {("run", run.result["id"]): projection}


def _request_for_run(
    run,
    intake: dict[str, Any] | None,
) -> tuple[dict[str, Any], str]:
    """Resolve request authority from immutable Run inputs when Study-owned."""

    binding = run.result.get("researchRequest")
    dependencies = run.result.get("dependencies")
    source_hashes = (
        dependencies.get("sourceHashes")
        if isinstance(dependencies, dict)
        else None
    )
    if isinstance(binding, dict):
        relative = binding["path"]
        if (
            not isinstance(source_hashes, dict)
            or source_hashes.get(relative) != binding["sha256"]
        ):
            raise AutoQuantValidationError(
                [
                    _issue(
                        run.root_dir,
                        "report.request-binding",
                        "Study-owned request differs from frozen Run dependencies",
                    )
                ]
            )
        path = run.root_dir / "inputs" / "dependency-sources" / relative
        if hash_file(path) != binding["sha256"]:
            raise AutoQuantValidationError(
                [
                    _issue(
                        path,
                        "report.request-binding",
                        "Study-owned request bytes differ from their Run binding",
                    )
                ]
            )
        request = load_research_request(path)
        request_hash = hash_json(request)
        snapshot_relative = binding.get("positionSnapshotPath")
        if snapshot_relative is not None:
            snapshot_hash = binding["positionSnapshotSha256"]
            if source_hashes.get(snapshot_relative) != snapshot_hash:
                raise AutoQuantValidationError(
                    [
                        _issue(
                            run.root_dir,
                            "report.request-snapshot",
                            "Study-owned position snapshot differs from frozen dependencies",
                        )
                    ]
                )
            snapshot_path = (
                run.root_dir
                / "inputs"
                / "dependency-sources"
                / snapshot_relative
            )
            if hash_file(snapshot_path) != snapshot_hash:
                raise AutoQuantValidationError(
                    [
                        _issue(
                            snapshot_path,
                            "report.request-snapshot",
                            "Study-owned position snapshot bytes differ from their binding",
                        )
                    ]
                )
            snapshot = _read_json(snapshot_path, "position snapshot")
            validate_position_snapshot(snapshot, snapshot_path)
            if snapshot["source"]["requestHash"] != request_hash:
                raise AutoQuantValidationError(
                    [
                        _issue(
                            snapshot_path,
                            "report.request-snapshot",
                            "Study-owned request differs from its fixed position snapshot",
                        )
                    ]
                )
        return request, request_hash

    study_id = run.result["study"]["id"]
    relative = f"{BOOK_RISK_STUDY_SOURCES}/{study_id}/request.json"
    if isinstance(source_hashes, dict) and relative in source_hashes:
        path = run.root_dir / "inputs" / "dependency-sources" / relative
        request = load_research_request(path)
        request_hash = hash_json(request)
        snapshot_relative = (
            f"{BOOK_RISK_STUDY_SOURCES}/{study_id}/position-snapshot.json"
        )
        if snapshot_relative not in source_hashes:
            raise AutoQuantValidationError(
                [
                    _issue(
                        run.root_dir,
                        "report.request-snapshot",
                        "Study-owned request lacks its fixed position snapshot",
                    )
                ]
            )
        snapshot_path = (
            run.root_dir
            / "inputs"
            / "dependency-sources"
            / snapshot_relative
        )
        snapshot = _read_json(snapshot_path, "position snapshot")
        validate_position_snapshot(snapshot, snapshot_path)
        if snapshot["source"]["requestHash"] != request_hash:
            raise AutoQuantValidationError(
                [
                    _issue(
                        path,
                        "report.request-snapshot",
                        "Study-owned request differs from its fixed position snapshot",
                    )
                ]
            )
        return request, request_hash
    if intake is None:
        raise AutoQuantValidationError(
            [
                _issue(
                    run.root_dir,
                    "report.request-required",
                    "Run has no exact Study-owned or Project intake request",
                )
            ]
        )
    return intake["request"], intake["manifest"]["requestHash"]


def _label(reference: dict[str, Any]) -> str:
    label = f"{reference['kind']}:{reference['id']}"
    if reference["artifactPath"] is not None:
        label += f"#{reference['artifactPath']}"
    return f"`{label}`"


def _render_markdown(report: dict[str, Any]) -> str:
    request = report["request"]
    analysis = report["analysis"]
    evidence = report["evidence"]
    run = evidence["run"]
    integrity = evidence["selectionIntegrity"]
    assets = ", ".join(item["symbol"] for item in request["assets"])
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
        "## Executive summary",
        "",
        analysis["executiveSummary"],
        "",
        "## Frozen evidence",
        "",
        "- Anchor: `run` (no Session, Check, Experiment, or candidate-edit authority)",
        f"- Study: `{report['anchor']['studyId']}`",
        f"- Run: `{report['anchor']['runId']}`",
        f"- Status: `{run['status']}`",
        *(
            [
                f"- Failure disposition: `{run['failureDisposition']}`",
                "- Failure errors: "
                + "; ".join(
                    f"`{item['code']}` — {item['message']}"
                    for item in run["errors"]
                ),
            ]
            if run["status"] == "failed"
            else []
        ),
        f"- Objective: `{run['objective']['metric']}` / `{run['objective']['direction']}`",
        f"- Dataset: `{run['dataset']['id']}@{run['dataset']['version']}` hash `{run['dataset']['hash']}`",
        f"- Selection split / test role: `{integrity['selectionSplit']}` / `{integrity['testRole']}`",
        f"- Candidate trials: `{integrity['candidateTrials']}`",
        f"- Warning: {integrity['warning']}",
        "",
    ]
    correction = report.get("correction")
    if isinstance(correction, dict):
        corrects = correction["corrects"]
        review = correction["governingReview"]
        lines.extend(
            [
                "## Immutable correction lineage",
                "",
                f"- Corrects Report: `{corrects['reportId']}` hash `{corrects['reportHash']}`",
                f"- Governing Review: `{review['id']}` hash `{review['reviewHash']}`",
                f"- Frozen Review package: `{review['packagePath']}`",
                f"- Reason: {correction['reason']}",
                "- Currentness is derived from the verified linear correction graph; the prior Report remains immutable.",
                "",
            ]
        )
    lines.extend(["## Findings", ""])
    for finding in analysis["findings"]:
        refs = ", ".join(_label(item) for item in finding["evidenceRefs"])
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
            refs = ", ".join(_label(item) for item in recommendation["evidenceRefs"])
            conditions = "; ".join(recommendation["conditions"]) or "none declared"
            lines.extend(
                [
                    f"{index}. **{recommendation['action']}** — {recommendation['rationale']}",
                    "",
                    f"   Conditions: {conditions}. Evidence: {refs}.",
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
            "- Evidence anchor: `run`",
            f"- Study: `{report['anchor']['studyId']}`",
            f"- Run: `{report['anchor']['runId']}`",
            f"- Harness: `{report['harness']['id']}@{report['harness']['version']}` commit `{report['harness']['commit']}`",
            f"- Result hash: `{report['anchor']['resultHash']}`",
            f"- Study input hash: `{report['anchor']['studyInputHash']}`",
            "",
            "Publish this exact Markdown through OpenAlice Inbox only if the host",
            "needs authenticated conversation provenance. The research evidence",
            "itself is complete without a Session.",
            "",
        ]
    )
    return "\n".join(lines)


def _prepare_correction(
    project: ProjectContext,
    anchor: dict[str, Any],
    *,
    corrects_report_id: str | None,
    correction_review: str | Path | None,
    correction_reason: str | None,
) -> tuple[dict[str, Any] | None, Any | None]:
    configured = (
        corrects_report_id is not None,
        correction_review is not None,
        correction_reason is not None,
    )
    if not any(configured):
        return None, None
    if not all(configured):
        raise AutoQuantValidationError(
            [
                _issue(
                    project.root_dir,
                    "report.correction-arguments",
                    "Report correction requires corrects Report, governing Review, and reason together",
                )
            ]
        )
    assert corrects_report_id is not None
    assert correction_review is not None
    assert correction_reason is not None
    reason = correction_reason.strip()
    if not reason:
        raise AutoQuantValidationError(
            [_issue(project.root_dir, "report.correction-reason", "Correction reason must be non-empty")]
        )
    prior = load_run_report(project, corrects_report_id)
    if prior.report["anchor"] != anchor:
        raise AutoQuantValidationError(
            [
                _issue(
                    prior.root_dir,
                    "report.correction-anchor",
                    "Corrected and prior Reports must freeze the same exact Run anchor",
                )
            ]
        )
    prior_summary = next(
        (item for item in list_run_reports(project) if item.id == corrects_report_id),
        None,
    )
    if prior_summary is None or prior_summary.current is not True:
        raise AutoQuantValidationError(
            [
                _issue(
                    prior.root_dir,
                    "report.correction-stale",
                    "A correction must extend a current terminal Report, not an already superseded Report",
                )
            ]
        )

    from .reviews import REVIEW_ID, load_review, load_review_package

    review_input = str(correction_review)
    review = (
        load_review(project, review_input)
        if REVIEW_ID.fullmatch(review_input)
        else load_review_package(correction_review, project=project)
    )
    target = review.manifest["target"]
    if (
        target["reportId"] != prior.report["id"]
        or target["reportHash"] != prior.manifest["reportHash"]
        or target["sessionId"] is not None
        or target["runId"] != anchor["runId"]
        or target["resultHash"] != anchor["resultHash"]
    ):
        raise AutoQuantValidationError(
            [
                _issue(
                    review.root_dir,
                    "report.correction-review-target",
                    "Governing Review must target the exact prior Run-bound Report and Run",
                )
            ]
        )
    package_path = (
        Path(GOVERNING_REVIEW_DIRECTORY) / review.review["id"]
    ).as_posix()
    correction = {
        "schemaVersion": SCHEMA_VERSION,
        "kind": REPORT_CORRECTION_KIND,
        "corrects": {
            "reportId": prior.report["id"],
            "reportHash": prior.manifest["reportHash"],
            "publishedAt": prior.report["publishedAt"],
            "anchor": prior.report["anchor"],
        },
        "governingReview": {
            "id": review.review["id"],
            "reviewHash": review.manifest["reviewHash"],
            "manifestHash": hash_file(review.root_dir / "manifest.json"),
            "conclusion": review.analysis["conclusion"],
            "packagePath": package_path,
        },
        "reason": reason,
    }
    return correction, review


def publish_run_report(
    project: ProjectContext,
    study_id: str,
    run_id: str,
    analysis: dict[str, Any],
    *,
    corrects_report_id: str | None = None,
    correction_review: str | Path | None = None,
    correction_reason: str | None = None,
) -> ReportContext:
    normalized = validate_publishable_report_analysis(analysis)
    anchor, _study, run, intake = _anchor(project, study_id, run_id)
    correction, governing_review = _prepare_correction(
        project,
        anchor,
        corrects_report_id=corrects_report_id,
        correction_review=correction_review,
        correction_reason=correction_reason,
    )
    request, request_hash = _request_for_run(run, intake)
    published = datetime.now(timezone.utc)
    published_at = published.isoformat()
    evidence, catalog = _evidence(project, run, published_at=published_at)
    _resolve_analysis_evidence(normalized, catalog, "analysis")
    analysis_hash = hash_json(normalized)
    evidence_hash = hash_json(evidence)
    identity = hash_json(
        {
            "anchor": anchor,
            "requestHash": request_hash,
            "analysisHash": analysis_hash,
            "evidenceHash": evidence_hash,
            "publishedAt": published_at,
            **({"correction": correction} if correction is not None else {}),
        }
    )
    report_id = f"report-{published.strftime('%Y%m%dT%H%M%S%fZ')}-{identity[:12]}"
    root = _reports_root(project, create=True)
    target = confined_path(root, report_id, f"report/{report_id}")
    staging = root / f".{report_id}.creating"
    if target.exists() or target.is_symlink() or staging.exists():
        raise AutoQuantValidationError(
            [_issue(target, "report.collision", "Research Report already exists")]
        )
    report = {
        "schemaVersion": SCHEMA_VERSION,
        "kind": RUN_REPORT_KIND,
        "id": report_id,
        "authority": "quantitative-decision-support",
        "tradingAuthority": "none",
        "publishedAt": published_at,
        "project": {"id": project.manifest.id, "name": project.manifest.name},
        "anchor": anchor,
        "request": request,
        "harness": run.result["harness"],
        "analysisHash": analysis_hash,
        "evidenceHash": evidence_hash,
        "analysis": normalized,
        "evidence": evidence,
        **({"correction": correction} if correction is not None else {}),
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
        (staging / REPORT_MARKDOWN).write_text(_render_markdown(report), encoding="utf-8")
        if governing_review is not None:
            embedded_root = (
                staging
                / GOVERNING_REVIEW_DIRECTORY
                / governing_review.review["id"]
            )
            embedded_root.parent.mkdir()
            shutil.copytree(governing_review.root_dir, embedded_root)
        files = _report_files(staging)
        manifest = {
            "schemaVersion": SCHEMA_VERSION,
            "id": report_id,
            "anchor": anchor,
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
    return load_run_report(project, report_id)


def build_run_report_analysis_draft(
    project: ProjectContext,
    study_id: str,
    run_id: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Build a draft only after the direct Run anchor is fully reportable."""

    anchor, study, run, _intake = _anchor(project, study_id, run_id)
    draft = build_report_analysis_draft(
        run,
        title=f"{study.definition.name} evidence conclusion",
    )
    return draft, anchor


def _validate_result(
    project: ProjectContext,
    report: dict[str, Any],
    path: Path,
    report_id: str,
) -> None:
    required = {
        "schemaVersion",
        "kind",
        "id",
        "authority",
        "tradingAuthority",
        "publishedAt",
        "project",
        "anchor",
        "request",
        "harness",
        "analysisHash",
        "evidenceHash",
        "analysis",
        "evidence",
        "openAliceHandoff",
    }
    if "correction" in report:
        required.add("correction")
    issues = _strict_keys(report, required, path)
    if (
        report.get("schemaVersion") != SCHEMA_VERSION
        or report.get("kind") != RUN_REPORT_KIND
        or report.get("id") != report_id
        or report.get("authority") != "quantitative-decision-support"
        or report.get("tradingAuthority") != "none"
    ):
        issues.append(_issue(path, "report.identity", "Invalid Run-bound Report identity"))
    if report.get("project") != {"id": project.manifest.id, "name": project.manifest.name}:
        issues.append(_issue(f"{path}/project", "report.project", "Report Project differs"))
    if "correction" in report:
        issues.extend(
            _validate_correction_shape(
                report.get("correction"),
                f"{path}/correction",
                report_id,
            )
        )
    anchor = report.get("anchor")
    if not isinstance(anchor, dict):
        issues.append(_issue(f"{path}/anchor", "schema.type", "Invalid Report anchor"))
        anchor = {}
    else:
        issues.extend(
            _strict_keys(
                anchor,
                {"kind", "studyId", "runId", "sessionId", "resultHash", "studyInputHash"},
                f"{path}/anchor",
            )
        )
        if anchor.get("kind") != "run" or anchor.get("sessionId") is not None:
            issues.append(_issue(f"{path}/anchor", "report.anchor", "Invalid Run Report anchor"))
    run = None
    if isinstance(anchor.get("runId"), str):
        try:
            run = load_run(project, anchor["runId"])
        except AutoQuantValidationError as error:
            issues.extend(error.issues)
    if run is not None:
        expected_anchor = {
            "kind": "run",
            "studyId": run.result["study"]["id"],
            "runId": run.result["id"],
            "sessionId": None,
            "resultHash": run.manifest["resultHash"],
            "studyInputHash": run.result["studyInputHash"],
        }
        if anchor != expected_anchor:
            issues.append(
                _issue(
                    f"{path}/anchor",
                    "report.anchor-evidence",
                    "Report anchor differs from immutable Run",
                )
            )
        if report.get("harness") != run.result["harness"]:
            issues.append(_issue(f"{path}/harness", "report.harness", "Report Harness differs from Run"))
    intake = load_project_intake(project)
    request = None
    request_hash = None
    if run is not None:
        try:
            request, request_hash = _request_for_run(run, intake)
        except AutoQuantValidationError as error:
            issues.extend(error.issues)
    if request is None or report.get("request") != request:
        issues.append(
            _issue(
                f"{path}/request",
                "report.request",
                "Report request differs from its immutable Run authority",
            )
        )
    try:
        normalized = validate_report_analysis(report.get("analysis"), f"{path}/analysis")
        if hash_json(normalized) != report.get("analysisHash"):
            issues.append(_issue(f"{path}/analysisHash", "report.analysis-hash", "Analysis hash mismatch"))
    except (AutoQuantValidationError, TypeError) as error:
        if isinstance(error, AutoQuantValidationError):
            issues.extend(error.issues)
        else:
            issues.append(_issue(f"{path}/analysis", "schema.type", "Invalid analysis"))
    evidence = report.get("evidence")
    if not isinstance(evidence, dict) or hash_json(evidence) != report.get("evidenceHash"):
        issues.append(_issue(f"{path}/evidenceHash", "report.evidence-hash", "Evidence hash mismatch"))
    published_at = report.get("publishedAt")
    if (
        isinstance(published_at, str)
        and isinstance(anchor, dict)
        and request_hash is not None
    ):
        try:
            published = datetime.fromisoformat(published_at)
            if published.utcoffset() is None or published.utcoffset().total_seconds() != 0:
                raise ValueError
            identity = hash_json(
                {
                    "anchor": anchor,
                    "requestHash": request_hash,
                    "analysisHash": report.get("analysisHash"),
                    "evidenceHash": report.get("evidenceHash"),
                    "publishedAt": published_at,
                    **(
                        {"correction": report.get("correction")}
                        if "correction" in report
                        else {}
                    ),
                }
            )
            expected_id = f"report-{published.strftime('%Y%m%dT%H%M%S%fZ')}-{identity[:12]}"
            if report_id != expected_id:
                issues.append(_issue(path, "report.derived-id", "Research Report id is not derived"))
        except ValueError:
            issues.append(_issue(f"{path}/publishedAt", "schema.datetime", "Invalid publishedAt"))
    else:
        issues.append(_issue(f"{path}/publishedAt", "schema.string", "Invalid publishedAt"))
    if issues:
        raise AutoQuantValidationError(issues)


def _validate_correction_shape(
    value: Any,
    path: Path | str,
    report_id: str,
) -> list[ValidationIssue]:
    if not isinstance(value, dict):
        return [_issue(path, "schema.type", "Report correction must be an object")]
    issues = _strict_keys(
        value,
        {"schemaVersion", "kind", "corrects", "governingReview", "reason"},
        path,
    )
    if value.get("schemaVersion") != SCHEMA_VERSION or value.get("kind") != REPORT_CORRECTION_KIND:
        issues.append(_issue(path, "report.correction-kind", "Invalid Report correction identity"))
    reason = value.get("reason")
    if not isinstance(reason, str) or not reason.strip():
        issues.append(_issue(f"{path}/reason", "schema.string", "Correction reason must be non-empty"))
    corrects = value.get("corrects")
    if not isinstance(corrects, dict):
        issues.append(_issue(f"{path}/corrects", "schema.type", "Correction target must be an object"))
    else:
        issues.extend(
            _strict_keys(
                corrects,
                {"reportId", "reportHash", "publishedAt", "anchor"},
                f"{path}/corrects",
            )
        )
        target_id = corrects.get("reportId")
        if not isinstance(target_id, str) or not REPORT_ID.fullmatch(target_id) or target_id == report_id:
            issues.append(_issue(f"{path}/corrects/reportId", "report.correction-target", "Invalid prior Report id"))
        if not isinstance(corrects.get("reportHash"), str) or not SHA256.fullmatch(
            corrects.get("reportHash", "")
        ):
            issues.append(_issue(f"{path}/corrects/reportHash", "schema.hash", "Invalid prior Report hash"))
        if not isinstance(corrects.get("publishedAt"), str):
            issues.append(_issue(f"{path}/corrects/publishedAt", "schema.string", "Invalid prior publication time"))
        if not isinstance(corrects.get("anchor"), dict):
            issues.append(_issue(f"{path}/corrects/anchor", "schema.type", "Invalid prior Report anchor"))
    review = value.get("governingReview")
    if not isinstance(review, dict):
        issues.append(_issue(f"{path}/governingReview", "schema.type", "Governing Review must be an object"))
    else:
        issues.extend(
            _strict_keys(
                review,
                {"id", "reviewHash", "manifestHash", "conclusion", "packagePath"},
                f"{path}/governingReview",
            )
        )
        from .reviews import REVIEW_CONCLUSIONS, REVIEW_ID

        review_id = review.get("id")
        if not isinstance(review_id, str) or not REVIEW_ID.fullmatch(review_id):
            issues.append(_issue(f"{path}/governingReview/id", "review.id", "Invalid governing Review id"))
        for key in ("reviewHash", "manifestHash"):
            digest = review.get(key)
            if not isinstance(digest, str) or not SHA256.fullmatch(digest):
                issues.append(_issue(f"{path}/governingReview/{key}", "schema.hash", f"Invalid {key}"))
        if review.get("conclusion") not in REVIEW_CONCLUSIONS:
            issues.append(_issue(f"{path}/governingReview/conclusion", "schema.choice", "Invalid Review conclusion"))
        expected_path = (
            Path(GOVERNING_REVIEW_DIRECTORY) / review_id
        ).as_posix() if isinstance(review_id, str) else None
        if review.get("packagePath") != expected_path:
            issues.append(_issue(f"{path}/governingReview/packagePath", "schema.path", "Governing Review package path is not canonical"))
    return issues


def _verify_evidence(project: ProjectContext, report: dict[str, Any], path: Path) -> None:
    evidence = report["evidence"]
    required = {"anchor", "run", "selectionIntegrity", "leaderDecisionSupport"}
    issues = _strict_keys(evidence, required, f"{path}/evidence")
    anchor = report["anchor"]
    if evidence.get("anchor") != {
        "kind": "run",
        "studyId": anchor["studyId"],
        "runId": anchor["runId"],
        "sessionId": None,
    }:
        issues.append(_issue(path, "report.evidence-anchor", "Frozen evidence anchor differs"))
    run = load_run(project, anchor["runId"])
    projection = _run_projection(run)
    if evidence.get("run") != projection:
        issues.append(_issue(path, "report.run-evidence", "Frozen Run evidence differs"))
    expected_integrity = build_selection_integrity(
        project,
        run,
        [],
        cutoff=report["publishedAt"],
    )
    if evidence.get("selectionIntegrity") != expected_integrity:
        issues.append(
            _issue(
                path,
                "report.selection-integrity",
                "Frozen selection integrity differs from the Run evidence",
            )
        )
    try:
        verify_leader_decision_support(
            project,
            evidence.get("leaderDecisionSupport"),
            anchor["runId"],
            f"{path}/evidence/leaderDecisionSupport",
        )
    except AutoQuantValidationError as error:
        issues.extend(error.issues)
    catalog = {("run", anchor["runId"]): projection}
    try:
        _resolve_analysis_evidence(report["analysis"], catalog, path)
    except AutoQuantValidationError as error:
        issues.extend(error.issues)
    if issues:
        raise AutoQuantValidationError(issues)


def _verify_correction(
    project: ProjectContext,
    context: ReportContext,
    chain: frozenset[str],
) -> None:
    correction = context.report.get("correction")
    if correction is None:
        return
    corrects = correction["corrects"]
    prior = load_run_report(
        project,
        corrects["reportId"],
        _correction_chain=chain,
    )
    issues: list[ValidationIssue] = []
    if corrects != {
        "reportId": prior.report["id"],
        "reportHash": prior.manifest["reportHash"],
        "publishedAt": prior.report["publishedAt"],
        "anchor": prior.report["anchor"],
    }:
        issues.append(
            _issue(
                context.root_dir,
                "report.correction-target",
                "Frozen prior Report identity differs from immutable Project evidence",
            )
        )
    if prior.report["anchor"] != context.report["anchor"]:
        issues.append(
            _issue(
                context.root_dir,
                "report.correction-anchor",
                "Correction and prior Report do not share the exact Run anchor",
            )
        )
    try:
        prior_at = datetime.fromisoformat(prior.report["publishedAt"])
        current_at = datetime.fromisoformat(context.report["publishedAt"])
        if prior_at >= current_at:
            raise ValueError
    except (TypeError, ValueError):
        issues.append(
            _issue(
                context.root_dir,
                "report.correction-order",
                "Correction must be published after its prior Report",
            )
        )
    review_identity = correction["governingReview"]
    package_root = confined_path(
        context.root_dir,
        review_identity["packagePath"],
        "report/governing-review",
    )
    from .reviews import load_review_package

    review = load_review_package(package_root, project=project)
    target = review.manifest["target"]
    if (
        review.review["id"] != review_identity["id"]
        or review.manifest["reviewHash"] != review_identity["reviewHash"]
        or hash_file(review.root_dir / "manifest.json") != review_identity["manifestHash"]
        or review.analysis["conclusion"] != review_identity["conclusion"]
        or target["reportId"] != prior.report["id"]
        or target["reportHash"] != prior.manifest["reportHash"]
        or target["sessionId"] is not None
        or target["runId"] != prior.report["anchor"]["runId"]
        or target["resultHash"] != prior.report["anchor"]["resultHash"]
    ):
        issues.append(
            _issue(
                package_root,
                "report.correction-review-target",
                "Embedded governing Review does not target the exact prior Report",
            )
        )
    if issues:
        raise AutoQuantValidationError(issues)


def load_run_report(
    project: ProjectContext,
    report_id: str,
    *,
    _correction_chain: frozenset[str] = frozenset(),
) -> ReportContext:
    if report_id in _correction_chain:
        raise AutoQuantValidationError(
            [_issue(report_id, "report.correction-cycle", "Report correction lineage contains a cycle")]
        )
    chain = _correction_chain | {report_id}
    root = _report_root(project, report_id)
    if root.is_symlink() or not root.is_dir():
        raise AutoQuantValidationError(
            [_issue(root, "report.missing", f"Unknown Run-bound Research Report: {report_id}")]
        )
    manifest = _read_json(root / REPORT_MANIFEST, "report manifest")
    required = {"schemaVersion", "id", "anchor", "completed", "reportHash", "files"}
    issues = _strict_keys(manifest, required, root / REPORT_MANIFEST)
    if (
        manifest.get("schemaVersion") != SCHEMA_VERSION
        or manifest.get("id") != report_id
        or manifest.get("completed") is not True
    ):
        issues.append(_issue(root / REPORT_MANIFEST, "report.manifest", "Invalid terminal manifest"))
    actual = _report_files(root)
    files = manifest.get("files")
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
    _validate_result(project, report, root / REPORT_RESULT, report_id)
    if report["analysis"] != analysis:
        raise AutoQuantValidationError(
            [_issue(root, "report.analysis", "Stored analysis differs from report")]
        )
    if manifest["anchor"] != report["anchor"]:
        raise AutoQuantValidationError(
            [_issue(root, "report.anchor", "Manifest anchor differs from Report")]
        )
    if (root / REPORT_MARKDOWN).read_text(encoding="utf-8") != _render_markdown(report):
        raise AutoQuantValidationError(
            [_issue(root / REPORT_MARKDOWN, "report.markdown", "Report Markdown is not canonical")]
        )
    _verify_evidence(project, report, root / REPORT_RESULT)
    context = ReportContext(root, manifest, report, analysis)
    _verify_correction(project, context, chain)
    return context


def list_run_reports(
    project: ProjectContext,
    study_id: str | None = None,
) -> list[ReportSummary]:
    root = project.root_dir / RUN_REPORTS_DIRECTORY
    if not root.exists() and not root.is_symlink():
        return []
    root = _reports_root(project, create=False)
    contexts: list[ReportContext] = []
    for entry in sorted(root.iterdir(), key=lambda item: item.name):
        if entry.name.startswith("."):
            continue
        if entry.is_symlink() or not entry.is_dir():
            raise AutoQuantValidationError(
                [_issue(entry, "report.entry", "Report entries must be real directories")]
            )
        contexts.append(load_run_report(project, entry.name))
    successors: dict[str, str] = {}
    by_id = {item.report["id"]: item for item in contexts}
    for context in contexts:
        correction = context.report.get("correction")
        if correction is None:
            continue
        prior_id = correction["corrects"]["reportId"]
        if prior_id in successors:
            raise AutoQuantValidationError(
                [
                    _issue(
                        context.root_dir,
                        "report.correction-branch",
                        "One Report cannot have multiple current correction successors",
                    )
                ]
            )
        successors[prior_id] = context.report["id"]

    depths: dict[str, int] = {}

    def lineage_depth(report_id: str) -> int:
        if report_id in depths:
            return depths[report_id]
        context = by_id[report_id]
        correction = context.report.get("correction")
        depth = (
            0
            if correction is None
            else lineage_depth(correction["corrects"]["reportId"]) + 1
        )
        depths[report_id] = depth
        return depth

    summaries: list[ReportSummary] = []
    for report in contexts:
        anchor = report.report["anchor"]
        if study_id is not None and anchor["studyId"] != study_id:
            continue
        report_id = report.report["id"]
        summaries.append(
            ReportSummary(
                id=report_id,
                title=report.analysis["title"],
                session_id=None,
                leader_run_id=anchor["runId"],
                findings=len(report.analysis["findings"]),
                recommendations=len(report.analysis["recommendations"]),
                published_at=report.report["publishedAt"],
                path=str(report.root_dir),
                markdown_path=str(report.root_dir / REPORT_MARKDOWN),
                executive_summary=report.analysis["executiveSummary"],
                authority=report.report["authority"],
                leader_decision_support=summarize_leader_decision_support(
                    report.report["evidence"].get("leaderDecisionSupport")
                ),
                selection_integrity=report.report["evidence"]["selectionIntegrity"],
                anchor_kind="run",
                study_id=anchor["studyId"],
                correction=report.report.get("correction"),
                current=report_id not in successors,
                superseded_by=successors.get(report_id),
                lineage_depth=lineage_depth(report_id),
            )
        )
    return summaries
