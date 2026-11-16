"""Verified read-only snapshots and local HTTP presentation for AutoQuant."""

from __future__ import annotations

import ipaddress
import json
import os
import shlex
import threading
import webbrowser
from dataclasses import dataclass
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib.resources import files
from pathlib import Path
from typing import Any, Callable, Mapping
from urllib.parse import urlsplit

from .allocation_explorer import (
    DEFAULT_ALLOCATION_POINTS,
    load_allocation_diagnostics,
)
from .decision_matrix import (
    STUDIO_COMPARISON_TRIALS,
    load_session_decision_matrix,
)
from .book_risk_explorer import (
    DEFAULT_BOOK_RISK_POINTS,
    load_book_risk_diagnostics,
)
from .dossiers import list_dossiers, load_dossier_status
from .factor_explorer import (
    DEFAULT_FACTOR_POINTS,
    load_factor_diagnostics,
)
from .event_explorer import load_event_study_diagnostics
from .book_path_stress_explorer import load_book_path_stress_diagnostics
from .intake import (
    dataset_snapshot_class_context,
    load_project_intake,
    load_study_dataset_snapshot,
)
from .holdouts import load_holdout_status
from .orientation import build_agent_work_brief
from .portfolio_explorer import (
    DEFAULT_PORTFOLIO_POINTS,
    load_portfolio_diagnostics,
)
from .rl_explorer import DEFAULT_RL_POINTS, load_rl_diagnostics
from .research import list_campaign_progress, list_campaigns
from .research_program import load_research_program
from .reports import list_reports
from .run_reports import list_run_reports
from .reviews import list_reviews
from .runs import harness_identity, list_runs, load_run, run_failure_disposition
from .sessions import list_sessions, load_session, session_snapshot
from .studies import hash_json, list_studies, load_study
from .workspace import (
    PROJECT_MANIFEST,
    SCHEMA_VERSION,
    WORKSPACE_MANIFEST,
    AutoQuantValidationError,
    ProjectContext,
    ValidationIssue,
    confined_path,
    load_project,
    load_workspace,
)


STUDIO_KIND = "autoquant-studio-snapshot"
HARNESS_CAPABILITY = "HARNESS_CAPABILITY"
HARNESS_HOST = "HARNESS_HOST"
HARNESS_PORTS = "HARNESS_PORTS"
HARNESS_NO_OPEN = "HARNESS_NO_OPEN"
STUDIO_MANAGED_PORT_NAMES = frozenset({"http"})
STANDALONE_STUDIO_HOST = "127.0.0.1"
STANDALONE_STUDIO_PORT = 8765


@dataclass(frozen=True)
class StudioLaunch:
    """Resolved bind and browser authority for one Studio process."""

    host: str
    port: int
    open_browser: bool
    managed: bool


STUDIO_ASSETS = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/assets/studio.css": ("studio.css", "text/css; charset=utf-8"),
    "/assets/studio.js": ("studio.js", "text/javascript; charset=utf-8"),
}
STANDALONE_SECURITY_HEADERS = {
    "Content-Security-Policy": (
        "default-src 'none'; script-src 'self'; style-src 'self'; "
        "img-src 'self' data:; connect-src 'self'; font-src 'self'; "
        "base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    ),
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": (
        "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
    ),
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
}
MANAGED_SECURITY_HEADERS = {
    "Content-Security-Policy": (
        "default-src 'none'; script-src 'self'; style-src 'self'; "
        "img-src 'self' data:; connect-src 'self'; font-src 'self'; "
        "base-uri 'none'; form-action 'none'; frame-ancestors app: "
        "http://127.0.0.1:* http://localhost:* http://*.localhost:*"
    ),
    "Permissions-Policy": (
        "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
    ),
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
}


def studio_security_headers(*, managed: bool) -> Mapping[str, str]:
    """Return the explicit launch-mode response policy."""

    return MANAGED_SECURITY_HEADERS if managed else STANDALONE_SECURITY_HEADERS


def _issue(path: Path | str, code: str, message: str) -> ValidationIssue:
    return ValidationIssue(str(path), code, message)


def _managed_ports(raw: str | None) -> dict[str, Any]:
    if raw is None:
        raise AutoQuantValidationError(
            [
                _issue(
                    HARNESS_PORTS,
                    "studio.managed-ports",
                    "Managed Studio requires an injected JSON ports object",
                )
            ]
        )

    def reject_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in pairs:
            if key in result:
                raise ValueError(f"duplicate port name: {key}")
            result[key] = value
        return result

    try:
        parsed = json.loads(raw, object_pairs_hook=reject_duplicates)
    except (json.JSONDecodeError, ValueError) as error:
        raise AutoQuantValidationError(
            [
                _issue(
                    HARNESS_PORTS,
                    "studio.managed-ports",
                    "Managed Studio ports must be one unambiguous JSON object",
                )
            ]
        ) from error
    if not isinstance(parsed, dict):
        raise AutoQuantValidationError(
            [
                _issue(
                    HARNESS_PORTS,
                    "studio.managed-ports",
                    "Managed Studio ports must be a JSON object",
                )
            ]
        )
    return parsed


def _managed_host(raw: str | None) -> str:
    if raw is None or not raw or raw.strip() != raw:
        raise AutoQuantValidationError(
            [
                _issue(
                    HARNESS_HOST,
                    "studio.managed-host",
                    "Managed Studio requires one non-empty injected host",
                )
            ]
        )
    if raw.casefold() == "localhost":
        return raw
    try:
        address = ipaddress.ip_address(raw)
    except ValueError:
        address = None
    if isinstance(address, ipaddress.IPv4Address) and address.is_loopback:
        return raw
    raise AutoQuantValidationError(
        [
            _issue(
                HARNESS_HOST,
                "studio.managed-host",
                "Managed Studio host must be localhost or a canonical IPv4 "
                "loopback address",
            )
        ]
    )


def resolve_studio_launch(
    *,
    host: str | None,
    port: int | None,
    no_open: bool,
    environ: Mapping[str, str] | None = None,
) -> StudioLaunch:
    """Resolve standalone defaults or strict generic Harness authority."""

    environment = os.environ if environ is None else environ
    if environment.get(HARNESS_CAPABILITY) != "studio":
        return StudioLaunch(
            host=STANDALONE_STUDIO_HOST if host is None else host,
            port=STANDALONE_STUDIO_PORT if port is None else port,
            open_browser=not no_open,
            managed=False,
        )

    injected_host = _managed_host(environment.get(HARNESS_HOST))
    ports = _managed_ports(environment.get(HARNESS_PORTS))
    if set(ports) != STUDIO_MANAGED_PORT_NAMES:
        declared = ", ".join(sorted(STUDIO_MANAGED_PORT_NAMES))
        raise AutoQuantValidationError(
            [
                _issue(
                    HARNESS_PORTS,
                    "studio.managed-port-names",
                    "Managed Studio ports must match the manifest exactly: "
                    f"{declared}",
                )
            ]
        )
    injected_port = ports["http"]
    if (
        not isinstance(injected_port, int)
        or isinstance(injected_port, bool)
        or not 1 <= injected_port <= 65535
    ):
        raise AutoQuantValidationError(
            [
                _issue(
                    f"{HARNESS_PORTS}.http",
                    "studio.managed-http-port",
                    "Managed Studio http port must be an integer from 1 to 65535",
                )
            ]
        )
    issues: list[ValidationIssue] = []
    if host is not None and host != injected_host:
        issues.append(
            _issue(
                "--host",
                "studio.managed-host-conflict",
                f"Explicit Studio host {host!r} conflicts with injected host {injected_host!r}",
            )
        )
    if port is not None and port != injected_port:
        issues.append(
            _issue(
                "--port",
                "studio.managed-port-conflict",
                f"Explicit Studio port {port} conflicts with injected port {injected_port}",
            )
        )
    if issues:
        raise AutoQuantValidationError(issues)
    return StudioLaunch(
        host=injected_host,
        port=injected_port,
        open_browser=(
            not no_open
            and environment.get(HARNESS_NO_OPEN) != "1"
        ),
        managed=True,
    )


def _diagnostics(
    category: str,
    error: AutoQuantValidationError,
) -> list[dict[str, str]]:
    return [
        {
            "category": category,
            **issue.to_dict(),
        }
        for issue in error.issues
    ]


def _read_category(
    category: str,
    operation: Callable[[], Any],
) -> tuple[Any, list[dict[str, str]]]:
    try:
        return operation(), []
    except AutoQuantValidationError as error:
        return [], _diagnostics(category, error)


def _workspace_projects(
    root: Path,
    selected_project: str | None,
) -> tuple[dict[str, Any], list[ProjectContext], list[dict[str, str]]]:
    workspace = load_workspace(root)
    projects: list[ProjectContext] = []
    discovered_ids: set[str] = set()
    diagnostics: list[dict[str, str]] = []
    for entry in sorted(workspace.projects_dir.iterdir(), key=lambda item: item.name):
        if entry.name.startswith("."):
            continue
        if entry.is_symlink() or not entry.is_dir():
            diagnostics.append(
                {
                    "category": "workspace",
                    **_issue(
                        entry,
                        "workspace.project-entry",
                        "Workspace Project entries must be real directories",
                    ).to_dict(),
                }
            )
            continue
        try:
            project = load_project(entry, expected_id=entry.name)
        except AutoQuantValidationError as error:
            diagnostics.extend(_diagnostics("workspace", error))
            continue
        discovered_ids.add(project.manifest.id)
        if selected_project is None or project.manifest.id == selected_project:
            projects.append(project)
    default_project = workspace.manifest.default_project
    if default_project is not None and default_project not in discovered_ids:
        diagnostics.append(
            {
                "category": "workspace",
                **_issue(
                    workspace.configuration_path,
                    "workspace.default-project",
                    f"Default Project '{default_project}' does not exist",
                ).to_dict(),
            }
        )
    if selected_project is not None and not any(
        project.manifest.id == selected_project for project in projects
    ):
        raise AutoQuantValidationError(
            [
                _issue(
                    selected_project,
                    "workspace.project-missing",
                    f"Unknown Workspace Project: {selected_project}",
                )
            ]
        )
    return (
        {
            "name": workspace.manifest.name,
            "rootDir": str(workspace.root_dir),
            "projectsDir": str(workspace.projects_dir),
            "defaultProject": workspace.manifest.default_project,
            "configurationSource": workspace.configuration_source,
            "configurationPath": str(workspace.configuration_path),
        },
        projects,
        diagnostics,
    )


def _resolve_source(
    directory: str | Path,
    selected_project: str | None,
) -> tuple[str, Path, dict[str, Any] | None, list[ProjectContext], list[dict[str, str]]]:
    raw = Path(directory).expanduser().absolute()
    if raw.is_symlink():
        raise AutoQuantValidationError(
            [_issue(raw, "path.symlink", "Studio input root cannot be a symlink")]
        )
    root = raw.resolve()
    is_project = (root / PROJECT_MANIFEST).is_file()
    is_workspace = (root / WORKSPACE_MANIFEST).is_file()
    if is_project and is_workspace:
        raise AutoQuantValidationError(
            [_issue(root, "path.ambiguous", "Studio root cannot be both types")]
        )
    if is_project:
        if selected_project is not None:
            raise AutoQuantValidationError(
                [
                    _issue(
                        selected_project,
                        "project.unexpected-selection",
                        "--project cannot select inside a direct Project",
                    )
                ]
            )
        return "project", root, None, [load_project(root)], []
    if is_workspace:
        workspace, projects, diagnostics = _workspace_projects(
            root,
            selected_project,
        )
        return "workspace", root, workspace, projects, diagnostics
    raise AutoQuantValidationError(
        [
            _issue(
                root,
                "path.not-autoquant",
                f"Not an AutoQuant Project or Workspace: {root}",
            )
        ]
    )


def _timeline(
    runs: list[dict[str, Any]],
    sessions: list[dict[str, Any]],
    run_reports: list[dict[str, Any]],
    reviews: list[dict[str, Any]],
    dossiers: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for run in runs:
        events.append(
            {
                "kind": "run",
                "id": run["id"],
                "at": run["startedAt"],
                "status": run["status"],
                "title": f"{run['studyId']} · {run['primaryMetric']}",
                "value": run["primaryValue"],
            }
        )
    for item in sessions:
        session = item["session"]
        events.append(
            {
                "kind": "session",
                "id": session["id"],
                "at": session["updatedAt"],
                "status": session["status"],
                "title": session["studyId"],
                "value": session["leader"]["value"],
            }
        )
        for experiment in item["experiments"]:
            events.append(
                {
                    "kind": "experiment",
                    "id": experiment["id"],
                    "at": experiment["completedAt"],
                    "status": experiment["verdict"],
                    "title": experiment["hypothesis"],
                    "value": experiment["candidateValue"],
                }
            )
        for campaign in item["campaigns"]:
            events.append(
                {
                    "kind": "campaign",
                    "id": campaign["id"],
                    "at": campaign["completedAt"],
                    "status": campaign["status"],
                    "title": campaign["reason"],
                    "value": campaign["experiments"],
                }
            )
        for report in item["reports"]:
            events.append(
                {
                    "kind": "report",
                    "id": report["id"],
                    "at": report["publishedAt"],
                    "status": "published",
                    "title": report["title"],
                    "value": report["findings"],
                }
            )
        for progress in item["progress"]:
            events.append(
                {
                    "kind": "progress",
                    "id": progress["campaignId"],
                    "at": progress["updatedAt"],
                    "status": progress["phase"],
                    "title": progress["message"],
                    "value": progress["turn"],
                    "mutable": True,
                }
            )
    for report in run_reports:
        events.append(
            {
                "kind": "report",
                "id": report["id"],
                "at": report["publishedAt"],
                "status": "published",
                "title": report["title"],
                "value": report["findings"],
            }
        )
    for review in reviews:
        events.append(
            {
                "kind": "review",
                "id": review["id"],
                "at": review["publishedAt"],
                "status": review["conclusion"],
                "title": review["title"],
                "value": review["claims"],
            }
        )
    for dossier in dossiers:
        events.append(
            {
                "kind": "dossier",
                "id": dossier["id"],
                "at": dossier["publishedAt"],
                "status": "published",
                "title": dossier["title"],
                "value": dossier["findings"],
            }
        )
    return sorted(
        events,
        key=lambda event: (event["at"], event["id"]),
        reverse=True,
    )[:100]


def _portfolio_metric_layers(result: dict[str, Any]) -> dict[str, Any] | None:
    metrics = result["metrics"]
    required = ("factor", "portfolio", "implementation", "robustness")
    if not all(isinstance(metrics.get(key), dict) for key in required):
        return None
    try:
        cost_stress = metrics["robustness"]["cost_stress"]
        adverse_cost_key = max(
            cost_stress,
            key=lambda item: float(item.removesuffix("bps")),
        )
        layers = {
            "kind": "portfolio",
            "researchHorizon": metrics.get("research_horizon"),
            "decisionCadence": (
                metrics["portfolio_mandate"]["implementationPolicy"][
                    "decisionPolicy"
                ]
                if isinstance(metrics.get("portfolio_mandate"), dict)
                else None
            ),
            "mandate": (
                {
                    "id": metrics["portfolio_mandate"]["id"],
                    "direction": metrics["portfolio_mandate"]["source"][
                        "direction"
                    ],
                    "family": metrics["portfolio_mandate"]["construction"][
                        "family"
                    ],
                    "grossLimit": metrics["portfolio_mandate"][
                        "construction"
                    ]["grossLimit"],
                    "maxAbsWeight": metrics["portfolio_mandate"][
                        "construction"
                    ]["maxAbsWeight"],
                    "assetMaxAbsWeights": metrics["portfolio_mandate"][
                        "construction"
                    ]["assetMaxAbsWeights"],
                    "assetPositionRoles": metrics["portfolio_mandate"][
                        "construction"
                    ]["assetPositionRoles"],
                    "positionRolesSource": metrics["portfolio_mandate"][
                        "source"
                    ]["assetPositionRoles"],
                    "longGrossLimit": metrics["portfolio_mandate"][
                        "construction"
                    ]["longGrossLimit"],
                    "shortGrossLimit": metrics["portfolio_mandate"][
                        "construction"
                    ]["shortGrossLimit"],
                    "benchmark": metrics["portfolio_mandate"][
                        "construction"
                    ]["benchmark"],
                    "policySource": metrics["portfolio_mandate"]["source"][
                        "portfolioPolicy"
                    ],
                    "tradableAssets": metrics["portfolio_mandate"][
                        "tradableAssets"
                    ],
                    "contextAssets": metrics["portfolio_mandate"][
                        "contextAssets"
                    ],
                    "riskPolicy": metrics["portfolio_mandate"][
                        "construction"
                    ]["riskPolicy"],
                    "implementationPolicy": metrics["portfolio_mandate"][
                        "implementationPolicy"
                    ],
                }
                if isinstance(metrics.get("portfolio_mandate"), dict)
                else None
            ),
            "factor": {
                "validationRankIc": metrics["factor"]["validation"]["mean_rank_ic"],
                "testRankIc": metrics["factor"]["test"]["mean_rank_ic"],
            },
            "portfolio": {
                "validationNetSharpe": metrics["portfolio"]["validation"]["net"][
                    "sharpe"
                ],
                "testNetSharpe": metrics["portfolio"]["test"]["net"]["sharpe"],
                "testAnnualReturn": metrics["portfolio"]["test"]["net"][
                    "annual_return"
                ],
                "testMaximumDrawdown": metrics["portfolio"]["test"]["net"][
                    "maximum_drawdown"
                ],
            },
            "selection": metrics.get("research_integrity"),
            "implementation": {
                "testAnnualizedTurnover": metrics["implementation"]["test"][
                    "annualized_one_way_turnover"
                ],
                "testCostDrag": metrics["implementation"]["test"][
                    "total_cost_drag"
                ],
                "testMaximumParticipation": metrics["implementation"]["test"][
                    "maximum_volume_participation"
                ],
            },
            "robustness": {
                "testAdverseCostSharpe": cost_stress[adverse_cost_key][
                    "test"
                ]["sharpe"],
                "adverseCostBps": float(
                    adverse_cost_key.removesuffix("bps")
                ),
                "testExtraDelaySharpe": metrics["robustness"]["extra_delay"][
                    "test"
                ]["sharpe"],
            },
            "constraintsPassed": metrics["constraint_audit"]["passed"],
        }
        signal_policy = metrics.get("signal_policy")
        attribution = metrics.get("attribution")
        layers["signalPolicy"] = None
        layers["attribution"] = None
        layers["liquidityCapacity"] = None
        layers["executedBookRisk"] = None
        layers["positionLifecycle"] = None
        layers["parameterNeighborhood"] = None
        layers["translationRobustness"] = None
        if isinstance(signal_policy, dict):
            validation_policy = signal_policy.get("validation", {})
            comparison = signal_policy.get(
                "hysteresis_comparison",
                {},
            ).get("validation", {})
            if isinstance(validation_policy, dict) and isinstance(
                comparison,
                dict,
            ):
                layers["signalPolicy"] = {
                    "validationStateChangeRate": validation_policy.get(
                        "state_change_rate"
                    ),
                    "validationEntries": validation_policy.get("entries"),
                    "validationExits": validation_policy.get("exits"),
                    "validationReversals": validation_policy.get("reversals"),
                    "validationTransitionReductionRate": comparison.get(
                        "transition_reduction_rate"
                    ),
                    "validationImplementationTurnoverReduction": comparison.get(
                        "implementation_turnover_reduction"
                    ),
                }
        if isinstance(attribution, dict):
            validation_attribution = attribution.get("validation", {})
            if isinstance(validation_attribution, dict):
                reconciliation = validation_attribution.get(
                    "reconciliation",
                    {},
                )
                concentration = validation_attribution.get(
                    "concentration",
                    {},
                )
                layers["attribution"] = {
                    "validationReconciliationPassed": reconciliation.get(
                        "passed"
                    ),
                    "validationMaximumAbsoluteNetContributionShare": (
                        concentration.get(
                            "maximum_absolute_net_contribution_share"
                        )
                    ),
                    "validationAbsoluteNetContributionHhi": concentration.get(
                        "absolute_net_contribution_hhi"
                    ),
                    "validationMaximumAbsoluteRiskContributionShare": (
                        concentration.get(
                            "maximum_absolute_variance_contribution_share"
                        )
                    ),
                }
        capacity = metrics.get("liquidity_capacity")
        if isinstance(capacity, dict):
            validation_capacity = capacity.get("validation", {})
            conservative = (
                validation_capacity.get("capacity_1pct", {})
                if isinstance(validation_capacity, dict)
                else {}
            )
            if isinstance(conservative, dict):
                layers["liquidityCapacity"] = {
                    "validationTradeDateCoverage": validation_capacity.get(
                        "trade_date_coverage"
                    ),
                    "validationTenthPercentileNav1Pct": conservative.get(
                        "tenth_percentile_nav"
                    ),
                    "validationReferenceNavBreachRate1Pct": conservative.get(
                        "reference_nav_breach_rate"
                    ),
                    "selectionAuthority": capacity.get("policy", {}).get(
                        "selection_authority"
                    ),
                }
        execution_risk = metrics.get("execution_risk")
        if isinstance(execution_risk, dict):
            validation_execution_risk = execution_risk.get(
                "validation",
                {},
            )
            if isinstance(validation_execution_risk, dict):
                layers["executedBookRisk"] = {
                    "validationForecastCoverage": (
                        validation_execution_risk.get(
                            "forecast_coverage"
                        )
                    ),
                    "validationPretradeBreachDates": (
                        validation_execution_risk.get(
                            "pretrade_breach_dates"
                        )
                    ),
                    "validationRiskRebalanceOverrideDates": (
                        validation_execution_risk.get(
                            "risk_rebalance_override_dates"
                        )
                    ),
                    "validationExecutedBreachDates": (
                        validation_execution_risk.get(
                            "executed_breach_dates"
                        )
                    ),
                    "validationMaximumExecutedForecastAnnualized": (
                        validation_execution_risk.get(
                            "maximum_executed_forecast_annualized"
                        )
                    ),
                    "selectionAuthority": execution_risk.get(
                        "policy",
                        {},
                    ).get("selection_authority"),
                }
        lifecycle = metrics.get("position_lifecycle")
        if isinstance(lifecycle, dict):
            validation_lifecycle = lifecycle.get("validation", {})
            if isinstance(validation_lifecycle, dict):
                layers["positionLifecycle"] = {
                    "validationCompleteEpisodes": (
                        validation_lifecycle.get("complete_episodes")
                    ),
                    "validationCompleteEpisodeWinRate": (
                        validation_lifecycle.get(
                            "complete_episode_win_rate"
                        )
                    ),
                    "validationMedianCompleteHoldingBars": (
                        validation_lifecycle.get(
                            "median_complete_holding_bars"
                        )
                    ),
                    "validationCompletePayoffRatio": (
                        validation_lifecycle.get("complete_payoff_ratio")
                    ),
                    "validationIntentMismatchRate": (
                        validation_lifecycle.get("intent_mismatch_rate")
                    ),
                    "selectionAuthority": lifecycle.get(
                        "policy",
                        {},
                    ).get("selection_authority"),
                }
        neighborhood = metrics.get("parameter_neighborhood")
        if isinstance(neighborhood, dict):
            validation_neighborhood = neighborhood.get(
                "validation",
                {},
            )
            aggregate = (
                validation_neighborhood.get("aggregate", {})
                if isinstance(validation_neighborhood, dict)
                else {}
            )
            if isinstance(aggregate, dict):
                layers["parameterNeighborhood"] = {
                    "validationConfigurationCount": aggregate.get(
                        "configuration_count"
                    ),
                    "validationPositiveNetSharpeRate": aggregate.get(
                        "positive_net_sharpe_rate"
                    ),
                    "validationSignAgreementWithBaseRate": aggregate.get(
                        "sign_agreement_with_base_rate"
                    ),
                    "validationMinimumNetSharpe": aggregate.get(
                        "minimum_net_sharpe"
                    ),
                    "validationWorstNetSharpeDelta": aggregate.get(
                        "worst_net_sharpe_delta"
                    ),
                    "selectionAuthority": neighborhood.get(
                        "policy",
                        {},
                    ).get("selection_authority"),
                }
        translation = metrics.get("translation_robustness")
        if isinstance(translation, dict):
            diagnosis = translation.get("diagnosis")
            if isinstance(diagnosis, dict):
                layers["translationRobustness"] = {
                    "applicable": translation.get("applicable"),
                    "reason": translation.get("reason"),
                    "validationStatus": diagnosis.get("status"),
                    "minimumActiveStateAgreementRate": diagnosis.get(
                        "minimum_active_state_agreement_rate"
                    ),
                    "maximumMeanAbsoluteTargetDelta": diagnosis.get(
                        "maximum_mean_absolute_target_delta"
                    ),
                    "selectionAuthority": translation.get("policy", {}).get(
                        "selection_authority"
                    ),
                }
        return layers
    except (KeyError, TypeError):
        return None


def _factor_metric_layers(result: dict[str, Any]) -> dict[str, Any] | None:
    metrics = result["metrics"]
    if not all(
        isinstance(metrics.get(key), dict)
        for key in ("validation", "test")
    ):
        return None
    try:
        layers = {
            "kind": "factor",
            "researchHorizon": metrics.get("research_horizon"),
            "factorOutcome": metrics.get("factor_outcome"),
            "decisionCadence": (
                metrics["portfolio_mandate"]["implementationPolicy"][
                    "decisionPolicy"
                ]
                if isinstance(metrics.get("portfolio_mandate"), dict)
                else None
            ),
            "validationMeanIc": metrics["validation"]["mean_ic"],
            "validationPearsonIc": (
                metrics["validation"].get("pearson_ic", {}).get("mean_ic")
            ),
            "validationIcir": metrics["validation"]["icir"],
            "testMeanIc": metrics["test"]["mean_ic"],
            "testIcir": metrics["test"]["icir"],
            "meanCoverage": metrics["mean_coverage"],
            "meanRankTurnover": metrics["mean_rank_turnover"],
            "selection": metrics.get("research_integrity"),
        }
        horizon_quality = metrics.get("horizon_quality")
        quantiles = metrics.get("quantile_analysis")
        stability = metrics.get("stability")
        styles = metrics.get("style_correlations")
        layers.update(
            {
                "validationHacTStatistic": None,
                "validationFarthestHorizonMeanIc": None,
                "farthestForwardBars": None,
                "validationQuantileSpread": None,
                "validationQuantileMonotonicity": None,
                "validationWorstFoldMeanIc": None,
                "validationMaximumAbsoluteStyleCorrelation": None,
                "validationRegimesObserved": None,
            }
        )
        hac = metrics["validation"].get("hac")
        if isinstance(hac, dict):
            layers["validationHacTStatistic"] = hac.get("t_statistic")
        if isinstance(horizon_quality, dict):
            diagnostic_bars = metrics.get("research_horizon", {}).get(
                "diagnosticForwardBars",
                [],
            )
            if diagnostic_bars:
                farthest = int(diagnostic_bars[-1])
                layers["farthestForwardBars"] = farthest
                layers["validationFarthestHorizonMeanIc"] = (
                    horizon_quality.get(str(farthest), {})
                    .get("validation", {})
                    .get("mean_ic")
                )
        if isinstance(quantiles, dict):
            primary = str(
                metrics.get("research_horizon", {}).get(
                    "primaryForwardBars",
                    1,
                )
            )
            validation_quantiles = (
                quantiles.get(primary, {}).get("validation", {})
            )
            layers["validationQuantileSpread"] = validation_quantiles.get(
                "high_minus_low"
            )
            layers["validationQuantileMonotonicity"] = (
                validation_quantiles.get("monotonicity")
            )
        if isinstance(stability, dict):
            folds = stability.get("chronological_folds", {})
            fold_values = [
                item.get("mean_ic")
                for name, item in folds.items()
                if name.startswith("validation_") and isinstance(item, dict)
            ]
            finite_folds = [
                float(value)
                for value in fold_values
                if isinstance(value, (int, float))
            ]
            if finite_folds:
                layers["validationWorstFoldMeanIc"] = min(finite_folds)
            regimes = (
                stability.get("causal_regimes", {}).get("validation", {})
            )
            if isinstance(regimes, dict):
                layers["validationRegimesObserved"] = sum(
                    1
                    for item in regimes.values()
                    if isinstance(item, dict)
                    and isinstance(item.get("mean_ic"), (int, float))
                )
        if isinstance(styles, dict):
            validation_styles = styles.get("validation", {})
            style_values = [
                item.get("mean_rank_correlation")
                for item in validation_styles.values()
                if isinstance(item, dict)
            ]
            finite_styles = [
                abs(float(value))
                for value in style_values
                if isinstance(value, (int, float))
            ]
            if finite_styles:
                layers["validationMaximumAbsoluteStyleCorrelation"] = max(
                    finite_styles
                )
        return layers
    except (KeyError, TypeError):
        return None


def _rl_metric_layers(result: dict[str, Any]) -> dict[str, Any] | None:
    metrics = result["metrics"]
    if not all(
        isinstance(metrics.get(key), dict)
        for key in ("rl", "baselines", "comparison", "configuration")
    ):
        return None
    try:
        aggregate = metrics["rl"]["aggregate"]
        comparison = metrics["comparison"]
        return {
            "kind": "rl-policy",
            "researchHorizon": metrics.get("research_horizon"),
            "mandate": (
                {
                    "id": metrics["portfolio_mandate"]["id"],
                    "direction": metrics["portfolio_mandate"]["source"][
                        "direction"
                    ],
                    "family": metrics["portfolio_mandate"]["construction"][
                        "family"
                    ],
                    "grossLimit": metrics["portfolio_mandate"][
                        "construction"
                    ]["grossLimit"],
                    "maxAbsWeight": metrics["portfolio_mandate"][
                        "construction"
                    ]["maxAbsWeight"],
                    "assetMaxAbsWeights": metrics["portfolio_mandate"][
                        "construction"
                    ]["assetMaxAbsWeights"],
                    "assetPositionRoles": metrics["portfolio_mandate"][
                        "construction"
                    ]["assetPositionRoles"],
                    "positionRolesSource": metrics["portfolio_mandate"][
                        "source"
                    ]["assetPositionRoles"],
                    "longGrossLimit": metrics["portfolio_mandate"][
                        "construction"
                    ]["longGrossLimit"],
                    "shortGrossLimit": metrics["portfolio_mandate"][
                        "construction"
                    ]["shortGrossLimit"],
                    "benchmark": metrics["portfolio_mandate"][
                        "construction"
                    ]["benchmark"],
                    "policySource": metrics["portfolio_mandate"]["source"][
                        "portfolioPolicy"
                    ],
                    "tradableAssets": metrics["portfolio_mandate"][
                        "tradableAssets"
                    ],
                    "contextAssets": metrics["portfolio_mandate"][
                        "contextAssets"
                    ],
                    "riskPolicy": metrics["portfolio_mandate"][
                        "construction"
                    ]["riskPolicy"],
                    "implementationPolicy": metrics["portfolio_mandate"][
                        "implementationPolicy"
                    ],
                }
                if isinstance(metrics.get("portfolio_mandate"), dict)
                else None
            ),
            "validationMeanNetSharpe": metrics[
                "validation_mean_net_sharpe"
            ],
            "testMeanNetSharpe": aggregate["test_net_sharpe"]["mean"],
            "validationSeedFoldStd": aggregate["validation_net_sharpe"][
                "standard_deviation"
            ],
            "testSeedFoldStd": aggregate["test_net_sharpe"][
                "standard_deviation"
            ],
            "validationBaselineAdvantage": comparison[
                "mean_validation_advantage_vs_best_baseline"
            ],
            "validationCandidateFactorAdvantage": comparison.get(
                "mean_validation_advantage_vs_candidate_factor"
            ),
            "validationCandidateActionFrequency": comparison.get(
                "mean_validation_candidate_action_frequency"
            ),
            "failureRate": aggregate["failure_rate"],
            "folds": len(metrics["configuration"]["folds"]),
            "seeds": len(metrics["configuration"]["seeds"]),
            "policyBehavior": (
                {
                    "validationMeanActionRunLength": metrics[
                        "policy_rationale"
                    ]["validation"]["mean_action_run_length"],
                    "validationTransitionRate": metrics[
                        "policy_rationale"
                    ]["validation"]["transition_rate"],
                    "validationRetentionRate": metrics[
                        "policy_rationale"
                    ]["validation"]["retention_rate"],
                    "validationMedianActionMargin": metrics[
                        "policy_rationale"
                    ]["validation"]["median_action_margin"],
                    "validationTieRate": metrics["policy_rationale"][
                        "validation"
                    ]["tie_rate"],
                    "selectionAuthority": metrics["policy_rationale"][
                        "policy"
                    ]["selection_authority"],
                }
                if isinstance(metrics.get("policy_rationale"), dict)
                else None
            ),
            "factorOpportunity": (
                {
                    "validationOracleHitRate": metrics[
                        "factor_opportunity"
                    ]["validation"]["oracle_hit_rate"],
                    "validationMeanSelectedRank": metrics[
                        "factor_opportunity"
                    ]["validation"]["mean_selected_rank"],
                    "validationMeanRealizedRegret": metrics[
                        "factor_opportunity"
                    ]["validation"]["mean_realized_regret"],
                    "validationCandidateOracleFrequency": metrics[
                        "factor_opportunity"
                    ]["validation"]["candidate"]["oracle_frequency"],
                    "validationCandidateMissedOpportunityRate": metrics[
                        "factor_opportunity"
                    ]["validation"]["candidate"][
                        "missed_opportunity_rate"
                    ],
                    "selectionAuthority": metrics[
                        "factor_opportunity"
                    ]["policy"]["selection_authority"],
                }
                if isinstance(metrics.get("factor_opportunity"), dict)
                else None
            ),
            "executedBookRisk": (
                {
                    "validationForecastCoverage": metrics[
                        "execution_risk"
                    ]["validation"]["forecast_coverage"],
                    "validationRiskRebalanceOverrideDates": metrics[
                        "execution_risk"
                    ]["validation"][
                        "risk_rebalance_override_dates"
                    ],
                    "validationExecutedBreachDates": metrics[
                        "execution_risk"
                    ]["validation"]["executed_breach_dates"],
                    "selectionAuthority": metrics["execution_risk"][
                        "policy"
                    ]["selection_authority"],
                }
                if isinstance(metrics.get("execution_risk"), dict)
                else None
            ),
        }
    except (KeyError, TypeError):
        return None


def _run_metric_layers(result: dict[str, Any]) -> dict[str, Any] | None:
    return (
        _portfolio_metric_layers(result)
        or _rl_metric_layers(result)
        or _factor_metric_layers(result)
    )


def _project_snapshot(project: ProjectContext) -> dict[str, Any]:
    diagnostics: list[dict[str, str]] = []
    program_path = confined_path(
        project.root_dir,
        project.manifest.research_program,
        "project/research_program",
    )
    studies_raw, issues = _read_category("studies", lambda: list_studies(project))
    diagnostics.extend(issues)
    runs_raw, issues = _read_category("runs", lambda: list_runs(project))
    diagnostics.extend(issues)
    sessions_raw, issues = _read_category("sessions", lambda: list_sessions(project))
    diagnostics.extend(issues)
    intake_raw, issues = _read_category(
        "intake",
        lambda: load_project_intake(project),
    )
    diagnostics.extend(issues)
    intake = intake_raw if isinstance(intake_raw, dict) else None
    if intake is not None:
        intake_command = (
            _command(
                "run.execute",
                [
                    "aq",
                    "run",
                    "execute",
                    str(project.root_dir),
                    "--study",
                    intake["study"]["id"],
                    "--json",
                ],
                "creates-artifact",
            )
            if intake["manifest"]["status"] == "ready-for-run"
            else _command(
                "session.start",
                [
                    "aq",
                    "session",
                    "start",
                    str(project.root_dir),
                    "--study",
                    intake["study"]["id"],
                    "--request",
                    str(
                        project.root_dir
                        / intake["manifest"]["requestPath"]
                    ),
                    "--json",
                ],
                "creates-artifact",
            )
        )
        intake = {
            **intake,
            "commands": [intake_command],
        }
    research_program_status = None
    try:
        research_program_status = load_research_program(
            project,
            optional=True,
        )
    except AutoQuantValidationError as error:
        diagnostics.extend(_diagnostics("research-program", error))
    agent_work_brief_raw, issues = _read_category(
        "agent-work-brief",
        lambda: build_agent_work_brief(project),
    )
    diagnostics.extend(issues)
    agent_work_brief = (
        agent_work_brief_raw
        if isinstance(agent_work_brief_raw, dict)
        else None
    )
    external_holdout_raw, issues = _read_category(
        "external-holdout",
        lambda: load_holdout_status(
            project,
            optional=True,
            include_evidence=True,
        ),
    )
    diagnostics.extend(issues)
    external_holdout = (
        external_holdout_raw
        if isinstance(external_holdout_raw, dict)
        else None
    )
    if external_holdout is not None:
        holdout_action = external_holdout["nextAction"]
        if intake is not None:
            intake["commands"] = (
                [holdout_action] if holdout_action is not None else []
            )
        if research_program_status is not None:
            research_program_status = {
                **research_program_status,
                "recommendedLaneId": None,
                "recommendedAction": holdout_action,
                "lanes": [
                    {
                        **lane,
                        "commands": [
                            command
                            for command in lane["commands"]
                            if command["effect"] == "read-only"
                        ],
                    }
                    for lane in research_program_status["lanes"]
                ],
            }
    dossier_bundle, issues = _read_category(
        "dossiers",
        lambda: {
            "status": load_dossier_status(project, optional=True),
            "items": [item.to_dict() for item in list_dossiers(project)],
        },
    )
    diagnostics.extend(issues)
    if isinstance(dossier_bundle, dict):
        dossier_status = dossier_bundle["status"]
        dossiers = dossier_bundle["items"]
    else:
        dossier_status = None
        dossiers = []
    if external_holdout is not None and dossier_status is not None:
        dossier_status = {
            **dossier_status,
            "nextAction": external_holdout["nextAction"],
        }
    studies = []
    for item in studies_raw:
        summary = item.to_dict()
        try:
            study = load_study(project, item.id)
            snapshot = load_study_dataset_snapshot(project, study)
            summary["dataset"] = study.definition.to_dict()["dataset"]
            summary["datasetHash"] = study.dataset_hash
            summary["researchRequest"] = study.definition.to_dict().get(
                "research_request"
            )
            summary["upstreamEvidence"] = study.definition.to_dict().get(
                "upstream_evidence"
            )
            summary["datasetContext"] = (
                dataset_snapshot_class_context(snapshot)
                if snapshot is not None
                else None
            )
        except AutoQuantValidationError as error:
            diagnostics.extend(
                _diagnostics(f"study-dataset:{item.id}", error)
            )
        studies.append(summary)
    runs: list[dict[str, Any]] = []
    for item in runs_raw:
        summary = item.to_dict()
        run_result = load_run(project, item.id).result
        summary["summary"] = run_result["summary"]
        summary["errors"] = run_result["errors"]
        summary["failureDisposition"] = run_failure_disposition(run_result)
        summary["researchRequest"] = run_result.get("researchRequest")
        summary["upstreamEvidence"] = run_result.get("upstreamEvidence")
        metric_layers = _run_metric_layers(run_result)
        if metric_layers is not None:
            summary["metricLayers"] = metric_layers
        runs.append(summary)

    def current_program_run(lane_id: str):
        if research_program_status is None:
            return None
        lane = next(
            (
                item
                for item in research_program_status["lanes"]
                if item["id"] == lane_id
            ),
            None,
        )
        if (
            lane is None
            or not lane["currentRun"]
            or lane["latestRun"] is None
            or lane["latestRun"]["status"] != "succeeded"
        ):
            return None
        return next(
            (
                item
                for item in runs_raw
                if item.id == lane["latestRun"]["id"]
            ),
            None,
        )

    factor_explorer = None
    factor_candidate = current_program_run("factor")
    if research_program_status is None:
        factor_candidate = next(
            (
                item
                for item in reversed(runs_raw)
                if item.status == "succeeded"
                and item.primary_metric == "validation_mean_ic"
            ),
            None,
        )
    if factor_candidate is not None:
        try:
            factor_explorer = load_factor_diagnostics(
                project,
                factor_candidate.id,
                point_limit=DEFAULT_FACTOR_POINTS,
            )
        except AutoQuantValidationError as error:
            diagnostics.extend(
                _diagnostics(
                    f"factor-explorer:{factor_candidate.id}",
                    error,
                )
            )
    portfolio_explorer = None
    portfolio_candidate = current_program_run("portfolio")
    if research_program_status is None:
        portfolio_candidate = next(
            (
                item
                for item in reversed(runs_raw)
                if item.status == "succeeded"
                and item.primary_metric == "validation_net_sharpe"
            ),
            None,
        )
    if portfolio_candidate is not None:
        try:
            portfolio_explorer = load_portfolio_diagnostics(
                project,
                portfolio_candidate.id,
                point_limit=DEFAULT_PORTFOLIO_POINTS,
            )
        except AutoQuantValidationError as error:
            diagnostics.extend(
                _diagnostics(
                    f"portfolio-explorer:{portfolio_candidate.id}",
                    error,
                )
            )
    rl_explorer = None
    rl_candidate = current_program_run("rl")
    if research_program_status is None:
        rl_candidate = next(
            (
                item
                for item in reversed(runs_raw)
                if item.status == "succeeded"
                and item.primary_metric == "validation_mean_net_sharpe"
            ),
            None,
        )
    if rl_candidate is not None:
        try:
            rl_explorer = load_rl_diagnostics(
                project,
                rl_candidate.id,
                point_limit=DEFAULT_RL_POINTS,
            )
        except AutoQuantValidationError as error:
            diagnostics.extend(
                _diagnostics(
                    f"rl-explorer:{rl_candidate.id}",
                    error,
                )
            )
    book_risk_explorer = None
    book_risk_candidate = next(
        (
            item
            for item in reversed(runs_raw)
            if item.status == "succeeded"
            and item.primary_metric == "current_component_risk_hhi"
        ),
        None,
    )
    if book_risk_candidate is not None:
        try:
            book_risk_explorer = load_book_risk_diagnostics(
                project,
                book_risk_candidate.id,
                point_limit=DEFAULT_BOOK_RISK_POINTS,
            )
        except AutoQuantValidationError as error:
            diagnostics.extend(
                _diagnostics(
                    f"book-risk-explorer:{book_risk_candidate.id}",
                    error,
                )
            )
    event_study_explorer = None
    event_study_candidate = next(
        (
            item
            for item in reversed(runs_raw)
            if item.status == "succeeded"
            and item.primary_metric == "primary_eligible_event_count"
        ),
        None,
    )
    if event_study_candidate is not None:
        try:
            event_study_explorer = load_event_study_diagnostics(
                project,
                event_study_candidate.id,
            )
        except AutoQuantValidationError as error:
            diagnostics.extend(
                _diagnostics(
                    f"event-study-explorer:{event_study_candidate.id}",
                    error,
                )
            )
    book_path_stress_explorer = None
    book_path_stress_candidate = next(
        (
            item
            for item in reversed(runs_raw)
            if item.status == "succeeded"
            and item.primary_metric == "worst_terminal_book_return"
        ),
        None,
    )
    if book_path_stress_candidate is not None:
        try:
            book_path_stress_explorer = load_book_path_stress_diagnostics(
                project,
                book_path_stress_candidate.id,
            )
        except AutoQuantValidationError as error:
            diagnostics.extend(
                _diagnostics(
                    f"book-path-stress-explorer:{book_path_stress_candidate.id}",
                    error,
                )
            )
    allocation_explorer = None
    allocation_candidate = next(
        (
            item
            for item in reversed(runs_raw)
            if item.status == "succeeded"
            and item.primary_metric
            == "validation_net_sharpe_advantage"
        ),
        None,
    )
    if allocation_candidate is not None:
        try:
            allocation_explorer = load_allocation_diagnostics(
                project,
                allocation_candidate.id,
                points=DEFAULT_ALLOCATION_POINTS,
            )
        except AutoQuantValidationError as error:
            diagnostics.extend(
                _diagnostics(
                    f"allocation-explorer:{allocation_candidate.id}",
                    error,
                )
            )
    run_reports: list[dict[str, Any]] = []
    try:
        run_reports = [item.to_dict() for item in list_run_reports(project)]
    except AutoQuantValidationError as error:
        diagnostics.extend(_diagnostics("run-reports", error))
    reviews: list[dict[str, Any]] = []
    try:
        reviews = [item.to_dict() for item in list_reviews(project)]
    except AutoQuantValidationError as error:
        diagnostics.extend(_diagnostics("reviews", error))
    sessions: list[dict[str, Any]] = []
    for summary in sessions_raw:
        try:
            session = load_session(project, summary.id)
            snapshot = session_snapshot(project, session)
            campaigns = [
                item.to_dict() for item in list_campaigns(project, session)
            ]
            reports = [
                item.to_dict() for item in list_reports(project, session)
            ]
            progress = list_campaign_progress(session)
            decision_matrix = None
            try:
                decision_matrix = load_session_decision_matrix(
                    project,
                    session.manifest["id"],
                    trial_limit=STUDIO_COMPARISON_TRIALS,
                )
            except AutoQuantValidationError as error:
                diagnostics.extend(
                    _diagnostics(
                        f"session-comparison:{session.manifest['id']}",
                        error,
                    )
                )
            authority = snapshot["authority"]
            if not authority["valid"]:
                diagnostics.extend(
                    {
                        "category": "session-authority",
                        **issue,
                    }
                    for issue in authority["issues"]
                )
            sessions.append(
                {
                    "session": snapshot["session"],
                    "worktree": snapshot["worktree"],
                    "candidate": snapshot["candidate"],
                    "delegation": snapshot["delegation"],
                    "selectionIntegrity": snapshot["selectionIntegrity"],
                    "decisionMatrix": decision_matrix,
                    "authority": authority,
                    "experiments": snapshot["experiments"],
                    "campaigns": campaigns,
                    "reports": reports,
                    "progress": progress,
                    "commands": _session_commands(project, session, reports),
                }
            )
        except AutoQuantValidationError as error:
            diagnostics.extend(_diagnostics(f"session:{summary.id}", error))
    verdicts = {"KEEP": 0, "REVERT": 0, "CRASH": 0}
    for item in sessions:
        for experiment in item["experiments"]:
            verdict = experiment["verdict"]
            verdicts[verdict] += 1
    commands: list[dict[str, Any]] = []
    if factor_explorer is not None:
        commands.append(
            _command(
                "run.factor",
                [
                    "aq",
                    "run",
                    "factor",
                    str(project.root_dir),
                    "--run",
                    factor_explorer["run"]["id"],
                    "--json",
                ],
                "read-only",
            )
        )
    if portfolio_explorer is not None:
        commands.append(
            _command(
                "run.portfolio",
                [
                    "aq",
                    "run",
                    "portfolio",
                    str(project.root_dir),
                    "--run",
                    portfolio_explorer["run"]["id"],
                    "--json",
                ],
                "read-only",
            )
        )
    if rl_explorer is not None:
        commands.append(
            _command(
                "run.rl",
                [
                    "aq",
                    "run",
                    "rl",
                    str(project.root_dir),
                    "--run",
                    rl_explorer["run"]["id"],
                    "--json",
                ],
                "read-only",
            )
        )
    if book_risk_explorer is not None:
        commands.append(
            _command(
                "run.book-risk",
                [
                    "aq",
                    "run",
                    "book-risk",
                    str(project.root_dir),
                    "--run",
                    book_risk_explorer["run"]["id"],
                    "--json",
                ],
                "read-only",
            )
        )
    if event_study_explorer is not None:
        commands.append(
            _command(
                "run.event-study",
                [
                    "aq",
                    "run",
                    "event-study",
                    str(project.root_dir),
                    "--run",
                    event_study_explorer["run"]["id"],
                    "--json",
                ],
                "read-only",
            )
        )
    if book_path_stress_explorer is not None:
        commands.append(
            _command(
                "run.book-path-stress",
                [
                    "aq",
                    "run",
                    "book-path-stress",
                    str(project.root_dir),
                    "--run",
                    book_path_stress_explorer["run"]["id"],
                    "--json",
                ],
                "read-only",
            )
        )
    if allocation_explorer is not None:
        commands.append(
            _command(
                "run.allocation",
                [
                    "aq",
                    "run",
                    "allocation",
                    str(project.root_dir),
                    "--run",
                    allocation_explorer["run"]["id"],
                    "--json",
                ],
                "read-only",
            )
        )
    if research_program_status is not None:
        commands.append(
            _command(
                "project.program",
                [
                    "aq",
                    "project",
                    "program",
                    str(project.root_dir),
                    "--json",
                ],
                "read-only",
            )
        )
    if reviews:
        commands.append(
            _command(
                "review.show",
                [
                    "aq",
                    "review",
                    "show",
                    str(project.root_dir),
                    "--review",
                    reviews[-1]["id"],
                    "--json",
                ],
                "read-only",
            )
        )
    if (
        external_holdout is None
        and dossier_status is not None
        and dossier_status["nextAction"] is not None
    ):
        commands.append(dossier_status["nextAction"])
    if (
        external_holdout is not None
        and external_holdout["nextAction"] is not None
    ):
        commands.append(external_holdout["nextAction"])
    return {
        "id": project.manifest.id,
        "name": project.manifest.name,
        "description": project.manifest.description,
        "rootDir": str(project.root_dir),
        "researchProgram": {
            "path": str(program_path),
            "text": program_path.read_text(encoding="utf-8"),
        },
        "researchProgramStatus": research_program_status,
        "agentWorkBrief": agent_work_brief,
        "agentWorkBriefHash": (
            hash_json(agent_work_brief)
            if agent_work_brief is not None
            else None
        ),
        "externalHoldout": external_holdout,
        "dossierStatus": dossier_status,
        "dossiers": dossiers,
        "runReports": run_reports,
        "reviews": reviews,
        "intake": intake,
        "factorExplorer": factor_explorer,
        "portfolioExplorer": portfolio_explorer,
        "rlExplorer": rl_explorer,
        "bookRiskExplorer": book_risk_explorer,
        "eventStudyExplorer": event_study_explorer,
        "bookPathStressExplorer": book_path_stress_explorer,
        "allocationExplorer": allocation_explorer,
        "commands": commands,
        "valid": not diagnostics,
        "diagnostics": diagnostics,
        "counts": {
            "studies": len(studies),
            "runs": len(runs),
            "sessions": len(sessions),
            "activeSessions": sum(
                item["session"]["status"] == "active" for item in sessions
            ),
            "campaigns": sum(len(item["campaigns"]) for item in sessions),
            "runningCampaigns": sum(len(item["progress"]) for item in sessions),
            "delegatedSessions": sum(
                item["delegation"] is not None for item in sessions
            ),
            "reports": len(run_reports) + sum(len(item["reports"]) for item in sessions),
            "reviews": len(reviews),
            "dossiers": len(dossiers),
            "verdicts": verdicts,
        },
        "studies": studies,
        "runs": runs,
        "sessions": sessions,
        "timeline": _timeline(runs, sessions, run_reports, reviews, dossiers),
    }


def _command(command_id: str, argv: list[str], effect: str) -> dict[str, Any]:
    return {
        "id": command_id,
        "argv": argv,
        "display": shlex.join(argv),
        "effect": effect,
    }


def _session_commands(
    project: ProjectContext,
    session,
    reports: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    commands = [
        _command(
            "session.show",
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
        _command(
            "session.compare",
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
    if (
        session.delegation is not None
        and session.manifest["status"] == "active"
    ):
        commands.append(
            _command(
                "report.publish",
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
    if reports:
        commands.append(
            _command(
                "report.show",
                [
                    "aq",
                    "report",
                    "show",
                    str(project.root_dir),
                    "--session",
                    session.manifest["id"],
                    "--report",
                    reports[-1]["id"],
                    "--json",
                ],
                "read-only",
            )
        )
        if (
            session.manifest["status"] == "active"
            and session.manifest["leader"] == session.manifest["baseline"]
            and reports[-1]["leaderRunId"]
            == session.manifest["leader"]["runId"]
        ):
            commands.append(
                _command(
                    "session.complete",
                    [
                        "aq",
                        "session",
                        "complete",
                        str(project.root_dir),
                        "--session",
                        session.manifest["id"],
                        "--report",
                        reports[-1]["id"],
                        "--json",
                    ],
                    "creates-artifact",
                )
            )
    return commands


def build_studio_snapshot(
    directory: str | Path,
    *,
    project_id: str | None = None,
) -> dict[str, Any]:
    scope, root, workspace, projects, diagnostics = _resolve_source(
        directory,
        project_id,
    )
    observations = [_project_snapshot(project) for project in projects]
    harness = harness_identity()
    return {
        "schemaVersion": SCHEMA_VERSION,
        "kind": STUDIO_KIND,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "harness": harness,
        "source": {
            "scope": scope,
            "rootDir": str(root),
            "workspace": workspace,
        },
        "valid": not diagnostics and all(
            project["valid"] for project in observations
        ),
        "diagnostics": diagnostics,
        "projects": observations,
    }


def _asset_bytes(name: str) -> bytes:
    return files("autoquant").joinpath("studio_assets", name).read_bytes()


def _error_payload(error: Exception) -> tuple[int, dict[str, Any]]:
    if isinstance(error, AutoQuantValidationError):
        return (
            HTTPStatus.UNPROCESSABLE_ENTITY,
            {
                "schemaVersion": SCHEMA_VERSION,
                "ok": False,
                "error": {
                    "code": "validation.failed",
                    "message": str(error),
                    "issues": [issue.to_dict() for issue in error.issues],
                },
            },
        )
    return (
        HTTPStatus.INTERNAL_SERVER_ERROR,
        {
            "schemaVersion": SCHEMA_VERSION,
            "ok": False,
            "error": {
                "code": "studio.failed",
                "message": str(error),
                "issues": [],
            },
        },
    )


def _handler(
    directory: Path,
    project_id: str | None,
    *,
    managed: bool,
) -> type[BaseHTTPRequestHandler]:
    class StudioHandler(BaseHTTPRequestHandler):
        server_version = "AutoQuantStudio/0.1"

        def _headers(
            self,
            status: int,
            content_type: str,
            length: int,
            *,
            cache_control: str = "no-store",
        ) -> None:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(length))
            self.send_header("Cache-Control", cache_control)
            for key, value in studio_security_headers(managed=managed).items():
                self.send_header(key, value)
            self.end_headers()

        def _send(
            self,
            status: int,
            content_type: str,
            body: bytes,
            *,
            cache_control: str = "no-store",
            head_only: bool = False,
        ) -> None:
            self._headers(
                status,
                content_type,
                len(body),
                cache_control=cache_control,
            )
            if not head_only:
                self.wfile.write(body)

        def _route(self, *, head_only: bool = False) -> None:
            path = urlsplit(self.path).path
            try:
                if path == "/api/v1/health":
                    body = json.dumps(
                        {
                            "schemaVersion": SCHEMA_VERSION,
                            "ok": True,
                            "service": "autoquant-studio",
                            "mode": "read-only",
                        },
                        separators=(",", ":"),
                    ).encode()
                    self._send(
                        HTTPStatus.OK,
                        "application/json; charset=utf-8",
                        body,
                        head_only=head_only,
                    )
                    return
                if path == "/api/v1/snapshot":
                    body = json.dumps(
                        build_studio_snapshot(
                            directory,
                            project_id=project_id,
                        ),
                        ensure_ascii=False,
                        separators=(",", ":"),
                    ).encode()
                    self._send(
                        HTTPStatus.OK,
                        "application/json; charset=utf-8",
                        body,
                        head_only=head_only,
                    )
                    return
                asset = STUDIO_ASSETS.get(path)
                if asset is not None:
                    name, content_type = asset
                    body = _asset_bytes(name)
                    self._send(
                        HTTPStatus.OK,
                        content_type,
                        body,
                        cache_control="no-cache",
                        head_only=head_only,
                    )
                    return
                self._send(
                    HTTPStatus.NOT_FOUND,
                    "text/plain; charset=utf-8",
                    b"Not found\n",
                    head_only=head_only,
                )
            except (BrokenPipeError, ConnectionResetError):
                return
            except Exception as error:
                status, payload = _error_payload(error)
                body = json.dumps(
                    payload,
                    ensure_ascii=False,
                    separators=(",", ":"),
                ).encode()
                self._send(
                    status,
                    "application/json; charset=utf-8",
                    body,
                    head_only=head_only,
                )

        def do_GET(self) -> None:
            self._route()

        def do_HEAD(self) -> None:
            self._route(head_only=True)

        def _read_only(self) -> None:
            self._send(
                HTTPStatus.METHOD_NOT_ALLOWED,
                "application/json; charset=utf-8",
                b'{"schemaVersion":1,"ok":false,"error":{"code":"studio.read-only","message":"Studio routes are read-only","issues":[]}}',
            )

        def do_POST(self) -> None:
            self._read_only()

        def do_PUT(self) -> None:
            self._read_only()

        def do_PATCH(self) -> None:
            self._read_only()

        def do_DELETE(self) -> None:
            self._read_only()

        def do_OPTIONS(self) -> None:
            self._read_only()

        def log_message(self, format: str, *args: Any) -> None:
            return

    return StudioHandler


class AutoQuantStudioServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def create_studio_server(
    directory: str | Path,
    *,
    project_id: str | None = None,
    host: str = "127.0.0.1",
    port: int = 8765,
    managed: bool = False,
) -> AutoQuantStudioServer:
    if not isinstance(port, int) or isinstance(port, bool) or not 0 <= port <= 65535:
        raise AutoQuantValidationError(
            [_issue(port, "studio.port", "Studio port must be from 0 to 65535")]
        )
    root = Path(directory).expanduser().absolute()
    build_studio_snapshot(root, project_id=project_id)
    return AutoQuantStudioServer(
        (host, port),
        _handler(root, project_id, managed=managed),
    )


def serve_studio(
    directory: str | Path,
    *,
    project_id: str | None = None,
    host: str = "127.0.0.1",
    port: int = 8765,
    open_browser: bool = True,
    managed: bool = False,
) -> None:
    server = create_studio_server(
        directory,
        project_id=project_id,
        host=host,
        port=port,
        managed=managed,
    )
    display_host = "127.0.0.1" if host in {"0.0.0.0", "::"} else host
    url = f"http://{display_host}:{server.server_port}"
    print(f"AutoQuant Studio: {url}", flush=True)
    print("Mode: local read-only observation", flush=True)
    if open_browser:
        threading.Thread(
            target=webbrowser.open,
            args=(url,),
            daemon=True,
        ).start()
    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


STUDIO_SNAPSHOT_JSON_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "AutoQuant Studio snapshot",
    "type": "object",
    "additionalProperties": False,
    "required": [
        "schemaVersion",
        "kind",
        "generatedAt",
        "harness",
        "source",
        "valid",
        "diagnostics",
        "projects",
    ],
    "properties": {
        "schemaVersion": {"const": SCHEMA_VERSION},
        "kind": {"const": STUDIO_KIND},
        "generatedAt": {"type": "string", "minLength": 1},
        "harness": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "id",
                "version",
                "commit",
                "dirty",
                "sourceHash",
                "python",
                "buildProvenance",
            ],
            "properties": {
                "id": {"type": "string", "minLength": 1},
                "version": {"type": "string", "minLength": 1},
                "commit": {"type": "string", "minLength": 1},
                "dirty": {"type": "boolean"},
                "sourceHash": {
                    "type": "string",
                    "pattern": "^[0-9a-f]{64}$",
                },
                "python": {"type": "string", "minLength": 1},
                "buildProvenance": {
                    "enum": [
                        "embedded-distribution",
                        "source-checkout",
                        "unavailable",
                    ]
                },
            },
        },
        "source": {
            "type": "object",
            "additionalProperties": False,
            "required": ["scope", "rootDir", "workspace"],
            "properties": {
                "scope": {"enum": ["workspace", "project"]},
                "rootDir": {"type": "string", "minLength": 1},
                "workspace": {"type": ["object", "null"]},
            },
        },
        "valid": {"type": "boolean"},
        "diagnostics": {
            "type": "array",
            "items": {"$ref": "#/$defs/diagnostic"},
        },
        "projects": {
            "type": "array",
            "items": {"$ref": "#/$defs/project"},
        },
    },
    "$defs": {
        "diagnostic": {
            "type": "object",
            "additionalProperties": False,
            "required": ["category", "path", "code", "message"],
            "properties": {
                "category": {"type": "string", "minLength": 1},
                "path": {"type": "string", "minLength": 1},
                "code": {"type": "string", "minLength": 1},
                "message": {"type": "string", "minLength": 1},
            },
        },
        "project": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "id",
                "name",
                "description",
                "rootDir",
                "researchProgram",
                "researchProgramStatus",
                "agentWorkBrief",
                "agentWorkBriefHash",
                "externalHoldout",
                "dossierStatus",
                "dossiers",
                "runReports",
                "reviews",
                "intake",
                "factorExplorer",
                "portfolioExplorer",
                "rlExplorer",
                "bookRiskExplorer",
                "eventStudyExplorer",
                "bookPathStressExplorer",
                "allocationExplorer",
                "commands",
                "valid",
                "diagnostics",
                "counts",
                "studies",
                "runs",
                "sessions",
                "timeline",
            ],
            "properties": {
                "id": {"type": "string", "minLength": 1},
                "name": {"type": "string", "minLength": 1},
                "description": {"type": "string"},
                "rootDir": {"type": "string", "minLength": 1},
                "researchProgram": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["path", "text"],
                    "properties": {
                        "path": {"type": "string", "minLength": 1},
                        "text": {"type": "string"},
                    },
                },
                "researchProgramStatus": {"type": ["object", "null"]},
                "agentWorkBrief": {"type": ["object", "null"]},
                "agentWorkBriefHash": {
                    "type": ["string", "null"],
                    "pattern": "^[0-9a-f]{64}$",
                },
                "externalHoldout": {"type": ["object", "null"]},
                "dossierStatus": {"type": ["object", "null"]},
                "dossiers": {"type": "array"},
                "runReports": {"type": "array"},
                "reviews": {"type": "array"},
                "intake": {"type": ["object", "null"]},
                "factorExplorer": {"type": ["object", "null"]},
                "portfolioExplorer": {"type": ["object", "null"]},
                "rlExplorer": {"type": ["object", "null"]},
                "bookRiskExplorer": {"type": ["object", "null"]},
                "eventStudyExplorer": {"type": ["object", "null"]},
                "bookPathStressExplorer": {"type": ["object", "null"]},
                "allocationExplorer": {"type": ["object", "null"]},
                "commands": {
                    "type": "array",
                    "items": {"type": "object"},
                },
                "valid": {"type": "boolean"},
                "diagnostics": {
                    "type": "array",
                    "items": {"$ref": "#/$defs/diagnostic"},
                },
                "counts": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": [
                        "studies",
                        "runs",
                        "sessions",
                        "activeSessions",
                        "campaigns",
                        "runningCampaigns",
                        "delegatedSessions",
                        "reports",
                        "reviews",
                        "dossiers",
                        "verdicts",
                    ],
                    "properties": {
                        "studies": {"type": "integer", "minimum": 0},
                        "runs": {"type": "integer", "minimum": 0},
                        "sessions": {"type": "integer", "minimum": 0},
                        "activeSessions": {"type": "integer", "minimum": 0},
                        "campaigns": {"type": "integer", "minimum": 0},
                        "runningCampaigns": {"type": "integer", "minimum": 0},
                        "delegatedSessions": {"type": "integer", "minimum": 0},
                        "reports": {"type": "integer", "minimum": 0},
                        "reviews": {"type": "integer", "minimum": 0},
                        "dossiers": {"type": "integer", "minimum": 0},
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
                    },
                },
                "studies": {"type": "array"},
                "runs": {"type": "array"},
                "sessions": {"type": "array"},
                "timeline": {"type": "array"},
            },
        },
    },
}
