"""Human- and Agent-facing AutoQuant command line interface."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Sequence

from .allocation_explorer import (
    ALLOCATION_DIAGNOSTICS_JSON_SCHEMA,
    DEFAULT_ALLOCATION_POINTS,
    MAX_ALLOCATION_POINTS,
    MIN_ALLOCATION_POINTS,
    load_allocation_diagnostics,
)
from .allocation_policies import ALLOCATION_POLICY_JSON_SCHEMA
from .briefs import RESEARCH_REQUEST_JSON_SCHEMA, load_research_request
from .book_risk_explorer import (
    BOOK_RISK_DIAGNOSTICS_JSON_SCHEMA,
    DEFAULT_BOOK_RISK_POINTS,
    MAX_BOOK_RISK_POINTS,
    MIN_BOOK_RISK_POINTS,
    load_book_risk_diagnostics,
)
from .book_risk_studies import create_book_risk_study_intake
from .book_path_stress import BOOK_PATH_STRESS_POLICY_JSON_SCHEMA
from .book_path_stress_explorer import (
    BOOK_PATH_STRESS_DIAGNOSTICS_JSON_SCHEMA,
    load_book_path_stress_diagnostics,
)
from .capabilities import CLI_COMMANDS
from .candidate_contracts import (
    FACTOR_CANDIDATE_CONTRACT_JSON_SCHEMA,
    build_candidate_contract,
)
from .checks import (
    CANDIDATE_CHECK_RESULT_JSON_SCHEMA,
    CHECK_OUTPUT,
    CHECK_OUTPUT_JSON_SCHEMA,
    CHECK_RESULT,
    PREFLIGHT_JSON_SCHEMA,
    candidate_check_state,
    execute_candidate_check,
)
from .decision_matrix import (
    DEFAULT_COMPARISON_TRIALS,
    MAX_COMPARISON_TRIALS,
    MIN_COMPARISON_TRIALS,
    SESSION_DECISION_MATRIX_JSON_SCHEMA,
    load_session_decision_matrix,
)
from .decision_support import summarize_leader_decision_support
from .dossiers import (
    DOSSIER_ANALYSIS_JSON_SCHEMA,
    DOSSIER_RESULT_JSON_SCHEMA,
    DOSSIER_STATUS_JSON_SCHEMA,
    list_dossiers,
    load_dossier,
    load_dossier_analysis,
    load_dossier_status,
    publish_dossier,
)
from .factor_explorer import (
    DEFAULT_FACTOR_POINTS,
    FACTOR_DIAGNOSTICS_JSON_SCHEMA,
    MAX_FACTOR_POINTS,
    MIN_FACTOR_POINTS,
    load_factor_diagnostics,
)
from .factor_claims import FACTOR_CLAIM_JSON_SCHEMA
from .event_studies import EVENT_STUDY_POLICY_JSON_SCHEMA
from .event_explorer import (
    EVENT_STUDY_DIAGNOSTICS_JSON_SCHEMA,
    load_event_study_diagnostics,
)
from .cli_contract import (
    CliCommandError,
    artifact,
    error_envelope,
    global_context,
    next_action,
    project_context,
    success_envelope,
    workspace_context,
)
from .runs import (
    JUDGE_OUTPUT_JSON_SCHEMA,
    RUN_RESULT_JSON_SCHEMA,
    execute_study,
    harness_identity,
    list_runs,
    load_run,
)
from .research import (
    CAMPAIGN_PROGRESS_JSON_SCHEMA,
    CAMPAIGN_RESULT_JSON_SCHEMA,
    RESEARCHER_RESPONSE_JSON_SCHEMA,
    list_campaigns,
    load_campaign,
    run_campaign,
)
from .reports import (
    REPORT_ANALYSIS_JSON_SCHEMA,
    build_session_report_analysis_draft,
    list_reports,
    load_report,
    load_report_analysis,
    publish_report,
)
from .run_reports import (
    build_run_report_analysis_draft,
    list_run_reports,
    load_run_report,
    publish_run_report,
)
from .reviews import (
    REVIEW_ANALYSIS_JSON_SCHEMA,
    list_reviews,
    load_review,
    load_review_analysis,
    load_review_package,
    publish_review,
)
from .intake import (
    INTAKE_TEMPLATE_REQUIREMENTS,
    OHLCV_DATASET_PACKAGE_JSON_SCHEMA,
    PROJECT_INTAKE,
    PROJECT_REQUEST,
    DATASET_SNAPSHOT,
    dataset_snapshot_class_context,
    intake_dataset_class_context,
    load_project_intake,
    load_study_dataset_snapshot,
    prepare_project_intake,
)
from .study_datasets import (
    create_study_with_owned_dataset,
    prepare_study_owned_dataset,
    rollback_study_owned_dataset,
)
from .holdouts import (
    HOLDOUT_ASSESSMENT_ANALYSIS_JSON_SCHEMA,
    HOLDOUT_ASSESSMENT_JSON_SCHEMA,
    HOLDOUT_BINDING_JSON_SCHEMA,
    HOLDOUT_RESULT_JSON_SCHEMA,
    HOLDOUT_STATUS_JSON_SCHEMA,
    bind_holdout,
    build_holdout_evidence,
    create_holdout_target,
    load_holdout_assessment,
    load_holdout_assessment_analysis,
    load_holdout_binding,
    load_holdout_result,
    load_holdout_status,
    publish_holdout_assessment,
    run_holdout,
)
from .mandates import PORTFOLIO_MANDATE_JSON_SCHEMA
from .prediction_modes import FACTOR_POPULATION_JSON_SCHEMA
from .horizons import RESEARCH_HORIZON_JSON_SCHEMA
from .orientation import (
    AGENT_WORK_BRIEF_JSON_SCHEMA,
    build_agent_work_brief,
)
from .research_agenda import RESEARCH_AGENDA_JSON_SCHEMA
from .portfolio_explorer import (
    DEFAULT_PORTFOLIO_POINTS,
    MAX_PORTFOLIO_POINTS,
    MIN_PORTFOLIO_POINTS,
    PORTFOLIO_DIAGNOSTICS_JSON_SCHEMA,
    load_portfolio_diagnostics,
)
from .rl_explorer import (
    DEFAULT_RL_POINTS,
    MAX_RL_POINTS,
    MIN_RL_POINTS,
    RL_DIAGNOSTICS_JSON_SCHEMA,
    load_rl_diagnostics,
)
from .research_program import (
    RESEARCH_PROGRAM_MANIFEST,
    RESEARCH_PROGRAM_STATUS_JSON_SCHEMA,
    RESEARCH_DESK_TEMPLATE,
    load_research_program,
)
from .studio import (
    STUDIO_SNAPSHOT_JSON_SCHEMA,
    build_studio_snapshot,
    resolve_studio_launch,
    serve_studio,
)
from .templates import (
    PROJECT_TEMPLATE_IDS,
    TEMPLATE_STUDY_IDS,
    TEMPLATE_STUDY_SEQUENCES,
    project_template_routes,
)
from .sessions import (
    EXPERIMENT_JSON_SCHEMA,
    SESSION_COMPLETION_JSON_SCHEMA,
    SESSION_JSON_SCHEMA,
    complete_session,
    evaluate_experiment,
    list_experiments,
    list_sessions,
    load_experiment,
    load_session,
    promote_session,
    resolve_session_worktree_owner,
    session_snapshot,
    start_session,
)
from .studies import (
    STUDY_JSON_SCHEMA,
    StudyDataset,
    StudyDefinition,
    StudyJudge,
    StudyObjective,
    StudySubject,
    StudyTimeRange,
    StudyResearchRequest,
    bind_upstream_evidence,
    create_study,
    list_studies,
    load_study,
)
from .workspace import (
    AutoQuantValidationError,
    FRAMEWORK_NEEDS,
    PROJECT_MANIFEST,
    WORKSPACE_MANIFEST,
    ValidationIssue,
    confined_path,
    create_or_intake_project,
    create_project,
    initialize_workspace,
    inspect_project,
    list_workspace_projects,
    load_project,
    load_workspace,
    resolve_project_directory,
    schema_for as workspace_schema_for,
    set_default_project,
)
from .version import current_version


class CliUsageError(ValueError):
    pass


PROJECT_SELECTION_HELP = (
    "Project id inside a Workspace; required for Project-local state changes "
    "when the Workspace contains multiple Projects"
)


class RaisingArgumentParser(argparse.ArgumentParser):
    def add_argument(self, *args, **kwargs):
        if "--project" in args and "help" not in kwargs:
            kwargs["help"] = PROJECT_SELECTION_HELP
        return super().add_argument(*args, **kwargs)

    def error(self, message: str) -> None:
        raise CliUsageError(message)


@dataclass
class CommandResult:
    command: str
    data: Any
    human: str
    context: dict[str, Any] = field(default_factory=global_context)
    artifacts: list[dict[str, Any]] = field(default_factory=list)
    next_actions: list[dict[str, Any]] = field(default_factory=list)


def _report_decision_support_line(report: dict[str, Any]) -> str:
    summary = summarize_leader_decision_support(
        report["evidence"].get("leaderDecisionSupport")
    )
    portfolio = summary["portfolio"]
    if summary["available"] and isinstance(portfolio, dict):
        return (
            "Frozen leader decision: "
            f"{portfolio['timestamp']}  "
            f"state_changes={portfolio['stateChanges']}  "
            f"decision_eligible={portfolio['decisionEligible']}  "
            "decision_schedule="
            f"{json.dumps(portfolio['decisionSchedule'], sort_keys=True)}  "
            f"decision_session={portfolio['decisionSession']}  "
            f"proposed_turnover={portfolio['proposedOneWayTurnover']}  "
            f"no_trade_band={portfolio['noTradeOneWay']}  "
            f"gate={portfolio['reason']}  trading_authority=none\n"
        )
    if summary["reason"] == "not-portfolio-leader":
        return "Frozen leader decision: not applicable to this Study lane\n"
    return "Frozen leader decision: unavailable in legacy Report\n"


def _json_argument(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--json",
        action="store_true",
        help="emit one versioned machine-readable JSON envelope",
    )


def build_parser() -> RaisingArgumentParser:
    parser = RaisingArgumentParser(
        prog="aq",
        description=(
            "AutoQuant V2 — one standardized quantitative workbench with "
            "many self-contained Projects."
        ),
    )
    parser.add_argument(
        "--version",
        action="version",
        version=f"aq {current_version()}",
    )
    subcommands = parser.add_subparsers(dest="command", required=True)

    version_command = subcommands.add_parser(
        "version",
        help="report exact installed or source Harness identity",
    )
    version_command.set_defaults(command_id="version")
    _json_argument(version_command)

    capabilities = subcommands.add_parser(
        "capabilities",
        help="describe every public command for Agents",
    )
    capabilities.set_defaults(command_id="capabilities")
    _json_argument(capabilities)

    schema = subcommands.add_parser(
        "schema",
        help="list or emit canonical manifest JSON Schemas",
    )
    schema.add_argument(
        "kind",
        nargs="?",
        choices=[
            "workspace",
            "project",
            "agent-work-brief",
            "research-agenda",
            "holdout-binding",
            "holdout-result",
            "holdout-assessment-analysis",
            "holdout-assessment",
            "holdout-status",
            "study",
            "judge-output",
            "run-result",
            "factor-candidate-contract",
            "factor-diagnostics",
            "factor-claim",
            "event-study-policy",
            "event-study-diagnostics",
            "book-path-stress-policy",
            "book-path-stress-diagnostics",
            "allocation-policy",
            "allocation-diagnostics",
            "book-risk-diagnostics",
            "portfolio-diagnostics",
            "research-program-status",
            "rl-policy-diagnostics",
            "session-decision-matrix",
            "session",
            "session-completion",
            "candidate-preflight",
            "candidate-check-output",
            "candidate-check-result",
            "portfolio-mandate",
            "factor-population",
            "research-horizon",
            "experiment",
            "researcher-response",
            "campaign-result",
            "campaign-progress",
            "research-request",
            "ohlcv-dataset-package",
            "report-analysis",
            "review-analysis",
            "dossier-analysis",
            "dossier-result",
            "dossier-status",
            "studio-snapshot",
        ],
    )
    schema.set_defaults(command_id="schema")
    _json_argument(schema)

    workspace = subcommands.add_parser("workspace", help="manage a Workspace")
    workspace_actions = workspace.add_subparsers(dest="workspace_action", required=True)
    workspace_init = workspace_actions.add_parser(
        "init",
        help="initialize an empty or explicitly adopted Workspace directory",
        description=(
            "Initialize an AutoQuant Workspace. The target must be absent or "
            "empty unless --adopt-existing is passed. Adoption preserves "
            "existing caller files but refuses existing Workspace "
            "configuration or projects entries."
        ),
    )
    workspace_init.add_argument(
        "directory",
        help="new Workspace directory",
    )
    workspace_init.add_argument(
        "--name",
        help="Workspace display name",
    )
    workspace_init.add_argument(
        "--adopt-existing",
        action="store_true",
        help=(
            "preserve existing files and initialize this directory; refuses "
            "existing manifests or projects entries"
        ),
    )
    workspace_init.set_defaults(command_id="workspace.init")
    _json_argument(workspace_init)

    project = subcommands.add_parser("project", help="manage Projects")
    project_actions = project.add_subparsers(dest="project_action", required=True)
    project_templates = project_actions.add_parser(
        "templates",
        help="show fit and anti-fit contracts for every Project construction route",
    )
    project_templates.set_defaults(command_id="project.templates")
    _json_argument(project_templates)
    project_create = project_actions.add_parser(
        "create",
        help="create a self-contained Project; inspect 'aq project templates' first",
    )
    project_create.add_argument("workspace")
    project_create.add_argument("project_id")
    project_create.add_argument("--name")
    project_create.add_argument("--description", default="")
    project_create.add_argument(
        "--template",
        choices=PROJECT_TEMPLATE_IDS,
        default="blank",
        help=(
            "Project construction route; run 'aq project templates' before "
            "choosing a single-lane Lab or coordinated Research Desk"
        ),
    )
    project_create.set_defaults(command_id="project.create")
    _json_argument(project_create)

    project_intake = project_actions.add_parser(
        "intake",
        help=(
            "create or hydrate a pristine Project from a research request "
            "and OHLCV package"
        ),
    )
    project_intake.add_argument("workspace")
    project_intake.add_argument("project_id")
    project_intake.add_argument(
        "--request",
        required=True,
        help=(
            "strict delegated Research Request JSON file; source "
            "artifactPath and artifactRevision must both be non-null or both "
            "be null"
        ),
    )
    project_intake.add_argument(
        "--dataset",
        required=True,
        help=(
            "dataset-package manifest JSON file, not its containing "
            "directory; asset paths resolve from the manifest directory, so "
            "place it at staged files' common ancestor (for example "
            "staging/dataset-package.json with raw-ohlcv/AAPL.csv) to avoid "
            "an intermediate copy; V4-V6 are ohlcv-factor-lab only"
        ),
    )
    project_intake.add_argument(
        "--template",
        choices=tuple(INTAKE_TEMPLATE_REQUIREMENTS),
        default=RESEARCH_DESK_TEMPLATE,
        help=(
            "request-bound construction route; Factor-to-Portfolio or "
            "Factor-to-RL work requires ohlcv-research-desk; inspect "
            "'aq project templates'"
        ),
    )
    project_intake.add_argument("--name")
    project_intake.set_defaults(command_id="project.intake")
    _json_argument(project_intake)

    project_list = project_actions.add_parser("list", help="list Workspace Projects")
    project_list.add_argument("workspace")
    project_list.set_defaults(command_id="project.list")
    _json_argument(project_list)

    project_default = project_actions.add_parser(
        "default",
        help="select the default Project",
    )
    project_default.add_argument("workspace")
    project_default.add_argument("project_id")
    project_default.set_defaults(command_id="project.default")
    _json_argument(project_default)

    project_program = project_actions.add_parser(
        "program",
        help="inspect one verified multi-Study research program",
    )
    project_program.add_argument("path")
    project_program.add_argument("--project")
    project_program.set_defaults(command_id="project.program")
    _json_argument(project_program)

    orient = subcommands.add_parser(
        "orient",
        help=(
            "give a research Agent one verified work brief and bounded "
            "evidence-driven experiment agenda; locked Session worktrees "
            "re-enter their owning Project read-only"
        ),
    )
    orient.add_argument("path")
    orient.add_argument("--project")
    orient.set_defaults(command_id="orient")
    _json_argument(orient)

    for command in ("validate", "inspect"):
        command_parser = subcommands.add_parser(
            command,
            help=f"{command} one resolved Project",
        )
        command_parser.add_argument("path")
        command_parser.add_argument("--project")
        command_parser.set_defaults(command_id=command)
        _json_argument(command_parser)

    study = subcommands.add_parser("study", help="manage fixed quantitative Studies")
    study_actions = study.add_subparsers(dest="study_action", required=True)
    study_intake = study_actions.add_parser(
        "intake",
        help=(
            "append one request-owned fixed Book Risk Study over an existing "
            "Project dataset"
        ),
    )
    study_intake.add_argument("path")
    study_intake.add_argument("study_id")
    study_intake.add_argument("--project")
    study_intake.add_argument(
        "--request",
        required=True,
        help=(
            "strict Research Request with the same asset descriptions as the "
            "retained Book Risk Project"
        ),
    )
    study_intake.add_argument(
        "--dataset",
        help=(
            "optional complete newer OHLCV dataset package for an immutable "
            "Study-owned data vintage"
        ),
    )
    study_intake.add_argument("--name")
    study_intake.set_defaults(command_id="study.intake")
    _json_argument(study_intake)

    study_create = study_actions.add_parser(
        "create",
        help=(
            "create one fixed Project-local Study, optionally with an atomic "
            "external request/OHLCV intake"
        ),
    )
    study_create.add_argument("path")
    study_create.add_argument("study_id")
    study_create.add_argument("--project")
    study_create.add_argument("--name")
    study_create.add_argument("--description", default="")
    study_create.add_argument(
        "--subject-kind",
        choices=["strategy", "factor", "model", "research"],
        required=True,
    )
    study_create.add_argument("--subject-name")
    study_create.add_argument("--subject-version", default="working")
    study_create.add_argument("--judge", required=True)
    study_create.add_argument("--judge-path", action="append")
    study_create.add_argument("--judge-arg", action="append", default=[])
    editable_surface = study_create.add_mutually_exclusive_group(required=True)
    editable_surface.add_argument(
        "--editable",
        action="append",
        help="repeatable Agent-editable file or trailing /** closure",
    )
    editable_surface.add_argument(
        "--no-editable",
        action="store_true",
        help="declare a fixed descriptive Study with no candidate Session surface",
    )
    study_create.add_argument(
        "--dependency",
        action="append",
        help=(
            "repeatable fixed Project-relative strategy, factor, or model source "
            "path or trailing /** closure; an exact Study-owned request file is "
            "also allowed"
        ),
    )
    study_create.add_argument(
        "--request-path",
        help=(
            "explicit Project-relative Study-owned Research Request; the exact "
            "file must also be declared with --dependency"
        ),
    )
    study_create.add_argument(
        "--request",
        help=(
            "external strict Research Request to materialize as this Study's "
            "canonical fixed request; requires --dataset and cannot be mixed "
            "with --request-path or manual dataset identity options"
        ),
    )
    study_create.add_argument(
        "--dataset",
        help=(
            "external V1-V3 OHLCV dataset-package manifest to validate, "
            "normalize, and bind under this Study; requires --request"
        ),
    )
    study_create.add_argument(
        "--position-snapshot-path",
        help=(
            "optional fixed position snapshot paired with --request-path; the "
            "exact file must also be declared with --dependency"
        ),
    )
    study_create.add_argument(
        "--upstream-run",
        help="one prior immutable Run whose exact artifacts feed this new Study",
    )
    study_create.add_argument(
        "--upstream-artifact",
        action="append",
        help=(
            "repeatable artifact path declared by --upstream-run, such as "
            "artifacts/selected-episodes.csv"
        ),
    )
    study_create.add_argument("--metric", default="score")
    study_create.add_argument(
        "--direction",
        choices=["maximize", "minimize"],
        default="maximize",
    )
    study_create.add_argument("--minimum-improvement", type=float, default=0.0)
    study_create.add_argument(
        "--dataset-id",
        help="manual-form dataset id; required unless external intake is used",
    )
    study_create.add_argument(
        "--dataset-version",
        help="manual-form dataset version (default: working)",
    )
    study_create.add_argument(
        "--dataset-path",
        action="append",
        help=(
            "repeatable manual-form Project-data-relative file or trailing "
            "/** closure; external intake infers its own closure"
        ),
    )
    study_create.add_argument(
        "--asset-class",
        help="manual-form dataset class; required unless external intake is used",
    )
    study_create.add_argument(
        "--asset",
        action="append",
        help="repeatable manual-form universe; required unless external intake is used",
    )
    study_create.add_argument(
        "--start",
        help="manual-form dataset start; required unless external intake is used",
    )
    study_create.add_argument(
        "--end",
        help="manual-form dataset end; required unless external intake is used",
    )
    study_create.add_argument("--timeout", type=int, default=60)
    study_create.set_defaults(command_id="study.create")
    _json_argument(study_create)

    study_list = study_actions.add_parser("list", help="list Project Studies")
    study_list.add_argument("path")
    study_list.add_argument("--project")
    study_list.set_defaults(command_id="study.list")
    _json_argument(study_list)

    study_inspect = study_actions.add_parser("inspect", help="inspect one Study")
    study_inspect.add_argument("path")
    study_inspect.add_argument("--project")
    study_inspect.add_argument("--study", required=True)
    study_inspect.set_defaults(command_id="study.inspect")
    _json_argument(study_inspect)

    run = subcommands.add_parser("run", help="execute and inspect immutable Runs")
    run_actions = run.add_subparsers(dest="run_action", required=True)
    run_execute = run_actions.add_parser(
        "execute",
        help="execute one Study through its fixed Judge",
    )
    run_execute.add_argument("path")
    run_execute.add_argument("--project")
    run_execute.add_argument("--study", required=True)
    run_execute.set_defaults(command_id="run.execute")
    _json_argument(run_execute)

    run_list = run_actions.add_parser("list", help="list immutable Runs")
    run_list.add_argument("path")
    run_list.add_argument("--project")
    run_list.add_argument("--study")
    run_list.set_defaults(command_id="run.list")
    _json_argument(run_list)

    run_show = run_actions.add_parser("show", help="verify and show one Run")
    run_show.add_argument("path")
    run_show.add_argument("--project")
    run_show.add_argument("--run", required=True)
    run_show.set_defaults(command_id="run.show")
    _json_argument(run_show)

    run_factor = run_actions.add_parser(
        "factor",
        help="inspect bounded Factor Run professional diagnostics",
    )
    run_factor.add_argument("path")
    run_factor.add_argument("--project")
    run_factor.add_argument("--run", required=True)
    run_factor.add_argument(
        "--points",
        type=int,
        choices=range(MIN_FACTOR_POINTS, MAX_FACTOR_POINTS + 1),
        default=DEFAULT_FACTOR_POINTS,
        metavar=f"{MIN_FACTOR_POINTS}..{MAX_FACTOR_POINTS}",
    )
    run_factor.set_defaults(command_id="run.factor")
    _json_argument(run_factor)

    run_portfolio = run_actions.add_parser(
        "portfolio",
        help="inspect bounded Portfolio Run decision diagnostics",
    )
    run_portfolio.add_argument("path")
    run_portfolio.add_argument("--project")
    run_portfolio.add_argument("--run", required=True)
    run_portfolio.add_argument(
        "--points",
        type=int,
        choices=range(MIN_PORTFOLIO_POINTS, MAX_PORTFOLIO_POINTS + 1),
        default=DEFAULT_PORTFOLIO_POINTS,
        metavar=f"{MIN_PORTFOLIO_POINTS}..{MAX_PORTFOLIO_POINTS}",
    )
    run_portfolio.set_defaults(command_id="run.portfolio")
    _json_argument(run_portfolio)

    run_book_risk = run_actions.add_parser(
        "book-risk",
        help=(
            "inspect one reported-book audit, supplied scenarios, and "
            "caller-bounded target-position sizing"
        ),
    )
    run_book_risk.add_argument("path")
    run_book_risk.add_argument("--project")
    run_book_risk.add_argument("--run", required=True)
    run_book_risk.add_argument(
        "--points",
        type=int,
        choices=range(
            MIN_BOOK_RISK_POINTS,
            MAX_BOOK_RISK_POINTS + 1,
        ),
        default=DEFAULT_BOOK_RISK_POINTS,
        metavar=f"{MIN_BOOK_RISK_POINTS}..{MAX_BOOK_RISK_POINTS}",
    )
    run_book_risk.set_defaults(command_id="run.book-risk")
    _json_argument(run_book_risk)

    run_event_study = run_actions.add_parser(
        "event-study",
        help="inspect one fixed OHLCV price-event Study",
    )
    run_event_study.add_argument("path")
    run_event_study.add_argument("--project")
    run_event_study.add_argument("--run", required=True)
    run_event_study.set_defaults(command_id="run.event-study")
    _json_argument(run_event_study)

    run_book_path_stress = run_actions.add_parser(
        "book-path-stress",
        help="inspect one fixed reported-book historical Path Stress Study",
    )
    run_book_path_stress.add_argument("path")
    run_book_path_stress.add_argument("--project")
    run_book_path_stress.add_argument("--run", required=True)
    run_book_path_stress.set_defaults(command_id="run.book-path-stress")
    _json_argument(run_book_path_stress)

    run_allocation = run_actions.add_parser(
        "allocation",
        help="inspect one fixed portfolio-native allocation Study",
    )
    run_allocation.add_argument("path")
    run_allocation.add_argument("--project")
    run_allocation.add_argument("--run", required=True)
    run_allocation.add_argument(
        "--points",
        type=int,
        choices=range(
            MIN_ALLOCATION_POINTS,
            MAX_ALLOCATION_POINTS + 1,
        ),
        default=DEFAULT_ALLOCATION_POINTS,
        metavar=f"{MIN_ALLOCATION_POINTS}..{MAX_ALLOCATION_POINTS}",
    )
    run_allocation.set_defaults(command_id="run.allocation")
    _json_argument(run_allocation)

    run_rl = run_actions.add_parser(
        "rl",
        help="inspect bounded governed RL policy evidence",
    )
    run_rl.add_argument("path")
    run_rl.add_argument("--project")
    run_rl.add_argument("--run", required=True)
    run_rl.add_argument(
        "--points",
        type=int,
        choices=range(MIN_RL_POINTS, MAX_RL_POINTS + 1),
        default=DEFAULT_RL_POINTS,
        metavar=f"{MIN_RL_POINTS}..{MAX_RL_POINTS}",
    )
    run_rl.set_defaults(command_id="run.rl")
    _json_argument(run_rl)

    session = subcommands.add_parser(
        "session",
        help="manage governed research Sessions",
    )
    session_actions = session.add_subparsers(dest="session_action", required=True)
    session_start = session_actions.add_parser(
        "start",
        help=(
            "preflight a fresh first candidate, establish or reuse its "
            "successful baseline, and start a resumable Session"
        ),
    )
    session_start.add_argument("path")
    session_start.add_argument("--project")
    session_start.add_argument("--study", required=True)
    session_start.add_argument(
        "--request",
        help="strict delegated research-request JSON to bind into the Session",
    )
    session_start.set_defaults(command_id="session.start")
    _json_argument(session_start)

    session_list = session_actions.add_parser("list", help="list research Sessions")
    session_list.add_argument("path")
    session_list.add_argument("--project")
    session_list.set_defaults(command_id="session.list")
    _json_argument(session_list)

    session_show = session_actions.add_parser("show", help="inspect one Session")
    session_show.add_argument("path")
    session_show.add_argument("--project")
    session_show.add_argument("--session", required=True)
    session_show.set_defaults(command_id="session.show")
    _json_argument(session_show)

    session_check = session_actions.add_parser(
        "check",
        help="run the fixed bounded preflight against the current candidate",
    )
    session_check.add_argument("path")
    session_check.add_argument("--project")
    session_check.add_argument("--session", required=True)
    session_check.set_defaults(command_id="session.check")
    _json_argument(session_check)

    session_compare = session_actions.add_parser(
        "compare",
        help="compare bounded verified Session trials across metric layers",
    )
    session_compare.add_argument("path")
    session_compare.add_argument("--project")
    session_compare.add_argument("--session", required=True)
    session_compare.add_argument(
        "--trials",
        type=int,
        choices=range(
            MIN_COMPARISON_TRIALS,
            MAX_COMPARISON_TRIALS + 1,
        ),
        default=DEFAULT_COMPARISON_TRIALS,
        metavar=f"{MIN_COMPARISON_TRIALS}..{MAX_COMPARISON_TRIALS}",
    )
    session_compare.set_defaults(command_id="session.compare")
    _json_argument(session_compare)

    session_promote = session_actions.add_parser(
        "promote",
        help=(
            "promote the exact current KEEP into the owning Project and "
            "terminally close the Session"
        ),
    )
    session_promote.add_argument("path")
    session_promote.add_argument("--project")
    session_promote.add_argument("--session", required=True)
    session_promote.add_argument(
        "--report",
        help=(
            "exact current Report required when promoting a delegated KEEP"
        ),
    )
    session_promote.set_defaults(command_id="session.promote")
    _json_argument(session_promote)

    session_complete = session_actions.add_parser(
        "complete",
        help=(
            "finish an active baseline-retaining delegated Session with an "
            "exact Report; not valid after KEEP promotion"
        ),
    )
    session_complete.add_argument("path")
    session_complete.add_argument("--project")
    session_complete.add_argument("--session", required=True)
    session_complete.add_argument("--report", required=True)
    session_complete.set_defaults(command_id="session.complete")
    _json_argument(session_complete)

    experiment = subcommands.add_parser(
        "experiment",
        help="evaluate and inspect immutable candidate Experiments",
    )
    experiment_actions = experiment.add_subparsers(
        dest="experiment_action",
        required=True,
    )
    experiment_evaluate = experiment_actions.add_parser(
        "evaluate",
        help="judge the current Session candidate and apply its verdict",
    )
    experiment_evaluate.add_argument("path")
    experiment_evaluate.add_argument("--project")
    experiment_evaluate.add_argument("--session", required=True)
    experiment_evaluate.add_argument("--hypothesis", required=True)
    experiment_evaluate.set_defaults(command_id="experiment.evaluate")
    _json_argument(experiment_evaluate)

    experiment_list = experiment_actions.add_parser(
        "list",
        help="list immutable Experiments in one Session",
    )
    experiment_list.add_argument("path")
    experiment_list.add_argument("--project")
    experiment_list.add_argument("--session", required=True)
    experiment_list.set_defaults(command_id="experiment.list")
    _json_argument(experiment_list)

    experiment_show = experiment_actions.add_parser(
        "show",
        help="verify and inspect one immutable Experiment",
    )
    experiment_show.add_argument("path")
    experiment_show.add_argument("--project")
    experiment_show.add_argument("--session", required=True)
    experiment_show.add_argument("--experiment", required=True)
    experiment_show.set_defaults(command_id="experiment.show")
    _json_argument(experiment_show)

    research = subcommands.add_parser(
        "research",
        help="drive and inspect bounded external Researcher Campaigns",
    )
    research_actions = research.add_subparsers(
        dest="research_action",
        required=True,
    )
    research_run = research_actions.add_parser(
        "run",
        help="run one bounded provider-neutral Researcher Campaign",
    )
    research_run.add_argument("path")
    research_run.add_argument("--project")
    research_run.add_argument("--session", required=True)
    research_run.add_argument("--agent-command", required=True)
    research_run.add_argument("--max-turns", type=int, default=5)
    research_run.add_argument("--max-wall-seconds", type=int, default=900)
    research_run.add_argument("--turn-timeout-seconds", type=int, default=300)
    research_run.set_defaults(command_id="research.run")
    _json_argument(research_run)

    research_list = research_actions.add_parser(
        "list",
        help="list immutable Campaigns in one Session",
    )
    research_list.add_argument("path")
    research_list.add_argument("--project")
    research_list.add_argument("--session", required=True)
    research_list.set_defaults(command_id="research.list")
    _json_argument(research_list)

    research_show = research_actions.add_parser(
        "show",
        help="verify and inspect one immutable Campaign",
    )
    research_show.add_argument("path")
    research_show.add_argument("--project")
    research_show.add_argument("--session", required=True)
    research_show.add_argument("--campaign", required=True)
    research_show.set_defaults(command_id="research.show")
    _json_argument(research_show)

    report = subcommands.add_parser(
        "report",
        help="publish and inspect immutable evidence-bound Research Reports",
    )
    report_actions = report.add_subparsers(dest="report_action", required=True)
    report_draft = report_actions.add_parser(
        "draft",
        help="materialize a safe schema-valid Report analysis scaffold",
    )
    report_draft.add_argument("path")
    report_draft.add_argument("--project")
    report_draft.add_argument(
        "--session",
        help="delegated active Session anchor",
    )
    report_draft.add_argument(
        "--study",
        help="Study id for a Session-free immutable Run anchor; requires --run",
    )
    report_draft.add_argument(
        "--run",
        help="current reportable Run id for a Session-free anchor; requires --study",
    )
    report_draft.add_argument(
        "--output",
        default="report-analysis.json",
        help=(
            "new confined Project-relative JSON path; existing files are never overwritten"
        ),
    )
    report_draft.set_defaults(command_id="report.draft")
    _json_argument(report_draft)

    report_publish = report_actions.add_parser(
        "publish",
        help="publish analysis over one Session prefix or one immutable current Run",
    )
    report_publish.add_argument("path")
    report_publish.add_argument("--project")
    report_publish.add_argument(
        "--session",
        help="delegated editable Session evidence anchor",
    )
    report_publish.add_argument(
        "--study",
        help="Study id for a Session-free immutable Run anchor; requires --run",
    )
    report_publish.add_argument(
        "--run",
        help=(
            "current successful or scientific-limit Run id for a Session-free "
            "anchor; requires --study"
        ),
    )
    report_publish.add_argument(
        "--analysis",
        required=True,
        help=(
            "strict report-analysis JSON; every recommendation requires "
            "action, rationale, conditions, and evidenceRefs; copy the "
            "complete `aq schema report-analysis --json` example. Run "
            "artifactPath must be null or exactly match "
            "result.artifacts[].path (for example "
            "artifacts/factor-report.json), while Experiment/Campaign "
            "artifactPath must be null"
        ),
    )
    report_publish.add_argument(
        "--corrects",
        help="current terminal Run-bound Report id corrected by this publication",
    )
    report_publish.add_argument(
        "--correction-review",
        help=(
            "attached Review id or detached Review package path governing the "
            "correction; requires --corrects and --correction-reason"
        ),
    )
    report_publish.add_argument(
        "--correction-reason",
        help="concise durable reason for the immutable correction",
    )
    report_publish.set_defaults(command_id="report.publish")
    _json_argument(report_publish)

    report_list = report_actions.add_parser(
        "list",
        help="list Project-owned Run Reports or Reports in one Session",
    )
    report_list.add_argument("path")
    report_list.add_argument("--project")
    report_list.add_argument("--session")
    report_list.add_argument("--study", help="filter Project-owned Run Reports by Study")
    report_list.set_defaults(command_id="report.list")
    _json_argument(report_list)

    report_show = report_actions.add_parser(
        "show",
        help="verify and inspect one immutable Research Report",
    )
    report_show.add_argument("path")
    report_show.add_argument("--project")
    report_show.add_argument(
        "--session",
        help="owning Session for a Session-bound Report; omit for a Run-bound Report",
    )
    report_show.add_argument("--report", required=True)
    report_show.set_defaults(command_id="report.show")
    _json_argument(report_show)

    review = subcommands.add_parser(
        "review",
        help="publish and inspect immutable independent Research Reviews",
    )
    review_actions = review.add_subparsers(dest="review_action", required=True)
    review_publish = review_actions.add_parser(
        "publish",
        help="publish a no-research-mutation Review of one completed Report",
    )
    review_publish.add_argument(
        "path",
        help=(
            "Project or Workspace entry path and observed-file root; use a "
            "Workspace path plus --project for staging/... evidence"
        ),
    )
    review_publish.add_argument("--project")
    review_publish.add_argument(
        "--session",
        help="owning Session when the target Report is Session-bound",
    )
    review_publish.add_argument("--report", required=True)
    review_publish.add_argument(
        "--analysis",
        required=True,
        help=(
            "strict review-analysis JSON using verified, declared, "
            "observed-unbound, and unverified classifications"
        ),
    )
    review_publish.add_argument(
        "--output",
        help=(
            "optional directory outside the target Workspace for a detached "
            "tamper-evident Review package; omit to attach under Project reviews/"
        ),
    )
    review_publish.set_defaults(command_id="review.publish")
    _json_argument(review_publish)

    review_list = review_actions.add_parser(
        "list",
        help="list attached immutable Reviews in one Project",
    )
    review_list.add_argument("path")
    review_list.add_argument("--project")
    review_list.add_argument("--report", help="filter by exact target Report id")
    review_list.set_defaults(command_id="review.list")
    _json_argument(review_list)

    review_show = review_actions.add_parser(
        "show",
        help="verify an attached Review or a direct detached Review package",
    )
    review_show.add_argument("path")
    review_show.add_argument("--project")
    review_show.add_argument(
        "--review",
        help="attached Review id; omit when path is a detached Review directory",
    )
    review_show.set_defaults(command_id="review.show")
    _json_argument(review_show)

    dossier = subcommands.add_parser(
        "dossier",
        help="publish and inspect immutable Project-level Research Dossiers",
    )
    dossier_actions = dossier.add_subparsers(
        dest="dossier_action",
        required=True,
    )
    dossier_status = dossier_actions.add_parser(
        "status",
        help="inspect cross-lane Dossier readiness and evidence references",
    )
    dossier_status.add_argument("path")
    dossier_status.add_argument("--project")
    dossier_status.set_defaults(command_id="dossier.status")
    _json_argument(dossier_status)

    dossier_publish = dossier_actions.add_parser(
        "publish",
        help="publish Agent-authored synthesis over verified lane Reports",
    )
    dossier_publish.add_argument("path")
    dossier_publish.add_argument("--project")
    dossier_publish.add_argument("--analysis", required=True)
    dossier_publish.set_defaults(command_id="dossier.publish")
    _json_argument(dossier_publish)

    dossier_list = dossier_actions.add_parser(
        "list",
        help="list immutable Research Dossiers in one Project",
    )
    dossier_list.add_argument("path")
    dossier_list.add_argument("--project")
    dossier_list.set_defaults(command_id="dossier.list")
    _json_argument(dossier_list)

    dossier_show = dossier_actions.add_parser(
        "show",
        help="verify and inspect one immutable Research Dossier",
    )
    dossier_show.add_argument("path")
    dossier_show.add_argument("--project")
    dossier_show.add_argument("--dossier", required=True)
    dossier_show.set_defaults(command_id="dossier.show")
    _json_argument(dossier_show)

    holdout = subcommands.add_parser(
        "holdout",
        help="bind and run one frozen external-period Dossier challenge",
    )
    holdout_actions = holdout.add_subparsers(
        dest="holdout_action",
        required=True,
    )
    holdout_create_target = holdout_actions.add_parser(
        "create-target",
        help=(
            "atomically create and bind a lane-aware strictly later target "
            "from one current Dossier"
        ),
    )
    holdout_create_target.add_argument(
        "source",
        help="source Project or Workspace path",
    )
    holdout_create_target.add_argument(
        "workspace",
        help="Workspace that will own the new frozen target Project",
    )
    holdout_create_target.add_argument(
        "project_id",
        help="new lowercase kebab-case target Project id",
    )
    holdout_create_target.add_argument(
        "--source-project",
        help="source Workspace Project id",
    )
    holdout_create_target.add_argument(
        "--dossier",
        required=True,
        help="current immutable source Dossier id",
    )
    holdout_create_target.add_argument(
        "--dataset",
        required=True,
        help="strictly later dataset-package manifest JSON file",
    )
    holdout_create_target.add_argument("--name")
    holdout_create_target.set_defaults(command_id="holdout.create-target")
    _json_argument(holdout_create_target)

    holdout_bind = holdout_actions.add_parser(
        "bind",
        help="freeze a current Dossier into a fresh later Project",
    )
    holdout_bind.add_argument("source")
    holdout_bind.add_argument("target")
    holdout_bind.add_argument("--source-project")
    holdout_bind.add_argument("--target-project")
    holdout_bind.add_argument("--dossier", required=True)
    holdout_bind.set_defaults(command_id="holdout.bind")
    _json_argument(holdout_bind)

    holdout_status = holdout_actions.add_parser(
        "status",
        help="verify and inspect frozen holdout state",
    )
    holdout_status.add_argument("path")
    holdout_status.add_argument("--project")
    holdout_status.set_defaults(command_id="holdout.status")
    _json_argument(holdout_status)

    holdout_run = holdout_actions.add_parser(
        "run",
        help="execute the bound external-period challenge exactly once",
    )
    holdout_run.add_argument("path")
    holdout_run.add_argument("--project")
    holdout_run.set_defaults(command_id="holdout.run")
    _json_argument(holdout_run)

    holdout_assess = holdout_actions.add_parser(
        "assess",
        help="publish one immutable Agent assessment over a terminal holdout",
    )
    holdout_assess.add_argument("path")
    holdout_assess.add_argument("--project")
    holdout_assess.add_argument(
        "--analysis",
        required=True,
        help="strict Agent-authored holdout assessment analysis JSON",
    )
    holdout_assess.set_defaults(command_id="holdout.assess")
    _json_argument(holdout_assess)

    holdout_show = holdout_actions.add_parser(
        "show",
        help="verify the immutable result, evidence, and optional assessment",
    )
    holdout_show.add_argument("path")
    holdout_show.add_argument("--project")
    holdout_show.set_defaults(command_id="holdout.show")
    _json_argument(holdout_show)

    studio = subcommands.add_parser(
        "studio",
        help="observe verified Workspace research in CLI JSON or a local web UI",
    )
    studio_actions = studio.add_subparsers(dest="studio_action", required=True)
    studio_snapshot = studio_actions.add_parser(
        "snapshot",
        help="emit one verified read-only Studio snapshot",
    )
    studio_snapshot.add_argument("path")
    studio_snapshot.add_argument("--project")
    studio_snapshot.set_defaults(command_id="studio.snapshot")
    _json_argument(studio_snapshot)

    studio_serve = studio_actions.add_parser(
        "serve",
        help="serve the local read-only AutoQuant Studio",
    )
    studio_serve.add_argument("path")
    studio_serve.add_argument("--project")
    studio_serve.add_argument("--host")
    studio_serve.add_argument("--port", type=int)
    studio_serve.add_argument("--no-open", action="store_true")
    studio_serve.set_defaults(command_id="studio.serve")
    return parser


def _workspace_init(args: argparse.Namespace) -> CommandResult:
    workspace = initialize_workspace(
        args.directory,
        name=args.name,
        adopt_existing=args.adopt_existing,
    )
    from .skill_bundle import (
        WORKSPACE_SKILLS_MANIFEST,
        verify_materialized_workspace_skills,
    )

    skill_bundle = verify_materialized_workspace_skills(workspace.root_dir)
    manifest_path = workspace.root_dir / WORKSPACE_MANIFEST
    skill_manifest_path = workspace.root_dir / WORKSPACE_SKILLS_MANIFEST
    return CommandResult(
        "workspace.init",
        {
            "workspaceDir": str(workspace.root_dir),
            "manifest": workspace.manifest.to_dict(),
            "adoptExistingRequested": bool(args.adopt_existing),
            "skillBundle": {
                "manifest": str(skill_manifest_path),
                "harnessVersion": skill_bundle["harnessVersion"],
                "bundleSha256": skill_bundle["bundleSha256"],
                "discoveryRoots": skill_bundle["discoveryRoots"],
                "skillIds": [
                    skill["id"] for skill in skill_bundle["skills"]
                ],
            },
        },
        (
            f"Initialized AutoQuant Workspace at {workspace.root_dir}\n"
            + (
                "Adoption mode preserved existing caller/host files; they "
                "remain outside Project and quantitative identity.\n"
                if args.adopt_existing
                else ""
            )
        ),
        workspace_context(workspace),
        [
            artifact(
                "workspace",
                workspace.manifest.name,
                manifest_path,
                immutable=False,
            ),
            artifact(
                "workspace-skill-bundle",
                skill_bundle["bundleSha256"],
                skill_manifest_path,
                immutable=False,
            ),
        ],
        [
            next_action(
                "project.create",
                "Create the first self-contained research Project.",
                [
                    "aq",
                    "project",
                    "create",
                    str(workspace.root_dir),
                    "research-project",
                    "--json",
                ],
                "creates-artifact",
            )
        ],
    )


def _project_create(args: argparse.Namespace) -> CommandResult:
    project = create_project(
        args.workspace,
        args.project_id,
        name=args.name,
        description=args.description,
        template=args.template,
    )
    program = None
    if args.template == RESEARCH_DESK_TEMPLATE:
        program = load_research_program(project)
        assert program is not None
        next_actions = [
            next_action(
                "project.program",
                "After clarifying research.md, inspect the coordinated Factor, "
                "Portfolio, and RL lanes.",
                [
                    "aq",
                    "project",
                    "program",
                    str(project.root_dir),
                    "--json",
                ],
                "read-only",
            ),
        ]
        if program["recommendedAction"] is not None:
            action = program["recommendedAction"]
            next_actions.append(
                next_action(
                    action["id"],
                    action["description"],
                    action["argv"],
                    action["effect"],
                )
            )
    elif args.template != "blank":
        study_id = TEMPLATE_STUDY_IDS[args.template]
        next_actions = [
            next_action(
                "study.inspect",
                "After clarifying research.md, inspect the fixed reference "
                "Study and content identity.",
                [
                    "aq",
                    "study",
                    "inspect",
                    str(project.root_dir),
                    "--study",
                    study_id,
                    "--json",
                ],
                "read-only",
            ),
            next_action(
                "run.execute",
                "After clarifying research.md, execute the bounded reference "
                "baseline.",
                [
                    "aq",
                    "run",
                    "execute",
                    str(project.root_dir),
                    "--study",
                    study_id,
                    "--json",
                ],
                "creates-artifact",
            ),
        ]
    else:
        next_actions = [
            next_action(
                "validate",
                "After clarifying research.md, validate the new Project.",
                ["aq", "validate", str(project.root_dir), "--json"],
                "read-only",
            ),
            next_action(
                "inspect",
                "After clarifying research.md, inspect the Project construction "
                "surfaces.",
                ["aq", "inspect", str(project.root_dir), "--json"],
                "read-only",
            ),
        ]
    research_path = project.root_dir / project.manifest.research_program
    framework_needs_path = project.root_dir / FRAMEWORK_NEEDS
    artifacts = [
        artifact(
            "project",
            project.manifest.id,
            project.root_dir / PROJECT_MANIFEST,
            immutable=False,
        ),
        artifact(
            "research-brief",
            project.manifest.id,
            research_path,
            immutable=False,
        ),
        artifact(
            "framework-needs",
            project.manifest.id,
            framework_needs_path,
            immutable=False,
        ),
    ]
    if program is not None:
        artifacts.append(
            artifact(
                "research-program",
                program["manifest"]["id"],
                project.root_dir / RESEARCH_PROGRAM_MANIFEST,
                immutable=False,
            )
        )
    return CommandResult(
        "project.create",
        {
            "projectDir": str(project.root_dir),
            "manifest": project.manifest.to_dict(),
            "researchBriefPath": str(research_path),
            "frameworkNeedsPath": str(framework_needs_path),
            "template": args.template,
        },
        (
            f"Created AutoQuant Project '{project.manifest.id}' at "
            f"{project.root_dir}\n"
            f"Before quantitative work, clarify the English research brief at "
            f"{research_path}\n"
            f"Record real Workbench gaps at {framework_needs_path}\n"
        ),
        project_context(project),
        artifacts,
        next_actions,
    )


def _project_templates(args: argparse.Namespace) -> CommandResult:
    routes = project_template_routes()
    recommendation_rules = [
        {
            "when": "method-unclear",
            "template": "blank",
            "reason": "Clarify caller intent before choosing fixed quantitative authority.",
        },
        {
            "when": "factor-to-portfolio-or-rl",
            "template": RESEARCH_DESK_TEMPLATE,
            "reason": "Cross-lane admission and Dossier evidence require the coordinated desk.",
        },
        {
            "when": "single-fixed-lane",
            "template": "matching-specialized-lab",
            "reason": "Use the narrow Lab only when it fully answers the assignment.",
        },
    ]
    lines = [
        "AutoQuant Project construction routes",
        "Rule: if Factor evidence must feed Portfolio or RL in one assignment, "
        f"use {RESEARCH_DESK_TEMPLATE}.",
        "Rule: if the method is unclear, use blank and finish research.md first.",
        "",
    ]
    for route in routes:
        lanes = ", ".join(route["lanes"]) or "none yet"
        lines.extend(
            [
                f"{route['id']} [{route['kind']}; {lanes}]",
                f"  {route['purpose']}",
                f"  Fit: {route['fits'][0]}",
                f"  Not fit: {route['doesNotFit'][0]}",
            ]
        )
    return CommandResult(
        "project.templates",
        {
            "default": "blank",
            "routes": routes,
            "recommendationRules": recommendation_rules,
        },
        "\n".join(lines) + "\n",
        next_actions=[
            next_action(
                "project.create",
                "After clarifying research.md intent, create exactly one fitting Project.",
                [
                    "aq",
                    "project",
                    "create",
                    "<workspace-dir>",
                    "<project-id>",
                    "--template",
                    "<template-id>",
                    "--json",
                ],
                "creates-artifact",
            )
        ],
    )


def _project_intake(args: argparse.Namespace) -> CommandResult:
    prepared = prepare_project_intake(
        args.request,
        args.dataset,
        args.template,
    )
    project = create_or_intake_project(
        args.workspace,
        args.project_id,
        name=args.name or prepared.request["title"],
        description=prepared.request["question"],
        template=args.template,
        template_intake=prepared,
    )
    intake = load_project_intake(project)
    assert intake is not None
    study_id = intake["study"]["id"]
    request_path = project.root_dir / PROJECT_REQUEST
    research_path = project.root_dir / project.manifest.research_program
    framework_needs_path = project.root_dir / FRAMEWORK_NEEDS
    program = load_research_program(project, optional=True)
    if program is not None:
        next_actions = [
            next_action(
                "project.program",
                "After updating research.md, inspect the coordinated Factor, "
                "Portfolio, and RL research lanes.",
                [
                    "aq",
                    "project",
                    "program",
                    str(project.root_dir),
                    "--json",
                ],
                "read-only",
            ),
        ]
        if program["recommendedAction"] is not None:
            action = program["recommendedAction"]
            next_actions.append(
                next_action(
                    action["id"],
                    "After updating research.md, " + action["description"],
                    action["argv"],
                    action["effect"],
                )
            )
    else:
        next_actions = [
            next_action(
                "study.inspect",
                "After updating research.md, inspect the fixed Study and "
                "content-locked market snapshot.",
                [
                    "aq",
                    "study",
                    "inspect",
                    str(project.root_dir),
                    "--study",
                    study_id,
                    "--json",
                ],
                "read-only",
            ),
            next_action(
                "run.execute",
                "After updating research.md, execute the bounded real-data "
                "baseline.",
                [
                    "aq",
                    "run",
                    "execute",
                    str(project.root_dir),
                    "--study",
                    study_id,
                    "--json",
                ],
                "creates-artifact",
            ),
        ]
        if args.template not in {
            "ohlcv-book-risk-lab",
            "ohlcv-event-study-lab",
            "ohlcv-book-path-stress-lab",
            "ohlcv-allocation-lab",
        }:
            next_actions.append(
                next_action(
                    "session.start",
                    "After updating research.md, start delegated research with "
                    "the preserved request.",
                    [
                        "aq",
                        "session",
                        "start",
                        str(project.root_dir),
                        "--study",
                        study_id,
                        "--request",
                        str(request_path),
                        "--json",
                    ],
                    "creates-artifact",
                )
            )
    artifacts = [
        artifact(
            "project",
            project.manifest.id,
            project.root_dir / PROJECT_MANIFEST,
            immutable=False,
        ),
        artifact(
            "research-brief",
            project.manifest.id,
            research_path,
            immutable=False,
        ),
        artifact(
            "framework-needs",
            project.manifest.id,
            framework_needs_path,
            immutable=False,
        ),
        artifact(
            "research-request",
            prepared.request_hash,
            request_path,
            immutable=False,
        ),
        artifact(
            "dataset-snapshot",
            intake["manifest"]["datasetSnapshotHash"],
            project.root_dir / DATASET_SNAPSHOT,
            immutable=False,
        ),
        artifact(
            "project-intake",
            project.manifest.id,
            project.root_dir / PROJECT_INTAKE,
            immutable=False,
        ),
    ]
    if program is not None:
        artifacts.append(
            artifact(
                "research-program",
                program["manifest"]["id"],
                project.root_dir / RESEARCH_PROGRAM_MANIFEST,
                immutable=False,
            )
        )
    return CommandResult(
        "project.intake",
        {
            "projectDir": str(project.root_dir),
            "manifest": project.manifest.to_dict(),
            "researchBriefPath": str(research_path),
            "frameworkNeedsPath": str(framework_needs_path),
            "intake": intake,
        },
        (
            f"Created request-driven Project '{project.manifest.id}'\n"
            f"Before quantitative work, update the English research brief at "
            f"{research_path}\n"
            f"Record real Workbench gaps at {framework_needs_path}\n"
            f"Request: {prepared.request['title']}\n"
            f"Dataset: {prepared.package['id']}@{prepared.package['version']} · "
            f"{len(prepared.assets)} assets · {prepared.start}..{prepared.end}\n"
            f"Studies: {len(TEMPLATE_STUDY_SEQUENCES[args.template])} · "
            f"primary {study_id}\n"
        ),
        project_context(project),
        artifacts,
        next_actions,
    )


def _project_program(args: argparse.Namespace) -> CommandResult:
    project = _selected_project(args)
    program = load_research_program(project)
    assert program is not None
    lane_lines = [
        f"  {lane['id']}: {lane['phase']} · "
        f"{lane['study']['objective']['metric']}"
        for lane in program["lanes"]
    ]
    gate_lines = [
        f"  {gate['id']}: {gate['status']} · "
        f"{gate['diagnosisStage'] or 'no current diagnosis'}"
        for gate in program["progression"]["gates"]
    ]
    actions = []
    if program["recommendedAction"] is not None:
        action = program["recommendedAction"]
        actions.append(
            next_action(
                action["id"],
                action["description"],
                action["argv"],
                action["effect"],
            )
        )
    return CommandResult(
        "project.program",
        program,
        (
            f"Research program: {program['project']['name']}\n"
            + "\n".join(lane_lines)
            + "\n"
            + f"Progression: {program['progression']['stage']}\n"
            + "\n".join(gate_lines)
            + "\n"
            + (
                f"Recommended: {program['recommendedAction']['display']}\n"
                if program["recommendedAction"] is not None
                else "Recommended: no pending lane action\n"
            )
        ),
        project_context(project),
        [
            artifact(
                "research-program",
                program["manifest"]["id"],
                project.root_dir / RESEARCH_PROGRAM_MANIFEST,
                immutable=False,
            )
        ],
        actions,
    )


def _project_list(args: argparse.Namespace) -> CommandResult:
    workspace = load_workspace(args.workspace)
    projects = list_workspace_projects(workspace.root_dir)
    lines = [
        f"AutoQuant Workspace: {workspace.manifest.name}",
        (
            f"Projects: {workspace.projects_dir} "
            f"({workspace.configuration_source})"
        ),
    ]
    if projects:
        lines.extend(
            f"{'*' if item.is_default else ' '} {item.id}  {item.name}  {item.path}"
            for item in projects
        )
    else:
        lines.append("  No Projects")
    actions = [
        next_action(
            "project.create",
            "Create a self-contained research Project.",
            [
                "aq",
                "project",
                "create",
                str(workspace.root_dir),
                "research-project",
                "--json",
            ],
            "creates-artifact",
        )
    ]
    default = next((item for item in projects if item.is_default), None)
    if default:
        actions.append(
            next_action(
                "inspect",
                "Inspect the default Project.",
                ["aq", "inspect", str(workspace.root_dir), "--json"],
                "read-only",
            )
        )
    return CommandResult(
        "project.list",
        {"projects": [item.to_dict() for item in projects]},
        "\n".join(lines) + "\n",
        workspace_context(workspace),
        next_actions=actions,
    )


def _project_default(args: argparse.Namespace) -> CommandResult:
    workspace = set_default_project(args.workspace, args.project_id)
    return CommandResult(
        "project.default",
        {"defaultProject": workspace.manifest.default_project},
        f"Default AutoQuant Project: {workspace.manifest.default_project}\n",
        workspace_context(workspace),
        next_actions=[
            next_action(
                "inspect",
                "Inspect the selected default Project.",
                ["aq", "inspect", str(workspace.root_dir), "--json"],
                "read-only",
            )
        ],
    )


def _workspace_project_selection(
    args: argparse.Namespace,
    project,
) -> dict[str, Any] | None:
    raw_path = getattr(args, "path", None)
    if raw_path is None:
        return None
    root = Path(raw_path).expanduser().absolute()
    if not (root / WORKSPACE_MANIFEST).is_file():
        return None
    workspace = load_workspace(root)
    projects = list_workspace_projects(workspace.root_dir)
    explicit = getattr(args, "project", None) is not None
    return {
        "workspace": workspace_context(workspace)["workspace"],
        "selection": {
            "method": "explicit" if explicit else "workspace-default",
            "explicit": explicit,
            "selectedProject": project.manifest.id,
            "defaultProject": workspace.manifest.default_project,
            "projectCount": len(projects),
            "availableProjects": [item.id for item in projects],
            "stateChangeRequiresExplicitProject": len(projects) > 1,
        },
    }


def _project_result_context(
    args: argparse.Namespace,
    project,
) -> dict[str, Any]:
    context = project_context(project)
    resolved = getattr(args, "_autoquant_project_selection", None)
    if resolved is None:
        resolved = _workspace_project_selection(args, project)
    if resolved is not None:
        context["workspace"] = resolved["workspace"]
        context["projectSelection"] = resolved["selection"]
    return context


def _require_explicit_workspace_project(
    command_id: str,
    input_path: str,
    project_id: str | None,
    option_name: str,
) -> None:
    if project_id is not None:
        return
    root = Path(input_path).expanduser().absolute()
    if not (root / WORKSPACE_MANIFEST).is_file():
        return
    workspace = load_workspace(root)
    projects = list_workspace_projects(workspace.root_dir)
    if len(projects) < 2:
        return
    selected = workspace.manifest.default_project
    available = ", ".join(item.id for item in projects)
    message = (
        f"Command '{command_id}' changes Project-local state, so a Workspace "
        f"containing multiple Projects requires an explicit {option_name} ID. "
        f"Default is '{selected}'. Available: {available}"
    )
    context = workspace_context(workspace)
    context["projectSelection"] = {
        "method": "workspace-default",
        "explicit": False,
        "selectedProject": selected,
        "defaultProject": selected,
        "projectCount": len(projects),
        "availableProjects": [item.id for item in projects],
        "stateChangeRequiresExplicitProject": True,
    }
    raise CliCommandError(
        "workspace.explicit-project-required",
        message,
        issues=[
            ValidationIssue(
                str(workspace.configuration_path),
                "workspace.explicit-project-required",
                message,
            )
        ],
        context=context,
    )


def _project_selection_human(args: argparse.Namespace) -> str:
    resolved = getattr(args, "_autoquant_project_selection", None)
    if resolved is None:
        return ""
    selection = resolved["selection"]
    method = (
        "explicit --project"
        if selection["explicit"]
        else "Workspace default"
    )
    line = (
        f"Workspace selection: {method} → "
        f"{selection['selectedProject']} · "
        f"{selection['projectCount']} Project"
        f"{'s' if selection['projectCount'] != 1 else ''}\n"
    )
    if (
        selection["stateChangeRequiresExplicitProject"]
        and not selection["explicit"]
    ):
        line += (
            "Available Projects: "
            + ", ".join(selection["availableProjects"])
            + "\nProject-local state changes require an explicit --project ID.\n"
        )
    return line


def _selected_project(args: argparse.Namespace):
    directory = resolve_project_directory(args.path, args.project)
    project = load_project(directory)
    selection = _workspace_project_selection(args, project)
    setattr(args, "_autoquant_project_selection", selection)
    command_effect = next(
        (
            command["effect"]
            for command in CLI_COMMANDS
            if command["id"] == args.command_id
        ),
        None,
    )
    if (
        selection is not None
        and selection["selection"][
            "stateChangeRequiresExplicitProject"
        ]
        and not selection["selection"]["explicit"]
        and command_effect in {"creates-artifact", "mutates-project"}
    ):
        selected = selection["selection"]["selectedProject"]
        available = ", ".join(selection["selection"]["availableProjects"])
        message = (
            f"Command '{args.command_id}' changes Project-local state, "
            "so a Workspace containing multiple Projects requires an "
            f"explicit --project ID. Default is '{selected}'. Available: "
            f"{available}"
        )
        raise CliCommandError(
            "workspace.explicit-project-required",
            message,
            issues=[
                ValidationIssue(
                    selection["workspace"]["configurationPath"],
                    "workspace.explicit-project-required",
                    message,
                )
            ],
            context=_project_result_context(args, project),
        )
    return project


def _orientation_project(args: argparse.Namespace):
    project = _selected_project(args)
    owner = resolve_session_worktree_owner(project)
    return owner[0] if owner is not None else project


def _brief_next_actions(brief: dict[str, Any]) -> list[dict[str, Any]]:
    actions = [
        item
        for item in [brief["primaryAction"], *brief["supportingActions"]]
        if item is not None
    ]
    return [
        next_action(
            item["id"],
            item["description"],
            item["argv"],
            item["effect"],
        )
        for item in actions
    ]


def _study_create(args: argparse.Namespace) -> CommandResult:
    project = _selected_project(args)
    external_intake = args.request is not None or args.dataset is not None
    if bool(args.request) != bool(args.dataset):
        raise CliUsageError("--request and --dataset are required together")
    manual_fields = {
        "--request-path": args.request_path,
        "--position-snapshot-path": args.position_snapshot_path,
        "--dataset-id": args.dataset_id,
        "--dataset-version": args.dataset_version,
        "--dataset-path": args.dataset_path,
        "--asset-class": args.asset_class,
        "--asset": args.asset,
        "--start": args.start,
        "--end": args.end,
    }
    if external_intake:
        mixed = [name for name, value in manual_fields.items() if value is not None]
        if mixed:
            raise CliUsageError(
                "--request/--dataset infer the complete Study-owned data "
                "contract and cannot be mixed with: " + ", ".join(mixed)
            )
    else:
        required_manual = {
            "--dataset-id": args.dataset_id,
            "--asset-class": args.asset_class,
            "--asset": args.asset,
            "--start": args.start,
            "--end": args.end,
        }
        missing = [name for name, value in required_manual.items() if value is None]
        if missing:
            raise CliUsageError(
                "manual Study construction requires: " + ", ".join(missing)
            )
    if args.position_snapshot_path and not args.request_path:
        raise CliUsageError("--position-snapshot-path requires --request-path")
    if bool(args.upstream_run) != bool(args.upstream_artifact):
        raise CliUsageError(
            "--upstream-run and at least one --upstream-artifact are required together"
        )
    owned_dataset = (
        prepare_study_owned_dataset(
            project,
            args.study_id,
            args.request,
            args.dataset,
        )
        if external_intake
        else None
    )
    dataset = (
        owned_dataset.dataset
        if owned_dataset is not None
        else StudyDataset(
            args.dataset_id,
            args.dataset_version or "working",
            args.asset_class,
            args.asset,
            StudyTimeRange(args.start, args.end),
            args.dataset_path,
        )
    )
    research_request = (
        owned_dataset.research_request
        if owned_dataset is not None
        else (
            StudyResearchRequest(
                args.request_path,
                args.position_snapshot_path,
            )
            if args.request_path
            else None
        )
    )
    dependency_paths = list(
        dict.fromkeys(
            [
                *(
                    owned_dataset.generated_dependencies
                    if owned_dataset is not None
                    else []
                ),
                *(args.dependency or []),
            ]
        )
    )
    definition = StudyDefinition(
        schema_version=1,
        id=args.study_id,
        name=(args.name or args.study_id),
        description=args.description,
        program="program.md",
        subject=StudySubject(
            args.subject_kind,
            args.subject_name or args.study_id,
            args.subject_version,
        ),
        editable={"paths": [] if args.no_editable else args.editable},
        judge=StudyJudge(
            "python",
            args.judge,
            args.judge_path or [args.judge],
            args.judge_arg,
            args.timeout,
        ),
        objective=StudyObjective(
            args.metric,
            args.direction,
            args.minimum_improvement,
        ),
        dataset=dataset,
        dependencies=(
            {"paths": dependency_paths}
            if dependency_paths
            else None
        ),
        research_request=research_request,
        upstream_evidence=(
            bind_upstream_evidence(
                project,
                args.upstream_run,
                args.upstream_artifact,
            )
            if args.upstream_run
            else None
        ),
    )
    try:
        study = (
            create_study_with_owned_dataset(project, definition, owned_dataset)
            if owned_dataset is not None
            else create_study(project, definition)
        )
        study_data = _study_data(project, study)
    except Exception:
        if owned_dataset is not None:
            rollback_study_owned_dataset(owned_dataset)
        raise
    result_artifacts = [
        artifact(
            "study",
            study.definition.id,
            study.manifest_path,
            immutable=False,
        )
    ]
    if owned_dataset is not None:
        result_artifacts.extend(
            [
                artifact(
                    "research-request",
                    f"{study.definition.id}:request",
                    project.root_dir / owned_dataset.research_request.path,
                    immutable=False,
                ),
                artifact(
                    "dataset-snapshot",
                    f"{study.definition.id}:dataset",
                    owned_dataset.data_owner_root / "ohlcv" / "snapshot.json",
                    immutable=False,
                ),
            ]
        )
        if owned_dataset.research_request.position_snapshot_path is not None:
            result_artifacts.append(
                artifact(
                    "position-snapshot",
                    owned_dataset.position_snapshot["id"],
                    project.root_dir
                    / owned_dataset.research_request.position_snapshot_path,
                    immutable=False,
                )
            )
    return CommandResult(
        "study.create",
        study_data,
        (
            f"Created AutoQuant Study '{study.definition.id}' at {study.root_dir}\n"
            + (
                "Materialized Study-owned request and OHLCV: "
                f"{owned_dataset.prepared.package['id']}@"
                f"{owned_dataset.prepared.package['version']}\n"
                if owned_dataset is not None
                else ""
            )
        ),
        project_context(project),
        result_artifacts,
        [
            next_action(
                "run.execute",
                "Execute the fixed Study through its bounded Python Judge.",
                [
                    "aq",
                    "run",
                    "execute",
                    str(project.root_dir),
                    "--study",
                    study.definition.id,
                    "--json",
                ],
                "creates-artifact",
            )
        ],
    )


def _study_intake(args: argparse.Namespace) -> CommandResult:
    project = _selected_project(args)
    study, intake = create_book_risk_study_intake(
        project,
        args.study_id,
        args.request,
        name=args.name,
        dataset_path=args.dataset,
    )
    return CommandResult(
        "study.intake",
        {
            "study": _study_data(project, study),
            "intake": intake,
        },
        (
            f"Created fixed Book Risk Study '{study.definition.id}' at "
            f"{study.root_dir}\n"
            f"Request: {intake['requestPath']}\n"
            f"Position snapshot: {intake['positionSnapshotPath']}\n"
            f"Dataset mode: {intake['datasetMode']}\n"
            f"Dataset hash: {intake['datasetHash']}\n"
            "Authority: historical decision support only; no trading authority\n"
        ),
        project_context(project),
        [
            artifact(
                "study",
                study.definition.id,
                study.manifest_path,
                immutable=False,
            ),
            artifact(
                "research-request",
                f"{study.definition.id}:request",
                project.root_dir / intake["requestPath"],
                immutable=False,
            ),
            artifact(
                "position-snapshot",
                intake["positionSnapshotId"],
                project.root_dir / intake["positionSnapshotPath"],
                immutable=False,
            ),
            *(
                [
                    artifact(
                        "dataset-snapshot",
                        f"{study.definition.id}:dataset",
                        project.root_dir / intake["datasetSnapshotPath"],
                        immutable=False,
                    )
                ]
                if "datasetSnapshotPath" in intake
                else []
            ),
        ],
        [
            next_action(
                "run.execute",
                "Execute this independently fixed Book Risk Study.",
                [
                    "aq",
                    "run",
                    "execute",
                    str(project.root_dir),
                    "--study",
                    study.definition.id,
                    "--json",
                ],
                "creates-artifact",
            )
        ],
    )


def _study_data(project, study) -> dict[str, Any]:
    intake = load_project_intake(project)
    dataset_snapshot = load_study_dataset_snapshot(project, study)
    definition = study.definition.to_dict()
    return {
        "definition": definition,
        "path": str(study.root_dir),
        "programPath": str(study.program_path),
        "researchRequest": definition.get("research_request"),
        "upstreamEvidence": definition.get("upstream_evidence"),
        "datasetContext": (
            dataset_snapshot_class_context(dataset_snapshot)
            if dataset_snapshot is not None
            else intake_dataset_class_context(intake)
            if intake is not None
            else None
        ),
        "candidateContract": build_candidate_contract(project, study),
        "identity": {
            "studyHash": study.study_hash,
            "programHash": study.program_hash,
            "judgeHash": study.judge_hash,
            "judgeSourceHashes": study.judge_hashes,
            "sourceHash": study.source_hash,
            "sourceHashes": study.editable_hashes,
            **(
                {
                    "dependencyHash": study.dependency_hash,
                    "dependencySourceHashes": study.dependency_hashes,
                }
                if study.dependency_hash is not None
                else {}
            ),
            **(
                {"upstreamEvidenceHash": study.upstream_evidence_hash}
                if study.upstream_evidence_hash is not None
                else {}
            ),
            "datasetHash": study.dataset_hash,
            "datasetSourceHashes": study.dataset_hashes,
            "inputHash": study.input_hash,
        },
    }


def _study_list(args: argparse.Namespace) -> CommandResult:
    project = _selected_project(args)
    studies = list_studies(project)
    lines = [f"AutoQuant Studies in {project.manifest.name}:"]
    lines.extend(
        f"  {item.id}  {item.subject_kind}  "
        f"{item.primary_metric}:{item.direction}  {item.name}"
        for item in studies
    )
    if not studies:
        lines.append("  No Studies")
    return CommandResult(
        "study.list",
        {"studies": [item.to_dict() for item in studies]},
        "\n".join(lines) + "\n",
        project_context(project),
    )


def _study_inspect(args: argparse.Namespace) -> CommandResult:
    project = _selected_project(args)
    study = load_study(project, args.study)
    data = _study_data(project, study)
    candidate_contract = data["candidateContract"]
    dataset_context = data["datasetContext"]
    return CommandResult(
        "study.inspect",
        data,
        (
            f"AutoQuant Study: {study.definition.name} ({study.definition.id})\n"
            f"Subject: {study.definition.subject.kind} "
            f"{study.definition.subject.name}@{study.definition.subject.version}\n"
            f"Primary: {study.definition.objective.metric} "
            f"({study.definition.objective.direction})\n"
            f"Dataset: {study.definition.dataset.id}@"
            f"{study.definition.dataset.version} · "
            f"{len(study.definition.dataset.universe)} assets · "
            f"{study.definition.dataset.time_range.start}.."
            f"{study.definition.dataset.time_range.end}\n"
            + (
                f"Dataset classes: {dataset_context['assetClass']} · "
                f"{dataset_context['assetClassSource']}\n"
                if dataset_context is not None
                else ""
            )
            + (
                "Candidate panel: "
                f"{candidate_contract['api']['kind']} · base "
                f"{candidate_contract['data']['baseInterval'] or 'unspecified'}"
                " · feature intervals "
                f"{', '.join(candidate_contract['data']['featureIntervals']) or 'none'}\n"
                f"Interval authority: {candidate_contract['data']['availabilityRule']}\n"
                "Observation semantics: "
                f"{candidate_contract['data']['observationSemantics']['timestampMeaning']} · "
                f"{candidate_contract['data']['observationSemantics']['panelShape']} · "
                f"{candidate_contract['data']['observationSemantics']['targetClock']}\n"
                "Context visibility: "
                f"{candidate_contract['data']['observationSemantics']['contextVisibility']}\n"
                "Component roles: "
                f"{', '.join(candidate_contract['components']['roles'])}\n"
                if candidate_contract is not None
                else ""
            )
            + (
                "Fixed dependencies: "
                f"{len(study.dependency_hashes)} files · "
                f"{study.dependency_hash}\n"
                if study.dependency_hash is not None
                else ""
            )
            + (
                "Study request: "
                f"{study.definition.research_request.path}\n"
                if study.definition.research_request is not None
                else ""
            )
            + (
                "Upstream evidence: "
                f"{study.definition.upstream_evidence.run_id} · "
                f"{len(study.definition.upstream_evidence.artifacts)} artifacts · "
                f"{study.upstream_evidence_hash}\n"
                if study.definition.upstream_evidence is not None
                else ""
            )
            + f"Input hash: {study.input_hash}\n"
        ),
        project_context(project),
        [
            artifact(
                "study",
                study.definition.id,
                study.manifest_path,
                immutable=False,
            )
        ],
        [
            next_action(
                "run.execute",
                "Execute the Study through its fixed Judge.",
                [
                    "aq",
                    "run",
                    "execute",
                    str(project.root_dir),
                    "--study",
                    study.definition.id,
                    "--json",
                ],
                "creates-artifact",
            )
        ],
    )


def _run_artifacts(run) -> list[dict[str, Any]]:
    items = [artifact("run", run.result["id"], run.root_dir, immutable=True)]
    items.extend(
        artifact(
            item["kind"],
            f"{run.result['id']}:{item['path']}",
            run.root_dir / item["path"],
            immutable=True,
        )
        for item in run.result["artifacts"]
    )
    return items


def _run_execute(args: argparse.Namespace) -> CommandResult:
    project = _selected_project(args)
    run = execute_study(project, args.study)
    metric = run.result["objective"]["metric"]
    value = run.result["metrics"].get(metric)
    actions = [
        next_action(
            "run.show",
            "Verify and inspect the immutable RunResult.",
            [
                "aq",
                "run",
                "show",
                str(project.root_dir),
                "--run",
                run.result["id"],
                "--json",
            ],
            "read-only",
        ),
    ]
    if (
        run.result["status"] == "succeeded"
        and metric == "validation_mean_ic"
    ):
        actions.append(
            next_action(
                "run.factor",
                "Inspect the verified professional Factor tear sheet.",
                [
                    "aq",
                    "run",
                    "factor",
                    str(project.root_dir),
                    "--run",
                    run.result["id"],
                    "--json",
                ],
                "read-only",
            )
        )
    if (
        run.result["status"] == "succeeded"
        and metric == "validation_mean_net_sharpe"
    ):
        actions.append(
            next_action(
                "run.rl",
                "Inspect the verified governed RL policy evidence.",
                [
                    "aq",
                    "run",
                    "rl",
                    str(project.root_dir),
                    "--run",
                    run.result["id"],
                    "--json",
                ],
                "read-only",
            )
        )
    actions.append(
        next_action(
            "run.list",
            "List immutable Runs for this Study.",
            [
                "aq",
                "run",
                "list",
                str(project.root_dir),
                "--study",
                run.result["study"]["id"],
                "--json",
            ],
            "read-only",
        )
    )
    return CommandResult(
        "run.execute",
        run.result,
        (
            f"Run {run.result['id']}: {run.result['status']}\n"
            f"Study: {run.result['study']['id']}\n"
            f"{metric}: {value if value is not None else 'unavailable'}\n"
            f"{run.result['summary']}\n"
        ),
        project_context(project),
        _run_artifacts(run),
        actions,
    )


def _run_list(args: argparse.Namespace) -> CommandResult:
    project = _selected_project(args)
    if args.study:
        load_study(project, args.study)
    runs = list_runs(project, args.study)
    lines = [f"AutoQuant Runs in {project.manifest.name}:"]
    lines.extend(
        f"  {item.id}  {item.status}  {item.study_id}  "
        f"{item.primary_metric}="
        f"{item.primary_value if item.primary_value is not None else 'unavailable'}"
        for item in runs
    )
    if not runs:
        lines.append("  No Runs")
    actions = []
    if runs:
        actions.append(
            next_action(
                "run.show",
                "Inspect the latest listed immutable Run.",
                [
                    "aq",
                    "run",
                    "show",
                    str(project.root_dir),
                    "--run",
                    runs[-1].id,
                    "--json",
                ],
                "read-only",
            )
        )
    return CommandResult(
        "run.list",
        {"runs": [item.to_dict() for item in runs]},
        "\n".join(lines) + "\n",
        project_context(project),
        next_actions=actions,
    )


def _run_show(args: argparse.Namespace) -> CommandResult:
    project = _selected_project(args)
    run = load_run(project, args.run)
    metric = run.result["objective"]["metric"]
    value = run.result["metrics"].get(metric)
    upstream = run.result.get("upstreamEvidence")
    upstream_line = (
        f"Upstream evidence: {upstream['run_id']} · Study "
        f"{upstream['study_id']} · {len(upstream['artifacts'])} artifacts\n"
        if isinstance(upstream, dict)
        else ""
    )
    failure_disposition = run.result.get("failureDisposition")
    failure_line = (
        f"Failure disposition: {failure_disposition or 'repair-required'}\n"
        + "Errors: "
        + "; ".join(
            f"{item['code']} — {item['message']}"
            for item in run.result["errors"]
        )
        + "\n"
        if run.result["status"] == "failed"
        else ""
    )
    return CommandResult(
        "run.show",
        {"manifest": run.manifest, "result": run.result},
        (
            f"Immutable Run: {run.result['id']}\n"
            f"Status: {run.result['status']}\n"
            f"{failure_line}"
            f"Study: {run.result['study']['id']}\n"
            f"{metric}: {value if value is not None else 'unavailable'}\n"
            f"{upstream_line}"
            f"Input hash: {run.result['inputHash']}\n"
        ),
        project_context(project),
        _run_artifacts(run),
    )


def _run_factor(args: argparse.Namespace) -> CommandResult:
    project = _selected_project(args)
    diagnostics = load_factor_diagnostics(
        project,
        args.run,
        point_limit=args.points,
    )
    summary = diagnostics["summary"]
    validation = summary["validation"]
    qualification = diagnostics["factorQualification"]
    components = diagnostics["factorComponents"]
    quantile_evidence = diagnostics["quantileEvidence"]
    quantile_line = (
        "Quantile evidence: available · "
        f"{quantile_evidence['artifactRows']} artifact rows · diagnostic only\n"
        if quantile_evidence["status"] == "available"
        else (
            "Quantile evidence: protocol-unavailable · "
            f"{quantile_evidence['reasonCode']} · "
            f"{quantile_evidence['artifactRows']} artifact rows — "
            f"{quantile_evidence['reason']}\n"
        )
    )
    qualification_line = ""
    if qualification["available"]:
        qualified = qualification["validation"]
        incremental = qualified["incremental"]
        qualification_measure = (
            "temporal rank contribution"
            if "temporal-neutralization" in qualification["method"]
            else "IC"
        )
        qualification_line = (
            "Factor qualification: "
            f"{qualification['diagnosis']['stage']} · focus "
            f"{qualification['diagnosis']['iterationFocus']} · "
            f"claim {qualification['claim']['claim']} · "
            f"comparison style "
            f"{qualification['selection']['dominantStyle']} · "
            f"raw/residual/blend validation {qualification_measure} "
            f"{qualified['candidate']['meanRankIc']}/"
            f"{qualified['styleNeutralCandidate']['meanRankIc']}/"
            f"{qualified['equalRankBlend']['meanRankIc']} · "
            "blend uplift vs style "
            f"{incremental['blendUpliftVsStyle']} · "
            "research prioritization only\n"
        )
    component_line = ""
    if components["available"]:
        diagnosis = components["validationDiagnosis"]
        component_measure = (
            "temporal rank contribution"
            if components["evaluationMode"]
            in {"single-asset-temporal", "two-asset-relative-value"}
            else "rank IC"
        )
        component_line = (
            "Declared components: "
            f"{components['trialDisclosure']['materializedComponents']} · "
            f"strongest raw {component_measure} "
            f"{diagnosis['strongestRawComponent']} "
            f"({diagnosis['strongestRawMeanIc']}) · "
            f"strongest residual {component_measure} "
            f"{diagnosis['strongestResidualComponent']} "
            f"({diagnosis['strongestResidualMeanIc']}) · "
            "best fixed-blend removal "
            f"{diagnosis['removalMostImprovesFixedBlend']} "
            f"({diagnosis['bestRemovalDeltaMeanIc']}) · "
            "declared diagnostic evidence only\n"
        )
    return CommandResult(
        "run.factor",
        diagnostics,
        (
            f"Factor Run: {diagnostics['run']['id']}\n"
            f"Prediction outcome: {diagnostics['factorOutcome']['kind']} · "
            f"{diagnostics['factorOutcome']['label']}\n"
            f"Selection mean rank IC: {validation['meanRankIc']}\n"
            f"HAC t / p: {validation['hacTStatistic']} / "
            f"{validation['hacNormalPValue']}\n"
            f"IC path: {diagnostics['icPath']['totalRows']} rows → "
            f"{diagnostics['icPath']['sampledRows']} points\n"
            f"Mean coverage / rank turnover: {summary['meanCoverage']} / "
            f"{summary['meanRankTurnover']}\n"
            f"{quantile_line}"
            f"{qualification_line}"
            f"{component_line}"
            "Test and longer-horizon evidence are diagnostic only.\n"
        ),
        project_context(project),
        [
            artifact(
                kind,
                f"{diagnostics['run']['id']}:{kind}",
                project.root_dir
                / project.manifest.directories["runs"]
                / diagnostics["run"]["id"]
                / item["path"],
                immutable=True,
            )
            for kind, item in diagnostics["artifacts"].items()
        ],
    )


def _run_portfolio(args: argparse.Namespace) -> CommandResult:
    project = _selected_project(args)
    diagnostics = load_portfolio_diagnostics(
        project,
        args.run,
        point_limit=args.points,
    )
    summary = diagnostics["path"]["summary"]
    book = diagnostics["currentBook"]
    sizing = diagnostics["sizingAnatomy"]
    sizing_risk = sizing["componentRisk"]
    sizing_summary = (
        "Current sizing: "
        f"{sizing['construction']['family']} · "
        f"raw/governed/executed gross "
        f"{sizing['construction']['rawGross']}/"
        f"{sizing['construction']['governedGross']}/"
        f"{sizing['construction']['executedGross']} · "
        f"at-cap assets "
        f"{sum(len(side['atCapAssets']) for side in sizing['sides'])} · "
        "component-risk HHI "
        f"{sizing_risk['absoluteConcentrationHhi']} · largest "
        f"{sizing_risk['largestAbsoluteContributor']} · "
        "historical decision support only\n"
    )
    diversification = diagnostics["diversificationStress"]
    diversification_current = diversification["current"]
    diversification_validation = diversification["validation"]
    diversification_ladder = "/".join(
        (
            f"{scenario['blendToPerfectCorrelation']:.0%}:"
            f"{scenario['forecastAnnualized']:.4f}:"
            f"{scenario['breachesCeiling']}"
        )
        for scenario in diversification_current["scenarios"]
    )
    validation_ladder = "/".join(
        (
            f"{scenario['blendToPerfectCorrelation']:.0%}:"
            f"{scenario['stressBreachRate']}"
        )
        for scenario in diversification_validation["scenarios"]
    )
    diversification_summary = (
        "Diversification stress: "
        f"{diversification_current['state']} · active assets "
        f"{diversification_current['activeAssets']} · effective risk bets "
        f"{diversification_current['effectiveRiskBets']} · sample/perfect-"
        "correlation annualized volatility "
        f"{diversification_current['sampleForecastAnnualized']}/"
        f"{diversification_current['perfectCorrelationForecastAnnualized']} · "
        f"ceiling breach "
        f"{diversification_current['stressBreachesCeiling']} · current "
        f"25%/50%/100% forecast:breach {diversification_ladder} · validation "
        f"25%/50%/100% breach rate {validation_ladder} · "
        "context only\n"
    )
    viability = diagnostics["strategyViability"]
    viability_validation = viability["validation"]
    viability_friction = viability_validation["friction"]
    break_even = viability_friction["breakEvenCost"]
    break_even_label = (
        f"{break_even['bps']} bps"
        if break_even["bps"] is not None
        else break_even["status"]
    )
    viability_summary = (
        "Validation viability: "
        f"{viability['diagnosis']['stage']} · focus "
        f"{viability['diagnosis']['iterationFocus']} · rank IC "
        f"{viability_validation['factorRankIc']} · gross/net Sharpe "
        f"{viability_validation['gross']['sharpe']}/"
        f"{viability_validation['net']['sharpe']} · annual turnover "
        f"{viability_friction['annualizedOneWayTurnover']} · break-even "
        f"{break_even_label} · research prioritization only\n"
    )
    monetization = diagnostics["signalMonetization"]
    monetization_validation = monetization["validation"]
    monetization_stages = {
        item["id"]: item for item in monetization_validation["stages"]
    }
    monetization_summary = (
        "Validation signal monetization: "
        f"{monetization['diagnosis']['outcome']} · focus "
        f"{monetization['diagnosis']['iterationFocus']} · normalized intent/raw/"
        "governed/executed gross/net annualized additive contribution "
        f"{monetization_stages['equalIntent']['annualizedContribution']}/"
        f"{monetization_stages['preGovernorSizing']['annualizedContribution']}/"
        f"{monetization_stages['governedTarget']['annualizedContribution']}/"
        f"{monetization_stages['executedGross']['annualizedContribution']}/"
        f"{monetization_stages['executedNet']['annualizedContribution']} · "
        "largest adverse "
        f"{monetization['diagnosis']['largestAdverseStage']} "
        f"{monetization['diagnosis']['largestAdverseAnnualizedDelta']} · "
        "additive diagnostic only\n"
    )
    capacity = diagnostics["liquidityCapacity"]
    validation_capacity = capacity["validation"] if capacity["available"] else None
    capacity_summary = (
        "Liquidity capacity: legacy evidence unavailable\n"
        if validation_capacity is None
        else (
            "Validation 1% participation capacity p10: "
            f"{validation_capacity['capacity1Pct']['tenthPercentileNav']} · "
            "trade-date coverage "
            f"{validation_capacity['tradeDateCoverage']} · contextual only\n"
        )
    )
    executed_risk = diagnostics["executedBookRisk"]
    validation_execution_risk = (
        executed_risk["validation"]
        if executed_risk["available"]
        else None
    )
    execution_risk_summary = (
        "Executed-book risk: legacy evidence unavailable\n"
        if validation_execution_risk is None
        else (
            "Validation executed-book risk: "
            f"{validation_execution_risk['executedBreachDates']} breaches · "
            f"{validation_execution_risk['riskRebalanceOverrideDates']} "
            "risk overrides · coverage "
            f"{validation_execution_risk['forecastCoverage']} · "
            "contextual only\n"
        )
    )
    lifecycle = diagnostics["positionLifecycle"]
    validation_lifecycle = (
        lifecycle["validation"] if lifecycle["available"] else None
    )
    lifecycle_summary = (
        "Mechanical position lifecycle: legacy evidence unavailable\n"
        if validation_lifecycle is None
        else (
            "Validation position lifecycle: "
            f"{validation_lifecycle['completeEpisodes']} complete episodes · "
            f"win rate {validation_lifecycle['completeEpisodeWinRate']} · "
            "median holding "
            f"{validation_lifecycle['medianCompleteHoldingBars']} bars · "
            f"payoff {validation_lifecycle['completePayoffRatio']} · "
            "intent mismatch "
            f"{validation_lifecycle['intentMismatchRate']} · contextual only\n"
        )
    )
    neighborhood = diagnostics["parameterNeighborhood"]
    validation_neighborhood = (
        neighborhood["validation"] if neighborhood["available"] else None
    )
    neighborhood_summary = (
        "Mechanical parameter neighborhood: legacy evidence unavailable\n"
        if validation_neighborhood is None
        else (
            "Validation parameter neighborhood: "
            f"{validation_neighborhood['aggregate']['configurationCount']} "
            "predeclared cells · positive Sharpe "
            f"{validation_neighborhood['aggregate']['positiveNetSharpeRate']} · "
            "sign agreement "
            f"{validation_neighborhood['aggregate']['signAgreementWithBaseRate']} · "
            "worst Sharpe delta "
            f"{validation_neighborhood['aggregate']['worstNetSharpeDelta']} · "
            "context only, no parameter selection\n"
        )
    )
    translation = diagnostics["translationRobustness"]
    if translation["reason"] == "legacy-run-evidence-unavailable":
        translation_summary = (
            "Target translation robustness: legacy evidence unavailable\n"
        )
    elif not translation["applicable"]:
        translation_summary = (
            "Target translation robustness: not applicable to "
            "cross-sectional scores\n"
        )
    else:
        translation_summary = (
            "Validation target translation: "
            f"{translation['diagnosis']['status']} · minimum active-state "
            "agreement "
            f"{translation['diagnosis']['minimumActiveStateAgreementRate']} · "
            "maximum target MAE "
            f"{translation['diagnosis']['maximumMeanAbsoluteTargetDelta']} · "
            "40/60/120 causal windows, context only, no window selection\n"
        )
    return CommandResult(
        "run.portfolio",
        diagnostics,
        (
            f"Portfolio Run: {diagnostics['run']['id']}\n"
            f"Selection: {diagnostics['run']['primaryMetric']}="
            f"{diagnostics['run']['primaryValue']}\n"
            f"Path: {diagnostics['path']['totalRows']} rows → "
            f"{diagnostics['path']['sampledRows']} points\n"
            f"Net total return: {summary['netTotalReturn']}\n"
            f"Maximum drawdown: {summary['maximumDrawdown']} at "
            f"{summary['maximumDrawdownAt']}\n"
            f"Latest historical book: {book['timestamp']} · "
            f"gross {book['grossExposure']} · net {book['netExposure']}\n"
            f"{viability_summary}"
            f"{monetization_summary}"
            f"{sizing_summary}"
            f"{diversification_summary}"
            f"Risk governor: {book['riskGovernorStatus']} · scale "
            f"{book['riskGovernorScale']} · annualized forecast "
            f"{book['riskForecastPreAnnualized']} → "
            f"{book['riskForecastPostAnnualized']} · ceiling "
            f"{book['riskVolatilityCeilingAnnualized']}\n"
            f"Executed book: {book['executionRiskStatus']} · annualized "
            f"forecast {book['executedRiskForecastAnnualized']} · ceiling "
            f"{book['executionRiskCeilingAnnualized']} · "
            f"{book['executionReason']}\n"
            f"{execution_risk_summary}"
            f"{capacity_summary}"
            f"{lifecycle_summary}"
            f"{translation_summary}"
            f"{neighborhood_summary}"
        ),
        project_context(project),
        [
            artifact(
                kind,
                f"{diagnostics['run']['id']}:{kind}",
                project.root_dir
                / project.manifest.directories["runs"]
                / diagnostics["run"]["id"]
                / item["path"],
                immutable=True,
            )
            for kind, item in diagnostics["artifacts"].items()
        ],
    )


def _run_book_risk(args: argparse.Namespace) -> CommandResult:
    project = _selected_project(args)
    diagnostics = load_book_risk_diagnostics(
        project,
        args.run,
        point_limit=args.points,
    )
    current = diagnostics["current"]
    largest = diagnostics["riskContributions"][0]
    reduction = diagnostics["reductionPriority"][0]
    correlations = diagnostics["pairwiseCorrelations"]
    snapshot = diagnostics["positionSnapshot"]
    scenario_comparison = diagnostics["scenarioComparison"]
    sizing = diagnostics["positionSizing"]
    drawdown = diagnostics["drawdown"]
    drawdown_line = (
        "Historical maximum drawdown: unavailable for this legacy Run\n"
        if drawdown.get("available") is False
        else (
            f"Historical maximum drawdown: "
            f"{drawdown['maximumDrawdown']} · peak "
            f"{drawdown['peakTimestamp']} · trough "
            f"{drawdown['troughTimestamp']} · recovery "
            f"{drawdown['recoveryTimestamp'] or 'not recovered'}\n"
        )
    )
    primary_lookback = int(current["lookbackBars"])
    primary_scenarios = sorted(
        (
            {
                "id": scenario["id"],
                **next(
                    row
                    for row in scenario["lookbacks"]
                    if int(row["lookbackBars"]) == primary_lookback
                ),
            }
            for scenario in scenario_comparison["scenarios"]
        ),
        key=lambda item: item["volatilityRank"],
    )
    scenario_line = (
        "Caller-supplied scenarios: none\n"
        if not primary_scenarios
        else (
            f"Caller-supplied scenarios: {len(primary_scenarios)} · "
            "lowest primary-window modeled volatility "
            f"{primary_scenarios[0]['id']} · delta "
            f"{primary_scenarios[0]['annualizedVolatilityDelta']}\n"
        )
    )
    sizing_line = (
        "Caller-bounded position sizing: not requested\n"
        if sizing["status"] == "not-requested"
        else (
            "Caller-bounded position sizing: "
            f"{sizing['status']} · {sizing['policy']['direction']} "
            f"{sizing['result']['asset']} "
            f"{sizing['result']['startingWeight']} → "
            f"{sizing['result']['resultingWeight']} · cash "
            f"{sizing['result']['startingCashWeight']} → "
            f"{sizing['result']['resultingCashWeight']} · modeled volatility "
            f"{sizing['result']['annualizedVolatility']} against "
            f"{sizing['policy']['annualizedVolatilityCeiling']} ceiling "
            f"on {sizing['policy']['lookbackBars']} bars\n"
        )
    )
    correlation_line = (
        "Strongest pair: unavailable for a one-asset reported baseline\n"
        if not correlations
        else (
            f"Strongest pair: {correlations[0]['leftAsset']}/"
            f"{correlations[0]['rightAsset']} · "
            f"{correlations[0]['correlation']}\n"
        )
    )
    return CommandResult(
        "run.book-risk",
        diagnostics,
        (
            f"Book Risk Run: {diagnostics['run']['id']}\n"
            f"Reported snapshot: {snapshot['snapshotKind']} at "
            f"{snapshot['asOf']} · {len(snapshot['weights'])} positions\n"
            f"Annualized volatility ({primary_lookback}-bar primary): "
            f"{current['annualizedVolatility']}\n"
            f"Effective risk bets / component-risk HHI: "
            f"{current['effectiveRiskBets']} / "
            f"{current['componentRiskHhi']}\n"
            f"First principal-component share: "
            f"{current['firstPrincipalComponentVarianceShare']}\n"
            f"{drawdown_line}"
            f"Largest risk contributor: {largest['asset']} · "
            f"{largest['absoluteRiskShare']}\n"
            f"First standardized reduction: {reduction['asset']} · "
            "volatility reduction per 1.0 weight "
            f"{reduction['volatilityReductionPerWeight']}\n"
            f"{correlation_line}"
            + scenario_line
            + sizing_line
            + "Reported weights are not authenticated account truth; reduction "
            "and supplied-scenario evidence are historical sensitivities. "
            "Caller-bounded sizing is a historical target-position calculation, "
            "not a future-volatility guarantee, optimization search, or order. "
            "Drawdown uses a daily constant-weight close-to-close research path, "
            "not reconstructed account performance or a future guarantee.\n"
        ),
        project_context(project),
        [
            artifact(
                kind,
                f"{diagnostics['run']['id']}:{kind}",
                project.root_dir
                / project.manifest.directories["runs"]
                / diagnostics["run"]["id"]
                / item["path"],
                immutable=True,
            )
            for kind, item in diagnostics["artifacts"].items()
        ],
    )


def _run_event_study(args: argparse.Namespace) -> CommandResult:
    project = _selected_project(args)
    diagnostics = load_event_study_diagnostics(project, args.run)
    policy = diagnostics["policy"]
    populations = diagnostics["populations"]
    primary = diagnostics["distributions"]["primaryEventAsset"]
    excess = diagnostics["distributions"]["primaryEventExcess"]
    unconditional = diagnostics["distributions"]["unconditionalAsset"]
    comparison = diagnostics["comparisons"]
    return CommandResult(
        "run.event-study",
        diagnostics,
        (
            f"Event Study Run: {diagnostics['run']['id']}\n"
            f"Event: {policy['event']['asset']} opening gap "
            f"{policy['event']['comparator']} "
            f"{policy['event']['thresholdReturn']:.2%}\n"
            f"Clock: wait {policy['timing']['waitBars']} bars · hold "
            f"{policy['timing']['holdingBars']} bars · matched "
            f"{policy['references']['matchedAsset']}\n"
            f"Population: {populations['qualifyingEvents']} qualifying · "
            f"{populations['completeEvents']} complete · "
            f"{populations['primaryEvents']} primary · "
            f"{populations['overlapExcludedEvents']} overlap-excluded · "
            f"{populations['rightCensoredEvents']} right-censored\n"
            f"Primary mean / hit rate: {primary['mean']} / "
            f"{primary['positiveRate']}\n"
            f"Unconditional mean: {unconditional['mean']} · delta "
            f"{comparison['primaryMeanMinusUnconditionalAssetMean']}\n"
            f"Matched mean excess: {excess['mean']}\n"
            f"Conclusion: {diagnostics['conclusion']['status']} · "
            f"{diagnostics['conclusion']['observedPrimaryEvents']}/"
            f"{diagnostics['conclusion']['minimumEvents']} minimum events\n"
            "Historical descriptive association only; no causal, Order, or "
            "trading authority.\n"
        ),
        project_context(project),
        [
            artifact(
                kind,
                f"{diagnostics['run']['id']}:{kind}",
                project.root_dir
                / project.manifest.directories["runs"]
                / diagnostics["run"]["id"]
                / item["path"],
                immutable=True,
            )
            for kind, item in diagnostics["artifacts"].items()
        ],
    )


def _run_book_path_stress(args: argparse.Namespace) -> CommandResult:
    project = _selected_project(args)
    diagnostics = load_book_path_stress_diagnostics(project, args.run)
    summary = diagnostics["summary"]
    episode_lines = "".join(
        f"  {item['rank']}. {item['startTimestamp']} → {item['endTimestamp']} · "
        f"terminal {item['terminalBookReturn']} · worst {item['worstInterimBookReturn']} "
        f"at {item['worstInterimTimestamp']} · dominant {item['dominantLossContributor']}\n"
        for item in diagnostics["episodes"]
    )
    return CommandResult(
        "run.book-path-stress",
        diagnostics,
        (
            f"Book Path Stress Run: {diagnostics['run']['id']}\n"
            f"Complete windows / selected episodes: {summary['eligibleWindowCount']} / "
            f"{summary['selectedEpisodeCount']}\n"
            f"Worst terminal book return: {summary['worstTerminalBookReturn']}\n"
            f"Same dominant loss contributor across all episodes: "
            f"{summary['sameDominantLossContributorAcrossAllEpisodes']}"
            + (
                f" · {summary['dominantLossContributorAcrossAllEpisodes']}\n"
                if summary["dominantLossContributorAcrossAllEpisodes"] is not None
                else "\n"
            )
            + episode_lines
            + "Historical fixed-unit paths only; no forecast, account, Order, or trading authority.\n"
        ),
        project_context(project),
        [
            artifact(
                kind,
                f"{diagnostics['run']['id']}:{kind}",
                project.root_dir / project.manifest.directories["runs"] / diagnostics["run"]["id"] / item["path"],
                immutable=True,
            )
            for kind, item in diagnostics["artifacts"].items()
        ],
    )


def _run_allocation(args: argparse.Namespace) -> CommandResult:
    project = _selected_project(args)
    diagnostics = load_allocation_diagnostics(
        project,
        args.run,
        points=args.points,
    )
    latest = diagnostics["latestDecision"]
    current = diagnostics["currentState"]
    conclusion = diagnostics["conclusion"]
    validation = diagnostics["splits"]["validation"]
    validation_fidelity = diagnostics["constructionFidelity"]["bySplit"][
        "validation"
    ]
    validation_latest = validation_fidelity["latestEligibleDecision"]
    validation_rate = validation_fidelity["withinToleranceRate"]
    validation_rate_label = (
        f"{validation_rate:.3f}"
        if validation_rate is not None
        else "unavailable"
    )
    validation_latest_line = (
        "Latest validation decision: "
        f"{validation_latest['asOf']} · {validation_latest['status']} · "
        "maximum contribution error "
        f"{validation_latest['maximumContributionError']}\n"
        if validation_latest is not None
        else "Latest validation decision: unavailable\n"
    )
    return CommandResult(
        "run.allocation",
        diagnostics,
        (
            f"Allocation Run: {diagnostics['run']['id']}\n"
            "Method: equal-risk-contribution · reference fixed weights\n"
            f"Validation candidate/reference net Sharpe: "
            f"{validation['candidate']['sharpe']} / "
            f"{validation['reference']['sharpe']}\n"
            f"Validation net Sharpe advantage: "
            f"{validation['comparison']['netSharpeAdvantage']}\n"
            "Conclusion (relative performance only): "
            f"{conclusion['status']}\n"
            "Validation ERC fidelity: "
            f"{validation_fidelity['withinToleranceDecisions']}/"
            f"{validation_fidelity['eligibleDecisions']} within tolerance · "
            f"rate {validation_rate_label}\n"
            f"{validation_latest_line}"
            f"Latest scheduled decision: {latest['asOf']} · forecast volatility "
            f"{latest['forecastAnnualizedVolatility']}\n"
            f"Latest executed research weights: "
            f"{json.dumps(latest['executedWeights'], sort_keys=True)}\n"
            f"Current state: {current['asOf']} · ordinary rebalance due="
            f"{str(current['ordinaryRebalanceDue']).lower()}\n"
            f"Current drifted research weights: "
            f"{json.dumps(current['candidatePretradeWeights'], sort_keys=True)}\n"
            "Mechanical quantitative decision support only; no account, Order, "
            "or trading authority.\n"
        ),
        project_context(project),
        [
            artifact(
                kind,
                f"{diagnostics['run']['id']}:{kind}",
                project.root_dir
                / project.manifest.directories["runs"]
                / diagnostics["run"]["id"]
                / item["path"],
                immutable=True,
            )
            for kind, item in diagnostics["artifacts"].items()
        ],
    )


def _run_rl(args: argparse.Namespace) -> CommandResult:
    project = _selected_project(args)
    diagnostics = load_rl_diagnostics(
        project,
        args.run,
        point_limit=args.points,
    )
    summary = diagnostics["summary"]
    execution_risk = diagnostics["executedBookRisk"]
    validation_execution_risk = (
        execution_risk["validation"]
        if execution_risk["available"]
        else None
    )
    execution_risk_line = (
        "Executed-book risk: legacy evidence unavailable\n"
        if validation_execution_risk is None
        else (
            "Validation executed-book risk: "
            f"{validation_execution_risk['executedBreachDates']} breaches · "
            f"{validation_execution_risk['riskRebalanceOverrideDates']} "
            "risk overrides · contextual only\n"
        )
    )
    policy_behavior = diagnostics["policyBehavior"]
    validation_behavior = (
        policy_behavior["validation"]
        if policy_behavior["available"]
        else None
    )
    policy_behavior_line = (
        "Policy behavior: legacy rationale evidence unavailable\n"
        if validation_behavior is None
        else (
            "Validation policy behavior: "
            f"{validation_behavior['meanActionRunLength']:.3f} mean "
            "action-run bars · "
            f"{validation_behavior['transitionRate']:.3%} transitions · "
            f"{validation_behavior['medianActionMargin']:.6g} median "
            "uncalibrated Q margin · "
            f"{validation_behavior['tieRate']:.3%} ties · contextual only\n"
        )
    )
    factor_opportunity = diagnostics["factorOpportunity"]
    validation_opportunity = (
        factor_opportunity["validation"]
        if factor_opportunity["available"]
        else None
    )
    factor_opportunity_line = (
        "Factor opportunity: legacy evidence unavailable\n"
        if validation_opportunity is None
        else (
            "Validation one-step factor opportunity: "
            f"{validation_opportunity['oracleHitRate']:.3%} oracle hits · "
            f"{validation_opportunity['meanSelectedRank']:.3f} mean selected "
            "rank · "
            f"{validation_opportunity['meanRealizedRegret']:.6g} mean "
            "ex-post regret · candidate "
            f"{validation_opportunity['candidate']['oracleFrequency']:.3%} "
            "locally best / "
            f"{validation_opportunity['candidate']['missedOpportunityRate']:.3%} "
            "missed · contextual only\n"
        )
    )
    contextual = diagnostics["contextualBaselines"]
    contextual_line = (
        "Contextual challenger: legacy fixed-path labels\n"
        if not contextual
        or not all(item["available"] for item in contextual)
        else (
            "Contextual challenger: same-pretrade train-only labels · "
            f"{contextual[0]['iterations']} fixed iterations · "
            f"{len(contextual)} folds\n"
        )
    )
    incremental = diagnostics["incrementalAttribution"]
    validation_incremental = (
        incremental["validation"] if incremental["available"] else None
    )
    incremental_line = (
        "Incremental attribution: legacy evidence unavailable\n"
        if validation_incremental is None
        else (
            "Validation full-path active attribution: gross "
            f"{validation_incremental['meanTrialTotalGrossActiveReturn']:.6g} · "
            "incremental cost "
            f"{validation_incremental['meanTrialTotalIncrementalCost']:.6g} · "
            "net "
            f"{validation_incremental['meanTrialTotalNetActiveReturn']:.6g} "
            "(mean trial path) · "
            "mean trial information ratio "
            f"{validation_incremental['informationRatio']:.3f} · "
            f"{validation_incremental['conditionalActiveWinRate']:.3%} "
            "active-day wins on "
            f"{validation_incremental['activeDecisionRate']:.3%} of days\n"
        )
    )
    fusion_diagnosis = diagnostics["factorFusionDiagnosis"]
    validation_fusion = (
        fusion_diagnosis["validation"]
        if fusion_diagnosis["available"]
        else None
    )
    fusion_diagnosis_line = (
        "RL factor-fusion diagnosis: legacy evidence unavailable\n"
        if validation_fusion is None
        else (
            "Validation RL factor fusion: "
            f"{fusion_diagnosis['diagnosis']['stage']} · focus "
            f"{fusion_diagnosis['diagnosis']['iterationFocus']} · candidate "
            f"{validation_fusion['candidateFactor']['assessment']} · "
            "gross/cost/net active "
            f"{validation_fusion['adaptiveTransmission']['meanTrialGrossActiveReturn']:.6g}/"
            f"{validation_fusion['adaptiveTransmission']['meanTrialIncrementalCost']:.6g}/"
            f"{validation_fusion['adaptiveTransmission']['meanTrialNetActiveReturn']:.6g} · "
            "Sharpe advantage "
            f"{validation_fusion['adaptiveTransmission']['meanSharpeAdvantageVsSelectedBaseline']:.6g} · "
            "positive net trials "
            f"{validation_fusion['stability']['positiveNetTrialRate']:.3%} · "
            "research prioritization only\n"
        )
    )
    return CommandResult(
        "run.rl",
        diagnostics,
        (
            f"RL policy Run: {diagnostics['run']['id']}\n"
            f"Validation mean / minimum net Sharpe: "
            f"{summary['validation']['mean']} / "
            f"{summary['validation']['minimum']}\n"
            f"Validation advantage versus best baseline: "
            f"{summary['meanValidationAdvantageVsBestBaseline']}\n"
            f"Trials / failure rate: {summary['trialCount']} / "
            f"{summary['failureRate']}\n"
            f"Action path: {diagnostics['actionPath']['totalRows']} rows → "
            f"{diagnostics['actionPath']['sampledRows']} points\n"
            f"{policy_behavior_line}"
            f"{contextual_line}"
            f"{fusion_diagnosis_line}"
            f"{incremental_line}"
            f"{factor_opportunity_line}"
            f"{execution_risk_line}"
            "Test evidence is visible audit only; actions have no trading authority.\n"
        ),
        project_context(project),
        [
            artifact(
                kind,
                f"{diagnostics['run']['id']}:{kind}",
                project.root_dir
                / project.manifest.directories["runs"]
                / diagnostics["run"]["id"]
                / item["path"],
                immutable=True,
            )
            for kind, item in diagnostics["artifacts"].items()
        ],
    )


def _session_next_actions(project, session) -> list[dict[str, Any]]:
    actions = [
        next_action(
            "session.show",
            "Refresh the Session brief, candidate state, and Experiment history.",
            [
                "aq",
                "session",
                "show",
                str(project.root_dir),
                "--session",
                session.manifest["id"],
                "--json",
            ],
            "read-only",
        ),
        next_action(
            "session.compare",
            "Compare baseline, candidates, and leader across verified metric layers.",
            [
                "aq",
                "session",
                "compare",
                str(project.root_dir),
                "--session",
                session.manifest["id"],
                "--json",
            ],
            "read-only",
        ),
    ]
    reports = (
        list_reports(project, session)
        if session.delegation is not None
        else []
    )
    current_report = next(
        (
            report
            for report in reversed(reports)
            if report.leader_run_id == session.manifest["leader"]["runId"]
        ),
        None,
    )
    if session.manifest["status"] == "active":
        check_state = candidate_check_state(project, session)
        if not check_state["supported"] or (
            check_state["current"] is not None
            and check_state["current"]["status"] == "passed"
        ):
            actions.append(
                next_action(
                    "experiment.evaluate",
                    "Evaluate this exact candidate with the fixed formal Judge.",
                    [
                        "aq",
                        "experiment",
                        "evaluate",
                        str(project.root_dir),
                        "--session",
                        session.manifest["id"],
                        "--hypothesis",
                        "Describe the candidate change",
                        "--json",
                    ],
                    "creates-artifact",
                )
            )
        elif check_state["candidateChanged"] and check_state["current"] is None:
            actions.append(
                next_action(
                    "session.check",
                    "Run the fixed bounded preflight for this exact candidate.",
                    [
                        "aq",
                        "session",
                        "check",
                        str(project.root_dir),
                        "--session",
                        session.manifest["id"],
                        "--json",
                    ],
                    "creates-artifact",
                )
            )
        if (
            session.manifest["leader"]["runId"]
            != session.manifest["baseline"]["runId"]
        ):
            if session.delegation is None or current_report is not None:
                promote_argv = [
                    "aq",
                    "session",
                    "promote",
                    str(project.root_dir),
                    "--session",
                    session.manifest["id"],
                ]
                if current_report is not None:
                    promote_argv.extend(
                        ["--report", current_report.id]
                    )
                promote_argv.append("--json")
                actions.append(
                    next_action(
                        "session.promote",
                        (
                            "Promote the exact current KEEP with its immutable "
                            "Report if the Project base is unchanged and "
                            "terminally close this Session as promoted. This "
                            "preserves the best source; it does not assert "
                            "scientific qualification or downstream admission."
                            if current_report is not None
                            else (
                                "Promote the exact current KEEP if the Project "
                                "base is unchanged and terminally close this "
                                "Session as promoted. Source promotion is not "
                                "scientific qualification."
                            )
                        ),
                        promote_argv,
                        "mutates-project",
                    )
                )
        if (
            current_report is not None
            and session.manifest["leader"] == session.manifest["baseline"]
        ):
            actions.append(
                next_action(
                    "session.complete",
                    "Finish this baseline-retaining lane with the exact current Report.",
                    [
                        "aq",
                        "session",
                        "complete",
                        str(project.root_dir),
                        "--session",
                        session.manifest["id"],
                        "--report",
                        current_report.id,
                        "--json",
                    ],
                    "creates-artifact",
                )
            )
    if (
        session.delegation is not None
        and session.manifest["status"] == "active"
    ):
        actions.append(
            next_action(
                "report.publish",
                (
                    "Publish strict analysis over current Session evidence; "
                    "discover exact evidenceRefs with "
                    "`aq schema report-analysis --json`."
                ),
                [
                    "aq",
                    "report",
                    "publish",
                    str(project.root_dir),
                    "--session",
                    session.manifest["id"],
                    "--analysis",
                    "report-analysis.json",
                    "--json",
                ],
                "creates-artifact",
            )
        )
    if current_report is not None:
        actions.append(
            next_action(
                "report.show",
                "Verify the latest Report for the current Session leader.",
                [
                    "aq",
                    "report",
                    "show",
                    str(project.root_dir),
                    "--session",
                    session.manifest["id"],
                    "--report",
                    current_report.id,
                    "--json",
                ],
                "read-only",
            )
        )
    return actions


def _session_start(args: argparse.Namespace) -> CommandResult:
    project = _selected_project(args)
    if args.request:
        request = load_research_request(args.request)
    else:
        intake = load_project_intake(project)
        request = intake["request"] if intake is not None else None
    session = start_session(project, args.study, request=request)
    data = session_snapshot(project, session)
    baseline_guard = session.manifest.get("baselineGuard")
    guard_line = (
        f"Baseline guard: {baseline_guard['mode']}\n"
        if baseline_guard is not None
        else "Baseline guard: legacy-session\n"
    )
    delegation_line = (
        f"Request: {session.delegation['request']['title']}\n"
        if session.delegation is not None
        else ""
    )
    return CommandResult(
        "session.start",
        data,
        (
            f"Research Session: {session.manifest['id']}\n"
            f"Study: {session.manifest['studyId']}\n"
            f"Leader: {session.manifest['leader']['metric']}="
            f"{session.manifest['leader']['value']}\n"
            f"{guard_line}"
            f"Worktree: {session.worktree_project.root_dir}\n"
            f"Editable: {', '.join(session.manifest['editablePaths'])}\n"
            f"{delegation_line}"
        ),
        project_context(project),
        [
            artifact(
                "session",
                session.manifest["id"],
                session.manifest_path,
                immutable=False,
            ),
            *_run_artifacts(session.baseline_run),
            *(
                [
                    artifact(
                        "research-request",
                        session.manifest["brief"]["requestHash"],
                        session.root_dir / "request.json",
                        immutable=True,
                    ),
                    artifact(
                        "research-brief",
                        session.manifest["brief"]["id"],
                        session.root_dir / "brief.json",
                        immutable=True,
                    ),
                ]
                if session.delegation is not None
                else []
            ),
        ],
        _session_next_actions(project, session),
    )


def _session_list(args: argparse.Namespace) -> CommandResult:
    project = _selected_project(args)
    sessions = list_sessions(project)
    lines = [f"AutoQuant Research Sessions in {project.manifest.name}:"]
    lines.extend(
        f"  {item.id}  {item.status}  {item.study_id}  "
        f"leader={item.leader_value}  experiments={item.experiments}"
        for item in sessions
    )
    if not sessions:
        lines.append("  No Sessions")
    actions = []
    if sessions:
        actions.append(
            next_action(
                "session.show",
                "Inspect the latest listed Session.",
                [
                    "aq",
                    "session",
                    "show",
                    str(project.root_dir),
                    "--session",
                    sessions[-1].id,
                    "--json",
                ],
                "read-only",
            )
        )
    return CommandResult(
        "session.list",
        {"sessions": [item.to_dict() for item in sessions]},
        "\n".join(lines) + "\n",
        project_context(project),
        next_actions=actions,
    )


def _session_show(args: argparse.Namespace) -> CommandResult:
    project = _selected_project(args)
    session = load_session(project, args.session)
    data = session_snapshot(project, session)
    candidate = data["candidate"]
    integrity = data["selectionIntegrity"]
    baseline_guard = session.manifest.get("baselineGuard")
    guard_mode = (
        baseline_guard["mode"]
        if baseline_guard is not None
        else "legacy-session"
    )
    return CommandResult(
        "session.show",
        data,
        (
            f"Research Session: {session.manifest['id']}\n"
            f"Status: {session.manifest['status']}\n"
            f"Study: {session.manifest['studyId']}\n"
            f"Leader: {session.manifest['leader']['metric']}="
            f"{session.manifest['leader']['value']}\n"
            f"Baseline guard: {guard_mode}\n"
            f"Experiments: {len(data['experiments'])}\n"
            f"Test exposure: "
            f"{integrity.get('testExposureState', integrity['testRole'])}\n"
            f"Post-audit candidate iterations: "
            f"{integrity.get('postAuditCandidateIterations', 'unknown')}\n"
            f"External holdout required: "
            f"{integrity['externalHoldoutRequired']}\n"
            f"Authority: {'valid' if data['authority']['valid'] else 'stale'}\n"
            f"Candidate changed: "
            f"{candidate['differsFromLeader'] if candidate else 'invalid'}\n"
            f"Worktree: {session.worktree_project.root_dir}\n"
        ),
        project_context(project),
        [
            artifact(
                "session",
                session.manifest["id"],
                session.manifest_path,
                immutable=False,
            )
        ],
        _session_next_actions(project, session),
    )


def _session_check(args: argparse.Namespace) -> CommandResult:
    project = _selected_project(args)
    check = execute_candidate_check(project, args.session)
    result = check.result
    actions = []
    if result["status"] == "passed":
        actions.append(
            next_action(
                "experiment.evaluate",
                "Run the fixed Judge for selection evidence on this exact candidate.",
                [
                    "aq",
                    "experiment",
                    "evaluate",
                    str(project.root_dir),
                    "--session",
                    args.session,
                    "--hypothesis",
                    "Describe the candidate change",
                    "--json",
                ],
                "creates-artifact",
            )
        )
    return CommandResult(
        "session.check",
        result,
        (
            f"Candidate Check: {result['id']}\n"
            f"Status: {result['status']}\n"
            f"Summary: {result['summary']}\n"
            f"Duration: {result['durationMs']} ms\n"
            "Authority: no selection, promotion, or trading authority\n"
        ),
        project_context(project),
        [
            artifact(
                "candidate-check",
                result["id"],
                check.root_dir / CHECK_RESULT,
                immutable=True,
            ),
            artifact(
                "candidate-check-output",
                f"{result['id']}:raw",
                check.root_dir / CHECK_OUTPUT,
                immutable=True,
            ),
        ],
        actions,
    )


def _session_compare(args: argparse.Namespace) -> CommandResult:
    project = _selected_project(args)
    matrix = load_session_decision_matrix(
        project,
        args.session,
        trial_limit=args.trials,
    )
    tradeoffs = matrix["tradeoffs"]
    return CommandResult(
        "session.compare",
        matrix,
        (
            f"Session decision matrix: {matrix['session']['id']}\n"
            f"Family: {matrix['metricFamily']} · "
            f"{len(matrix['metrics'])} metrics\n"
            f"Trials: {matrix['scope']['displayedCandidateTrials']}/"
            f"{matrix['scope']['totalCandidateTrials']} candidates "
            f"+ baseline\n"
            f"Leader: {matrix['session']['leaderRunId']}\n"
            f"Leader vs baseline: {len(tradeoffs['leaderVsBaseline']['improved'])} "
            f"better · {len(tradeoffs['leaderVsBaseline']['regressed'])} worse\n"
            f"Displayed non-dominated Runs: "
            f"{', '.join(tradeoffs['nonDominatedRunIds'])}\n"
        ),
        project_context(project),
    )


def _session_promote(args: argparse.Namespace) -> CommandResult:
    project = _selected_project(args)
    receipt = promote_session(project, args.session, args.report)
    session = load_session(project, args.session)
    brief = build_agent_work_brief(project)
    disposition = brief["reasons"][0]
    receipt_path = session.root_dir / "promotion.json"
    return CommandResult(
        "session.promote",
        {
            "receipt": receipt,
            "session": session.manifest,
            "agentWorkBrief": brief,
            "terminalClosure": {
                "terminal": True,
                "method": "promotion",
                "sessionStatus": "promoted",
                "completeCommandApplicable": False,
                "receiptId": receipt["id"],
                "reportId": (
                    receipt["report"]["id"]
                    if receipt.get("report") is not None
                    else None
                ),
            },
        },
        (
            f"Promoted Session {session.manifest['id']}\n"
            f"Study: {session.manifest['studyId']}\n"
            f"Source: {receipt['beforeSourceHash']} -> "
            f"{receipt['afterSourceHash']}\n"
            "Authority: source preserved; qualification and downstream "
            "progression remain evidence-gated\n"
            "Terminal close: promoted; this Session is closed. "
            "session.complete is the baseline-retaining alternative and is "
            "not applicable after promotion.\n"
            + (
                f"Report: {receipt['report']['id']}\n"
                if receipt.get("report") is not None
                else ""
            )
            + (
                f"Post-promotion: {disposition['code']} — "
                f"{disposition['message']}\n"
            )
        ),
        project_context(project),
        [
            artifact(
                "promotion",
                receipt["id"],
                receipt_path,
                immutable=True,
            )
        ],
        _brief_next_actions(brief),
    )


def _session_complete(args: argparse.Namespace) -> CommandResult:
    project = _selected_project(args)
    receipt = complete_session(project, args.session, args.report)
    session = load_session(project, args.session)
    receipt_path = session.root_dir / "completion.json"
    return CommandResult(
        "session.complete",
        {"receipt": receipt, "session": session.manifest},
        (
            f"Completed Session {session.manifest['id']}\n"
            f"Study: {session.manifest['studyId']}\n"
            f"Disposition: {receipt['disposition']}\n"
            f"Report: {receipt['report']['id']}\n"
            "Project source unchanged.\n"
        ),
        project_context(project),
        [
            artifact(
                "session-completion",
                receipt["id"],
                receipt_path,
                immutable=True,
            ),
            artifact(
                "research-report",
                receipt["report"]["id"],
                session.root_dir
                / "reports"
                / receipt["report"]["id"]
                / "report.json",
                immutable=True,
            ),
        ],
        _session_next_actions(project, session),
    )


def _experiment_artifacts(project, experiment) -> list[dict[str, Any]]:
    run = load_run(project, experiment.result["candidate"]["runId"])
    return [
        artifact(
            "experiment",
            experiment.result["id"],
            experiment.root_dir,
            immutable=True,
        ),
        *_run_artifacts(run),
    ]


def _experiment_verdict_authority() -> dict[str, Any]:
    return {
        "scope": "session-objective-only",
        "scientificQualification": False,
        "downstreamAdmission": False,
        "tradingAuthority": "none",
    }


def _experiment_evaluate(args: argparse.Namespace) -> CommandResult:
    project = _selected_project(args)
    experiment = evaluate_experiment(project, args.session, args.hypothesis)
    session = load_session(project, args.session)
    candidate = experiment.result["candidate"]
    return CommandResult(
        "experiment.evaluate",
        {
            "experiment": experiment.result,
            "changes": experiment.changes,
            "session": session_snapshot(project, session),
            "verdictAuthority": _experiment_verdict_authority(),
        },
        (
            f"Experiment {experiment.result['id']}: "
            f"{experiment.result['verdict']}\n"
            f"Hypothesis: {experiment.result['hypothesis']}\n"
            f"Leader: {experiment.result['leader']['value']}\n"
            f"Candidate: "
            f"{candidate['value'] if candidate['value'] is not None else 'failed'}\n"
            f"Improvement: "
            f"{experiment.result['improvement'] if experiment.result['improvement'] is not None else 'unavailable'}\n"
            "Authority: Session objective only; this verdict is not scientific "
            "qualification, downstream admission, or trading authority.\n"
        ),
        project_context(project),
        _experiment_artifacts(project, experiment),
        _session_next_actions(project, session),
    )


def _experiment_list(args: argparse.Namespace) -> CommandResult:
    project = _selected_project(args)
    session = load_session(project, args.session)
    experiments = list_experiments(project, session)
    lines = [f"Experiments in {session.manifest['id']}:"]
    lines.extend(
        f"  {item.id}  {item.verdict}  leader={item.leader_value}  "
        f"candidate={item.candidate_value if item.candidate_value is not None else 'failed'}"
        for item in experiments
    )
    if not experiments:
        lines.append("  No Experiments")
    actions = []
    if experiments:
        actions.append(
            next_action(
                "experiment.show",
                "Inspect the latest immutable Experiment.",
                [
                    "aq",
                    "experiment",
                    "show",
                    str(project.root_dir),
                    "--session",
                    session.manifest["id"],
                    "--experiment",
                    experiments[-1].id,
                    "--json",
                ],
                "read-only",
            )
        )
    return CommandResult(
        "experiment.list",
        {"experiments": [item.to_dict() for item in experiments]},
        "\n".join(lines) + "\n",
        project_context(project),
        next_actions=actions,
    )


def _experiment_show(args: argparse.Namespace) -> CommandResult:
    project = _selected_project(args)
    session = load_session(project, args.session)
    experiment = load_experiment(project, session, args.experiment)
    return CommandResult(
        "experiment.show",
        {
            "manifest": experiment.manifest,
            "result": experiment.result,
            "changes": experiment.changes,
            "diffPath": str(experiment.root_dir / "diff.patch"),
            "verdictAuthority": _experiment_verdict_authority(),
        },
        (
            f"Immutable Experiment: {experiment.result['id']}\n"
            f"Verdict: {experiment.result['verdict']}\n"
            f"Hypothesis: {experiment.result['hypothesis']}\n"
            f"Candidate Run: {experiment.result['candidate']['runId']}\n"
            "Authority: Session objective only; this verdict is not scientific "
            "qualification, downstream admission, or trading authority.\n"
        ),
        project_context(project),
        _experiment_artifacts(project, experiment),
        _session_next_actions(project, session),
    )


def _campaign_artifact(campaign) -> dict[str, Any]:
    return artifact(
        "campaign",
        campaign.result["id"],
        campaign.root_dir,
        immutable=True,
    )


def _research_run(args: argparse.Namespace) -> CommandResult:
    project = _selected_project(args)
    campaign = run_campaign(
        project,
        args.session,
        args.agent_command,
        max_turns=args.max_turns,
        max_wall_seconds=args.max_wall_seconds,
        turn_timeout_seconds=args.turn_timeout_seconds,
    )
    session = load_session(project, args.session)
    return CommandResult(
        "research.run",
        {
            "manifest": campaign.manifest,
            "result": campaign.result,
            "session": session_snapshot(project, session),
        },
        (
            f"Research Campaign: {campaign.result['id']}\n"
            f"Status: {campaign.result['status']}\n"
            f"Reason: {campaign.result['reason']}\n"
            f"Turns: {campaign.result['turnsCompleted']}/"
            f"{campaign.result['budget']['maxTurns']}\n"
            f"Experiments: {len(campaign.result['experiments'])}\n"
            f"Verdicts: "
            f"KEEP={campaign.result['verdicts']['KEEP']} "
            f"REVERT={campaign.result['verdicts']['REVERT']} "
            f"CRASH={campaign.result['verdicts']['CRASH']}\n"
        ),
        project_context(project),
        [_campaign_artifact(campaign)],
        [
            next_action(
                "research.show",
                "Verify and inspect this immutable Campaign.",
                [
                    "aq",
                    "research",
                    "show",
                    str(project.root_dir),
                    "--session",
                    session.manifest["id"],
                    "--campaign",
                    campaign.result["id"],
                    "--json",
                ],
                "read-only",
            )
        ],
    )


def _research_list(args: argparse.Namespace) -> CommandResult:
    project = _selected_project(args)
    session = load_session(project, args.session)
    campaigns = list_campaigns(project, session)
    lines = [f"Research Campaigns in {session.manifest['id']}:"]
    lines.extend(
        f"  {item.id}  {item.status}  turns={item.turns_completed}  "
        f"experiments={item.experiments}"
        for item in campaigns
    )
    if not campaigns:
        lines.append("  No Campaigns")
    actions = []
    if campaigns:
        actions.append(
            next_action(
                "research.show",
                "Verify and inspect the latest immutable Campaign.",
                [
                    "aq",
                    "research",
                    "show",
                    str(project.root_dir),
                    "--session",
                    session.manifest["id"],
                    "--campaign",
                    campaigns[-1].id,
                    "--json",
                ],
                "read-only",
            )
        )
    return CommandResult(
        "research.list",
        {"campaigns": [item.to_dict() for item in campaigns]},
        "\n".join(lines) + "\n",
        project_context(project),
        next_actions=actions,
    )


def _research_show(args: argparse.Namespace) -> CommandResult:
    project = _selected_project(args)
    session = load_session(project, args.session)
    campaign = load_campaign(project, session, args.campaign)
    turns = sorted(
        str(path)
        for path in (campaign.root_dir / "turns").iterdir()
        if path.is_dir() and not path.name.startswith(".")
    )
    return CommandResult(
        "research.show",
        {
            "manifest": campaign.manifest,
            "result": campaign.result,
            "turnPaths": turns,
        },
        (
            f"Immutable Research Campaign: {campaign.result['id']}\n"
            f"Status: {campaign.result['status']}\n"
            f"Reason: {campaign.result['reason']}\n"
            f"Turns: {campaign.result['turnsCompleted']}\n"
            f"Experiments: {len(campaign.result['experiments'])}\n"
        ),
        project_context(project),
        [_campaign_artifact(campaign)],
    )


def _report_artifacts(report) -> list[dict[str, Any]]:
    return [
        artifact(
            "research-report",
            report.report["id"],
            report.root_dir / "report.json",
            immutable=True,
        ),
        artifact(
            "research-report-markdown",
            report.report["id"],
            report.root_dir / "report.md",
            immutable=True,
        ),
    ]


def _report_draft(args: argparse.Namespace) -> CommandResult:
    project = _selected_project(args)
    session_mode = args.session is not None
    run_mode = args.study is not None or args.run is not None
    if session_mode == run_mode:
        raise CliUsageError(
            "report draft requires exactly one anchor: --session ID, or "
            "--study ID together with --run ID"
        )
    if run_mode and (args.study is None or args.run is None):
        raise CliUsageError("Run-bound report draft requires both --study and --run")
    draft, anchor = (
        build_session_report_analysis_draft(project, args.session)
        if session_mode
        else build_run_report_analysis_draft(
            project,
            args.study,
            args.run,
        )
    )
    output = confined_path(
        project.root_dir,
        args.output,
        "report/draft/output",
    )
    if output.exists() or output.is_symlink():
        raise AutoQuantValidationError(
            [
                ValidationIssue(
                    str(output),
                    "report.draft-exists",
                    "Report draft output already exists; choose a new --output path",
                )
            ]
        )
    if output.parent.is_symlink() or not output.parent.is_dir():
        raise AutoQuantValidationError(
            [
                ValidationIssue(
                    str(output.parent),
                    "report.draft-parent",
                    "Report draft parent must be an existing real Project directory",
                )
            ]
        )
    with output.open("x", encoding="utf-8") as handle:
        json.dump(draft, handle, indent=2, ensure_ascii=False, sort_keys=True)
        handle.write("\n")
    publish_argv = [
        "aq",
        "report",
        "publish",
        str(project.root_dir),
        *(
            ["--session", anchor["sessionId"]]
            if session_mode
            else ["--study", anchor["studyId"], "--run", anchor["runId"]]
        ),
        "--analysis",
        str(output),
        "--json",
    ]
    return CommandResult(
        "report.draft",
        {
            "anchor": anchor,
            "draftPath": str(output),
            "analysis": draft,
            "publishable": False,
            "requiredEdits": [
                "Replace every reserved draft placeholder with evidence-backed prose.",
                "Set authoringState to final only after completing the analysis.",
            ],
        },
        (
            f"Report analysis draft: {output}\n"
            f"Anchor: {anchor['kind']} · Study {anchor['studyId']} · "
            f"Run {anchor['runId']}\n"
            f"Evidence references: {len(draft['findings'][0]['evidenceRefs'])}\n"
            "State: draft · schema-valid · publication blocked until completed\n"
        ),
        project_context(project),
        [
            artifact(
                "report-analysis-draft",
                anchor["runId"],
                output,
                immutable=False,
            )
        ],
        [
            next_action(
                "report.publish",
                "After replacing placeholders and setting authoringState to final, publish the exact completed analysis.",
                publish_argv,
                "creates-artifact",
            )
        ],
    )


def _report_publish(args: argparse.Namespace) -> CommandResult:
    project = _selected_project(args)
    analysis = load_report_analysis(args.analysis)
    session_mode = args.session is not None
    run_mode = args.study is not None or args.run is not None
    if session_mode == run_mode:
        raise CliUsageError(
            "report publish requires exactly one anchor: --session ID, or "
            "--study ID together with --run ID"
        )
    if run_mode and (args.study is None or args.run is None):
        raise CliUsageError("Run-bound report publication requires both --study and --run")
    correction_requested = any(
        value is not None
        for value in (args.corrects, args.correction_review, args.correction_reason)
    )
    if session_mode and correction_requested:
        raise CliUsageError(
            "immutable correction lineage currently requires a Project-owned Run anchor"
        )
    report = (
        publish_report(project, args.session, analysis)
        if session_mode
        else publish_run_report(
            project,
            args.study,
            args.run,
            analysis,
            corrects_report_id=args.corrects,
            correction_review=args.correction_review,
            correction_reason=args.correction_reason,
        )
    )
    anchor = (
        {
            "kind": "session",
            "studyId": report.report["evidence"]["session"]["studyId"],
            "runId": report.report["evidence"]["session"]["leader"]["runId"],
            "sessionId": report.report["sessionId"],
        }
        if session_mode
        else report.report["evidence"]["anchor"]
    )
    actions = [
        next_action(
            "report.show",
            "Verify the immutable report before OpenAlice Inbox publication.",
            [
                "aq",
                "report",
                "show",
                str(project.root_dir),
                *(
                    ["--session", report.report["sessionId"]]
                    if session_mode
                    else []
                ),
                "--report",
                report.report["id"],
                "--json",
            ],
            "read-only",
        )
    ]
    if session_mode:
        session = load_session(project, args.session)
    else:
        session = None
    if session is not None and session.manifest["leader"] == session.manifest["baseline"]:
        actions.append(
            next_action(
                "session.complete",
                "Finish this baseline-retaining lane with the exact published Report.",
                [
                    "aq",
                    "session",
                    "complete",
                    str(project.root_dir),
                    "--session",
                    session.manifest["id"],
                    "--report",
                    report.report["id"],
                    "--json",
                ],
                "creates-artifact",
            )
        )
    elif session is not None:
        actions.append(
            next_action(
                "session.promote",
                "Promote the improved KEEP before downstream research uses it.",
                [
                    "aq",
                    "session",
                    "promote",
                    str(project.root_dir),
                    "--session",
                    session.manifest["id"],
                    "--report",
                    report.report["id"],
                    "--json",
                ],
                "mutates-project",
            )
        )
    return CommandResult(
        "report.publish",
        {
            "manifest": report.manifest,
            "report": report.report,
            "anchor": anchor,
            "markdownPath": str(report.root_dir / "report.md"),
        },
        (
            f"Research Report: {report.report['id']}\n"
            f"Title: {report.analysis['title']}\n"
            f"Anchor: {anchor['kind']}\n"
            f"Study: {anchor['studyId']}\n"
            f"Run: {anchor['runId']}\n"
            + (
                f"Session: {anchor['sessionId']}\n"
                if anchor["sessionId"] is not None
                else "Session: none (frozen Run evidence)\n"
            )
            + f"{_report_decision_support_line(report.report)}"
            f"Markdown: {report.root_dir / 'report.md'}\n"
            "Authority: quantitative decision support; trading authority: none\n"
        ),
        project_context(project),
        _report_artifacts(report),
        actions,
    )


def _report_list(args: argparse.Namespace) -> CommandResult:
    project = _selected_project(args)
    if args.session is not None and args.study is not None:
        raise CliUsageError("report list accepts --session or --study, not both")
    session = load_session(project, args.session) if args.session is not None else None
    reports = (
        list_reports(project, session)
        if session is not None
        else list_run_reports(project, args.study)
    )
    scope = session.manifest["id"] if session is not None else (
        f"Project Run anchors for Study {args.study}"
        if args.study is not None
        else "Project Run anchors"
    )
    lines = [f"Research Reports in {scope}:"]
    lines.extend(
        f"  {item.id}  {item.title}  findings={item.findings}  "
        f"recommendations={item.recommendations}"
        + (
            f"  current={str(item.current).lower()}"
            + (
                f"  corrects={item.correction['corrects']['reportId']}"
                if item.correction is not None
                else ""
            )
            + (
                f"  supersededBy={item.superseded_by}"
                if item.superseded_by is not None
                else ""
            )
            if item.current is not None
            else ""
        )
        for item in reports
    )
    if not reports:
        lines.append("  No Research Reports")
    actions = []
    if reports:
        actions.append(
            next_action(
                "report.show",
                "Verify and inspect the latest immutable Research Report.",
                [
                    "aq",
                    "report",
                    "show",
                    str(project.root_dir),
                    *(
                        ["--session", session.manifest["id"]]
                        if session is not None
                        else []
                    ),
                    "--report",
                    reports[-1].id,
                    "--json",
                ],
                "read-only",
            )
        )
    return CommandResult(
        "report.list",
        {"reports": [item.to_dict() for item in reports]},
        "\n".join(lines) + "\n",
        project_context(project),
        next_actions=actions,
    )


def _report_show(args: argparse.Namespace) -> CommandResult:
    project = _selected_project(args)
    report = (
        load_report(project, load_session(project, args.session), args.report)
        if args.session is not None
        else load_run_report(project, args.report)
    )
    anchor = (
        {
            "kind": "session",
            "studyId": report.report["evidence"]["session"]["studyId"],
            "runId": report.report["evidence"]["session"]["leader"]["runId"],
            "sessionId": report.report["sessionId"],
        }
        if args.session is not None
        else report.report["evidence"]["anchor"]
    )
    lineage = None
    if args.session is None:
        summary = next(
            item
            for item in list_run_reports(project)
            if item.id == report.report["id"]
        )
        lineage = {
            "current": summary.current,
            "correction": summary.correction,
            "supersededBy": summary.superseded_by,
            "lineageDepth": summary.lineage_depth,
        }
    return CommandResult(
        "report.show",
        {
            "manifest": report.manifest,
            "report": report.report,
            "anchor": anchor,
            "lineage": lineage,
            "markdownPath": str(report.root_dir / "report.md"),
        },
        (
            f"Immutable Research Report: {report.report['id']}\n"
            f"Title: {report.analysis['title']}\n"
            f"Anchor: {anchor['kind']} · Study {anchor['studyId']} · Run {anchor['runId']}\n"
            + (
                f"Session: {anchor['sessionId']}\n"
                if anchor["sessionId"] is not None
                else "Session: none\n"
            )
            + f"Findings: {len(report.analysis['findings'])}\n"
            + (
                f"Current: {str(lineage['current']).lower()}\n"
                + (
                    f"Corrects: {lineage['correction']['corrects']['reportId']}\n"
                    f"Governing Review: {lineage['correction']['governingReview']['id']}\n"
                    f"Correction reason: {lineage['correction']['reason']}\n"
                    if lineage["correction"] is not None
                    else ""
                )
                + (
                    f"Superseded by: {lineage['supersededBy']}\n"
                    if lineage["supersededBy"] is not None
                    else ""
                )
                if lineage is not None
                else ""
            )
            + f"{_report_decision_support_line(report.report)}"
            f"Markdown: {report.root_dir / 'report.md'}\n"
        ),
        project_context(project),
        _report_artifacts(report),
    )


def _review_artifacts(review) -> list[dict[str, Any]]:
    return [
        artifact(
            "independent-research-review",
            review.review["id"],
            review.root_dir / "review.json",
            immutable=True,
        ),
        artifact(
            "independent-research-review-markdown",
            review.review["id"],
            review.root_dir / "review.md",
            immutable=True,
        ),
    ]


def _review_publish(args: argparse.Namespace) -> CommandResult:
    project = _selected_project(args)
    analysis = load_review_analysis(args.analysis)
    input_root = Path(args.path).expanduser().absolute()
    if (input_root / WORKSPACE_MANIFEST).is_file():
        workspace = load_workspace(input_root)
        observation_root = workspace.root_dir
        observation_scope = "workspace"
    else:
        observation_root = project.root_dir
        observation_scope = "project"
    review = publish_review(
        project,
        args.report,
        analysis,
        session_id=args.session,
        observation_root=observation_root,
        observation_scope=observation_scope,
        output_root=(Path(args.output) if args.output is not None else None),
    )
    detached = args.output is not None
    show_argv = (
        ["aq", "review", "show", str(review.root_dir), "--json"]
        if detached
        else [
            "aq", "review", "show", str(project.root_dir),
            "--review", review.review["id"], "--json",
        ]
    )
    return CommandResult(
        "review.publish",
        {
            "manifest": review.manifest,
            "review": review.review,
            "packagePath": str(review.root_dir),
            "markdownPath": str(review.root_dir / "review.md"),
            "detached": detached,
        },
        (
            f"Independent Research Review: {review.review['id']}\n"
            f"Title: {review.analysis['title']}\n"
            f"Conclusion: {review.analysis['conclusion']}\n"
            f"Target Report: {review.manifest['target']['reportId']}\n"
            f"Anchor Run: {review.manifest['target']['runId']}\n"
            f"Storage: {'detached no-target-mutation package' if detached else 'attached Project Review'}\n"
            f"Markdown: {review.root_dir / 'review.md'}\n"
            "Authority: independent evidence review; quantitative and trading authority: none\n"
        ),
        _project_result_context(args, project),
        _review_artifacts(review),
        [
            next_action(
                "review.show",
                "Verify the immutable Review package and its frozen target identity.",
                show_argv,
                "read-only",
            )
        ],
    )


def _review_list(args: argparse.Namespace) -> CommandResult:
    project = _selected_project(args)
    reviews = list_reviews(project, args.report)
    lines = ["Attached Independent Research Reviews:"]
    lines.extend(
        f"  {item.id}  {item.conclusion}  {item.title}  "
        f"target={item.report_id}"
        for item in reviews
    )
    if not reviews:
        lines.append("  No attached Reviews")
    actions = []
    if reviews:
        actions.append(
            next_action(
                "review.show",
                "Verify and inspect the latest attached Review.",
                [
                    "aq", "review", "show", str(project.root_dir),
                    "--review", reviews[-1].id, "--json",
                ],
                "read-only",
            )
        )
    return CommandResult(
        "review.list",
        {"reviews": [item.to_dict() for item in reviews]},
        "\n".join(lines) + "\n",
        _project_result_context(args, project),
        next_actions=actions,
    )


def _review_show(args: argparse.Namespace) -> CommandResult:
    if args.review is None:
        if args.project is not None:
            raise CliUsageError("Detached review show does not accept --project")
        review = load_review_package(args.path)
        context = global_context()
        detached = True
    else:
        project = _selected_project(args)
        review = load_review(project, args.review)
        context = _project_result_context(args, project)
        detached = False
    counts = {key: 0 for key in ("verified", "declared", "observed-unbound", "unverified")}
    for claim in review.analysis["claims"]:
        counts[claim["classification"]] += 1
    target = review.manifest["target"]
    return CommandResult(
        "review.show",
        {
            "manifest": review.manifest,
            "review": review.review,
            "packagePath": str(review.root_dir),
            "markdownPath": str(review.root_dir / "review.md"),
            "detached": detached,
            "classifications": counts,
        },
        (
            f"Immutable Independent Review: {review.review['id']}\n"
            f"Title: {review.analysis['title']}\n"
            f"Conclusion: {review.analysis['conclusion']}\n"
            f"Target: Report {target['reportId']} · Run {target['runId']}\n"
            f"Claims: verified={counts['verified']} · declared={counts['declared']} · "
            f"observed-unbound={counts['observed-unbound']} · unverified={counts['unverified']}\n"
            f"Package: {review.root_dir}\n"
            f"Markdown: {review.root_dir / 'review.md'}\n"
        ),
        context,
        _review_artifacts(review),
    )


def _dossier_artifacts(dossier) -> list[dict[str, Any]]:
    return [
        artifact(
            "research-dossier",
            dossier.dossier["id"],
            dossier.root_dir / "dossier.json",
            immutable=True,
        ),
        artifact(
            "research-dossier-markdown",
            dossier.dossier["id"],
            dossier.root_dir / "dossier.md",
            immutable=True,
        ),
    ]


def _dossier_status(args: argparse.Namespace) -> CommandResult:
    project = _selected_project(args)
    status = load_dossier_status(project)
    assert status is not None
    lines = [
        f"Research Dossier readiness: {'ready' if status['ready'] else 'blocked'}",
        f"Included lanes: {', '.join(status['includedLaneIds']) or 'none'}",
    ]
    lines.extend(
        f"  {lane['id']}  {lane['status']}  "
        f"{lane['report']['id'] if lane['report'] else 'no current Report'}"
        for lane in status["lanes"]
    )
    if status["blockers"]:
        lines.append("Blockers:")
        lines.extend(
            f"  {blocker['code']}: {blocker['message']}"
            for blocker in status["blockers"]
        )
    actions = []
    if status["nextAction"] is not None:
        action = status["nextAction"]
        actions.append(
            next_action(
                action["id"],
                action["description"],
                action["argv"],
                action["effect"],
            )
        )
    return CommandResult(
        "dossier.status",
        status,
        "\n".join(lines) + "\n",
        project_context(project),
        next_actions=actions,
    )


def _dossier_publish(args: argparse.Namespace) -> CommandResult:
    project = _selected_project(args)
    analysis = load_dossier_analysis(args.analysis)
    dossier = publish_dossier(project, analysis)
    return CommandResult(
        "dossier.publish",
        {
            "manifest": dossier.manifest,
            "dossier": dossier.dossier,
            "markdownPath": str(dossier.root_dir / "dossier.md"),
        },
        (
            f"Research Dossier: {dossier.dossier['id']}\n"
            f"Title: {dossier.analysis['title']}\n"
            f"Included lanes: "
            + ", ".join(
                lane["id"] for lane in dossier.dossier["evidence"]["lanes"]
            )
            + "\n"
            f"Markdown: {dossier.root_dir / 'dossier.md'}\n"
            "Authority: quantitative decision support; trading authority: none\n"
        ),
        project_context(project),
        _dossier_artifacts(dossier),
        [
            next_action(
                "dossier.show",
                "Verify the immutable Dossier before OpenAlice Inbox publication.",
                [
                    "aq",
                    "dossier",
                    "show",
                    str(project.root_dir),
                    "--dossier",
                    dossier.dossier["id"],
                    "--json",
                ],
                "read-only",
            )
        ],
    )


def _dossier_list(args: argparse.Namespace) -> CommandResult:
    project = _selected_project(args)
    dossiers = list_dossiers(project)
    lines = [f"Research Dossiers in {project.manifest.id}:"]
    lines.extend(
        f"  {item.id}  {item.title}  lanes={','.join(item.included_lanes)}  "
        f"findings={item.findings}"
        for item in dossiers
    )
    if not dossiers:
        lines.append("  No Research Dossiers")
    actions = []
    if dossiers:
        actions.append(
            next_action(
                "dossier.show",
                "Verify and inspect the latest immutable Research Dossier.",
                [
                    "aq",
                    "dossier",
                    "show",
                    str(project.root_dir),
                    "--dossier",
                    dossiers[-1].id,
                    "--json",
                ],
                "read-only",
            )
        )
    else:
        actions.append(
            next_action(
                "dossier.status",
                "Inspect lane Report readiness for a Project Dossier.",
                [
                    "aq",
                    "dossier",
                    "status",
                    str(project.root_dir),
                    "--json",
                ],
                "read-only",
            )
        )
    return CommandResult(
        "dossier.list",
        {"dossiers": [item.to_dict() for item in dossiers]},
        "\n".join(lines) + "\n",
        project_context(project),
        next_actions=actions,
    )


def _dossier_show(args: argparse.Namespace) -> CommandResult:
    project = _selected_project(args)
    dossier = load_dossier(project, args.dossier)
    return CommandResult(
        "dossier.show",
        {
            "manifest": dossier.manifest,
            "dossier": dossier.dossier,
            "markdownPath": str(dossier.root_dir / "dossier.md"),
        },
        (
            f"Immutable Research Dossier: {dossier.dossier['id']}\n"
            f"Title: {dossier.analysis['title']}\n"
            f"Included lanes: "
            + ", ".join(
                lane["id"] for lane in dossier.dossier["evidence"]["lanes"]
            )
            + "\n"
            f"Findings: {len(dossier.analysis['findings'])}\n"
            f"Markdown: {dossier.root_dir / 'dossier.md'}\n"
        ),
        project_context(project),
        _dossier_artifacts(dossier),
    )


def _holdout_binding_artifacts(binding) -> list[dict[str, Any]]:
    return [
        artifact(
            "holdout-binding",
            binding.binding["id"],
            binding.root_dir / "binding.json",
            immutable=True,
        ),
        artifact(
            "source-dossier",
            binding.binding["source"]["dossier"]["id"],
            binding.root_dir / "source-dossier.json",
            immutable=True,
        ),
    ]


def _holdout_result_artifacts(
    project,
    result,
) -> list[dict[str, Any]]:
    return [
        artifact(
            "holdout-result",
            result.result["id"],
            result.root_dir / "result.json",
            immutable=True,
        ),
        *[
            artifact(
                "run",
                lane["holdout"]["runId"],
                (
                    project.root_dir
                    / project.manifest.directories["runs"]
                    / lane["holdout"]["runId"]
                ),
                immutable=True,
            )
            for lane in result.result["lanes"]
        ],
    ]


def _holdout_assessment_artifacts(assessment) -> list[dict[str, Any]]:
    return [
        artifact(
            "holdout-assessment",
            assessment.assessment["id"],
            assessment.root_dir / "assessment.json",
            immutable=True,
        ),
        artifact(
            "holdout-assessment-markdown",
            assessment.assessment["id"],
            assessment.root_dir / "assessment.md",
            immutable=True,
        ),
        artifact(
            "holdout-assessment-evidence",
            assessment.assessment["id"],
            assessment.root_dir / "evidence.json",
            immutable=True,
        ),
    ]


def _holdout_create_target(args: argparse.Namespace) -> CommandResult:
    _require_explicit_workspace_project(
        "holdout.create-target",
        args.source,
        args.source_project,
        "--source-project",
    )
    source = load_project(
        resolve_project_directory(args.source, args.source_project)
    )
    target, binding = create_holdout_target(
        source,
        args.dossier,
        args.workspace,
        args.project_id,
        args.dataset,
        name=args.name,
    )
    return CommandResult(
        "holdout.create-target",
        {
            "project": {
                "id": target.manifest.id,
                "name": target.manifest.name,
                "rootDir": str(target.root_dir),
            },
            "manifest": binding.manifest,
            "binding": binding.binding,
        },
        (
            f"Created frozen holdout target: {target.manifest.id}\n"
            f"Binding: {binding.binding['id']}\n"
            f"Source: {source.manifest.id} · Dossier {args.dossier}\n"
            f"Period: {binding.binding['nonOverlap']['sourceEnd']} → "
            f"{binding.binding['nonOverlap']['targetStart']}\n"
            f"Lanes: "
            + ", ".join(
                lane["id"] for lane in binding.binding["source"]["lanes"]
            )
            + "\nCanonical source request: reused · candidate: frozen · "
            "selection: disabled · trading: none\n"
        ),
        project_context(target),
        [
            artifact(
                "project-manifest",
                target.manifest.id,
                target.root_dir / PROJECT_MANIFEST,
                immutable=False,
            ),
            *_holdout_binding_artifacts(binding),
        ],
        [
            next_action(
                "holdout.run",
                "Execute the exact frozen external-period challenge once.",
                ["aq", "holdout", "run", str(target.root_dir), "--json"],
                "creates-artifact",
            )
        ],
    )


def _holdout_bind(args: argparse.Namespace) -> CommandResult:
    _require_explicit_workspace_project(
        "holdout.bind",
        args.source,
        args.source_project,
        "--source-project",
    )
    _require_explicit_workspace_project(
        "holdout.bind",
        args.target,
        args.target_project,
        "--target-project",
    )
    source = load_project(
        resolve_project_directory(args.source, args.source_project)
    )
    target = load_project(
        resolve_project_directory(args.target, args.target_project)
    )
    binding = bind_holdout(source, args.dossier, target)
    return CommandResult(
        "holdout.bind",
        {
            "manifest": binding.manifest,
            "binding": binding.binding,
        },
        (
            f"Frozen external holdout: {binding.binding['id']}\n"
            f"Source: {source.manifest.id} · Dossier {args.dossier}\n"
            f"Target: {target.manifest.id}\n"
            f"Period: {binding.binding['nonOverlap']['sourceEnd']} → "
            f"{binding.binding['nonOverlap']['targetStart']}\n"
            f"Lanes: "
            + ", ".join(
                lane["id"] for lane in binding.binding["source"]["lanes"]
            )
            + "\nCandidate frozen: yes · selection: disabled · trading: none\n"
        ),
        project_context(target),
        _holdout_binding_artifacts(binding),
        [
            next_action(
                "holdout.run",
                "Execute the exact frozen external-period challenge once.",
                ["aq", "holdout", "run", str(target.root_dir), "--json"],
                "creates-artifact",
            )
        ],
    )


def _holdout_status(args: argparse.Namespace) -> CommandResult:
    project = _selected_project(args)
    status = load_holdout_status(project)
    action = status["nextAction"]
    return CommandResult(
        "holdout.status",
        status,
        (
            f"External holdout: {status['state']}\n"
            + (
                f"Binding: {status['binding']['id']}\n"
                f"Source: {status['binding']['sourceProjectId']} · "
                f"{status['binding']['sourceDossierId']}\n"
                f"Lanes: {', '.join(status['binding']['laneIds'])}\n"
                if status["binding"] is not None
                else "No frozen binding\n"
            )
            + (
                f"Result: {status['result']['id']} · "
                f"{status['result']['status']}\n"
                if status["result"] is not None
                else ""
            )
            + (
                f"Assessment: {status['assessment']['id']} · "
                f"{status['assessment']['overallAssessment']}\n"
                if status["assessment"] is not None
                else ""
            )
            + "Authority: external temporal audit · selection disabled · trading none\n"
        ),
        project_context(project),
        next_actions=(
            [
                next_action(
                    action["id"],
                    action["description"],
                    action["argv"],
                    action["effect"],
                )
            ]
            if action is not None
            else []
        ),
    )


def _holdout_run(args: argparse.Namespace) -> CommandResult:
    project = _selected_project(args)
    result = run_holdout(project)
    lines = [
        f"External holdout result: {result.result['id']}",
        f"Status: {result.result['status']}",
    ]
    for lane in result.result["lanes"]:
        lines.append(
            f"  {lane['id']}  source={lane['source']['value']}  "
            f"holdout={lane['holdout']['value']}  delta={lane['delta']}"
        )
    lines.append("Authority: external temporal audit · no production threshold · trading none")
    return CommandResult(
        "holdout.run",
        {
            "manifest": result.manifest,
            "result": result.result,
        },
        "\n".join(lines) + "\n",
        project_context(project),
        _holdout_result_artifacts(project, result),
        [
            next_action(
                "holdout.assess",
                "Publish one immutable Agent assessment over the verified result.",
                [
                    "aq",
                    "holdout",
                    "assess",
                    str(project.root_dir),
                    "--analysis",
                    str(project.root_dir / "holdout-analysis.json"),
                    "--json",
                ],
                "creates-artifact",
            )
        ],
    )


def _holdout_assess(args: argparse.Namespace) -> CommandResult:
    project = _selected_project(args)
    result = load_holdout_result(project)
    analysis = load_holdout_assessment_analysis(
        args.analysis,
        [lane["id"] for lane in result.result["lanes"]],
    )
    assessment = publish_holdout_assessment(project, analysis)
    lines = [
        f"Immutable Holdout Assessment: {assessment.assessment['id']}",
        f"Result: {assessment.assessment['resultId']}",
        f"Overall Agent assessment: {assessment.assessment['overallAssessment']}",
    ]
    lines.extend(
        f"  {lane['id']}: {lane['assessment']} · {lane['summary']}"
        for lane in assessment.assessment["lanes"]
    )
    lines.extend(
        [
            f"Markdown: {assessment.root_dir / 'assessment.md'}",
            "Authority: Agent-authored interpretation · no Core pass threshold · trading none",
        ]
    )
    return CommandResult(
        "holdout.assess",
        {
            "manifest": assessment.manifest,
            "assessment": assessment.assessment,
            "analysis": assessment.analysis,
            "evidence": assessment.evidence,
            "markdownPath": str(assessment.root_dir / "assessment.md"),
        },
        "\n".join(lines) + "\n",
        project_context(project),
        _holdout_assessment_artifacts(assessment),
        [
            next_action(
                "holdout.show",
                "Verify the immutable result and its Agent assessment.",
                ["aq", "holdout", "show", str(project.root_dir), "--json"],
                "read-only",
            )
        ],
    )


def _holdout_show(args: argparse.Namespace) -> CommandResult:
    project = _selected_project(args)
    binding = load_holdout_binding(project)
    result = load_holdout_result(project)
    evidence = build_holdout_evidence(project)
    assessment = load_holdout_assessment(
        project,
        optional=True,
        verified_evidence=evidence,
    )
    return CommandResult(
        "holdout.show",
        {
            "binding": binding.binding,
            "manifest": result.manifest,
            "result": result.result,
            "evidence": evidence,
            "assessment": (
                {
                    "manifest": assessment.manifest,
                    "assessment": assessment.assessment,
                    "analysis": assessment.analysis,
                    "markdownPath": str(assessment.root_dir / "assessment.md"),
                }
                if assessment is not None
                else None
            ),
        },
        (
            f"Immutable external holdout: {result.result['id']}\n"
            f"Binding: {binding.binding['id']}\n"
            f"Status: {result.result['status']}\n"
            f"Lanes: {', '.join(lane['id'] for lane in result.result['lanes'])}\n"
            + (
                f"Assessment: {assessment.assessment['id']} · "
                f"{assessment.assessment['overallAssessment']}\n"
                f"Markdown: {assessment.root_dir / 'assessment.md'}\n"
                if assessment is not None
                else "Assessment: not yet published\n"
            )
            +
            "Interpretation: frozen later-period audit; no universal pass "
            "threshold or trading authority\n"
        ),
        project_context(project),
        [
            *_holdout_result_artifacts(project, result),
            *(
                _holdout_assessment_artifacts(assessment)
                if assessment is not None
                else []
            ),
        ],
    )


def _studio_snapshot(args: argparse.Namespace) -> CommandResult:
    snapshot = build_studio_snapshot(args.path, project_id=args.project)
    source = snapshot["source"]
    context = (
        workspace_context(load_workspace(source["rootDir"]))
        if source["scope"] == "workspace"
        else project_context(load_project(source["rootDir"]))
    )
    lines = [
        f"AutoQuant Studio snapshot: {source['scope']}",
        f"Projects: {len(snapshot['projects'])}",
        f"Evidence: {'valid' if snapshot['valid'] else 'attention required'}",
    ]
    lines.extend(
        f"  {project['id']}  studies={project['counts']['studies']}  "
        f"runs={project['counts']['runs']}  "
        f"active={project['counts']['activeSessions']}  "
        f"running={project['counts']['runningCampaigns']}"
        for project in snapshot["projects"]
    )
    return CommandResult(
        "studio.snapshot",
        snapshot,
        "\n".join(lines) + "\n",
        context,
        next_actions=[
            next_action(
                "studio.serve",
                "Open the same verified snapshot in the local read-only Studio.",
                [
                    "aq",
                    "studio",
                    "serve",
                    source["rootDir"],
                    *(
                        ["--project", args.project]
                        if args.project is not None
                        else []
                    ),
                ],
                "long-running-server",
            )
        ],
    )


def _studio_serve(args: argparse.Namespace) -> CommandResult:
    launch = resolve_studio_launch(
        host=args.host,
        port=args.port,
        no_open=args.no_open,
    )
    serve_studio(
        args.path,
        project_id=args.project,
        host=launch.host,
        port=launch.port,
        open_browser=launch.open_browser,
        managed=launch.managed,
    )
    return CommandResult(
        "studio.serve",
        {"stopped": True},
        "AutoQuant Studio stopped.\n",
    )


def _validate(args: argparse.Namespace) -> CommandResult:
    project = _selected_project(args)
    intake = load_project_intake(project)
    holdout = load_holdout_status(project, optional=True)
    study_datasets = {}
    for summary in list_studies(project):
        study = load_study(project, summary.id)
        snapshot = load_study_dataset_snapshot(project, study)
        if snapshot is not None:
            study_datasets[summary.id] = {
                "id": snapshot["id"],
                "version": snapshot["version"],
                "timeRange": snapshot["timeRange"],
                "datasetHash": study.dataset_hash,
            }
    selection_line = _project_selection_human(args)
    return CommandResult(
        "validate",
        {
            "valid": True,
            "project": {
                "id": project.manifest.id,
                "name": project.manifest.name,
                "rootDir": str(project.root_dir),
            },
            "intake": intake,
            "studyDatasets": study_datasets,
            "externalHoldout": holdout,
        },
        selection_line
        + f"Valid AutoQuant Project '{project.manifest.id}' at {project.root_dir}\n",
        _project_result_context(args, project),
        [
            artifact(
                "project",
                project.manifest.id,
                project.root_dir / PROJECT_MANIFEST,
                immutable=False,
            )
        ],
        [
            next_action(
                "inspect",
                "Inspect the validated Project.",
                ["aq", "inspect", str(project.root_dir), "--json"],
                "read-only",
            )
        ],
    )


def _inspect(args: argparse.Namespace) -> CommandResult:
    project = _selected_project(args)
    data = inspect_project(project)
    data["intake"] = load_project_intake(project)
    directory_lines = [
        f"  {key}: {value['entries']} entries ({value['relativePath']})"
        for key, value in data["directories"].items()
    ]
    human = (
        _project_selection_human(args)
        +
        f"AutoQuant Project: {project.manifest.name} ({project.manifest.id})\n"
        f"Root: {project.root_dir}\n"
        f"Research: {project.manifest.research_program}\n"
        f"Workbench needs: {FRAMEWORK_NEEDS}\n"
        + "\n".join(directory_lines)
        + "\n"
    )
    return CommandResult(
        "inspect",
        data,
        human,
        _project_result_context(args, project),
        [
            artifact(
                "project",
                project.manifest.id,
                project.root_dir / PROJECT_MANIFEST,
                immutable=False,
            ),
            artifact(
                "research-brief",
                project.manifest.id,
                project.root_dir / project.manifest.research_program,
                immutable=False,
            ),
            artifact(
                "framework-needs",
                project.manifest.id,
                project.root_dir / FRAMEWORK_NEEDS,
                immutable=False,
            ),
        ],
        [
            next_action(
                "validate",
                "Revalidate Project structure after editing.",
                ["aq", "validate", str(project.root_dir), "--json"],
                "read-only",
            )
        ],
    )


def _orient(args: argparse.Namespace) -> CommandResult:
    project = _orientation_project(args)
    brief = build_agent_work_brief(project)
    focus = brief["focus"]
    filesystem = brief["filesystem"]
    primary = brief["primaryAction"]
    supporting = brief["supportingActions"]
    agenda = brief["researchAgenda"]
    agenda_move = agenda["moves"][0] if agenda["moves"] else None
    writable = (
        ", ".join(filesystem["editablePaths"])
        if filesystem["writable"]
        else "none until a governed Session owns a worktree"
    )
    question = " ".join(
        (brief["question"]["text"] or brief["question"]["title"]).split()
    )
    candidate_contract = brief["candidateContract"]
    construction_fidelity = brief["constructionFidelity"]
    factor_split_contrast = brief["factorSplitContrast"]
    factor_split_contrast_line = (
        "Factor train/validation contrast: "
        f"{factor_split_contrast['trainMeanRankIc']:+.4f} → "
        f"{factor_split_contrast['validationMeanRankIc']:+.4f} · "
        f"|gap| {factor_split_contrast['absoluteGap']:.4f} ≥ "
        f"{factor_split_contrast['visibilityThreshold']:.2f} visibility "
        "threshold · validation still selects\n"
        if factor_split_contrast is not None
        else ""
    )
    validation_fidelity_line = ""
    if construction_fidelity is not None:
        validation_fidelity = construction_fidelity["bySplit"]["validation"]
        validation_rate = validation_fidelity["withinToleranceRate"]
        validation_rate_label = (
            f"{validation_rate:.3f}"
            if validation_rate is not None
            else "unavailable"
        )
        validation_latest = validation_fidelity["latestEligibleDecision"]
        validation_latest_label = (
            f" · latest {validation_latest['asOf']} "
            f"{validation_latest['status']}"
            if validation_latest is not None
            else ""
        )
        validation_fidelity_line = (
            "Validation ERC fidelity: "
            f"{validation_fidelity['withinToleranceDecisions']}/"
            f"{validation_fidelity['eligibleDecisions']} within tolerance · "
            f"rate {validation_rate_label}"
            f"{validation_latest_label}\n"
        )
    latest_experiment = brief["evidence"]["latestExperiment"]
    failure_disposition = brief["evidence"]["failureDisposition"]
    failure_line = (
        f"Failure disposition: {failure_disposition}\n"
        if failure_disposition is not None
        else ""
    )
    continuation = brief["continuation"]
    continuation_line = (
        "Continuation: upstream Run "
        f"{continuation['run_id']} · Study {continuation['study_id']} · "
        f"{len(continuation['artifacts'])} artifacts\n"
        if continuation is not None
        else ""
    )
    latest_experiment_line = (
        "Latest trial: "
        f"{latest_experiment['id']} · {latest_experiment['verdict']} · "
        f"Run {latest_experiment['runId']} · "
        + (
            "Check "
            f"{latest_experiment['candidateCheck']['id']} "
            f"({latest_experiment['candidateCheck']['status']})"
            if latest_experiment["candidateCheck"] is not None
            else "Check unavailable"
        )
        + "\n"
        if latest_experiment is not None
        else ""
    )
    if len(question) > 320:
        question = question[:319].rstrip() + "…"
    human = (
        _project_selection_human(args)
        +
        f"AutoQuant Agent Work Brief: {brief['project']['name']}\n"
        f"Project root: {brief['project']['rootDir']}\n"
        f"Question: {question}\n"
        + (
            "Candidate panel: "
            f"{candidate_contract['api']['kind']} · base "
            f"{candidate_contract['data']['baseInterval'] or 'unspecified'}"
            " · feature intervals "
            f"{', '.join(candidate_contract['data']['featureIntervals']) or 'none'}\n"
            f"Interval authority: {candidate_contract['data']['availabilityRule']}\n"
            "Observation semantics: "
            f"{candidate_contract['data']['observationSemantics']['timestampMeaning']} · "
            f"{candidate_contract['data']['observationSemantics']['panelShape']} · "
            f"{candidate_contract['data']['observationSemantics']['targetClock']}\n"
            "Context visibility: "
            f"{candidate_contract['data']['observationSemantics']['contextVisibility']}\n"
            "Component roles: "
            f"{', '.join(candidate_contract['components']['roles'])}\n"
            if candidate_contract is not None
            else ""
        )
        +
        f"Focus: {focus['laneName'] or 'single Study'} · "
        f"{focus['studyId'] or 'no Study'}\n"
        f"{continuation_line}"
        f"State: {focus['coordinationPhase']} · "
        f"{focus['scientificStage']} · {focus['operatingMode']}\n"
        f"{failure_line}"
        f"{validation_fidelity_line}"
        f"{factor_split_contrast_line}"
        f"{latest_experiment_line}"
        f"Reason: {brief['reasons'][0]['code']} — "
        f"{brief['reasons'][0]['message']}\n"
        f"Operating root: {filesystem['operatingRoot']}\n"
        f"Writable now: {writable}\n"
        f"Protected: {', '.join(filesystem['protectedCategories'])}\n"
        f"Authority: {brief['authority']['selectionSplit']} selects · "
        f"{brief['authority']['testRole']} test · trading none\n"
        f"Research agenda: {agenda['status']}"
        f" · {agenda['moveRole']}"
        + (
            f" · {agenda['diagnosis']['stage']}"
            if agenda["diagnosis"] is not None
            else ""
        )
        + "\n"
        + (
            (
                "Optional follow-up 1: "
                if agenda["moveRole"] == "optional-follow-up"
                else "Research move 1: "
            )
            + f"{agenda_move['title']}\n"
            f"Hypothesis: {agenda_move['hypothesis']}\n"
            f"Edit target: "
            f"{', '.join(agenda_move['target']['editablePaths']) or 'freeze current source'}\n"
            if agenda_move is not None
            else f"Agenda reason: {agenda['reason']}\n"
        )
        + (
            f"Next: {primary['display']}\n"
            f"Effect: {primary['effect']} · produces "
            f"{primary['expectedEvidenceKind']}\n"
            if primary is not None
            else (
                f"Next: {brief['review']['next']}\n"
                "Effect: Agent-owned preparation; no automatic command\n"
                + (
                    f"Supporting: {supporting[0]['display']}\n"
                    f"Supporting effect: {supporting[0]['effect']} · produces "
                    f"{supporting[0]['expectedEvidenceKind']}\n"
                    if supporting
                    else ""
                )
            )
        )
    )
    next_actions = _brief_next_actions(brief)
    selection = getattr(args, "_autoquant_project_selection", None)
    if (
        selection is not None
        and selection["selection"]["projectCount"] > 1
        and not selection["selection"]["explicit"]
    ):
        next_actions.insert(
            0,
            next_action(
                "project.list",
                "Review every Project before changing desk focus.",
                [
                    "aq",
                    "project",
                    "list",
                    selection["workspace"]["rootDir"],
                    "--json",
                ],
                "read-only",
            ),
        )
    return CommandResult(
        "orient",
        brief,
        human,
        _project_result_context(args, project),
        [
            artifact(
                "project",
                project.manifest.id,
                project.root_dir / PROJECT_MANIFEST,
                immutable=False,
            )
        ],
        next_actions,
    )


def dispatch(args: argparse.Namespace) -> CommandResult:
    if args.command_id == "version":
        harness = harness_identity()
        state = "dirty" if harness["dirty"] else "clean"
        return CommandResult(
            "version",
            {
                "harness": harness,
            },
            (
                f"AutoQuant {harness['version']}\n"
                f"Harness: {harness['id']}\n"
                f"Commit: {harness['commit']} · {state}\n"
                f"Build provenance: {harness['buildProvenance']}\n"
                f"Runtime source hash: {harness['sourceHash']}\n"
                f"Python: {harness['python']}\n"
            ),
        )
    if args.command_id == "capabilities":
        harness = harness_identity()
        human = "\n\n".join(
            f"{command['usage']}\n  {command['description']}\n"
            f"  effect: {command['effect']}"
            for command in CLI_COMMANDS
        )
        return CommandResult(
            "capabilities",
            {
                "name": "aq",
                "description": "AutoQuant V2 quantitative research workbench CLI",
                "harness": harness,
                "commands": CLI_COMMANDS,
            },
            (
                f"Harness: {harness['id']}@{harness['version']} · "
                f"commit {harness['commit']} · "
                f"{'dirty' if harness['dirty'] else 'clean'} · "
                f"{harness['buildProvenance']}\n\n{human}\n"
            ),
        )
    if args.command_id == "schema":
        kinds = [
            "agent-work-brief",
            "research-agenda",
            "holdout-binding",
            "holdout-result",
            "holdout-assessment-analysis",
            "holdout-assessment",
            "holdout-status",
            "campaign-progress",
            "campaign-result",
            "dossier-analysis",
            "dossier-result",
            "dossier-status",
            "experiment",
            "factor-candidate-contract",
            "factor-diagnostics",
            "factor-claim",
            "event-study-policy",
            "event-study-diagnostics",
            "book-path-stress-policy",
            "book-path-stress-diagnostics",
            "allocation-policy",
            "allocation-diagnostics",
            "judge-output",
            "ohlcv-dataset-package",
            "book-risk-diagnostics",
            "portfolio-diagnostics",
            "research-program-status",
            "rl-policy-diagnostics",
            "session-decision-matrix",
            "session-completion",
            "candidate-check-output",
            "candidate-check-result",
            "candidate-preflight",
            "portfolio-mandate",
            "factor-population",
            "research-horizon",
            "project",
            "report-analysis",
            "review-analysis",
            "research-request",
            "researcher-response",
            "run-result",
            "session",
            "study",
            "studio-snapshot",
            "workspace",
        ]
        if args.kind is None:
            return CommandResult(
                "schema",
                {"kinds": kinds},
                "AutoQuant schema kinds:\n"
                + "".join(f"  {kind}\n" for kind in kinds),
            )
        schemas = {
            "agent-work-brief": AGENT_WORK_BRIEF_JSON_SCHEMA,
            "research-agenda": RESEARCH_AGENDA_JSON_SCHEMA,
            "holdout-binding": HOLDOUT_BINDING_JSON_SCHEMA,
            "holdout-result": HOLDOUT_RESULT_JSON_SCHEMA,
            "holdout-assessment-analysis": HOLDOUT_ASSESSMENT_ANALYSIS_JSON_SCHEMA,
            "holdout-assessment": HOLDOUT_ASSESSMENT_JSON_SCHEMA,
            "holdout-status": HOLDOUT_STATUS_JSON_SCHEMA,
            "study": STUDY_JSON_SCHEMA,
            "judge-output": JUDGE_OUTPUT_JSON_SCHEMA,
            "run-result": RUN_RESULT_JSON_SCHEMA,
            "factor-diagnostics": FACTOR_DIAGNOSTICS_JSON_SCHEMA,
            "factor-candidate-contract": FACTOR_CANDIDATE_CONTRACT_JSON_SCHEMA,
            "factor-claim": FACTOR_CLAIM_JSON_SCHEMA,
            "event-study-policy": EVENT_STUDY_POLICY_JSON_SCHEMA,
            "event-study-diagnostics": EVENT_STUDY_DIAGNOSTICS_JSON_SCHEMA,
            "book-path-stress-policy": BOOK_PATH_STRESS_POLICY_JSON_SCHEMA,
            "book-path-stress-diagnostics": BOOK_PATH_STRESS_DIAGNOSTICS_JSON_SCHEMA,
            "allocation-policy": ALLOCATION_POLICY_JSON_SCHEMA,
            "allocation-diagnostics": ALLOCATION_DIAGNOSTICS_JSON_SCHEMA,
            "book-risk-diagnostics": BOOK_RISK_DIAGNOSTICS_JSON_SCHEMA,
            "portfolio-diagnostics": PORTFOLIO_DIAGNOSTICS_JSON_SCHEMA,
            "research-program-status": RESEARCH_PROGRAM_STATUS_JSON_SCHEMA,
            "rl-policy-diagnostics": RL_DIAGNOSTICS_JSON_SCHEMA,
            "session-decision-matrix": SESSION_DECISION_MATRIX_JSON_SCHEMA,
            "session": SESSION_JSON_SCHEMA,
            "session-completion": SESSION_COMPLETION_JSON_SCHEMA,
            "candidate-preflight": PREFLIGHT_JSON_SCHEMA,
            "candidate-check-output": CHECK_OUTPUT_JSON_SCHEMA,
            "candidate-check-result": CANDIDATE_CHECK_RESULT_JSON_SCHEMA,
            "portfolio-mandate": PORTFOLIO_MANDATE_JSON_SCHEMA,
            "factor-population": FACTOR_POPULATION_JSON_SCHEMA,
            "research-horizon": RESEARCH_HORIZON_JSON_SCHEMA,
            "experiment": EXPERIMENT_JSON_SCHEMA,
            "researcher-response": RESEARCHER_RESPONSE_JSON_SCHEMA,
            "campaign-result": CAMPAIGN_RESULT_JSON_SCHEMA,
            "campaign-progress": CAMPAIGN_PROGRESS_JSON_SCHEMA,
            "research-request": RESEARCH_REQUEST_JSON_SCHEMA,
            "ohlcv-dataset-package": OHLCV_DATASET_PACKAGE_JSON_SCHEMA,
            "report-analysis": REPORT_ANALYSIS_JSON_SCHEMA,
            "review-analysis": REVIEW_ANALYSIS_JSON_SCHEMA,
            "dossier-analysis": DOSSIER_ANALYSIS_JSON_SCHEMA,
            "dossier-result": DOSSIER_RESULT_JSON_SCHEMA,
            "dossier-status": DOSSIER_STATUS_JSON_SCHEMA,
            "studio-snapshot": STUDIO_SNAPSHOT_JSON_SCHEMA,
        }
        schema = schemas.get(args.kind) or workspace_schema_for(args.kind)
        return CommandResult(
            "schema",
            {"kind": args.kind, "schema": schema},
            json.dumps(schema, indent=2, sort_keys=True) + "\n",
        )
    if args.command_id == "workspace.init":
        return _workspace_init(args)
    if args.command_id == "project.create":
        return _project_create(args)
    if args.command_id == "project.templates":
        return _project_templates(args)
    if args.command_id == "project.intake":
        return _project_intake(args)
    if args.command_id == "project.list":
        return _project_list(args)
    if args.command_id == "project.default":
        return _project_default(args)
    if args.command_id == "project.program":
        return _project_program(args)
    if args.command_id == "orient":
        return _orient(args)
    if args.command_id == "validate":
        return _validate(args)
    if args.command_id == "inspect":
        return _inspect(args)
    if args.command_id == "study.intake":
        return _study_intake(args)
    if args.command_id == "study.create":
        return _study_create(args)
    if args.command_id == "study.list":
        return _study_list(args)
    if args.command_id == "study.inspect":
        return _study_inspect(args)
    if args.command_id == "run.execute":
        return _run_execute(args)
    if args.command_id == "run.list":
        return _run_list(args)
    if args.command_id == "run.show":
        return _run_show(args)
    if args.command_id == "run.factor":
        return _run_factor(args)
    if args.command_id == "run.portfolio":
        return _run_portfolio(args)
    if args.command_id == "run.book-risk":
        return _run_book_risk(args)
    if args.command_id == "run.event-study":
        return _run_event_study(args)
    if args.command_id == "run.book-path-stress":
        return _run_book_path_stress(args)
    if args.command_id == "run.allocation":
        return _run_allocation(args)
    if args.command_id == "run.rl":
        return _run_rl(args)
    if args.command_id == "session.start":
        return _session_start(args)
    if args.command_id == "session.list":
        return _session_list(args)
    if args.command_id == "session.show":
        return _session_show(args)
    if args.command_id == "session.check":
        return _session_check(args)
    if args.command_id == "session.compare":
        return _session_compare(args)
    if args.command_id == "session.promote":
        return _session_promote(args)
    if args.command_id == "session.complete":
        return _session_complete(args)
    if args.command_id == "experiment.evaluate":
        return _experiment_evaluate(args)
    if args.command_id == "experiment.list":
        return _experiment_list(args)
    if args.command_id == "experiment.show":
        return _experiment_show(args)
    if args.command_id == "research.run":
        return _research_run(args)
    if args.command_id == "research.list":
        return _research_list(args)
    if args.command_id == "research.show":
        return _research_show(args)
    if args.command_id == "report.draft":
        return _report_draft(args)
    if args.command_id == "report.publish":
        return _report_publish(args)
    if args.command_id == "report.list":
        return _report_list(args)
    if args.command_id == "report.show":
        return _report_show(args)
    if args.command_id == "review.publish":
        return _review_publish(args)
    if args.command_id == "review.list":
        return _review_list(args)
    if args.command_id == "review.show":
        return _review_show(args)
    if args.command_id == "dossier.status":
        return _dossier_status(args)
    if args.command_id == "dossier.publish":
        return _dossier_publish(args)
    if args.command_id == "dossier.list":
        return _dossier_list(args)
    if args.command_id == "dossier.show":
        return _dossier_show(args)
    if args.command_id == "holdout.create-target":
        return _holdout_create_target(args)
    if args.command_id == "holdout.bind":
        return _holdout_bind(args)
    if args.command_id == "holdout.status":
        return _holdout_status(args)
    if args.command_id == "holdout.run":
        return _holdout_run(args)
    if args.command_id == "holdout.assess":
        return _holdout_assess(args)
    if args.command_id == "holdout.show":
        return _holdout_show(args)
    if args.command_id == "studio.snapshot":
        return _studio_snapshot(args)
    if args.command_id == "studio.serve":
        return _studio_serve(args)
    raise CliUsageError(f"Unknown command: {args.command_id}")


def _command_id(argv: Sequence[str]) -> str:
    if not argv:
        return "help"
    if argv[0] in {
        "workspace",
        "project",
        "study",
        "run",
        "session",
        "experiment",
        "research",
        "report",
        "review",
        "dossier",
        "studio",
    } and len(argv) > 1:
        return f"{argv[0]}.{argv[1]}"
    return argv[0]


def main(argv: Sequence[str] | None = None) -> int:
    arguments = list(argv if argv is not None else sys.argv[1:])
    wants_json = "--json" in arguments
    command = _command_id(arguments)
    try:
        parsed = build_parser().parse_args(arguments)
        command = parsed.command_id
        result = dispatch(parsed)
        if getattr(parsed, "json", False):
            print(
                json.dumps(
                    success_envelope(
                        result.command,
                        result.data,
                        context=result.context,
                        artifacts=result.artifacts,
                        next_actions=result.next_actions,
                    ),
                    indent=2,
                    sort_keys=True,
                )
            )
        else:
            sys.stdout.write(result.human)
        return 0
    except CliUsageError as error:
        envelope = error_envelope(command, error, usage=True)
        if wants_json:
            print(json.dumps(envelope, indent=2, sort_keys=True))
        else:
            print(f"aq: {error}", file=sys.stderr)
        return 2
    except Exception as error:
        envelope = error_envelope(command, error)
        if wants_json:
            print(json.dumps(envelope, indent=2, sort_keys=True))
        else:
            print(f"aq: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
