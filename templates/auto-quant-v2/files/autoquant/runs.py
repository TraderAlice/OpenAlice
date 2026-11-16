"""Bounded Python Judge execution and immutable RunResult publication."""

from __future__ import annotations

import json
import math
import os
import platform
import re
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any

from .intervals import (
    AGGREGATION_METHOD,
    BASE_INTERVAL,
    CONTINUOUS_AGGREGATION_METHOD,
    CONTINUOUS_TERMINAL_POLICY,
    SESSION_TERMINAL_POLICY,
    SUPPORTED_BASE_INTERVALS,
    SUPPORTED_FEATURE_INTERVALS,
    SUPPORTED_INTERVALS,
    XNYS_AGGREGATION_METHOD,
    IntervalContractError,
    canonical_interval_surface,
)
from .studies import (
    SCHEMA_VERSION,
    StudyContext,
    copy_hashed_files,
    hash_file,
    hash_json,
    load_study,
    materialize_upstream_evidence,
)
from .workspace import (
    PROJECT_MANIFEST,
    AutoQuantValidationError,
    ProjectContext,
    ValidationIssue,
    confined_path,
)
from .version import current_build_identity, current_version


RUN_MANIFEST = "manifest.json"
RUN_RESULT = "result.json"
JUDGE_OUTPUT = "judge-output.json"
RESEARCH_EVALUATION_ROLE = "research-selection"
HOLDOUT_EVALUATION_ROLE = "external-temporal-audit"
RUN_SCHEMA_VERSION = 1
JUDGE_OUTPUT_VERSION = 1
SHA256 = re.compile(r"^[0-9a-f]{64}$")
FAILURE_DISPOSITIONS = {"scientific-limit", "repair-required"}
DEFAULT_FAILURE_DISPOSITION = "repair-required"


@dataclass(frozen=True)
class RunContext:
    root_dir: Path
    manifest: dict[str, Any]
    result: dict[str, Any]


@dataclass(frozen=True)
class RunSummary:
    id: str
    status: str
    failure_disposition: str | None
    study_id: str
    subject_kind: str
    subject_name: str
    primary_metric: str
    primary_value: float | None
    started_at: str
    duration_ms: int
    path: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "status": self.status,
            "failureDisposition": self.failure_disposition,
            "studyId": self.study_id,
            "subject": {
                "kind": self.subject_kind,
                "name": self.subject_name,
            },
            "primaryMetric": self.primary_metric,
            "primaryValue": self.primary_value,
            "startedAt": self.started_at,
            "durationMs": self.duration_ms,
            "path": self.path,
        }


def _issue(path: Path | str, code: str, message: str) -> ValidationIssue:
    return ValidationIssue(str(path), code, message)


def run_failure_disposition(result: dict[str, Any]) -> str | None:
    """Return the conservative failure meaning for current and legacy Runs."""

    if result.get("status") != "failed":
        return None
    value = result.get("failureDisposition")
    return (
        value
        if value in FAILURE_DISPOSITIONS
        else DEFAULT_FAILURE_DISPOSITION
    )


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _harness_source_hash(package_root: Path | None = None) -> str:
    package_root = package_root or Path(__file__).resolve().parent
    files = {
        f"autoquant/{path.relative_to(package_root).as_posix()}": hash_file(path)
        for path in sorted(package_root.rglob("*"))
        if path.is_file()
        and not path.is_symlink()
        and "__pycache__" not in path.parts
        and path.suffix != ".pyc"
        and path.name != "_build_identity.py"
    }
    return hash_json(files)


def harness_identity() -> dict[str, Any]:
    build = current_build_identity()
    return {
        "id": "autoquant.python-judge",
        "version": current_version(),
        "commit": build["commit"],
        "dirty": build["dirty"],
        "buildProvenance": build["provenance"],
        "sourceHash": _harness_source_hash(),
        "python": platform.python_version(),
    }


def same_harness_runtime(
    left: dict[str, Any],
    right: dict[str, Any],
) -> bool:
    """Compare the executable Harness identity, excluding Git provenance.

    A repository Workspace can commit research Projects without changing the
    installed Harness. In that case ``commit`` and ``dirty`` may change while
    the executable runtime remains byte-for-byte identical. Those provenance
    fields stay in RunResult, but they must not invalidate reusable evidence or
    an active Session.
    """

    runtime_fields = ("id", "version", "sourceHash", "python")
    return all(left.get(field) == right.get(field) for field in runtime_fields)


def _dataset_interval_surface(
    study: StudyContext,
    data_root: Path,
) -> dict[str, Any] | None:
    """Project canonical multi-interval authority into immutable Run evidence."""

    relative = "ohlcv/snapshot.json"
    if relative not in study.dataset_hashes:
        return None
    snapshot_path = confined_path(data_root, relative, "run/dataset-snapshot")
    try:
        snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError) as error:
        raise AutoQuantValidationError(
            [
                _issue(
                    snapshot_path,
                    "run.dataset-snapshot",
                    f"Cannot read the locked dataset snapshot: {error}",
                )
            ]
        ) from error
    if not isinstance(snapshot, dict) or snapshot.get("schemaVersion") not in {2, 3}:
        return None
    schema_version = snapshot["schemaVersion"]
    surface = snapshot.get("intervalSurface")
    if not isinstance(surface, dict):
        raise AutoQuantValidationError(
            [
                _issue(
                    snapshot_path,
                    "run.interval-surface",
                    "Multi-interval dataset snapshot is missing intervalSurface",
                )
            ]
        )
    try:
        expected = canonical_interval_surface(
            surface,
            schema_version=schema_version,
        )
    except IntervalContractError as error:
        raise AutoQuantValidationError(
            [_issue(snapshot_path, error.code, str(error))]
        ) from error
    if surface != expected:
        raise AutoQuantValidationError(
            [
                _issue(
                    snapshot_path,
                    "run.interval-surface",
                    "Dataset intervalSurface differs from canonical authority",
                )
            ]
        )
    return expected


def _validate_json_value(value: Any, path: str) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    if isinstance(value, bool) or value is None or isinstance(value, str):
        return issues
    if isinstance(value, (int, float)):
        if not math.isfinite(float(value)):
            issues.append(
                _issue(path, "judge.non-finite", "JSON numbers must be finite")
            )
        return issues
    if isinstance(value, list):
        for index, item in enumerate(value):
            issues.extend(_validate_json_value(item, f"{path}/{index}"))
        return issues
    if isinstance(value, dict):
        for key, item in value.items():
            if not isinstance(key, str):
                issues.append(
                    _issue(path, "judge.metric-key", "JSON object keys must be strings")
                )
                continue
            issues.extend(_validate_json_value(item, f"{path}/{key}"))
        return issues
    issues.append(
        _issue(path, "judge.json-value", f"Unsupported JSON value: {type(value).__name__}")
    )
    return issues


def _strict_keys(
    value: dict[str, Any],
    required: set[str],
    path: str,
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


def _artifact_files(root: Path) -> list[str]:
    files: list[str] = []
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            raise AutoQuantValidationError(
                [_issue(path, "path.symlink", "Judge artifacts cannot contain symlinks")]
            )
        if path.is_file():
            files.append(path.relative_to(root).as_posix())
    return files


def parse_judge_output(
    path: Path,
    artifacts_root: Path,
    primary_metric: str,
) -> dict[str, Any]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise AutoQuantValidationError(
            [_issue(path, "judge.output-missing", "Judge did not write its output JSON")]
        ) from None
    except json.JSONDecodeError as error:
        raise AutoQuantValidationError(
            [
                _issue(
                    path,
                    "judge.output-json",
                    f"Judge output is invalid JSON at line {error.lineno}, "
                    f"column {error.colno}: {error.msg}",
                )
            ]
        ) from None
    if not isinstance(raw, dict):
        raise AutoQuantValidationError(
            [_issue(path, "judge.output-type", "Judge output must be a JSON object")]
        )
    required = {
        "schema_version",
        "status",
        "summary",
        "metrics",
        "artifacts",
        "errors",
    }
    issues = _strict_keys(
        raw,
        required | (raw.keys() & {"failure_disposition"}),
        str(path),
    )
    if raw.get("schema_version") != JUDGE_OUTPUT_VERSION:
        issues.append(
            _issue(
                f"{path}/schema_version",
                "schema.version",
                f"Expected Judge output schema_version {JUDGE_OUTPUT_VERSION}",
            )
        )
    status = raw.get("status")
    if status not in {"succeeded", "failed"}:
        issues.append(
            _issue(
                f"{path}/status",
                "schema.choice",
                "Judge status must be 'succeeded' or 'failed'",
            )
        )
    summary = raw.get("summary")
    if not isinstance(summary, str) or not summary.strip():
        issues.append(
            _issue(f"{path}/summary", "schema.string", "Summary must be non-empty")
        )
    metrics = raw.get("metrics")
    if not isinstance(metrics, dict):
        issues.append(
            _issue(f"{path}/metrics", "schema.type", "Metrics must be a JSON object")
        )
        metrics = {}
    else:
        issues.extend(_validate_json_value(metrics, f"{path}/metrics"))
    primary_value = metrics.get(primary_metric)
    if status == "succeeded" and (
        not isinstance(primary_value, (int, float))
        or isinstance(primary_value, bool)
        or not math.isfinite(float(primary_value))
    ):
        issues.append(
            _issue(
                f"{path}/metrics/{primary_metric}",
                "judge.primary-metric",
                f"Successful Judge output requires finite primary metric '{primary_metric}'",
            )
        )

    artifacts_raw = raw.get("artifacts")
    artifacts: list[dict[str, str]] = []
    if not isinstance(artifacts_raw, list):
        issues.append(
            _issue(
                f"{path}/artifacts",
                "schema.array",
                "Artifacts must be an array",
            )
        )
    else:
        for index, item in enumerate(artifacts_raw):
            item_path = f"{path}/artifacts/{index}"
            if not isinstance(item, dict):
                issues.append(_issue(item_path, "schema.type", "Artifact must be an object"))
                continue
            issues.extend(
                _strict_keys(item, {"kind", "path", "description"}, item_path)
            )
            kind = item.get("kind")
            relative = item.get("path")
            description = item.get("description")
            if not isinstance(kind, str) or not kind.strip():
                issues.append(
                    _issue(f"{item_path}/kind", "schema.string", "Artifact kind must be non-empty")
                )
            if not isinstance(description, str):
                issues.append(
                    _issue(f"{item_path}/description", "schema.string", "Artifact description must be a string")
                )
            if not isinstance(relative, str) or not relative:
                issues.append(
                    _issue(f"{item_path}/path", "schema.path", "Artifact path must be relative")
                )
                continue
            candidate = PurePosixPath(relative)
            if (
                "\\" in relative
                or candidate.is_absolute()
                or ".." in candidate.parts
                or relative in {".", ".."}
            ):
                issues.append(
                    _issue(f"{item_path}/path", "schema.path", "Artifact path must be confined")
                )
                continue
            artifact_path = artifacts_root / relative
            if artifact_path.is_symlink() or not artifact_path.is_file():
                issues.append(
                    _issue(
                        f"{item_path}/path",
                        "judge.artifact-missing",
                        f"Declared artifact is not a real file: {relative}",
                    )
                )
                continue
            artifacts.append(
                {
                    "kind": kind,
                    "path": relative,
                    "description": description,
                }
            )
    declared = sorted(item["path"] for item in artifacts)
    actual = _artifact_files(artifacts_root)
    if declared != actual:
        issues.append(
            _issue(
                artifacts_root,
                "judge.artifact-inventory",
                f"Declared artifacts {declared} do not match written files {actual}",
            )
        )

    errors_raw = raw.get("errors")
    errors: list[dict[str, str]] = []
    if not isinstance(errors_raw, list):
        issues.append(
            _issue(f"{path}/errors", "schema.array", "Errors must be an array")
        )
    else:
        for index, item in enumerate(errors_raw):
            item_path = f"{path}/errors/{index}"
            if not isinstance(item, dict):
                issues.append(_issue(item_path, "schema.type", "Error must be an object"))
                continue
            issues.extend(_strict_keys(item, {"code", "message"}, item_path))
            code = item.get("code")
            message = item.get("message")
            if not isinstance(code, str) or not code.strip():
                issues.append(
                    _issue(f"{item_path}/code", "schema.string", "Error code must be non-empty")
                )
            if not isinstance(message, str) or not message.strip():
                issues.append(
                    _issue(f"{item_path}/message", "schema.string", "Error message must be non-empty")
                )
            if isinstance(code, str) and code.strip() and isinstance(message, str) and message.strip():
                errors.append({"code": code, "message": message})
    if status == "succeeded" and errors:
        issues.append(
            _issue(
                f"{path}/errors",
                "judge.success-errors",
                "Successful Judge output cannot contain errors",
            )
        )
    if status == "failed" and not errors:
        issues.append(
            _issue(
                f"{path}/errors",
                "judge.failure-errors",
                "Failed Judge output must explain at least one error",
            )
        )
    failure_disposition = raw.get("failure_disposition")
    if status == "succeeded" and failure_disposition is not None:
        issues.append(
            _issue(
                f"{path}/failure_disposition",
                "judge.success-disposition",
                "Successful Judge output cannot declare a failure disposition",
            )
        )
    if status == "failed" and failure_disposition is not None and (
        failure_disposition not in FAILURE_DISPOSITIONS
    ):
        issues.append(
            _issue(
                f"{path}/failure_disposition",
                "judge.failure-disposition",
                "Failure disposition must be scientific-limit or repair-required",
            )
        )
    if issues:
        raise AutoQuantValidationError(issues)
    return {
        "status": status,
        "summary": summary.strip(),
        "metrics": metrics,
        "artifacts": artifacts,
        "errors": errors,
        "failureDisposition": (
            failure_disposition or DEFAULT_FAILURE_DISPOSITION
            if status == "failed"
            else None
        ),
    }


def _materialize_execution_workspace(
    project: ProjectContext,
    study: StudyContext,
    destination: Path,
    *,
    upstream_project: ProjectContext,
) -> None:
    destination.mkdir(parents=True)
    shutil.copy2(project.root_dir / PROJECT_MANIFEST, destination / PROJECT_MANIFEST)
    combined = dict(study.judge_hashes)
    combined.update(study.editable_hashes)
    combined.update(study.dependency_hashes)
    copy_hashed_files(project, combined, destination)
    if study.definition.upstream_evidence is not None:
        materialize_upstream_evidence(
            upstream_project,
            study,
            destination / "upstream-evidence",
        )
    studies_directory = project.manifest.directories["studies"]
    staged_study = destination / studies_directory / study.definition.id
    staged_study.mkdir(parents=True)
    shutil.copy2(study.manifest_path, staged_study / "study.json")
    program_target = staged_study / study.definition.program
    program_target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(study.program_path, program_target)


def _freeze_inputs(
    project: ProjectContext,
    study: StudyContext,
    run_staging: Path,
    harness: dict[str, Any],
    run_input_hash: str,
    evaluation_role: str,
    *,
    upstream_project: ProjectContext,
) -> None:
    inputs = run_staging / "inputs"
    inputs.mkdir()
    shutil.copy2(study.manifest_path, inputs / "study.json")
    shutil.copy2(study.program_path, inputs / "program.md")
    copy_hashed_files(project, study.judge_hashes, inputs / "judge-sources")
    copy_hashed_files(project, study.editable_hashes, run_staging / "sources")
    if study.dependency_hashes:
        copy_hashed_files(
            project,
            study.dependency_hashes,
            inputs / "dependency-sources",
        )
    if study.definition.upstream_evidence is not None:
        materialize_upstream_evidence(
            upstream_project,
            study,
            inputs / "upstream-evidence",
        )
    identity = {
        "evaluationRole": evaluation_role,
        "studyHash": study.study_hash,
        "programHash": study.program_hash,
        "judgeHashes": study.judge_hashes,
        "judgeHash": study.judge_hash,
        "sourceHashes": study.editable_hashes,
        "sourceHash": study.source_hash,
        "datasetSourceHashes": study.dataset_hashes,
        "datasetHash": study.dataset_hash,
        "studyInputHash": study.input_hash,
        "harness": harness,
        "inputHash": run_input_hash,
    }
    if study.dependency_hash is not None:
        identity["dependencyHashes"] = study.dependency_hashes
        identity["dependencyHash"] = study.dependency_hash
    if study.upstream_evidence_hash is not None:
        identity["upstreamEvidenceHash"] = study.upstream_evidence_hash
    _write_json(
        inputs / "identity.json",
        identity,
    )
    if study.dataset_hashes:
        _write_json(inputs / "dataset-files.json", study.dataset_hashes)


def _text(value: str | bytes | None) -> str:
    if value is None:
        return ""
    if isinstance(value, bytes):
        return value.decode(errors="replace")
    return value


def _run_judge(
    project: ProjectContext,
    study: StudyContext,
    run_staging: Path,
    run_input_hash: str,
    data_root: Path,
    evaluation_role: str,
    *,
    upstream_project: ProjectContext,
) -> tuple[dict[str, Any], dict[str, Any]]:
    artifacts_root = run_staging / "artifacts"
    artifacts_root.mkdir()
    output_path = run_staging / JUDGE_OUTPUT
    with tempfile.TemporaryDirectory(prefix=f"aq-{study.definition.id}-") as directory:
        execution_root = Path(directory) / "project"
        _materialize_execution_workspace(
            project,
            study,
            execution_root,
            upstream_project=upstream_project,
        )
        command = [
            sys.executable,
            study.definition.judge.entrypoint,
            *study.definition.judge.arguments,
        ]
        environment = dict(os.environ)
        environment.update(
            {
                "AUTOQUANT_PROJECT_ROOT": str(execution_root),
                "AUTOQUANT_DATA_ROOT": str(data_root),
                "AUTOQUANT_STUDY_PATH": str(
                    execution_root
                    / project.manifest.directories["studies"]
                    / study.definition.id
                    / "study.json"
                ),
                "AUTOQUANT_RUN_OUTPUT": str(output_path),
                "AUTOQUANT_ARTIFACTS_DIR": str(artifacts_root),
                "AUTOQUANT_INPUT_HASH": run_input_hash,
                "AUTOQUANT_EVALUATION_ROLE": evaluation_role,
                "PYTHONPATH": os.pathsep.join(
                    filter(
                        None,
                        [str(execution_root), environment.get("PYTHONPATH", "")],
                    )
                ),
            }
        )
        if study.definition.upstream_evidence is not None:
            environment["AUTOQUANT_UPSTREAM_EVIDENCE_ROOT"] = str(
                execution_root / "upstream-evidence"
            )
        started = time.monotonic()
        exit_code: int | None = None
        timed_out = False
        stdout = ""
        stderr = ""
        execution_errors: list[dict[str, str]] = []
        try:
            completed = subprocess.run(
                command,
                cwd=execution_root,
                env=environment,
                capture_output=True,
                check=False,
                text=True,
                timeout=study.definition.judge.timeout_seconds,
            )
            exit_code = completed.returncode
            stdout = completed.stdout
            stderr = completed.stderr
            if exit_code != 0:
                execution_errors.append(
                    {
                        "code": "judge.exit",
                        "message": f"Python Judge exited with code {exit_code}",
                    }
                )
        except subprocess.TimeoutExpired as error:
            timed_out = True
            stdout = _text(error.stdout)
            stderr = _text(error.stderr)
            execution_errors.append(
                {
                    "code": "judge.timeout",
                    "message": (
                        "Python Judge exceeded "
                        f"{study.definition.judge.timeout_seconds} seconds"
                    ),
                }
            )
        except OSError as error:
            execution_errors.append(
                {"code": "judge.spawn", "message": str(error)}
            )
        duration_ms = int((time.monotonic() - started) * 1000)

    (run_staging / "stdout.txt").write_text(stdout, encoding="utf-8")
    (run_staging / "stderr.txt").write_text(stderr, encoding="utf-8")
    normalized: dict[str, Any]
    if execution_errors:
        normalized = {
            "status": "failed",
            "summary": execution_errors[0]["message"],
            "metrics": {},
            "artifacts": [],
            "errors": execution_errors,
            "failureDisposition": DEFAULT_FAILURE_DISPOSITION,
        }
    else:
        try:
            normalized = parse_judge_output(
                output_path,
                artifacts_root,
                study.definition.objective.metric,
            )
        except AutoQuantValidationError as error:
            normalized = {
                "status": "failed",
                "summary": "Python Judge produced invalid structured output",
                "metrics": {},
                "artifacts": [],
                "errors": [
                    {
                        "code": issue.code,
                        "message": f"{issue.path}: {issue.message}",
                    }
                    for issue in error.issues
                ],
                "failureDisposition": DEFAULT_FAILURE_DISPOSITION,
            }
    execution = {
        "kind": "python",
        "command": command,
        "evaluationRole": evaluation_role,
        "exitCode": exit_code,
        "timedOut": timed_out,
        "timeoutSeconds": study.definition.judge.timeout_seconds,
        "durationMs": duration_ms,
    }
    return normalized, execution


def _all_file_hashes(root: Path) -> dict[str, str]:
    hashes: dict[str, str] = {}
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            raise AutoQuantValidationError(
                [_issue(path, "path.symlink", "Run artifacts cannot contain symlinks")]
            )
        if path.is_file() and path != root / RUN_MANIFEST:
            hashes[path.relative_to(root).as_posix()] = hash_file(path)
    return hashes


def execute_study(
    project: ProjectContext,
    study_id: str,
    *,
    execution_project: ProjectContext | None = None,
    data_root: Path | None = None,
    holdout_authorized: bool = False,
) -> RunContext:
    from .holdouts import assert_run_authorized

    assert_run_authorized(
        project,
        holdout_authorized=holdout_authorized,
    )
    source_project = execution_project or project
    if source_project.manifest.id != project.manifest.id:
        raise AutoQuantValidationError(
            [
                _issue(
                    source_project.root_dir,
                    "run.project-identity",
                    "Execution Project id must match the owning Project",
                )
            ]
        )
    resolved_data_root = (
        data_root
        if data_root is not None
        else project.root_dir / project.manifest.directories["data"]
    )
    if data_root is not None:
        owning_data_root = confined_path(
            project.root_dir,
            project.manifest.directories["data"],
            "project/directories/data",
        )
        if resolved_data_root.absolute() != owning_data_root:
            raise AutoQuantValidationError(
                [
                    _issue(
                        resolved_data_root,
                        "run.data-root",
                        "Explicit Run data root must be the owning Project data directory",
                    )
                ]
            )
    if resolved_data_root.is_symlink() or not resolved_data_root.is_dir():
        raise AutoQuantValidationError(
            [
                _issue(
                    resolved_data_root,
                    "run.data-root",
                    "Run data root must be a real directory",
                )
            ]
        )
    study = load_study(
        source_project,
        study_id,
        data_root=resolved_data_root,
        upstream_project=project if execution_project is not None else None,
    )
    dataset_interval_surface = _dataset_interval_surface(
        study,
        resolved_data_root,
    )
    if execution_project is not None:
        owning_study = load_study(project, study_id, data_root=resolved_data_root)
        fixed_identity = {
            "studyHash": (study.study_hash, owning_study.study_hash),
            "programHash": (study.program_hash, owning_study.program_hash),
            "judgeHash": (study.judge_hash, owning_study.judge_hash),
            "dependencyHash": (
                study.dependency_hash,
                owning_study.dependency_hash,
            ),
            "upstreamEvidenceHash": (
                study.upstream_evidence_hash,
                owning_study.upstream_evidence_hash,
            ),
            "datasetHash": (study.dataset_hash, owning_study.dataset_hash),
        }
        changed = [
            key
            for key, (execution_value, owning_value) in fixed_identity.items()
            if execution_value != owning_value
        ]
        if changed:
            raise AutoQuantValidationError(
                [
                    _issue(
                        source_project.root_dir,
                        "run.fixed-input-stale",
                        "Execution Project fixed Study inputs differ from the owning "
                        f"Project: {', '.join(changed)}",
                    )
                ]
            )
    harness = harness_identity()
    evaluation_role = (
        HOLDOUT_EVALUATION_ROLE
        if holdout_authorized
        else RESEARCH_EVALUATION_ROLE
    )
    run_input_hash = hash_json(
        {
            "studyInputHash": study.input_hash,
            "harness": harness,
            "evaluationRole": evaluation_role,
        }
    )
    runs_root = confined_path(
        project.root_dir,
        project.manifest.directories["runs"],
        "project/directories/runs",
    )
    started = datetime.now(timezone.utc)
    started_at = started.isoformat()
    temporary = runs_root / f".run-{uuid.uuid4().hex}"
    temporary.mkdir()
    try:
        _freeze_inputs(
            source_project,
            study,
            temporary,
            harness,
            run_input_hash,
            evaluation_role,
            upstream_project=project,
        )
        normalized, execution = _run_judge(
            source_project,
            study,
            temporary,
            run_input_hash,
            resolved_data_root,
            evaluation_role,
            upstream_project=project,
        )
        completed = datetime.now(timezone.utc)
        completed_at = completed.isoformat()
        output_identity = hash_json(
            {
                "status": normalized["status"],
                "metrics": normalized["metrics"],
                "summary": normalized["summary"],
                "errors": normalized["errors"],
                "failureDisposition": normalized.get("failureDisposition"),
            }
        )
        stamp = started.strftime("%Y%m%dT%H%M%S%fZ")
        run_hash = hash_json(
            {
                "startedAt": started_at,
                "inputHash": run_input_hash,
                "outputIdentity": output_identity,
            }
        )
        run_id = f"run-{stamp}-{run_hash[:12]}"
        target = runs_root / run_id
        if target.exists() or target.is_symlink():
            raise AutoQuantValidationError(
                [_issue(target, "run.collision", f"Run id collision: {run_id}")]
            )
        artifacts = [
            {
                **item,
                "path": f"artifacts/{item['path']}",
                "immutable": True,
            }
            for item in normalized["artifacts"]
        ]
        result = {
            "schemaVersion": RUN_SCHEMA_VERSION,
            "id": run_id,
            "status": normalized["status"],
            "summary": normalized["summary"],
            "startedAt": started_at,
            "completedAt": completed_at,
            "durationMs": execution["durationMs"],
            "inputHash": run_input_hash,
            "studyInputHash": study.input_hash,
            "harness": harness,
            "project": {
                "id": project.manifest.id,
                "name": project.manifest.name,
            },
            "study": {
                "id": study.definition.id,
                "name": study.definition.name,
                "hash": study.study_hash,
                "programHash": study.program_hash,
            },
            "subject": {
                **asdict_study_subject(study),
                "sourceHash": study.source_hash,
                "sourcePaths": sorted(study.editable_hashes),
            },
            "dataset": {
                **study.definition.to_dict()["dataset"],
                "hash": study.dataset_hash,
                **(
                    {"intervalSurface": dataset_interval_surface}
                    if dataset_interval_surface is not None
                    else {}
                ),
                **(
                    {"sourceHashes": study.dataset_hashes}
                    if study.definition.dataset.paths is not None
                    else {}
                ),
            },
            "judge": {
                "kind": study.definition.judge.kind,
                "entrypoint": study.definition.judge.entrypoint,
                "hash": study.judge_hash,
                "sourceHashes": study.judge_hashes,
            },
            "objective": asdict_study_objective(study),
            "execution": execution,
            "metrics": normalized["metrics"],
            "artifacts": artifacts,
            "errors": normalized["errors"],
        }
        if normalized["status"] == "failed":
            result["failureDisposition"] = normalized.get(
                "failureDisposition",
                DEFAULT_FAILURE_DISPOSITION,
            )
        if study.dependency_hash is not None:
            result["dependencies"] = {
                "paths": study.definition.dependencies["paths"],
                "hash": study.dependency_hash,
                "sourceHashes": study.dependency_hashes,
            }
        if study.definition.research_request is not None:
            request = study.definition.research_request
            result["researchRequest"] = {
                "path": request.path,
                "sha256": study.dependency_hashes[request.path],
                **(
                    {
                        "positionSnapshotPath": request.position_snapshot_path,
                        "positionSnapshotSha256": study.dependency_hashes[
                            request.position_snapshot_path
                        ],
                    }
                    if request.position_snapshot_path is not None
                    else {}
                ),
            }
        if study.definition.upstream_evidence is not None:
            upstream = study.definition.to_dict()["upstream_evidence"]
            result["upstreamEvidence"] = {
                **upstream,
                "hash": study.upstream_evidence_hash,
                "inputRoot": (
                    f"inputs/upstream-evidence/{upstream['run_id']}"
                ),
            }
        _write_json(temporary / RUN_RESULT, result)
        files = _all_file_hashes(temporary)
        manifest = {
            "schemaVersion": RUN_SCHEMA_VERSION,
            "id": run_id,
            "status": result["status"],
            "completed": True,
            "startedAt": started_at,
            "completedAt": completed_at,
            "inputHash": run_input_hash,
            "resultHash": files[RUN_RESULT],
            "files": files,
        }
        _write_json(temporary / RUN_MANIFEST, manifest)
        os.replace(temporary, target)
        return load_run(project, run_id)
    except Exception:
        if temporary.exists():
            shutil.rmtree(temporary)
        raise


def asdict_study_subject(study: StudyContext) -> dict[str, Any]:
    return {
        "kind": study.definition.subject.kind,
        "name": study.definition.subject.name,
        "version": study.definition.subject.version,
    }


def asdict_study_objective(study: StudyContext) -> dict[str, Any]:
    return {
        "metric": study.definition.objective.metric,
        "direction": study.definition.objective.direction,
        "minimumImprovement": study.definition.objective.minimum_improvement,
    }


def _read_json_object(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError) as error:
        raise AutoQuantValidationError(
            [_issue(path, "run.json", f"Cannot read immutable Run JSON: {error}")]
        ) from None
    if not isinstance(value, dict):
        raise AutoQuantValidationError(
            [_issue(path, "run.json", "Immutable Run JSON must be an object")]
        )
    return value


def _validate_run_result(
    result: dict[str, Any],
    path: Path,
    *,
    expected_id: str,
    expected_status: Any,
    expected_input_hash: Any,
) -> None:
    required = {
        "schemaVersion",
        "id",
        "status",
        "summary",
        "startedAt",
        "completedAt",
        "durationMs",
        "inputHash",
        "studyInputHash",
        "harness",
        "project",
        "study",
        "subject",
        "dataset",
        "judge",
        "objective",
        "execution",
        "metrics",
        "artifacts",
        "errors",
    }
    allowed = required | (
        result.keys()
        & {
            "dependencies",
            "researchRequest",
            "upstreamEvidence",
            "failureDisposition",
        }
    )
    issues = _strict_keys(result, allowed, str(path))
    if result.get("schemaVersion") != RUN_SCHEMA_VERSION:
        issues.append(
            _issue(
                f"{path}/schemaVersion",
                "schema.version",
                f"Expected RunResult schemaVersion {RUN_SCHEMA_VERSION}",
            )
        )
    if result.get("id") != expected_id:
        issues.append(
            _issue(f"{path}/id", "run.result-id", "RunResult id must match its Run")
        )
    status = result.get("status")
    if status not in {"succeeded", "failed"} or status != expected_status:
        issues.append(
            _issue(
                f"{path}/status",
                "run.result-status",
                "RunResult status must be succeeded or failed and match its manifest",
            )
        )
    failure_disposition = result.get("failureDisposition")
    if status == "succeeded" and failure_disposition is not None:
        issues.append(
            _issue(
                f"{path}/failureDisposition",
                "run.success-disposition",
                "Successful RunResult cannot declare a failure disposition",
            )
        )
    if failure_disposition is not None and (
        failure_disposition not in FAILURE_DISPOSITIONS
    ):
        issues.append(
            _issue(
                f"{path}/failureDisposition",
                "run.failure-disposition",
                "Failure disposition must be scientific-limit or repair-required",
            )
        )
    if result.get("inputHash") != expected_input_hash:
        issues.append(
            _issue(
                f"{path}/inputHash",
                "run.input-hash",
                "RunResult inputHash must match its manifest",
            )
        )
    for key in ("inputHash", "studyInputHash"):
        if not isinstance(result.get(key), str) or not SHA256.fullmatch(result[key]):
            issues.append(
                _issue(f"{path}/{key}", "run.hash", f"{key} must be a SHA-256 hash")
            )
    if not isinstance(result.get("summary"), str) or not result["summary"].strip():
        issues.append(
            _issue(f"{path}/summary", "schema.string", "Summary must be non-empty")
        )
    duration = result.get("durationMs")
    if not isinstance(duration, int) or isinstance(duration, bool) or duration < 0:
        issues.append(
            _issue(
                f"{path}/durationMs",
                "schema.number",
                "durationMs must be a non-negative integer",
            )
        )

    object_keys = {
        "harness": {"id", "version", "commit", "dirty", "sourceHash", "python"},
        "project": {"id", "name"},
        "study": {"id", "name", "hash", "programHash"},
        "subject": {
            "kind",
            "name",
            "version",
            "sourceHash",
            "sourcePaths",
        },
        "judge": {"kind", "entrypoint", "hash", "sourceHashes"},
        "objective": {"metric", "direction", "minimumImprovement"},
        "execution": {
            "kind",
            "command",
            "exitCode",
            "timedOut",
            "timeoutSeconds",
            "durationMs",
        },
    }
    for key, nested_required in object_keys.items():
        value = result.get(key)
        if not isinstance(value, dict):
            issues.append(
                _issue(f"{path}/{key}", "schema.type", f"{key} must be an object")
            )
            continue
        allowed = set(nested_required)
        if key == "harness" and "buildProvenance" in value:
            allowed.add("buildProvenance")
        if key == "execution" and "evaluationRole" in value:
            allowed.add("evaluationRole")
        issues.extend(_strict_keys(value, allowed, f"{path}/{key}"))
        if (
            key == "execution"
            and "evaluationRole" in value
            and value["evaluationRole"]
            not in {RESEARCH_EVALUATION_ROLE, HOLDOUT_EVALUATION_ROLE}
        ):
            issues.append(
                _issue(
                    f"{path}/execution/evaluationRole",
                    "run.evaluation-role",
                    "Unknown Run evaluation role",
                )
            )
        if (
            key == "harness"
            and "buildProvenance" in value
            and value["buildProvenance"]
            not in {
                "embedded-distribution",
                "source-checkout",
                "unavailable",
            }
        ):
            issues.append(
                _issue(
                    f"{path}/harness/buildProvenance",
                    "run.harness-provenance",
                    "Invalid Harness build provenance",
                )
            )

    dataset = result.get("dataset")
    if not isinstance(dataset, dict):
        issues.append(
            _issue(f"{path}/dataset", "schema.type", "dataset must be an object")
        )
    else:
        dataset_required = {
            "id",
            "version",
            "asset_class",
            "universe",
            "time_range",
            "hash",
        }
        issues.extend(
            _strict_keys(
                dataset,
                dataset_required
                | (
                    dataset.keys()
                    & {"paths", "sourceHashes", "intervalSurface"}
                ),
                f"{path}/dataset",
            )
        )
        if not isinstance(dataset.get("hash"), str) or not SHA256.fullmatch(
            dataset.get("hash", "")
        ):
            issues.append(
                _issue(
                    f"{path}/dataset/hash",
                    "run.hash",
                    "Dataset hash must be a SHA-256 hash",
                )
            )
        paths = dataset.get("paths")
        if paths is not None and (
            not isinstance(paths, list)
            or not paths
            or not all(isinstance(pattern, str) and pattern for pattern in paths)
        ):
            issues.append(
                _issue(
                    f"{path}/dataset/paths",
                    "run.dataset-paths",
                    "Dataset paths must be a non-empty array of strings",
                )
            )
        source_hashes = dataset.get("sourceHashes")
        if ("paths" in dataset) != ("sourceHashes" in dataset):
            issues.append(
                _issue(
                    f"{path}/dataset",
                    "run.dataset-lock",
                    "Dataset paths and sourceHashes must appear together",
                )
            )
        if source_hashes is not None:
            if not isinstance(source_hashes, dict) or not all(
                isinstance(relative, str)
                and relative
                and "\\" not in relative
                and not PurePosixPath(relative).is_absolute()
                and ".." not in PurePosixPath(relative).parts
                and isinstance(content_hash, str)
                and SHA256.fullmatch(content_hash)
                for relative, content_hash in source_hashes.items()
            ) or not source_hashes:
                issues.append(
                    _issue(
                        f"{path}/dataset/sourceHashes",
                        "run.dataset-hashes",
                        "Dataset sourceHashes must map relative paths to SHA-256 hashes",
                    )
                )
        surface = dataset.get("intervalSurface")
        if surface is not None:
            if not isinstance(surface, dict):
                issues.append(
                    _issue(
                        f"{path}/dataset/intervalSurface",
                        "schema.type",
                        "intervalSurface must be an object",
                    )
                )
            else:
                try:
                    expected = canonical_interval_surface(
                        surface,
                        schema_version=(
                            3 if "calendar" in surface else 2
                        ),
                    )
                    if surface != expected:
                        issues.append(
                            _issue(
                                f"{path}/dataset/intervalSurface",
                                "run.interval-surface",
                                "Run intervalSurface differs from fixed authority",
                            )
                        )
                except IntervalContractError as error:
                    issues.append(
                        _issue(
                            f"{path}/dataset/intervalSurface",
                            error.code,
                            str(error),
                        )
                    )

    dependencies = result.get("dependencies")
    if dependencies is not None:
        if not isinstance(dependencies, dict):
            issues.append(
                _issue(
                    f"{path}/dependencies",
                    "schema.type",
                    "dependencies must be an object",
                )
            )
        else:
            issues.extend(
                _strict_keys(
                    dependencies,
                    {"paths", "hash", "sourceHashes"},
                    f"{path}/dependencies",
                )
            )
            dependency_paths = dependencies.get("paths")
            dependency_hashes = dependencies.get("sourceHashes")
            if (
                not isinstance(dependency_paths, list)
                or not dependency_paths
                or not all(
                    isinstance(pattern, str) and pattern
                    for pattern in dependency_paths
                )
            ):
                issues.append(
                    _issue(
                        f"{path}/dependencies/paths",
                        "run.dependency-paths",
                        "Dependency paths must be a non-empty array of strings",
                    )
                )
            if (
                not isinstance(dependency_hashes, dict)
                or not dependency_hashes
                or not all(
                    isinstance(relative, str)
                    and relative
                    and "\\" not in relative
                    and not PurePosixPath(relative).is_absolute()
                    and ".." not in PurePosixPath(relative).parts
                    and isinstance(content_hash, str)
                    and SHA256.fullmatch(content_hash)
                    for relative, content_hash in dependency_hashes.items()
                )
            ):
                issues.append(
                    _issue(
                        f"{path}/dependencies/sourceHashes",
                        "run.dependency-hashes",
                        "Dependency sourceHashes must map confined paths to SHA-256 hashes",
                    )
                )
            elif dependencies.get("hash") != hash_json(
                dict(sorted(dependency_hashes.items()))
            ):
                issues.append(
                    _issue(
                        f"{path}/dependencies/hash",
                        "run.dependency-hash",
                        "Dependency hash does not match sourceHashes",
                    )
                )

    research_request = result.get("researchRequest")
    if research_request is not None:
        if not isinstance(research_request, dict):
            issues.append(
                _issue(
                    f"{path}/researchRequest",
                    "schema.type",
                    "researchRequest must be an object",
                )
            )
        else:
            required_request = {"path", "sha256"}
            if (
                "positionSnapshotPath" in research_request
                or "positionSnapshotSha256" in research_request
            ):
                required_request |= {
                    "positionSnapshotPath",
                    "positionSnapshotSha256",
                }
            issues.extend(
                _strict_keys(
                    research_request,
                    required_request,
                    f"{path}/researchRequest",
                )
            )
            for key in ("sha256", "positionSnapshotSha256"):
                if key in research_request and (
                    not isinstance(research_request[key], str)
                    or not SHA256.fullmatch(research_request[key])
                ):
                    issues.append(
                        _issue(
                            f"{path}/researchRequest/{key}",
                            "run.hash",
                            f"{key} must be a SHA-256 hash",
                        )
                    )
            for key in ("path", "positionSnapshotPath"):
                if key not in research_request:
                    continue
                value = research_request[key]
                candidate = PurePosixPath(value) if isinstance(value, str) else None
                if (
                    not isinstance(value, str)
                    or not value
                    or "\\" in value
                    or candidate is None
                    or candidate.is_absolute()
                    or ".." in candidate.parts
                ):
                    issues.append(
                        _issue(
                            f"{path}/researchRequest/{key}",
                            "run.request-path",
                            f"{key} must be a confined Project-relative path",
                        )
                    )

    upstream = result.get("upstreamEvidence")
    if upstream is not None:
        if not isinstance(upstream, dict):
            issues.append(
                _issue(
                    f"{path}/upstreamEvidence",
                    "schema.type",
                    "upstreamEvidence must be an object",
                )
            )
        else:
            issues.extend(
                _strict_keys(
                    upstream,
                    {
                        "run_id",
                        "study_id",
                        "result_hash",
                        "study_input_hash",
                        "artifacts",
                        "hash",
                        "inputRoot",
                    },
                    f"{path}/upstreamEvidence",
                )
            )
            identity = {
                key: upstream.get(key)
                for key in (
                    "run_id",
                    "study_id",
                    "result_hash",
                    "study_input_hash",
                    "artifacts",
                )
            }
            run_id = upstream.get("run_id")
            study_id = upstream.get("study_id")
            artifacts = upstream.get("artifacts")
            for key in ("result_hash", "study_input_hash", "hash"):
                value = upstream.get(key)
                if not isinstance(value, str) or not SHA256.fullmatch(value):
                    issues.append(
                        _issue(
                            f"{path}/upstreamEvidence/{key}",
                            "run.hash",
                            f"{key} must be a SHA-256 hash",
                        )
                    )
            if (
                not isinstance(run_id, str)
                or not run_id.startswith("run-")
                or "/" in run_id
                or "\\" in run_id
                or ".." in run_id
            ):
                issues.append(
                    _issue(
                        f"{path}/upstreamEvidence/run_id",
                        "run.upstream-id",
                        "Upstream run_id must be a confined immutable Run id",
                    )
                )
            if not isinstance(study_id, str) or not study_id:
                issues.append(
                    _issue(
                        f"{path}/upstreamEvidence/study_id",
                        "run.upstream-study",
                        "Upstream study_id must be a non-empty string",
                    )
                )
            if (
                not isinstance(artifacts, list)
                or not artifacts
                or not all(
                    isinstance(item, dict)
                    and set(item) == {"path", "sha256"}
                    and isinstance(item["path"], str)
                    and item["path"].startswith("artifacts/")
                    and "\\" not in item["path"]
                    and not PurePosixPath(item["path"]).is_absolute()
                    and ".." not in PurePosixPath(item["path"]).parts
                    and isinstance(item["sha256"], str)
                    and SHA256.fullmatch(item["sha256"])
                    for item in artifacts
                )
            ):
                issues.append(
                    _issue(
                        f"{path}/upstreamEvidence/artifacts",
                        "run.upstream-artifacts",
                        "Upstream artifacts must be exact confined artifact/hash pairs",
                    )
                )
            elif len({item["path"] for item in artifacts}) != len(artifacts):
                issues.append(
                    _issue(
                        f"{path}/upstreamEvidence/artifacts",
                        "run.upstream-artifacts",
                        "Upstream artifact paths must be unique",
                    )
                )
            if upstream.get("hash") != hash_json(identity):
                issues.append(
                    _issue(
                        f"{path}/upstreamEvidence/hash",
                        "run.upstream-hash",
                        "Upstream evidence hash differs from its fixed identity",
                    )
                )
            expected_root = (
                f"inputs/upstream-evidence/{run_id}"
                if isinstance(run_id, str)
                else None
            )
            if upstream.get("inputRoot") != expected_root:
                issues.append(
                    _issue(
                        f"{path}/upstreamEvidence/inputRoot",
                        "run.upstream-root",
                        "Upstream inputRoot is not derived from its Run id",
                    )
                )

    metrics = result.get("metrics")
    if not isinstance(metrics, dict):
        issues.append(
            _issue(f"{path}/metrics", "schema.type", "Metrics must be an object")
        )
        metrics = {}
    else:
        issues.extend(_validate_json_value(metrics, f"{path}/metrics"))
    objective = result.get("objective")
    primary_metric = objective.get("metric") if isinstance(objective, dict) else None
    primary_value = metrics.get(primary_metric) if isinstance(primary_metric, str) else None
    if status == "succeeded" and (
        not isinstance(primary_value, (int, float))
        or isinstance(primary_value, bool)
        or not math.isfinite(float(primary_value))
    ):
        issues.append(
            _issue(
                f"{path}/metrics/{primary_metric}",
                "run.primary-metric",
                "Successful RunResult requires its finite primary metric",
            )
        )
    for key in ("artifacts", "errors"):
        if not isinstance(result.get(key), list):
            issues.append(
                _issue(f"{path}/{key}", "schema.type", f"{key} must be an array")
            )
    errors = result.get("errors")
    if status == "succeeded" and isinstance(errors, list) and errors:
        issues.append(
            _issue(f"{path}/errors", "run.success-errors", "Successful RunResult cannot contain errors")
        )
    if status == "failed" and isinstance(errors, list) and not errors:
        issues.append(
            _issue(f"{path}/errors", "run.failure-errors", "Failed RunResult must explain an error")
        )
    if issues:
        raise AutoQuantValidationError(issues)


def _runs_root(project: ProjectContext) -> Path:
    return confined_path(
        project.root_dir,
        project.manifest.directories["runs"],
        "project/directories/runs",
    )


def load_run(project: ProjectContext, run_id: str) -> RunContext:
    if not run_id.startswith("run-") or "/" in run_id or "\\" in run_id or ".." in run_id:
        raise AutoQuantValidationError(
            [_issue(run_id, "run.id", "Invalid Run id")]
        )
    root = confined_path(_runs_root(project), run_id, f"run/{run_id}")
    if root.is_symlink() or not root.is_dir():
        raise AutoQuantValidationError(
            [_issue(root, "run.missing", f"Unknown immutable Run: {run_id}")]
        )
    manifest = _read_json_object(root / RUN_MANIFEST)
    required = {
        "schemaVersion",
        "id",
        "status",
        "completed",
        "startedAt",
        "completedAt",
        "inputHash",
        "resultHash",
        "files",
    }
    issues = _strict_keys(manifest, required, str(root / RUN_MANIFEST))
    if manifest.get("schemaVersion") != RUN_SCHEMA_VERSION:
        issues.append(
            _issue(
                f"{root / RUN_MANIFEST}/schemaVersion",
                "schema.version",
                f"Expected Run schemaVersion {RUN_SCHEMA_VERSION}",
            )
        )
    if manifest.get("id") != run_id:
        issues.append(
            _issue(
                f"{root / RUN_MANIFEST}/id",
                "run.directory-id",
                "Run manifest id must match its directory",
            )
        )
    if manifest.get("completed") is not True:
        issues.append(
            _issue(root / RUN_MANIFEST, "run.incomplete", "Run is not completed")
        )
    files = manifest.get("files")
    if not isinstance(files, dict) or not all(
        isinstance(path, str) and isinstance(value, str)
        for path, value in files.items()
    ):
        issues.append(
            _issue(
                f"{root / RUN_MANIFEST}/files",
                "run.files",
                "Run file hashes must be a string map",
            )
        )
        files = {}
    actual_files = _all_file_hashes(root)
    if files != actual_files:
        issues.append(
            _issue(
                root,
                "run.tampered",
                "Immutable Run files do not match the terminal manifest",
            )
        )
    if files.get(RUN_RESULT) != manifest.get("resultHash"):
        issues.append(
            _issue(
                root / RUN_RESULT,
                "run.result-hash",
                "RunResult hash does not match the terminal manifest",
            )
        )
    if issues:
        raise AutoQuantValidationError(issues)
    result = _read_json_object(root / RUN_RESULT)
    _validate_run_result(
        result,
        root / RUN_RESULT,
        expected_id=run_id,
        expected_status=manifest.get("status"),
        expected_input_hash=manifest.get("inputHash"),
    )
    frozen_issues: list[ValidationIssue] = []
    research_request = result.get("researchRequest")
    if isinstance(research_request, dict):
        request_pairs = [(research_request.get("path"), research_request.get("sha256"))]
        if "positionSnapshotPath" in research_request:
            request_pairs.append(
                (
                    research_request.get("positionSnapshotPath"),
                    research_request.get("positionSnapshotSha256"),
                )
            )
        for relative, expected_hash in request_pairs:
            frozen = root / "inputs" / "dependency-sources" / str(relative)
            if not frozen.is_file() or hash_file(frozen) != expected_hash:
                frozen_issues.append(
                    _issue(
                        frozen,
                        "run.request-input",
                        "Frozen Study request input differs from RunResult",
                    )
                )
    upstream = result.get("upstreamEvidence")
    if isinstance(upstream, dict):
        input_root = root / str(upstream["inputRoot"])
        expected_binding = {
            key: upstream[key]
            for key in (
                "run_id",
                "study_id",
                "result_hash",
                "study_input_hash",
                "artifacts",
            )
        }
        expected_binding["evidence_hash"] = upstream["hash"]
        binding_path = input_root / "binding.json"
        try:
            binding = _read_json_object(binding_path)
        except AutoQuantValidationError as error:
            frozen_issues.extend(error.issues)
        else:
            if binding != expected_binding:
                frozen_issues.append(
                    _issue(
                        binding_path,
                        "run.upstream-binding",
                        "Frozen upstream binding differs from RunResult",
                    )
                )
        for item in upstream["artifacts"]:
            frozen = input_root / item["path"]
            if not frozen.is_file() or hash_file(frozen) != item["sha256"]:
                frozen_issues.append(
                    _issue(
                        frozen,
                        "run.upstream-artifact",
                        "Frozen upstream artifact differs from RunResult",
                    )
                )
    if frozen_issues:
        raise AutoQuantValidationError(frozen_issues)
    return RunContext(root, manifest, result)


def list_runs(project: ProjectContext, study_id: str | None = None) -> list[RunSummary]:
    summaries: list[RunSummary] = []
    for entry in sorted(_runs_root(project).iterdir(), key=lambda path: path.name):
        if entry.name.startswith("."):
            continue
        if entry.is_symlink() or not entry.is_dir():
            raise AutoQuantValidationError(
                [_issue(entry, "run.entry", "Run entries must be real directories")]
            )
        if not (entry / RUN_MANIFEST).is_file():
            continue
        run = load_run(project, entry.name)
        if study_id and run.result["study"]["id"] != study_id:
            continue
        metric = run.result["objective"]["metric"]
        value = run.result["metrics"].get(metric)
        summaries.append(
            RunSummary(
                id=run.result["id"],
                status=run.result["status"],
                failure_disposition=run_failure_disposition(run.result),
                study_id=run.result["study"]["id"],
                subject_kind=run.result["subject"]["kind"],
                subject_name=run.result["subject"]["name"],
                primary_metric=metric,
                primary_value=float(value)
                if isinstance(value, (int, float)) and not isinstance(value, bool)
                else None,
                started_at=run.result["startedAt"],
                duration_ms=run.result["durationMs"],
                path=str(run.root_dir),
            )
        )
    return summaries


JUDGE_OUTPUT_JSON_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "AutoQuant Python Judge output",
    "type": "object",
    "additionalProperties": False,
    "required": [
        "schema_version",
        "status",
        "summary",
        "metrics",
        "artifacts",
        "errors",
    ],
    "properties": {
        "schema_version": {"const": JUDGE_OUTPUT_VERSION},
        "status": {"enum": ["succeeded", "failed"]},
        "failure_disposition": {
            "enum": ["scientific-limit", "repair-required"]
        },
        "summary": {"type": "string", "minLength": 1},
        "metrics": {"type": "object"},
        "artifacts": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["kind", "path", "description"],
                "properties": {
                    "kind": {"type": "string", "minLength": 1},
                    "path": {"type": "string", "minLength": 1},
                    "description": {"type": "string"},
                },
            },
        },
        "errors": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["code", "message"],
                "properties": {
                    "code": {"type": "string", "minLength": 1},
                    "message": {"type": "string", "minLength": 1},
                },
            },
        },
    },
}


RUN_RESULT_JSON_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "AutoQuant immutable RunResult",
    "type": "object",
    "additionalProperties": False,
    "required": [
        "schemaVersion",
        "id",
        "status",
        "summary",
        "startedAt",
        "completedAt",
        "durationMs",
        "inputHash",
        "studyInputHash",
        "harness",
        "project",
        "study",
        "subject",
        "dataset",
        "judge",
        "objective",
        "execution",
        "metrics",
        "artifacts",
        "errors",
    ],
    "properties": {
        "schemaVersion": {"const": RUN_SCHEMA_VERSION},
        "id": {"type": "string", "pattern": "^run-"},
        "status": {"enum": ["succeeded", "failed"]},
        "failureDisposition": {
            "enum": ["scientific-limit", "repair-required"]
        },
        "summary": {"type": "string", "minLength": 1},
        "startedAt": {"type": "string", "format": "date-time"},
        "completedAt": {"type": "string", "format": "date-time"},
        "durationMs": {"type": "integer", "minimum": 0},
        "inputHash": {"type": "string", "pattern": "^[0-9a-f]{64}$"},
        "studyInputHash": {"type": "string", "pattern": "^[0-9a-f]{64}$"},
        "harness": {
            "type": "object",
            "additionalProperties": False,
            "required": ["id", "version", "commit", "dirty", "sourceHash", "python"],
            "properties": {
                "id": {"type": "string", "minLength": 1},
                "version": {"type": "string", "minLength": 1},
                "commit": {"type": "string", "minLength": 1},
                "dirty": {"type": "boolean"},
                "buildProvenance": {
                    "enum": [
                        "embedded-distribution",
                        "source-checkout",
                        "unavailable",
                    ]
                },
                "sourceHash": {"type": "string", "pattern": "^[0-9a-f]{64}$"},
                "python": {"type": "string", "minLength": 1},
            },
        },
        "project": {"type": "object"},
        "study": {"type": "object"},
        "subject": {"type": "object"},
        "dataset": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "id",
                "version",
                "asset_class",
                "universe",
                "time_range",
                "hash",
            ],
            "properties": {
                "id": {"type": "string", "minLength": 1},
                "version": {"type": "string", "minLength": 1},
                "asset_class": {"type": "string", "minLength": 1},
                "universe": {
                    "type": "array",
                    "minItems": 1,
                    "items": {"type": "string", "minLength": 1},
                },
                "time_range": {"type": "object"},
                "paths": {
                    "type": "array",
                    "minItems": 1,
                    "items": {"type": "string", "minLength": 1},
                },
                "sourceHashes": {
                    "type": "object",
                    "additionalProperties": {
                        "type": "string",
                        "pattern": "^[0-9a-f]{64}$",
                    },
                },
                "intervalSurface": {
                    "oneOf": [
                        {
                            "type": "object",
                            "additionalProperties": False,
                            "required": [
                                "baseInterval",
                                "featureIntervals",
                                "timestampSemantics",
                                "marketClock",
                                "timezone",
                                "anchor",
                                "aggregationMethod",
                            ],
                            "properties": {
                                "baseInterval": {"const": BASE_INTERVAL},
                                "featureIntervals": {
                                    "type": "array",
                                    "minItems": 1,
                                    "uniqueItems": True,
                                    "items": {
                                        "enum": list(
                                            SUPPORTED_FEATURE_INTERVALS
                                        )
                                    },
                                },
                                "timestampSemantics": {
                                    "const": "bar-close"
                                },
                                "marketClock": {
                                    "const": "continuous"
                                },
                                "timezone": {"const": "UTC"},
                                "anchor": {"const": "00:00"},
                                "aggregationMethod": {
                                    "const": AGGREGATION_METHOD
                                },
                            },
                        },
                        {
                            "type": "object",
                            "additionalProperties": False,
                            "required": [
                                "baseInterval",
                                "featureIntervals",
                                "timestampSemantics",
                                "marketClock",
                                "calendar",
                                "timezone",
                                "anchor",
                                "aggregationMethod",
                                "terminalBucketPolicy",
                            ],
                            "properties": {
                                "baseInterval": {
                                    "enum": list(SUPPORTED_BASE_INTERVALS)
                                },
                                "featureIntervals": {
                                    "type": "array",
                                    "minItems": 1,
                                    "uniqueItems": True,
                                    "items": {
                                        "enum": list(SUPPORTED_INTERVALS)
                                    },
                                },
                                "timestampSemantics": {
                                    "const": "bar-close"
                                },
                                "marketClock": {
                                    "enum": ["continuous", "session"]
                                },
                                "calendar": {
                                    "enum": ["24/7", "XNYS"]
                                },
                                "timezone": {
                                    "enum": ["UTC", "America/New_York"]
                                },
                                "anchor": {
                                    "enum": ["00:00", "market-open"]
                                },
                                "aggregationMethod": {
                                    "enum": [
                                        CONTINUOUS_AGGREGATION_METHOD,
                                        XNYS_AGGREGATION_METHOD,
                                    ]
                                },
                                "terminalBucketPolicy": {
                                    "enum": [
                                        CONTINUOUS_TERMINAL_POLICY,
                                        SESSION_TERMINAL_POLICY,
                                    ]
                                },
                            },
                        },
                    ],
                },
                "hash": {"type": "string", "pattern": "^[0-9a-f]{64}$"},
            },
            "dependentRequired": {
                "paths": ["sourceHashes"],
                "sourceHashes": ["paths"],
            },
        },
        "dependencies": {
            "type": "object",
            "additionalProperties": False,
            "required": ["paths", "hash", "sourceHashes"],
            "properties": {
                "paths": {
                    "type": "array",
                    "minItems": 1,
                    "items": {"type": "string", "minLength": 1},
                },
                "hash": {"type": "string", "pattern": "^[0-9a-f]{64}$"},
                "sourceHashes": {
                    "type": "object",
                    "minProperties": 1,
                    "additionalProperties": {
                        "type": "string",
                        "pattern": "^[0-9a-f]{64}$",
                    },
                },
            },
        },
        "researchRequest": {
            "type": "object",
            "additionalProperties": False,
            "required": ["path", "sha256"],
            "properties": {
                "path": {"type": "string", "minLength": 1},
                "sha256": {
                    "type": "string",
                    "pattern": "^[0-9a-f]{64}$",
                },
                "positionSnapshotPath": {"type": "string", "minLength": 1},
                "positionSnapshotSha256": {
                    "type": "string",
                    "pattern": "^[0-9a-f]{64}$",
                },
            },
            "dependentRequired": {
                "positionSnapshotPath": ["positionSnapshotSha256"],
                "positionSnapshotSha256": ["positionSnapshotPath"],
            },
        },
        "upstreamEvidence": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "run_id",
                "study_id",
                "result_hash",
                "study_input_hash",
                "artifacts",
                "hash",
                "inputRoot",
            ],
            "properties": {
                "run_id": {"type": "string", "pattern": "^run-"},
                "study_id": {"type": "string", "minLength": 1},
                "result_hash": {
                    "type": "string",
                    "pattern": "^[0-9a-f]{64}$",
                },
                "study_input_hash": {
                    "type": "string",
                    "pattern": "^[0-9a-f]{64}$",
                },
                "artifacts": {
                    "type": "array",
                    "minItems": 1,
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "required": ["path", "sha256"],
                        "properties": {
                            "path": {"type": "string", "minLength": 1},
                            "sha256": {
                                "type": "string",
                                "pattern": "^[0-9a-f]{64}$",
                            },
                        },
                    },
                },
                "hash": {
                    "type": "string",
                    "pattern": "^[0-9a-f]{64}$",
                },
                "inputRoot": {"type": "string", "minLength": 1},
            },
        },
        "judge": {"type": "object"},
        "objective": {"type": "object"},
        "execution": {"type": "object"},
        "metrics": {"type": "object"},
        "artifacts": {"type": "array"},
        "errors": {"type": "array"},
    },
}
