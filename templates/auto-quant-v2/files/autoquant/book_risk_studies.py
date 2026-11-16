"""Append independently fixed Book Risk Studies to an existing Project."""

from __future__ import annotations

import json
import shutil
from datetime import date, datetime
from pathlib import Path
from typing import Any

from .briefs import load_research_request
from .intake import (
    PROJECT_REQUEST,
    PreparedIntake,
    load_project_intake,
    materialize_intake_dataset,
    prepare_project_intake,
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
    StudyJudge,
    StudyObjective,
    StudySubject,
    StudyTimeRange,
    create_study,
    load_study,
)
from .workspace import (
    SCHEMA_VERSION,
    AutoQuantValidationError,
    ProjectContext,
    ValidationIssue,
    confined_path,
)


BOOK_RISK_TEMPLATE = "ohlcv-book-risk-lab"
BOOK_RISK_STUDY_SOURCES = "strategies/book-risk-studies"
BOOK_RISK_STUDY_JUDGES = "judges/book-risk-studies"
DEFAULT_METHOD = "strategies/book-risk-scenarios.json"


def _issue(path: Path | str, code: str, message: str) -> ValidationIssue:
    return ValidationIssue(str(path), code, message)


def _write_json(path: Path, value: dict[str, Any]) -> None:
    path.write_text(
        json.dumps(value, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _book_risk_judge_source() -> bytes:
    return (
        Path(__file__).parent
        / "project_templates"
        / "ohlcv_book_risk_lab"
        / "judge.py"
    ).read_bytes()


def _same_dataset_request(
    request: dict[str, Any],
    original_request: dict[str, Any],
    primary: StudyContext,
    request_path: Path,
    *,
    require_retained_range: bool,
) -> None:
    issues: list[ValidationIssue] = []
    if request["assets"] != original_request["assets"]:
        issues.append(
            _issue(
                f"{request_path}/assets",
                "study-intake.dataset-assets",
                "A same-Project Book Risk Study must preserve the original "
                "request asset descriptions exactly; acquire a task-complete "
                "new Project dataset when the universe or roles differ",
            )
        )
    snapshot = request.get("positionSnapshot")
    if not isinstance(snapshot, dict):
        issues.append(
            _issue(
                f"{request_path}/positionSnapshot",
                "request.position-snapshot-required",
                "Book Risk Study intake requires one explicit positionSnapshot",
            )
        )
    elif require_retained_range:
        try:
            as_of = datetime.fromisoformat(
                snapshot["asOf"].replace("Z", "+00:00")
            )
            if len(primary.definition.dataset.time_range.start) == 10:
                as_of = as_of.date()
                start = date.fromisoformat(
                    primary.definition.dataset.time_range.start
                )
                end = date.fromisoformat(
                    primary.definition.dataset.time_range.end
                )
            else:
                start = datetime.fromisoformat(
                    primary.definition.dataset.time_range.start.replace(
                        "Z", "+00:00"
                    )
                )
                end = datetime.fromisoformat(
                    primary.definition.dataset.time_range.end.replace(
                        "Z", "+00:00"
                    )
                )
            if not start <= as_of <= end:
                raise ValueError
        except (KeyError, TypeError, ValueError):
            issues.append(
                _issue(
                    f"{request_path}/positionSnapshot/asOf",
                    "study-intake.dataset-range",
                    "Position snapshot asOf must lie inside the retained "
                    "content-locked Study dataset range",
                )
            )
    if issues:
        raise AutoQuantValidationError(issues)


def _validate_refresh_dataset(
    prepared: PreparedIntake,
    primary: StudyContext,
    primary_snapshot: dict[str, Any],
    dataset_path: Path,
) -> None:
    """Keep one refresh comparable while admitting a new immutable vintage."""

    issues: list[ValidationIssue] = []
    expected = {
        "assetClass": primary_snapshot["assetClass"],
        "market": primary_snapshot["market"],
        "priceAdjustment": primary_snapshot["priceAdjustment"],
    }
    for key, value in expected.items():
        if prepared.package.get(key) != value:
            issues.append(
                _issue(
                    dataset_path,
                    f"study-intake.dataset-{key}",
                    f"Refreshed dataset {key} must match the original "
                    "Project dataset",
                )
            )
    if (
        prepared.package["id"] == primary.definition.dataset.id
        and prepared.package["version"] == primary.definition.dataset.version
    ):
        issues.append(
            _issue(
                dataset_path,
                "study-intake.dataset-identity",
                "Refreshed dataset must declare a new package id or version",
            )
        )
    if prepared.universe != list(primary.definition.dataset.universe):
        issues.append(
            _issue(
                dataset_path,
                "study-intake.dataset-universe",
                "Refreshed dataset universe and order must match the original "
                "Book Risk Study exactly",
            )
        )
    if prepared.start != primary.definition.dataset.time_range.start:
        issues.append(
            _issue(
                dataset_path,
                "study-intake.dataset-start",
                "Refreshed dataset must preserve the original start boundary",
            )
        )
    try:
        if len(prepared.end) == 10:
            newer = date.fromisoformat(prepared.end) > date.fromisoformat(
                primary.definition.dataset.time_range.end
            )
        else:
            newer = datetime.fromisoformat(
                prepared.end.replace("Z", "+00:00")
            ) > datetime.fromisoformat(
                primary.definition.dataset.time_range.end.replace(
                    "Z", "+00:00"
                )
            )
    except ValueError:
        newer = False
    if not newer:
        issues.append(
            _issue(
                dataset_path,
                "study-intake.dataset-not-newer",
                "Refreshed dataset must end after the original Study dataset",
            )
        )
    if issues:
        raise AutoQuantValidationError(issues)


def create_book_risk_study_intake(
    project: ProjectContext,
    study_id: str,
    request_path: str | Path,
    *,
    name: str | None = None,
    dataset_path: str | Path | None = None,
) -> tuple[StudyContext, dict[str, Any]]:
    """Add one fixed Book Risk Study over retained or refreshed evidence."""

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
    intake = load_project_intake(project)
    if intake is None or intake["manifest"]["template"] != BOOK_RISK_TEMPLATE:
        raise AutoQuantValidationError(
            [
                _issue(
                    project.root_dir,
                    "study-intake.project-template",
                    "Book Risk Study intake requires an existing request-bound "
                    "ohlcv-book-risk-lab Project",
                )
            ]
        )
    primary = load_study(project, intake["manifest"]["studyId"])
    raw_request_path = Path(request_path).expanduser().absolute()
    if raw_request_path.is_symlink():
        raise AutoQuantValidationError(
            [
                _issue(
                    raw_request_path,
                    "path.symlink",
                    "Research Request cannot be a symlink",
                )
            ]
        )
    request = load_research_request(raw_request_path)
    original_request = load_research_request(project.root_dir / PROJECT_REQUEST)
    _same_dataset_request(
        request,
        original_request,
        primary,
        raw_request_path,
        require_retained_range=dataset_path is None,
    )
    prepared = None
    raw_dataset_path = None
    if dataset_path is not None:
        raw_dataset_path = Path(dataset_path).expanduser().absolute()
        prepared = prepare_project_intake(
            raw_request_path,
            raw_dataset_path,
            BOOK_RISK_TEMPLATE,
        )
        _validate_refresh_dataset(
            prepared,
            primary,
            intake["dataset"],
            raw_dataset_path,
        )
    position_snapshot = build_position_snapshot(request)
    validate_position_snapshot(position_snapshot, raw_request_path)

    source_relative = f"{BOOK_RISK_STUDY_SOURCES}/{study_id}"
    judge_relative = f"{BOOK_RISK_STUDY_JUDGES}/{study_id}"
    source_root = confined_path(project.root_dir, source_relative, source_relative)
    judge_root = confined_path(project.root_dir, judge_relative, judge_relative)
    study_root = confined_path(
        project.root_dir / project.manifest.directories["studies"],
        study_id,
        f"study/{study_id}",
    )
    dataset_owner_root = confined_path(
        project.root_dir / project.manifest.directories["data"],
        f"studies/{study_id}",
        f"study/{study_id}/dataset",
    )
    occupied = [
        path
        for path in (
            source_root,
            judge_root,
            study_root,
            *([dataset_owner_root] if prepared is not None else []),
        )
        if path.exists() or path.is_symlink()
    ]
    if occupied:
        raise AutoQuantValidationError(
            [
                _issue(
                    occupied[0],
                    "study.exists",
                    f"Study-owned path already exists: {occupied[0]}",
                )
            ]
        )

    request_relative = f"{source_relative}/request.json"
    snapshot_relative = f"{source_relative}/position-snapshot.json"
    method_relative = f"{source_relative}/book-risk-scenarios.json"
    entrypoint_relative = f"{judge_relative}/judge.py"
    dataset_root_relative = f"studies/{study_id}"
    dataset_relative = f"{dataset_root_relative}/ohlcv"
    method_source = confined_path(project.root_dir, DEFAULT_METHOD, DEFAULT_METHOD)
    if method_source.is_symlink() or not method_source.is_file():
        raise AutoQuantValidationError(
            [
                _issue(
                    method_source,
                    "study-intake.method",
                    "The retained Book Risk method must be a real file",
                )
            ]
        )

    try:
        source_root.mkdir(parents=True)
        judge_root.mkdir(parents=True)
        dataset_snapshot = None
        dataset_snapshot_hash = None
        if prepared is None:
            _write_json(project.root_dir / request_relative, request)
        else:
            dataset_snapshot, dataset_snapshot_hash = materialize_intake_dataset(
                project,
                prepared,
                study_id,
                dataset_relative=dataset_relative,
                request_relative=request_relative,
            )
        _write_json(project.root_dir / snapshot_relative, position_snapshot)
        (project.root_dir / method_relative).write_bytes(method_source.read_bytes())
        (project.root_dir / entrypoint_relative).write_bytes(
            _book_risk_judge_source()
        )
        definition = StudyDefinition(
            schema_version=SCHEMA_VERSION,
            id=study_id,
            name=name or request["title"],
            description=request["question"],
            program="program.md",
            subject=StudySubject(
                "research",
                "reported-book-risk",
                "working",
            ),
            editable={"paths": []},
            judge=StudyJudge(
                "python",
                entrypoint_relative,
                [entrypoint_relative],
                [
                    "--position-snapshot",
                    snapshot_relative,
                    "--scenarios",
                    method_relative,
                    *(
                        ["--dataset-root", dataset_root_relative]
                        if prepared is not None
                        else []
                    ),
                ],
                30,
            ),
            objective=StudyObjective(
                "current_component_risk_hhi",
                "minimize",
                0.01,
            ),
            dataset=StudyDataset(
                (
                    prepared.package["id"]
                    if prepared is not None
                    else primary.definition.dataset.id
                ),
                (
                    prepared.package["version"]
                    if prepared is not None
                    else primary.definition.dataset.version
                ),
                (
                    prepared.package["assetClass"]
                    if prepared is not None
                    else primary.definition.dataset.asset_class
                ),
                (
                    list(prepared.universe)
                    if prepared is not None
                    else list(primary.definition.dataset.universe)
                ),
                StudyTimeRange(
                    (
                        prepared.start
                        if prepared is not None
                        else primary.definition.dataset.time_range.start
                    ),
                    (
                        prepared.end
                        if prepared is not None
                        else primary.definition.dataset.time_range.end
                    ),
                ),
                (
                    [f"{dataset_relative}/**"]
                    if prepared is not None
                    else (
                        list(primary.definition.dataset.paths)
                        if primary.definition.dataset.paths is not None
                        else None
                    )
                ),
            ),
            dependencies={
                "paths": [
                    request_relative,
                    snapshot_relative,
                    method_relative,
                ]
            },
        )
        study = create_study(project, definition)
        study.program_path.write_text(
            "# Fixed Book Risk follow-up\n\n"
            "This Study evaluates the canonical request, position snapshot, "
            "and covariance method bound in its fixed dependencies over the "
            + (
                "independent content-locked Study dataset. "
                if prepared is not None
                else "retained content-locked Project dataset. "
            )
            + "It has no editable "
            "candidate, selection loop, account, Order, or trading authority.\n",
            encoding="utf-8",
        )
        study = load_study(project, study_id)
    except Exception:
        if study_root.exists():
            shutil.rmtree(study_root)
        if source_root.exists():
            shutil.rmtree(source_root)
        if judge_root.exists():
            shutil.rmtree(judge_root)
        if dataset_owner_root.exists():
            shutil.rmtree(dataset_owner_root)
        for parent in (
            source_root.parent,
            judge_root.parent,
            dataset_owner_root.parent,
        ):
            try:
                parent.rmdir()
            except OSError:
                pass
        raise

    result = {
        "requestPath": request_relative,
        "requestHash": position_snapshot["source"]["requestHash"],
        "positionSnapshotPath": snapshot_relative,
        "positionSnapshotId": position_snapshot["id"],
        "methodPath": method_relative,
        "datasetHash": study.dataset_hash,
        "sourceProjectStudyId": primary.definition.id,
        "datasetMode": (
            "study-owned-refresh"
            if prepared is not None
            else "retained-project-intake"
        ),
    }
    if prepared is not None:
        assert dataset_snapshot is not None
        assert dataset_snapshot_hash is not None
        result.update(
            {
                "datasetSnapshotPath": (
                    f"{project.manifest.directories['data']}/"
                    f"{dataset_relative}/snapshot.json"
                ),
                "datasetSnapshotHash": dataset_snapshot_hash,
                "datasetId": dataset_snapshot["id"],
                "datasetVersion": dataset_snapshot["version"],
                "datasetTimeRange": dataset_snapshot["timeRange"],
            }
        )
    return study, result
