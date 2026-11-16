"""Compact verified work contracts for AI research operators."""

from __future__ import annotations

import json
import re
import shlex
from datetime import datetime
from pathlib import Path
from typing import Any

from .allocation_explorer import (
    CONSTRUCTION_FIDELITY_JSON_SCHEMA,
    load_allocation_diagnostics,
)
from .briefs import load_research_request
from .candidate_contracts import (
    FACTOR_CANDIDATE_CONTRACT_JSON_SCHEMA,
    build_candidate_contract,
)
from .checks import candidate_check_state, list_candidate_checks
from .dossiers import load_dossier_status
from .factor_explorer import load_factor_diagnostics
from .intake import load_project_intake
from .holdouts import HOLDOUT_STATUS_JSON_SCHEMA, load_holdout_status
from .research_agenda import (
    RESEARCH_AGENDA_JSON_SCHEMA,
    build_research_agenda,
    descriptive_audit_agenda,
    failed_run_research_agenda,
    waiting_research_agenda,
)
from .research_program import load_research_program
from .reports import list_reports
from .run_reports import list_run_reports
from .runs import list_runs, load_run, run_failure_disposition
from .sessions import (
    list_experiments,
    list_sessions,
    load_experiment,
    load_session,
    load_session_completion,
    load_session_promotion,
    session_snapshot,
)
from .studies import StudySummary, hash_json, list_studies, load_study
from .workspace import SCHEMA_VERSION, ProjectContext


AGENT_WORK_BRIEF_KIND = "autoquant-agent-work-brief"
AGENT_WORK_BRIEF_METHOD = "verified-project-agent-orientation-v13"
FACTOR_SPLIT_CONTRAST_METHOD = "primary-factor-train-validation-visibility-v1"
FACTOR_SPLIT_CONTRAST_THRESHOLD = 0.20
MAX_RESEARCH_QUESTION_CHARS = 4_000
PROTECTED_CATEGORIES = [
    "request",
    "dataset",
    "study",
    "program",
    "judge",
    "mandate",
    "dependencies",
    "upstream-evidence",
    "runs",
    "experiments",
    "reports",
    "dossiers",
]
EXPECTED_EVIDENCE = {
    "run.execute": "immutable-run",
    "run.show": "immutable-run",
    "session.start": "research-session",
    "session.show": "session-observation",
    "session.check": "candidate-check",
    "experiment.evaluate": "immutable-experiment",
    "session.promote": "promotion-receipt",
    "session.complete": "completion-receipt",
    "report.publish": "immutable-report",
    "report.draft": "mutable-report-analysis-draft",
    "report.show": "immutable-report",
    "dossier.publish": "immutable-dossier",
    "dossier.show": "immutable-dossier",
    "dossier.status": "dossier-status",
    "holdout.run": "immutable-holdout-result",
    "holdout.assess": "immutable-holdout-assessment",
    "holdout.show": "holdout-evidence",
    "study.inspect": "study-authority",
    "run.book-risk": "book-risk-diagnostics",
    "run.event-study": "event-study-diagnostics",
    "run.book-path-stress": "book-path-stress-diagnostics",
    "run.allocation": "allocation-diagnostics",
    "validate": "structural-validation",
}


def _report_lineage_projection(
    report: dict[str, Any] | None,
) -> dict[str, Any] | None:
    if not isinstance(report, dict) or "current" not in report:
        return None
    correction = report.get("correction")
    return {
        "current": report["current"],
        "correctsReportId": (
            correction["corrects"]["reportId"]
            if isinstance(correction, dict)
            else None
        ),
        "governingReviewId": (
            correction["governingReview"]["id"]
            if isinstance(correction, dict)
            else None
        ),
        "reason": correction["reason"] if isinstance(correction, dict) else None,
        "supersededBy": report.get("supersededBy"),
        "lineageDepth": report.get("lineageDepth"),
    }


_MARKDOWN_HEADING = re.compile(r"^(#{1,6})[ \t]+(.+?)[ \t]*$")
_MARKDOWN_FENCE = re.compile(r"^[ \t]*(`{3,}|~{3,})")


def _normalized_heading(value: str) -> str:
    plain = value.rstrip("#").strip()
    plain = re.sub(r"[*_`~]+", "", plain)
    return re.sub(r"[\s_-]+", " ", plain).strip().casefold()


def _bounded_research_question(value: str) -> str:
    if len(value) <= MAX_RESEARCH_QUESTION_CHARS:
        return value
    prefix = value[: MAX_RESEARCH_QUESTION_CHARS - 1]
    boundary = prefix.rfind(" ")
    if boundary >= MAX_RESEARCH_QUESTION_CHARS // 2:
        prefix = prefix[:boundary]
    return prefix.rstrip() + "…"


def _research_brief_question(project: ProjectContext) -> tuple[str, Path] | None:
    """Read one explicitly headed question without imposing a Markdown schema."""

    path = project.root_dir / project.manifest.research_program
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeError):
        return None

    headings: list[tuple[int, int, str]] = []
    fence_character: str | None = None
    for index, line in enumerate(lines):
        fence = _MARKDOWN_FENCE.match(line)
        if fence is not None:
            character = fence.group(1)[0]
            if fence_character is None:
                fence_character = character
            elif fence_character == character:
                fence_character = None
            continue
        if fence_character is not None:
            continue
        heading = _MARKDOWN_HEADING.match(line)
        if heading is None:
            continue
        headings.append(
            (
                index,
                len(heading.group(1)),
                _normalized_heading(heading.group(2)),
            )
        )

    for position, (index, level, heading) in enumerate(headings):
        if not (
            heading == "fixed question"
            or heading == "question"
            or heading.startswith("question ")
            or heading == "research question"
            or heading.startswith("research question ")
        ):
            continue
        end = len(lines)
        for next_index, next_level, _ in headings[position + 1 :]:
            if next_level <= level:
                end = next_index
                break
        text = "\n".join(lines[index + 1 : end]).strip()
        if text:
            return _bounded_research_question(text), path
    return None


def _project_request(
    project: ProjectContext,
    studies: list[StudySummary],
) -> tuple[dict[str, Any], Path] | None:
    """Load a strict request only when current fixed authority binds its hash."""

    path = project.root_dir / "request.json"
    if not path.is_file() or path.is_symlink():
        return None
    try:
        request = load_research_request(path)
    except (OSError, UnicodeError, ValueError):
        return None
    request_hash = hash_json(request)
    for summary in studies:
        study = load_study(project, summary.id)
        dependencies = study.definition.dependencies
        if dependencies is None:
            continue
        for relative in dependencies["paths"]:
            dependency_path = project.root_dir / relative
            try:
                value = json.loads(dependency_path.read_text(encoding="utf-8"))
            except (OSError, UnicodeError, json.JSONDecodeError):
                continue
            if (
                isinstance(value, dict)
                and isinstance(value.get("source"), dict)
                and value["source"].get("requestHash") == request_hash
            ):
                return request, path
    return None


def _question_projection(
    project: ProjectContext,
    intake: dict[str, Any] | None,
    studies: list[StudySummary],
    focus_study=None,
) -> dict[str, Any]:
    if (
        focus_study is not None
        and focus_study.definition.research_request is not None
    ):
        relative = focus_study.definition.research_request.path
        path = project.root_dir / relative
        request = load_research_request(path)
        return {
            "title": request["title"],
            "text": request["question"],
            "origin": "study-request",
            "sourcePath": str(path),
            "requestPath": str(path),
        }
    if intake is not None:
        request = intake["request"]
        return {
            "title": request["title"],
            "text": request["question"],
            "origin": "delegated-request",
            "sourcePath": str(
                project.root_dir / intake["manifest"]["requestPath"]
            ),
            "requestPath": str(
                project.root_dir / intake["manifest"]["requestPath"]
            ),
        }

    bound_request = _project_request(project, studies)
    if bound_request is not None:
        request, path = bound_request
        return {
            "title": request["title"],
            "text": request["question"],
            "origin": "project-request",
            "sourcePath": str(path),
            "requestPath": str(path),
        }

    maintained = _research_brief_question(project)
    if maintained is not None:
        text, path = maintained
        return {
            "title": project.manifest.name,
            "text": text,
            "origin": "project-research-brief",
            "sourcePath": str(path),
            "requestPath": None,
        }

    return {
        "title": project.manifest.name,
        "text": project.manifest.description,
        "origin": "local",
        "sourcePath": None,
        "requestPath": None,
    }


def _factor_split_contrast(
    project: ProjectContext,
    run_id: str | None,
    study: Any | None,
) -> dict[str, Any] | None:
    """Expose a material primary train/validation contrast without gating it."""

    if (
        run_id is None
        or study is None
        or study.definition.objective.metric != "validation_mean_ic"
    ):
        return None
    run = load_run(project, run_id)
    if run.result["status"] != "succeeded":
        return None
    diagnostics = load_factor_diagnostics(project, run_id, point_limit=40)
    primary = diagnostics["researchHorizon"]["primaryForwardBars"]
    horizon = next(
        item
        for item in diagnostics["horizonProfile"]
        if item["horizon"] == primary
    )
    train = horizon["train"]["meanRankIc"]
    validation = horizon["validation"]["meanRankIc"]
    if train is None or validation is None:
        return None
    signed_gap = float(validation - train)
    absolute_gap = abs(signed_gap)
    if absolute_gap + 1e-12 < FACTOR_SPLIT_CONTRAST_THRESHOLD:
        return None
    return {
        "method": FACTOR_SPLIT_CONTRAST_METHOD,
        "status": "material-divergence",
        "runId": run_id,
        "metric": "primary-horizon-mean-rank-ic",
        "primaryForwardBars": primary,
        "trainMeanRankIc": float(train),
        "validationMeanRankIc": float(validation),
        "validationMinusTrain": signed_gap,
        "absoluteGap": absolute_gap,
        "visibilityThreshold": FACTOR_SPLIT_CONTRAST_THRESHOLD,
        "selectionSplit": "validation",
        "testEntersContrast": False,
        "authority": "orientation-only-no-gate",
        "message": (
            "Primary-horizon train and validation mean rank IC materially "
            "diverge. Inspect stability and use external evidence before "
            "generalizing; validation remains the sole selection split."
        ),
    }


def _action(
    value: dict[str, Any],
    *,
    working_directory: Path,
) -> dict[str, Any]:
    argv = [str(item) for item in value["argv"]]
    return {
        "id": value["id"],
        "description": value["description"],
        "argv": argv,
        "display": value.get("display") or shlex.join(argv),
        "effect": value["effect"],
        "workingDirectory": str(working_directory),
        "expectedEvidenceKind": EXPECTED_EVIDENCE.get(
            value["id"],
            "operation-result",
        ),
    }


def _command(
    command_id: str,
    description: str,
    argv: list[str],
    effect: str,
) -> dict[str, Any]:
    return {
        "id": command_id,
        "description": description,
        "argv": argv,
        "effect": effect,
    }


def _report_draft_action(
    publish_action: dict[str, Any] | None,
    *,
    working_directory: Path,
) -> dict[str, Any] | None:
    """Derive the optional safe authoring scaffold from an exact publish action."""

    if publish_action is None or publish_action.get("id") != "report.publish":
        return None
    argv = list(publish_action["argv"])
    if len(argv) < 4 or argv[:3] != ["aq", "report", "publish"]:
        return None
    if "--analysis" not in argv or "--corrects" in argv:
        return None
    analysis_index = argv.index("--analysis")
    draft_argv = argv[:analysis_index]
    draft_argv[2] = "draft"
    draft_argv.extend(["--output", "report-analysis.json", "--json"])
    return _action(
        _command(
            "report.draft",
            "Optionally materialize a schema-valid draft with the exact current Run and artifact references before authoring the Report.",
            draft_argv,
            "creates-artifact",
        ),
        working_directory=working_directory,
    )


def _session_actions(
    project: ProjectContext,
    session: Any,
    *,
    current_report: dict[str, Any] | None,
) -> tuple[
    dict[str, Any] | None,
    list[dict[str, Any]],
    list[dict[str, str]],
    dict[str, Any],
]:
    manifest = session.manifest
    check_state = candidate_check_state(project, session)
    experiments = list_experiments(project, session)
    promotion: dict[str, Any] | None = None
    if manifest["leader"]["runId"] != manifest["baseline"]["runId"]:
        if session.delegation is None or current_report is not None:
            promotion_argv = [
                "aq",
                "session",
                "promote",
                str(project.root_dir),
                "--session",
                manifest["id"],
            ]
            if current_report is not None:
                promotion_argv.extend(["--report", current_report["id"]])
            promotion_argv.append("--json")
            promotion = _command(
                "session.promote",
                (
                    "Promote the exact current KEEP with its immutable Report "
                    "after review and terminally close this Session as "
                    "promoted; source preservation does not assert scientific "
                    "qualification."
                    if current_report is not None
                    else (
                        "Promote the exact current KEEP after review to "
                        "preserve the source and terminally close this Session "
                        "as promoted; promotion is not scientific qualification."
                    )
                ),
                promotion_argv,
                "mutates-project",
            )
        if not check_state["candidateChanged"]:
            if promotion is not None:
                return (
                    promotion,
                    [],
                    [
                        {
                            "code": "promotion-ready",
                            "category": "authority",
                            "message": (
                                "The Session worktree matches its non-baseline "
                                "KEEP leader and is ready for guarded promotion, "
                                "which terminally closes this Session."
                            ),
                        }
                    ],
                    check_state,
                )
            return (
                None,
                [],
                [
                    {
                        "code": "report-required",
                        "category": "evidence",
                        "message": (
                            "The delegated KEEP leader requires an exact "
                            "current Research Report before guarded promotion."
                        ),
                    }
                ],
                check_state,
            )
    if (
        current_report is not None
        and manifest["leader"] == manifest["baseline"]
        and not check_state["candidateChanged"]
    ):
        completion = _command(
            "session.complete",
            "Complete baseline-retaining research with the exact current Report.",
            [
                "aq",
                "session",
                "complete",
                str(project.root_dir),
                "--session",
                manifest["id"],
                "--report",
                current_report["id"],
                "--json",
            ],
            "creates-artifact",
        )
        return (
            completion,
            [
                _command(
                    "session.show",
                    "Inspect the complete Session trial and Report history.",
                    [
                        "aq",
                        "session",
                        "show",
                        str(project.root_dir),
                        "--session",
                        manifest["id"],
                        "--json",
                    ],
                    "read-only",
                )
            ],
            [
                {
                    "code": "baseline-completion-ready",
                    "category": "evidence",
                    "message": (
                        "The current Report freezes the unchanged baseline and "
                        "complete evidence prefix."
                    ),
                }
            ],
            check_state,
        )
    evaluation = _command(
        "experiment.evaluate",
        "Evaluate this exact candidate with the fixed formal Judge.",
        [
            "aq",
            "experiment",
            "evaluate",
            str(project.root_dir),
            "--session",
            manifest["id"],
            "--hypothesis",
            "Describe the candidate change",
            "--json",
        ],
        "creates-artifact",
    )
    supporting: list[dict[str, Any]] = []
    if not check_state["supported"]:
        primary: dict[str, Any] | None = evaluation
        reasons = [
            {
                "code": "session-active",
                "category": "coordination",
                "message": (
                    "A governed Session owns candidate edits in its disposable "
                    "worktree."
                ),
            }
        ]
    elif not check_state["candidateChanged"] and experiments:
        primary = None
        supporting = [
            _command(
                "session.show",
                "Inspect the latest immutable trial before choosing whether to stop or continue.",
                [
                    "aq",
                    "session",
                    "show",
                    str(project.root_dir),
                    "--session",
                    manifest["id"],
                    "--json",
                ],
                "read-only",
            )
        ]
        if session.delegation is not None:
            supporting.append(
                _command(
                    "report.publish",
                    "Publish strict analysis over the current verified Session evidence.",
                    [
                        "aq",
                        "report",
                        "publish",
                        str(project.root_dir),
                        "--session",
                        manifest["id"],
                        "--analysis",
                        "report-analysis.json",
                        "--json",
                    ],
                    "creates-artifact",
                )
            )
        reasons = [
            {
                "code": "trial-review-required",
                "category": "evidence",
                "message": (
                    "The latest immutable trial restored the current leader. "
                    "Review and report this evidence, or explicitly declare "
                    "another bounded hypothesis; continuation is not required."
                ),
            }
        ]
    elif not check_state["candidateChanged"]:
        primary = None
        reasons = [
            {
                "code": "candidate-edit-required",
                "category": "coordination",
                "message": (
                    "Edit one declared candidate hypothesis in the Session "
                    "worktree before producing evaluation evidence."
                ),
            }
        ]
    elif check_state["current"] is None:
        primary = _command(
            "session.check",
            "Run the fixed bounded preflight for this exact candidate.",
            [
                "aq",
                "session",
                "check",
                str(project.root_dir),
                "--session",
                manifest["id"],
                "--json",
            ],
            "creates-artifact",
        )
        reasons = [
            {
                "code": "candidate-check-required",
                "category": "evidence",
                "message": (
                    "The changed candidate has no current bounded preflight "
                    "evidence."
                ),
            }
        ]
    elif check_state["current"]["status"] == "failed":
        primary = None
        reasons = [
            {
                "code": "candidate-check-failed",
                "category": "evidence",
                "message": (
                    "The exact candidate failed bounded preflight; edit it "
                    "before spending a formal Judge Run."
                ),
            }
        ]
    else:
        primary = evaluation
        reasons = [
            {
                "code": "candidate-check-passed",
                "category": "evidence",
                "message": (
                    "The exact candidate passed bounded preflight and is ready "
                    "for formal selection evidence."
                ),
            }
        ]
    if promotion is not None:
        supporting.append(promotion)
        reasons.append(
            {
                "code": "promotion-ready",
                "category": "authority",
                "message": (
                    "The Session leader improves on baseline and is eligible "
                    "for guarded promotion, which terminally closes this "
                    "Session."
                ),
            }
        )
    return primary, supporting, reasons, check_state


def _orientation_candidate_check(
    check_state: dict[str, Any],
    reasons: list[dict[str, str]],
) -> dict[str, Any] | None:
    """Keep an accepted candidate's exact Check visible through handoff."""

    if reasons and reasons[0]["code"] in {
        "promotion-ready",
        "report-required",
    }:
        return check_state.get("exactCandidate")
    return check_state.get("current")


def _latest_experiment_projection(
    project: ProjectContext,
    session: Any,
) -> dict[str, Any] | None:
    """Link the latest immutable trial to its preceding candidate Check."""

    experiments = list_experiments(project, session)
    if not experiments:
        return None
    latest = load_experiment(
        project,
        session,
        experiments[-1].id,
    ).result
    started_at = datetime.fromisoformat(
        latest["startedAt"].replace("Z", "+00:00")
    )
    matching_check = None
    for check in reversed(
        list_candidate_checks(project, session.manifest["id"])
    ):
        completed_at = datetime.fromisoformat(
            check.completed_at.replace("Z", "+00:00")
        )
        if (
            check.candidate_source_hash
            == latest["candidate"]["sourceHash"]
            and completed_at <= started_at
        ):
            matching_check = {
                "id": check.id,
                "status": check.status,
            }
            break
    return {
        "id": latest["id"],
        "verdict": latest["verdict"],
        "runId": latest["candidate"]["runId"],
        "candidateSourceHash": latest["candidate"]["sourceHash"],
        "completedAt": latest["completedAt"],
        "verdictAuthority": "session-objective-only",
        "candidateCheck": matching_check,
    }


def _program_orientation(
    project: ProjectContext,
    program: dict[str, Any],
) -> dict[str, Any]:
    progression = program["progression"]
    reasons: list[dict[str, str]] = []
    primary_raw: dict[str, Any] | None = None
    supporting_raw: list[dict[str, Any]] = []
    focus_lane = next(
        (
            lane
            for lane in program["lanes"]
            if lane["id"] == program["recommendedLaneId"]
        ),
        None,
    )
    if focus_lane is None and progression["focusLaneId"] is not None:
        focus_lane = next(
            lane
            for lane in program["lanes"]
            if lane["id"] == progression["focusLaneId"]
        )
    if focus_lane is None:
        focus_lane = program["lanes"][0]

    session = None
    check_state: dict[str, Any] = {"current": None}
    session_authority_valid = True
    session_summary = focus_lane["latestSession"]
    if (
        session_summary is not None
        and session_summary["status"] == "active"
    ):
        session = load_session(project, session_summary["id"])

    dossier_status = load_dossier_status(project, optional=True)
    current_dossier = (
        dossier_status.get("latestDossier")
        if dossier_status is not None
        and isinstance(dossier_status.get("latestDossier"), dict)
        and dossier_status["latestDossier"].get("current") is True
        else None
    )

    if current_dossier is not None:
        reasons.append(
            {
                "code": "required-research-complete",
                "category": "scientific",
                "message": (
                    "The current immutable Research Dossier already freezes "
                    "the verified evidence required for this caller handoff."
                ),
            }
        )
        if dossier_status is not None and dossier_status["nextAction"] is not None:
            supporting_raw.append(dossier_status["nextAction"])
    elif program["conflicts"]:
        reasons.append(
            {
                "code": "shared-source-conflict",
                "category": "coordination",
                "message": (
                    f"{len(program['conflicts'])} active shared-source "
                    "conflict(s) must be reviewed before advancing research."
                ),
            }
        )
        seen_sessions: set[str] = set()
        for conflict in program["conflicts"]:
            for item in conflict["sessions"]:
                session_id = item["sessionId"]
                if session_id in seen_sessions:
                    continue
                seen_sessions.add(session_id)
                supporting_raw.append(
                    _command(
                        "session.show",
                        f"Inspect conflicting {item['laneId']} Session.",
                        [
                            "aq",
                            "session",
                            "show",
                            str(project.root_dir),
                            "--session",
                            session_id,
                            "--json",
                        ],
                        "read-only",
                    )
                )
    elif session is not None:
        session_authority_valid = session_snapshot(
            project,
            session,
        )["authority"]["valid"]
        if not session_authority_valid:
            primary_raw = _command(
                "session.show",
                "Inspect the stale Session authority before any candidate edit.",
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
            )
            reasons = [
                {
                    "code": "current-evidence-stale",
                    "category": "authority",
                    "message": (
                        "The active Session no longer matches fixed Project "
                        "authority and is not writable."
                    ),
                }
            ]
        else:
            current_report = next(
                (
                    report
                    for report in reversed(focus_lane["reports"])
                    if report["leaderRunId"]
                    == session.manifest["leader"]["runId"]
                ),
                None,
            )
            primary_raw, supporting_raw, reasons, check_state = _session_actions(
                project,
                session,
                current_report=current_report,
            )
    elif program["recommendedAction"] is not None:
        primary_raw = program["recommendedAction"]
        if (
            focus_lane["phase"] == "scientific-limit"
            and focus_lane["reports"]
        ):
            supporting_raw.extend(
                command
                for command in focus_lane["commands"]
                if command["id"] in {"report.show", "run.show"}
            )
            primary_raw = None
            code = "scientific-limit-reported"
            message = (
                "The exact fixed lane ended at a reported scientific limit. "
                "It does not qualify downstream research, and unchanged "
                "execution is not another attempt."
            )
            category = "scientific"
        elif primary_raw["id"] == "run.execute":
            code = (
                "current-evidence-stale"
                if focus_lane["phase"] == "stale"
                else "baseline-evidence-missing"
            )
            message = (
                "The selected Study needs immutable evidence matching current "
                "source and fixed inputs."
            )
            category = "evidence"
        elif primary_raw["id"] == "run.show":
            code = "baseline-repair-required"
            message = (
                "The current immutable baseline attempt failed and requires "
                "inspection or repair before any changed Run."
            )
            category = "evidence"
        elif primary_raw["id"] == "session.start":
            blocked_gate = next(
                (
                    gate
                    for gate in progression["gates"]
                    if gate["upstreamLaneId"] == focus_lane["id"]
                    and gate["status"].startswith("blocked")
                ),
                None,
            )
            code = (
                "scientific-gate-blocked"
                if blocked_gate is not None
                else "session-required"
            )
            message = (
                blocked_gate["explanation"]
                if blocked_gate is not None
                else "Current baseline evidence is ready for governed research."
            )
            category = "scientific" if blocked_gate is not None else "coordination"
            if (
                blocked_gate is not None
                and session_summary is not None
                and session_summary["status"] != "active"
            ):
                optional = dict(primary_raw)
                optional["description"] = (
                    "Optionally continue this scientifically blocked lane with "
                    "another governed Session."
                )
                supporting_raw.append(optional)
                primary_raw = None
        elif primary_raw["id"] == "session.complete":
            code = "baseline-completion-ready"
            message = "The current reported baseline can close this research lane."
            category = "evidence"
        elif (
            primary_raw["id"] == "report.publish"
            and focus_lane["phase"] == "scientific-limit"
        ):
            code = "scientific-limit-report-required"
            message = (
                "The current immutable Run establishes a scientific limit. "
                "Publish that bounded conclusion without admitting downstream "
                "research or repeating unchanged inputs."
            )
            category = "scientific"
        else:
            code = "report-required"
            message = primary_raw["description"]
            category = "evidence"
        reasons.append(
            {"code": code, "category": category, "message": message}
        )
    else:
        if (
            dossier_status is not None
            and dossier_status["nextAction"] is not None
        ):
            primary_raw = dossier_status["nextAction"]
        reasons.append(
            {
                "code": "required-research-complete",
                "category": "scientific",
                "message": progression["explanation"],
            }
        )

    operating_root = (
        session.worktree_project.root_dir
        if session is not None
        and not program["conflicts"]
        and session_authority_valid
        else project.root_dir
    )
    writable = (
        session is not None
        and not program["conflicts"]
        and session_authority_valid
    )
    editable_paths = (
        list(session.manifest["editablePaths"]) if writable else []
    )
    declared_editable = list(focus_lane["editablePaths"])
    primary = (
        _action(primary_raw, working_directory=operating_root)
        if primary_raw is not None
        else None
    )
    supporting = [
        _action(item, working_directory=operating_root)
        for item in supporting_raw[:3]
    ]
    run = focus_lane["latestRun"]
    latest_report = (
        focus_lane["reports"][-1] if focus_lane["reports"] else None
    )
    visible_check = _orientation_candidate_check(check_state, reasons)
    if (
        writable
        and reasons[0]["code"]
        in {"candidate-edit-required", "candidate-check-failed"}
    ):
        operating_mode = "edit-and-evaluate"
    elif reasons[0]["code"] in {
        "report-required",
        "scientific-limit-report-required",
    }:
        operating_mode = "publish-evidence"
    elif primary is None or program["conflicts"]:
        operating_mode = "observe"
    else:
        operating_mode = {
            "run.execute": "establish-baseline",
            "session.start": "edit-and-evaluate",
            "session.check": "edit-and-evaluate",
            "experiment.evaluate": "edit-and-evaluate",
            "report.publish": "publish-evidence",
            "dossier.publish": "publish-evidence",
            "session.complete": "complete",
            "session.promote": "promote",
        }.get(primary["id"], "observe")
    review_status = (
        "blocked"
        if program["conflicts"]
        or not session_authority_valid
        or any(reason["code"] == "scientific-gate-blocked" for reason in reasons)
        else "complete"
        if reasons[0]["code"] in {
            "required-research-complete",
            "scientific-limit-reported",
        }
        else "active"
        if session is not None
        else "pending"
    )
    return {
        "focus": {
            "laneId": focus_lane["id"],
            "laneName": focus_lane["name"],
            "studyId": focus_lane["study"]["id"],
            "studyName": focus_lane["study"]["name"],
            "coordinationPhase": (
                "dossier-published"
                if current_dossier is not None
                else focus_lane["phase"]
            ),
            "scientificStage": (
                "required-research-complete"
                if current_dossier is not None
                else progression["stage"]
            ),
            "operatingMode": operating_mode,
        },
        "evidence": {
            "runId": run["id"] if run is not None else None,
            "runStatus": run["status"] if run is not None else None,
            "failureDisposition": (
                run.get("failureDisposition") if run is not None else None
            ),
            "sessionId": (
                session_summary["id"] if session_summary is not None else None
            ),
            "sessionStatus": (
                session_summary["status"]
                if session_summary is not None
                else None
            ),
            "leaderRunId": (
                session_summary["leaderRunId"]
                if session_summary is not None
                else None
            ),
            "reportId": (
                latest_report["id"] if latest_report is not None else None
            ),
            "reportLineage": _report_lineage_projection(latest_report),
            "candidateCheckId": (
                visible_check["id"] if visible_check is not None else None
            ),
            "candidateCheckStatus": (
                visible_check["status"] if visible_check is not None else None
            ),
        },
        "reasons": reasons,
        "filesystem": {
            "operatingRoot": str(operating_root),
            "writable": writable,
            "editablePaths": editable_paths,
            "declaredEditablePaths": declared_editable,
            "protectedCategories": PROTECTED_CATEGORIES,
        },
        "authority": {
            "researchAuthority": progression["authority"],
            "selectionSplit": progression["selectionSplit"],
            "testRole": "visible-audit",
            "testEntersSelection": progression["testEntersProgression"],
            "tradingAuthority": progression["tradingAuthority"],
        },
        "primaryAction": primary,
        "supportingActions": supporting,
        "review": {
            "status": review_status,
            "label": reasons[0]["code"].replace("-", " ").upper(),
            "title": (
                "Resolve shared-source conflicts"
                if program["conflicts"]
                else focus_lane["name"]
                if review_status != "complete"
                else "Required research evidence is complete"
            ),
            "detail": reasons[0]["message"],
            "next": (
                primary["description"]
                if primary is not None
                else (
                    (
                        "Review the latest immutable trial; publish and complete "
                        "the current evidence, or explicitly declare another "
                        "bounded hypothesis."
                    )
                    if reasons[0]["code"] == "trial-review-required"
                    else "Edit one falsifiable candidate hypothesis in the declared worktree closure."
                    if reasons[0]["code"] == "candidate-edit-required"
                    else "Revise the candidate to address the failed bounded preflight."
                    if reasons[0]["code"] == "candidate-check-failed"
                    else (
                        "Prepare and publish an exact current Research Report "
                        "for the KEEP leader before promotion."
                    )
                    if reasons[0]["code"] == "report-required"
                    else "Review the verified evidence and choose any optional follow-up explicitly."
                )
            ),
            "boundary": "validation selects · visible test audits · no trading authority",
        },
    }


def _single_study_orientation(
    project: ProjectContext,
    study_summaries: list[Any],
) -> dict[str, Any]:
    if len(study_summaries) != 1:
        has_studies = bool(study_summaries)
        reason_code = (
            "study-selection-required" if has_studies else "study-required"
        )
        supporting = [
            _action(
                _command(
                    "study.inspect",
                    f"Inspect fixed Study {item.id}.",
                    [
                        "aq",
                        "study",
                        "inspect",
                        str(project.root_dir),
                        "--study",
                        item.id,
                        "--json",
                    ],
                    "read-only",
                ),
                working_directory=project.root_dir,
            )
            for item in study_summaries[:3]
        ]
        return {
            "focus": {
                "laneId": None,
                "laneName": None,
                "studyId": None,
                "studyName": None,
                "coordinationPhase": "not-started",
                "scientificStage": reason_code,
                "operatingMode": "observe",
            },
            "evidence": {
                "runId": None,
                "runStatus": None,
                "failureDisposition": None,
                "sessionId": None,
                "sessionStatus": None,
                "leaderRunId": None,
                "reportId": None,
                "reportLineage": None,
                "candidateCheckId": None,
                "candidateCheckStatus": None,
            },
            "reasons": [
                {
                    "code": reason_code,
                    "category": "coordination",
                    "message": (
                        f"The Project has {len(study_summaries)} fixed Studies "
                        "but no research program selects their order."
                        if has_studies
                        else "The Project has no fixed quantitative Study."
                    ),
                }
            ],
            "filesystem": {
                "operatingRoot": str(project.root_dir),
                "writable": False,
                "editablePaths": [],
                "declaredEditablePaths": [],
                "protectedCategories": PROTECTED_CATEGORIES,
            },
            "authority": {
                "researchAuthority": "study-defined",
                "selectionSplit": "study-defined",
                "testRole": "study-defined",
                "testEntersSelection": False,
                "tradingAuthority": "none",
            },
            "primaryAction": None,
            "supportingActions": supporting,
            "review": {
                "status": "pending",
                "label": reason_code.replace("-", " ").upper(),
                "title": (
                    "Choose or coordinate the fixed Studies"
                    if has_studies
                    else "Define one bounded quantitative Study"
                ),
                "detail": (
                    "Multiple Studies exist without a verified research order."
                    if has_studies
                    else "No fixed Study authority exists yet."
                ),
                "next": (
                    "Inspect the Studies and define explicit coordination before running research."
                    if has_studies
                    else "Create a Study before running or editing candidate research."
                ),
                "boundary": "no selection evidence · no trading authority",
            },
        }

    study_summary = study_summaries[0]
    study = load_study(project, study_summary.id)
    sessions = [
        item
        for item in list_sessions(project)
        if item.study_id == study.definition.id
    ]
    latest_session = sessions[-1] if sessions else None
    latest_session_context = (
        load_session(project, latest_session.id)
        if latest_session is not None
        else None
    )
    active_session = (
        latest_session_context
        if latest_session is not None and latest_session.status == "active"
        else None
    )
    completion = (
        load_session_completion(project, latest_session_context)
        if latest_session_context is not None
        else None
    )
    promotion = (
        load_session_promotion(latest_session_context)
        if latest_session_context is not None
        else None
    )
    current_report = None
    if latest_session_context is not None:
        terminal_report_id = (
            completion["report"]["id"]
            if completion is not None
            else promotion["report"]["id"]
            if promotion is not None
            and isinstance(promotion.get("report"), dict)
            else None
        )
        current_report = next(
            (
                report.to_dict()
                for report in reversed(
                    list_reports(project, latest_session_context)
                )
                if (
                    report.id == terminal_report_id
                    if terminal_report_id is not None
                    else report.leader_run_id
                    == latest_session_context.manifest["leader"]["runId"]
                )
            ),
            None,
        )
    current_attempts = []
    for item in list_runs(project):
        if item.study_id != study.definition.id:
            continue
        run = load_run(project, item.id)
        if run.result["studyInputHash"] == study.input_hash:
            current_attempts.append(item)
    current_attempt = current_attempts[-1] if current_attempts else None
    current_attempt_context = (
        load_run(project, current_attempt.id)
        if current_attempt is not None
        else None
    )
    current_run = (
        current_attempt
        if current_attempt is not None and current_attempt.status == "succeeded"
        else None
    )
    failure_disposition = (
        run_failure_disposition(current_attempt_context.result)
        if current_attempt_context is not None
        else None
    )
    report_anchor_id = (
        current_run.id
        if current_run is not None
        else current_attempt.id
        if current_attempt is not None
        and failure_disposition == "scientific-limit"
        else None
    )
    if (
        report_anchor_id is not None
        and current_report is None
        and latest_session_context is None
    ):
        current_report = next(
            (
                report.to_dict()
                for report in reversed(
                    list_run_reports(project, study.definition.id)
                )
                if report.leader_run_id == report_anchor_id
                and report.current is True
            ),
            None,
        )
    active_authority_valid = (
        session_snapshot(project, active_session)["authority"]["valid"]
        if active_session is not None
        else False
    )
    latest_authority_valid = (
        session_snapshot(project, latest_session_context)["authority"]["valid"]
        if latest_session_context is not None
        else False
    )
    check_state: dict[str, Any] = {"current": None}
    if active_session is not None and active_authority_valid:
        primary_raw, supporting_raw, reasons, check_state = _session_actions(
            project,
            active_session,
            current_report=current_report,
        )
        operating_root = active_session.worktree_project.root_dir
        editable = list(active_session.manifest["editablePaths"])
        mode = (
            "promote"
            if primary_raw is not None
            and primary_raw["id"] == "session.promote"
            else "publish-evidence"
            if reasons[0]["code"] == "report-required"
            else "edit-and-evaluate"
        )
        phase = "researching"
    elif active_session is not None:
        primary_raw = _command(
            "session.show",
            "Inspect the stale Session authority before any candidate edit.",
            [
                "aq",
                "session",
                "show",
                str(project.root_dir),
                "--session",
                active_session.manifest["id"],
                "--json",
            ],
            "read-only",
        )
        supporting_raw = []
        reasons = [
            {
                "code": "current-evidence-stale",
                "category": "authority",
                "message": (
                    "The active Session no longer matches fixed Project "
                    "authority and is not writable."
                ),
            }
        ]
        operating_root = project.root_dir
        editable = []
        mode = "observe"
        phase = "stale"
    elif current_attempt is not None and current_attempt.status == "failed":
        inspect_raw = _command(
            "run.show",
            "Inspect the current failed Run, disposition, and exact errors.",
            [
                "aq",
                "run",
                "show",
                str(project.root_dir),
                "--run",
                current_attempt.id,
                "--json",
            ],
            "read-only",
        )
        if failure_disposition == "scientific-limit":
            if current_report is None:
                primary_raw = _command(
                    "report.publish",
                    "Publish the bounded scientific-limit conclusion over the current immutable Run.",
                    [
                        "aq",
                        "report",
                        "publish",
                        str(project.root_dir),
                        "--study",
                        study.definition.id,
                        "--run",
                        current_attempt.id,
                        "--analysis",
                        "report-analysis.json",
                        "--json",
                    ],
                    "creates-artifact",
                )
                supporting_raw = [inspect_raw]
                reasons = [
                    {
                        "code": "scientific-limit-report-required",
                        "category": "scientific",
                        "message": (
                            "The current immutable Run proves the exact fixed "
                            "Study is scientifically unevaluable. Publish that "
                            "bounded conclusion; do not repeat unchanged inputs."
                        ),
                    }
                ]
                mode = "publish-evidence"
                phase = "scientific-limit"
            else:
                primary_raw = None
                supporting_raw = [
                    _command(
                        "report.show",
                        "Inspect the immutable scientific-limit Research Report.",
                        [
                            "aq",
                            "report",
                            "show",
                            str(project.root_dir),
                            "--report",
                            current_report["id"],
                            "--json",
                        ],
                        "read-only",
                    ),
                    inspect_raw,
                ]
                reasons = [
                    {
                        "code": "scientific-limit-reported",
                        "category": "scientific",
                        "message": (
                            "The exact fixed Study ended at a reported scientific "
                            "limit. A different hypothesis, route, dataset, or "
                            "authority is separate optional work."
                        ),
                    }
                ]
                mode = "observe"
                phase = "evidence-ready"
        else:
            primary_raw = inspect_raw
            supporting_raw = []
            reasons = [
                {
                    "code": "baseline-repair-required",
                    "category": "evidence",
                    "message": (
                        "The current immutable baseline attempt failed and "
                        "requires inspection or repair before another Run. "
                        "Unchanged execution is not new evidence."
                    ),
                }
            ]
            mode = "observe"
            phase = "repair-required"
        operating_root = project.root_dir
        editable = []
    elif current_run is None:
        if study.definition.editable["paths"]:
            start_argv = [
                "aq",
                "session",
                "start",
                str(project.root_dir),
                "--study",
                study.definition.id,
            ]
            start_argv.append("--json")
            primary_raw = _command(
                "session.start",
                "Preflight the first candidate, establish its immutable "
                "baseline, and start governed research.",
                start_argv,
                "creates-artifact",
            )
            mode = "edit-and-evaluate"
        else:
            primary_raw = _command(
                "run.execute",
                "Create current immutable baseline evidence for the Study.",
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
            mode = "establish-baseline"
        supporting_raw = []
        reasons = [
            {
                "code": "baseline-evidence-missing",
                "category": "evidence",
                "message": (
                    "The editable Study needs one preflight-guarded baseline "
                    "inside a governed Session."
                    if study.definition.editable["paths"]
                    else "The Study has no successful Run matching current inputs."
                ),
            }
        ]
        operating_root = project.root_dir
        editable = []
        phase = "not-started"
    elif (
        not study.definition.editable["paths"]
        and current_report is not None
        and current_report.get("anchor", {}).get("kind") == "run"
        and current_report["leaderRunId"] == current_run.id
    ):
        primary_raw = None
        supporting_raw = [
            _command(
                "report.show",
                "Inspect the immutable Run-bound Research Report.",
                [
                    "aq",
                    "report",
                    "show",
                    str(project.root_dir),
                    "--report",
                    current_report["id"],
                    "--json",
                ],
                "read-only",
            )
        ]
        reasons = [
            {
                "code": "frozen-run-reported",
                "category": "evidence",
                "message": (
                    "The current successful Run has an immutable request-bound "
                    "Research Report. This fixed Study declares no editable "
                    "candidate surface or Session authority."
                ),
            }
        ]
        operating_root = project.root_dir
        editable = []
        mode = "observe"
        phase = "evidence-ready"
    elif study.definition.objective.metric in {
        "current_component_risk_hhi",
        "primary_eligible_event_count",
        "validation_net_sharpe_advantage",
        "worst_terminal_book_return",
    } or not study.definition.editable["paths"]:
        event_study = (
            study.definition.objective.metric
            == "primary_eligible_event_count"
        )
        allocation_study = (
            study.definition.objective.metric
            == "validation_net_sharpe_advantage"
        )
        path_stress_study = (
            study.definition.objective.metric
            == "worst_terminal_book_return"
        )
        generic_fixed_study = study.definition.objective.metric not in {
            "current_component_risk_hhi",
            "primary_eligible_event_count",
            "validation_net_sharpe_advantage",
            "worst_terminal_book_return",
        }
        explorer_raw = _command(
            (
                "run.show"
                if generic_fixed_study
                else "run.event-study"
                if event_study
                else "run.book-path-stress"
                if path_stress_study
                else "run.allocation"
                if allocation_study
                else "run.book-risk"
            ),
            (
                "Inspect the current immutable Run and its exact artifacts."
                if generic_fixed_study
                else "Inspect verified event timing, populations, references, "
                "overlap, uncertainty, and no-trading conclusion evidence."
                if event_study
                else (
                    "Inspect verified complete-window ranking, fixed-unit paths, "
                    "non-overlap selection, and exact holding attribution."
                    if path_stress_study
                else (
                    "Inspect verified same-clock allocation/reference, ERC "
                    "solver, risk, implementation, and current target evidence."
                    if allocation_study
                    else (
                        "Inspect verified reported-book crowding, reduction, "
                        "caller-supplied scenarios, and any caller-bounded "
                        "target-position sizing evidence."
                    )
                ))
            ),
            [
                "aq",
                "run",
                (
                    "show"
                    if generic_fixed_study
                    else "event-study"
                    if event_study
                    else "book-path-stress"
                    if path_stress_study
                    else "allocation"
                    if allocation_study
                    else "book-risk"
                ),
                str(project.root_dir),
                "--run",
                current_run.id,
                "--json",
            ],
            "read-only",
        )
        primary_raw = None
        supporting_raw = [explorer_raw]
        reasons = [
            {
                "code": "descriptive-evidence-ready",
                "category": "evidence",
                "message": (
                    "The fixed non-editable Study is complete and ready for "
                    "evidence review."
                    if generic_fixed_study
                    else "The fixed price-event Study is complete and ready for "
                    "historical evidence review."
                    if event_study
                    else (
                        "The fixed reported-book Path Stress Study is complete "
                        "and ready for historical evidence review."
                        if path_stress_study
                    else (
                        "The fixed allocation Study is complete and ready for "
                        "decision-support review."
                        if allocation_study
                        else (
                            "The fixed reported-book audit is complete and ready "
                            "for decision-support review."
                        )
                    ))
                ),
            }
        ]
        operating_root = project.root_dir
        editable = []
        mode = "observe"
        phase = "evidence-ready"
    elif (
        (completion is not None or promotion is not None)
        and latest_session_context is not None
        and latest_authority_valid
        and (
            current_report is not None
            or (
                promotion is not None
                and not isinstance(promotion.get("report"), dict)
            )
        )
        and latest_session_context.manifest["leader"]["runId"]
        == current_run.id
    ):
        primary_raw = None
        supporting_raw = [
            _command(
                "session.show",
                "Inspect the completed Session and its immutable evidence.",
                [
                    "aq",
                    "session",
                    "show",
                    str(project.root_dir),
                    "--session",
                    latest_session_context.manifest["id"],
                    "--json",
                ],
                "read-only",
            ),
            _command(
                "session.start",
                "Optionally continue with another explicitly chosen governed Session.",
                [
                    "aq",
                    "session",
                    "start",
                    str(project.root_dir),
                    "--study",
                    study.definition.id,
                    "--json",
                ],
                "creates-artifact",
            ),
        ]
        reasons = [
            {
                "code": "required-research-complete",
                "category": "scientific",
                "message": (
                    (
                        "The validated completion receipt freezes the current "
                        "baseline-retaining Session and exact immutable Report."
                        if completion is not None
                        else (
                            "The validated promotion receipt terminally closes "
                            "the current Session and preserves its leader"
                            + (
                                " with the exact immutable Report."
                                if current_report is not None
                                else "."
                            )
                        )
                    )
                    + " Further research is optional; terminal Session state "
                    "does not assert scientific qualification."
                ),
            }
        ]
        operating_root = project.root_dir
        editable = []
        mode = "observe"
        phase = "evidence-ready"
    elif (
        current_report is not None
        and current_report.get("anchor", {}).get("kind") == "run"
        and current_report["leaderRunId"] == current_run.id
    ):
        primary_raw = None
        supporting_raw = [
            _command(
                "report.show",
                "Inspect the immutable Run-bound Research Report.",
                [
                    "aq",
                    "report",
                    "show",
                    str(project.root_dir),
                    "--report",
                    current_report["id"],
                    "--json",
                ],
                "read-only",
            ),
            _command(
                "session.start",
                "Optionally begin a separate governed candidate investigation.",
                [
                    "aq",
                    "session",
                    "start",
                    str(project.root_dir),
                    "--study",
                    study.definition.id,
                    "--json",
                ],
                "creates-artifact",
            ),
        ]
        reasons = [
            {
                "code": "frozen-run-reported",
                "category": "evidence",
                "message": (
                    "The current successful Run has an immutable request-bound "
                    "Research Report. No Session, Check, or Experiment was "
                    "created; further candidate research is optional."
                ),
            }
        ]
        operating_root = project.root_dir
        editable = []
        mode = "observe"
        phase = "evidence-ready"
    else:
        primary_raw = _command(
            "session.start",
            "Start a governed Session from the current immutable baseline.",
            [
                "aq",
                "session",
                "start",
                str(project.root_dir),
                "--study",
                study.definition.id,
                "--json",
            ],
            "creates-artifact",
        )
        supporting_raw = []
        reasons = [
            {
                "code": "session-required",
                "category": "coordination",
                "message": "Current baseline evidence is ready for governed research.",
            }
        ]
        operating_root = project.root_dir
        editable = []
        mode = "edit-and-evaluate"
        phase = "baseline-ready"
    primary = (
        _action(primary_raw, working_directory=operating_root)
        if primary_raw is not None
        else None
    )
    visible_check = _orientation_candidate_check(check_state, reasons)
    return {
        "focus": {
            "laneId": None,
            "laneName": None,
            "studyId": study.definition.id,
            "studyName": study.definition.name,
            "coordinationPhase": phase,
            "scientificStage": "study-defined",
            "operatingMode": mode,
        },
        "evidence": {
            "runId": (
                current_attempt.id if current_attempt is not None else None
            ),
            "runStatus": (
                current_attempt.status if current_attempt is not None else None
            ),
            "failureDisposition": failure_disposition,
            "sessionId": (
                latest_session.id if latest_session is not None else None
            ),
            "sessionStatus": (
                latest_session.status if latest_session is not None else None
            ),
            "leaderRunId": (
                latest_session.leader_run_id
                if latest_session is not None
                else (
                    current_report["leaderRunId"]
                    if current_report is not None
                    else None
                )
            ),
            "reportId": (
                current_report["id"] if current_report is not None else None
            ),
            "reportLineage": _report_lineage_projection(current_report),
            "candidateCheckId": (
                visible_check["id"] if visible_check is not None else None
            ),
            "candidateCheckStatus": (
                visible_check["status"] if visible_check is not None else None
            ),
        },
        "reasons": reasons,
        "filesystem": {
            "operatingRoot": str(operating_root),
            "writable": (
                active_session is not None and active_authority_valid
            ),
            "editablePaths": editable,
            "declaredEditablePaths": list(study.definition.editable["paths"]),
            "protectedCategories": PROTECTED_CATEGORIES,
        },
        "authority": {
            "researchAuthority": (
                "fixed-descriptive-audit"
                if study.definition.objective.metric
                in {
                    "current_component_risk_hhi",
                    "primary_eligible_event_count",
                }
                else "study-defined"
            ),
            "selectionSplit": (
                "none"
                if study.definition.objective.metric
                in {
                    "current_component_risk_hhi",
                    "primary_eligible_event_count",
                }
                else "study-defined"
            ),
            "testRole": (
                (
                    "event-population-and-reference-context"
                    if study.definition.objective.metric
                    == "primary_eligible_event_count"
                    else "lookback-and-rolling-context"
                )
                if study.definition.objective.metric
                in {
                    "current_component_risk_hhi",
                    "primary_eligible_event_count",
                }
                else "study-defined"
            ),
            "testEntersSelection": False,
            "tradingAuthority": "none",
        },
        "primaryAction": primary,
        "supportingActions": [
            _action(item, working_directory=operating_root)
            for item in supporting_raw
        ],
        "review": {
            "status": (
                "active"
                if active_session is not None and active_authority_valid
                else "blocked"
                if active_session is not None
                else "complete"
                if reasons[0]["code"]
                in {
                    "descriptive-evidence-ready",
                    "required-research-complete",
                    "frozen-run-reported",
                    "scientific-limit-reported",
                }
                else "pending"
            ),
            "label": reasons[0]["code"].replace("-", " ").upper(),
            "title": study.definition.name,
            "detail": reasons[0]["message"],
            "next": (
                primary["description"]
                if primary is not None
                else (
                    "Write and return the decision-support answer from the "
                    "verified evidence; use the supporting Explorer only when "
                    "more detail is needed."
                )
                if reasons[0]["code"] == "descriptive-evidence-ready"
                else (
                    "Write and return the decision-support answer from the "
                    "completed immutable evidence; open another Session only "
                    "for a deliberately chosen follow-up."
                )
                if reasons[0]["code"] == "required-research-complete"
                else (
                    "Return the reported scientific limit as the answer to "
                    "this exact fixed Study. Any changed hypothesis, route, "
                    "dataset, or authority is separate optional work."
                )
                if reasons[0]["code"] == "scientific-limit-reported"
                else (
                    "Write and return the decision-support answer from the "
                    "immutable Report. This fixed Study has no candidate "
                    "Session surface."
                )
                if reasons[0]["code"] == "frozen-run-reported"
                and not study.definition.editable["paths"]
                else (
                    (
                        (
                            "Review the latest immutable trial; publish and "
                            "complete the current evidence, or explicitly "
                            "declare another bounded hypothesis."
                        )
                        if reasons[0]["code"] == "trial-review-required"
                        else "Edit one falsifiable candidate hypothesis in the declared worktree closure."
                        if reasons[0]["code"] == "candidate-edit-required"
                        else (
                            "Revise the candidate to address the failed bounded preflight."
                            if reasons[0]["code"] == "candidate-check-failed"
                            else (
                                "Prepare and publish an exact current Research "
                                "Report for the KEEP leader before promotion."
                            )
                        )
                    )
                )
            ),
            "boundary": "fixed Study authority · no trading authority",
        },
    }


def _terminal_continuation_study(
    project: ProjectContext,
    summaries: list[StudySummary],
) -> StudySummary | None:
    """Select one terminal single-upstream continuation, never an arbitrary latest Study."""

    if len(summaries) < 2:
        return None
    studies = {item.id: load_study(project, item.id) for item in summaries}
    upstream_by_study = {
        study_id: context.definition.upstream_evidence.study_id
        for study_id, context in studies.items()
        if context.definition.upstream_evidence is not None
    }
    if not upstream_by_study:
        return None
    terminals = set(studies) - set(upstream_by_study.values())
    if len(terminals) != 1:
        return None
    terminal = next(iter(terminals))
    visited: set[str] = set()
    current: str | None = terminal
    while current is not None and current not in visited:
        visited.add(current)
        current = upstream_by_study.get(current)
    if current is not None or visited != set(studies):
        return None
    return next(item for item in summaries if item.id == terminal)


def _holdout_orientation(
    project: ProjectContext,
    holdout: dict[str, Any],
) -> dict[str, Any]:
    result_complete = holdout["state"] in {"completed", "assessed"}
    assessed = holdout["state"] == "assessed"
    action = holdout["nextAction"]
    result = holdout["result"]
    run_id = (
        result["lanes"][-1]["holdout"]["runId"]
        if result is not None and result["lanes"]
        else None
    )
    primary = (
        _action(action, working_directory=project.root_dir)
        if action is not None
        else None
    )
    reason = {
        "code": (
            "external-holdout-complete"
            if assessed
            else "external-holdout-assessment-required"
            if result_complete
            else "external-holdout-bound"
        ),
        "category": "evidence",
        "message": (
            "The frozen result and lane-specific Agent assessment are both "
            "published for durable handoff."
            if assessed
            else "The frozen Runs completed. Review the verified comparative "
            "evidence and publish one lane-specific Agent assessment."
            if result_complete
            else "The exact Dossier leaders are frozen and ready for one "
            "strictly later external-period audit."
        ),
    }
    return {
        "focus": {
            "laneId": "external-holdout",
            "laneName": "Frozen external holdout",
            "studyId": None,
            "studyName": None,
            "coordinationPhase": holdout["state"],
            "scientificStage": reason["code"],
            "operatingMode": (
                "observe"
                if assessed
                else "publish-evidence"
                if result_complete
                else "external-audit"
            ),
        },
        "evidence": {
            "runId": run_id,
            "runStatus": result["status"] if result is not None else None,
            "failureDisposition": (
                run_failure_disposition(result)
                if isinstance(result, dict)
                else None
            ),
            "sessionId": None,
            "sessionStatus": None,
            "leaderRunId": None,
            "reportId": (
                holdout["assessment"]["id"]
                if holdout["assessment"] is not None
                else None
            ),
            "reportLineage": None,
            "candidateCheckId": None,
            "candidateCheckStatus": None,
        },
        "reasons": [reason],
        "filesystem": {
            "operatingRoot": str(project.root_dir),
            "writable": result_complete and not assessed,
            "editablePaths": (
                ["holdout-analysis.json"]
                if result_complete and not assessed
                else []
            ),
            "declaredEditablePaths": (
                ["holdout-analysis.json"]
                if result_complete and not assessed
                else []
            ),
            "protectedCategories": [
                *PROTECTED_CATEGORIES,
                "holdout-binding",
                "imported-sources",
            ],
        },
        "authority": {
            "researchAuthority": "frozen-external-temporal-audit",
            "selectionSplit": "none",
            "testRole": "external-period-audit",
            "testEntersSelection": False,
            "tradingAuthority": "none",
        },
        "primaryAction": primary,
        "supportingActions": (
            [
                _action(
                    {
                        "id": "holdout.show",
                        "description": (
                            "Inspect the verified source-versus-later evidence "
                            "before authoring the Assessment."
                        ),
                        "argv": [
                            "aq",
                            "holdout",
                            "show",
                            str(project.root_dir),
                            "--json",
                        ],
                        "effect": "read-only",
                    },
                    working_directory=project.root_dir,
                )
            ]
            if result_complete and not assessed
            else []
        ),
        "review": {
            "status": "complete" if assessed else "pending",
            "label": reason["code"].replace("-", " ").upper(),
            "title": "Frozen external-period challenge",
            "detail": reason["message"],
            "next": (
                primary["description"]
                if primary is not None
                else "Review the immutable result with the requesting workbench."
            ),
            "boundary": (
                "candidate frozen · no selection · no automatic promotion · "
                "no trading authority"
            ),
        },
    }


def build_agent_work_brief(project: ProjectContext) -> dict[str, Any]:
    """Build one compact orientation contract from verified Project state."""

    intake = load_project_intake(project)
    holdout = load_holdout_status(project, optional=True)
    program = load_research_program(project, optional=True)
    studies = list_studies(project)
    terminal_continuation = (
        _terminal_continuation_study(project, studies)
        if program is None and holdout is None
        else None
    )
    projected = (
        _holdout_orientation(project, holdout)
        if holdout is not None
        else _program_orientation(project, program)
        if program is not None
        else _single_study_orientation(
            project,
            [terminal_continuation]
            if terminal_continuation is not None
            else studies,
        )
    )
    focus_study_id = projected["focus"]["studyId"]
    focus_study = (
        load_study(project, focus_study_id)
        if focus_study_id is not None
        else None
    )
    projected["continuation"] = (
        focus_study.definition.to_dict().get("upstream_evidence")
        if focus_study is not None
        else None
    )
    agenda_run_id = projected["evidence"]["runId"]
    if program is not None:
        agenda_lane = next(
            (
                lane
                for lane in program["lanes"]
                if lane["id"] == projected["focus"]["laneId"]
            ),
            None,
        )
        if agenda_lane is None or not agenda_lane.get("currentAttempt"):
            agenda_run_id = None
    if (
        projected["filesystem"]["writable"]
        and projected["evidence"]["sessionId"] is not None
        and projected["evidence"]["leaderRunId"] is not None
    ):
        agenda_run_id = projected["evidence"]["leaderRunId"]
    descriptive_metric = (
        next(
            (
                item.primary_metric
                for item in studies
                if item.id == projected["focus"]["studyId"]
            ),
            None,
        )
        if projected["focus"]["studyId"] is not None
        else None
    )
    event_descriptive = descriptive_metric == "primary_eligible_event_count"
    allocation_fixed = (
        descriptive_metric == "validation_net_sharpe_advantage"
    )
    path_stress_fixed = descriptive_metric == "worst_terminal_book_return"
    fixed_descriptive = descriptive_metric in {
        "current_component_risk_hhi",
        "primary_eligible_event_count",
        "validation_net_sharpe_advantage",
        "worst_terminal_book_return",
    }
    research_agenda = (
        waiting_research_agenda(
            "external-holdout",
            reason=(
                "Candidate research is frozen in an external-period challenge; "
                "no further selection move is authorized here."
            ),
        )
        if holdout is not None
        else waiting_research_agenda(
            None,
            reason=(
                f"The Project has {len(studies)} independent fixed Studies. "
                "Their evidence remains available, but one Study must be "
                "selected explicitly before AutoQuant can project a current "
                "research agenda."
            ),
        )
        if (
            len(studies) > 1
            and projected["focus"]["scientificStage"]
            == "study-selection-required"
        )
        else failed_run_research_agenda(
            project,
            agenda_run_id,
            lane_id=projected["focus"]["laneId"],
            disposition=projected["evidence"]["failureDisposition"],
        )
        if (
            agenda_run_id is not None
            and projected["evidence"]["failureDisposition"] is not None
        )
        else descriptive_audit_agenda(
            project,
            agenda_run_id,
            lane_id=(
                "event-study"
                if event_descriptive
                else "book-path-stress"
                if path_stress_fixed
                else "allocation"
                if allocation_fixed
                else "book-risk"
            ),
            reason=(
                (
                    "Price-event history is a fixed descriptive audit. Review "
                    "the verified event ledger, references, overlap, and "
                    "uncertainty; do not manufacture a parameter-search or "
                    "execution agenda."
                )
                if event_descriptive
                else (
                    "Reported-book path stress is a fixed descriptive audit. "
                    "Review complete windows, selected paths, and reconciled "
                    "holding attribution; do not manufacture forecasts, "
                    "optimization, account reconstruction, or execution."
                    if path_stress_fixed
                else (
                    "Portfolio-native allocation is a fixed construction "
                    "evaluation. Review the verified candidate/reference, "
                    "solver, risk, and current-target evidence; do not "
                    "manufacture a Factor, RL, or execution agenda."
                    if allocation_fixed
                    else (
                        "Reported-book risk is a fixed descriptive audit. Review "
                        "the verified evidence and any bounded target position; "
                        "do not manufacture an optimization or execution agenda."
                    )
                ))
            ),
            test_role=(
                "event-population-and-reference-context"
                if event_descriptive
                else "historical-path-and-attribution-context"
                if path_stress_fixed
                else "visible-audit-only"
                if allocation_fixed
                else "lookback-and-rolling-context"
            ),
        )
        if fixed_descriptive and agenda_run_id is not None
        else build_research_agenda(
            project,
            agenda_run_id,
            lane_id=projected["focus"]["laneId"],
            editable_paths=projected["filesystem"]["declaredEditablePaths"],
        )
    )
    agenda_moves = research_agenda.get("moves", [])
    agenda_has_editable_target = any(
        isinstance(move, dict)
        and isinstance(move.get("target"), dict)
        and bool(move["target"].get("editablePaths"))
        for move in agenda_moves
    )
    if (
        program is not None
        and research_agenda["status"] == "no-further-in-sample-tuning"
        and not agenda_has_editable_target
        and projected["primaryAction"] is not None
        and projected["primaryAction"]["id"] == "session.start"
        and projected["evidence"]["sessionId"] is None
    ):
        focus_lane = next(
            (
                lane
                for lane in program["lanes"]
                if lane["id"] == projected["focus"]["laneId"]
            ),
            None,
        )
        report_command = (
            next(
                (
                    command
                    for command in focus_lane["commands"]
                    if command["id"] == "report.publish"
                ),
                None,
            )
            if focus_lane is not None
            else None
        )
        if report_command is not None:
            report_action = _action(
                report_command,
                working_directory=project.root_dir,
            )
            message = (
                "The diagnostic agenda freezes the current immutable Run and "
                "has no candidate-edit target; publish its Run-bound Report "
                "without creating a Session."
            )
            projected["primaryAction"] = report_action
            projected["supportingActions"] = []
            projected["reasons"] = [
                {
                    "code": "report-required",
                    "category": "evidence",
                    "message": message,
                }
            ]
            projected["focus"]["operatingMode"] = "publish-evidence"
            projected["review"] = {
                "status": "pending",
                "label": "REPORT REQUIRED",
                "title": projected["focus"]["laneName"],
                "detail": message,
                "next": report_action["description"],
                "boundary": (
                    "validation selects · visible test audits · no trading authority"
                ),
            }
    freeze_session_id = projected["evidence"]["sessionId"]
    freeze_session = (
        load_session(project, freeze_session_id)
        if freeze_session_id is not None
        else None
    )
    freeze_experiments = (
        list_experiments(project, freeze_session)
        if freeze_session is not None
        else []
    )
    if (
        research_agenda["moves"]
        and projected["primaryAction"] is None
        and (
            bool(freeze_experiments)
            or projected["reasons"][0]["code"]
            == "required-research-complete"
        )
    ):
        research_agenda["moveRole"] = "optional-follow-up"
    if (
        research_agenda["status"] == "no-further-in-sample-tuning"
        and projected["reasons"][0]["code"] == "candidate-edit-required"
        and freeze_session is not None
        and not freeze_experiments
    ):
        if (
            research_agenda.get("diagnosis", {}).get("stage")
            == "risk-forecast-positive"
        ):
            report_action = _action(
                _command(
                    "report.publish",
                    "Publish strict analysis over the frozen baseline risk forecast.",
                    [
                        "aq",
                        "report",
                        "publish",
                        str(project.root_dir),
                        "--session",
                        freeze_session_id,
                        "--analysis",
                        "report-analysis.json",
                        "--json",
                    ],
                    "creates-artifact",
                ),
                working_directory=project.root_dir,
            )
            message = (
                "The fixed validation funnel supports a future-risk forecast "
                "and terminates in-sample candidate editing. Publish an exact "
                "baseline-bound Report, complete the Session, and use fresh "
                "external evidence for any further challenge."
            )
            projected["primaryAction"] = report_action
            projected["supportingActions"] = [
                _action(
                    _command(
                        "session.show",
                        "Inspect the frozen baseline Session and immutable evidence.",
                        [
                            "aq",
                            "session",
                            "show",
                            str(project.root_dir),
                            "--session",
                            freeze_session_id,
                            "--json",
                        ],
                        "read-only",
                    ),
                    working_directory=project.root_dir,
                )
            ]
            projected["reasons"] = [
                {
                    "code": "risk-forecast-report-required",
                    "category": "scientific",
                    "message": message,
                }
            ]
            projected["focus"]["coordinationPhase"] = "freeze-ready"
            projected["focus"]["operatingMode"] = "publish-evidence"
            projected["review"] = {
                "status": "pending",
                "label": "RISK FORECAST REPORT REQUIRED",
                "title": "Freeze the supported risk forecast",
                "detail": message,
                "next": report_action["description"],
                "boundary": (
                    "validation selects · visible test audits · "
                    "no Portfolio, RL, or trading authority"
                ),
            }
            research_agenda["moveRole"] = "optional-follow-up"
        else:
            guidance = (
                "The diagnostic agenda favors freezing the current leader; "
                "Session edit authority may evaluate an explicitly predeclared "
                "bounded alternative, but does not authorize open-ended tuning."
            )
            projected["reasons"][0]["message"] = (
                f"{projected['reasons'][0]['message']} {guidance}"
            )
            projected["review"]["detail"] = projected["reasons"][0]["message"]
            projected["review"]["next"] = (
                "Proceed only with an explicitly predeclared bounded "
                "alternative, or freeze now; do not treat Session writability "
                "as authority for open-ended tuning."
            )
    if (
        research_agenda["status"] == "no-further-in-sample-tuning"
        and projected["reasons"][0]["code"]
        in {"candidate-edit-required", "trial-review-required"}
        and projected["primaryAction"] is None
        and freeze_session is not None
        and bool(freeze_experiments)
    ):
        supporting = [
            _action(
                _command(
                    "session.show",
                    "Inspect the baseline-restored Session and immutable trial history.",
                    [
                        "aq",
                        "session",
                        "show",
                        str(project.root_dir),
                        "--session",
                        freeze_session_id,
                        "--json",
                    ],
                    "read-only",
                ),
                working_directory=project.root_dir,
            )
        ]
        rationale = (
            research_agenda["moves"][0]["rationale"]
            if research_agenda["moves"]
            else research_agenda["reason"]
        )
        projected["primaryAction"] = None
        projected["supportingActions"] = supporting
        projected["reasons"] = [
            {
                "code": "in-sample-freeze-ready",
                "category": "scientific",
                "message": rationale,
            }
        ]
        projected["focus"]["coordinationPhase"] = "freeze-ready"
        projected["focus"]["operatingMode"] = "observe"
        projected["review"] = {
            "status": "complete",
            "label": "IN SAMPLE FREEZE READY",
            "title": "Current evidence is ready for an external challenge",
            "detail": rationale,
            "next": (
                "Write and return the decision-support answer; freeze the "
                "current source and use fresh external evidence for any "
                "production claim."
            ),
            "boundary": (
                "validation selects · visible test audits · no trading authority"
            ),
        }
    projected["evidence"]["latestExperiment"] = (
        _latest_experiment_projection(project, freeze_session)
        if freeze_session is not None
        else None
    )
    report_draft = _report_draft_action(
        projected["primaryAction"],
        working_directory=project.root_dir,
    )
    if report_draft is not None:
        projected["supportingActions"] = [
            report_draft,
            *[
                action
                for action in projected["supportingActions"]
                if action["id"] != "report.draft"
            ],
        ][:3]
    candidate_contract = (
        build_candidate_contract(
            project,
            focus_study,
        )
        if focus_study_id is not None
        else None
    )
    construction_fidelity = (
        load_allocation_diagnostics(
            project,
            agenda_run_id,
        )["constructionFidelity"]
        if allocation_fixed and agenda_run_id is not None
        else None
    )
    factor_split_contrast = _factor_split_contrast(
        project,
        agenda_run_id,
        focus_study,
    )
    return {
        "schemaVersion": SCHEMA_VERSION,
        "kind": AGENT_WORK_BRIEF_KIND,
        "method": AGENT_WORK_BRIEF_METHOD,
        "project": {
            "id": project.manifest.id,
            "name": project.manifest.name,
            "rootDir": str(project.root_dir),
        },
        "question": _question_projection(
            project,
            intake,
            studies,
            focus_study,
        ),
        "candidateContract": candidate_contract,
        "constructionFidelity": construction_fidelity,
        "factorSplitContrast": factor_split_contrast,
        "researchAgenda": research_agenda,
        "externalHoldout": holdout,
        **projected,
    }


ACTION_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "id",
        "description",
        "argv",
        "display",
        "effect",
        "workingDirectory",
        "expectedEvidenceKind",
    ],
    "properties": {
        "id": {"type": "string", "minLength": 1},
        "description": {"type": "string", "minLength": 1},
        "argv": {
            "type": "array",
            "minItems": 1,
            "items": {"type": "string"},
        },
        "display": {"type": "string", "minLength": 1},
        "effect": {
            "enum": [
                "read-only",
                "creates-artifact",
                "mutates-workspace",
                "mutates-project",
                "long-running-server",
            ]
        },
        "workingDirectory": {"type": "string", "minLength": 1},
        "expectedEvidenceKind": {"type": "string", "minLength": 1},
    },
}

AGENT_WORK_BRIEF_JSON_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "AutoQuant AI research operator work brief",
    "type": "object",
    "additionalProperties": False,
    "required": [
        "schemaVersion",
        "kind",
        "method",
        "project",
        "question",
        "candidateContract",
        "constructionFidelity",
        "factorSplitContrast",
        "continuation",
        "focus",
        "evidence",
        "reasons",
        "filesystem",
        "authority",
        "researchAgenda",
        "externalHoldout",
        "primaryAction",
        "supportingActions",
        "review",
    ],
    "properties": {
        "schemaVersion": {"const": SCHEMA_VERSION},
        "kind": {"const": AGENT_WORK_BRIEF_KIND},
        "method": {"const": AGENT_WORK_BRIEF_METHOD},
        "project": {
            "type": "object",
            "additionalProperties": False,
            "required": ["id", "name", "rootDir"],
            "properties": {
                "id": {"type": "string", "minLength": 1},
                "name": {"type": "string", "minLength": 1},
                "rootDir": {"type": "string", "minLength": 1},
            },
        },
        "question": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "title",
                "text",
                "origin",
                "sourcePath",
                "requestPath",
            ],
            "properties": {
                "title": {"type": "string", "minLength": 1},
                "text": {"type": "string"},
                "origin": {
                    "enum": [
                        "local",
                        "project-research-brief",
                        "project-request",
                        "delegated-request",
                        "study-request",
                    ]
                },
                "sourcePath": {"type": ["string", "null"]},
                "requestPath": {"type": ["string", "null"]},
            },
        },
        "candidateContract": {
            "oneOf": [
                FACTOR_CANDIDATE_CONTRACT_JSON_SCHEMA,
                {"type": "null"},
            ]
        },
        "constructionFidelity": {
            "oneOf": [
                CONSTRUCTION_FIDELITY_JSON_SCHEMA,
                {"type": "null"},
            ]
        },
        "factorSplitContrast": {
            "oneOf": [
                {"type": "null"},
                {
                    "type": "object",
                    "additionalProperties": False,
                    "required": [
                        "method",
                        "status",
                        "runId",
                        "metric",
                        "primaryForwardBars",
                        "trainMeanRankIc",
                        "validationMeanRankIc",
                        "validationMinusTrain",
                        "absoluteGap",
                        "visibilityThreshold",
                        "selectionSplit",
                        "testEntersContrast",
                        "authority",
                        "message",
                    ],
                    "properties": {
                        "method": {"const": FACTOR_SPLIT_CONTRAST_METHOD},
                        "status": {"const": "material-divergence"},
                        "runId": {"type": "string", "pattern": "^run-"},
                        "metric": {
                            "const": "primary-horizon-mean-rank-ic"
                        },
                        "primaryForwardBars": {
                            "type": "integer",
                            "minimum": 1,
                            "maximum": 252,
                        },
                        "trainMeanRankIc": {"type": "number"},
                        "validationMeanRankIc": {"type": "number"},
                        "validationMinusTrain": {"type": "number"},
                        "absoluteGap": {
                            "type": "number",
                            "minimum": FACTOR_SPLIT_CONTRAST_THRESHOLD,
                        },
                        "visibilityThreshold": {
                            "const": FACTOR_SPLIT_CONTRAST_THRESHOLD
                        },
                        "selectionSplit": {"const": "validation"},
                        "testEntersContrast": {"const": False},
                        "authority": {"const": "orientation-only-no-gate"},
                        "message": {"type": "string", "minLength": 1},
                    },
                },
            ]
        },
        "continuation": {
            "oneOf": [
                {"type": "null"},
                {
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
                    },
                },
            ]
        },
        "focus": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "laneId",
                "laneName",
                "studyId",
                "studyName",
                "coordinationPhase",
                "scientificStage",
                "operatingMode",
            ],
            "properties": {
                "laneId": {"type": ["string", "null"]},
                "laneName": {"type": ["string", "null"]},
                "studyId": {"type": ["string", "null"]},
                "studyName": {"type": ["string", "null"]},
                "coordinationPhase": {"type": "string", "minLength": 1},
                "scientificStage": {"type": "string", "minLength": 1},
                "operatingMode": {
                    "enum": [
                        "observe",
                        "establish-baseline",
                        "edit-and-evaluate",
                        "publish-evidence",
                        "external-audit",
                        "complete",
                        "promote",
                    ]
                },
            },
        },
        "evidence": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "runId",
                "runStatus",
                "failureDisposition",
                "sessionId",
                "sessionStatus",
                "leaderRunId",
                "reportId",
                "reportLineage",
                "candidateCheckId",
                "candidateCheckStatus",
                "latestExperiment",
            ],
            "properties": {
                **{
                    key: {"type": ["string", "null"]}
                    for key in (
                        "runId",
                        "runStatus",
                        "sessionId",
                        "sessionStatus",
                        "leaderRunId",
                        "reportId",
                        "candidateCheckId",
                        "candidateCheckStatus",
                    )
                },
                "failureDisposition": {
                    "type": ["string", "null"],
                    "enum": ["scientific-limit", "repair-required", None],
                },
                "latestExperiment": {
                    "oneOf": [
                        {"type": "null"},
                        {
                            "type": "object",
                            "additionalProperties": False,
                            "required": [
                                "id",
                                "verdict",
                                "runId",
                                "candidateSourceHash",
                                "completedAt",
                                "verdictAuthority",
                                "candidateCheck",
                            ],
                            "properties": {
                                "id": {"type": "string", "minLength": 1},
                                "verdict": {
                                    "enum": ["KEEP", "REVERT", "CRASH"]
                                },
                                "runId": {"type": "string", "minLength": 1},
                                "candidateSourceHash": {
                                    "type": "string",
                                    "pattern": "^[0-9a-f]{64}$",
                                },
                                "completedAt": {
                                    "type": "string",
                                    "minLength": 1,
                                },
                                "verdictAuthority": {
                                    "const": "session-objective-only"
                                },
                                "candidateCheck": {
                                    "oneOf": [
                                        {"type": "null"},
                                        {
                                            "type": "object",
                                            "additionalProperties": False,
                                            "required": ["id", "status"],
                                            "properties": {
                                                "id": {
                                                    "type": "string",
                                                    "minLength": 1,
                                                },
                                                "status": {
                                                    "enum": [
                                                        "passed",
                                                        "failed",
                                                    ]
                                                },
                                            },
                                        },
                                    ]
                                },
                            },
                        },
                    ]
                },
                "reportLineage": {
                    "oneOf": [
                        {"type": "null"},
                        {
                            "type": "object",
                            "additionalProperties": False,
                            "required": [
                                "current",
                                "correctsReportId",
                                "governingReviewId",
                                "reason",
                                "supersededBy",
                                "lineageDepth",
                            ],
                            "properties": {
                                "current": {"type": "boolean"},
                                "correctsReportId": {"type": ["string", "null"]},
                                "governingReviewId": {"type": ["string", "null"]},
                                "reason": {"type": ["string", "null"]},
                                "supersededBy": {"type": ["string", "null"]},
                                "lineageDepth": {"type": "integer", "minimum": 0},
                            },
                        },
                    ]
                },
            },
        },
        "reasons": {
            "type": "array",
            "minItems": 1,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["code", "category", "message"],
                "properties": {
                    "code": {"type": "string", "minLength": 1},
                    "category": {
                        "enum": [
                            "coordination",
                            "evidence",
                            "scientific",
                            "authority",
                        ]
                    },
                    "message": {"type": "string", "minLength": 1},
                },
            },
        },
        "filesystem": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "operatingRoot",
                "writable",
                "editablePaths",
                "declaredEditablePaths",
                "protectedCategories",
            ],
            "properties": {
                "operatingRoot": {"type": "string", "minLength": 1},
                "writable": {"type": "boolean"},
                "editablePaths": {
                    "type": "array",
                    "items": {"type": "string", "minLength": 1},
                    "uniqueItems": True,
                },
                "declaredEditablePaths": {
                    "type": "array",
                    "items": {"type": "string", "minLength": 1},
                    "uniqueItems": True,
                },
                "protectedCategories": {
                    "type": "array",
                    "minItems": 1,
                    "items": {"type": "string", "minLength": 1},
                    "uniqueItems": True,
                },
            },
        },
        "authority": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "researchAuthority",
                "selectionSplit",
                "testRole",
                "testEntersSelection",
                "tradingAuthority",
            ],
            "properties": {
                "researchAuthority": {"type": "string", "minLength": 1},
                "selectionSplit": {"type": "string", "minLength": 1},
                "testRole": {"type": "string", "minLength": 1},
                "testEntersSelection": {"const": False},
                "tradingAuthority": {"const": "none"},
            },
        },
        "researchAgenda": RESEARCH_AGENDA_JSON_SCHEMA,
        "externalHoldout": {
            "oneOf": [
                HOLDOUT_STATUS_JSON_SCHEMA,
                {"type": "null"},
            ]
        },
        "primaryAction": {
            "anyOf": [ACTION_SCHEMA, {"type": "null"}]
        },
        "supportingActions": {
            "type": "array",
            "maxItems": 3,
            "items": ACTION_SCHEMA,
        },
        "review": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "status",
                "label",
                "title",
                "detail",
                "next",
                "boundary",
            ],
            "properties": {
                "status": {
                    "enum": ["pending", "active", "blocked", "complete"]
                },
                "label": {"type": "string", "minLength": 1},
                "title": {"type": "string", "minLength": 1},
                "detail": {"type": "string", "minLength": 1},
                "next": {"type": "string", "minLength": 1},
                "boundary": {"type": "string", "minLength": 1},
            },
        },
    },
}
