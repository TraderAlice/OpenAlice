"""Versioned machine-readable CLI envelopes."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .workspace import (
    AutoQuantValidationError,
    ProjectContext,
    ValidationIssue,
    WorkspaceContext,
)


CLI_SCHEMA_VERSION = 1


class CliCommandError(RuntimeError):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        retryable: bool = False,
        issues: list[ValidationIssue] | None = None,
        context: dict[str, Any] | None = None,
    ):
        self.code = code
        self.retryable = retryable
        self.issues = issues or []
        self.context = context or global_context()
        super().__init__(message)


def global_context() -> dict[str, Any]:
    return {"scope": "global"}


def workspace_context(workspace: WorkspaceContext) -> dict[str, Any]:
    return {
        "scope": "workspace",
        "workspace": {
            "name": workspace.manifest.name,
            "rootDir": str(workspace.root_dir),
            "projectsDir": str(workspace.projects_dir),
            "defaultProject": workspace.manifest.default_project,
            "configurationSource": workspace.configuration_source,
            "configurationPath": str(workspace.configuration_path),
        },
    }


def project_context(project: ProjectContext) -> dict[str, Any]:
    return {
        "scope": "project",
        "project": {
            "id": project.manifest.id,
            "name": project.manifest.name,
            "rootDir": str(project.root_dir),
        },
    }


def artifact(
    kind: str,
    artifact_id: str,
    path: str | Path,
    *,
    immutable: bool,
) -> dict[str, Any]:
    return {
        "kind": kind,
        "id": artifact_id,
        "path": str(path),
        "immutable": immutable,
    }


def next_action(
    action_id: str,
    description: str,
    argv: list[str],
    effect: str,
) -> dict[str, Any]:
    return {
        "id": action_id,
        "description": description,
        "argv": argv,
        "effect": effect,
    }


def success_envelope(
    command: str,
    data: Any,
    *,
    context: dict[str, Any] | None = None,
    diagnostics: list[Any] | None = None,
    artifacts: list[dict[str, Any]] | None = None,
    next_actions: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    return {
        "schemaVersion": CLI_SCHEMA_VERSION,
        "ok": True,
        "command": command,
        "context": context or global_context(),
        "data": data,
        "diagnostics": diagnostics or [],
        "artifacts": artifacts or [],
        "nextActions": next_actions or [],
    }


def error_envelope(
    command: str,
    error: Exception,
    *,
    usage: bool = False,
) -> dict[str, Any]:
    if isinstance(error, CliCommandError):
        code = error.code
        retryable = error.retryable
        issues = error.issues
        context = error.context
    elif isinstance(error, AutoQuantValidationError):
        code = "validation.failed"
        retryable = False
        issues = error.issues
        context = global_context()
    else:
        code = "cli.usage" if usage else "operation.failed"
        retryable = False
        issues = []
        context = global_context()
    return {
        "schemaVersion": CLI_SCHEMA_VERSION,
        "ok": False,
        "command": command,
        "context": context,
        "error": {
            "code": code,
            "message": str(error),
            "retryable": retryable,
            "issues": [issue.to_dict() for issue in issues],
        },
    }
