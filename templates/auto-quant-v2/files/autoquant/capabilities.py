"""Machine-discoverable public CLI capabilities."""

from __future__ import annotations

from typing import Any

from .templates import PROJECT_TEMPLATE_IDS


EXIT_CODES = {"success": 0, "failure": [1], "usage": 2}


def argument(
    name: str,
    form: str,
    value: str,
    required: bool,
    description: str,
    *,
    default: Any | None = None,
    choices: list[str] | None = None,
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "name": name,
        "form": form,
        "value": value,
        "required": required,
        "description": description,
    }
    if default is not None:
        result["default"] = default
    if choices is not None:
        result["choices"] = choices
    return result


JSON_ARGUMENT = argument(
    "json",
    "option",
    "boolean",
    False,
    "Emit one versioned machine-readable JSON envelope.",
    default=False,
)
PROJECT_ARGUMENT = argument(
    "project",
    "option",
    "string",
    False,
    "Project id inside a Workspace. Project-local state-changing commands "
    "require it when the Workspace contains multiple Projects; read-only "
    "commands may use the disclosed Workspace default.",
    default="Disclosed Workspace default for read-only or single-Project use",
)
PATH_ARGUMENT = argument(
    "path",
    "positional",
    "string",
    True,
    "Direct Project or Workspace directory.",
)
REVIEW_PUBLISH_PATH_ARGUMENT = argument(
    "path",
    "positional",
    "string",
    True,
    "Direct Project or Workspace directory. This entry path also declares the "
    "observed-file root: Project-relative ids require a Project path; "
    "Workspace-relative ids such as staging/comparison.json require a "
    "Workspace path plus --project.",
)
STUDY_ARGUMENT = argument(
    "study",
    "option",
    "string",
    True,
    "Project-local Study id.",
)
RUN_ARGUMENT = argument(
    "run",
    "option",
    "string",
    True,
    "Immutable Run id.",
)
SESSION_ARGUMENT = argument(
    "session",
    "option",
    "string",
    True,
    "Project-local research Session id.",
)
EXPERIMENT_ARGUMENT = argument(
    "experiment",
    "option",
    "string",
    True,
    "Immutable Experiment id inside a Session.",
)
CAMPAIGN_ARGUMENT = argument(
    "campaign",
    "option",
    "string",
    True,
    "Immutable Campaign id inside a Session.",
)
REPORT_ARGUMENT = argument(
    "report",
    "option",
    "string",
    True,
    "Immutable Research Report id inside a Session.",
)
REVIEW_ARGUMENT = argument(
    "review",
    "option",
    "string",
    False,
    "Immutable attached Independent Review id; omit only when path is a direct detached Review package.",
)
DOSSIER_ARGUMENT = argument(
    "dossier",
    "option",
    "string",
    True,
    "Immutable Project-level Research Dossier id.",
)


def descriptor(
    command_id: str,
    usage: str,
    description: str,
    effect: str,
    arguments: list[dict[str, Any]],
    *,
    supports_json: bool = True,
) -> dict[str, Any]:
    return {
        "id": command_id,
        "usage": usage,
        "description": description,
        "effect": effect,
        "supportsJson": supports_json,
        "exitCodes": EXIT_CODES,
        "arguments": arguments,
        "outputSections": [],
    }


CLI_COMMANDS = [
    descriptor(
        "version",
        "aq version [--json]",
        "Report the current Harness version, exact build commit, dirty state, runtime closure hash, Python version, and provenance source.",
        "read-only",
        [JSON_ARGUMENT],
    ),
    descriptor(
        "capabilities",
        "aq capabilities [--json]",
        "Describe every public command, argument, effect, and exit behavior.",
        "read-only",
        [JSON_ARGUMENT],
    ),
    descriptor(
        "schema",
        "aq schema [workspace|project|agent-work-brief|research-agenda|holdout-binding|holdout-result|holdout-assessment-analysis|holdout-assessment|holdout-status|study|judge-output|run-result|factor-claim|factor-population|factor-candidate-contract|factor-diagnostics|event-study-policy|event-study-diagnostics|book-path-stress-policy|book-path-stress-diagnostics|allocation-policy|allocation-diagnostics|book-risk-diagnostics|portfolio-diagnostics|research-program-status|rl-policy-diagnostics|session-decision-matrix|session|session-completion|candidate-preflight|candidate-check-output|candidate-check-result|portfolio-mandate|research-horizon|experiment|research-request|ohlcv-dataset-package|report-analysis|review-analysis|dossier-analysis|dossier-result|dossier-status|researcher-response|campaign-result|campaign-progress|studio-snapshot] [--json]",
        "List or emit canonical AutoQuant JSON Schemas.",
        "read-only",
        [
            argument(
                "kind",
                "positional",
                "string",
                False,
                "Schema kind; omit to list kinds.",
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
            ),
            JSON_ARGUMENT,
        ],
    ),
    descriptor(
        "orient",
        "aq orient <project-worktree-or-workspace-dir> [--project ID] [--json]",
        "Return one compact verified Agent work brief with focus, edit authority, evidence-driven experiment agenda, blocker, and exact next action; a locked Session worktree resolves read-only through its owning Project.",
        "read-only",
        [PATH_ARGUMENT, PROJECT_ARGUMENT, JSON_ARGUMENT],
    ),
    descriptor(
        "workspace.init",
        "aq workspace init <workspace-dir> [--name NAME] "
        "[--adopt-existing] [--json]",
        "Create a multi-Project AutoQuant Workspace in an absent or empty "
        "directory, or explicitly adopt a non-empty directory while "
        "preserving caller files and refusing existing configuration or "
        "projects entries.",
        "creates-artifact",
        [
            argument(
                "workspace-dir",
                "positional",
                "string",
                True,
                "New Workspace directory. Keep staging outside it unless "
                "--adopt-existing is explicit.",
            ),
            argument(
                "name",
                "option",
                "string",
                False,
                "Workspace display name.",
                default="Directory name",
            ),
            argument(
                "adopt-existing",
                "option",
                "boolean",
                False,
                "Preserve existing entries and create only the Workspace "
                "manifest plus a new empty projects directory; refuse "
                "existing Workspace configuration or projects entries.",
                default=False,
            ),
            JSON_ARGUMENT,
        ],
    ),
    descriptor(
        "project.templates",
        "aq project templates [--json]",
        "List strict fit and anti-fit contracts for every Project construction route; Factor-to-Portfolio, Factor-to-RL, and coordinated Dossier work route to ohlcv-research-desk.",
        "read-only",
        [JSON_ARGUMENT],
    ),
    descriptor(
        "project.create",
        "aq project create <workspace-dir> <project-id> [options]",
        "Create one self-contained Project after using project.templates to distinguish single-lane Labs from the coordinated Research Desk, with English research and Project-derived Workbench-needs Markdown surfaces.",
        "creates-artifact",
        [
            argument(
                "workspace-dir",
                "positional",
                "string",
                True,
                "Existing AutoQuant Workspace directory.",
            ),
            argument(
                "project-id",
                "positional",
                "string",
                True,
                "Lowercase kebab-case Project id.",
            ),
            argument(
                "name",
                "option",
                "string",
                False,
                "Project display name.",
                default="Project id",
            ),
            argument(
                "description",
                "option",
                "string",
                False,
                "Initial assignment seed for the Agent-maintained research brief.",
                default="Empty",
            ),
            argument(
                "template",
                "option",
                "string",
                False,
                "Self-contained Project construction template.",
                default="blank",
                choices=list(PROJECT_TEMPLATE_IDS),
            ),
            JSON_ARGUMENT,
        ],
    ),
    descriptor(
        "project.intake",
        "aq project intake <workspace-dir> <project-id> --request FILE --dataset FILE [options]",
        "Create a content-locked research Project, or hydrate an exact pristine "
        "template scaffold while preserving its Agent notes, after clarified "
        "intent has been translated into a strict request and OHLCV package.",
        "creates-artifact",
        [
            argument(
                "workspace-dir",
                "positional",
                "string",
                True,
                "Existing AutoQuant Workspace directory.",
            ),
            argument(
                "project-id",
                "positional",
                "string",
                True,
                "Lowercase kebab-case Project id.",
            ),
            argument(
                "request",
                "option",
                "string",
                True,
                "Strict delegated Research Request JSON. Its source "
                "artifactPath and artifactRevision must either both be "
                "non-null strings or both be null.",
            ),
            argument(
                "dataset",
                "option",
                "string",
                True,
                "Path to the external OHLCV dataset-package manifest JSON, "
                "not its directory. Asset paths resolve from the manifest "
                "directory; place the manifest at staged files' common "
                "ancestor (for example staging/dataset-package.json with "
                "raw-ohlcv/AAPL.csv) to avoid an intermediate copy. V4-V6 "
                "are ohlcv-factor-lab only; use V1 for aligned daily "
                "fixed-Lab intake. V1-V4 may declare one complete per-asset "
                "assetClass vector.",
            ),
            argument(
                "template",
                "option",
                "string",
                False,
                "Research desk or fixed Lab to bind to the snapshot.",
                default="ohlcv-research-desk",
                choices=list(PROJECT_TEMPLATE_IDS[1:]),
            ),
            argument(
                "name",
                "option",
                "string",
                False,
                "Project display name.",
                default="Request title",
            ),
            JSON_ARGUMENT,
        ],
    ),
    descriptor(
        "project.list",
        "aq project list <workspace-dir> [--json]",
        "List immediate self-contained Workspace Projects.",
        "read-only",
        [
            argument(
                "workspace-dir",
                "positional",
                "string",
                True,
                "Existing AutoQuant Workspace directory.",
            ),
            JSON_ARGUMENT,
        ],
    ),
    descriptor(
        "project.default",
        "aq project default <workspace-dir> <project-id> [--json]",
        "Select the Workspace default Project.",
        "mutates-workspace",
        [
            argument(
                "workspace-dir",
                "positional",
                "string",
                True,
                "Existing AutoQuant Workspace directory.",
            ),
            argument(
                "project-id",
                "positional",
                "string",
                True,
                "Existing Project id.",
            ),
            JSON_ARGUMENT,
        ],
    ),
    descriptor(
        "project.program",
        "aq project program <path> [--project ID] [--json]",
        "Verify coordinated Factor, Portfolio, and governed-RL lane status and exact next actions.",
        "read-only",
        [PATH_ARGUMENT, PROJECT_ARGUMENT, JSON_ARGUMENT],
    ),
    descriptor(
        "validate",
        "aq validate <project-or-workspace-dir> [--project ID] [--json]",
        "Strictly validate and resolve one AutoQuant Project.",
        "read-only",
        [
            argument(
                "path",
                "positional",
                "string",
                True,
                "Direct Project or Workspace directory.",
            ),
            PROJECT_ARGUMENT,
            JSON_ARGUMENT,
        ],
    ),
    descriptor(
        "inspect",
        "aq inspect <project-or-workspace-dir> [--project ID] [--json]",
        "Inspect one Project's research program and owned construction surfaces.",
        "read-only",
        [
            argument(
                "path",
                "positional",
                "string",
                True,
                "Direct Project or Workspace directory.",
            ),
            PROJECT_ARGUMENT,
            JSON_ARGUMENT,
        ],
    ),
    descriptor(
        "study.intake",
        "aq study intake <path> <study-id> --request FILE [--dataset PACKAGE] "
        "[--project ID] [--json]",
        "Append one independently fixed request-owned Book Risk Study over "
        "an existing Project dataset or one complete newer Study-owned "
        "data vintage.",
        "creates-artifact",
        [
            PATH_ARGUMENT,
            argument(
                "study-id",
                "positional",
                "string",
                True,
                "Lowercase kebab-case Study id.",
            ),
            PROJECT_ARGUMENT,
            argument(
                "request",
                "option",
                "string",
                True,
                "Strict Book Risk Research Request preserving the retained "
                "dataset asset descriptions.",
            ),
            argument(
                "name",
                "option",
                "string",
                False,
                "Study display name.",
                default="Request title",
            ),
            argument(
                "dataset",
                "option",
                "string",
                False,
                "Complete newer OHLCV dataset-package manifest. When omitted, "
                "reuse the retained Project intake dataset.",
            ),
            JSON_ARGUMENT,
        ],
    ),
    descriptor(
        "study.create",
        "aq study create <path> <study-id> [contract options] (--request FILE --dataset PACKAGE | manual dataset options) [--json]",
        "Create and validate one fixed Project-local quantitative Study, optionally atomically materializing its external OHLCV authority.",
        "creates-artifact",
        [
            PATH_ARGUMENT,
            argument(
                "study-id",
                "positional",
                "string",
                True,
                "Lowercase kebab-case Study id.",
            ),
            PROJECT_ARGUMENT,
            argument("name", "option", "string", False, "Study display name.", default="Study id"),
            argument("description", "option", "string", False, "Bounded research question.", default="Empty"),
            argument(
                "subject-kind",
                "option",
                "string",
                True,
                "Research subject kind.",
                choices=["strategy", "factor", "model", "research"],
            ),
            argument("subject-name", "option", "string", False, "Research subject name.", default="Study id"),
            argument("subject-version", "option", "string", False, "Mutable subject version label.", default="working"),
            argument("judge", "option", "string", True, "Project-relative Python Judge entrypoint."),
            argument("judge-path", "option", "string", False, "Repeatable fixed Judge file or trailing /** closure.", default="Judge entrypoint"),
            argument("judge-arg", "option", "string", False, "Repeatable fixed Judge argument.", default="None"),
            argument(
                "editable",
                "option",
                "string",
                False,
                "Repeatable Agent-editable file or trailing /** closure; exactly one of --editable or --no-editable is required.",
            ),
            argument(
                "no-editable",
                "option",
                "boolean",
                False,
                "Declare a fixed descriptive Study with no candidate Session surface; mutually exclusive with --editable.",
                default=False,
            ),
            argument(
                "dependency",
                "option",
                "string",
                False,
                "Repeatable fixed strategy, factor, or model source path or trailing /** closure.",
                default="None",
            ),
            argument(
                "request-path",
                "option",
                "string",
                False,
                "Exact Study-owned Research Request path, also declared as a fixed dependency.",
                default="None",
            ),
            argument(
                "request",
                "option",
                "string",
                False,
                "External strict Research Request to materialize under this Study; requires --dataset and excludes manual request/dataset identity options.",
                default="None",
            ),
            argument(
                "dataset",
                "option",
                "string",
                False,
                "External V1-V3 OHLCV dataset-package manifest to validate, normalize, and bind atomically; requires --request.",
                default="None",
            ),
            argument(
                "position-snapshot-path",
                "option",
                "string",
                False,
                "Optional exact position snapshot paired with --request-path and declared as a fixed dependency.",
                default="None",
            ),
            argument(
                "upstream-run",
                "option",
                "string",
                False,
                "Exact prior immutable Run supplying continuation evidence; requires at least one --upstream-artifact.",
                default="None",
            ),
            argument(
                "upstream-artifact",
                "option",
                "string",
                False,
                "Repeatable exact artifact declared by --upstream-run.",
                default="None",
            ),
            argument("metric", "option", "string", False, "Primary metric name.", default="score"),
            argument(
                "direction",
                "option",
                "string",
                False,
                "Primary metric direction.",
                default="maximize",
                choices=["maximize", "minimize"],
            ),
            argument("minimum-improvement", "option", "number", False, "Minimum comparable improvement.", default=0),
            argument("dataset-id", "option", "string", False, "Manual-form dataset identity; required unless --request/--dataset are supplied."),
            argument("dataset-version", "option", "string", False, "Dataset version.", default="working"),
            argument(
                "dataset-path",
                "option",
                "string",
                False,
                "Repeatable Project-data-relative file or trailing /** closure to content-lock.",
                default="Declarative dataset identity only",
            ),
            argument("asset-class", "option", "string", False, "Manual-form dataset asset class; required unless external intake is used."),
            argument("asset", "option", "string", False, "Repeatable manual-form universe member; required unless external intake is used."),
            argument("start", "option", "string", False, "Manual-form dataset start; required unless external intake is used."),
            argument("end", "option", "string", False, "Manual-form dataset end; required unless external intake is used."),
            argument("timeout", "option", "integer", False, "Judge timeout in seconds.", default=60),
            JSON_ARGUMENT,
        ],
    ),
    descriptor(
        "study.list",
        "aq study list <path> [--project ID] [--json]",
        "List strict Project-local Studies.",
        "read-only",
        [PATH_ARGUMENT, PROJECT_ARGUMENT, JSON_ARGUMENT],
    ),
    descriptor(
        "study.inspect",
        "aq study inspect <path> --study ID [--project ID] [--json]",
        "Inspect one fixed Study, source closure, Judge, dataset, and input identity.",
        "read-only",
        [PATH_ARGUMENT, PROJECT_ARGUMENT, STUDY_ARGUMENT, JSON_ARGUMENT],
    ),
    descriptor(
        "run.execute",
        "aq run execute <path> --study ID [--project ID] [--json]",
        "Execute one bounded Python Judge and publish an immutable RunResult.",
        "creates-artifact",
        [PATH_ARGUMENT, PROJECT_ARGUMENT, STUDY_ARGUMENT, JSON_ARGUMENT],
    ),
    descriptor(
        "run.list",
        "aq run list <path> [--study ID] [--project ID] [--json]",
        "List verified immutable Runs, optionally filtered by Study.",
        "read-only",
        [
            PATH_ARGUMENT,
            PROJECT_ARGUMENT,
            argument("study", "option", "string", False, "Optional Study id filter."),
            JSON_ARGUMENT,
        ],
    ),
    descriptor(
        "run.show",
        "aq run show <path> --run ID [--project ID] [--json]",
        "Verify and inspect one immutable RunResult.",
        "read-only",
        [PATH_ARGUMENT, PROJECT_ARGUMENT, RUN_ARGUMENT, JSON_ARGUMENT],
    ),
    descriptor(
        "run.factor",
        "aq run factor <path> --run ID [--points 40..400] [--project ID] [--json]",
        "Project one verified Factor Run into bounded IC, decay, quantile, stability, and style diagnostics.",
        "read-only",
        [
            PATH_ARGUMENT,
            PROJECT_ARGUMENT,
            RUN_ARGUMENT,
            argument(
                "points",
                "option",
                "integer",
                False,
                "Maximum sampled full-history Factor path points.",
                default=180,
            ),
            JSON_ARGUMENT,
        ],
    ),
    descriptor(
        "run.portfolio",
        "aq run portfolio <path> --run ID [--points 40..400] [--project ID] [--json]",
        "Project one verified Portfolio Run into bounded performance, position, signal, attribution, target-translation robustness, executed-book risk, and OHLCV liquidity-capacity diagnostics.",
        "read-only",
        [
            PATH_ARGUMENT,
            PROJECT_ARGUMENT,
            RUN_ARGUMENT,
            argument(
                "points",
                "option",
                "integer",
                False,
                "Maximum sampled full-history path points.",
                default=180,
            ),
            JSON_ARGUMENT,
        ],
    ),
    descriptor(
        "run.book-risk",
        "aq run book-risk <path> --run ID [--points 20..400] [--project ID] [--json]",
        "Project one verified reported-book Run into covariance crowding, "
        "component-risk, pair-correlation, standardized reduction, "
        "caller-supplied complete-book comparison, caller-bounded "
        "target-position sizing, and rolling-path evidence.",
        "read-only",
        [
            PATH_ARGUMENT,
            PROJECT_ARGUMENT,
            RUN_ARGUMENT,
            argument(
                "points",
                "option",
                "integer",
                False,
                "Maximum sampled rolling book-risk path points.",
                default=80,
            ),
            JSON_ARGUMENT,
        ],
    ),
    descriptor(
        "run.event-study",
        "aq run event-study <path> --run ID [--project ID] [--json]",
        "Project one verified fixed price-event Run into exact timing, "
        "event populations, unconditional and matched references, overlap, "
        "uncertainty, and no-trading conclusion evidence.",
        "read-only",
        [
            PATH_ARGUMENT,
            PROJECT_ARGUMENT,
            RUN_ARGUMENT,
            JSON_ARGUMENT,
        ],
    ),
    descriptor(
        "run.book-path-stress",
        "aq run book-path-stress <path> --run ID [--project ID] [--json]",
        "Project one verified reported-book Path Stress Run into every "
        "complete fixed-unit window, worst non-overlapping episodes, exact "
        "holding contribution, and historical-only authority evidence.",
        "read-only",
        [
            PATH_ARGUMENT,
            PROJECT_ARGUMENT,
            RUN_ARGUMENT,
            JSON_ARGUMENT,
        ],
    ),
    descriptor(
        "run.allocation",
        "aq run allocation <path> --run ID [--points 40..400] [--project ID] [--json]",
        "Project one verified portfolio-native Allocation Run into same-clock "
        "candidate/reference performance, split ERC construction fidelity, "
        "component-risk, constraint, implementation, and current target "
        "evidence.",
        "read-only",
        [
            PATH_ARGUMENT,
            PROJECT_ARGUMENT,
            RUN_ARGUMENT,
            argument(
                "points",
                "option",
                "integer",
                False,
                "Maximum sampled full-history allocation path points.",
                default=180,
            ),
            JSON_ARGUMENT,
        ],
    ),
    descriptor(
        "run.rl",
        "aq run rl <path> --run ID [--points 40..400] [--project ID] [--json]",
        "Project one verified governed RL Run into bounded baseline, fold/seed, training, action, implementation, and executed-book risk evidence.",
        "read-only",
        [
            PATH_ARGUMENT,
            PROJECT_ARGUMENT,
            RUN_ARGUMENT,
            argument(
                "points",
                "option",
                "integer",
                False,
                "Maximum sampled immutable action-ledger points.",
                default=180,
            ),
            JSON_ARGUMENT,
        ],
    ),
    descriptor(
        "session.start",
        "aq session start <path> --study ID [--request FILE] [--project ID] [--json]",
        "Preflight a fresh first candidate when declared, establish or reuse its successful baseline, create a resumable worktree, and optionally bind one delegated Research Request.",
        "creates-artifact",
        [
            PATH_ARGUMENT,
            PROJECT_ARGUMENT,
            STUDY_ARGUMENT,
            argument(
                "request",
                "option",
                "string",
                False,
                "Strict research-request JSON supplied by OpenAlice or a local caller.",
            ),
            JSON_ARGUMENT,
        ],
    ),
    descriptor(
        "session.list",
        "aq session list <path> [--project ID] [--json]",
        "List Project-local governed research Sessions.",
        "read-only",
        [PATH_ARGUMENT, PROJECT_ARGUMENT, JSON_ARGUMENT],
    ),
    descriptor(
        "session.show",
        "aq session show <path> --session ID [--project ID] [--json]",
        "Inspect a Session Agent brief, authority, candidate, leader, history, "
        "and verified test-exposure state without inferring whether visible "
        "test evidence guided an edit.",
        "read-only",
        [PATH_ARGUMENT, PROJECT_ARGUMENT, SESSION_ARGUMENT, JSON_ARGUMENT],
    ),
    descriptor(
        "session.check",
        "aq session check <path> --session ID [--project ID] [--json]",
        "Run one fixed bounded preflight and publish immutable non-selection evidence for the exact candidate.",
        "creates-artifact",
        [PATH_ARGUMENT, PROJECT_ARGUMENT, SESSION_ARGUMENT, JSON_ARGUMENT],
    ),
    descriptor(
        "session.compare",
        "aq session compare <path> --session ID [--trials 1..100] [--project ID] [--json]",
        "Compare a bounded verified Session baseline, candidates, and leader across professional metric layers.",
        "read-only",
        [
            PATH_ARGUMENT,
            PROJECT_ARGUMENT,
            SESSION_ARGUMENT,
            argument(
                "trials",
                "option",
                "integer",
                False,
                "Maximum candidate trials; baseline and current leader stay anchored.",
                default=24,
            ),
            JSON_ARGUMENT,
        ],
    ),
    descriptor(
        "session.promote",
        "aq session promote <path> --session ID [--report ID] [--project ID] [--json]",
        "Hash-check and promote the exact current KEEP into an unchanged Project base, then terminally close the Session as promoted; delegated work requires a current immutable Report.",
        "mutates-project",
        [
            PATH_ARGUMENT,
            PROJECT_ARGUMENT,
            SESSION_ARGUMENT,
            argument(
                "report",
                "option",
                "string",
                False,
                "Exact current immutable Report required for delegated promotion.",
            ),
            JSON_ARGUMENT,
        ],
    ),
    descriptor(
        "session.complete",
        "aq session complete <path> --session ID --report ID [--project ID] [--json]",
        "Terminally close one active delegated baseline-retaining Session with an exact verified current Report and no Project source mutation; not valid after KEEP promotion.",
        "creates-artifact",
        [
            PATH_ARGUMENT,
            PROJECT_ARGUMENT,
            SESSION_ARGUMENT,
            REPORT_ARGUMENT,
            JSON_ARGUMENT,
        ],
    ),
    descriptor(
        "experiment.evaluate",
        "aq experiment evaluate <path> --session ID --hypothesis TEXT [--project ID] [--json]",
        "Evaluate the current worktree candidate and publish KEEP, REVERT, or CRASH evidence.",
        "creates-artifact",
        [
            PATH_ARGUMENT,
            PROJECT_ARGUMENT,
            SESSION_ARGUMENT,
            argument(
                "hypothesis",
                "option",
                "string",
                True,
                "Falsifiable description of the candidate change.",
            ),
            JSON_ARGUMENT,
        ],
    ),
    descriptor(
        "experiment.list",
        "aq experiment list <path> --session ID [--project ID] [--json]",
        "List immutable Experiment history for one Session.",
        "read-only",
        [PATH_ARGUMENT, PROJECT_ARGUMENT, SESSION_ARGUMENT, JSON_ARGUMENT],
    ),
    descriptor(
        "experiment.show",
        "aq experiment show <path> --session ID --experiment ID [--project ID] [--json]",
        "Verify and inspect one immutable Experiment, source change set, and candidate Run.",
        "read-only",
        [
            PATH_ARGUMENT,
            PROJECT_ARGUMENT,
            SESSION_ARGUMENT,
            EXPERIMENT_ARGUMENT,
            JSON_ARGUMENT,
        ],
    ),
    descriptor(
        "research.run",
        "aq research run <path> --session ID --agent-command SHELL [budgets] [--project ID] [--json]",
        "Run a user-authorized external shell Researcher against one governed Session and publish immutable Campaign evidence.",
        "creates-artifact",
        [
            PATH_ARGUMENT,
            PROJECT_ARGUMENT,
            SESSION_ARGUMENT,
            argument(
                "agent-command",
                "option",
                "string",
                True,
                "Explicit host shell command receiving a turn brief on stdin.",
            ),
            argument(
                "max-turns",
                "option",
                "integer",
                False,
                "Maximum Researcher turns.",
                default=5,
            ),
            argument(
                "max-wall-seconds",
                "option",
                "integer",
                False,
                "Aggregate Campaign wall-clock budget.",
                default=900,
            ),
            argument(
                "turn-timeout-seconds",
                "option",
                "integer",
                False,
                "Maximum duration of one Researcher command.",
                default=300,
            ),
            JSON_ARGUMENT,
        ],
    ),
    descriptor(
        "research.list",
        "aq research list <path> --session ID [--project ID] [--json]",
        "List verified immutable Researcher Campaigns in one Session.",
        "read-only",
        [PATH_ARGUMENT, PROJECT_ARGUMENT, SESSION_ARGUMENT, JSON_ARGUMENT],
    ),
    descriptor(
        "research.show",
        "aq research show <path> --session ID --campaign ID [--project ID] [--json]",
        "Verify and inspect one immutable Campaign and its turn evidence.",
        "read-only",
        [
            PATH_ARGUMENT,
            PROJECT_ARGUMENT,
            SESSION_ARGUMENT,
            CAMPAIGN_ARGUMENT,
            JSON_ARGUMENT,
        ],
    ),
    descriptor(
        "report.draft",
        "aq report draft <path> (--session ID | --study ID --run ID) [--output FILE] [--project ID] [--json]",
        "Write one new confined schema-valid authoring draft with the exact leader Run and declared artifact references; draft state and reserved placeholders block publication.",
        "creates-artifact",
        [
            PATH_ARGUMENT,
            PROJECT_ARGUMENT,
            argument(
                "session",
                "option",
                "string",
                False,
                "Delegated active Session anchor; mutually exclusive with --study/--run.",
            ),
            argument(
                "study",
                "option",
                "string",
                False,
                "Study id for a Session-free reportable Run anchor; requires --run.",
            ),
            argument(
                "run",
                "option",
                "string",
                False,
                "Current reportable Run id; requires --study.",
            ),
            argument(
                "output",
                "option",
                "string",
                False,
                "New confined Project-relative path; defaults to report-analysis.json and never overwrites.",
                default="report-analysis.json",
            ),
            JSON_ARGUMENT,
        ],
    ),
    descriptor(
        "report.publish",
        "aq report publish <path> (--session ID | --study ID --run ID) --analysis FILE [--corrects REPORT --correction-review REVIEW_OR_PATH --correction-reason TEXT] [--project ID] [--json]",
        "Publish immutable analysis over either a delegated Session evidence prefix, one successful current request-bound Study Run, or one current scientific-limit Run; Run-bound Reports may extend one verified linear correction lineage.",
        "creates-artifact",
        [
            PATH_ARGUMENT,
            PROJECT_ARGUMENT,
            argument(
                "session",
                "option",
                "string",
                False,
                "Delegated editable Session anchor; mutually exclusive with --study/--run.",
            ),
            argument(
                "study",
                "option",
                "string",
                False,
                "Study id for a Session-free Run anchor; requires --run.",
            ),
            argument(
                "run",
                "option",
                "string",
                False,
                "Successful current Run id for a Session-free anchor; requires --study.",
            ),
            argument(
                "analysis",
                "option",
                "string",
                True,
                (
                    "Strict report-analysis JSON; every recommendation "
                    "requires action, rationale, conditions, and evidenceRefs. "
                    "The public schema includes one complete copyable example. "
                    "Run artifactPath is null or an exact "
                    "result.artifacts[].path such as "
                    "artifacts/factor-report.json; Experiment/Campaign "
                    "artifactPath is null."
                ),
            ),
            argument(
                "corrects",
                "option",
                "string",
                False,
                "Current terminal Run-bound Report corrected by this publication.",
            ),
            argument(
                "correction-review",
                "option",
                "string",
                False,
                "Attached Review id or detached Review package path that targets --corrects.",
            ),
            argument(
                "correction-reason",
                "option",
                "string",
                False,
                "Concise durable reason frozen into the correction lineage.",
            ),
            JSON_ARGUMENT,
        ],
    ),
    descriptor(
        "report.list",
        "aq report list <path> [--session ID | --study ID] [--project ID] [--json]",
        "List verified immutable Project-owned Run Reports, optionally filtered by Study, or Reports in one Session.",
        "read-only",
        [
            PATH_ARGUMENT,
            PROJECT_ARGUMENT,
            argument("session", "option", "string", False, "Session-bound Report scope."),
            argument("study", "option", "string", False, "Run-bound Report Study filter."),
            JSON_ARGUMENT,
        ],
    ),
    descriptor(
        "report.show",
        "aq report show <path> [--session ID] --report ID [--project ID] [--json]",
        "Verify one immutable Research Report; omit --session for a Project-owned Run anchor.",
        "read-only",
        [
            PATH_ARGUMENT,
            PROJECT_ARGUMENT,
            argument("session", "option", "string", False, "Owning Session for a Session-bound Report."),
            REPORT_ARGUMENT,
            JSON_ARGUMENT,
        ],
    ),
    descriptor(
        "review.publish",
        "aq review publish <path> --report ID [--session ID] --analysis FILE [--output DIR] [--project ID] [--json]",
        "Publish an immutable independent evidence classification over one completed Report and anchor Run; --output creates a detached package without mutating the reviewed Workspace.",
        "creates-artifact",
        [
            REVIEW_PUBLISH_PATH_ARGUMENT,
            PROJECT_ARGUMENT,
            argument("session", "option", "string", False, "Owning Session when the target Report is Session-bound."),
            REPORT_ARGUMENT,
            argument("analysis", "option", "string", True, "Strict review-analysis JSON using verified, declared, observed-unbound, and unverified claim classes."),
            argument("output", "option", "string", False, "External parent directory for a detached Review package; omit to attach under Project reviews/."),
            JSON_ARGUMENT,
        ],
    ),
    descriptor(
        "review.list",
        "aq review list <path> [--report ID] [--project ID] [--json]",
        "List and verify attached immutable Independent Reviews, optionally filtered by target Report.",
        "read-only",
        [
            PATH_ARGUMENT,
            PROJECT_ARGUMENT,
            argument("report", "option", "string", False, "Exact target Report id filter."),
            JSON_ARGUMENT,
        ],
    ),
    descriptor(
        "review.show",
        "aq review show <path> [--review ID] [--project ID] [--json]",
        "Verify an attached Independent Review by id or a direct detached Review package when --review is omitted.",
        "read-only",
        [PATH_ARGUMENT, PROJECT_ARGUMENT, REVIEW_ARGUMENT, JSON_ARGUMENT],
    ),
    descriptor(
        "dossier.status",
        "aq dossier status <path> [--project ID] [--json]",
        "Verify Project intake and current lane Report readiness for one cross-lane Research Dossier.",
        "read-only",
        [PATH_ARGUMENT, PROJECT_ARGUMENT, JSON_ARGUMENT],
    ),
    descriptor(
        "dossier.publish",
        "aq dossier publish <path> --analysis FILE [--project ID] [--json]",
        "Publish immutable JSON and Markdown synthesis over verified current Factor, Portfolio, and optional RL Reports.",
        "creates-artifact",
        [
            PATH_ARGUMENT,
            PROJECT_ARGUMENT,
            argument(
                "analysis",
                "option",
                "string",
                True,
                "Strict Dossier analysis with lane Report/finding references.",
            ),
            JSON_ARGUMENT,
        ],
    ),
    descriptor(
        "dossier.list",
        "aq dossier list <path> [--project ID] [--json]",
        "List verified immutable Project-level Research Dossiers.",
        "read-only",
        [PATH_ARGUMENT, PROJECT_ARGUMENT, JSON_ARGUMENT],
    ),
    descriptor(
        "dossier.show",
        "aq dossier show <path> --dossier ID [--project ID] [--json]",
        "Verify and inspect one immutable cross-lane Research Dossier.",
        "read-only",
        [
            PATH_ARGUMENT,
            PROJECT_ARGUMENT,
            DOSSIER_ARGUMENT,
            JSON_ARGUMENT,
        ],
    ),
    descriptor(
        "holdout.create-target",
        "aq holdout create-target <source> <workspace-dir> <project-id> "
        "--dossier ID --dataset FILE [--source-project ID] [--name NAME] "
        "[--json]",
        "Atomically create and bind a strictly later target using the source "
        "Dossier's canonical request, frozen leaders, and lane-aware history "
        "floor: Factor 120, included Portfolio 180, included RL 240 rows, "
        "plus primary-horizon validation capacity.",
        "creates-artifact",
        [
            argument(
                "source",
                "positional",
                "string",
                True,
                "Source Project or Workspace path.",
            ),
            argument(
                "workspace-dir",
                "positional",
                "string",
                True,
                "Workspace that will own the new frozen target Project.",
            ),
            argument(
                "project-id",
                "positional",
                "string",
                True,
                "New lowercase kebab-case target Project id.",
            ),
            argument(
                "source-project",
                "option",
                "string",
                False,
                "Source Workspace Project id; required when the source "
                "Workspace contains multiple Projects.",
            ),
            DOSSIER_ARGUMENT,
            argument(
                "dataset",
                "option",
                "string",
                True,
                "Strictly later OHLCV dataset-package manifest JSON.",
            ),
            argument(
                "name",
                "option",
                "string",
                False,
                "Target Project display name.",
                default="Source name plus External Holdout",
            ),
            JSON_ARGUMENT,
        ],
    ),
    descriptor(
        "holdout.bind",
        "aq holdout bind <source> <target> --dossier ID [--source-project ID] [--target-project ID] [--json]",
        "Freeze one current Dossier's exact leader sources into a fresh strictly later compatible Project.",
        "mutates-project",
        [
            argument(
                "source",
                "positional",
                "string",
                True,
                "Source Project or Workspace path.",
            ),
            argument(
                "target",
                "positional",
                "string",
                True,
                "Fresh target Project or Workspace path.",
            ),
            argument(
                "source-project",
                "option",
                "string",
                False,
                "Source Workspace Project id; required when the source "
                "Workspace contains multiple Projects.",
            ),
            argument(
                "target-project",
                "option",
                "string",
                False,
                "Target Workspace Project id; required when the target "
                "Workspace contains multiple Projects.",
            ),
            DOSSIER_ARGUMENT,
            JSON_ARGUMENT,
        ],
    ),
    descriptor(
        "holdout.status",
        "aq holdout status <path> [--project ID] [--json]",
        "Verify frozen binding, later-period identity, one-shot state, and authority.",
        "read-only",
        [PATH_ARGUMENT, PROJECT_ARGUMENT, JSON_ARGUMENT],
    ),
    descriptor(
        "holdout.run",
        "aq holdout run <path> [--project ID] [--json]",
        "Execute or resume the exact bound external-period lane set and publish one immutable result.",
        "creates-artifact",
        [PATH_ARGUMENT, PROJECT_ARGUMENT, JSON_ARGUMENT],
    ),
    descriptor(
        "holdout.assess",
        "aq holdout assess <path> --analysis FILE [--project ID] [--json]",
        "Publish one immutable Agent-authored interpretation over the verified "
        "source-versus-later evidence without creating a Core pass threshold.",
        "creates-artifact",
        [
            PATH_ARGUMENT,
            PROJECT_ARGUMENT,
            argument(
                "analysis",
                "option",
                "string",
                True,
                "Strict lane-specific Holdout Assessment analysis JSON.",
            ),
            JSON_ARGUMENT,
        ],
    ),
    descriptor(
        "holdout.show",
        "aq holdout show <path> [--project ID] [--json]",
        "Verify the immutable frozen result, bounded evidence, and optional Assessment.",
        "read-only",
        [PATH_ARGUMENT, PROJECT_ARGUMENT, JSON_ARGUMENT],
    ),
    descriptor(
        "studio.snapshot",
        "aq studio snapshot <path> [--project ID] [--json]",
        "Build one versioned read-only Workspace or Project observation through verified Core loaders.",
        "read-only",
        [PATH_ARGUMENT, PROJECT_ARGUMENT, JSON_ARGUMENT],
    ),
    descriptor(
        "studio.serve",
        "aq studio serve <path> [--project ID] [--host HOST] [--port PORT] [--no-open]",
        "Serve the packaged local read-only quant research workbench until interrupted.",
        "long-running-server",
        [
            PATH_ARGUMENT,
            PROJECT_ARGUMENT,
            argument(
                "host",
                "option",
                "string",
                False,
                "Local bind address; non-loopback binding is an explicit operator choice.",
                default="127.0.0.1",
            ),
            argument(
                "port",
                "option",
                "integer",
                False,
                "Local HTTP port.",
                default=8765,
            ),
            argument(
                "no-open",
                "option",
                "boolean",
                False,
                "Do not open the default browser.",
                default=False,
            ),
        ],
        supports_json=False,
    ),
]
