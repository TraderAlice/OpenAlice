"""Immutable independent reviews of completed Research Reports.

A Review is interpretation of an existing frozen Report and its anchor Run. It
never changes the reviewed evidence.  Attached Reviews live under a Project;
detached Reviews use the same portable package format outside the target
Workspace so a no-mutation reviewer can still leave a strict handoff.
"""

from __future__ import annotations

import json
import os
import re
import shutil
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any

from .reports import (
    REPORT_ANALYSIS,
    REPORT_MANIFEST,
    REPORT_MARKDOWN,
    REPORT_RESULT,
    ReportContext,
    _read_json,
    _write_json,
    load_report,
)
from .run_reports import load_run_report
from .runs import load_run
from .sessions import load_session
from .studies import hash_file, hash_json
from .workspace import (
    SCHEMA_VERSION,
    AutoQuantValidationError,
    ProjectContext,
    ValidationIssue,
    confined_path,
)


REVIEWS_DIRECTORY = "reviews"
REVIEW_ANALYSIS = "analysis.json"
REVIEW_EVIDENCE = "evidence.json"
REVIEW_RESULT = "review.json"
REVIEW_MARKDOWN = "review.md"
REVIEW_MANIFEST = "manifest.json"

REVIEW_ANALYSIS_KIND = "autoquant-research-review-analysis"
REVIEW_EVIDENCE_KIND = "autoquant-research-review-evidence"
REVIEW_KIND = "autoquant-research-review"
REVIEW_MANIFEST_KIND = "autoquant-research-review-manifest"
REVIEW_ID = re.compile(r"^review-[0-9]{8}T[0-9]{12}Z-[0-9a-f]{12}$")
CLAIM_ID = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")

REVIEW_CONCLUSIONS = {
    "accepted",
    "accepted-with-reservations",
    "rejected",
    "inconclusive",
}
REVIEW_CLASSIFICATIONS = {
    "verified",
    "declared",
    "observed-unbound",
    "unverified",
}
REVIEW_REFERENCE_KINDS = {"report", "run", "observed-file"}
REMEDIATION_PRIORITIES = {"P0", "P1", "P2", "P3"}


@dataclass(frozen=True)
class ReviewContext:
    root_dir: Path
    manifest: dict[str, Any]
    review: dict[str, Any]
    analysis: dict[str, Any]
    evidence: dict[str, Any]


@dataclass(frozen=True)
class ReviewSummary:
    id: str
    title: str
    conclusion: str
    report_id: str
    run_id: str
    session_id: str | None
    claims: int
    classifications: dict[str, int]
    published_at: str
    path: str
    markdown_path: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "conclusion": self.conclusion,
            "target": {
                "reportId": self.report_id,
                "runId": self.run_id,
                "sessionId": self.session_id,
            },
            "claims": self.claims,
            "classifications": self.classifications,
            "publishedAt": self.published_at,
            "path": self.path,
            "markdownPath": self.markdown_path,
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


def _valid_relative_path(value: Any, path: Path | str) -> list[ValidationIssue]:
    if not isinstance(value, str) or not value or "\\" in value:
        return [_issue(path, "schema.path", "Must be a confined POSIX relative path")]
    candidate = PurePosixPath(value)
    if candidate.is_absolute() or value in {".", ".."} or ".." in candidate.parts:
        return [_issue(path, "schema.path", "Must be a confined POSIX relative path")]
    return []


def _validate_refs(
    value: Any,
    path: Path | str,
    *,
    allow_empty: bool,
) -> tuple[list[dict[str, Any]], list[ValidationIssue]]:
    if not isinstance(value, list) or (not allow_empty and not value):
        return [], [
            _issue(
                path,
                "schema.array",
                "evidenceRefs must be an array"
                + ("" if allow_empty else " with at least one item"),
            )
        ]
    normalized: list[dict[str, Any]] = []
    issues: list[ValidationIssue] = []
    identities: list[tuple[Any, Any, Any]] = []
    for index, reference in enumerate(value):
        ref_path = f"{path}/{index}"
        if not isinstance(reference, dict):
            issues.append(_issue(ref_path, "schema.type", "Evidence reference must be an object"))
            continue
        issues.extend(_strict_keys(reference, {"kind", "id", "artifactPath"}, ref_path))
        kind = reference.get("kind")
        if kind not in REVIEW_REFERENCE_KINDS:
            issues.append(_issue(f"{ref_path}/kind", "schema.choice", "Invalid review evidence kind"))
        reference_id = reference.get("id")
        issues.extend(_non_empty(reference_id, f"{ref_path}/id"))
        artifact_path = reference.get("artifactPath")
        if artifact_path is not None:
            issues.extend(_valid_relative_path(artifact_path, f"{ref_path}/artifactPath"))
        if kind == "observed-file":
            issues.extend(_valid_relative_path(reference_id, f"{ref_path}/id"))
            if artifact_path is not None:
                issues.append(
                    _issue(
                        f"{ref_path}/artifactPath",
                        "review.observed-artifact",
                        "observed-file uses id as its observation-root-relative path and requires artifactPath null",
                    )
                )
        item = {
            "kind": kind,
            "id": reference_id.strip() if isinstance(reference_id, str) else reference_id,
            "artifactPath": (
                artifact_path.strip() if isinstance(artifact_path, str) else artifact_path
            ),
        }
        normalized.append(item)
        identities.append((item["kind"], item["id"], item["artifactPath"]))
    if len(identities) != len(set(identities)):
        issues.append(_issue(path, "review.duplicate-evidence", "Evidence references must be unique within a claim"))
    return normalized, issues


def validate_review_analysis(
    value: dict[str, Any],
    path: Path | str = "review-analysis",
) -> dict[str, Any]:
    required = {
        "schemaVersion",
        "kind",
        "title",
        "executiveVerdict",
        "conclusion",
        "claims",
        "remediations",
        "limitations",
        "unresolvedQuestions",
    }
    issues = _strict_keys(value, required, path)
    if value.get("schemaVersion") != SCHEMA_VERSION:
        issues.append(_issue(f"{path}/schemaVersion", "schema.version", "Expected V1"))
    if value.get("kind") != REVIEW_ANALYSIS_KIND:
        issues.append(_issue(f"{path}/kind", "review.kind", f"Expected {REVIEW_ANALYSIS_KIND}"))
    for key in ("title", "executiveVerdict"):
        issues.extend(_non_empty(value.get(key), f"{path}/{key}"))
    if value.get("conclusion") not in REVIEW_CONCLUSIONS:
        issues.append(_issue(f"{path}/conclusion", "schema.choice", "Invalid Review conclusion"))
    for key in ("limitations", "unresolvedQuestions"):
        issues.extend(_string_list(value.get(key), f"{path}/{key}", allow_empty=True))

    normalized_claims: list[dict[str, Any]] = []
    claim_ids: list[str] = []
    claims = value.get("claims")
    if not isinstance(claims, list) or not claims:
        issues.append(_issue(f"{path}/claims", "schema.array", "Review claims must contain at least one item"))
        claims = []
    for index, claim in enumerate(claims):
        claim_path = f"{path}/claims/{index}"
        if not isinstance(claim, dict):
            issues.append(_issue(claim_path, "schema.type", "Review claim must be an object"))
            continue
        issues.extend(
            _strict_keys(
                claim,
                {"id", "claim", "classification", "rationale", "evidenceRefs"},
                claim_path,
            )
        )
        claim_id = claim.get("id")
        if not isinstance(claim_id, str) or not CLAIM_ID.fullmatch(claim_id):
            issues.append(_issue(f"{claim_path}/id", "schema.id", "Claim id must be lowercase kebab-case"))
        else:
            claim_ids.append(claim_id)
        for key in ("claim", "rationale"):
            issues.extend(_non_empty(claim.get(key), f"{claim_path}/{key}"))
        classification = claim.get("classification")
        if classification not in REVIEW_CLASSIFICATIONS:
            issues.append(_issue(f"{claim_path}/classification", "schema.choice", "Invalid evidence classification"))
        refs, ref_issues = _validate_refs(
            claim.get("evidenceRefs"),
            f"{claim_path}/evidenceRefs",
            allow_empty=classification == "unverified",
        )
        issues.extend(ref_issues)
        observed = any(ref["kind"] == "observed-file" for ref in refs)
        if classification in {"verified", "declared"} and observed:
            issues.append(
                _issue(
                    f"{claim_path}/evidenceRefs",
                    "review.bound-classification",
                    f"{classification} claims cannot use observed-unbound Workspace files",
                )
            )
        if classification == "observed-unbound" and not observed:
            issues.append(
                _issue(
                    f"{claim_path}/evidenceRefs",
                    "review.observed-required",
                    "observed-unbound claims require at least one observed-file reference",
                )
            )
        normalized_claims.append(
            {
                "id": claim_id,
                "claim": claim.get("claim", "").strip() if isinstance(claim.get("claim"), str) else claim.get("claim"),
                "classification": classification,
                "rationale": claim.get("rationale", "").strip() if isinstance(claim.get("rationale"), str) else claim.get("rationale"),
                "evidenceRefs": refs,
            }
        )
    if len(claim_ids) != len(set(claim_ids)):
        issues.append(_issue(f"{path}/claims", "review.duplicate-claim", "Review claim ids must be unique"))

    normalized_remediations: list[dict[str, Any]] = []
    remediations = value.get("remediations")
    if not isinstance(remediations, list):
        issues.append(_issue(f"{path}/remediations", "schema.array", "Remediations must be an array"))
        remediations = []
    for index, remediation in enumerate(remediations):
        remediation_path = f"{path}/remediations/{index}"
        if not isinstance(remediation, dict):
            issues.append(_issue(remediation_path, "schema.type", "Remediation must be an object"))
            continue
        issues.extend(_strict_keys(remediation, {"priority", "action", "rationale", "claimIds"}, remediation_path))
        if remediation.get("priority") not in REMEDIATION_PRIORITIES:
            issues.append(_issue(f"{remediation_path}/priority", "schema.choice", "Priority must be P0, P1, P2, or P3"))
        for key in ("action", "rationale"):
            issues.extend(_non_empty(remediation.get(key), f"{remediation_path}/{key}"))
        claim_refs = remediation.get("claimIds")
        issues.extend(_string_list(claim_refs, f"{remediation_path}/claimIds", allow_empty=False))
        if isinstance(claim_refs, list):
            unknown = [item for item in claim_refs if item not in claim_ids]
            if unknown:
                issues.append(_issue(f"{remediation_path}/claimIds", "review.unknown-claim", f"Unknown Review claim ids: {', '.join(unknown)}"))
            if len(claim_refs) != len(set(claim_refs)):
                issues.append(_issue(f"{remediation_path}/claimIds", "review.duplicate-claim-ref", "Remediation claimIds must be unique"))
        normalized_remediations.append(
            {
                "priority": remediation.get("priority"),
                "action": remediation.get("action", "").strip() if isinstance(remediation.get("action"), str) else remediation.get("action"),
                "rationale": remediation.get("rationale", "").strip() if isinstance(remediation.get("rationale"), str) else remediation.get("rationale"),
                "claimIds": [item.strip() for item in claim_refs] if isinstance(claim_refs, list) else [],
            }
        )
    if issues:
        raise AutoQuantValidationError(issues)
    return {
        "schemaVersion": SCHEMA_VERSION,
        "kind": REVIEW_ANALYSIS_KIND,
        "title": value["title"].strip(),
        "executiveVerdict": value["executiveVerdict"].strip(),
        "conclusion": value["conclusion"],
        "claims": normalized_claims,
        "remediations": normalized_remediations,
        "limitations": [item.strip() for item in value["limitations"]],
        "unresolvedQuestions": [item.strip() for item in value["unresolvedQuestions"]],
    }


def load_review_analysis(path: str | Path) -> dict[str, Any]:
    analysis_path = Path(path).expanduser().absolute()
    return validate_review_analysis(_read_json(analysis_path, "review analysis"), analysis_path)


def _target_report(
    project: ProjectContext,
    report_id: str,
    session_id: str | None,
) -> tuple[ReportContext, dict[str, Any], Any]:
    report = (
        load_run_report(project, report_id)
        if session_id is None
        else load_report(project, load_session(project, session_id), report_id)
    )
    if session_id is None:
        anchor = report.report["anchor"]
    else:
        session = report.report["evidence"]["session"]
        anchor = {
            "kind": "session",
            "studyId": session["studyId"],
            "runId": session["leader"]["runId"],
            "sessionId": session_id,
            "resultHash": next(
                item["resultHash"]
                for item in report.report["evidence"]["runs"]
                if item["id"] == session["leader"]["runId"]
            ),
        }
    run = load_run(project, anchor["runId"])
    if run.manifest["resultHash"] != anchor["resultHash"]:
        raise AutoQuantValidationError(
            [_issue(report.root_dir, "review.target-run", "Target Report anchor Run hash differs from current immutable Run")]
        )
    return report, anchor, run


def _formal_report_refs(report: ReportContext) -> list[dict[str, Any]]:
    refs: list[dict[str, Any]] = []
    for owner_kind, owners in (
        ("finding", report.analysis["findings"]),
        ("recommendation", report.analysis["recommendations"]),
    ):
        for index, owner in enumerate(owners):
            refs.append(
                {
                    "ownerKind": owner_kind,
                    "ownerId": owner.get("id") if owner_kind == "finding" else f"recommendation-{index + 1}",
                    "claim": owner.get("claim") if owner_kind == "finding" else owner.get("action"),
                    "evidenceRefs": owner["evidenceRefs"],
                }
            )
    return refs


def _resolve_review_evidence(
    analysis: dict[str, Any],
    *,
    project: ProjectContext,
    report: ReportContext,
    anchor: dict[str, Any],
    run: Any,
    observation_root: Path,
    observation_scope: str,
) -> dict[str, Any]:
    if observation_scope not in {"workspace", "project"}:
        raise AutoQuantValidationError(
            [_issue(observation_scope, "review.observation-scope", "Observation scope must be workspace or project")]
        )
    if observation_root.is_symlink() or not observation_root.is_dir():
        raise AutoQuantValidationError(
            [_issue(observation_root, "review.observation-root", "Observation root must be a real directory")]
        )
    observation_root = observation_root.resolve()
    report_files = report.manifest["files"]
    run_artifacts = {
        item["path"]
        for item in run.result["artifacts"]
        if isinstance(item, dict) and isinstance(item.get("path"), str)
    }
    resolved: dict[tuple[str, str, str | None], dict[str, Any]] = {}
    issues: list[ValidationIssue] = []
    references = [
        ref
        for claim in analysis["claims"]
        for ref in claim["evidenceRefs"]
    ]
    for index, ref in enumerate(references):
        key = (ref["kind"], ref["id"], ref["artifactPath"])
        if key in resolved:
            continue
        path = f"review-analysis/evidenceRefs/{index}"
        if ref["kind"] == "report":
            if ref["id"] != report.report["id"]:
                issues.append(_issue(path, "review.target-report", "Review may reference only its exact target Report"))
                continue
            artifact_path = ref["artifactPath"]
            if artifact_path is not None and artifact_path not in report_files:
                issues.append(_issue(path, "review.report-artifact", f"Target Report does not contain {artifact_path}"))
                continue
            resolved[key] = {
                **ref,
                "authority": "bound-immutable",
                "sha256": report.manifest["reportHash"] if artifact_path is None else report_files[artifact_path],
            }
        elif ref["kind"] == "run":
            if ref["id"] != anchor["runId"]:
                issues.append(_issue(path, "review.target-run", "Review may reference only the target Report anchor Run"))
                continue
            artifact_path = ref["artifactPath"]
            if artifact_path is not None and artifact_path not in run_artifacts:
                issues.append(_issue(path, "review.run-artifact", f"Anchor Run does not declare {artifact_path}"))
                continue
            if artifact_path is not None and artifact_path not in run.manifest["files"]:
                issues.append(_issue(path, "review.run-artifact-hash", f"Anchor Run manifest does not hash {artifact_path}"))
                continue
            resolved[key] = {
                **ref,
                "authority": "bound-immutable",
                "sha256": run.manifest["resultHash"] if artifact_path is None else run.manifest["files"][artifact_path],
            }
        else:
            observed = confined_path(observation_root, ref["id"], f"{path}/id")
            if observed.is_symlink() or not observed.is_file():
                issues.append(
                    _issue(
                        observed,
                        "review.observed-file",
                        "Observed evidence must be a real file under the declared "
                        f"{observation_scope} observation root {observation_root}; "
                        "Workspace staging requires a Workspace entry path plus "
                        "--project.",
                    )
                )
                continue
            resolved[key] = {
                **ref,
                "authority": "observed-unbound",
                "scope": observation_scope,
                "sha256": hash_file(observed),
                "sizeBytes": observed.stat().st_size,
            }
    if issues:
        raise AutoQuantValidationError(issues)
    target = {
        "project": {"id": project.manifest.id, "name": project.manifest.name},
        "report": {
            "id": report.report["id"],
            "reportHash": report.manifest["reportHash"],
            "files": report.manifest["files"],
            "sessionId": anchor["sessionId"],
        },
        "anchor": anchor,
        "run": {
            "id": run.result["id"],
            "resultHash": run.manifest["resultHash"],
            "study": run.result["study"],
            "studyInputHash": run.result["studyInputHash"],
            "dataset": run.result["dataset"],
            "harness": run.result["harness"],
        },
    }
    return {
        "schemaVersion": SCHEMA_VERSION,
        "kind": REVIEW_EVIDENCE_KIND,
        "target": target,
        "reportEvidenceRefs": _formal_report_refs(report),
        "resolvedRefs": list(resolved.values()),
        "authority": {
            "review": "independent-evidence-classification",
            "quantitative": "target-report-and-run-only",
            "observedFiles": "recorded-but-not-promoted",
            "trading": "none",
        },
    }


def _reference_label(ref: dict[str, Any]) -> str:
    label = f"{ref['kind']}:{ref['id']}"
    if ref["artifactPath"] is not None:
        label += f"#{ref['artifactPath']}"
    return f"`{label}`"


def _render_markdown(review: dict[str, Any]) -> str:
    analysis = review["analysis"]
    target = review["evidence"]["target"]
    lines = [
        f"# {analysis['title']}",
        "",
        "> Authority: independent review of frozen research evidence only. This",
        "> Review does not alter the target Report, authenticate a provider or",
        "> account, create new quantitative results, or grant trading authority.",
        "",
        "## Target identity",
        "",
        f"- Project: `{target['project']['id']}`",
        f"- Report: `{target['report']['id']}`",
        f"- Report hash: `{target['report']['reportHash']}`",
        f"- Anchor Run: `{target['run']['id']}`",
        f"- Run result hash: `{target['run']['resultHash']}`",
        f"- Session: `{target['report']['sessionId'] or 'none'}`",
        f"- Published: `{review['publishedAt']}`",
        "",
        "## Executive verdict",
        "",
        analysis["executiveVerdict"],
        "",
        f"Conclusion: **{analysis['conclusion']}**",
        "",
        "## Claim classifications",
        "",
    ]
    for claim in analysis["claims"]:
        lines.extend(
            [
                f"### {claim['id']} — {claim['classification']}",
                "",
                claim["claim"],
                "",
                f"Rationale: {claim['rationale']}",
                "",
                "Evidence: " + (
                    ", ".join(_reference_label(ref) for ref in claim["evidenceRefs"])
                    if claim["evidenceRefs"]
                    else "none available"
                ),
                "",
            ]
        )
    lines.extend(["## Remediation", ""])
    if analysis["remediations"]:
        for item in analysis["remediations"]:
            lines.extend(
                [
                    f"- **{item['priority']}** — {item['action']}",
                    f"  Rationale: {item['rationale']}",
                    f"  Claims: {', '.join(f'`{claim_id}`' for claim_id in item['claimIds'])}",
                ]
            )
    else:
        lines.append("- None.")
    lines.extend(["", "## Limitations", ""])
    lines.extend(f"- {item}" for item in analysis["limitations"])
    if not analysis["limitations"]:
        lines.append("- None declared.")
    lines.extend(["", "## Unresolved questions", ""])
    lines.extend(f"- {item}" for item in analysis["unresolvedQuestions"])
    if not analysis["unresolvedQuestions"]:
        lines.append("- None declared.")
    lines.extend(
        [
            "",
            "## Evidence boundary",
            "",
            "`verified` and `declared` claims may cite only immutable target",
            "Report/Run identities. `observed-unbound` records the exact digest",
            "of a visible file without importing it into target authority.",
            "`unverified` records absence, contradiction, staleness, or a broken",
            "connection without manufacturing replacement evidence.",
            "",
        ]
    )
    return "\n".join(lines)


def _files(root: Path) -> dict[str, str]:
    files: dict[str, str] = {}
    for path in sorted(root.iterdir(), key=lambda item: item.name):
        if path.name == REVIEW_MANIFEST:
            continue
        if path.is_symlink() or not path.is_file():
            raise AutoQuantValidationError(
                [_issue(path, "review.entry", "Review package entries must be real files")]
            )
        files[path.name] = hash_file(path)
    return files


def _reviews_root(project: ProjectContext, *, create: bool) -> Path:
    root = confined_path(project.root_dir, REVIEWS_DIRECTORY, "project/reviews")
    if root.is_symlink():
        raise AutoQuantValidationError(
            [_issue(root, "path.symlink", "Project Reviews directory cannot be a symlink")]
        )
    if create:
        root.mkdir(exist_ok=True)
    if not root.is_dir():
        raise AutoQuantValidationError(
            [_issue(root, "review.directory", "Missing Project Reviews directory")]
        )
    return root


def _destination_root(project: ProjectContext, output_root: Path | None) -> Path:
    if output_root is None:
        return _reviews_root(project, create=True)
    root = output_root.expanduser().absolute()
    if root.is_symlink():
        raise AutoQuantValidationError(
            [_issue(root, "path.symlink", "Detached Review output root cannot be a symlink")]
        )
    root.mkdir(parents=True, exist_ok=True)
    if not root.is_dir():
        raise AutoQuantValidationError(
            [_issue(root, "review.output", "Detached Review output root must be a directory")]
        )
    return root.resolve()


def publish_review(
    project: ProjectContext,
    report_id: str,
    analysis: dict[str, Any],
    *,
    session_id: str | None = None,
    observation_root: Path | None = None,
    observation_scope: str = "project",
    output_root: Path | None = None,
) -> ReviewContext:
    normalized = validate_review_analysis(analysis)
    report, anchor, run = _target_report(project, report_id, session_id)
    observed_root = (observation_root or project.root_dir).expanduser().absolute()
    if output_root is not None:
        raw_detached_root = output_root.expanduser().absolute()
        if raw_detached_root.is_symlink():
            raise AutoQuantValidationError(
                [_issue(raw_detached_root, "path.symlink", "Detached Review output root cannot be a symlink")]
            )
        detached_root = raw_detached_root.resolve(strict=False)
        protected_roots = {project.root_dir.resolve(), observed_root.resolve()}
        if any(
            detached_root == protected or detached_root.is_relative_to(protected)
            for protected in protected_roots
        ):
            raise AutoQuantValidationError(
                [
                    _issue(
                        detached_root,
                        "review.detached-boundary",
                        "Detached Review output must be outside the reviewed Project and observation root",
                    )
                ]
            )
    evidence = _resolve_review_evidence(
        normalized,
        project=project,
        report=report,
        anchor=anchor,
        run=run,
        observation_root=observed_root,
        observation_scope=observation_scope,
    )
    published = datetime.now(timezone.utc)
    stamp = published.strftime("%Y%m%dT%H%M%S%fZ")
    analysis_hash = hash_json(normalized)
    evidence_hash = hash_json(evidence)
    identity = hash_json(
        {
            "target": evidence["target"],
            "analysisHash": analysis_hash,
            "evidenceHash": evidence_hash,
            "publishedAt": published.isoformat(),
        }
    )
    review_id = f"review-{stamp}-{identity[:12]}"
    review = {
        "schemaVersion": SCHEMA_VERSION,
        "kind": REVIEW_KIND,
        "id": review_id,
        "authority": "independent-evidence-review",
        "tradingAuthority": "none",
        "publishedAt": published.isoformat(),
        "analysisHash": analysis_hash,
        "evidenceHash": evidence_hash,
        "analysis": normalized,
        "evidence": evidence,
    }
    parent = _destination_root(project, output_root)
    target = parent / review_id
    staging = parent / f".{review_id}.creating"
    if target.exists() or target.is_symlink() or staging.exists() or staging.is_symlink():
        raise AutoQuantValidationError(
            [_issue(target, "review.collision", "Independent Review already exists")]
        )
    try:
        staging.mkdir()
        _write_json(staging / REVIEW_ANALYSIS, normalized)
        _write_json(staging / REVIEW_EVIDENCE, evidence)
        _write_json(staging / REVIEW_RESULT, review)
        (staging / REVIEW_MARKDOWN).write_text(_render_markdown(review), encoding="utf-8")
        files = _files(staging)
        manifest = {
            "schemaVersion": SCHEMA_VERSION,
            "kind": REVIEW_MANIFEST_KIND,
            "id": review_id,
            "completed": True,
            "target": {
                "projectId": project.manifest.id,
                "reportId": report_id,
                "reportHash": report.manifest["reportHash"],
                "runId": anchor["runId"],
                "resultHash": run.manifest["resultHash"],
                "sessionId": session_id,
            },
            "analysisHash": files[REVIEW_ANALYSIS],
            "evidenceHash": files[REVIEW_EVIDENCE],
            "reviewHash": files[REVIEW_RESULT],
            "files": files,
        }
        _write_json(staging / REVIEW_MANIFEST, manifest)
        os.replace(staging, target)
    except Exception:
        if staging.exists():
            shutil.rmtree(staging)
        raise
    return load_review_package(target, project=project)


def load_review_package(
    directory: str | Path,
    *,
    project: ProjectContext | None = None,
) -> ReviewContext:
    raw_root = Path(directory).expanduser().absolute()
    if raw_root.is_symlink() or not raw_root.is_dir():
        raise AutoQuantValidationError(
            [_issue(raw_root, "review.directory", "Review package must be a real directory")]
        )
    root = raw_root.resolve()
    review_id = root.name
    if not REVIEW_ID.fullmatch(review_id):
        raise AutoQuantValidationError([_issue(root, "review.id", "Invalid Independent Review directory id")])
    manifest = _read_json(root / REVIEW_MANIFEST, "review manifest")
    required = {
        "schemaVersion", "kind", "id", "completed", "target",
        "analysisHash", "evidenceHash", "reviewHash", "files",
    }
    issues = _strict_keys(manifest, required, root / REVIEW_MANIFEST)
    if manifest.get("schemaVersion") != SCHEMA_VERSION or manifest.get("kind") != REVIEW_MANIFEST_KIND or manifest.get("id") != review_id or manifest.get("completed") is not True:
        issues.append(_issue(root / REVIEW_MANIFEST, "review.manifest", "Invalid terminal Review manifest"))
    target_manifest = manifest.get("target")
    if not isinstance(target_manifest, dict):
        issues.append(_issue(root / REVIEW_MANIFEST, "review.target", "Review manifest target must be an object"))
    else:
        issues.extend(
            _strict_keys(
                target_manifest,
                {"projectId", "reportId", "reportHash", "runId", "resultHash", "sessionId"},
                f"{root / REVIEW_MANIFEST}/target",
            )
        )
        for key in ("projectId", "reportId", "runId"):
            issues.extend(_non_empty(target_manifest.get(key), f"{root / REVIEW_MANIFEST}/target/{key}"))
        for key in ("reportHash", "resultHash"):
            if not isinstance(target_manifest.get(key), str) or not SHA256.fullmatch(target_manifest[key]):
                issues.append(_issue(f"{root / REVIEW_MANIFEST}/target/{key}", "schema.sha256", "Expected lowercase SHA-256"))
    actual = _files(root)
    if manifest.get("files") != actual:
        issues.append(_issue(root, "review.tampered", "Independent Review files changed"))
    for field, filename in (
        ("analysisHash", REVIEW_ANALYSIS),
        ("evidenceHash", REVIEW_EVIDENCE),
        ("reviewHash", REVIEW_RESULT),
    ):
        if actual.get(filename) != manifest.get(field):
            issues.append(_issue(root, "review.hash", f"Review {field} mismatch"))
    if issues:
        raise AutoQuantValidationError(issues)
    analysis = validate_review_analysis(_read_json(root / REVIEW_ANALYSIS, "review analysis"), root / REVIEW_ANALYSIS)
    evidence = _read_json(root / REVIEW_EVIDENCE, "review evidence")
    review = _read_json(root / REVIEW_RESULT, "independent review")
    review_issues = _strict_keys(
        review,
        {
            "schemaVersion", "kind", "id", "authority", "tradingAuthority",
            "publishedAt", "analysisHash", "evidenceHash", "analysis", "evidence",
        },
        root / REVIEW_RESULT,
    )
    if review.get("schemaVersion") != SCHEMA_VERSION or review.get("kind") != REVIEW_KIND or review.get("id") != review_id or review.get("authority") != "independent-evidence-review" or review.get("tradingAuthority") != "none":
        review_issues.append(_issue(root / REVIEW_RESULT, "review.identity", "Invalid Independent Review identity or authority"))
    evidence_issues = _strict_keys(
        evidence,
        {"schemaVersion", "kind", "target", "reportEvidenceRefs", "resolvedRefs", "authority"},
        root / REVIEW_EVIDENCE,
    )
    if evidence.get("schemaVersion") != SCHEMA_VERSION or evidence.get("kind") != REVIEW_EVIDENCE_KIND:
        evidence_issues.append(_issue(root / REVIEW_EVIDENCE, "review.evidence-kind", "Invalid Review evidence identity"))
    if not isinstance(evidence.get("reportEvidenceRefs"), list) or not isinstance(evidence.get("resolvedRefs"), list):
        evidence_issues.append(_issue(root / REVIEW_EVIDENCE, "review.evidence-lists", "Review evidence catalogs must be arrays"))
    evidence_target = evidence.get("target")
    if not isinstance(evidence_target, dict):
        evidence_issues.append(_issue(root / REVIEW_EVIDENCE, "review.target", "Review evidence target must be an object"))
    elif isinstance(target_manifest, dict):
        try:
            agrees = (
                evidence_target["project"]["id"] == target_manifest["projectId"]
                and evidence_target["report"]["id"] == target_manifest["reportId"]
                and evidence_target["report"]["reportHash"] == target_manifest["reportHash"]
                and evidence_target["report"]["sessionId"] == target_manifest["sessionId"]
                and evidence_target["run"]["id"] == target_manifest["runId"]
                and evidence_target["run"]["resultHash"] == target_manifest["resultHash"]
            )
        except (KeyError, TypeError):
            agrees = False
        if not agrees:
            evidence_issues.append(_issue(root / REVIEW_EVIDENCE, "review.target", "Review evidence target differs from terminal manifest"))
    if review_issues or evidence_issues:
        raise AutoQuantValidationError([*review_issues, *evidence_issues])
    if review.get("analysis") != analysis or review.get("analysisHash") != hash_json(analysis):
        raise AutoQuantValidationError([_issue(root / REVIEW_RESULT, "review.analysis", "Stored Review analysis differs")])
    if review.get("evidence") != evidence or review.get("evidenceHash") != hash_json(evidence):
        raise AutoQuantValidationError([_issue(root / REVIEW_RESULT, "review.evidence", "Stored Review evidence differs")])
    try:
        published = datetime.fromisoformat(review["publishedAt"])
        if published.tzinfo is None:
            raise ValueError("timezone missing")
        stamp = published.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    except (TypeError, ValueError):
        raise AutoQuantValidationError([_issue(root / REVIEW_RESULT, "review.published-at", "Invalid timezone-aware Review publication time")]) from None
    identity = hash_json(
        {
            "target": evidence["target"],
            "analysisHash": review["analysisHash"],
            "evidenceHash": review["evidenceHash"],
            "publishedAt": review["publishedAt"],
        }
    )
    if review_id != f"review-{stamp}-{identity[:12]}":
        raise AutoQuantValidationError([_issue(root, "review.derived-id", "Independent Review id is not derived from its frozen identity")])
    if (root / REVIEW_MARKDOWN).read_text(encoding="utf-8") != _render_markdown(review):
        raise AutoQuantValidationError([_issue(root / REVIEW_MARKDOWN, "review.markdown", "Review Markdown is not canonical")])
    if project is not None:
        target = manifest["target"]
        if target.get("projectId") != project.manifest.id:
            raise AutoQuantValidationError([_issue(root, "review.project", "Review targets another Project")])
        report, anchor, run = _target_report(project, target["reportId"], target["sessionId"])
        if target.get("reportHash") != report.manifest["reportHash"] or target.get("runId") != anchor["runId"] or target.get("resultHash") != run.manifest["resultHash"]:
            raise AutoQuantValidationError([_issue(root, "review.target", "Review target identity differs from current immutable evidence")])
        if evidence["target"]["report"]["reportHash"] != target["reportHash"] or evidence["target"]["run"]["resultHash"] != target["resultHash"]:
            raise AutoQuantValidationError([_issue(root, "review.target", "Review evidence target differs from terminal manifest")])
    return ReviewContext(root, manifest, review, analysis, evidence)


def load_review(project: ProjectContext, review_id: str) -> ReviewContext:
    if not REVIEW_ID.fullmatch(review_id):
        raise AutoQuantValidationError([_issue(review_id, "review.id", "Invalid Independent Review id")])
    root = confined_path(_reviews_root(project, create=False), review_id, review_id)
    if not root.is_dir() or root.is_symlink():
        raise AutoQuantValidationError([_issue(root, "review.missing", f"Unknown Independent Review: {review_id}")])
    return load_review_package(root, project=project)


def list_reviews(
    project: ProjectContext,
    report_id: str | None = None,
) -> list[ReviewSummary]:
    root = project.root_dir / REVIEWS_DIRECTORY
    if not root.exists() and not root.is_symlink():
        return []
    root = _reviews_root(project, create=False)
    summaries: list[ReviewSummary] = []
    for entry in sorted(root.iterdir(), key=lambda item: item.name):
        if entry.name.startswith("."):
            continue
        if entry.is_symlink() or not entry.is_dir():
            raise AutoQuantValidationError([_issue(entry, "review.entry", "Review entries must be real directories")])
        review = load_review(project, entry.name)
        target = review.manifest["target"]
        if report_id is not None and target["reportId"] != report_id:
            continue
        counts = {key: 0 for key in sorted(REVIEW_CLASSIFICATIONS)}
        for claim in review.analysis["claims"]:
            counts[claim["classification"]] += 1
        summaries.append(
            ReviewSummary(
                id=review.review["id"],
                title=review.analysis["title"],
                conclusion=review.analysis["conclusion"],
                report_id=target["reportId"],
                run_id=target["runId"],
                session_id=target["sessionId"],
                claims=len(review.analysis["claims"]),
                classifications=counts,
                published_at=review.review["publishedAt"],
                path=str(review.root_dir),
                markdown_path=str(review.root_dir / REVIEW_MARKDOWN),
            )
        )
    return summaries


REVIEW_ANALYSIS_JSON_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "AutoQuant independent Research Review analysis",
    "type": "object",
    "additionalProperties": False,
    "required": [
        "schemaVersion", "kind", "title", "executiveVerdict", "conclusion",
        "claims", "remediations", "limitations", "unresolvedQuestions",
    ],
    "properties": {
        "schemaVersion": {"const": SCHEMA_VERSION},
        "kind": {"const": REVIEW_ANALYSIS_KIND},
        "title": {"type": "string", "minLength": 1},
        "executiveVerdict": {"type": "string", "minLength": 1},
        "conclusion": {"enum": sorted(REVIEW_CONCLUSIONS)},
        "claims": {
            "type": "array", "minItems": 1,
            "items": {
                "type": "object", "additionalProperties": False,
                "required": ["id", "claim", "classification", "rationale", "evidenceRefs"],
                "properties": {
                    "id": {"type": "string", "pattern": "^[a-z0-9]+(?:-[a-z0-9]+)*$"},
                    "claim": {"type": "string", "minLength": 1},
                    "classification": {"enum": sorted(REVIEW_CLASSIFICATIONS)},
                    "rationale": {"type": "string", "minLength": 1},
                    "evidenceRefs": {
                        "type": "array",
                        "items": {"$ref": "#/$defs/evidenceRef"},
                    },
                },
            },
        },
        "remediations": {
            "type": "array",
            "items": {
                "type": "object", "additionalProperties": False,
                "required": ["priority", "action", "rationale", "claimIds"],
                "properties": {
                    "priority": {"enum": sorted(REMEDIATION_PRIORITIES)},
                    "action": {"type": "string", "minLength": 1},
                    "rationale": {"type": "string", "minLength": 1},
                    "claimIds": {"type": "array", "minItems": 1, "items": {"type": "string", "minLength": 1}},
                },
            },
        },
        "limitations": {"type": "array", "items": {"type": "string", "minLength": 1}},
        "unresolvedQuestions": {"type": "array", "items": {"type": "string", "minLength": 1}},
    },
    "$defs": {
        "evidenceRef": {
            "type": "object", "additionalProperties": False,
            "required": ["kind", "id", "artifactPath"],
            "properties": {
                "kind": {"enum": sorted(REVIEW_REFERENCE_KINDS)},
                "id": {"type": "string", "minLength": 1},
                "artifactPath": {"type": ["string", "null"]},
            },
        }
    },
    "examples": [
        {
            "schemaVersion": SCHEMA_VERSION,
            "kind": REVIEW_ANALYSIS_KIND,
            "title": "Independent evidence review",
            "executiveVerdict": "The central calculation is reproducible, but one supporting statement is not bound to the Report.",
            "conclusion": "accepted-with-reservations",
            "claims": [
                {
                    "id": "central-result",
                    "claim": "The central result is reconstructed from immutable Run evidence.",
                    "classification": "verified",
                    "rationale": "The strict Run reader and declared artifact agree.",
                    "evidenceRefs": [{"kind": "run", "id": "RUN_ID", "artifactPath": "artifacts/report.json"}],
                },
                {
                    "id": "provider-adjustment",
                    "claim": "The package labels prices as split-adjusted.",
                    "classification": "declared",
                    "rationale": "The immutable snapshot records the label but does not authenticate provider corporate actions.",
                    "evidenceRefs": [{"kind": "run", "id": "RUN_ID", "artifactPath": None}],
                },
                {
                    "id": "supporting-comparison",
                    "claim": "A supporting comparison exists only in Workspace staging.",
                    "classification": "observed-unbound",
                    "rationale": "The file is visible but absent from the target Report and Run identity.",
                    "evidenceRefs": [
                        {"kind": "report", "id": "REPORT_ID", "artifactPath": "analysis.json"},
                        {"kind": "observed-file", "id": "staging/comparison.json", "artifactPath": None},
                    ],
                },
            ],
            "remediations": [
                {
                    "priority": "P0",
                    "action": "Bind or remove the supporting comparison claim.",
                    "rationale": "Published evidence references must support the complete claim.",
                    "claimIds": ["supporting-comparison"],
                }
            ],
            "limitations": ["This Review does not authenticate market-data providers."],
            "unresolvedQuestions": [],
        }
    ],
}
