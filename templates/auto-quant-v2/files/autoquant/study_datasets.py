"""Atomic external OHLCV ownership for one fixed Project-local Study."""

from __future__ import annotations

import json
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .intake import (
    PreparedIntake,
    materialize_intake_dataset,
    prepare_study_dataset_intake,
)
from .position_snapshots import (
    build_position_snapshot,
    validate_position_snapshot,
)
from .studies import (
    STUDY_ID,
    StudyContext,
    StudyDataset,
    StudyDefinition,
    StudyResearchRequest,
    StudyTimeRange,
    create_study,
)
from .workspace import (
    AutoQuantValidationError,
    ProjectContext,
    ValidationIssue,
    confined_path,
)


@dataclass(frozen=True)
class StudyDatasetIntake:
    """A fully validated, not-yet-materialized Study dataset binding."""

    study_id: str
    prepared: PreparedIntake
    dataset: StudyDataset
    research_request: StudyResearchRequest
    generated_dependencies: list[str]
    position_snapshot: dict[str, Any] | None
    source_root: Path
    data_owner_root: Path
    study_root: Path
    cleanup_parents: tuple[Path, ...]


def _issue(path: Path | str, code: str, message: str) -> ValidationIssue:
    return ValidationIssue(str(path), code, message)


def _write_json(path: Path, value: dict[str, Any]) -> None:
    path.write_text(
        json.dumps(value, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def prepare_study_owned_dataset(
    project: ProjectContext,
    study_id: str,
    request_path: str | Path,
    package_path: str | Path,
) -> StudyDatasetIntake:
    """Validate one package and prove its canonical owned paths are free."""

    if not STUDY_ID.fullmatch(study_id):
        raise AutoQuantValidationError(
            [
                _issue(
                    study_id,
                    "schema.id",
                    "Study id must use lowercase kebab-case",
                )
            ]
        )
    raw_request = Path(request_path).expanduser().absolute()
    if raw_request.is_symlink():
        raise AutoQuantValidationError(
            [
                _issue(
                    raw_request,
                    "path.symlink",
                    "Research Request cannot be a symlink",
                )
            ]
        )
    prepared = prepare_study_dataset_intake(raw_request, package_path)

    strategies_root = project.manifest.directories["strategies"]
    studies_root = project.manifest.directories["studies"]
    data_root_relative = project.manifest.directories["data"]
    source_relative = f"{strategies_root}/{study_id}"
    request_relative = f"{source_relative}/request.json"
    position_relative = f"{source_relative}/position-snapshot.json"
    dataset_owner_relative = f"studies/{study_id}"
    dataset_relative = f"{dataset_owner_relative}/ohlcv"

    source_root = confined_path(
        project.root_dir,
        source_relative,
        f"study/{study_id}/request-owner",
    )
    data_root = confined_path(
        project.root_dir,
        data_root_relative,
        "project/directories/data",
    )
    data_owner_root = confined_path(
        data_root,
        dataset_owner_relative,
        f"study/{study_id}/dataset-owner",
    )
    study_parent = confined_path(
        project.root_dir,
        studies_root,
        "project/directories/studies",
    )
    study_root = confined_path(
        study_parent,
        study_id,
        f"study/{study_id}",
    )
    occupied = [
        path
        for path in (source_root, data_owner_root, study_root)
        if path.exists() or path.is_symlink()
    ]
    if occupied:
        raise AutoQuantValidationError(
            [
                _issue(
                    occupied[0],
                    "study.intake-owned-path",
                    f"Study-owned path already exists: {occupied[0]}",
                )
            ]
        )

    position_snapshot = None
    generated_dependencies = [request_relative]
    position_snapshot_path = None
    if isinstance(prepared.request.get("positionSnapshot"), dict):
        position_snapshot = build_position_snapshot(prepared.request)
        validate_position_snapshot(position_snapshot, raw_request)
        position_snapshot_path = position_relative
        generated_dependencies.append(position_relative)

    cleanup_parents = tuple(
        path
        for path in (source_root.parent, data_owner_root.parent)
        if not path.exists() and not path.is_symlink()
    )
    return StudyDatasetIntake(
        study_id=study_id,
        prepared=prepared,
        dataset=StudyDataset(
            prepared.package["id"],
            prepared.package["version"],
            prepared.package["assetClass"],
            list(prepared.universe),
            StudyTimeRange(prepared.start, prepared.end),
            [f"{dataset_relative}/**"],
        ),
        research_request=StudyResearchRequest(
            request_relative,
            position_snapshot_path,
        ),
        generated_dependencies=generated_dependencies,
        position_snapshot=position_snapshot,
        source_root=source_root,
        data_owner_root=data_owner_root,
        study_root=study_root,
        cleanup_parents=cleanup_parents,
    )


def _remove_owned_path(path: Path) -> None:
    if path.is_symlink():
        path.unlink()
    elif path.exists():
        shutil.rmtree(path)


def rollback_study_owned_dataset(binding: StudyDatasetIntake) -> None:
    """Remove only paths that were proven absent before this intake began."""

    for path in (
        binding.study_root,
        binding.source_root,
        binding.data_owner_root,
    ):
        _remove_owned_path(path)
    for parent in sorted(
        binding.cleanup_parents,
        key=lambda path: len(path.parts),
        reverse=True,
    ):
        try:
            parent.rmdir()
        except OSError:
            pass


def create_study_with_owned_dataset(
    project: ProjectContext,
    definition: StudyDefinition,
    binding: StudyDatasetIntake,
) -> StudyContext:
    """Materialize the binding and create its Study as one CLI transaction."""

    issues: list[ValidationIssue] = []
    if definition.id != binding.study_id:
        issues.append(
            _issue(
                definition.id,
                "study.intake-id",
                "Study definition id differs from prepared dataset owner",
            )
        )
    if definition.dataset != binding.dataset:
        issues.append(
            _issue(
                definition.id,
                "study.intake-dataset",
                "Study definition must use the inferred external dataset contract",
            )
        )
    if definition.research_request != binding.research_request:
        issues.append(
            _issue(
                definition.id,
                "study.intake-request",
                "Study definition must bind the generated Research Request",
            )
        )
    declared_dependencies = (
        definition.dependencies["paths"]
        if definition.dependencies is not None
        else []
    )
    missing = [
        path
        for path in binding.generated_dependencies
        if path not in declared_dependencies
    ]
    if missing:
        issues.append(
            _issue(
                definition.id,
                "study.intake-dependencies",
                "Study definition is missing generated fixed dependencies: "
                + ", ".join(missing),
            )
        )
    if issues:
        raise AutoQuantValidationError(issues)

    dataset_relative = f"studies/{binding.study_id}/ohlcv"
    try:
        materialize_intake_dataset(
            project,
            binding.prepared,
            binding.study_id,
            dataset_relative=dataset_relative,
            request_relative=binding.research_request.path,
        )
        if binding.position_snapshot is not None:
            assert binding.research_request.position_snapshot_path is not None
            _write_json(
                project.root_dir
                / binding.research_request.position_snapshot_path,
                binding.position_snapshot,
            )
        return create_study(project, definition)
    except Exception:
        rollback_study_owned_dataset(binding)
        raise
