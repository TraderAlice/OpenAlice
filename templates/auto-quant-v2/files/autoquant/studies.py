"""Strict Study contracts and source-closure identity."""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import shutil
from dataclasses import asdict, dataclass
from datetime import date, datetime
from pathlib import Path, PurePosixPath
from typing import Any

from .workspace import (
    SCHEMA_VERSION,
    AutoQuantValidationError,
    ProjectContext,
    ValidationIssue,
    confined_path,
)


STUDY_MANIFEST = "study.json"
STUDY_ID = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
METRIC_ID = re.compile(r"^[a-z][a-z0-9_.-]*$")
RUN_ID = re.compile(r"^run-[A-Za-z0-9.-]+$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
SUBJECT_KINDS = {"strategy", "factor", "model", "research"}
DIRECTIONS = {"maximize", "minimize"}
IGNORED_SOURCE_NAMES = {".DS_Store", "__pycache__"}


@dataclass(frozen=True)
class StudySubject:
    kind: str
    name: str
    version: str


@dataclass(frozen=True)
class StudyJudge:
    kind: str
    entrypoint: str
    paths: list[str]
    arguments: list[str]
    timeout_seconds: int


@dataclass(frozen=True)
class StudyObjective:
    metric: str
    direction: str
    minimum_improvement: float


@dataclass(frozen=True)
class StudyTimeRange:
    start: str
    end: str


@dataclass(frozen=True)
class StudyDataset:
    id: str
    version: str
    asset_class: str
    universe: list[str]
    time_range: StudyTimeRange
    paths: list[str] | None = None


@dataclass(frozen=True)
class StudyResearchRequest:
    path: str
    position_snapshot_path: str | None = None


@dataclass(frozen=True)
class StudyUpstreamArtifact:
    path: str
    sha256: str


@dataclass(frozen=True)
class StudyUpstreamEvidence:
    run_id: str
    study_id: str
    result_hash: str
    study_input_hash: str
    artifacts: list[StudyUpstreamArtifact]


@dataclass(frozen=True)
class StudyDefinition:
    schema_version: int
    id: str
    name: str
    description: str
    program: str
    subject: StudySubject
    editable: dict[str, list[str]]
    judge: StudyJudge
    objective: StudyObjective
    dataset: StudyDataset
    dependencies: dict[str, list[str]] | None = None
    research_request: StudyResearchRequest | None = None
    upstream_evidence: StudyUpstreamEvidence | None = None

    def to_dict(self) -> dict[str, Any]:
        value = asdict(self)
        if self.dataset.paths is None:
            value["dataset"].pop("paths")
        if self.dependencies is None:
            value.pop("dependencies")
        if self.research_request is None:
            value.pop("research_request")
        elif self.research_request.position_snapshot_path is None:
            value["research_request"].pop("position_snapshot_path")
        if self.upstream_evidence is None:
            value.pop("upstream_evidence")
        return value


@dataclass(frozen=True)
class StudyContext:
    root_dir: Path
    manifest_path: Path
    program_path: Path
    definition: StudyDefinition
    study_hash: str
    program_hash: str
    judge_hashes: dict[str, str]
    judge_hash: str
    editable_hashes: dict[str, str]
    source_hash: str
    dependency_hashes: dict[str, str]
    dependency_hash: str | None
    upstream_evidence_hash: str | None
    dataset_hashes: dict[str, str]
    dataset_hash: str
    input_hash: str


@dataclass(frozen=True)
class StudySummary:
    id: str
    name: str
    description: str
    subject_kind: str
    primary_metric: str
    direction: str
    path: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "subjectKind": self.subject_kind,
            "primaryMetric": self.primary_metric,
            "direction": self.direction,
            "path": self.path,
        }


def hash_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def hash_file(path: Path) -> str:
    return hash_bytes(path.read_bytes())


def hash_json(value: Any) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode()
    return hash_bytes(encoded)


def _issue(path: Path | str, code: str, message: str) -> ValidationIssue:
    return ValidationIssue(str(path), code, message)


def _strict_keys(
    raw: dict[str, Any],
    *,
    required: set[str],
    path: Path | str,
) -> list[ValidationIssue]:
    issues = [
        _issue(f"{path}/{key}", "schema.missing", f"Missing required field '{key}'")
        for key in sorted(required - raw.keys())
    ]
    issues.extend(
        _issue(f"{path}/{key}", "schema.unknown", f"Unknown field '{key}'")
        for key in sorted(raw.keys() - required)
    )
    return issues


def _object(value: Any, path: str, issues: list[ValidationIssue]) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    issues.append(_issue(path, "schema.type", "Must be a JSON object"))
    return {}


def _string(
    value: Any,
    path: str,
    issues: list[ValidationIssue],
    *,
    allow_empty: bool = False,
) -> str:
    if not isinstance(value, str) or (not allow_empty and not value.strip()):
        issues.append(_issue(path, "schema.string", "Must be a string" if allow_empty else "Must be a non-empty string"))
        return ""
    return value


def _relative_path(value: Any, path: str, issues: list[ValidationIssue]) -> str:
    result = _string(value, path, issues)
    if not result:
        return result
    candidate = PurePosixPath(result)
    if (
        "\\" in result
        or candidate.is_absolute()
        or result in {".", ".."}
        or ".." in candidate.parts
    ):
        issues.append(
            _issue(path, "schema.path", "Must be a confined POSIX relative path")
        )
    return result


def _path_pattern(value: Any, path: str, issues: list[ValidationIssue]) -> str:
    result = _string(value, path, issues)
    if not result:
        return result
    if "*" in result and not result.endswith("/**"):
        issues.append(
            _issue(path, "schema.path-pattern", "Only exact paths or trailing '/**' closures are supported")
        )
        return result
    root = result[:-3] if result.endswith("/**") else result
    _relative_path(root, path, issues)
    return result


def parse_study_definition(raw: dict[str, Any], path: Path) -> StudyDefinition:
    required = {
        "schema_version",
        "id",
        "name",
        "description",
        "program",
        "subject",
        "editable",
        "judge",
        "objective",
        "dataset",
    }
    if "dependencies" in raw:
        required.add("dependencies")
    if "research_request" in raw:
        required.add("research_request")
    if "upstream_evidence" in raw:
        required.add("upstream_evidence")
    issues = _strict_keys(raw, required=required, path=path)
    if raw.get("schema_version") != SCHEMA_VERSION:
        issues.append(
            _issue(
                f"{path}/schema_version",
                "schema.version",
                f"Expected schema_version {SCHEMA_VERSION}",
            )
        )
    study_id = _string(raw.get("id"), f"{path}/id", issues)
    if study_id and not STUDY_ID.fullmatch(study_id):
        issues.append(
            _issue(f"{path}/id", "schema.id", "Must be a lowercase kebab-case id")
        )
    name = _string(raw.get("name"), f"{path}/name", issues)
    description = _string(
        raw.get("description"),
        f"{path}/description",
        issues,
        allow_empty=True,
    )
    program = _relative_path(raw.get("program"), f"{path}/program", issues)

    subject_raw = _object(raw.get("subject"), f"{path}/subject", issues)
    issues.extend(
        _strict_keys(
            subject_raw,
            required={"kind", "name", "version"},
            path=f"{path}/subject",
        )
    )
    subject_kind = _string(subject_raw.get("kind"), f"{path}/subject/kind", issues)
    if subject_kind and subject_kind not in SUBJECT_KINDS:
        issues.append(
            _issue(
                f"{path}/subject/kind",
                "schema.choice",
                f"Expected one of: {', '.join(sorted(SUBJECT_KINDS))}",
            )
        )
    subject_name = _string(subject_raw.get("name"), f"{path}/subject/name", issues)
    subject_version = _string(
        subject_raw.get("version"),
        f"{path}/subject/version",
        issues,
    )

    editable_raw = _object(raw.get("editable"), f"{path}/editable", issues)
    issues.extend(
        _strict_keys(
            editable_raw,
            required={"paths"},
            path=f"{path}/editable",
        )
    )
    editable_values = editable_raw.get("paths")
    editable_paths: list[str] = []
    if not isinstance(editable_values, list):
        issues.append(
            _issue(
                f"{path}/editable/paths",
                "schema.array",
                "Editable paths must be an array",
            )
        )
    else:
        editable_paths = [
            _path_pattern(value, f"{path}/editable/paths/{index}", issues)
            for index, value in enumerate(editable_values)
        ]
        if len(editable_paths) != len(set(editable_paths)):
            issues.append(
                _issue(
                    f"{path}/editable/paths",
                    "study.duplicate-path",
                    "Editable paths must be unique",
                )
            )

    dependencies: dict[str, list[str]] | None = None
    if "dependencies" in raw:
        dependencies_raw = _object(
            raw.get("dependencies"),
            f"{path}/dependencies",
            issues,
        )
        issues.extend(
            _strict_keys(
                dependencies_raw,
                required={"paths"},
                path=f"{path}/dependencies",
            )
        )
        dependency_values = dependencies_raw.get("paths")
        dependency_paths: list[str] = []
        if not isinstance(dependency_values, list) or not dependency_values:
            issues.append(
                _issue(
                    f"{path}/dependencies/paths",
                    "schema.array",
                    "Must contain at least one fixed dependency path or closure",
                )
            )
        else:
            dependency_paths = [
                _path_pattern(
                    value,
                    f"{path}/dependencies/paths/{index}",
                    issues,
                )
                for index, value in enumerate(dependency_values)
            ]
            if len(dependency_paths) != len(set(dependency_paths)):
                issues.append(
                    _issue(
                        f"{path}/dependencies/paths",
                        "study.duplicate-path",
                        "Dependency paths must be unique",
                    )
                )
        dependencies = {"paths": dependency_paths}

    research_request: StudyResearchRequest | None = None
    if "research_request" in raw:
        request_raw = _object(
            raw.get("research_request"),
            f"{path}/research_request",
            issues,
        )
        request_required = {"path"}
        if "position_snapshot_path" in request_raw:
            request_required.add("position_snapshot_path")
        issues.extend(
            _strict_keys(
                request_raw,
                required=request_required,
                path=f"{path}/research_request",
            )
        )
        request_path = _relative_path(
            request_raw.get("path"),
            f"{path}/research_request/path",
            issues,
        )
        snapshot_path = None
        if "position_snapshot_path" in request_raw:
            snapshot_path = _relative_path(
                request_raw.get("position_snapshot_path"),
                f"{path}/research_request/position_snapshot_path",
                issues,
            )
        research_request = StudyResearchRequest(request_path, snapshot_path)

    upstream_evidence: StudyUpstreamEvidence | None = None
    if "upstream_evidence" in raw:
        upstream_raw = _object(
            raw.get("upstream_evidence"),
            f"{path}/upstream_evidence",
            issues,
        )
        issues.extend(
            _strict_keys(
                upstream_raw,
                required={
                    "run_id",
                    "study_id",
                    "result_hash",
                    "study_input_hash",
                    "artifacts",
                },
                path=f"{path}/upstream_evidence",
            )
        )
        upstream_run_id = _string(
            upstream_raw.get("run_id"),
            f"{path}/upstream_evidence/run_id",
            issues,
        )
        if upstream_run_id and not RUN_ID.fullmatch(upstream_run_id):
            issues.append(
                _issue(
                    f"{path}/upstream_evidence/run_id",
                    "schema.id",
                    "Must be an immutable Run id",
                )
            )
        upstream_study_id = _string(
            upstream_raw.get("study_id"),
            f"{path}/upstream_evidence/study_id",
            issues,
        )
        if upstream_study_id and not STUDY_ID.fullmatch(upstream_study_id):
            issues.append(
                _issue(
                    f"{path}/upstream_evidence/study_id",
                    "schema.id",
                    "Must be a lowercase kebab-case Study id",
                )
            )
        result_hash = _string(
            upstream_raw.get("result_hash"),
            f"{path}/upstream_evidence/result_hash",
            issues,
        )
        study_input_hash = _string(
            upstream_raw.get("study_input_hash"),
            f"{path}/upstream_evidence/study_input_hash",
            issues,
        )
        for field_name, value in (
            ("result_hash", result_hash),
            ("study_input_hash", study_input_hash),
        ):
            if value and not SHA256.fullmatch(value):
                issues.append(
                    _issue(
                        f"{path}/upstream_evidence/{field_name}",
                        "schema.hash",
                        "Must be a lowercase SHA-256 hash",
                    )
                )
        artifacts_raw = upstream_raw.get("artifacts")
        upstream_artifacts: list[StudyUpstreamArtifact] = []
        if not isinstance(artifacts_raw, list) or not artifacts_raw:
            issues.append(
                _issue(
                    f"{path}/upstream_evidence/artifacts",
                    "schema.array",
                    "Must contain at least one exact upstream Run artifact",
                )
            )
        else:
            for index, item in enumerate(artifacts_raw):
                item_path = f"{path}/upstream_evidence/artifacts/{index}"
                artifact_raw = _object(item, item_path, issues)
                issues.extend(
                    _strict_keys(
                        artifact_raw,
                        required={"path", "sha256"},
                        path=item_path,
                    )
                )
                artifact_path = _relative_path(
                    artifact_raw.get("path"),
                    f"{item_path}/path",
                    issues,
                )
                artifact_hash = _string(
                    artifact_raw.get("sha256"),
                    f"{item_path}/sha256",
                    issues,
                )
                if artifact_path and not artifact_path.startswith("artifacts/"):
                    issues.append(
                        _issue(
                            f"{item_path}/path",
                            "study.upstream-artifact",
                            "Upstream evidence must name a declared Run artifact path",
                        )
                    )
                if artifact_hash and not SHA256.fullmatch(artifact_hash):
                    issues.append(
                        _issue(
                            f"{item_path}/sha256",
                            "schema.hash",
                            "Must be a lowercase SHA-256 hash",
                        )
                    )
                upstream_artifacts.append(
                    StudyUpstreamArtifact(artifact_path, artifact_hash)
                )
            artifact_paths = [item.path for item in upstream_artifacts]
            if len(artifact_paths) != len(set(artifact_paths)):
                issues.append(
                    _issue(
                        f"{path}/upstream_evidence/artifacts",
                        "study.duplicate-path",
                        "Upstream artifact paths must be unique",
                    )
                )
        upstream_evidence = StudyUpstreamEvidence(
            upstream_run_id,
            upstream_study_id,
            result_hash,
            study_input_hash,
            upstream_artifacts,
        )

    judge_raw = _object(raw.get("judge"), f"{path}/judge", issues)
    issues.extend(
        _strict_keys(
            judge_raw,
            required={
                "kind",
                "entrypoint",
                "paths",
                "arguments",
                "timeout_seconds",
            },
            path=f"{path}/judge",
        )
    )
    judge_kind = _string(judge_raw.get("kind"), f"{path}/judge/kind", issues)
    if judge_kind and judge_kind != "python":
        issues.append(
            _issue(
                f"{path}/judge/kind",
                "schema.choice",
                "The V1 Study lane requires judge.kind 'python'",
            )
        )
    judge_entrypoint = _relative_path(
        judge_raw.get("entrypoint"),
        f"{path}/judge/entrypoint",
        issues,
    )
    judge_values = judge_raw.get("paths")
    judge_paths: list[str] = []
    if not isinstance(judge_values, list) or not judge_values:
        issues.append(
            _issue(
                f"{path}/judge/paths",
                "schema.array",
                "Must contain at least one fixed Judge source path or closure",
            )
        )
    else:
        judge_paths = [
            _path_pattern(value, f"{path}/judge/paths/{index}", issues)
            for index, value in enumerate(judge_values)
        ]
        if len(judge_paths) != len(set(judge_paths)):
            issues.append(
                _issue(
                    f"{path}/judge/paths",
                    "study.duplicate-path",
                    "Judge paths must be unique",
                )
            )
    arguments = judge_raw.get("arguments")
    judge_arguments: list[str] = []
    if not isinstance(arguments, list) or not all(
        isinstance(argument, str) for argument in arguments
    ):
        issues.append(
            _issue(
                f"{path}/judge/arguments",
                "schema.array",
                "Judge arguments must be an array of strings",
            )
        )
    else:
        judge_arguments = list(arguments)
    timeout = judge_raw.get("timeout_seconds")
    if not isinstance(timeout, int) or isinstance(timeout, bool) or not 1 <= timeout <= 3600:
        issues.append(
            _issue(
                f"{path}/judge/timeout_seconds",
                "schema.range",
                "Judge timeout_seconds must be an integer from 1 to 3600",
            )
        )
        timeout = 60

    objective_raw = _object(raw.get("objective"), f"{path}/objective", issues)
    issues.extend(
        _strict_keys(
            objective_raw,
            required={"metric", "direction", "minimum_improvement"},
            path=f"{path}/objective",
        )
    )
    metric = _string(
        objective_raw.get("metric"),
        f"{path}/objective/metric",
        issues,
    )
    if metric and not METRIC_ID.fullmatch(metric):
        issues.append(
            _issue(
                f"{path}/objective/metric",
                "schema.metric",
                "Metric must use lowercase letters, digits, dot, underscore, or hyphen",
            )
        )
    direction = _string(
        objective_raw.get("direction"),
        f"{path}/objective/direction",
        issues,
    )
    if direction and direction not in DIRECTIONS:
        issues.append(
            _issue(
                f"{path}/objective/direction",
                "schema.choice",
                "Direction must be 'maximize' or 'minimize'",
            )
        )
    minimum_improvement = objective_raw.get("minimum_improvement")
    if (
        not isinstance(minimum_improvement, (int, float))
        or isinstance(minimum_improvement, bool)
        or not math.isfinite(float(minimum_improvement))
        or float(minimum_improvement) < 0
    ):
        issues.append(
            _issue(
                f"{path}/objective/minimum_improvement",
                "schema.number",
                "minimum_improvement must be a finite non-negative number",
            )
        )
        minimum_improvement = 0.0

    dataset_raw = _object(raw.get("dataset"), f"{path}/dataset", issues)
    dataset_required = {"id", "version", "asset_class", "universe", "time_range"}
    issues.extend(
        _strict_keys(
            dataset_raw,
            required=dataset_required | ({"paths"} if "paths" in dataset_raw else set()),
            path=f"{path}/dataset",
        )
    )
    dataset_id = _string(dataset_raw.get("id"), f"{path}/dataset/id", issues)
    dataset_version = _string(
        dataset_raw.get("version"),
        f"{path}/dataset/version",
        issues,
    )
    asset_class = _string(
        dataset_raw.get("asset_class"),
        f"{path}/dataset/asset_class",
        issues,
    )
    universe_raw = dataset_raw.get("universe")
    universe: list[str] = []
    if (
        not isinstance(universe_raw, list)
        or not universe_raw
        or not all(isinstance(asset, str) and asset.strip() for asset in universe_raw)
    ):
        issues.append(
            _issue(
                f"{path}/dataset/universe",
                "schema.array",
                "Dataset universe must contain at least one non-empty asset id",
            )
        )
    else:
        universe = list(universe_raw)
        if len(universe) != len(set(universe)):
            issues.append(
                _issue(
                    f"{path}/dataset/universe",
                    "dataset.duplicate-asset",
                    "Dataset universe assets must be unique",
                )
            )
    dataset_paths_raw = dataset_raw.get("paths")
    dataset_paths: list[str] | None = None
    if "paths" in dataset_raw:
        if not isinstance(dataset_paths_raw, list) or not dataset_paths_raw:
            issues.append(
                _issue(
                    f"{path}/dataset/paths",
                    "schema.array",
                    "Dataset paths must contain at least one data-relative file or closure",
                )
            )
            dataset_paths = []
        else:
            dataset_paths = [
                _path_pattern(value, f"{path}/dataset/paths/{index}", issues)
                for index, value in enumerate(dataset_paths_raw)
            ]
            if len(dataset_paths) != len(set(dataset_paths)):
                issues.append(
                    _issue(
                        f"{path}/dataset/paths",
                        "dataset.duplicate-path",
                        "Dataset paths must be unique",
                    )
                )
    time_range_raw = _object(
        dataset_raw.get("time_range"),
        f"{path}/dataset/time_range",
        issues,
    )
    issues.extend(
        _strict_keys(
            time_range_raw,
            required={"start", "end"},
            path=f"{path}/dataset/time_range",
        )
    )
    start = _string(
        time_range_raw.get("start"),
        f"{path}/dataset/time_range/start",
        issues,
    )
    end = _string(
        time_range_raw.get("end"),
        f"{path}/dataset/time_range/end",
        issues,
    )
    if start and end:
        try:
            if len(start) == 10 and len(end) == 10:
                start_value: date | datetime = date.fromisoformat(start)
                end_value: date | datetime = date.fromisoformat(end)
            elif len(start) != 10 and len(end) != 10:
                start_value = datetime.fromisoformat(start.replace("Z", "+00:00"))
                end_value = datetime.fromisoformat(end.replace("Z", "+00:00"))
                if start_value.tzinfo is None or end_value.tzinfo is None:
                    raise ValueError("timezone-aware timestamps required")
            else:
                raise ValueError("mixed date and timestamp precision")
            if start_value > end_value:
                issues.append(
                    _issue(
                        f"{path}/dataset/time_range",
                        "dataset.time-range",
                        "Dataset start must not be after end",
                    )
                )
        except ValueError:
            issues.append(
                _issue(
                    f"{path}/dataset/time_range",
                    "dataset.time-range",
                    "Dataset time range must use either YYYY-MM-DD dates or "
                    "timezone-aware ISO-8601 timestamps at one precision",
                )
            )

    if issues:
        raise AutoQuantValidationError(issues)
    return StudyDefinition(
        schema_version=SCHEMA_VERSION,
        id=study_id,
        name=name,
        description=description,
        program=program,
        subject=StudySubject(subject_kind, subject_name, subject_version),
        editable={"paths": editable_paths},
        judge=StudyJudge(
            "python",
            judge_entrypoint,
            judge_paths,
            judge_arguments,
            timeout,
        ),
        objective=StudyObjective(
            metric,
            direction,
            float(minimum_improvement),
        ),
        dataset=StudyDataset(
            dataset_id,
            dataset_version,
            asset_class,
            universe,
            StudyTimeRange(start, end),
            dataset_paths,
        ),
        dependencies=dependencies,
        research_request=research_request,
        upstream_evidence=upstream_evidence,
    )


def path_matches_pattern(path: str, pattern: str) -> bool:
    if not pattern.endswith("/**"):
        return path == pattern
    root = pattern[:-3]
    return path == root or path.startswith(f"{root}/")


def _snapshot_pattern(
    project: ProjectContext,
    pattern: str,
) -> dict[str, str]:
    closure = pattern.endswith("/**")
    relative = pattern[:-3] if closure else pattern
    root = confined_path(project.root_dir, relative, f"source/{pattern}")
    if closure:
        if not root.is_dir():
            raise AutoQuantValidationError(
                [
                    _issue(
                        root,
                        "study.source-directory",
                        f"Source closure root is not a directory: {relative}",
                    )
                ]
            )
        files: dict[str, str] = {}
        for path in sorted(root.rglob("*")):
            if IGNORED_SOURCE_NAMES.intersection(path.relative_to(root).parts):
                continue
            if path.is_symlink():
                raise AutoQuantValidationError(
                    [
                        _issue(
                            path,
                            "path.symlink",
                            f"Source closure contains a symlink: {path}",
                        )
                    ]
                )
            if path.is_file() and path.suffix != ".pyc":
                project_relative = path.relative_to(project.root_dir).as_posix()
                files[project_relative] = hash_file(path)
        return files
    if not root.is_file():
        raise AutoQuantValidationError(
            [
                _issue(
                    root,
                    "study.source-file",
                    f"Exact source path is not a file: {relative}",
                )
            ]
        )
    return {relative: hash_file(root)}


def snapshot_patterns(
    project: ProjectContext,
    patterns: list[str],
) -> dict[str, str]:
    files: dict[str, str] = {}
    for pattern in patterns:
        for relative, content_hash in _snapshot_pattern(project, pattern).items():
            previous = files.get(relative)
            if previous is not None and previous != content_hash:
                raise RuntimeError(f"Conflicting source identity for {relative}")
            files[relative] = content_hash
    return dict(sorted(files.items()))


def _snapshot_data_pattern(data_root: Path, pattern: str) -> dict[str, str]:
    closure = pattern.endswith("/**")
    relative = pattern[:-3] if closure else pattern
    root = confined_path(data_root, relative, f"dataset/{pattern}")
    if closure:
        if not root.is_dir():
            raise AutoQuantValidationError(
                [
                    _issue(
                        root,
                        "dataset.directory",
                        f"Dataset closure root is not a directory: {relative}",
                    )
                ]
            )
        files: dict[str, str] = {}
        for path in sorted(root.rglob("*")):
            if path.is_symlink():
                raise AutoQuantValidationError(
                    [
                        _issue(
                            path,
                            "path.symlink",
                            f"Dataset closure contains a symlink: {path}",
                        )
                    ]
                )
            if path.is_file():
                data_relative = path.relative_to(data_root).as_posix()
                files[data_relative] = hash_file(path)
        if not files:
            raise AutoQuantValidationError(
                [
                    _issue(
                        root,
                        "dataset.empty",
                        f"Dataset closure contains no files: {relative}",
                    )
                ]
            )
        return files
    if not root.is_file():
        raise AutoQuantValidationError(
            [
                _issue(
                    root,
                    "dataset.file",
                    f"Exact dataset path is not a file: {relative}",
                )
            ]
        )
    return {relative: hash_file(root)}


def snapshot_dataset(
    data_root: Path,
    patterns: list[str],
) -> dict[str, str]:
    raw_root = data_root.expanduser().absolute()
    if raw_root.is_symlink() or not raw_root.is_dir():
        raise AutoQuantValidationError(
            [_issue(raw_root, "dataset.root", "Dataset root must be a real directory")]
        )
    resolved_root = raw_root.resolve()
    files: dict[str, str] = {}
    for pattern in patterns:
        for relative, content_hash in _snapshot_data_pattern(
            resolved_root,
            pattern,
        ).items():
            previous = files.get(relative)
            if previous is not None and previous != content_hash:
                raise RuntimeError(f"Conflicting dataset identity for {relative}")
            files[relative] = content_hash
    return dict(sorted(files.items()))


def _read_json(path: Path) -> dict[str, Any]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise AutoQuantValidationError(
            [_issue(path, "manifest.missing", f"Missing Study manifest: {path}")]
        ) from None
    except json.JSONDecodeError as error:
        raise AutoQuantValidationError(
            [
                _issue(
                    path,
                    "json.invalid",
                    f"Invalid JSON at line {error.lineno}, column {error.colno}: {error.msg}",
                )
            ]
        ) from None
    if not isinstance(raw, dict):
        raise AutoQuantValidationError(
            [_issue(path, "schema.type", "Study manifest must be a JSON object")]
        )
    return raw


def _study_root(project: ProjectContext, study_id: str) -> Path:
    studies_root = confined_path(
        project.root_dir,
        project.manifest.directories["studies"],
        "project/directories/studies",
    )
    return confined_path(studies_root, study_id, f"study/{study_id}")


def _load_study_root(
    project: ProjectContext,
    root: Path,
    *,
    expected_id: str,
    data_root: Path | None = None,
    upstream_project: ProjectContext | None = None,
) -> StudyContext:
    if root.is_symlink() or not root.is_dir():
        raise AutoQuantValidationError(
            [_issue(root, "study.directory", "Study must be a real directory")]
        )
    manifest_path = root / STUDY_MANIFEST
    definition = parse_study_definition(_read_json(manifest_path), manifest_path)
    if definition.id != expected_id:
        raise AutoQuantValidationError(
            [
                _issue(
                    f"{manifest_path}/id",
                    "study.directory-id",
                    f"Study id '{definition.id}' must match directory '{expected_id}'",
                )
            ]
        )
    program_path = confined_path(root, definition.program, f"{manifest_path}/program")
    if not program_path.is_file():
        raise AutoQuantValidationError(
            [
                _issue(
                    program_path,
                    "study.program",
                    f"Missing Study program: {program_path}",
                )
            ]
        )
    judge_entrypoint = confined_path(
        project.root_dir,
        definition.judge.entrypoint,
        f"{manifest_path}/judge/entrypoint",
    )
    if not judge_entrypoint.is_file():
        raise AutoQuantValidationError(
            [
                _issue(
                    judge_entrypoint,
                    "study.judge-entrypoint",
                    f"Missing Python Judge entrypoint: {judge_entrypoint}",
                )
            ]
        )

    judge_root = project.manifest.directories["judges"]
    invalid_judge = []
    for pattern in definition.judge.paths:
        relative = pattern[:-3] if pattern.endswith("/**") else pattern
        if not (
            relative == judge_root or relative.startswith(f"{judge_root}/")
        ):
            invalid_judge.append(pattern)
    if invalid_judge:
        raise AutoQuantValidationError(
            [
                _issue(
                    f"{manifest_path}/judge/paths",
                    "study.judge-surface",
                    "Judge paths must stay under the Project Judge directory: "
                    + ", ".join(invalid_judge),
                )
            ]
        )
    judge_hashes = snapshot_patterns(project, definition.judge.paths)
    if definition.judge.entrypoint not in judge_hashes:
        raise AutoQuantValidationError(
            [
                _issue(
                    f"{manifest_path}/judge/entrypoint",
                    "study.judge-closure",
                    "Judge entrypoint must be included in judge.paths",
                )
            ]
        )
    allowed_editable_roots = [
        project.manifest.directories[key]
        for key in ("strategies", "factors", "models")
    ]
    invalid_editable = []
    for pattern in definition.editable["paths"]:
        relative = pattern[:-3] if pattern.endswith("/**") else pattern
        if not any(
            relative == allowed or relative.startswith(f"{allowed}/")
            for allowed in allowed_editable_roots
        ):
            invalid_editable.append(pattern)
    if invalid_editable:
        raise AutoQuantValidationError(
            [
                _issue(
                    f"{manifest_path}/editable/paths",
                    "study.editable-surface",
                    "Editable paths must stay under Project strategy, factor, or "
                    "model source directories: "
                    + ", ".join(invalid_editable),
                )
            ]
        )
    editable_hashes = snapshot_patterns(project, definition.editable["paths"])
    dependency_hashes: dict[str, str] = {}
    dependency_hash: str | None = None
    if definition.dependencies is not None:
        exact_request_dependencies = set()
        if definition.research_request is not None:
            exact_request_dependencies.add(definition.research_request.path)
            if definition.research_request.position_snapshot_path is not None:
                exact_request_dependencies.add(
                    definition.research_request.position_snapshot_path
                )
        invalid_dependencies = []
        for pattern in definition.dependencies["paths"]:
            relative = pattern[:-3] if pattern.endswith("/**") else pattern
            if pattern not in exact_request_dependencies and not any(
                    relative == allowed or relative.startswith(f"{allowed}/")
                    for allowed in allowed_editable_roots
                ):
                invalid_dependencies.append(pattern)
        if invalid_dependencies:
            raise AutoQuantValidationError(
                [
                    _issue(
                        f"{manifest_path}/dependencies/paths",
                        "study.dependency-surface",
                        "Dependency paths must stay under Project strategy, factor, "
                        "or model source directories unless they are exact "
                        "Study-owned request files: "
                        + ", ".join(invalid_dependencies),
                    )
                ]
            )
        dependency_hashes = snapshot_patterns(
            project,
            definition.dependencies["paths"],
        )
        if not dependency_hashes:
            raise AutoQuantValidationError(
                [
                    _issue(
                        f"{manifest_path}/dependencies/paths",
                        "study.dependency-empty",
                        "Dependency closure must contain at least one source file",
                    )
                ]
            )
        overlap = sorted(editable_hashes.keys() & dependency_hashes.keys())
        if overlap:
            raise AutoQuantValidationError(
                [
                    _issue(
                        f"{manifest_path}/dependencies/paths",
                        "study.dependency-editable-overlap",
                        "Dependency files cannot also be editable: "
                        + ", ".join(overlap),
                    )
                ]
            )
        dependency_hash = hash_json(dependency_hashes)
    if definition.research_request is not None:
        required_request_paths = [definition.research_request.path]
        if definition.research_request.position_snapshot_path is not None:
            required_request_paths.append(
                definition.research_request.position_snapshot_path
            )
        missing_request_paths = [
            relative
            for relative in required_request_paths
            if relative not in dependency_hashes
        ]
        if missing_request_paths:
            raise AutoQuantValidationError(
                [
                    _issue(
                        f"{manifest_path}/research_request",
                        "study.request-dependency",
                        "Study-owned request files must be exact fixed dependencies: "
                        + ", ".join(missing_request_paths),
                    )
                ]
            )
        from .briefs import load_research_request

        request = load_research_request(
            project.root_dir / definition.research_request.path
        )
        if definition.research_request.position_snapshot_path is not None:
            from .position_snapshots import load_position_snapshot

            snapshot_path = (
                project.root_dir
                / definition.research_request.position_snapshot_path
            )
            snapshot = load_position_snapshot(snapshot_path)
            if snapshot["source"]["requestHash"] != hash_json(request):
                raise AutoQuantValidationError(
                    [
                        _issue(
                            snapshot_path,
                            "study.request-snapshot",
                            "Position snapshot requestHash differs from the "
                            "Study-owned Research Request",
                        )
                    ]
                )

    upstream_evidence_hash: str | None = None
    if definition.upstream_evidence is not None:
        upstream = definition.upstream_evidence
        if (
            upstream_project is not None
            and upstream_project.manifest.id != project.manifest.id
        ):
            raise AutoQuantValidationError(
                [
                    _issue(
                        f"{manifest_path}/upstream_evidence",
                        "study.upstream-project",
                        "Upstream evidence must resolve inside the same Project",
                    )
                ]
            )
        if upstream.study_id == definition.id:
            raise AutoQuantValidationError(
                [
                    _issue(
                        f"{manifest_path}/upstream_evidence/study_id",
                        "study.upstream-self",
                        "A Study cannot derive from a prior Run of itself",
                    )
                ]
            )
        from .runs import load_run

        source_run = load_run(upstream_project or project, upstream.run_id)
        upstream_issues: list[ValidationIssue] = []
        if source_run.result["study"]["id"] != upstream.study_id:
            upstream_issues.append(
                _issue(
                    f"{manifest_path}/upstream_evidence/study_id",
                    "study.upstream-study",
                    "Upstream Study id differs from the immutable source Run",
                )
            )
        if source_run.manifest["resultHash"] != upstream.result_hash:
            upstream_issues.append(
                _issue(
                    f"{manifest_path}/upstream_evidence/result_hash",
                    "study.upstream-result",
                    "Upstream result hash differs from the immutable source Run",
                )
            )
        if source_run.result["studyInputHash"] != upstream.study_input_hash:
            upstream_issues.append(
                _issue(
                    f"{manifest_path}/upstream_evidence/study_input_hash",
                    "study.upstream-input",
                    "Upstream Study input hash differs from the immutable source Run",
                )
            )
        declared_artifacts = {
            item["path"] for item in source_run.result["artifacts"]
        }
        for artifact in upstream.artifacts:
            artifact_file = source_run.root_dir / artifact.path
            if artifact.path not in declared_artifacts:
                upstream_issues.append(
                    _issue(
                        f"{manifest_path}/upstream_evidence/artifacts",
                        "study.upstream-artifact",
                        f"Source Run does not declare artifact: {artifact.path}",
                    )
                )
                continue
            actual_hash = source_run.manifest["files"].get(artifact.path)
            if actual_hash != artifact.sha256:
                upstream_issues.append(
                    _issue(
                        f"{manifest_path}/upstream_evidence/artifacts",
                        "study.upstream-artifact-hash",
                        f"Upstream artifact hash differs: {artifact.path}",
                    )
                )
        if upstream_issues:
            raise AutoQuantValidationError(upstream_issues)
        upstream_evidence_hash = hash_json(
            definition.to_dict()["upstream_evidence"]
        )
    study_manifest_relative = (
        Path(project.manifest.directories["studies"])
        / definition.id
        / STUDY_MANIFEST
    ).as_posix()
    program_relative = (
        Path(project.manifest.directories["studies"])
        / definition.id
        / definition.program
    ).as_posix()
    protected = {study_manifest_relative, program_relative, *judge_hashes}
    escaped = sorted(
        path
        for path in protected
        if any(
            path_matches_pattern(path, pattern)
            for pattern in definition.editable["paths"]
        )
    )
    if escaped:
        raise AutoQuantValidationError(
            [
                _issue(
                    f"{manifest_path}/editable/paths",
                    "study.editable-judge-overlap",
                    "Editable closure contains fixed Study/Judge paths: "
                    + ", ".join(escaped),
                )
            ]
        )

    definition_dict = definition.to_dict()
    study_hash = hash_json(definition_dict)
    program_hash = hash_file(program_path)
    judge_hash = hash_json(judge_hashes)
    source_hash = hash_json(editable_hashes)
    dataset_hashes = (
        snapshot_dataset(
            data_root
            or confined_path(
                project.root_dir,
                project.manifest.directories["data"],
                "project/directories/data",
            ),
            definition.dataset.paths,
        )
        if definition.dataset.paths is not None
        else {}
    )
    dataset_hash = hash_json(
        {
            "definition": definition_dict["dataset"],
            "sourceHashes": dataset_hashes,
        }
        if definition.dataset.paths is not None
        else definition_dict["dataset"]
    )
    input_identity = {
        "studyHash": study_hash,
        "programHash": program_hash,
        "judgeHash": judge_hash,
        "sourceHash": source_hash,
        "datasetHash": dataset_hash,
    }
    if dependency_hash is not None:
        input_identity["dependencyHash"] = dependency_hash
    if upstream_evidence_hash is not None:
        input_identity["upstreamEvidenceHash"] = upstream_evidence_hash
    input_hash = hash_json(input_identity)
    return StudyContext(
        root_dir=root,
        manifest_path=manifest_path,
        program_path=program_path,
        definition=definition,
        study_hash=study_hash,
        program_hash=program_hash,
        judge_hashes=judge_hashes,
        judge_hash=judge_hash,
        editable_hashes=editable_hashes,
        source_hash=source_hash,
        dependency_hashes=dependency_hashes,
        dependency_hash=dependency_hash,
        upstream_evidence_hash=upstream_evidence_hash,
        dataset_hashes=dataset_hashes,
        dataset_hash=dataset_hash,
        input_hash=input_hash,
    )


def load_study(
    project: ProjectContext,
    study_id: str,
    *,
    data_root: Path | None = None,
    upstream_project: ProjectContext | None = None,
) -> StudyContext:
    if not STUDY_ID.fullmatch(study_id):
        raise AutoQuantValidationError(
            [_issue(study_id, "schema.id", "Study id must use lowercase kebab-case")]
        )
    return _load_study_root(
        project,
        _study_root(project, study_id),
        expected_id=study_id,
        data_root=data_root,
        upstream_project=upstream_project,
    )


def list_studies(project: ProjectContext) -> list[StudySummary]:
    studies_root = confined_path(
        project.root_dir,
        project.manifest.directories["studies"],
        "project/directories/studies",
    )
    summaries: list[StudySummary] = []
    issues: list[ValidationIssue] = []
    for entry in sorted(studies_root.iterdir(), key=lambda path: path.name):
        if entry.name.startswith("."):
            continue
        if entry.is_symlink() or not entry.is_dir():
            issues.append(
                _issue(
                    entry,
                    "study.entry",
                    "Study entries must be real directories",
                )
            )
            continue
        try:
            study = _load_study_root(project, entry, expected_id=entry.name)
        except AutoQuantValidationError as error:
            issues.extend(error.issues)
            continue
        summaries.append(
            StudySummary(
                id=study.definition.id,
                name=study.definition.name,
                description=study.definition.description,
                subject_kind=study.definition.subject.kind,
                primary_metric=study.definition.objective.metric,
                direction=study.definition.objective.direction,
                path=str(study.root_dir),
            )
        )
    if issues:
        raise AutoQuantValidationError(issues)
    return summaries


def _program_text(name: str, description: str) -> str:
    purpose = description.strip() or "Describe the bounded research question."
    return f"""# {name}

## Research question

{purpose}

## Operating rules

- Change only the editable source closure declared in `study.json`.
- Keep the Study, program, Judge, dataset identity, and objective fixed.
- Make one falsifiable code change at a time.
- Execute the Study through `aq run execute`; do not call the Judge directly.
- Inspect the immutable RunResult before deciding KEEP, REVERT, or BRANCH.
- Prefer explanations that survive the declared universe and time range.
"""


def create_study(
    project: ProjectContext,
    definition: StudyDefinition,
) -> StudyContext:
    if not STUDY_ID.fullmatch(definition.id):
        raise AutoQuantValidationError(
            [_issue(definition.id, "schema.id", "Study id must use lowercase kebab-case")]
        )
    target = _study_root(project, definition.id)
    if target.exists() or target.is_symlink():
        raise AutoQuantValidationError(
            [_issue(target, "study.exists", f"Study already exists: {target}")]
        )
    temporary = target.parent / f".{definition.id}.creating"
    if temporary.exists():
        shutil.rmtree(temporary)
    try:
        temporary.mkdir()
        (temporary / STUDY_MANIFEST).write_text(
            json.dumps(definition.to_dict(), indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        (temporary / definition.program).parent.mkdir(parents=True, exist_ok=True)
        (temporary / definition.program).write_text(
            _program_text(definition.name, definition.description),
            encoding="utf-8",
        )
        _load_study_root(project, temporary, expected_id=definition.id)
        os.replace(temporary, target)
    except Exception:
        if temporary.exists():
            shutil.rmtree(temporary)
        raise
    return load_study(project, definition.id)


def copy_hashed_files(
    project: ProjectContext,
    hashes: dict[str, str],
    destination: Path,
) -> None:
    for relative, expected_hash in hashes.items():
        source = confined_path(project.root_dir, relative, f"source/{relative}")
        if hash_file(source) != expected_hash:
            raise AutoQuantValidationError(
                [
                    _issue(
                        source,
                        "study.source-stale",
                        f"Source changed while materializing Study input: {relative}",
                    )
                ]
            )
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(source.read_bytes())


def bind_upstream_evidence(
    project: ProjectContext,
    run_id: str,
    artifact_paths: list[str],
) -> StudyUpstreamEvidence:
    """Build one exact prior-Run evidence binding for a new Study."""

    from .runs import load_run

    run = load_run(project, run_id)
    declared = {item["path"] for item in run.result["artifacts"]}
    issues: list[ValidationIssue] = []
    artifacts: list[StudyUpstreamArtifact] = []
    for index, relative in enumerate(artifact_paths):
        if not isinstance(relative, str):
            issues.append(
                _issue(
                    f"upstream-artifact/{index}",
                    "study.upstream-artifact",
                    "Must be a confined declared Run artifact path",
                )
            )
            continue
        candidate = PurePosixPath(relative)
        if (
            not relative
            or "\\" in relative
            or candidate.is_absolute()
            or ".." in candidate.parts
            or not relative.startswith("artifacts/")
        ):
            issues.append(
                _issue(
                    f"upstream-artifact/{index}",
                    "study.upstream-artifact",
                    "Must be a confined declared Run artifact path",
                )
            )
            continue
        if relative not in declared:
            issues.append(
                _issue(
                    f"upstream-artifact/{index}",
                    "study.upstream-artifact",
                    f"Source Run does not declare artifact: {relative}",
                )
            )
            continue
        content_hash = run.manifest["files"].get(relative)
        if not isinstance(content_hash, str):
            issues.append(
                _issue(
                    f"upstream-artifact/{index}",
                    "study.upstream-artifact",
                    f"Source Run manifest does not bind artifact: {relative}",
                )
            )
            continue
        artifacts.append(StudyUpstreamArtifact(relative, content_hash))
    if len(artifact_paths) != len(set(artifact_paths)):
        issues.append(
            _issue(
                "upstream-artifact",
                "study.duplicate-path",
                "Upstream artifact paths must be unique",
            )
        )
    if not artifact_paths:
        issues.append(
            _issue(
                "upstream-artifact",
                "schema.array",
                "At least one upstream Run artifact is required",
            )
        )
    if issues:
        raise AutoQuantValidationError(issues)
    return StudyUpstreamEvidence(
        run_id=run.result["id"],
        study_id=run.result["study"]["id"],
        result_hash=run.manifest["resultHash"],
        study_input_hash=run.result["studyInputHash"],
        artifacts=artifacts,
    )


def materialize_upstream_evidence(
    project: ProjectContext,
    study: StudyContext,
    destination: Path,
) -> None:
    """Copy the exact selected prior-Run artifacts plus their binding."""

    upstream = study.definition.upstream_evidence
    if upstream is None:
        return
    from .runs import load_run

    run = load_run(project, upstream.run_id)
    target = destination / upstream.run_id
    target.mkdir(parents=True)
    binding = {
        **asdict(upstream),
        "evidence_hash": study.upstream_evidence_hash,
    }
    (target / "binding.json").write_text(
        json.dumps(binding, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    for artifact in upstream.artifacts:
        source = run.root_dir / artifact.path
        if hash_file(source) != artifact.sha256:
            raise AutoQuantValidationError(
                [
                    _issue(
                        source,
                        "study.upstream-artifact-stale",
                        f"Upstream artifact changed while materializing: {artifact.path}",
                    )
                ]
            )
        output = target / artifact.path
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(source.read_bytes())


STUDY_JSON_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "AutoQuant Study",
    "type": "object",
    "additionalProperties": False,
    "required": [
        "schema_version",
        "id",
        "name",
        "description",
        "program",
        "subject",
        "editable",
        "judge",
        "objective",
        "dataset",
    ],
    "properties": {
        "schema_version": {"const": SCHEMA_VERSION},
        "id": {"type": "string", "pattern": STUDY_ID.pattern},
        "name": {"type": "string", "minLength": 1},
        "description": {"type": "string"},
        "program": {"type": "string", "minLength": 1},
        "subject": {
            "type": "object",
            "additionalProperties": False,
            "required": ["kind", "name", "version"],
            "properties": {
                "kind": {"enum": sorted(SUBJECT_KINDS)},
                "name": {"type": "string", "minLength": 1},
                "version": {"type": "string", "minLength": 1},
            },
        },
        "editable": {
            "type": "object",
            "additionalProperties": False,
            "required": ["paths"],
            "properties": {
                "paths": {
                    "type": "array",
                    "items": {"type": "string", "minLength": 1},
                }
            },
        },
        "dependencies": {
            "type": "object",
            "additionalProperties": False,
            "required": ["paths"],
            "properties": {
                "paths": {
                    "type": "array",
                    "minItems": 1,
                    "uniqueItems": True,
                    "items": {"type": "string", "minLength": 1},
                }
            },
        },
        "research_request": {
            "type": "object",
            "additionalProperties": False,
            "required": ["path"],
            "properties": {
                "path": {"type": "string", "minLength": 1},
                "position_snapshot_path": {
                    "type": "string",
                    "minLength": 1,
                },
            },
        },
        "upstream_evidence": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "run_id",
                "study_id",
                "result_hash",
                "study_input_hash",
                "artifacts",
            ],
            "properties": {
                "run_id": {"type": "string", "pattern": RUN_ID.pattern},
                "study_id": {"type": "string", "pattern": STUDY_ID.pattern},
                "result_hash": {
                    "type": "string",
                    "pattern": SHA256.pattern,
                },
                "study_input_hash": {
                    "type": "string",
                    "pattern": SHA256.pattern,
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
                                "pattern": SHA256.pattern,
                            },
                        },
                    },
                },
            },
        },
        "judge": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "kind",
                "entrypoint",
                "paths",
                "arguments",
                "timeout_seconds",
            ],
            "properties": {
                "kind": {"const": "python"},
                "entrypoint": {"type": "string", "minLength": 1},
                "paths": {
                    "type": "array",
                    "minItems": 1,
                    "items": {"type": "string", "minLength": 1},
                },
                "arguments": {"type": "array", "items": {"type": "string"}},
                "timeout_seconds": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 3600,
                },
            },
        },
        "objective": {
            "type": "object",
            "additionalProperties": False,
            "required": ["metric", "direction", "minimum_improvement"],
            "properties": {
                "metric": {"type": "string", "pattern": METRIC_ID.pattern},
                "direction": {"enum": sorted(DIRECTIONS)},
                "minimum_improvement": {"type": "number", "minimum": 0},
            },
        },
        "dataset": {
            "type": "object",
            "additionalProperties": False,
            "required": ["id", "version", "asset_class", "universe", "time_range"],
            "properties": {
                "id": {"type": "string", "minLength": 1},
                "version": {"type": "string", "minLength": 1},
                "asset_class": {"type": "string", "minLength": 1},
                "universe": {
                    "type": "array",
                    "minItems": 1,
                    "uniqueItems": True,
                    "items": {"type": "string", "minLength": 1},
                },
                "time_range": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["start", "end"],
                    "properties": {
                        "start": {
                            "anyOf": [
                                {"type": "string", "format": "date"},
                                {"type": "string", "format": "date-time"},
                            ]
                        },
                        "end": {
                            "anyOf": [
                                {"type": "string", "format": "date"},
                                {"type": "string", "format": "date-time"},
                            ]
                        },
                    },
                },
                "paths": {
                    "type": "array",
                    "minItems": 1,
                    "uniqueItems": True,
                    "items": {"type": "string", "minLength": 1},
                },
            },
        },
    },
}
