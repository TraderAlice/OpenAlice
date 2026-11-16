"""Fixed candidate preflights and immutable non-selection Check results."""

from __future__ import annotations

import json
import os
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

from .runs import harness_identity, same_harness_runtime
from .studies import (
    StudyContext,
    copy_hashed_files,
    hash_file,
    hash_json,
    load_study,
    path_matches_pattern,
    snapshot_patterns,
)
from .workspace import (
    PROJECT_MANIFEST,
    SCHEMA_VERSION,
    AutoQuantValidationError,
    ProjectContext,
    ValidationIssue,
    confined_path,
)


PREFLIGHT_MANIFEST = "preflight.json"
PREFLIGHT_KIND = "autoquant-candidate-preflight"
CHECK_OUTPUT = "raw-output.json"
CHECK_RESULT = "result.json"
CHECK_MANIFEST = "manifest.json"
CHECK_KIND = "autoquant-candidate-check"
CHECK_ID = re.compile(
    r"^check-[0-9]{8}T[0-9]{12}Z-[0-9a-f]{12}$"
)
CHECK_NAME = re.compile(r"^[a-z][a-z0-9_.-]*$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
CHECK_STATUSES = {"passed", "failed"}


@dataclass(frozen=True)
class CandidatePreflight:
    manifest_path: Path
    definition: dict[str, Any]
    source_hashes: dict[str, str]
    preflight_hash: str


@dataclass(frozen=True)
class CandidateCheckContext:
    root_dir: Path
    manifest: dict[str, Any]
    result: dict[str, Any]


@dataclass(frozen=True)
class CandidateCheckSummary:
    id: str
    status: str
    candidate_source_hash: str
    preflight_hash: str
    completed_at: str
    duration_ms: int
    path: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "status": self.status,
            "candidateSourceHash": self.candidate_source_hash,
            "preflightHash": self.preflight_hash,
            "completedAt": self.completed_at,
            "durationMs": self.duration_ms,
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


def _strict_keys(
    value: dict[str, Any],
    required: set[str],
    path: Path | str,
) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    missing = sorted(required - value.keys())
    extra = sorted(value.keys() - required)
    if missing:
        issues.append(
            _issue(path, "schema.required", "Missing fields: " + ", ".join(missing))
        )
    if extra:
        issues.append(
            _issue(path, "schema.additional", "Unexpected fields: " + ", ".join(extra))
        )
    return issues


def _relative_pattern(
    value: Any,
    path: Path | str,
    issues: list[ValidationIssue],
) -> str:
    if not isinstance(value, str) or not value:
        issues.append(_issue(path, "schema.string", "Expected a non-empty path"))
        return ""
    raw = value[:-3] if value.endswith("/**") else value
    candidate = PurePosixPath(raw)
    if (
        candidate.is_absolute()
        or ".." in candidate.parts
        or "\\" in value
        or raw in {"", "."}
    ):
        issues.append(_issue(path, "path.confined", "Path must be confined and relative"))
        return ""
    return value


def load_candidate_preflight(
    project: ProjectContext,
    study: StudyContext,
    *,
    optional: bool = False,
) -> CandidatePreflight | None:
    """Load one fixed operational preflight without changing Study identity."""

    path = study.root_dir / PREFLIGHT_MANIFEST
    if optional and not path.exists() and not path.is_symlink():
        return None
    raw = _read_json(path, "candidate-preflight")
    required = {"schemaVersion", "kind", "runner"}
    issues = _strict_keys(raw, required, path)
    if raw.get("schemaVersion") != SCHEMA_VERSION:
        issues.append(_issue(path, "schema.version", "Expected preflight V1"))
    if raw.get("kind") != PREFLIGHT_KIND:
        issues.append(_issue(path, "schema.kind", f"Expected kind '{PREFLIGHT_KIND}'"))
    runner = raw.get("runner")
    if not isinstance(runner, dict):
        issues.append(_issue(f"{path}/runner", "schema.type", "runner must be an object"))
        runner = {}
    runner_required = {
        "kind",
        "entrypoint",
        "paths",
        "arguments",
        "timeoutSeconds",
    }
    issues.extend(_strict_keys(runner, runner_required, f"{path}/runner"))
    if runner.get("kind") != "python":
        issues.append(
            _issue(f"{path}/runner/kind", "schema.choice", "runner.kind must be python")
        )
    entrypoint = _relative_pattern(
        runner.get("entrypoint"),
        f"{path}/runner/entrypoint",
        issues,
    )
    paths_raw = runner.get("paths")
    patterns: list[str] = []
    if not isinstance(paths_raw, list) or not paths_raw:
        issues.append(
            _issue(
                f"{path}/runner/paths",
                "schema.array",
                "Preflight paths must be a non-empty array",
            )
        )
    else:
        patterns = [
            _relative_pattern(item, f"{path}/runner/paths/{index}", issues)
            for index, item in enumerate(paths_raw)
        ]
        if len(patterns) != len(set(patterns)):
            issues.append(
                _issue(
                    f"{path}/runner/paths",
                    "preflight.duplicate-path",
                    "Preflight paths must be unique",
                )
            )
    arguments = runner.get("arguments")
    if not isinstance(arguments, list) or not all(
        isinstance(item, str) for item in arguments
    ):
        issues.append(
            _issue(
                f"{path}/runner/arguments",
                "schema.array",
                "Preflight arguments must be strings",
            )
        )
        arguments = []
    timeout = runner.get("timeoutSeconds")
    if (
        not isinstance(timeout, int)
        or isinstance(timeout, bool)
        or not 1 <= timeout <= 60
    ):
        issues.append(
            _issue(
                f"{path}/runner/timeoutSeconds",
                "schema.range",
                "Preflight timeoutSeconds must be from 1 to 60",
            )
        )
        timeout = 10
    judge_root = project.manifest.directories["judges"]
    invalid = []
    for pattern in patterns:
        relative = pattern[:-3] if pattern.endswith("/**") else pattern
        if not (relative == judge_root or relative.startswith(f"{judge_root}/")):
            invalid.append(pattern)
    if invalid:
        issues.append(
            _issue(
                f"{path}/runner/paths",
                "preflight.source-surface",
                "Preflight paths must stay under the Project Judge directory: "
                + ", ".join(invalid),
            )
        )
    if issues:
        raise AutoQuantValidationError(issues)
    source_hashes = snapshot_patterns(project, patterns)
    if entrypoint not in source_hashes:
        raise AutoQuantValidationError(
            [
                _issue(
                    f"{path}/runner/entrypoint",
                    "preflight.entrypoint-closure",
                    "Preflight entrypoint must be included in runner.paths",
                )
            ]
        )
    overlap = sorted(
        relative
        for relative in source_hashes
        if any(
            path_matches_pattern(relative, pattern)
            for pattern in study.definition.editable["paths"]
        )
    )
    if overlap:
        raise AutoQuantValidationError(
            [
                _issue(
                    path,
                    "preflight.editable-overlap",
                    "Preflight sources cannot be editable: " + ", ".join(overlap),
                )
            ]
        )
    judge_overlap = sorted(
        relative
        for relative in source_hashes
        if any(
            path_matches_pattern(relative, pattern)
            for pattern in study.definition.judge.paths
        )
    )
    if judge_overlap:
        raise AutoQuantValidationError(
            [
                _issue(
                    path,
                    "preflight.judge-overlap",
                    "Operational preflight sources must remain outside the "
                    "formal Judge closure: "
                    + ", ".join(judge_overlap),
                )
            ]
        )
    definition = {
        "schemaVersion": SCHEMA_VERSION,
        "kind": PREFLIGHT_KIND,
        "runner": {
            "kind": "python",
            "entrypoint": entrypoint,
            "paths": patterns,
            "arguments": list(arguments),
            "timeoutSeconds": timeout,
        },
    }
    return CandidatePreflight(
        manifest_path=path,
        definition=definition,
        source_hashes=source_hashes,
        preflight_hash=hash_json(
            {"definition": definition, "sourceHashes": source_hashes}
        ),
    )


def _validate_check_output(value: dict[str, Any], path: Path | str) -> None:
    required = {"schema_version", "status", "summary", "checks", "errors"}
    issues = _strict_keys(value, required, path)
    if value.get("schema_version") != SCHEMA_VERSION:
        issues.append(_issue(path, "schema.version", "Expected Check output V1"))
    status = value.get("status")
    if status not in CHECK_STATUSES:
        issues.append(
            _issue(f"{path}/status", "schema.choice", "status must be passed or failed")
        )
    if not isinstance(value.get("summary"), str) or not value.get("summary"):
        issues.append(_issue(f"{path}/summary", "schema.string", "Invalid summary"))
    rows = value.get("checks")
    seen: set[str] = set()
    normalized_rows = rows if isinstance(rows, list) else []
    if not isinstance(rows, list) or not rows:
        issues.append(
            _issue(f"{path}/checks", "schema.array", "checks must be non-empty")
        )
    for index, row in enumerate(normalized_rows):
        row_path = f"{path}/checks/{index}"
        if not isinstance(row, dict):
            issues.append(_issue(row_path, "schema.type", "Check row must be an object"))
            continue
        issues.extend(_strict_keys(row, {"id", "status", "message"}, row_path))
        check_id = row.get("id")
        if not isinstance(check_id, str) or not CHECK_NAME.fullmatch(check_id):
            issues.append(_issue(f"{row_path}/id", "schema.id", "Invalid check id"))
        elif check_id in seen:
            issues.append(_issue(f"{row_path}/id", "schema.unique", "Duplicate check id"))
        else:
            seen.add(check_id)
        if row.get("status") not in CHECK_STATUSES:
            issues.append(_issue(f"{row_path}/status", "schema.choice", "Invalid status"))
        if not isinstance(row.get("message"), str) or not row.get("message"):
            issues.append(_issue(f"{row_path}/message", "schema.string", "Invalid message"))
    errors = value.get("errors")
    normalized_errors = errors if isinstance(errors, list) else []
    if not isinstance(errors, list):
        issues.append(_issue(f"{path}/errors", "schema.array", "errors must be an array"))
    for index, error in enumerate(normalized_errors):
        error_path = f"{path}/errors/{index}"
        if not isinstance(error, dict):
            issues.append(_issue(error_path, "schema.type", "Error must be an object"))
            continue
        issues.extend(_strict_keys(error, {"code", "message"}, error_path))
        if not isinstance(error.get("code"), str) or not error.get("code"):
            issues.append(_issue(f"{error_path}/code", "schema.string", "Invalid code"))
        if not isinstance(error.get("message"), str) or not error.get("message"):
            issues.append(_issue(f"{error_path}/message", "schema.string", "Invalid message"))
    failed_rows = any(
        isinstance(row, dict) and row.get("status") == "failed"
        for row in normalized_rows
    )
    if status == "passed" and (failed_rows or normalized_errors):
        issues.append(
            _issue(path, "check.passed-inconsistent", "Passed output cannot contain failure")
        )
    if status == "failed" and not failed_rows and not normalized_errors:
        issues.append(
            _issue(path, "check.failed-inconsistent", "Failed output needs a failure")
        )
    if issues:
        raise AutoQuantValidationError(issues)


def _materialize_check_workspace(
    project: ProjectContext,
    study: StudyContext,
    preflight: CandidatePreflight,
    destination: Path,
) -> None:
    destination.mkdir(parents=True)
    shutil.copy2(project.root_dir / PROJECT_MANIFEST, destination / PROJECT_MANIFEST)
    combined = dict(preflight.source_hashes)
    combined.update(study.editable_hashes)
    combined.update(study.dependency_hashes)
    copy_hashed_files(project, combined, destination)
    studies_directory = project.manifest.directories["studies"]
    staged_study = destination / studies_directory / study.definition.id
    staged_study.mkdir(parents=True)
    shutil.copy2(study.manifest_path, staged_study / "study.json")
    shutil.copy2(preflight.manifest_path, staged_study / PREFLIGHT_MANIFEST)
    program_target = staged_study / study.definition.program
    program_target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(study.program_path, program_target)


def _text(value: str | bytes | None) -> str:
    if value is None:
        return ""
    return value.decode(errors="replace") if isinstance(value, bytes) else value


def _run_preflight(
    project: ProjectContext,
    study: StudyContext,
    preflight: CandidatePreflight,
    staging: Path,
    input_hash: str,
    data_root: Path,
) -> tuple[dict[str, Any], dict[str, Any]]:
    output_path = staging / CHECK_OUTPUT
    runner = preflight.definition["runner"]
    with tempfile.TemporaryDirectory(prefix=f"aq-check-{study.definition.id}-") as directory:
        execution_root = Path(directory) / "project"
        _materialize_check_workspace(project, study, preflight, execution_root)
        command = [
            sys.executable,
            runner["entrypoint"],
            *runner["arguments"],
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
                "AUTOQUANT_CHECK_OUTPUT": str(output_path),
                "AUTOQUANT_CHECK_INPUT_HASH": input_hash,
                "PYTHONPATH": os.pathsep.join(
                    filter(
                        None,
                        [str(execution_root), environment.get("PYTHONPATH", "")],
                    )
                ),
            }
        )
        started = time.monotonic()
        stdout = ""
        stderr = ""
        exit_code: int | None = None
        timed_out = False
        process_errors: list[dict[str, str]] = []
        try:
            completed = subprocess.run(
                command,
                cwd=execution_root,
                env=environment,
                capture_output=True,
                check=False,
                text=True,
                timeout=runner["timeoutSeconds"],
            )
            exit_code = completed.returncode
            stdout = completed.stdout
            stderr = completed.stderr
            if exit_code != 0:
                process_errors.append(
                    {
                        "code": "preflight.exit",
                        "message": f"Preflight exited with code {exit_code}",
                    }
                )
        except subprocess.TimeoutExpired as error:
            timed_out = True
            stdout = _text(error.stdout)
            stderr = _text(error.stderr)
            process_errors.append(
                {
                    "code": "preflight.timeout",
                    "message": (
                        f"Preflight exceeded {runner['timeoutSeconds']} seconds"
                    ),
                }
            )
        except OSError as error:
            process_errors.append(
                {"code": "preflight.spawn", "message": str(error)}
            )
        duration_ms = int((time.monotonic() - started) * 1000)
    (staging / "stdout.txt").write_text(stdout, encoding="utf-8")
    (staging / "stderr.txt").write_text(stderr, encoding="utf-8")
    if process_errors:
        normalized = {
            "status": "failed",
            "summary": process_errors[0]["message"],
            "checks": [
                {
                    "id": "process",
                    "status": "failed",
                    "message": process_errors[0]["message"],
                }
            ],
            "errors": process_errors,
        }
    else:
        try:
            raw = _read_json(output_path, "candidate-check-output")
            _validate_check_output(raw, output_path)
            normalized = {
                "status": raw["status"],
                "summary": raw["summary"],
                "checks": raw["checks"],
                "errors": raw["errors"],
            }
        except AutoQuantValidationError as error:
            normalized = {
                "status": "failed",
                "summary": "Preflight produced invalid structured output",
                "checks": [
                    {
                        "id": "output-contract",
                        "status": "failed",
                        "message": "Preflight output failed strict validation",
                    }
                ],
                "errors": [
                    {
                        "code": issue.code,
                        "message": f"{issue.path}: {issue.message}",
                    }
                    for issue in error.issues
                ],
            }
    _write_json(
        output_path,
        {
            "schema_version": SCHEMA_VERSION,
            **normalized,
        },
    )
    return normalized, {
        "kind": "python",
        "command": command,
        "exitCode": exit_code,
        "timedOut": timed_out,
        "timeoutSeconds": runner["timeoutSeconds"],
        "durationMs": duration_ms,
    }


def evaluate_project_candidate_preflight(
    project: ProjectContext,
    study: StudyContext,
) -> dict[str, Any] | None:
    """Evaluate the canonical first candidate before a fresh baseline Run.

    This is an operational guard, not a CandidateCheck or research artifact.
    The caller may retain the returned passed receipt only after the ordinary
    baseline and Session have both been created successfully.
    """

    preflight = load_candidate_preflight(project, study, optional=True)
    if preflight is None:
        return None
    data_root = confined_path(
        project.root_dir,
        project.manifest.directories["data"],
        "project/directories/data",
    )
    harness = harness_identity()
    identity = {
        "studyInputHash": study.input_hash,
        "datasetHash": study.dataset_hash,
        "candidateSourceHash": study.source_hash,
        "preflightHash": preflight.preflight_hash,
        "harness": harness,
    }
    input_hash = hash_json(identity)
    started = datetime.now(timezone.utc)
    with tempfile.TemporaryDirectory(
        prefix=f"aq-baseline-preflight-{study.definition.id}-"
    ) as directory:
        staging = Path(directory) / "result"
        staging.mkdir()
        normalized, execution = _run_preflight(
            project,
            study,
            preflight,
            staging,
            input_hash,
            data_root,
        )
    completed = datetime.now(timezone.utc)
    output_identity = {
        "status": normalized["status"],
        "summary": normalized["summary"],
        "checks": normalized["checks"],
        "errors": normalized["errors"],
    }
    receipt = {
        "status": normalized["status"],
        "summary": normalized["summary"],
        "startedAt": started.isoformat(),
        "completedAt": completed.isoformat(),
        "durationMs": execution["durationMs"],
        "study": {
            "inputHash": study.input_hash,
            "datasetHash": study.dataset_hash,
        },
        "candidate": {"sourceHash": study.source_hash},
        "preflight": {
            "hash": preflight.preflight_hash,
            "sourceHashes": preflight.source_hashes,
        },
        "harness": harness,
        "inputHash": input_hash,
        "outputHash": hash_json(output_identity),
        "authority": {
            "selectionAuthority": "none",
            "promotionAuthority": "none",
            "tradingAuthority": "none",
        },
        "checks": normalized["checks"],
        "errors": normalized["errors"],
        "execution": execution,
    }
    receipt["receiptHash"] = hash_json(receipt)
    return receipt


def _check_hashes(root: Path) -> dict[str, str]:
    hashes: dict[str, str] = {}
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            raise AutoQuantValidationError(
                [_issue(path, "path.symlink", "Candidate Check cannot contain symlinks")]
            )
        if path.is_file() and path != root / CHECK_MANIFEST:
            hashes[path.relative_to(root).as_posix()] = hash_file(path)
    return hashes


def execute_candidate_check(
    project: ProjectContext,
    session_id: str,
) -> CandidateCheckContext:
    """Run one fixed non-selection preflight against the exact Session candidate."""

    from .sessions import load_session, validate_session_authority

    session = load_session(project, session_id)
    if session.manifest["status"] != "active":
        raise AutoQuantValidationError(
            [_issue(session.manifest_path, "session.closed", "Session is not active")]
        )
    candidate = validate_session_authority(project, session)
    if candidate.source_hash == session.manifest["leader"]["sourceHash"]:
        raise AutoQuantValidationError(
            [
                _issue(
                    candidate.root_dir,
                    "check.unchanged",
                    "Edit the candidate before running its preflight",
                )
            ]
        )
    owning_study = load_study(
        project,
        session.manifest["studyId"],
        data_root=project.root_dir / project.manifest.directories["data"],
    )
    canonical = load_candidate_preflight(project, owning_study)
    worktree = load_candidate_preflight(session.worktree_project, candidate)
    assert canonical is not None and worktree is not None
    if (
        canonical.definition != worktree.definition
        or canonical.preflight_hash != worktree.preflight_hash
    ):
        raise AutoQuantValidationError(
            [
                _issue(
                    worktree.manifest_path,
                    "check.preflight-stale",
                    "Worktree preflight differs from fixed Project authority",
                )
            ]
        )
    data_root = confined_path(
        project.root_dir,
        project.manifest.directories["data"],
        "project/directories/data",
    )
    harness = harness_identity()
    identity = {
        "sessionId": session_id,
        "studyInputHash": candidate.input_hash,
        "datasetHash": candidate.dataset_hash,
        "candidateSourceHash": candidate.source_hash,
        "leaderSourceHash": session.manifest["leader"]["sourceHash"],
        "preflightHash": worktree.preflight_hash,
        "harness": harness,
    }
    input_hash = hash_json(identity)
    checks_root = session.root_dir / "checks"
    checks_root.mkdir(exist_ok=True)
    staging = checks_root / f".check-{uuid.uuid4().hex}"
    staging.mkdir()
    started = datetime.now(timezone.utc)
    try:
        normalized, execution = _run_preflight(
            session.worktree_project,
            candidate,
            worktree,
            staging,
            input_hash,
            data_root,
        )
        completed = datetime.now(timezone.utc)
        output_identity = hash_json(
            {
                "status": normalized["status"],
                "summary": normalized["summary"],
                "checks": normalized["checks"],
                "errors": normalized["errors"],
            }
        )
        check_hash = hash_json(
            {
                "startedAt": started.isoformat(),
                "inputHash": input_hash,
                "outputIdentity": output_identity,
            }
        )
        check_id = (
            f"check-{started.strftime('%Y%m%dT%H%M%S%fZ')}-"
            f"{check_hash[:12]}"
        )
        target = checks_root / check_id
        if target.exists() or target.is_symlink():
            raise AutoQuantValidationError(
                [_issue(target, "check.collision", "Candidate Check id collision")]
            )
        result = {
            "schemaVersion": SCHEMA_VERSION,
            "kind": CHECK_KIND,
            "id": check_id,
            "status": normalized["status"],
            "summary": normalized["summary"],
            "startedAt": started.isoformat(),
            "completedAt": completed.isoformat(),
            "durationMs": execution["durationMs"],
            "project": {"id": project.manifest.id},
            "session": {"id": session_id},
            "study": {
                "id": candidate.definition.id,
                "inputHash": candidate.input_hash,
                "datasetHash": candidate.dataset_hash,
            },
            "candidate": {
                "sourceHash": candidate.source_hash,
                "leaderSourceHash": session.manifest["leader"]["sourceHash"],
            },
            "preflight": {
                "hash": worktree.preflight_hash,
                "sourceHashes": worktree.source_hashes,
            },
            "harness": harness,
            "inputHash": input_hash,
            "authority": {
                "selectionAuthority": "none",
                "promotionAuthority": "none",
                "tradingAuthority": "none",
            },
            "checks": normalized["checks"],
            "errors": normalized["errors"],
            "execution": execution,
        }
        _write_json(staging / CHECK_RESULT, result)
        files = _check_hashes(staging)
        manifest = {
            "schemaVersion": SCHEMA_VERSION,
            "id": check_id,
            "sessionId": session_id,
            "status": result["status"],
            "completed": True,
            "resultHash": files[CHECK_RESULT],
            "files": files,
        }
        _write_json(staging / CHECK_MANIFEST, manifest)
        os.replace(staging, target)
    except Exception:
        if staging.exists():
            shutil.rmtree(staging)
        raise
    return load_candidate_check(project, session_id, check_id)


def _validate_check_result(
    result: dict[str, Any],
    path: Path,
    check_id: str,
    session_id: str,
    project_id: str,
) -> None:
    required = {
        "schemaVersion",
        "kind",
        "id",
        "status",
        "summary",
        "startedAt",
        "completedAt",
        "durationMs",
        "project",
        "session",
        "study",
        "candidate",
        "preflight",
        "harness",
        "inputHash",
        "authority",
        "checks",
        "errors",
        "execution",
    }
    issues = _strict_keys(result, required, path)
    if result.get("schemaVersion") != SCHEMA_VERSION or result.get("kind") != CHECK_KIND:
        issues.append(_issue(path, "check.version", "Invalid Candidate Check version"))
    if result.get("id") != check_id:
        issues.append(_issue(path, "check.identity", "Candidate Check id mismatch"))
    if result.get("status") not in CHECK_STATUSES:
        issues.append(_issue(path, "check.status", "Invalid Candidate Check status"))
    session = result.get("session")
    if not isinstance(session, dict) or session != {"id": session_id}:
        issues.append(_issue(path, "check.session", "Candidate Check Session mismatch"))
    if result.get("project") != {"id": project_id}:
        issues.append(_issue(path, "check.project", "Candidate Check Project mismatch"))
    if not isinstance(result.get("inputHash"), str) or not SHA256.fullmatch(
        result.get("inputHash", "")
    ):
        issues.append(_issue(path, "check.input-hash", "Invalid Check input hash"))
    authority = result.get("authority")
    if authority != {
        "selectionAuthority": "none",
        "promotionAuthority": "none",
        "tradingAuthority": "none",
    }:
        issues.append(_issue(path, "check.authority", "Candidate Check has invalid authority"))
    study = result.get("study")
    candidate = result.get("candidate")
    preflight = result.get("preflight")
    harness = result.get("harness")
    for label, value, required_keys in (
        ("study", study, {"id", "inputHash", "datasetHash"}),
        ("candidate", candidate, {"sourceHash", "leaderSourceHash"}),
        ("preflight", preflight, {"hash", "sourceHashes"}),
        (
            "harness",
            harness,
            {"id", "version", "commit", "dirty", "sourceHash", "python"},
        ),
    ):
        if not isinstance(value, dict):
            issues.append(_issue(f"{path}/{label}", "schema.type", "Expected object"))
        else:
            allowed_keys = set(required_keys)
            if label == "harness" and "buildProvenance" in value:
                allowed_keys.add("buildProvenance")
            issues.extend(_strict_keys(value, allowed_keys, f"{path}/{label}"))
            if (
                label == "harness"
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
                        "check.harness-provenance",
                        "Invalid Harness build provenance",
                    )
                )
    if isinstance(study, dict):
        if not isinstance(study.get("id"), str) or not study.get("id"):
            issues.append(_issue(f"{path}/study/id", "schema.string", "Invalid Study id"))
        for key in ("inputHash", "datasetHash"):
            if not isinstance(study.get(key), str) or not SHA256.fullmatch(
                study.get(key, "")
            ):
                issues.append(_issue(f"{path}/study/{key}", "schema.hash", "Invalid hash"))
    if isinstance(candidate, dict):
        for key in ("sourceHash", "leaderSourceHash"):
            if not isinstance(candidate.get(key), str) or not SHA256.fullmatch(
                candidate.get(key, "")
            ):
                issues.append(
                    _issue(f"{path}/candidate/{key}", "schema.hash", "Invalid hash")
                )
    if isinstance(preflight, dict):
        if not isinstance(preflight.get("hash"), str) or not SHA256.fullmatch(
            preflight.get("hash", "")
        ):
            issues.append(_issue(f"{path}/preflight/hash", "schema.hash", "Invalid hash"))
        source_hashes = preflight.get("sourceHashes")
        if not isinstance(source_hashes, dict) or not source_hashes:
            issues.append(
                _issue(
                    f"{path}/preflight/sourceHashes",
                    "schema.object",
                    "Preflight sourceHashes must be non-empty",
                )
            )
        elif any(
            not isinstance(key, str)
            or not key
            or not isinstance(value, str)
            or not SHA256.fullmatch(value)
            for key, value in source_hashes.items()
        ):
            issues.append(
                _issue(
                    f"{path}/preflight/sourceHashes",
                    "schema.hash",
                    "Invalid Preflight source hash inventory",
                )
            )
    if all(
        isinstance(value, dict)
        for value in (study, candidate, preflight, harness)
    ):
        expected_input_hash = hash_json(
            {
                "sessionId": session_id,
                "studyInputHash": study.get("inputHash"),
                "datasetHash": study.get("datasetHash"),
                "candidateSourceHash": candidate.get("sourceHash"),
                "leaderSourceHash": candidate.get("leaderSourceHash"),
                "preflightHash": preflight.get("hash"),
                "harness": harness,
            }
        )
        if result.get("inputHash") != expected_input_hash:
            issues.append(
                _issue(path, "check.input-identity", "Candidate Check inputHash mismatch")
            )
    output = {
        "schema_version": SCHEMA_VERSION,
        "status": result.get("status"),
        "summary": result.get("summary"),
        "checks": result.get("checks"),
        "errors": result.get("errors"),
    }
    try:
        _validate_check_output(output, path)
    except AutoQuantValidationError as error:
        issues.extend(error.issues)
    if issues:
        raise AutoQuantValidationError(issues)


def load_candidate_check(
    project: ProjectContext,
    session_id: str,
    check_id: str,
) -> CandidateCheckContext:
    from .sessions import load_session

    if not CHECK_ID.fullmatch(check_id):
        raise AutoQuantValidationError(
            [_issue(check_id, "schema.id", "Invalid Candidate Check id")]
        )
    session = load_session(project, session_id)
    root = session.root_dir / "checks" / check_id
    if root.is_symlink() or not root.is_dir():
        raise AutoQuantValidationError(
            [_issue(root, "check.missing", f"Unknown Candidate Check: {check_id}")]
        )
    manifest = _read_json(root / CHECK_MANIFEST, "candidate-check-manifest")
    required = {
        "schemaVersion",
        "id",
        "sessionId",
        "status",
        "completed",
        "resultHash",
        "files",
    }
    issues = _strict_keys(manifest, required, root / CHECK_MANIFEST)
    if (
        manifest.get("schemaVersion") != SCHEMA_VERSION
        or manifest.get("id") != check_id
        or manifest.get("sessionId") != session_id
        or manifest.get("status") not in CHECK_STATUSES
        or manifest.get("completed") is not True
    ):
        issues.append(_issue(root / CHECK_MANIFEST, "check.manifest", "Invalid manifest"))
    actual = _check_hashes(root)
    if manifest.get("files") != actual:
        issues.append(_issue(root, "check.tampered", "Candidate Check files changed"))
    if actual.get(CHECK_RESULT) != manifest.get("resultHash"):
        issues.append(_issue(root, "check.result-hash", "Candidate Check result mismatch"))
    if issues:
        raise AutoQuantValidationError(issues)
    result = _read_json(root / CHECK_RESULT, "candidate-check-result")
    if result.get("status") != manifest.get("status"):
        raise AutoQuantValidationError(
            [_issue(root, "check.status-mismatch", "Manifest and result status differ")]
        )
    _validate_check_result(
        result,
        root / CHECK_RESULT,
        check_id,
        session_id,
        project.manifest.id,
    )
    return CandidateCheckContext(root, manifest, result)


def list_candidate_checks(
    project: ProjectContext,
    session_id: str,
) -> list[CandidateCheckSummary]:
    from .sessions import load_session

    session = load_session(project, session_id)
    root = session.root_dir / "checks"
    if not root.exists():
        return []
    if root.is_symlink() or not root.is_dir():
        raise AutoQuantValidationError(
            [_issue(root, "check.directory", "Session checks must be a directory")]
        )
    result: list[CandidateCheckSummary] = []
    for entry in sorted(root.iterdir(), key=lambda item: item.name):
        if entry.name.startswith("."):
            continue
        check = load_candidate_check(project, session_id, entry.name)
        value = check.result
        result.append(
            CandidateCheckSummary(
                id=value["id"],
                status=value["status"],
                candidate_source_hash=value["candidate"]["sourceHash"],
                preflight_hash=value["preflight"]["hash"],
                completed_at=value["completedAt"],
                duration_ms=value["durationMs"],
                path=str(check.root_dir),
            )
        )
    return result


def candidate_check_state(
    project: ProjectContext,
    session: Any,
    candidate: StudyContext | None = None,
) -> dict[str, Any]:
    """Project preflight support and the latest Check for the exact candidate."""

    from .sessions import validate_session_authority

    candidate = candidate or validate_session_authority(project, session)
    preflight = load_candidate_preflight(
        session.worktree_project,
        candidate,
        optional=True,
    )
    changed = candidate.source_hash != session.manifest["leader"]["sourceHash"]
    if preflight is None:
        return {
            "supported": False,
            "candidateChanged": changed,
            "candidateSourceHash": candidate.source_hash,
            "preflightHash": None,
            "current": None,
            "exactCandidate": None,
            "latest": None,
        }
    summaries = list_candidate_checks(project, session.manifest["id"])
    latest = summaries[-1].to_dict() if summaries else None
    current = None
    exact_candidate = None
    current_harness = harness_identity()
    for summary in reversed(summaries):
        check = load_candidate_check(
            project,
            session.manifest["id"],
            summary.id,
        )
        result = check.result
        exact_identity = (
            result["candidate"]["sourceHash"] == candidate.source_hash
            and result["study"]["inputHash"] == candidate.input_hash
            and result["study"]["datasetHash"] == candidate.dataset_hash
            and result["preflight"]["hash"] == preflight.preflight_hash
            and same_harness_runtime(result["harness"], current_harness)
        )
        if exact_identity and exact_candidate is None:
            exact_candidate = summary.to_dict()
        if (
            exact_identity
            and result["candidate"]["leaderSourceHash"]
            == session.manifest["leader"]["sourceHash"]
        ):
            current = summary.to_dict()
            break
    return {
        "supported": True,
        "candidateChanged": changed,
        "candidateSourceHash": candidate.source_hash,
        "preflightHash": preflight.preflight_hash,
        "current": current,
        "exactCandidate": exact_candidate,
        "latest": latest,
    }


PREFLIGHT_JSON_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "AutoQuant fixed candidate preflight",
    "type": "object",
    "additionalProperties": False,
    "required": ["schemaVersion", "kind", "runner"],
    "properties": {
        "schemaVersion": {"const": SCHEMA_VERSION},
        "kind": {"const": PREFLIGHT_KIND},
        "runner": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "kind",
                "entrypoint",
                "paths",
                "arguments",
                "timeoutSeconds",
            ],
            "properties": {
                "kind": {"const": "python"},
                "entrypoint": {"type": "string", "minLength": 1},
                "paths": {
                    "type": "array",
                    "minItems": 1,
                    "uniqueItems": True,
                    "items": {"type": "string", "minLength": 1},
                },
                "arguments": {"type": "array", "items": {"type": "string"}},
                "timeoutSeconds": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 60,
                },
            },
        },
    },
}

CHECK_OUTPUT_JSON_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "AutoQuant fixed candidate preflight output",
    "type": "object",
    "additionalProperties": False,
    "required": ["schema_version", "status", "summary", "checks", "errors"],
    "properties": {
        "schema_version": {"const": SCHEMA_VERSION},
        "status": {"enum": sorted(CHECK_STATUSES)},
        "summary": {"type": "string", "minLength": 1},
        "checks": {
            "type": "array",
            "minItems": 1,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["id", "status", "message"],
                "properties": {
                    "id": {"type": "string", "pattern": CHECK_NAME.pattern},
                    "status": {"enum": sorted(CHECK_STATUSES)},
                    "message": {"type": "string", "minLength": 1},
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

CANDIDATE_CHECK_RESULT_JSON_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "AutoQuant immutable non-selection Candidate Check",
    "type": "object",
    "additionalProperties": False,
    "required": [
        "schemaVersion",
        "kind",
        "id",
        "status",
        "summary",
        "startedAt",
        "completedAt",
        "durationMs",
        "project",
        "session",
        "study",
        "candidate",
        "preflight",
        "harness",
        "inputHash",
        "authority",
        "checks",
        "errors",
        "execution",
    ],
    "properties": {
        "schemaVersion": {"const": SCHEMA_VERSION},
        "kind": {"const": CHECK_KIND},
        "id": {"type": "string", "pattern": CHECK_ID.pattern},
        "status": {"enum": sorted(CHECK_STATUSES)},
        "summary": {"type": "string", "minLength": 1},
        "startedAt": {"type": "string", "format": "date-time"},
        "completedAt": {"type": "string", "format": "date-time"},
        "durationMs": {"type": "integer", "minimum": 0},
        "project": {
            "type": "object",
            "additionalProperties": False,
            "required": ["id"],
            "properties": {"id": {"type": "string", "minLength": 1}},
        },
        "session": {
            "type": "object",
            "additionalProperties": False,
            "required": ["id"],
            "properties": {"id": {"type": "string", "minLength": 1}},
        },
        "study": {
            "type": "object",
            "additionalProperties": False,
            "required": ["id", "inputHash", "datasetHash"],
            "properties": {
                "id": {"type": "string", "minLength": 1},
                "inputHash": {"type": "string", "pattern": SHA256.pattern},
                "datasetHash": {"type": "string", "pattern": SHA256.pattern},
            },
        },
        "candidate": {
            "type": "object",
            "additionalProperties": False,
            "required": ["sourceHash", "leaderSourceHash"],
            "properties": {
                "sourceHash": {"type": "string", "pattern": SHA256.pattern},
                "leaderSourceHash": {"type": "string", "pattern": SHA256.pattern},
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
        "authority": {
            "const": {
                "selectionAuthority": "none",
                "promotionAuthority": "none",
                "tradingAuthority": "none",
            }
        },
        "checks": CHECK_OUTPUT_JSON_SCHEMA["properties"]["checks"],
        "errors": CHECK_OUTPUT_JSON_SCHEMA["properties"]["errors"],
        "execution": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "kind",
                "command",
                "exitCode",
                "timedOut",
                "timeoutSeconds",
                "durationMs",
            ],
            "properties": {
                "kind": {"const": "python"},
                "command": {"type": "array", "items": {"type": "string"}},
                "exitCode": {"type": ["integer", "null"]},
                "timedOut": {"type": "boolean"},
                "timeoutSeconds": {"type": "integer", "minimum": 1},
                "durationMs": {"type": "integer", "minimum": 0},
            },
        },
    },
}
