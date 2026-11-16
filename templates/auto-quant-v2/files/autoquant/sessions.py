"""Governed research Sessions, Experiments, and source promotion."""

from __future__ import annotations

import difflib
import json
import math
import os
import re
import shutil
import tempfile
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any

from .briefs import (
    RESEARCH_BRIEF,
    RESEARCH_REQUEST,
    build_research_brief,
    validate_research_request,
    validate_session_brief,
)
from .runs import (
    RunContext,
    execute_study,
    harness_identity,
    list_runs,
    load_run,
    same_harness_runtime,
)
from .selection import build_research_family, build_selection_adjustment
from .studies import (
    StudyContext,
    copy_hashed_files,
    hash_file,
    hash_json,
    load_study,
    path_matches_pattern,
)
from .workspace import (
    FRAMEWORK_NEEDS,
    PROJECT_MANIFEST,
    SCHEMA_VERSION,
    AutoQuantValidationError,
    ProjectContext,
    ValidationIssue,
    confined_path,
    load_project,
)


SESSION_MANIFEST = "session.json"
SESSION_WORKTREE_MARKER = ".autoquant-session-worktree.json"
EXPERIMENT_RESULT = "result.json"
EXPERIMENT_CHANGES = "changes.json"
EXPERIMENT_DIFF = "diff.patch"
EXPERIMENT_MANIFEST = "manifest.json"
PROMOTION_RECEIPT = "promotion.json"
COMPLETION_RECEIPT = "completion.json"
SESSION_ID = re.compile(
    r"^session-[0-9]{8}T[0-9]{12}Z-[0-9a-f]{12}$"
)
COMPLETION_ID = re.compile(
    r"^completion-[0-9]{8}T[0-9]{12}Z-[0-9a-f]{12}$"
)
EXPERIMENT_ID = re.compile(r"^exp-[0-9]{4}-[0-9a-f]{12}$")
SESSION_STATUSES = {"active", "completed", "promoted"}
VERDICTS = {"KEEP", "REVERT", "CRASH"}
SHA256 = re.compile(r"^[0-9a-f]{64}$")
REFERENCE_INTEGRITY_KEYS = {
    "selection_split",
    "test_role",
    "test_enters_selection",
    "external_holdout_rule",
}
LEGACY_EXTERNAL_HOLDOUT_RULE = "required-after-test-guided-iteration"
VISIBLE_TEST_EXTERNAL_HOLDOUT_RULE = (
    "required-after-visible-test-and-candidate-iteration"
)


@dataclass(frozen=True)
class SessionContext:
    root_dir: Path
    manifest_path: Path
    manifest: dict[str, Any]
    worktree_project: ProjectContext
    baseline_run: RunContext
    leader_run: RunContext
    delegation: dict[str, Any] | None


@dataclass(frozen=True)
class SessionSummary:
    id: str
    status: str
    study_id: str
    baseline_run_id: str
    leader_run_id: str
    leader_value: float
    experiments: int
    updated_at: str
    path: str
    delegated: bool
    request_title: str | None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "status": self.status,
            "studyId": self.study_id,
            "baselineRunId": self.baseline_run_id,
            "leaderRunId": self.leader_run_id,
            "leaderValue": self.leader_value,
            "experiments": self.experiments,
            "updatedAt": self.updated_at,
            "path": self.path,
            "delegated": self.delegated,
            "requestTitle": self.request_title,
        }


@dataclass(frozen=True)
class ExperimentContext:
    root_dir: Path
    manifest: dict[str, Any]
    result: dict[str, Any]
    changes: list[dict[str, Any]]


@dataclass(frozen=True)
class ExperimentSummary:
    id: str
    sequence: int
    verdict: str
    hypothesis: str
    leader_value: float
    candidate_value: float | None
    improvement: float | None
    run_id: str
    completed_at: str
    path: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "sequence": self.sequence,
            "verdict": self.verdict,
            "hypothesis": self.hypothesis,
            "leaderValue": self.leader_value,
            "candidateValue": self.candidate_value,
            "improvement": self.improvement,
            "runId": self.run_id,
            "completedAt": self.completed_at,
            "path": self.path,
        }


def _issue(path: Path | str, code: str, message: str) -> ValidationIssue:
    return ValidationIssue(str(path), code, message)


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _atomic_write_json(path: Path, value: Any) -> None:
    temporary = path.parent / f".{path.name}.{uuid.uuid4().hex}.tmp"
    _write_json(temporary, value)
    os.replace(temporary, path)


def _read_json(path: Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise AutoQuantValidationError(
            [_issue(path, f"{label}.missing", f"Missing {label} JSON: {path}")]
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
            [_issue(path, f"{label}.type", f"{label} JSON must be an object")]
        )
    return value


def _strict_keys(
    value: dict[str, Any],
    required: set[str],
    path: Path | str,
) -> list[ValidationIssue]:
    issues = [
        _issue(f"{path}/{key}", "schema.missing", f"Missing required field '{key}'")
        for key in sorted(required - value.keys())
    ]
    issues.extend(
        _issue(f"{path}/{key}", "schema.unknown", f"Unknown field '{key}'")
        for key in sorted(value.keys() - required)
    )
    return issues


def _sessions_root(project: ProjectContext) -> Path:
    return confined_path(
        project.root_dir,
        project.manifest.directories["sessions"],
        "project/directories/sessions",
    )


def _session_root(project: ProjectContext, session_id: str) -> Path:
    if not SESSION_ID.fullmatch(session_id):
        raise AutoQuantValidationError(
            [_issue(session_id, "session.id", "Invalid Session id")]
        )
    return confined_path(_sessions_root(project), session_id, f"session/{session_id}")


def _experiment_root(session: SessionContext, experiment_id: str) -> Path:
    if not EXPERIMENT_ID.fullmatch(experiment_id):
        raise AutoQuantValidationError(
            [_issue(experiment_id, "experiment.id", "Invalid Experiment id")]
        )
    experiments = confined_path(
        session.root_dir,
        "experiments",
        f"{session.manifest_path}/experiments",
    )
    return confined_path(experiments, experiment_id, f"experiment/{experiment_id}")


def _metric_value(run: RunContext) -> float:
    metric = run.result["objective"]["metric"]
    value = run.result["metrics"].get(metric)
    if (
        not isinstance(value, (int, float))
        or isinstance(value, bool)
        or run.result["status"] != "succeeded"
    ):
        raise AutoQuantValidationError(
            [
                _issue(
                    run.root_dir / "result.json",
                    "session.baseline",
                    f"Run must be successful with finite primary metric '{metric}'",
                )
            ]
        )
    return float(value)


def _run_source_hashes(run: RunContext) -> dict[str, str]:
    paths = run.result["subject"].get("sourcePaths")
    if not isinstance(paths, list) or not all(isinstance(path, str) for path in paths):
        raise AutoQuantValidationError(
            [_issue(run.root_dir, "run.source-paths", "Run sourcePaths are invalid")]
        )
    hashes: dict[str, str] = {}
    for relative in paths:
        candidate = PurePosixPath(relative)
        if candidate.is_absolute() or ".." in candidate.parts or "\\" in relative:
            raise AutoQuantValidationError(
                [_issue(relative, "run.source-path", "Run source path is not confined")]
            )
        path = run.root_dir / "sources" / relative
        if path.is_symlink() or not path.is_file():
            raise AutoQuantValidationError(
                [_issue(path, "run.source-missing", "Run source file is missing")]
            )
        hashes[relative] = hash_file(path)
    hashes = dict(sorted(hashes.items()))
    if hash_json(hashes) != run.result["subject"].get("sourceHash"):
        raise AutoQuantValidationError(
            [_issue(run.root_dir, "run.source-hash", "Run sourceHash is inconsistent")]
        )
    return hashes


def _fixed_inventory(
    worktree: ProjectContext,
    editable_patterns: list[str],
) -> dict[str, str]:
    hashes: dict[str, str] = {}
    for path in sorted(worktree.root_dir.rglob("*")):
        relative = path.relative_to(worktree.root_dir).as_posix()
        if path.is_symlink():
            raise AutoQuantValidationError(
                [_issue(path, "path.symlink", "Session worktree cannot contain symlinks")]
            )
        if not path.is_file():
            continue
        if (
            relative != SESSION_WORKTREE_MARKER
            and any(
                path_matches_pattern(relative, pattern)
                for pattern in editable_patterns
            )
        ):
            continue
        hashes[relative] = hash_file(path)
    return hashes


def _copy_project_file(project: ProjectContext, relative: str, target: Path) -> None:
    source = confined_path(project.root_dir, relative, f"project/{relative}")
    if source.is_symlink() or not source.is_file():
        raise AutoQuantValidationError(
            [_issue(source, "session.source", f"Missing fixed Project file: {relative}")]
        )
    destination = target / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)


def _materialize_worktree(
    project: ProjectContext,
    study: StudyContext,
    session_staging: Path,
    session_id: str,
) -> ProjectContext:
    if not SESSION_ID.fullmatch(session_id):
        raise AutoQuantValidationError(
            [_issue(session_id, "session.id", "Invalid Session id")]
        )
    worktree_root = session_staging / "worktree" / project.manifest.id
    worktree_root.mkdir(parents=True)
    shutil.copy2(project.root_dir / PROJECT_MANIFEST, worktree_root / PROJECT_MANIFEST)
    _write_json(
        worktree_root / SESSION_WORKTREE_MARKER,
        {
            "schemaVersion": SCHEMA_VERSION,
            "kind": "autoquant-session-worktree",
            "projectId": project.manifest.id,
            "sessionId": session_id,
        },
    )
    _copy_project_file(
        project,
        project.manifest.research_program,
        worktree_root,
    )
    _copy_project_file(project, FRAMEWORK_NEEDS, worktree_root)
    for relative in project.manifest.directories.values():
        (worktree_root / relative).mkdir(parents=True)

    study_relative = (
        Path(project.manifest.directories["studies"])
        / study.definition.id
        / "study.json"
    ).as_posix()
    program_relative = (
        Path(project.manifest.directories["studies"])
        / study.definition.id
        / study.definition.program
    ).as_posix()
    _copy_project_file(project, study_relative, worktree_root)
    _copy_project_file(project, program_relative, worktree_root)
    # Preflight is operational feedback authority, not part of the scientific
    # Study identity. Preserve it in the Session worktree when the Study opts in.
    from .checks import PREFLIGHT_MANIFEST, load_candidate_preflight

    preflight = load_candidate_preflight(project, study, optional=True)
    if preflight is not None:
        preflight_relative = (
            Path(project.manifest.directories["studies"])
            / study.definition.id
            / PREFLIGHT_MANIFEST
        ).as_posix()
        _copy_project_file(project, preflight_relative, worktree_root)
        copy_hashed_files(project, preflight.source_hashes, worktree_root)
    copy_hashed_files(project, study.judge_hashes, worktree_root)
    copy_hashed_files(project, study.editable_hashes, worktree_root)
    if study.dependency_hashes:
        copy_hashed_files(project, study.dependency_hashes, worktree_root)
    return load_project(worktree_root, expected_id=project.manifest.id)


def _session_lock(study: StudyContext, baseline: RunContext) -> dict[str, Any]:
    lock = {
        "studyHash": study.study_hash,
        "programHash": study.program_hash,
        "judgeHash": study.judge_hash,
        "datasetHash": study.dataset_hash,
        "harness": baseline.result["harness"],
    }
    if study.dependency_hash is not None:
        lock["dependencyHash"] = study.dependency_hash
    if study.upstream_evidence_hash is not None:
        lock["upstreamEvidenceHash"] = study.upstream_evidence_hash
    return lock


def _run_pointer(run: RunContext) -> dict[str, Any]:
    return {
        "runId": run.result["id"],
        "sourceHash": run.result["subject"]["sourceHash"],
        "metric": run.result["objective"]["metric"],
        "value": _metric_value(run),
    }


def _canonical_data_root(project: ProjectContext) -> Path:
    return confined_path(
        project.root_dir,
        project.manifest.directories["data"],
        "project/directories/data",
    )


def _reusable_baseline(
    project: ProjectContext,
    study: StudyContext,
) -> RunContext | None:
    """Return the newest successful Run with exactly the current fixed inputs."""

    current_harness = harness_identity()
    expected_dependency_hash = study.dependency_hash
    expected_upstream_hash = study.upstream_evidence_hash
    for summary in reversed(list_runs(project, study.definition.id)):
        if summary.status != "succeeded":
            continue
        run = load_run(project, summary.id)
        result = run.result
        dependencies = result.get("dependencies")
        dependency_hash = (
            dependencies.get("hash")
            if isinstance(dependencies, dict)
            else None
        )
        upstream = result.get("upstreamEvidence")
        upstream_hash = (
            upstream.get("hash") if isinstance(upstream, dict) else None
        )
        if (
            result["study"].get("hash") == study.study_hash
            and result["study"].get("programHash") == study.program_hash
            and result["subject"].get("sourceHash") == study.source_hash
            and result["judge"].get("hash") == study.judge_hash
            and result["dataset"].get("hash") == study.dataset_hash
            and dependency_hash == expected_dependency_hash
            and upstream_hash == expected_upstream_hash
            and same_harness_runtime(result.get("harness", {}), current_harness)
        ):
            return run
    return None


def start_session(
    project: ProjectContext,
    study_id: str,
    *,
    request: dict[str, Any] | None = None,
) -> SessionContext:
    from .holdouts import assert_iterative_research_allowed

    assert_iterative_research_allowed(project)
    normalized_request = (
        validate_research_request(request, "request")
        if request is not None
        else None
    )
    study = load_study(project, study_id)
    if not study.definition.editable["paths"]:
        raise AutoQuantValidationError(
            [
                _issue(
                    study.manifest_path,
                    "session.fixed-study",
                    "This fixed descriptive Study has no editable research "
                    "surface and does not support iterative Sessions",
                )
            ]
        )
    if (
        study.definition.objective.metric
        == "current_component_risk_hhi"
    ):
        raise AutoQuantValidationError(
            [
                _issue(
                    study.manifest_path,
                    "session.descriptive-study",
                    "Reported Book Risk is a fixed descriptive audit and "
                    "does not support iterative research Sessions",
                )
            ]
        )
    if normalized_request is not None:
        requested_symbols = {
            item["symbol"] for item in normalized_request["assets"]
        }
        study_symbols = set(study.definition.dataset.universe)
        missing_symbols = sorted(requested_symbols - study_symbols)
        mismatched_classes = sorted(
            {
                item["assetClass"]
                for item in normalized_request["assets"]
                if (
                    study.definition.dataset.asset_class != "mixed"
                    and item["assetClass"]
                    != study.definition.dataset.asset_class
                )
            }
        )
        request_issues: list[ValidationIssue] = []
        if missing_symbols:
            request_issues.append(
                _issue(
                    "request/assets",
                    "request.study-universe",
                    "Requested assets are outside the selected Study universe: "
                    + ", ".join(missing_symbols),
                )
            )
        if mismatched_classes:
            request_issues.append(
                _issue(
                    "request/assets",
                    "request.study-asset-class",
                    "Requested asset classes differ from the selected Study "
                    f"asset class '{study.definition.dataset.asset_class}': "
                    + ", ".join(mismatched_classes),
                )
            )
        if request_issues:
            raise AutoQuantValidationError(request_issues)
    baseline = _reusable_baseline(project, study)
    baseline_preflight: dict[str, Any] | None = None
    if baseline is None:
        from .checks import evaluate_project_candidate_preflight

        baseline_preflight = evaluate_project_candidate_preflight(
            project,
            study,
        )
        if (
            baseline_preflight is not None
            and baseline_preflight["status"] != "passed"
        ):
            issues = [
                _issue(
                    study.root_dir,
                    "session.baseline-preflight-failed",
                    "First candidate failed the fixed preflight before any "
                    "baseline Run or Session was created: "
                    f"{baseline_preflight['summary']}",
                )
            ]
            issues.extend(
                _issue(
                    study.root_dir,
                    f"session.{error['code']}",
                    error["message"],
                )
                for error in baseline_preflight["errors"]
            )
            raise AutoQuantValidationError(issues)
        baseline = execute_study(project, study_id)
        baseline_guard_mode = (
            "fresh-preflight-and-run"
            if baseline_preflight is not None
            else "fresh-run-no-preflight"
        )
    else:
        baseline_guard_mode = "reused-successful-run"
    if baseline.result["status"] != "succeeded":
        raise AutoQuantValidationError(
            [
                _issue(
                    baseline.root_dir,
                    "session.baseline-failed",
                    "Cannot start a research Session from a failed baseline Run "
                    f"({baseline.result['id']})",
                )
            ]
        )
    started = datetime.now(timezone.utc)
    stamp = started.strftime("%Y%m%dT%H%M%S%fZ")
    identity = hash_json(
        {
            "project": project.manifest.id,
            "study": study.definition.id,
            "baseline": baseline.result["id"],
            "startedAt": started.isoformat(),
            "requestHash": (
                hash_json(normalized_request)
                if normalized_request is not None
                else None
            ),
        }
    )
    session_id = f"session-{stamp}-{identity[:12]}"
    target = _session_root(project, session_id)
    temporary = _sessions_root(project) / f".{session_id}.creating"
    if target.exists() or target.is_symlink() or temporary.exists():
        raise AutoQuantValidationError(
            [_issue(target, "session.collision", "Session path already exists")]
        )
    try:
        temporary.mkdir()
        worktree = _materialize_worktree(
            project,
            study,
            temporary,
            session_id,
        )
        worktree_study = load_study(
            worktree,
            study_id,
            data_root=_canonical_data_root(project),
            upstream_project=project,
        )
        fixed_hashes = _fixed_inventory(
            worktree,
            worktree_study.definition.editable["paths"],
        )
        manifest = {
            "schemaVersion": SCHEMA_VERSION,
            "id": session_id,
            "status": "active",
            "projectId": project.manifest.id,
            "studyId": study.definition.id,
            "createdAt": started.isoformat(),
            "updatedAt": started.isoformat(),
            "worktree": f"worktree/{project.manifest.id}",
            "editablePaths": study.definition.editable["paths"],
            "baseProjectSourceHash": study.source_hash,
            "baseline": _run_pointer(baseline),
            "leader": _run_pointer(baseline),
            "baselineGuard": {
                "mode": baseline_guard_mode,
                "baselineRunId": baseline.result["id"],
                "preflight": baseline_preflight,
            },
            "locks": {
                **_session_lock(study, baseline),
                "fixedHashes": fixed_hashes,
            },
            "nextExperiment": 1,
        }
        if normalized_request is not None:
            brief = build_research_brief(
                normalized_request,
                project,
                manifest,
                baseline.result,
                created_at=started.isoformat(),
            )
            manifest["brief"] = {
                "id": brief["id"],
                "requestHash": hash_json(normalized_request),
                "briefHash": hash_json(brief),
            }
            _write_json(temporary / RESEARCH_REQUEST, normalized_request)
            _write_json(temporary / RESEARCH_BRIEF, brief)
        (temporary / "experiments").mkdir()
        (temporary / "checks").mkdir()
        (temporary / "campaigns").mkdir()
        (temporary / "reports").mkdir()
        _write_json(temporary / SESSION_MANIFEST, manifest)
        os.replace(temporary, target)
    except Exception:
        if temporary.exists():
            shutil.rmtree(temporary)
        raise
    return load_session(project, session_id)


def _validate_session_manifest(
    value: dict[str, Any],
    path: Path,
    expected_id: str,
) -> None:
    required = {
        "schemaVersion",
        "id",
        "status",
        "projectId",
        "studyId",
        "createdAt",
        "updatedAt",
        "worktree",
        "editablePaths",
        "baseProjectSourceHash",
        "baseline",
        "leader",
        "locks",
        "nextExperiment",
    }
    allowed = required
    if "brief" in value:
        allowed.add("brief")
    if "baselineGuard" in value:
        allowed.add("baselineGuard")
    issues = _strict_keys(value, allowed, path)
    if value.get("schemaVersion") != SCHEMA_VERSION:
        issues.append(_issue(f"{path}/schemaVersion", "schema.version", "Expected V1"))
    if value.get("id") != expected_id:
        issues.append(_issue(f"{path}/id", "session.directory-id", "Session id mismatch"))
    if value.get("status") not in SESSION_STATUSES:
        issues.append(_issue(f"{path}/status", "schema.choice", "Invalid Session status"))
    if not isinstance(value.get("projectId"), str) or not value["projectId"]:
        issues.append(_issue(f"{path}/projectId", "schema.string", "Invalid projectId"))
    if not isinstance(value.get("studyId"), str) or not value["studyId"]:
        issues.append(_issue(f"{path}/studyId", "schema.string", "Invalid studyId"))
    for key in ("createdAt", "updatedAt", "worktree"):
        if not isinstance(value.get(key), str) or not value[key]:
            issues.append(_issue(f"{path}/{key}", "schema.string", f"Invalid {key}"))
    editable_paths = value.get("editablePaths")
    if (
        not isinstance(editable_paths, list)
        or not editable_paths
        or not all(isinstance(item, str) and item for item in editable_paths)
    ):
        issues.append(
            _issue(f"{path}/editablePaths", "schema.array", "Invalid editablePaths")
        )
    if (
        not isinstance(value.get("nextExperiment"), int)
        or isinstance(value.get("nextExperiment"), bool)
        or value.get("nextExperiment", 0) < 1
    ):
        issues.append(
            _issue(
                f"{path}/nextExperiment",
                "schema.number",
                "nextExperiment must be a positive integer",
            )
        )
    for key in ("baseline", "leader"):
        pointer = value.get(key)
        if not isinstance(pointer, dict):
            issues.append(_issue(f"{path}/{key}", "schema.type", f"{key} must be an object"))
            continue
        issues.extend(
            _strict_keys(
                pointer,
                {"runId", "sourceHash", "metric", "value"},
                f"{path}/{key}",
            )
        )
        if isinstance(pointer, dict):
            if not isinstance(pointer.get("runId"), str) or not pointer["runId"].startswith("run-"):
                issues.append(_issue(f"{path}/{key}/runId", "schema.string", "Invalid Run id"))
            if not isinstance(pointer.get("sourceHash"), str) or not SHA256.fullmatch(
                pointer.get("sourceHash", "")
            ):
                issues.append(_issue(f"{path}/{key}/sourceHash", "schema.hash", "Invalid sourceHash"))
            if not isinstance(pointer.get("metric"), str) or not pointer["metric"]:
                issues.append(_issue(f"{path}/{key}/metric", "schema.string", "Invalid metric"))
            pointer_value = pointer.get("value")
            if (
                not isinstance(pointer_value, (int, float))
                or isinstance(pointer_value, bool)
                or not math.isfinite(float(pointer_value))
            ):
                issues.append(_issue(f"{path}/{key}/value", "schema.number", "Invalid metric value"))
    baseline_guard = value.get("baselineGuard")
    if baseline_guard is not None:
        guard_path = f"{path}/baselineGuard"
        if not isinstance(baseline_guard, dict):
            issues.append(
                _issue(guard_path, "schema.type", "baselineGuard must be an object")
            )
        else:
            issues.extend(
                _strict_keys(
                    baseline_guard,
                    {"mode", "baselineRunId", "preflight"},
                    guard_path,
                )
            )
            mode = baseline_guard.get("mode")
            if mode not in {
                "fresh-preflight-and-run",
                "fresh-run-no-preflight",
                "reused-successful-run",
            }:
                issues.append(
                    _issue(f"{guard_path}/mode", "schema.choice", "Invalid baseline guard mode")
                )
            if not isinstance(baseline_guard.get("baselineRunId"), str):
                issues.append(
                    _issue(
                        f"{guard_path}/baselineRunId",
                        "schema.string",
                        "Invalid baseline Run id",
                    )
                )
            preflight = baseline_guard.get("preflight")
            if mode == "fresh-preflight-and-run":
                if not isinstance(preflight, dict):
                    issues.append(
                        _issue(
                            f"{guard_path}/preflight",
                            "schema.type",
                            "Fresh guarded baseline requires a preflight receipt",
                        )
                    )
            elif preflight is not None:
                issues.append(
                    _issue(
                        f"{guard_path}/preflight",
                        "schema.choice",
                        "Only a fresh guarded baseline may retain a preflight receipt",
                    )
                )
    if not isinstance(value.get("baseProjectSourceHash"), str) or not SHA256.fullmatch(
        value.get("baseProjectSourceHash", "")
    ):
        issues.append(
            _issue(
                f"{path}/baseProjectSourceHash",
                "schema.hash",
                "Invalid baseProjectSourceHash",
            )
        )
    locks = value.get("locks")
    if not isinstance(locks, dict):
        issues.append(_issue(f"{path}/locks", "schema.type", "locks must be an object"))
    else:
        lock_keys = {
            "studyHash",
            "programHash",
            "judgeHash",
            "datasetHash",
            "harness",
            "fixedHashes",
        }
        if "dependencyHash" in locks:
            lock_keys.add("dependencyHash")
        if "upstreamEvidenceHash" in locks:
            lock_keys.add("upstreamEvidenceHash")
        issues.extend(
            _strict_keys(
                locks,
                lock_keys,
                f"{path}/locks",
            )
        )
        fixed = locks.get("fixedHashes")
        if not isinstance(fixed, dict) or not all(
            isinstance(key, str) and isinstance(item, str)
            for key, item in (fixed.items() if isinstance(fixed, dict) else [])
        ):
            issues.append(
                _issue(f"{path}/locks/fixedHashes", "schema.map", "Invalid fixedHashes")
            )
        elif any(not SHA256.fullmatch(item) for item in fixed.values()):
            issues.append(
                _issue(f"{path}/locks/fixedHashes", "schema.hash", "Invalid fixed file hash")
            )
        for key in ("studyHash", "programHash", "judgeHash", "datasetHash"):
            if not isinstance(locks.get(key), str) or not SHA256.fullmatch(locks.get(key, "")):
                issues.append(_issue(f"{path}/locks/{key}", "schema.hash", f"Invalid {key}"))
        if "dependencyHash" in locks and (
            not isinstance(locks.get("dependencyHash"), str)
            or not SHA256.fullmatch(locks.get("dependencyHash", ""))
        ):
            issues.append(
                _issue(
                    f"{path}/locks/dependencyHash",
                    "schema.hash",
                    "Invalid dependencyHash",
                )
            )
        if "upstreamEvidenceHash" in locks and (
            not isinstance(locks.get("upstreamEvidenceHash"), str)
            or not SHA256.fullmatch(locks.get("upstreamEvidenceHash", ""))
        ):
            issues.append(
                _issue(
                    f"{path}/locks/upstreamEvidenceHash",
                    "schema.hash",
                    "Invalid upstreamEvidenceHash",
                )
            )
        harness = locks.get("harness")
        if not isinstance(harness, dict):
            issues.append(_issue(f"{path}/locks/harness", "schema.type", "Invalid Harness lock"))
        else:
            harness_keys = {
                "id",
                "version",
                "commit",
                "dirty",
                "sourceHash",
                "python",
            }
            if "buildProvenance" in harness:
                harness_keys.add("buildProvenance")
            issues.extend(
                _strict_keys(
                    harness,
                    harness_keys,
                    f"{path}/locks/harness",
                )
            )
            if not isinstance(harness.get("dirty"), bool):
                issues.append(_issue(f"{path}/locks/harness/dirty", "schema.boolean", "Invalid dirty flag"))
            if not isinstance(harness.get("sourceHash"), str) or not SHA256.fullmatch(
                harness.get("sourceHash", "")
            ):
                issues.append(_issue(f"{path}/locks/harness/sourceHash", "schema.hash", "Invalid Harness hash"))
            if (
                "buildProvenance" in harness
                and harness["buildProvenance"]
                not in {
                    "embedded-distribution",
                    "source-checkout",
                    "unavailable",
                }
            ):
                issues.append(
                    _issue(
                        f"{path}/locks/harness/buildProvenance",
                        "session.harness-provenance",
                        "Invalid Harness build provenance",
                    )
                )
    if issues:
        raise AutoQuantValidationError(issues)


def _validate_baseline_guard(
    project: ProjectContext,
    manifest: dict[str, Any],
    baseline: RunContext,
) -> None:
    """Verify optional post-0.9.26 first-baseline guard provenance."""

    guard = manifest.get("baselineGuard")
    if guard is None:
        return
    path = f"{manifest['id']}/baselineGuard"
    issues: list[ValidationIssue] = []
    if guard["baselineRunId"] != manifest["baseline"]["runId"]:
        issues.append(
            _issue(path, "session.baseline-guard-run", "Guard baseline Run differs from Session")
        )
    receipt = guard["preflight"]
    if guard["mode"] != "fresh-preflight-and-run":
        if issues:
            raise AutoQuantValidationError(issues)
        return
    assert isinstance(receipt, dict)
    required = {
        "status",
        "summary",
        "startedAt",
        "completedAt",
        "durationMs",
        "study",
        "candidate",
        "preflight",
        "harness",
        "inputHash",
        "outputHash",
        "authority",
        "checks",
        "errors",
        "execution",
        "receiptHash",
    }
    issues.extend(_strict_keys(receipt, required, f"{path}/preflight"))
    if receipt.get("status") != "passed":
        issues.append(
            _issue(
                f"{path}/preflight/status",
                "session.baseline-preflight-status",
                "Retained baseline preflight must have passed",
            )
        )
    for key in ("summary", "startedAt", "completedAt"):
        if not isinstance(receipt.get(key), str) or not receipt[key]:
            issues.append(
                _issue(f"{path}/preflight/{key}", "schema.string", f"Invalid {key}")
            )
    if (
        not isinstance(receipt.get("durationMs"), int)
        or isinstance(receipt.get("durationMs"), bool)
        or receipt.get("durationMs", -1) < 0
    ):
        issues.append(
            _issue(
                f"{path}/preflight/durationMs",
                "schema.number",
                "Invalid preflight duration",
            )
        )
    for key in ("inputHash", "outputHash", "receiptHash"):
        if not isinstance(receipt.get(key), str) or not SHA256.fullmatch(
            receipt.get(key, "")
        ):
            issues.append(
                _issue(f"{path}/preflight/{key}", "schema.hash", f"Invalid {key}")
            )
    study = receipt.get("study")
    candidate = receipt.get("candidate")
    preflight = receipt.get("preflight")
    if not isinstance(study, dict) or set(study) != {"inputHash", "datasetHash"}:
        issues.append(_issue(f"{path}/preflight/study", "schema.type", "Invalid Study lock"))
        study = {}
    if not isinstance(candidate, dict) or set(candidate) != {"sourceHash"}:
        issues.append(
            _issue(f"{path}/preflight/candidate", "schema.type", "Invalid candidate lock")
        )
        candidate = {}
    if not isinstance(preflight, dict) or set(preflight) != {"hash", "sourceHashes"}:
        issues.append(
            _issue(f"{path}/preflight/preflight", "schema.type", "Invalid preflight lock")
        )
        preflight = {}
    checks = receipt.get("checks")
    errors = receipt.get("errors")
    if not isinstance(checks, list) or not checks:
        issues.append(_issue(f"{path}/preflight/checks", "schema.array", "Invalid checks"))
        checks = []
    if errors != []:
        issues.append(
            _issue(
                f"{path}/preflight/errors",
                "session.baseline-preflight-errors",
                "Passed baseline preflight cannot retain errors",
            )
        )
        errors = errors if isinstance(errors, list) else []
    authority = receipt.get("authority")
    if authority != {
        "selectionAuthority": "none",
        "promotionAuthority": "none",
        "tradingAuthority": "none",
    }:
        issues.append(
            _issue(
                f"{path}/preflight/authority",
                "session.baseline-preflight-authority",
                "Baseline preflight must retain no selection or trading authority",
            )
        )
    expected_study = {
        "inputHash": baseline.result["studyInputHash"],
        "datasetHash": baseline.result["dataset"]["hash"],
    }
    expected_candidate = {
        "sourceHash": baseline.result["subject"]["sourceHash"]
    }
    if study != expected_study or candidate != expected_candidate:
        issues.append(
            _issue(
                f"{path}/preflight",
                "session.baseline-preflight-input",
                "Baseline preflight differs from the immutable baseline inputs",
            )
        )
    if receipt.get("harness") != baseline.result["harness"]:
        issues.append(
            _issue(
                f"{path}/preflight/harness",
                "session.baseline-preflight-harness",
                "Baseline preflight Harness differs from the baseline Run",
            )
        )
    from .checks import load_candidate_preflight

    owning_study = load_study(project, manifest["studyId"])
    current_preflight = load_candidate_preflight(project, owning_study)
    assert current_preflight is not None
    expected_preflight = {
        "hash": current_preflight.preflight_hash,
        "sourceHashes": current_preflight.source_hashes,
    }
    if preflight != expected_preflight:
        issues.append(
            _issue(
                f"{path}/preflight/preflight",
                "session.baseline-preflight-stale",
                "Baseline preflight differs from fixed Project authority",
            )
        )
    expected_input_hash = hash_json(
        {
            "studyInputHash": study.get("inputHash"),
            "datasetHash": study.get("datasetHash"),
            "candidateSourceHash": candidate.get("sourceHash"),
            "preflightHash": preflight.get("hash"),
            "harness": receipt.get("harness"),
        }
    )
    if receipt.get("inputHash") != expected_input_hash:
        issues.append(
            _issue(f"{path}/preflight/inputHash", "session.baseline-preflight-hash", "Invalid input hash")
        )
    expected_output_hash = hash_json(
        {
            "status": receipt.get("status"),
            "summary": receipt.get("summary"),
            "checks": checks,
            "errors": errors,
        }
    )
    if receipt.get("outputHash") != expected_output_hash:
        issues.append(
            _issue(f"{path}/preflight/outputHash", "session.baseline-preflight-hash", "Invalid output hash")
        )
    receipt_body = {key: value for key, value in receipt.items() if key != "receiptHash"}
    if receipt.get("receiptHash") != hash_json(receipt_body):
        issues.append(
            _issue(f"{path}/preflight/receiptHash", "session.baseline-preflight-hash", "Invalid receipt hash")
        )
    if issues:
        raise AutoQuantValidationError(issues)


def _validate_completion_receipt(
    project: ProjectContext,
    root: Path,
    manifest: dict[str, Any],
) -> dict[str, Any]:
    path = root / COMPLETION_RECEIPT
    receipt = _read_json(path, "completion")
    required = {
        "schemaVersion",
        "kind",
        "id",
        "sessionId",
        "projectId",
        "studyId",
        "disposition",
        "leader",
        "brief",
        "report",
        "completedAt",
        "authority",
        "tradingAuthority",
    }
    issues = _strict_keys(receipt, required, path)
    report = receipt.get("report")
    report_required = {
        "id",
        "manifestHash",
        "reportHash",
        "evidenceHash",
        "publishedAt",
    }
    if not isinstance(report, dict):
        issues.append(
            _issue(f"{path}/report", "completion.report", "Invalid Report receipt")
        )
        report = {}
    else:
        issues.extend(_strict_keys(report, report_required, f"{path}/report"))
    if (
        receipt.get("schemaVersion") != SCHEMA_VERSION
        or receipt.get("kind") != "autoquant-session-completion"
        or receipt.get("sessionId") != manifest["id"]
        or receipt.get("projectId") != project.manifest.id
        or receipt.get("studyId") != manifest["studyId"]
        or receipt.get("disposition") != "baseline-reported"
        or receipt.get("leader") != manifest["leader"]
        or receipt.get("brief") != manifest.get("brief")
        or receipt.get("completedAt") != manifest["updatedAt"]
        or receipt.get("authority") != "quantitative-decision-support"
        or receipt.get("tradingAuthority") != "none"
    ):
        issues.append(
            _issue(
                path,
                "completion.receipt",
                "Completion receipt differs from the terminal Session",
            )
        )
    completed_at = receipt.get("completedAt")
    if not isinstance(completed_at, str):
        issues.append(
            _issue(
                f"{path}/completedAt",
                "schema.datetime",
                "Invalid completion timestamp",
            )
        )
    else:
        try:
            completed = datetime.fromisoformat(completed_at)
            stamp = completed.strftime("%Y%m%dT%H%M%S%fZ")
            identity = hash_json(
                {
                    "sessionId": manifest["id"],
                    "projectId": project.manifest.id,
                    "studyId": manifest["studyId"],
                    "disposition": "baseline-reported",
                    "leader": manifest["leader"],
                    "brief": manifest.get("brief"),
                    "report": report,
                    "completedAt": completed_at,
                }
            )
            if receipt.get("id") != f"completion-{stamp}-{identity[:12]}":
                issues.append(
                    _issue(
                        f"{path}/id",
                        "completion.derived-id",
                        "Completion id is not content-derived",
                    )
                )
        except ValueError:
            issues.append(
                _issue(
                    f"{path}/completedAt",
                    "schema.datetime",
                    "Invalid completion timestamp",
                )
            )
    report_id = report.get("id")
    if not isinstance(report_id, str) or not report_id.startswith("report-"):
        issues.append(
            _issue(
                f"{path}/report/id",
                "completion.report-id",
                "Invalid completion Report id",
            )
        )
    else:
        report_root = confined_path(
            root,
            f"reports/{report_id}",
            "completion/report",
        )
        if report_root.is_symlink() or not report_root.is_dir():
            issues.append(
                _issue(
                    report_root,
                    "completion.report-missing",
                    "Completion Report is missing",
                )
            )
        else:
            report_manifest_path = report_root / "manifest.json"
            try:
                report_manifest = _read_json(
                    report_manifest_path,
                    "report manifest",
                )
                if (
                    hash_file(report_manifest_path) != report.get("manifestHash")
                    or report_manifest.get("id") != report_id
                    or report_manifest.get("sessionId") != manifest["id"]
                    or report_manifest.get("completed") is not True
                    or report_manifest.get("reportHash") != report.get("reportHash")
                ):
                    issues.append(
                        _issue(
                            report_manifest_path,
                            "completion.report-manifest",
                            "Completion Report manifest differs from the receipt",
                        )
                    )
                actual_files: dict[str, str] = {}
                for entry in sorted(
                    report_root.iterdir(),
                    key=lambda item: item.name,
                ):
                    if entry.name == "manifest.json":
                        continue
                    if entry.is_symlink() or not entry.is_file():
                        issues.append(
                            _issue(
                                entry,
                                "completion.report-entry",
                                "Completion Report entries must be real files",
                            )
                        )
                        continue
                    actual_files[entry.name] = hash_file(entry)
                if report_manifest.get("files") != actual_files:
                    issues.append(
                        _issue(
                            report_root,
                            "completion.report-tampered",
                            "Completion Report files changed",
                        )
                    )
                report_result = _read_json(
                    report_root / "report.json",
                    "research report",
                )
                frozen_session = (
                    report_result.get("evidence", {}).get("session")
                    if isinstance(report_result.get("evidence"), dict)
                    else None
                )
                if (
                    report_result.get("id") != report_id
                    or report_result.get("sessionId") != manifest["id"]
                    or report_result.get("evidenceHash")
                    != report.get("evidenceHash")
                    or report_result.get("publishedAt")
                    != report.get("publishedAt")
                    or not isinstance(frozen_session, dict)
                    or frozen_session.get("leader") != manifest["leader"]
                ):
                    issues.append(
                        _issue(
                            report_root / "report.json",
                            "completion.report-evidence",
                            "Completion Report does not freeze the terminal leader",
                        )
                    )
            except AutoQuantValidationError as error:
                issues.extend(error.issues)
    if issues:
        raise AutoQuantValidationError(issues)
    return receipt


def load_session(project: ProjectContext, session_id: str) -> SessionContext:
    root = _session_root(project, session_id)
    if root.is_symlink() or not root.is_dir():
        raise AutoQuantValidationError(
            [_issue(root, "session.missing", f"Unknown Session: {session_id}")]
        )
    manifest_path = root / SESSION_MANIFEST
    manifest = _read_json(manifest_path, "session")
    _validate_session_manifest(manifest, manifest_path, session_id)
    if manifest["projectId"] != project.manifest.id:
        raise AutoQuantValidationError(
            [_issue(manifest_path, "session.project", "Session Project id mismatch")]
        )
    expected_worktree = f"worktree/{project.manifest.id}"
    if manifest["worktree"] != expected_worktree:
        raise AutoQuantValidationError(
            [_issue(manifest_path, "session.worktree", "Unexpected Session worktree path")]
        )
    worktree_root = confined_path(root, manifest["worktree"], "session/worktree")
    worktree = load_project(worktree_root, expected_id=project.manifest.id)
    baseline = load_run(project, manifest["baseline"]["runId"])
    leader = load_run(project, manifest["leader"]["runId"])
    _validate_baseline_guard(project, manifest, baseline)
    delegation = validate_session_brief(
        project,
        root,
        manifest,
        baseline.result,
    )
    for key, run in (("baseline", baseline), ("leader", leader)):
        pointer = manifest[key]
        if (
            run.result["study"]["id"] != manifest["studyId"]
            or run.result["subject"]["sourceHash"] != pointer["sourceHash"]
            or run.result["objective"]["metric"] != pointer["metric"]
            or _metric_value(run) != float(pointer["value"])
        ):
            raise AutoQuantValidationError(
                [_issue(manifest_path, "session.run-pointer", f"Invalid {key} Run pointer")]
            )
    context = SessionContext(
        root,
        manifest_path,
        manifest,
        worktree,
        baseline,
        leader,
        delegation,
    )
    receipt_path = root / PROMOTION_RECEIPT
    completion_path = root / COMPLETION_RECEIPT
    if manifest["status"] == "active" and (
        receipt_path.exists()
        or receipt_path.is_symlink()
        or completion_path.exists()
        or completion_path.is_symlink()
    ):
        raise AutoQuantValidationError(
            [
                _issue(
                    root,
                    "session.uncommitted-receipt",
                    "Active Session has a terminal receipt",
                )
            ]
        )
    if manifest["status"] == "promoted":
        if completion_path.exists() or completion_path.is_symlink():
            raise AutoQuantValidationError(
                [
                    _issue(
                        completion_path,
                        "completion.unexpected",
                        "Promoted Session cannot have a completion receipt",
                    )
                ]
            )
        receipt = _read_json(receipt_path, "promotion")
        if receipt.get("kind") is None:
            # Exact V1 receipt support keeps already-published Project evidence
            # readable; all newly written receipts use the Report-bound form.
            receipt_required = {
                "schemaVersion",
                "id",
                "sessionId",
                "projectId",
                "studyId",
                "leaderRunId",
                "beforeSourceHash",
                "afterSourceHash",
                "sourceHashes",
                "promotedAt",
            }
            receipt_issues = _strict_keys(receipt, receipt_required, receipt_path)
            if (
                receipt.get("schemaVersion") != SCHEMA_VERSION
                or receipt.get("id") != f"promotion-{session_id}"
                or receipt.get("sessionId") != session_id
                or receipt.get("projectId") != project.manifest.id
                or receipt.get("studyId") != manifest["studyId"]
                or receipt.get("leaderRunId") != manifest["leader"]["runId"]
                or receipt.get("beforeSourceHash") != manifest["baseProjectSourceHash"]
                or receipt.get("afterSourceHash") != manifest["leader"]["sourceHash"]
                or receipt.get("sourceHashes") != _run_source_hashes(leader)
            ):
                receipt_issues.append(
                    _issue(
                        receipt_path,
                        "promotion.receipt",
                        "Legacy promotion receipt differs from Session leader",
                    )
                )
        else:
            receipt_required = {
                "schemaVersion",
                "kind",
                "id",
                "sessionId",
                "projectId",
                "studyId",
                "disposition",
                "leader",
                "beforeSourceHash",
                "afterSourceHash",
                "sourceHashes",
                "report",
                "promotedAt",
                "authority",
                "tradingAuthority",
            }
            receipt_issues = _strict_keys(receipt, receipt_required, receipt_path)
            receipt_body = {
                key: value
                for key, value in receipt.items()
                if key != "id"
            }
            promoted_at = receipt.get("promotedAt")
            expected_id = None
            if isinstance(promoted_at, str):
                try:
                    stamp = datetime.fromisoformat(promoted_at).strftime(
                        "%Y%m%dT%H%M%S%fZ"
                    )
                    expected_id = (
                        f"promotion-{stamp}-{hash_json(receipt_body)[:12]}"
                    )
                except ValueError:
                    pass
            if (
                receipt.get("schemaVersion") != SCHEMA_VERSION
                or receipt.get("kind") != "autoquant-session-promotion"
                or receipt.get("id") != expected_id
                or receipt.get("sessionId") != session_id
                or receipt.get("projectId") != project.manifest.id
                or receipt.get("studyId") != manifest["studyId"]
                or receipt.get("disposition") != "leader-promoted"
                or receipt.get("leader") != manifest["leader"]
                or receipt.get("beforeSourceHash") != manifest["baseProjectSourceHash"]
                or receipt.get("afterSourceHash") != manifest["leader"]["sourceHash"]
                or receipt.get("sourceHashes") != _run_source_hashes(leader)
                or receipt.get("promotedAt") != manifest["updatedAt"]
                or receipt.get("authority") != "quantitative-decision-support"
                or receipt.get("tradingAuthority") != "none"
            ):
                receipt_issues.append(
                    _issue(
                        receipt_path,
                        "promotion.receipt",
                        "Promotion receipt differs from the terminal Session",
                    )
                )
            report_projection = receipt.get("report")
            if delegation is None:
                if report_projection is not None:
                    receipt_issues.append(
                        _issue(
                            f"{receipt_path}/report",
                            "promotion.report-unexpected",
                            "Non-delegated promotion cannot bind a Report",
                        )
                    )
            elif not isinstance(report_projection, dict):
                receipt_issues.append(
                    _issue(
                        f"{receipt_path}/report",
                        "promotion.report-required",
                        "Delegated promotion must bind a Report",
                    )
                )
            else:
                report_id = report_projection.get("id")
                if not isinstance(report_id, str):
                    receipt_issues.append(
                        _issue(
                            f"{receipt_path}/report/id",
                            "promotion.report-id",
                            "Invalid promotion Report id",
                        )
                    )
                else:
                    try:
                        _, expected_projection = _current_terminal_report(
                            project,
                            context,
                            report_id,
                            operation="promotion",
                        )
                        if report_projection != expected_projection:
                            receipt_issues.append(
                                _issue(
                                    f"{receipt_path}/report",
                                    "promotion.report-receipt",
                                    "Promotion Report differs from immutable evidence",
                                )
                            )
                    except AutoQuantValidationError as error:
                        receipt_issues.extend(error.issues)
        if receipt_issues:
            raise AutoQuantValidationError(receipt_issues)
    if manifest["status"] == "completed":
        if receipt_path.exists() or receipt_path.is_symlink():
            raise AutoQuantValidationError(
                [
                    _issue(
                        receipt_path,
                        "promotion.unexpected",
                        "Completed Session cannot have a promotion receipt",
                    )
                ]
            )
        _validate_completion_receipt(project, root, manifest)
    return context


def load_session_completion(
    project: ProjectContext,
    session: SessionContext,
) -> dict[str, Any] | None:
    """Return the exact validated completion receipt for a completed Session."""

    if session.manifest["status"] != "completed":
        return None
    return _validate_completion_receipt(
        project,
        session.root_dir,
        session.manifest,
    )


def load_session_promotion(
    session: SessionContext,
) -> dict[str, Any] | None:
    """Return the exact already-validated promotion receipt."""

    if session.manifest["status"] != "promoted":
        return None
    return _read_json(session.root_dir / PROMOTION_RECEIPT, "promotion")


def _load_session_worktree_marker(
    worktree: ProjectContext,
) -> dict[str, Any] | None:
    marker_path = worktree.root_dir / SESSION_WORKTREE_MARKER
    if marker_path.is_symlink():
        raise AutoQuantValidationError(
            [
                _issue(
                    marker_path,
                    "session.worktree-marker-symlink",
                    "Session worktree marker must be a real file",
                )
            ]
        )
    if not marker_path.exists():
        return None
    if not marker_path.is_file():
        raise AutoQuantValidationError(
            [
                _issue(
                    marker_path,
                    "session.worktree-marker-file",
                    "Session worktree marker must be a real file",
                )
            ]
        )
    marker = _read_json(marker_path, "session-worktree-marker")
    issues = _strict_keys(
        marker,
        {"schemaVersion", "kind", "projectId", "sessionId"},
        marker_path,
    )
    if marker.get("schemaVersion") != SCHEMA_VERSION:
        issues.append(
            _issue(
                f"{marker_path}/schemaVersion",
                "session.worktree-marker-version",
                f"Expected Session worktree marker schema {SCHEMA_VERSION}",
            )
        )
    if marker.get("kind") != "autoquant-session-worktree":
        issues.append(
            _issue(
                f"{marker_path}/kind",
                "session.worktree-marker-kind",
                "Invalid Session worktree marker kind",
            )
        )
    if marker.get("projectId") != worktree.manifest.id:
        issues.append(
            _issue(
                f"{marker_path}/projectId",
                "session.worktree-marker-project",
                "Session worktree marker Project id mismatch",
            )
        )
    session_id = marker.get("sessionId")
    if not isinstance(session_id, str) or not SESSION_ID.fullmatch(session_id):
        issues.append(
            _issue(
                f"{marker_path}/sessionId",
                "session.worktree-marker-session",
                "Invalid Session worktree marker Session id",
            )
        )
    if issues:
        raise AutoQuantValidationError(issues)
    return marker


def resolve_session_worktree_owner(
    worktree: ProjectContext,
) -> tuple[ProjectContext, SessionContext] | None:
    """Resolve a marked worktree through its exact locked owning Session."""

    marker = _load_session_worktree_marker(worktree)
    marker_path = worktree.root_dir / SESSION_WORKTREE_MARKER
    for ancestor in worktree.root_dir.parents:
        manifest_path = ancestor / PROJECT_MANIFEST
        if manifest_path.is_symlink() or not manifest_path.is_file():
            continue
        try:
            owner = load_project(ancestor)
        except AutoQuantValidationError:
            continue
        if owner.root_dir == worktree.root_dir:
            continue
        sessions_root = _sessions_root(owner)
        try:
            relative = worktree.root_dir.relative_to(sessions_root)
        except ValueError:
            continue
        if marker is None:
            if (
                len(relative.parts) == 3
                and relative.parts[1] == "worktree"
                and relative.parts[2] == owner.manifest.id
            ):
                raise AutoQuantValidationError(
                    [
                        _issue(
                            marker_path,
                            "session.worktree-marker-missing",
                            "Session worktree is missing its locked owner marker",
                        )
                    ]
                )
            continue
        session_id = marker["sessionId"]
        expected = (
            session_id,
            "worktree",
            owner.manifest.id,
        )
        if relative.parts != expected:
            raise AutoQuantValidationError(
                [
                    _issue(
                        worktree.root_dir,
                        "session.worktree-owner-path",
                        "Session worktree path does not match its owner marker",
                    )
                ]
            )
        session = load_session(owner, session_id)
        if session.worktree_project.root_dir != worktree.root_dir:
            raise AutoQuantValidationError(
                [
                    _issue(
                        worktree.root_dir,
                        "session.worktree-owner",
                        "Session does not own this exact worktree",
                    )
                ]
            )
        expected_hash = session.manifest["locks"]["fixedHashes"].get(
            SESSION_WORKTREE_MARKER
        )
        if (
            not isinstance(expected_hash, str)
            or hash_file(marker_path) != expected_hash
        ):
            raise AutoQuantValidationError(
                [
                    _issue(
                        marker_path,
                        "session.worktree-marker-lock",
                        "Session worktree marker differs from its fixed lock",
                    )
                ]
            )
        return owner, session
    if marker is None:
        return None
    raise AutoQuantValidationError(
        [
            _issue(
                marker_path,
                "session.worktree-detached",
                "Session worktree is detached from its owning Project",
            )
        ]
    )


def list_sessions(project: ProjectContext) -> list[SessionSummary]:
    summaries: list[SessionSummary] = []
    for entry in sorted(_sessions_root(project).iterdir(), key=lambda item: item.name):
        if entry.name.startswith("."):
            continue
        if entry.is_symlink() or not entry.is_dir():
            raise AutoQuantValidationError(
                [_issue(entry, "session.entry", "Session entries must be real directories")]
            )
        session = load_session(project, entry.name)
        summaries.append(
            SessionSummary(
                id=session.manifest["id"],
                status=session.manifest["status"],
                study_id=session.manifest["studyId"],
                baseline_run_id=session.manifest["baseline"]["runId"],
                leader_run_id=session.manifest["leader"]["runId"],
                leader_value=float(session.manifest["leader"]["value"]),
                experiments=session.manifest["nextExperiment"] - 1,
                updated_at=session.manifest["updatedAt"],
                path=str(session.root_dir),
                delegated=session.delegation is not None,
                request_title=(
                    session.delegation["request"]["title"]
                    if session.delegation is not None
                    else None
                ),
            )
        )
    return summaries


def _history_issues(
    project: ProjectContext,
    session: SessionContext,
) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    expected = dict(session.manifest["baseline"])
    experiments = list_experiments(project, session)
    for sequence, experiment in enumerate(experiments, start=1):
        result = load_experiment(project, session, experiment.id).result
        if result["sequence"] != sequence:
            issues.append(
                _issue(
                    experiment.path,
                    "session.history-sequence",
                    f"Expected Experiment sequence {sequence}",
                )
            )
        if result["leader"] != expected:
            issues.append(
                _issue(
                    experiment.path,
                    "session.history-leader",
                    "Experiment leader does not match the preceding KEEP chain",
                )
            )
        run = load_run(project, result["candidate"]["runId"])
        if result["objective"] != run.result["objective"]:
            issues.append(
                _issue(
                    experiment.path,
                    "session.history-objective",
                    "Experiment objective differs from its candidate Run",
                )
            )
        if result["errors"] != run.result["errors"]:
            issues.append(
                _issue(
                    experiment.path,
                    "session.history-errors",
                    "Experiment errors differ from its candidate Run",
                )
            )
        if run.result["status"] == "failed":
            expected_verdict = "CRASH"
            expected_value = None
            expected_improvement = None
        else:
            expected_value = _metric_value(run)
            direction = run.result["objective"]["direction"]
            expected_improvement = (
                expected_value - float(expected["value"])
                if direction == "maximize"
                else float(expected["value"]) - expected_value
            )
            minimum = float(run.result["objective"]["minimumImprovement"])
            expected_verdict = (
                "KEEP"
                if expected_improvement > 0
                and expected_improvement >= minimum
                else "REVERT"
            )
        if (
            result["candidate"]["metric"] != run.result["objective"]["metric"]
            or result["candidate"]["value"] != expected_value
            or result["improvement"] != expected_improvement
            or result["verdict"] != expected_verdict
        ):
            issues.append(
                _issue(
                    experiment.path,
                    "session.history-verdict",
                    "Experiment verdict or comparison differs from its immutable Run",
                )
            )
        if expected_verdict == "KEEP":
            expected = dict(result["candidate"])
    if session.manifest["leader"] != expected:
        issues.append(
            _issue(
                session.manifest_path,
                "session.leader-chain",
                "Session leader does not match immutable KEEP history",
            )
        )
    if session.manifest["nextExperiment"] != len(experiments) + 1:
        issues.append(
            _issue(
                session.manifest_path,
                "session.history-count",
                "Session nextExperiment does not match immutable history",
            )
        )
    return issues


def _authority_issues(
    project: ProjectContext,
    session: SessionContext,
) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    manifest = session.manifest
    locks = manifest["locks"]
    try:
        canonical = load_study(project, manifest["studyId"])
        worktree = load_study(
            session.worktree_project,
            manifest["studyId"],
            data_root=_canonical_data_root(project),
            upstream_project=project,
        )
    except AutoQuantValidationError as error:
        return list(error.issues)
    for label, study in (("Project", canonical), ("worktree", worktree)):
        actual = {
            "studyHash": study.study_hash,
            "programHash": study.program_hash,
            "judgeHash": study.judge_hash,
            "datasetHash": study.dataset_hash,
        }
        if "dependencyHash" in locks:
            actual["dependencyHash"] = study.dependency_hash
        if "upstreamEvidenceHash" in locks:
            actual["upstreamEvidenceHash"] = study.upstream_evidence_hash
        for key, value in actual.items():
            if value != locks[key]:
                issues.append(
                    _issue(
                        session.manifest_path,
                        "session.lock-stale",
                        f"{label} {key} differs from the Session lock",
                    )
                )
    if worktree.definition.editable["paths"] != manifest["editablePaths"]:
        issues.append(
            _issue(
                session.manifest_path,
                "session.editable-stale",
                "Worktree editable paths differ from the Session",
            )
        )
    try:
        fixed = _fixed_inventory(
            session.worktree_project,
            manifest["editablePaths"],
        )
        if fixed != locks["fixedHashes"]:
            issues.append(
                _issue(
                    session.worktree_project.root_dir,
                    "session.fixed-modified",
                    "Session worktree files outside the editable closure changed",
                )
            )
    except AutoQuantValidationError as error:
        issues.extend(error.issues)
    if not same_harness_runtime(harness_identity(), locks["harness"]):
        issues.append(
            _issue(
                session.manifest_path,
                "session.harness-stale",
                "Installed Harness differs from the Session baseline",
            )
        )
    try:
        issues.extend(_history_issues(project, session))
    except AutoQuantValidationError as error:
        issues.extend(error.issues)
    return issues


def validate_session_authority(
    project: ProjectContext,
    session: SessionContext,
) -> StudyContext:
    issues = _authority_issues(project, session)
    if issues:
        raise AutoQuantValidationError(issues)
    return load_study(
        session.worktree_project,
        session.manifest["studyId"],
        data_root=_canonical_data_root(project),
        upstream_project=project,
    )


def session_snapshot(
    project: ProjectContext,
    session: SessionContext,
) -> dict[str, Any]:
    issues = _authority_issues(project, session)
    candidate: dict[str, Any] | None = None
    program_relative = "program.md"
    try:
        study = load_study(
            session.worktree_project,
            session.manifest["studyId"],
            data_root=_canonical_data_root(project),
            upstream_project=project,
        )
        program_relative = study.definition.program
        candidate = {
            "sourceHash": study.source_hash,
            "sourceHashes": study.editable_hashes,
            "differsFromLeader": (
                study.source_hash != session.manifest["leader"]["sourceHash"]
            ),
        }
    except AutoQuantValidationError:
        pass
    experiments = list_experiments(project, session)
    return {
        "session": session.manifest,
        "path": str(session.root_dir),
        "worktree": str(session.worktree_project.root_dir),
        "programPath": str(
            session.worktree_project.root_dir
            / session.worktree_project.manifest.directories["studies"]
            / session.manifest["studyId"]
            / program_relative
        ),
        "candidate": candidate,
        "delegation": session.delegation,
        "authority": {
            "valid": not issues,
            "issues": [issue.to_dict() for issue in issues],
        },
        "selectionIntegrity": build_selection_integrity(
            project,
            session.leader_run,
            [summary.verdict for summary in experiments],
        ),
        "experiments": [summary.to_dict() for summary in experiments],
    }


def build_selection_integrity(
    project: ProjectContext,
    leader_run: RunContext,
    verdicts: list[str],
    *,
    cutoff: str | None = None,
) -> dict[str, Any]:
    if any(verdict not in VERDICTS for verdict in verdicts):
        raise AutoQuantValidationError(
            [_issue("selectionIntegrity", "session.verdict", "Invalid verdict")]
        )
    raw = leader_run.result["metrics"].get("research_integrity")
    declared = (
        isinstance(raw, dict)
        and REFERENCE_INTEGRITY_KEYS.issubset(raw)
        and isinstance(raw.get("selection_split"), str)
        and isinstance(raw.get("test_role"), str)
        and isinstance(raw.get("test_enters_selection"), bool)
        and isinstance(raw.get("external_holdout_rule"), str)
    )
    if declared:
        selection_split = raw["selection_split"]
        test_role = raw["test_role"]
        test_enters_selection: bool | None = raw["test_enters_selection"]
        declared_external_holdout_rule = raw["external_holdout_rule"]
        external_holdout_rule = (
            VISIBLE_TEST_EXTERNAL_HOLDOUT_RULE
            if declared_external_holdout_rule
            == LEGACY_EXTERNAL_HOLDOUT_RULE
            else declared_external_holdout_rule
        )
    else:
        selection_split = "unspecified"
        test_role = "unspecified"
        test_enters_selection = None
        declared_external_holdout_rule = "unspecified"
        external_holdout_rule = "unspecified"
    counts = {
        verdict: verdicts.count(verdict)
        for verdict in ("KEEP", "REVERT", "CRASH")
    }
    candidate_trials = len(verdicts)
    external_required: bool | None = (
        candidate_trials > 0 and test_role == "visible-diagnostic"
        if declared
        else None
    )
    if declared and test_role == "visible-diagnostic":
        post_audit_candidate_iterations = max(0, candidate_trials - 1)
        test_exposure_state = (
            "baseline-test-visible"
            if candidate_trials == 0
            else "first-candidate-audit-visible"
            if candidate_trials == 1
            else "post-audit-candidate-iteration"
        )
        test_guidance_observability = "not-observable"
    else:
        post_audit_candidate_iterations = None
        test_exposure_state = "unspecified"
        test_guidance_observability = "not-declared"
    if (
        declared
        and external_required
        and post_audit_candidate_iterations == 0
    ):
        warning = (
            "The first candidate was fixed before its own test audit became "
            "visible, but baseline test evidence was already visible in this "
            "Session. Use a new external holdout before a fresh "
            "production-grade claim; Core does not infer whether anyone used "
            "the visible evidence."
        )
    elif (
        declared
        and external_required
        and isinstance(post_audit_candidate_iterations, int)
        and post_audit_candidate_iterations > 0
    ):
        warning = (
            f"{post_audit_candidate_iterations} later candidate source "
            "iteration(s) followed a completed candidate test audit. Use a "
            "new external holdout before a fresh production-grade claim; "
            "Core records timing, not whether visible evidence guided the edit."
        )
    elif declared:
        warning = (
            "Test evidence is visible diagnostic output; changing a candidate "
            "after inspecting it consumes its holdout value."
        )
    else:
        warning = (
            "This Study does not declare selection/test semantics; Core makes "
            "no holdout or objective-isolation claim."
        )
    family = build_research_family(
        project,
        leader_run,
        cutoff=cutoff,
    )
    adjustment = build_selection_adjustment(leader_run, family)
    return {
        "selectionMetric": leader_run.result["objective"]["metric"],
        "selectionSplit": selection_split,
        "testRole": test_role,
        "testEntersSelection": test_enters_selection,
        "testExposureState": test_exposure_state,
        "postAuditCandidateIterations": post_audit_candidate_iterations,
        "testGuidanceObservability": test_guidance_observability,
        "declaredExternalHoldoutRule": declared_external_holdout_rule,
        "externalHoldoutRule": external_holdout_rule,
        "externalHoldoutReason": (
            external_holdout_rule if external_required else None
        ),
        "candidateTrials": candidate_trials,
        "evaluatedRuns": candidate_trials + 1,
        "verdicts": counts,
        "externalHoldoutRequired": external_required,
        "warning": warning,
        "researchFamily": family.projection,
        "selectionAdjustment": adjustment,
        "verdictAuthority": "diagnostic-only",
    }


SELECTION_INTEGRITY_JSON_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "AutoQuant verified selection-integrity projection",
    "type": "object",
    "additionalProperties": False,
    "required": [
        "selectionMetric",
        "selectionSplit",
        "testRole",
        "testEntersSelection",
        "testExposureState",
        "postAuditCandidateIterations",
        "testGuidanceObservability",
        "declaredExternalHoldoutRule",
        "externalHoldoutRule",
        "externalHoldoutReason",
        "candidateTrials",
        "evaluatedRuns",
        "verdicts",
        "externalHoldoutRequired",
        "warning",
        "researchFamily",
        "selectionAdjustment",
        "verdictAuthority",
    ],
    "properties": {
        "selectionMetric": {"type": "string", "minLength": 1},
        "selectionSplit": {"type": "string", "minLength": 1},
        "testRole": {"type": "string", "minLength": 1},
        "testEntersSelection": {"type": ["boolean", "null"]},
        "testExposureState": {
            "enum": [
                "baseline-test-visible",
                "first-candidate-audit-visible",
                "post-audit-candidate-iteration",
                "unspecified",
            ]
        },
        "postAuditCandidateIterations": {
            "type": ["integer", "null"],
            "minimum": 0,
        },
        "testGuidanceObservability": {
            "enum": ["not-observable", "not-declared"]
        },
        "declaredExternalHoldoutRule": {
            "type": "string",
            "minLength": 1,
        },
        "externalHoldoutRule": {"type": "string", "minLength": 1},
        "externalHoldoutReason": {
            "type": ["string", "null"],
            "minLength": 1,
        },
        "candidateTrials": {"type": "integer", "minimum": 0},
        "evaluatedRuns": {"type": "integer", "minimum": 1},
        "verdicts": {
            "type": "object",
            "additionalProperties": False,
            "required": ["KEEP", "REVERT", "CRASH"],
            "properties": {
                "KEEP": {"type": "integer", "minimum": 0},
                "REVERT": {"type": "integer", "minimum": 0},
                "CRASH": {"type": "integer", "minimum": 0},
            },
        },
        "externalHoldoutRequired": {"type": ["boolean", "null"]},
        "warning": {"type": "string", "minLength": 1},
        "researchFamily": {"type": "object"},
        "selectionAdjustment": {"type": "object"},
        "verdictAuthority": {"const": "diagnostic-only"},
    },
}


def _source_changes(
    leader: RunContext,
    candidate: StudyContext,
    candidate_project: ProjectContext,
) -> tuple[list[dict[str, Any]], str]:
    before = _run_source_hashes(leader)
    after = candidate.editable_hashes
    changes: list[dict[str, Any]] = []
    patches: list[str] = []
    for relative in sorted(before.keys() | after.keys()):
        before_hash = before.get(relative)
        after_hash = after.get(relative)
        if before_hash == after_hash:
            continue
        kind = "modified"
        if before_hash is None:
            kind = "added"
        elif after_hash is None:
            kind = "deleted"
        changes.append(
            {
                "path": relative,
                "kind": kind,
                "beforeHash": before_hash,
                "afterHash": after_hash,
            }
        )
        before_path = leader.root_dir / "sources" / relative
        after_path = candidate_project.root_dir / relative
        try:
            before_text = (
                before_path.read_text(encoding="utf-8").splitlines(keepends=True)
                if before_path.is_file()
                else []
            )
            after_text = (
                after_path.read_text(encoding="utf-8").splitlines(keepends=True)
                if after_path.is_file()
                else []
            )
        except UnicodeDecodeError:
            continue
        patches.extend(
            difflib.unified_diff(
                before_text,
                after_text,
                fromfile=f"a/{relative}",
                tofile=f"b/{relative}",
            )
        )
    return changes, "".join(patches)


def _clear_editable(project: ProjectContext, study: StudyContext) -> None:
    files: set[str] = set()
    for pattern in study.definition.editable["paths"]:
        closure = pattern.endswith("/**")
        relative = pattern[:-3] if closure else pattern
        root = confined_path(project.root_dir, relative, f"editable/{pattern}")
        if root.is_symlink():
            raise AutoQuantValidationError(
                [_issue(root, "path.symlink", "Editable source cannot be a symlink")]
            )
        if closure:
            if not root.exists():
                root.mkdir(parents=True)
                continue
            if not root.is_dir():
                raise AutoQuantValidationError(
                    [_issue(root, "study.source-directory", "Editable closure root is not a directory")]
                )
            for path in root.rglob("*"):
                if path.is_symlink():
                    raise AutoQuantValidationError(
                        [_issue(path, "path.symlink", "Editable source cannot contain symlinks")]
                    )
                if path.is_file():
                    files.add(path.relative_to(project.root_dir).as_posix())
        elif root.exists():
            if not root.is_file():
                raise AutoQuantValidationError(
                    [_issue(root, "study.source-file", "Editable exact path is not a file")]
                )
            files.add(relative)
    for relative in sorted(files, reverse=True):
        confined_path(project.root_dir, relative, f"editable/{relative}").unlink()


def _copy_run_sources(
    run: RunContext,
    target_project: ProjectContext,
    study: StudyContext,
) -> None:
    hashes = _run_source_hashes(run)
    for relative, expected_hash in hashes.items():
        if not any(
            path_matches_pattern(relative, pattern)
            for pattern in study.definition.editable["paths"]
        ):
            raise AutoQuantValidationError(
                [_issue(relative, "session.source-escape", "Run source is outside editable closure")]
            )
        source = run.root_dir / "sources" / relative
        if hash_file(source) != expected_hash:
            raise AutoQuantValidationError(
                [_issue(source, "run.source-stale", "Run source hash changed")]
            )
        target = confined_path(
            target_project.root_dir,
            relative,
            f"editable/{relative}",
        )
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)


def _restore_leader(
    project: ProjectContext,
    session: SessionContext,
    candidate: StudyContext,
) -> None:
    _clear_editable(session.worktree_project, candidate)
    _copy_run_sources(
        session.leader_run,
        session.worktree_project,
        candidate,
    )
    restored = load_study(
        session.worktree_project,
        session.manifest["studyId"],
        data_root=_canonical_data_root(project),
        upstream_project=project,
    )
    if restored.source_hash != session.manifest["leader"]["sourceHash"]:
        raise AutoQuantValidationError(
            [_issue(session.root_dir, "session.restore", "Leader source restoration failed")]
        )


def _remove_path(path: Path) -> None:
    if path.is_symlink() or path.is_file():
        path.unlink()
    elif path.is_dir():
        shutil.rmtree(path)


def restore_session_worktree(
    project: ProjectContext,
    session: SessionContext,
) -> SessionContext:
    """Rebuild a damaged candidate worktree from fixed inputs and leader evidence."""

    canonical = load_study(project, session.manifest["studyId"])
    locks = session.manifest["locks"]
    fixed_identity = {
        "studyHash": canonical.study_hash,
        "programHash": canonical.program_hash,
        "judgeHash": canonical.judge_hash,
        "datasetHash": canonical.dataset_hash,
    }
    if "dependencyHash" in locks:
        fixed_identity["dependencyHash"] = canonical.dependency_hash
    if "upstreamEvidenceHash" in locks:
        fixed_identity["upstreamEvidenceHash"] = canonical.upstream_evidence_hash
    issues = [
        _issue(
            canonical.root_dir,
            "session.lock-stale",
            f"Project {key} differs from the Session lock",
        )
        for key, value in fixed_identity.items()
        if value != locks[key]
    ]
    if not same_harness_runtime(harness_identity(), locks["harness"]):
        issues.append(
            _issue(
                session.manifest_path,
                "session.harness-stale",
                "Installed Harness differs from the Session baseline",
            )
        )
    issues.extend(_history_issues(project, session))
    if issues:
        raise AutoQuantValidationError(issues)

    staging = session.root_dir / f".worktree-repair-{uuid.uuid4().hex}"
    worktree_container = session.root_dir / "worktree"
    backup = session.root_dir / f".worktree-backup-{uuid.uuid4().hex}"
    try:
        staging.mkdir()
        staged_project = _materialize_worktree(
            project,
            canonical,
            staging,
            session.manifest["id"],
        )
        staged_study = load_study(
            staged_project,
            session.manifest["studyId"],
            data_root=_canonical_data_root(project),
            upstream_project=project,
        )
        _clear_editable(staged_project, staged_study)
        _copy_run_sources(session.leader_run, staged_project, staged_study)
        restored = load_study(
            staged_project,
            session.manifest["studyId"],
            data_root=_canonical_data_root(project),
            upstream_project=project,
        )
        if restored.source_hash != session.manifest["leader"]["sourceHash"]:
            raise AutoQuantValidationError(
                [_issue(staging, "session.restore", "Rebuilt leader source hash mismatch")]
            )
        fixed = _fixed_inventory(
            staged_project,
            session.manifest["editablePaths"],
        )
        if fixed != locks["fixedHashes"]:
            raise AutoQuantValidationError(
                [_issue(staging, "session.restore", "Rebuilt fixed inventory mismatch")]
            )

        had_worktree = worktree_container.exists() or worktree_container.is_symlink()
        if had_worktree:
            os.replace(worktree_container, backup)
        try:
            os.replace(staging / "worktree", worktree_container)
        except Exception:
            if had_worktree and (backup.exists() or backup.is_symlink()):
                os.replace(backup, worktree_container)
            raise
        if backup.exists() or backup.is_symlink():
            _remove_path(backup)
    finally:
        if staging.exists() or staging.is_symlink():
            _remove_path(staging)
    return load_session(project, session.manifest["id"])


def _experiment_hashes(root: Path) -> dict[str, str]:
    hashes: dict[str, str] = {}
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            raise AutoQuantValidationError(
                [_issue(path, "path.symlink", "Experiment cannot contain symlinks")]
            )
        if path.is_file() and path != root / EXPERIMENT_MANIFEST:
            hashes[path.relative_to(root).as_posix()] = hash_file(path)
    return hashes


def _publish_experiment(
    project: ProjectContext,
    session: SessionContext,
    result: dict[str, Any],
    changes: list[dict[str, Any]],
    patch: str,
) -> ExperimentContext:
    experiments_root = session.root_dir / "experiments"
    experiment_id = result["id"]
    target = experiments_root / experiment_id
    temporary = experiments_root / f".{experiment_id}.creating"
    if target.exists() or temporary.exists():
        raise AutoQuantValidationError(
            [_issue(target, "experiment.collision", "Experiment already exists")]
        )
    try:
        temporary.mkdir()
        _write_json(temporary / EXPERIMENT_RESULT, result)
        _write_json(temporary / EXPERIMENT_CHANGES, changes)
        (temporary / EXPERIMENT_DIFF).write_text(patch, encoding="utf-8")
        files = _experiment_hashes(temporary)
        manifest = {
            "schemaVersion": SCHEMA_VERSION,
            "id": experiment_id,
            "sessionId": session.manifest["id"],
            "completed": True,
            "verdict": result["verdict"],
            "runId": result["candidate"]["runId"],
            "resultHash": files[EXPERIMENT_RESULT],
            "files": files,
        }
        _write_json(temporary / EXPERIMENT_MANIFEST, manifest)
        os.replace(temporary, target)
    except Exception:
        if temporary.exists():
            shutil.rmtree(temporary)
        raise
    return load_experiment(project, session, experiment_id)


def evaluate_experiment(
    project: ProjectContext,
    session_id: str,
    hypothesis: str,
) -> ExperimentContext:
    if not isinstance(hypothesis, str) or not hypothesis.strip():
        raise AutoQuantValidationError(
            [_issue("hypothesis", "schema.string", "Hypothesis must be non-empty")]
        )
    session = load_session(project, session_id)
    if session.manifest["status"] != "active":
        raise AutoQuantValidationError(
            [_issue(session.manifest_path, "session.closed", "Session is not active")]
        )
    candidate = validate_session_authority(project, session)
    if candidate.source_hash == session.manifest["leader"]["sourceHash"]:
        raise AutoQuantValidationError(
            [_issue(candidate.root_dir, "experiment.unchanged", "Candidate source is unchanged")]
        )
    changes, patch = _source_changes(
        session.leader_run,
        candidate,
        session.worktree_project,
    )
    if not changes:
        raise AutoQuantValidationError(
            [_issue(candidate.root_dir, "experiment.unchanged", "Candidate has no source changes")]
        )
    started_at = datetime.now(timezone.utc).isoformat()
    data_root = confined_path(
        project.root_dir,
        project.manifest.directories["data"],
        "project/directories/data",
    )
    run = execute_study(
        project,
        session.manifest["studyId"],
        execution_project=session.worktree_project,
        data_root=data_root,
    )
    leader_value = float(session.manifest["leader"]["value"])
    candidate_value: float | None = None
    improvement: float | None = None
    if run.result["status"] == "failed":
        verdict = "CRASH"
    else:
        candidate_value = _metric_value(run)
        direction = run.result["objective"]["direction"]
        improvement = (
            candidate_value - leader_value
            if direction == "maximize"
            else leader_value - candidate_value
        )
        minimum = float(run.result["objective"]["minimumImprovement"])
        verdict = (
            "KEEP"
            if improvement > 0 and improvement >= minimum
            else "REVERT"
        )
    sequence = int(session.manifest["nextExperiment"])
    experiment_id = f"exp-{sequence:04d}-{candidate.source_hash[:12]}"
    completed_at = datetime.now(timezone.utc).isoformat()
    result = {
        "schemaVersion": SCHEMA_VERSION,
        "id": experiment_id,
        "sessionId": session.manifest["id"],
        "sequence": sequence,
        "hypothesis": hypothesis.strip(),
        "verdict": verdict,
        "startedAt": started_at,
        "completedAt": completed_at,
        "studyId": session.manifest["studyId"],
        "objective": run.result["objective"],
        "leader": {
            **session.manifest["leader"],
            "runId": session.manifest["leader"]["runId"],
        },
        "candidate": {
            "runId": run.result["id"],
            "sourceHash": run.result["subject"]["sourceHash"],
            "metric": run.result["objective"]["metric"],
            "value": candidate_value,
        },
        "improvement": improvement,
        "changesHash": hash_json(changes),
        "errors": run.result["errors"],
    }
    experiment = _publish_experiment(project, session, result, changes, patch)
    if verdict in {"REVERT", "CRASH"}:
        _restore_leader(project, session, candidate)
        leader_pointer = session.manifest["leader"]
    else:
        leader_pointer = _run_pointer(run)
    updated = {
        **session.manifest,
        "updatedAt": completed_at,
        "leader": leader_pointer,
        "nextExperiment": sequence + 1,
    }
    _atomic_write_json(session.manifest_path, updated)
    return load_experiment(project, load_session(project, session_id), experiment_id)


def _validate_experiment_result(
    value: dict[str, Any],
    path: Path,
    experiment_id: str,
    session_id: str,
) -> None:
    required = {
        "schemaVersion",
        "id",
        "sessionId",
        "sequence",
        "hypothesis",
        "verdict",
        "startedAt",
        "completedAt",
        "studyId",
        "objective",
        "leader",
        "candidate",
        "improvement",
        "changesHash",
        "errors",
    }
    issues = _strict_keys(value, required, path)
    if value.get("schemaVersion") != SCHEMA_VERSION:
        issues.append(_issue(path, "schema.version", "Expected Experiment V1"))
    if value.get("id") != experiment_id or value.get("sessionId") != session_id:
        issues.append(_issue(path, "experiment.identity", "Experiment identity mismatch"))
    if value.get("verdict") not in VERDICTS:
        issues.append(_issue(path, "experiment.verdict", "Invalid Experiment verdict"))
    if (
        not isinstance(value.get("sequence"), int)
        or isinstance(value.get("sequence"), bool)
        or value.get("sequence", 0) < 1
    ):
        issues.append(_issue(path, "schema.number", "Invalid Experiment sequence"))
    for key in ("hypothesis", "startedAt", "completedAt", "studyId"):
        if not isinstance(value.get(key), str) or not value[key]:
            issues.append(_issue(f"{path}/{key}", "schema.string", f"Invalid {key}"))
    if not isinstance(value.get("changesHash"), str) or not SHA256.fullmatch(
        value.get("changesHash", "")
    ):
        issues.append(_issue(f"{path}/changesHash", "schema.hash", "Invalid changesHash"))
    improvement = value.get("improvement")
    if improvement is not None and (
        not isinstance(improvement, (int, float))
        or isinstance(improvement, bool)
        or not math.isfinite(float(improvement))
    ):
        issues.append(_issue(f"{path}/improvement", "schema.number", "Invalid improvement"))
    objective = value.get("objective")
    if not isinstance(objective, dict):
        issues.append(_issue(f"{path}/objective", "schema.type", "Invalid objective"))
    else:
        issues.extend(
            _strict_keys(
                objective,
                {"metric", "direction", "minimumImprovement"},
                f"{path}/objective",
            )
        )
    for key, required_keys in (
        ("leader", {"runId", "sourceHash", "metric", "value"}),
        ("candidate", {"runId", "sourceHash", "metric", "value"}),
    ):
        pointer = value.get(key)
        if not isinstance(pointer, dict):
            issues.append(_issue(f"{path}/{key}", "schema.type", f"Invalid {key}"))
            continue
        issues.extend(_strict_keys(pointer, required_keys, f"{path}/{key}"))
        if not isinstance(pointer.get("runId"), str) or not pointer["runId"].startswith("run-"):
            issues.append(_issue(f"{path}/{key}/runId", "schema.string", "Invalid Run id"))
        if not isinstance(pointer.get("sourceHash"), str) or not SHA256.fullmatch(
            pointer.get("sourceHash", "")
        ):
            issues.append(_issue(f"{path}/{key}/sourceHash", "schema.hash", "Invalid sourceHash"))
    errors = value.get("errors")
    if not isinstance(errors, list):
        issues.append(_issue(f"{path}/errors", "schema.array", "Errors must be an array"))
    if value.get("verdict") == "CRASH":
        candidate = value.get("candidate")
        if isinstance(candidate, dict) and candidate.get("value") is not None:
            issues.append(_issue(f"{path}/candidate/value", "experiment.crash-value", "CRASH cannot have a candidate value"))
        if improvement is not None:
            issues.append(_issue(f"{path}/improvement", "experiment.crash-improvement", "CRASH cannot have an improvement"))
    elif value.get("verdict") in {"KEEP", "REVERT"}:
        candidate = value.get("candidate")
        candidate_value = candidate.get("value") if isinstance(candidate, dict) else None
        if (
            not isinstance(candidate_value, (int, float))
            or isinstance(candidate_value, bool)
            or not math.isfinite(float(candidate_value))
        ):
            issues.append(_issue(f"{path}/candidate/value", "schema.number", "Verdict requires a candidate value"))
    if issues:
        raise AutoQuantValidationError(issues)


def load_experiment(
    project: ProjectContext,
    session: SessionContext,
    experiment_id: str,
) -> ExperimentContext:
    root = _experiment_root(session, experiment_id)
    if root.is_symlink() or not root.is_dir():
        raise AutoQuantValidationError(
            [_issue(root, "experiment.missing", f"Unknown Experiment: {experiment_id}")]
        )
    manifest = _read_json(root / EXPERIMENT_MANIFEST, "experiment-manifest")
    required = {
        "schemaVersion",
        "id",
        "sessionId",
        "completed",
        "verdict",
        "runId",
        "resultHash",
        "files",
    }
    issues = _strict_keys(manifest, required, root / EXPERIMENT_MANIFEST)
    if (
        manifest.get("schemaVersion") != SCHEMA_VERSION
        or manifest.get("id") != experiment_id
        or manifest.get("sessionId") != session.manifest["id"]
        or manifest.get("completed") is not True
        or manifest.get("verdict") not in VERDICTS
    ):
        issues.append(
            _issue(root / EXPERIMENT_MANIFEST, "experiment.manifest", "Invalid terminal manifest")
        )
    files = manifest.get("files")
    actual = _experiment_hashes(root)
    if not isinstance(files, dict) or files != actual:
        issues.append(_issue(root, "experiment.tampered", "Experiment files changed"))
    if isinstance(files, dict) and files.get(EXPERIMENT_RESULT) != manifest.get("resultHash"):
        issues.append(_issue(root, "experiment.result-hash", "Experiment result hash mismatch"))
    if issues:
        raise AutoQuantValidationError(issues)
    result = _read_json(root / EXPERIMENT_RESULT, "experiment-result")
    _validate_experiment_result(
        result,
        root / EXPERIMENT_RESULT,
        experiment_id,
        session.manifest["id"],
    )
    changes_value = json.loads((root / EXPERIMENT_CHANGES).read_text(encoding="utf-8"))
    if not isinstance(changes_value, list) or hash_json(changes_value) != result["changesHash"]:
        raise AutoQuantValidationError(
            [_issue(root / EXPERIMENT_CHANGES, "experiment.changes", "Invalid source changes")]
        )
    run = load_run(project, manifest["runId"])
    if (
        run.result["id"] != result["candidate"]["runId"]
        or run.result["subject"]["sourceHash"] != result["candidate"]["sourceHash"]
    ):
        raise AutoQuantValidationError(
            [_issue(root, "experiment.run", "Candidate Run differs from Experiment")]
        )
    return ExperimentContext(root, manifest, result, changes_value)


def list_experiments(
    project: ProjectContext,
    session: SessionContext,
) -> list[ExperimentSummary]:
    root = session.root_dir / "experiments"
    summaries: list[ExperimentSummary] = []
    for entry in sorted(root.iterdir(), key=lambda item: item.name):
        if entry.name.startswith("."):
            continue
        if entry.is_symlink() or not entry.is_dir():
            raise AutoQuantValidationError(
                [_issue(entry, "experiment.entry", "Experiment entries must be directories")]
            )
        experiment = load_experiment(project, session, entry.name)
        result = experiment.result
        summaries.append(
            ExperimentSummary(
                id=result["id"],
                sequence=result["sequence"],
                verdict=result["verdict"],
                hypothesis=result["hypothesis"],
                leader_value=float(result["leader"]["value"]),
                candidate_value=(
                    float(result["candidate"]["value"])
                    if result["candidate"]["value"] is not None
                    else None
                ),
                improvement=(
                    float(result["improvement"])
                    if result["improvement"] is not None
                    else None
                ),
                run_id=result["candidate"]["runId"],
                completed_at=result["completedAt"],
                path=str(experiment.root_dir),
            )
        )
    return summaries


def _current_terminal_report(
    project: ProjectContext,
    session: SessionContext,
    report_id: str,
    *,
    operation: str,
) -> tuple[Any, dict[str, Any]]:
    """Verify one Report freezes the complete current delegated Session."""

    if session.delegation is None:
        raise AutoQuantValidationError(
            [
                _issue(
                    session.manifest_path,
                    f"{operation}.request-required",
                    f"{operation.title()} Reports require a delegated Session brief",
                )
            ]
        )
    from .reports import REPORT_MANIFEST, load_report
    from .research import list_campaign_progress, list_campaigns

    progress = list_campaign_progress(session)
    if progress:
        raise AutoQuantValidationError(
            [
                _issue(
                    session.root_dir,
                    f"{operation}.campaign-running",
                    f"Cannot {operation} while a Researcher Campaign is running",
                )
            ]
        )
    report = load_report(project, session, report_id)
    frozen_session = report.report["evidence"]["session"]
    frozen_experiments = [
        item["id"] for item in report.report["evidence"]["experiments"]
    ]
    current_experiments = [
        item.id for item in list_experiments(project, session)
    ]
    frozen_campaigns = [
        item["id"] for item in report.report["evidence"]["campaigns"]
    ]
    current_campaigns = [
        item.id for item in list_campaigns(project, session)
    ]
    if (
        frozen_session["leader"] != session.manifest["leader"]
        or report.report["request"] != session.delegation["request"]
        or frozen_experiments != current_experiments
        or frozen_campaigns != current_campaigns
    ):
        raise AutoQuantValidationError(
            [
                _issue(
                    report.root_dir,
                    f"{operation}.report-current",
                    "Selected Report does not freeze the complete current "
                    "Session evidence and delegated request",
                )
            ]
        )
    projection = {
        "id": report.report["id"],
        "manifestHash": hash_file(report.root_dir / REPORT_MANIFEST),
        "reportHash": report.manifest["reportHash"],
        "evidenceHash": report.report["evidenceHash"],
        "publishedAt": report.report["publishedAt"],
    }
    return report, projection


def promote_session(
    project: ProjectContext,
    session_id: str,
    report_id: str | None = None,
) -> dict[str, Any]:
    session = load_session(project, session_id)
    if session.manifest["status"] != "active":
        raise AutoQuantValidationError(
            [_issue(session.manifest_path, "session.closed", "Session is not active")]
        )
    if session.manifest["leader"]["runId"] == session.manifest["baseline"]["runId"]:
        raise AutoQuantValidationError(
            [_issue(session.manifest_path, "promotion.no-keep", "Session has no KEEP to promote")]
        )
    report_projection: dict[str, Any] | None = None
    if session.delegation is not None:
        if report_id is None:
            raise AutoQuantValidationError(
                [
                    _issue(
                        session.manifest_path,
                        "promotion.report-required",
                        "Delegated KEEP promotion requires an exact current "
                        "Research Report; publish it first and pass --report",
                    )
                ]
            )
        _, report_projection = _current_terminal_report(
            project,
            session,
            report_id,
            operation="promotion",
        )
    elif report_id is not None:
        raise AutoQuantValidationError(
            [
                _issue(
                    session.manifest_path,
                    "promotion.report-unexpected",
                    "Non-delegated Sessions cannot bind a Research Report",
                )
            ]
        )
    validate_session_authority(project, session)
    canonical = load_study(project, session.manifest["studyId"])
    if canonical.source_hash != session.manifest["baseProjectSourceHash"]:
        raise AutoQuantValidationError(
            [
                _issue(
                    canonical.root_dir,
                    "promotion.stale-base",
                    "Project candidate source changed since Session start",
                )
            ]
        )
    receipt_path = session.root_dir / PROMOTION_RECEIPT
    if receipt_path.exists() or receipt_path.is_symlink():
        raise AutoQuantValidationError(
            [_issue(receipt_path, "promotion.exists", "Promotion receipt already exists")]
        )
    leader_hashes = _run_source_hashes(session.leader_run)
    before_hashes = canonical.editable_hashes
    promoted = datetime.now(timezone.utc)
    promoted_at = promoted.isoformat()
    receipt_body = {
        "schemaVersion": SCHEMA_VERSION,
        "kind": "autoquant-session-promotion",
        "sessionId": session_id,
        "projectId": project.manifest.id,
        "studyId": session.manifest["studyId"],
        "disposition": "leader-promoted",
        "leader": session.manifest["leader"],
        "beforeSourceHash": session.manifest["baseProjectSourceHash"],
        "afterSourceHash": session.manifest["leader"]["sourceHash"],
        "sourceHashes": leader_hashes,
        "report": report_projection,
        "promotedAt": promoted_at,
        "authority": "quantitative-decision-support",
        "tradingAuthority": "none",
    }
    identity = hash_json(receipt_body)
    receipt = {
        **receipt_body,
        "id": (
            f"promotion-{promoted.strftime('%Y%m%dT%H%M%S%fZ')}-"
            f"{identity[:12]}"
        ),
    }
    with tempfile.TemporaryDirectory(prefix=f"aq-promote-{session_id}-") as directory:
        backup = Path(directory) / "backup"
        copy_hashed_files(project, before_hashes, backup)
        try:
            _clear_editable(project, canonical)
            _copy_run_sources(session.leader_run, project, canonical)
            promoted = load_study(project, session.manifest["studyId"])
            if promoted.source_hash != session.manifest["leader"]["sourceHash"]:
                raise AutoQuantValidationError(
                    [_issue(project.root_dir, "promotion.hash", "Promoted source hash mismatch")]
                )
            _write_json(receipt_path, receipt)
            _atomic_write_json(
                session.manifest_path,
                {
                    **session.manifest,
                    "status": "promoted",
                    "updatedAt": promoted_at,
                },
            )
        except Exception:
            _clear_editable(project, canonical)
            for relative, expected_hash in before_hashes.items():
                source = backup / relative
                if hash_file(source) != expected_hash:
                    raise RuntimeError("Promotion backup hash mismatch")
                target = confined_path(project.root_dir, relative, f"rollback/{relative}")
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, target)
            if receipt_path.is_file():
                receipt_path.unlink()
            _atomic_write_json(session.manifest_path, session.manifest)
            raise
    return receipt


def complete_session(
    project: ProjectContext,
    session_id: str,
    report_id: str,
) -> dict[str, Any]:
    """Finish one delegated baseline-retaining Session with an exact Report."""

    session = load_session(project, session_id)
    if session.manifest["status"] == "promoted":
        raise AutoQuantValidationError(
            [
                _issue(
                    session.manifest_path,
                    "completion.already-promoted",
                    "Session is already terminally closed by KEEP promotion; "
                    "session.complete applies only to an active "
                    "baseline-retaining delegated Session and is neither "
                    "required nor valid after promotion",
                )
            ]
        )
    if session.manifest["status"] != "active":
        raise AutoQuantValidationError(
            [
                _issue(
                    session.manifest_path,
                    "session.closed",
                    "Session is not active",
                )
            ]
        )
    if session.delegation is None:
        raise AutoQuantValidationError(
            [
                _issue(
                    session.manifest_path,
                    "completion.request-required",
                    "Only a delegated Session with a Research Report can complete",
                )
            ]
        )
    if session.manifest["leader"] != session.manifest["baseline"]:
        raise AutoQuantValidationError(
            [
                _issue(
                    session.manifest_path,
                    "completion.unpromoted-leader",
                    "Session has an improved KEEP leader. Source promotion is "
                    "the terminal close path for this lane even when the "
                    "leader remains scientifically unqualified; promotion "
                    "preserves the best source but does not grant downstream "
                    "admission or trading authority",
                )
            ]
        )
    candidate = validate_session_authority(project, session)
    if candidate.source_hash != session.manifest["leader"]["sourceHash"]:
        raise AutoQuantValidationError(
            [
                _issue(
                    candidate.root_dir,
                    "completion.candidate-changed",
                    "Session worktree differs from the verified leader",
                )
            ]
        )
    report, report_projection = _current_terminal_report(
        project,
        session,
        report_id,
        operation="completion",
    )
    receipt_path = session.root_dir / COMPLETION_RECEIPT
    promotion_path = session.root_dir / PROMOTION_RECEIPT
    if (
        receipt_path.exists()
        or receipt_path.is_symlink()
        or promotion_path.exists()
        or promotion_path.is_symlink()
    ):
        raise AutoQuantValidationError(
            [
                _issue(
                    session.root_dir,
                    "completion.exists",
                    "Session already has a terminal receipt",
                )
            ]
        )
    completed = datetime.now(timezone.utc)
    identity = hash_json(
        {
            "sessionId": session_id,
            "projectId": project.manifest.id,
            "studyId": session.manifest["studyId"],
            "disposition": "baseline-reported",
            "leader": session.manifest["leader"],
            "brief": session.manifest["brief"],
            "report": report_projection,
            "completedAt": completed.isoformat(),
        }
    )
    receipt = {
        "schemaVersion": SCHEMA_VERSION,
        "kind": "autoquant-session-completion",
        "id": (
            f"completion-{completed.strftime('%Y%m%dT%H%M%S%fZ')}-"
            f"{identity[:12]}"
        ),
        "sessionId": session_id,
        "projectId": project.manifest.id,
        "studyId": session.manifest["studyId"],
        "disposition": "baseline-reported",
        "leader": session.manifest["leader"],
        "brief": session.manifest["brief"],
        "report": report_projection,
        "completedAt": completed.isoformat(),
        "authority": "quantitative-decision-support",
        "tradingAuthority": "none",
    }
    try:
        _atomic_write_json(receipt_path, receipt)
        _atomic_write_json(
            session.manifest_path,
            {
                **session.manifest,
                "status": "completed",
                "updatedAt": completed.isoformat(),
            },
        )
    except Exception:
        if receipt_path.is_file():
            receipt_path.unlink()
        _atomic_write_json(session.manifest_path, session.manifest)
        raise
    load_session(project, session_id)
    return receipt


SESSION_JSON_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "AutoQuant Research Session",
    "type": "object",
    "additionalProperties": False,
    "required": [
        "schemaVersion",
        "id",
        "status",
        "projectId",
        "studyId",
        "createdAt",
        "updatedAt",
        "worktree",
        "editablePaths",
        "baseProjectSourceHash",
        "baseline",
        "leader",
        "locks",
        "nextExperiment",
    ],
    "properties": {
        "schemaVersion": {"const": SCHEMA_VERSION},
        "id": {"type": "string", "pattern": SESSION_ID.pattern},
        "status": {"enum": sorted(SESSION_STATUSES)},
        "projectId": {"type": "string", "minLength": 1},
        "studyId": {"type": "string", "minLength": 1},
        "createdAt": {"type": "string", "format": "date-time"},
        "updatedAt": {"type": "string", "format": "date-time"},
        "worktree": {"type": "string", "minLength": 1},
        "editablePaths": {
            "type": "array",
            "minItems": 1,
            "items": {"type": "string", "minLength": 1},
        },
        "baseProjectSourceHash": {
            "type": "string",
            "pattern": SHA256.pattern,
        },
        "baseline": {"$ref": "#/$defs/runPointer"},
        "leader": {"$ref": "#/$defs/runPointer"},
        "baselineGuard": {
            "type": "object",
            "additionalProperties": False,
            "required": ["mode", "baselineRunId", "preflight"],
            "properties": {
                "mode": {
                    "enum": [
                        "fresh-preflight-and-run",
                        "fresh-run-no-preflight",
                        "reused-successful-run",
                    ]
                },
                "baselineRunId": {"type": "string", "pattern": "^run-"},
                "preflight": {
                    "oneOf": [
                        {"type": "null"},
                        {"$ref": "#/$defs/baselinePreflight"},
                    ]
                },
            },
        },
        "locks": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "studyHash",
                "programHash",
                "judgeHash",
                "datasetHash",
                "harness",
                "fixedHashes",
            ],
            "properties": {
                "studyHash": {"type": "string", "pattern": SHA256.pattern},
                "programHash": {"type": "string", "pattern": SHA256.pattern},
                "judgeHash": {"type": "string", "pattern": SHA256.pattern},
                "dependencyHash": {
                    "type": "string",
                    "pattern": SHA256.pattern,
                },
                "upstreamEvidenceHash": {
                    "type": "string",
                    "pattern": SHA256.pattern,
                },
                "datasetHash": {"type": "string", "pattern": SHA256.pattern},
                "harness": {"type": "object"},
                "fixedHashes": {
                    "type": "object",
                    "additionalProperties": {
                        "type": "string",
                        "pattern": SHA256.pattern,
                    },
                },
            },
        },
        "nextExperiment": {"type": "integer", "minimum": 1},
        "brief": {
            "type": "object",
            "additionalProperties": False,
            "required": ["id", "requestHash", "briefHash"],
            "properties": {
                "id": {"type": "string", "pattern": "^brief-[0-9a-f]{16}$"},
                "requestHash": {"type": "string", "pattern": SHA256.pattern},
                "briefHash": {"type": "string", "pattern": SHA256.pattern},
            },
        },
    },
    "$defs": {
        "baselinePreflight": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "status",
                "summary",
                "startedAt",
                "completedAt",
                "durationMs",
                "study",
                "candidate",
                "preflight",
                "harness",
                "inputHash",
                "outputHash",
                "authority",
                "checks",
                "errors",
                "execution",
                "receiptHash",
            ],
            "properties": {
                "status": {"const": "passed"},
                "summary": {"type": "string", "minLength": 1},
                "startedAt": {"type": "string", "format": "date-time"},
                "completedAt": {"type": "string", "format": "date-time"},
                "durationMs": {"type": "integer", "minimum": 0},
                "study": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["inputHash", "datasetHash"],
                    "properties": {
                        "inputHash": {"type": "string", "pattern": SHA256.pattern},
                        "datasetHash": {"type": "string", "pattern": SHA256.pattern},
                    },
                },
                "candidate": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["sourceHash"],
                    "properties": {
                        "sourceHash": {"type": "string", "pattern": SHA256.pattern}
                    },
                },
                "preflight": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["hash", "sourceHashes"],
                    "properties": {
                        "hash": {"type": "string", "pattern": SHA256.pattern},
                        "sourceHashes": {
                            "type": "object",
                            "additionalProperties": {
                                "type": "string",
                                "pattern": SHA256.pattern,
                            },
                        },
                    },
                },
                "harness": {"type": "object"},
                "inputHash": {"type": "string", "pattern": SHA256.pattern},
                "outputHash": {"type": "string", "pattern": SHA256.pattern},
                "receiptHash": {"type": "string", "pattern": SHA256.pattern},
                "authority": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": [
                        "selectionAuthority",
                        "promotionAuthority",
                        "tradingAuthority",
                    ],
                    "properties": {
                        "selectionAuthority": {"const": "none"},
                        "promotionAuthority": {"const": "none"},
                        "tradingAuthority": {"const": "none"},
                    },
                },
                "checks": {"type": "array", "minItems": 1},
                "errors": {"type": "array", "maxItems": 0},
                "execution": {"type": "object"},
            },
        },
        "runPointer": {
            "type": "object",
            "additionalProperties": False,
            "required": ["runId", "sourceHash", "metric", "value"],
            "properties": {
                "runId": {"type": "string", "pattern": "^run-"},
                "sourceHash": {"type": "string", "pattern": SHA256.pattern},
                "metric": {"type": "string", "minLength": 1},
                "value": {"type": "number"},
            },
        }
    },
}


SESSION_COMPLETION_JSON_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "AutoQuant immutable Session completion receipt",
    "type": "object",
    "additionalProperties": False,
    "required": [
        "schemaVersion",
        "kind",
        "id",
        "sessionId",
        "projectId",
        "studyId",
        "disposition",
        "leader",
        "brief",
        "report",
        "completedAt",
        "authority",
        "tradingAuthority",
    ],
    "properties": {
        "schemaVersion": {"const": SCHEMA_VERSION},
        "kind": {"const": "autoquant-session-completion"},
        "id": {"type": "string", "pattern": COMPLETION_ID.pattern},
        "sessionId": {"type": "string", "pattern": SESSION_ID.pattern},
        "projectId": {"type": "string", "minLength": 1},
        "studyId": {"type": "string", "minLength": 1},
        "disposition": {"const": "baseline-reported"},
        "leader": {"$ref": "#/$defs/runPointer"},
        "brief": {
            "type": "object",
            "additionalProperties": False,
            "required": ["id", "requestHash", "briefHash"],
            "properties": {
                "id": {"type": "string", "pattern": "^brief-[0-9a-f]{16}$"},
                "requestHash": {"type": "string", "pattern": SHA256.pattern},
                "briefHash": {"type": "string", "pattern": SHA256.pattern},
            },
        },
        "report": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "id",
                "manifestHash",
                "reportHash",
                "evidenceHash",
                "publishedAt",
            ],
            "properties": {
                "id": {"type": "string", "pattern": "^report-"},
                "manifestHash": {
                    "type": "string",
                    "pattern": SHA256.pattern,
                },
                "reportHash": {
                    "type": "string",
                    "pattern": SHA256.pattern,
                },
                "evidenceHash": {
                    "type": "string",
                    "pattern": SHA256.pattern,
                },
                "publishedAt": {"type": "string", "format": "date-time"},
            },
        },
        "completedAt": {"type": "string", "format": "date-time"},
        "authority": {"const": "quantitative-decision-support"},
        "tradingAuthority": {"const": "none"},
    },
    "$defs": {
        "runPointer": {
            "type": "object",
            "additionalProperties": False,
            "required": ["runId", "sourceHash", "metric", "value"],
            "properties": {
                "runId": {"type": "string", "pattern": "^run-"},
                "sourceHash": {"type": "string", "pattern": SHA256.pattern},
                "metric": {"type": "string", "minLength": 1},
                "value": {"type": "number"},
            },
        },
    },
}


EXPERIMENT_JSON_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "AutoQuant immutable Experiment result",
    "type": "object",
    "additionalProperties": False,
    "required": [
        "schemaVersion",
        "id",
        "sessionId",
        "sequence",
        "hypothesis",
        "verdict",
        "startedAt",
        "completedAt",
        "studyId",
        "objective",
        "leader",
        "candidate",
        "improvement",
        "changesHash",
        "errors",
    ],
    "properties": {
        "schemaVersion": {"const": SCHEMA_VERSION},
        "id": {"type": "string", "pattern": EXPERIMENT_ID.pattern},
        "sessionId": {"type": "string", "pattern": SESSION_ID.pattern},
        "sequence": {"type": "integer", "minimum": 1},
        "hypothesis": {"type": "string", "minLength": 1},
        "verdict": {"enum": sorted(VERDICTS)},
        "startedAt": {"type": "string", "format": "date-time"},
        "completedAt": {"type": "string", "format": "date-time"},
        "studyId": {"type": "string", "minLength": 1},
        "objective": {"type": "object"},
        "leader": {"type": "object"},
        "candidate": {"type": "object"},
        "improvement": {"type": ["number", "null"]},
        "changesHash": {"type": "string", "pattern": SHA256.pattern},
        "errors": {"type": "array"},
    },
}
