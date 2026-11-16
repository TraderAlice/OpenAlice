from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import autoquant.research_program as research_program_module
import jsonschema

from autoquant.intake import prepare_project_intake
from autoquant.orientation import build_agent_work_brief
from autoquant.research_agenda import (
    RESEARCH_AGENDA_JSON_SCHEMA,
    build_research_agenda,
)
from autoquant.reports import publish_report
from autoquant.research_program import (
    RESEARCH_PROGRAM_STATUS_JSON_SCHEMA,
    load_research_program,
)
from autoquant.runs import execute_study
from autoquant.sessions import (
    complete_session,
    evaluate_experiment,
    load_session,
    start_session,
)
from autoquant.studio import build_studio_snapshot
from autoquant.studies import hash_json, load_study
from autoquant.templates import (
    OHLCV_STUDY_ID,
    PORTFOLIO_STUDY_ID,
    RL_STUDY_ID,
)
from autoquant.workspace import create_project, initialize_workspace
from tests.intake_helpers import write_intake_inputs


CONSTANT_TEMPORAL_FACTOR = """\
from __future__ import annotations

import pandas as pd


def compute_factor(panel: pd.DataFrame) -> pd.Series:
    return pd.Series(1.0, index=panel.index)
"""


def _report_analysis(run) -> dict:
    reference = {
        "kind": "run",
        "id": run.result["id"],
        "artifactPath": run.result["artifacts"][0]["path"],
    }
    return {
        "schemaVersion": 1,
        "kind": "autoquant-research-report-analysis",
        "title": "Evidence-gated lane report",
        "executiveSummary": (
            "The immutable leader evidence is frozen for bounded downstream "
            "research prioritization without trading authority."
        ),
        "findings": [
            {
                "id": "leader-evidence",
                "claim": "The current leader has verified immutable evidence.",
                "confidence": "medium",
                "evidenceRefs": [reference],
            }
        ],
        "recommendations": [
            {
                "action": "Follow the Core-owned program progression.",
                "rationale": "Coordination phase alone is not scientific readiness.",
                "conditions": ["Validation-only gates remain authoritative."],
                "evidenceRefs": [reference],
            }
        ],
        "limitations": ["This Report has no trading authority."],
        "unresolvedQuestions": ["Does the next fixed research gate pass?"],
    }


def _passing_factor_selection_integrity() -> dict:
    return {
        "selectionAdjustment": {
            "status": "available",
            "passes": True,
        }
    }


class MultiStudyResearchProgramTests(unittest.TestCase):
    def test_scientific_limit_blocks_downstream_and_never_retries_unchanged_lane(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            request_path, package_path = write_intake_inputs(
                root,
                request_assets=("NVDA",),
                asset_position_roles={"NVDA": "two-sided"},
                factor_policy={"claim": "decision-signal", "knownStyle": None},
            )
            prepared = prepare_project_intake(
                request_path,
                package_path,
                "ohlcv-research-desk",
            )
            project = create_project(
                initialize_workspace(root / "workspace").root_dir,
                "scientific-limit-program",
                template=prepared.template,
                template_intake=prepared,
            )
            (project.root_dir / "factors" / "candidate.py").write_text(
                CONSTANT_TEMPORAL_FACTOR,
                encoding="utf-8",
            )
            failed = execute_study(project, OHLCV_STUDY_ID)
            self.assertEqual(
                failed.result["failureDisposition"],
                "scientific-limit",
            )

            program = load_research_program(project)
            jsonschema.validate(program, RESEARCH_PROGRAM_STATUS_JSON_SCHEMA)
            factor = program["lanes"][0]
            self.assertEqual(factor["phase"], "scientific-limit")
            self.assertTrue(factor["currentAttempt"])
            self.assertFalse(factor["currentRun"])
            self.assertEqual(
                factor["latestRun"]["failureDisposition"],
                "scientific-limit",
            )
            self.assertEqual(
                program["progression"]["gates"][0]["status"],
                "blocked-scientific-limit",
            )
            self.assertEqual(program["recommendedAction"]["id"], "report.publish")
            self.assertNotIn(
                "run.execute",
                [command["id"] for command in factor["commands"]],
            )
            self.assertEqual(len(program["lanes"][1]["reports"]), 0)
            brief = build_agent_work_brief(project)
            self.assertEqual(
                brief["reasons"][0]["code"],
                "scientific-limit-report-required",
            )
            self.assertEqual(brief["primaryAction"]["id"], "report.publish")

    def test_delegated_keep_requires_report_then_routes_primary_promotion(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            request_path, package_path = write_intake_inputs(root)
            request = json.loads(request_path.read_text(encoding="utf-8"))
            workspace = initialize_workspace(root / "workspace", name="Quant Desk")
            prepared = prepare_project_intake(
                request_path,
                package_path,
                "ohlcv-research-desk",
            )
            project = create_project(
                workspace.root_dir,
                "delegated-promotion-desk",
                name=prepared.request["title"],
                description=prepared.request["question"],
                template=prepared.template,
                template_intake=prepared,
            )
            session = start_session(
                project,
                OHLCV_STUDY_ID,
                request=request,
            )
            candidate = (
                session.worktree_project.root_dir
                / "factors"
                / "candidate.py"
            )
            candidate.write_text(
                "from __future__ import annotations\n\n"
                "import pandas as pd\n\n"
                "def compute_factor(panel: pd.DataFrame) -> pd.Series:\n"
                "    return panel.groupby(\"asset\", sort=False)"
                "[\"close\"].pct_change(1, fill_method=None)\n",
                encoding="utf-8",
            )
            experiment = evaluate_experiment(
                project,
                session.manifest["id"],
                "Test one causal one-bar persistence behavior.",
            )
            self.assertEqual(experiment.result["verdict"], "KEEP")

            awaiting_report = build_agent_work_brief(project)

            self.assertEqual(
                awaiting_report["reasons"][0]["code"],
                "report-required",
            )
            self.assertIsNone(awaiting_report["primaryAction"])
            self.assertEqual(awaiting_report["supportingActions"], [])
            self.assertEqual(
                awaiting_report["focus"]["operatingMode"],
                "publish-evidence",
            )
            self.assertIn(
                "publish an exact current Research Report",
                awaiting_report["review"]["next"],
            )

            current = load_session(project, session.manifest["id"])
            report = publish_report(
                project,
                session.manifest["id"],
                _report_analysis(current.leader_run),
            )
            ready = build_agent_work_brief(project)

            self.assertEqual(
                [item["code"] for item in ready["reasons"]],
                ["promotion-ready"],
            )
            self.assertEqual(ready["primaryAction"]["id"], "session.promote")
            self.assertEqual(
                ready["primaryAction"]["argv"][-3:],
                ["--report", report.report["id"], "--json"],
            )
            self.assertEqual(ready["evidence"]["reportId"], report.report["id"])
            observed = build_studio_snapshot(project.root_dir)["projects"][0]
            self.assertEqual(
                observed["agentWorkBrief"]["primaryAction"],
                ready["primaryAction"],
            )

    def test_reverted_candidate_does_not_replace_current_lane_evidence(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            request_path, package_path = write_intake_inputs(root)
            workspace = initialize_workspace(root / "workspace", name="Quant Desk")
            prepared = prepare_project_intake(
                request_path,
                package_path,
                "ohlcv-research-desk",
            )
            project = create_project(
                workspace.root_dir,
                "revert-aware-desk",
                name=prepared.request["title"],
                description=prepared.request["question"],
                template=prepared.template,
                template_intake=prepared,
            )
            session = start_session(project, OHLCV_STUDY_ID)
            baseline_id = session.manifest["baseline"]["runId"]
            candidate = (
                session.worktree_project.root_dir
                / "factors"
                / "candidate.py"
            )
            candidate.write_text(
                "from __future__ import annotations\n\n"
                "import pandas as pd\n\n"
                "def compute_factor(panel: pd.DataFrame) -> pd.Series:\n"
                "    return -panel.groupby(\"asset\", sort=False)"
                "[\"close\"].pct_change(10, fill_method=None)\n",
                encoding="utf-8",
            )
            rejected = evaluate_experiment(
                project,
                session.manifest["id"],
                "Reverse a positive baseline to produce a rejected attempt.",
            )
            self.assertEqual(rejected.result["verdict"], "REVERT")

            status = load_research_program(project)
            assert status is not None
            factor = status["lanes"][0]

            self.assertTrue(factor["currentRun"])
            self.assertEqual(factor["phase"], "researching")
            self.assertEqual(factor["latestRun"]["id"], baseline_id)
            self.assertNotEqual(
                factor["latestRun"]["id"],
                rejected.result["candidate"]["runId"],
            )
            studio = build_studio_snapshot(project.root_dir)
            observed = studio["projects"][0]
            self.assertEqual(
                observed["factorExplorer"]["run"]["id"],
                baseline_id,
            )

    def test_one_intake_coordinates_factor_portfolio_and_rl_evidence(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            request_path, package_path = write_intake_inputs(root)
            workspace = initialize_workspace(root / "workspace", name="Quant Desk")
            prepared = prepare_project_intake(
                request_path,
                package_path,
                "ohlcv-research-desk",
            )
            project = create_project(
                workspace.root_dir,
                "leadership-desk",
                name=prepared.request["title"],
                description=prepared.request["question"],
                template=prepared.template,
                template_intake=prepared,
            )

            initial = load_research_program(project)
            assert initial is not None
            jsonschema.validate(initial, RESEARCH_PROGRAM_STATUS_JSON_SCHEMA)
            self.assertEqual(
                [lane["id"] for lane in initial["lanes"]],
                ["factor", "portfolio", "rl"],
            )
            self.assertEqual(
                [lane["phase"] for lane in initial["lanes"]],
                ["not-started", "not-started", "not-started"],
            )
            self.assertEqual(initial["recommendedLaneId"], "factor")
            self.assertEqual(initial["recommendedAction"]["id"], "session.start")
            self.assertEqual(
                initial["progression"]["stage"],
                "factor-evidence-required",
            )
            self.assertEqual(
                [gate["status"] for gate in initial["progression"]["gates"]],
                ["waiting-current-evidence", "blocked-prerequisite"],
            )
            initial_brief = build_agent_work_brief(project)
            self.assertEqual(
                initial_brief["primaryAction"]["id"],
                "session.start",
            )
            self.assertEqual(
                initial_brief["reasons"][0]["code"],
                "session-required",
            )
            self.assertEqual(
                {lane["study"]["datasetHash"] for lane in initial["lanes"]},
                {initial["datasetHash"]},
            )
            self.assertEqual(
                initial["lanes"][0]["study"]["sourceHash"],
                initial["lanes"][1]["study"]["sourceHash"],
            )
            self.assertNotEqual(
                initial["lanes"][1]["study"]["sourceHash"],
                initial["lanes"][2]["study"]["sourceHash"],
            )
            self.assertEqual(
                initial["lanes"][0]["study"]["sourceHash"],
                hash_json(
                    {
                        path: digest
                        for path, digest in initial["lanes"][2]["study"][
                            "dependencySourceHashes"
                        ].items()
                        if path.startswith("factors/")
                    }
                ),
            )
            self.assertEqual(
                initial["lanes"][0]["study"]["sourceHashes"],
                {
                    path: digest
                    for path, digest in initial["lanes"][2]["study"][
                        "dependencySourceHashes"
                    ].items()
                    if path.startswith("factors/")
                },
            )

            runs = {
                study_id: execute_study(project, study_id)
                for study_id in (
                    OHLCV_STUDY_ID,
                    PORTFOLIO_STUDY_ID,
                    RL_STUDY_ID,
                )
            }
            self.assertTrue(
                all(run.result["status"] == "succeeded" for run in runs.values())
            )
            factor_contracts = [
                runs[study_id].result["metrics"]["factor_api"]
                for study_id in (
                    OHLCV_STUDY_ID,
                    PORTFOLIO_STUDY_ID,
                    RL_STUDY_ID,
                )
            ]
            self.assertTrue(
                all(
                    contract["kind"] == "panel-v2"
                    and contract["input"]
                    == "long-form-observed-universe"
                    and contract["cross_asset_context"]
                    == "same-or-prior-timestamp-explicit-candidate"
                    and contract["causality_audit"]
                    == "whole-panel-timestamp-prefix"
                    for contract in factor_contracts
                )
            )
            self.assertTrue(
                all(contract == factor_contracts[0] for contract in factor_contracts)
            )
            for lane_id, study_id, editable_paths in (
                ("factor", OHLCV_STUDY_ID, ["factors/**"]),
                ("portfolio", PORTFOLIO_STUDY_ID, ["factors/**"]),
                ("rl", RL_STUDY_ID, ["models/**"]),
            ):
                agenda = build_research_agenda(
                    project,
                    runs[study_id].result["id"],
                    lane_id=lane_id,
                    editable_paths=editable_paths,
                )
                jsonschema.validate(
                    agenda,
                    RESEARCH_AGENDA_JSON_SCHEMA,
                )
                self.assertGreaterEqual(len(agenda["moves"]), 1)

            baseline = load_research_program(project)
            assert baseline is not None
            self.assertEqual(
                [lane["phase"] for lane in baseline["lanes"]],
                ["baseline-ready", "baseline-ready", "baseline-ready"],
            )
            self.assertTrue(
                all(lane["latestRun"]["value"] is not None for lane in baseline["lanes"])
            )
            self.assertEqual(
                baseline["progression"]["stage"],
                "factor-evidence-required",
            )
            self.assertEqual(
                baseline["progression"]["gates"][0]["status"],
                "blocked-upstream-evidence",
            )
            self.assertEqual(baseline["recommendedLaneId"], "factor")
            self.assertEqual(baseline["recommendedAction"]["id"], "session.start")
            baseline_brief = build_agent_work_brief(project)
            self.assertEqual(
                baseline_brief["reasons"][0]["code"],
                "scientific-gate-blocked",
            )
            self.assertEqual(
                baseline_brief["primaryAction"]["id"],
                "session.start",
            )
            self.assertFalse(baseline_brief["filesystem"]["writable"])

            snapshot = build_studio_snapshot(workspace.root_dir)
            observed = snapshot["projects"][0]["researchProgramStatus"]
            self.assertEqual(observed["datasetHash"], baseline["datasetHash"])
            self.assertEqual(observed["summary"]["lanes"], 3)

            start_session(project, OHLCV_STUDY_ID)
            start_session(project, PORTFOLIO_STUDY_ID)
            start_session(project, RL_STUDY_ID)
            conflicted = load_research_program(project)
            assert conflicted is not None
            self.assertEqual(conflicted["summary"]["activeSessions"], 3)
            self.assertEqual(conflicted["summary"]["conflicts"], 2)
            self.assertEqual(conflicted["conflicts"][0]["editablePath"], "factors/**")
            self.assertEqual(conflicted["conflicts"][0]["kind"], "writer-writer")
            self.assertEqual(conflicted["conflicts"][1]["kind"], "writer-reader")
            self.assertEqual(
                conflicted["conflicts"][1]["editablePath"],
                "factors/candidate.py",
            )
            conflict_brief = build_agent_work_brief(project)
            self.assertEqual(
                conflict_brief["reasons"][0]["code"],
                "shared-source-conflict",
            )
            self.assertIsNone(conflict_brief["primaryAction"])
            self.assertFalse(conflict_brief["filesystem"]["writable"])

            candidate_path = project.root_dir / "factors" / "candidate.py"
            candidate_path.write_text(
                candidate_path.read_text(encoding="utf-8")
                + "\n# evidence staleness probe\n",
                encoding="utf-8",
            )
            stale = load_research_program(project)
            assert stale is not None
            self.assertFalse(stale["lanes"][0]["currentRun"])
            self.assertFalse(stale["lanes"][1]["currentRun"])
            self.assertFalse(stale["lanes"][2]["currentRun"])
            self.assertEqual(
                [lane["phase"] for lane in stale["lanes"]],
                ["stale", "stale", "stale"],
            )
            self.assertEqual(stale["recommendedAction"]["id"], "session.show")
            stale_brief = build_agent_work_brief(project)
            self.assertEqual(
                stale_brief["researchAgenda"]["status"],
                "waiting-evidence",
            )
            self.assertEqual(
                stale_brief["researchAgenda"]["moves"],
                [],
            )

            self.assertEqual(
                load_study(project, OHLCV_STUDY_ID).dataset_hash,
                load_study(project, RL_STUDY_ID).dataset_hash,
            )
            manifest = json.loads(
                (project.root_dir / "research-program.json").read_text(
                    encoding="utf-8"
                )
            )
            self.assertEqual(manifest["template"], "ohlcv-research-desk")

    def test_terminal_weak_factor_session_exposes_fresh_session_entry(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            request_path, package_path = write_intake_inputs(root)
            request = json.loads(request_path.read_text(encoding="utf-8"))
            workspace = initialize_workspace(root / "workspace", name="Quant Desk")
            prepared = prepare_project_intake(
                request_path,
                package_path,
                "ohlcv-research-desk",
            )
            project = create_project(
                workspace.root_dir,
                "repeat-factor-desk",
                name=prepared.request["title"],
                description=prepared.request["question"],
                template=prepared.template,
                template_intake=prepared,
            )
            session = start_session(
                project,
                OHLCV_STUDY_ID,
                request=request,
            )
            report = publish_report(
                project,
                session.manifest["id"],
                _report_analysis(session.leader_run),
            )
            complete_session(
                project,
                session.manifest["id"],
                report.report["id"],
            )

            status = load_research_program(project)
            assert status is not None
            factor = status["lanes"][0]
            self.assertEqual(status["recommendedLaneId"], "factor")
            self.assertEqual(status["recommendedAction"]["id"], "session.start")
            self.assertIn(
                "session.start",
                {command["id"] for command in factor["commands"]},
            )
            self.assertEqual(
                status["progression"]["gates"][0]["status"],
                "blocked-upstream-evidence",
            )
            brief = build_agent_work_brief(project)
            self.assertEqual(
                brief["reasons"][0]["code"],
                "scientific-gate-blocked",
            )
            self.assertIsNone(brief["primaryAction"])
            self.assertEqual(
                [item["id"] for item in brief["supportingActions"]],
                ["session.start"],
            )
            self.assertIn(
                "Optionally continue",
                brief["supportingActions"][0]["description"],
            )
            self.assertEqual(brief["focus"]["operatingMode"], "observe")
            self.assertEqual(brief["review"]["status"], "blocked")
            self.assertFalse(brief["filesystem"]["writable"])

    def test_positive_reported_gates_complete_required_program(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace = initialize_workspace(Path(directory) / "workspace")
            project = create_project(
                workspace.root_dir,
                "gated-desk",
                template="ohlcv-research-desk",
            )
            lanes = {
                "factor": {
                    "latestRun": {"id": "run-factor"},
                    "currentRun": True,
                    "reports": [
                        {
                            "id": "report-factor",
                            "leaderRunId": "run-factor",
                            "selectionIntegrity": (
                                _passing_factor_selection_integrity()
                            ),
                        }
                    ],
                    "latestSession": {"status": "completed"},
                },
                "portfolio": {
                    "latestRun": {"id": "run-portfolio"},
                    "currentRun": True,
                    "reports": [
                        {
                            "id": "report-portfolio",
                            "leaderRunId": "run-portfolio",
                        }
                    ],
                    "latestSession": {"status": "completed"},
                },
                "rl": {
                    "latestRun": None,
                    "currentRun": False,
                    "reports": [],
                    "latestSession": None,
                },
            }
            positive_factor = {
                "factorQualification": {
                    "available": True,
                    "diagnosis": {
                        "stage": "factor-qualification-positive",
                        "iterationFocus": "portfolio-monetization-and-rl-context",
                        "explanation": "Distinct factor evidence is positive.",
                        "qualifiesForPortfolio": True,
                    },
                }
            }
            positive_portfolio = {
                "strategyViability": {
                    "diagnosis": {
                        "stage": "post-cost-edge-positive",
                        "iterationFocus": (
                            "robustness-capacity-and-external-holdout"
                        ),
                        "explanation": "Post-cost portfolio evidence is positive.",
                    }
                }
            }
            with (
                mock.patch.object(
                    research_program_module,
                    "load_factor_diagnostics",
                    return_value=positive_factor,
                ),
                mock.patch.object(
                    research_program_module,
                    "load_portfolio_diagnostics",
                    return_value=positive_portfolio,
                ),
            ):
                progression = research_program_module._research_progression(
                    project,
                    lanes,
                )

            self.assertEqual(
                [gate["status"] for gate in progression["gates"]],
                ["passed", "passed"],
            )
            self.assertEqual(
                progression["stage"],
                "required-research-complete",
            )
            self.assertIsNone(progression["focusLaneId"])
            self.assertEqual(progression["optionalLaneId"], "rl")

    def test_positive_factor_keeps_program_in_portfolio_until_post_cost_gate(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace = initialize_workspace(Path(directory) / "workspace")
            project = create_project(
                workspace.root_dir,
                "portfolio-gated-desk",
                template="ohlcv-research-desk",
            )
            lanes = {
                "factor": {
                    "latestRun": {"id": "run-factor"},
                    "currentRun": True,
                    "reports": [
                        {
                            "id": "report-factor",
                            "leaderRunId": "run-factor",
                            "selectionIntegrity": (
                                _passing_factor_selection_integrity()
                            ),
                        }
                    ],
                    "latestSession": {"status": "completed"},
                },
                "portfolio": {
                    "latestRun": {"id": "run-portfolio"},
                    "currentRun": True,
                    "reports": [
                        {
                            "id": "report-portfolio",
                            "leaderRunId": "run-portfolio",
                        }
                    ],
                    "latestSession": {"status": "completed"},
                },
                "rl": {
                    "latestRun": None,
                    "currentRun": False,
                    "reports": [],
                    "latestSession": None,
                },
            }
            with (
                mock.patch.object(
                    research_program_module,
                    "load_factor_diagnostics",
                    return_value={
                        "factorQualification": {
                            "available": True,
                            "diagnosis": {
                                "stage": "factor-qualification-positive",
                                "iterationFocus": "portfolio-monetization",
                                "explanation": "Factor evidence is positive.",
                                "qualifiesForPortfolio": True,
                            },
                        }
                    },
                ),
                mock.patch.object(
                    research_program_module,
                    "load_portfolio_diagnostics",
                    return_value={
                        "strategyViability": {
                            "diagnosis": {
                                "stage": "post-cost-edge-negative",
                                "iterationFocus": "turnover-and-cost-control",
                                "explanation": (
                                    "The mechanical implementation does not "
                                    "survive estimated costs."
                                ),
                            }
                        }
                    },
                ),
            ):
                progression = research_program_module._research_progression(
                    project,
                    lanes,
                )

            self.assertEqual(
                [gate["status"] for gate in progression["gates"]],
                ["passed", "blocked-upstream-evidence"],
            )
            self.assertEqual(
                progression["stage"],
                "portfolio-evidence-required",
            )
            self.assertEqual(progression["focusLaneId"], "portfolio")
            self.assertIsNone(progression["optionalLaneId"])

    def test_claim_positive_factor_still_requires_family_adjustment(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace = initialize_workspace(Path(directory) / "workspace")
            project = create_project(
                workspace.root_dir,
                "adjustment-gated-desk",
                template="ohlcv-research-desk",
            )
            lane = {
                "latestRun": {"id": "run-factor"},
                "currentRun": True,
                "reports": [
                    {
                        "id": "report-factor",
                        "leaderRunId": "run-factor",
                        "selectionIntegrity": {
                            "selectionAdjustment": {
                                "status": "available",
                                "passes": False,
                            }
                        },
                    }
                ],
            }
            with mock.patch.object(
                research_program_module,
                "load_factor_diagnostics",
                return_value={
                    "factorQualification": {
                        "available": True,
                        "diagnosis": {
                            "stage": "known-style-validation-positive",
                            "iterationFocus": "portfolio-monetization",
                            "explanation": "Known style evidence is positive.",
                            "qualifiesForPortfolio": True,
                        },
                    }
                },
            ):
                gate = research_program_module._factor_to_portfolio_gate(
                    project,
                    lane,
                )
            self.assertEqual(
                gate["status"],
                "blocked-selection-adjusted-evidence",
            )
            self.assertEqual(
                gate["diagnosisStage"],
                "known-style-validation-positive",
            )
