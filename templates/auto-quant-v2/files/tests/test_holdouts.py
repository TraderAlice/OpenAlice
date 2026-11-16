from __future__ import annotations

import json
import shutil
import tempfile
import unittest
from pathlib import Path

import jsonschema

from autoquant.dossiers import publish_dossier
from autoquant.holdouts import (
    HOLDOUT_ASSESSMENT_ANALYSIS_JSON_SCHEMA,
    HOLDOUT_ASSESSMENT_JSON_SCHEMA,
    HOLDOUT_BINDING_JSON_SCHEMA,
    HOLDOUT_RESULT_JSON_SCHEMA,
    HOLDOUT_STATUS_JSON_SCHEMA,
    bind_holdout,
    build_holdout_evidence,
    create_holdout_target,
    load_holdout_assessment,
    load_holdout_binding,
    load_holdout_result,
    load_holdout_status,
    run_holdout,
    validate_holdout_assessment_analysis,
)
from autoquant.intake import prepare_project_intake
from autoquant.orientation import (
    AGENT_WORK_BRIEF_JSON_SCHEMA,
    build_agent_work_brief,
)
from autoquant.reports import publish_report
from autoquant.runs import execute_study, load_run
from autoquant.sessions import start_session
from autoquant.studio import STUDIO_SNAPSHOT_JSON_SCHEMA, build_studio_snapshot
from autoquant.studies import hash_file
from autoquant.templates import (
    OHLCV_STUDY_ID,
    PORTFOLIO_STUDY_ID,
    RL_STUDY_ID,
)
from autoquant.workspace import (
    AutoQuantValidationError,
    create_project,
    initialize_workspace,
    load_project,
)
from tests.intake_helpers import write_intake_inputs
from tests.test_dossiers import dossier_analysis, lane_analysis, run_cli


class FrozenExternalHoldoutTests(unittest.TestCase):
    def _assessment_analysis(self, lane_ids: list[str]) -> dict:
        return {
            "schemaVersion": 1,
            "kind": "autoquant-holdout-assessment-analysis",
            "title": "Frozen later-period assessment",
            "executiveSummary": (
                "The frozen lanes provide mixed later-period evidence."
            ),
            "overallAssessment": "mixed",
            "lanes": [
                {
                    "id": lane_id,
                    "assessment": (
                        "weakened" if lane_id == "factor" else "persisted"
                    ),
                    "summary": f"The frozen {lane_id} lane was assessed separately.",
                }
                for lane_id in lane_ids
            ],
            "interpretation": [
                "Lane-specific evidence must not be collapsed into one Core pass rule."
            ],
            "limitations": ["The later panel is one external period."],
            "recommendations": ["Preserve the frozen evidence for review."],
        }

    def test_assessment_analysis_requires_exact_frozen_lane_order(self) -> None:
        analysis = self._assessment_analysis(["factor", "portfolio"])
        validate_holdout_assessment_analysis(
            analysis,
            ["factor", "portfolio"],
        )
        analysis["lanes"].reverse()
        with self.assertRaises(AutoQuantValidationError) as error:
            validate_holdout_assessment_analysis(
                analysis,
                ["factor", "portfolio"],
            )
        self.assertIn(
            "holdout.lane-set",
            {issue.code for issue in error.exception.issues},
        )

    def _intake_project(
        self,
        workspace,
        root: Path,
        project_id: str,
        *,
        start: str,
        dataset_id: str,
        dataset_version: str,
        question: str | None = None,
    ):
        root.mkdir()
        request_path, package_path = write_intake_inputs(
            root,
            start=start,
            dataset_id=dataset_id,
            dataset_version=dataset_version,
        )
        if question is not None:
            request = json.loads(request_path.read_text(encoding="utf-8"))
            request["question"] = question
            request_path.write_text(
                json.dumps(request, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
        prepared = prepare_project_intake(
            request_path,
            package_path,
            "ohlcv-research-desk",
        )
        project = create_project(
            workspace.root_dir,
            project_id,
            name=prepared.request["title"],
            description=prepared.request["question"],
            template=prepared.template,
            template_intake=prepared,
        )
        return project, prepared.request

    def _source_with_dossier(
        self,
        workspace,
        root: Path,
        *,
        include_portfolio: bool = True,
        include_rl: bool = False,
    ):
        project, request = self._intake_project(
            workspace,
            root,
            "source-desk",
            start="2024-01-02",
            dataset_id="source-equities",
            dataset_version="2024-v1",
        )
        reports = {}
        lanes = [("factor", OHLCV_STUDY_ID)]
        if include_portfolio:
            lanes.append(("portfolio", PORTFOLIO_STUDY_ID))
        if include_rl:
            lanes.append(("rl", RL_STUDY_ID))
        for lane_id, study_id in lanes:
            execute_study(project, study_id)
            session = start_session(project, study_id, request=request)
            report = publish_report(
                project,
                session.manifest["id"],
                lane_analysis(
                    lane_id,
                    session.manifest["leader"]["runId"],
                ),
            )
            reports[lane_id] = report.report["id"]
        dossier = publish_dossier(project, dossier_analysis(reports))
        return project, dossier

    def test_atomic_factor_only_target_accepts_short_later_period(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            workspace = initialize_workspace(root / "workspace", name="Quant Desk")
            source, source_request_value = self._intake_project(
                workspace,
                root / "source-input",
                "source-desk",
                start="2024-01-02",
                dataset_id="source-equities",
                dataset_version="2024-v1",
            )
            source_run = execute_study(source, OHLCV_STUDY_ID)
            session = start_session(
                source,
                OHLCV_STUDY_ID,
                request=source_request_value,
            )
            report = publish_report(
                source,
                session.manifest["id"],
                lane_analysis("factor", source_run.result["id"]),
            )
            dossier = publish_dossier(
                source,
                {
                    "schemaVersion": 1,
                    "kind": "autoquant-research-dossier-analysis",
                    "title": "Frozen Factor evidence",
                    "executiveSummary": (
                        "The exact Factor leader is frozen for a later audit."
                    ),
                    "findings": [
                        {
                            "id": "factor-only",
                            "claim": "The Factor leader is the frozen evidence.",
                            "confidence": "medium",
                            "evidenceRefs": [
                                {
                                    "laneId": "factor",
                                    "reportId": report.report["id"],
                                    "findingId": "factor-headline",
                                }
                            ],
                        }
                    ],
                    "recommendations": [],
                    "limitations": ["No Portfolio or RL lane is included."],
                    "unresolvedQuestions": [],
                },
            )
            target_input = root / "target-input"
            target_input.mkdir()
            _, package_path = write_intake_inputs(
                target_input,
                observations=141,
                start="2025-01-02",
                dataset_id="later-equities",
                dataset_version="2025-v1",
            )
            source_request = (
                source.root_dir / "request.json"
            )
            with self.assertRaises(AutoQuantValidationError) as ordinary_error:
                prepare_project_intake(
                    source_request,
                    package_path,
                    "ohlcv-research-desk",
                )
            self.assertIn(
                "dataset.observations",
                {issue.code for issue in ordinary_error.exception.issues},
            )

            cli_create = run_cli(
                "holdout",
                "create-target",
                str(source.root_dir),
                str(workspace.root_dir),
                "short-factor-holdout",
                "--dossier",
                dossier.dossier["id"],
                "--dataset",
                str(package_path),
                "--json",
            )
            self.assertEqual(cli_create.returncode, 0, cli_create.stderr)
            self.assertEqual(
                json.loads(cli_create.stdout)["command"],
                "holdout.create-target",
            )
            target = load_project(
                workspace.projects_dir / "short-factor-holdout"
            )
            binding = load_holdout_binding(target)
            self.assertEqual(
                [lane["id"] for lane in binding.binding["source"]["lanes"]],
                ["factor"],
            )
            self.assertEqual(
                (target.root_dir / "request.json").read_bytes(),
                source_request.read_bytes(),
            )
            target_factor_judge = target.root_dir / "judges/ohlcv_factor.py"
            self.assertIn(
                "Selection is already frozen; sparse secondary diagnostics",
                target_factor_judge.read_text(encoding="utf-8"),
            )
            self.assertNotIn(
                "Selection is already frozen; sparse secondary diagnostics",
                (source.root_dir / "judges/ohlcv_factor.py").read_text(
                    encoding="utf-8"
                ),
            )
            self.assertEqual(
                load_holdout_status(target)["nextAction"]["id"],
                "holdout.run",
            )
            brief = build_agent_work_brief(target)
            self.assertEqual(brief["primaryAction"]["id"], "holdout.run")
            self.assertEqual(
                brief["externalHoldout"]["state"],
                "bound",
            )
            snapshot = build_studio_snapshot(target.root_dir)
            self.assertEqual(
                snapshot["projects"][0]["externalHoldout"]["state"],
                "bound",
            )
            result = run_holdout(target)
            self.assertEqual(result.result["status"], "succeeded")
            self.assertEqual(
                [lane["id"] for lane in result.result["lanes"]],
                ["factor"],
            )
            self.assertFalse(result.result["authority"]["selectionAllowed"])
            self.assertEqual(
                result.result["authority"]["tradingAuthority"],
                "none",
            )
            holdout_run = load_run(
                target,
                result.result["lanes"][0]["holdout"]["runId"],
            )
            self.assertEqual(
                holdout_run.result["execution"]["evaluationRole"],
                "external-temporal-audit",
            )
            frozen_identity = json.loads(
                (holdout_run.root_dir / "inputs/identity.json").read_text(
                    encoding="utf-8"
                )
            )
            self.assertEqual(
                frozen_identity["judgeHashes"]["judges/ohlcv_factor.py"],
                hash_file(target_factor_judge),
            )
            self.assertFalse(
                holdout_run.result["metrics"]["horizon_quality"]["10"][
                    "validation"
                ]["sufficient"]
            )

            overlap_input = root / "overlap-atomic-input"
            overlap_input.mkdir()
            _, overlap_package = write_intake_inputs(
                overlap_input,
                observations=141,
                start="2024-06-03",
                dataset_id="overlap-equities",
                dataset_version="2024-v2",
            )
            empty_workspace = initialize_workspace(
                root / "empty-target-workspace",
                name="Empty Target Desk",
            )
            configuration_before = (
                empty_workspace.configuration_path.read_bytes()
            )
            with self.assertRaises(AutoQuantValidationError) as overlap_error:
                create_holdout_target(
                    source,
                    dossier.dossier["id"],
                    empty_workspace.root_dir,
                    "overlap-atomic-target",
                    overlap_package,
                )
            self.assertIn(
                "holdout.period-overlap",
                {issue.code for issue in overlap_error.exception.issues},
            )
            self.assertFalse(
                (
                    empty_workspace.projects_dir / "overlap-atomic-target"
                ).exists()
            )
            self.assertEqual(
                empty_workspace.configuration_path.read_bytes(),
                configuration_before,
            )

    def _target(self, workspace, root: Path, project_id: str = "holdout-desk"):
        project, _ = self._intake_project(
            workspace,
            root,
            project_id,
            start="2025-01-02",
            dataset_id=f"{project_id}-equities",
            dataset_version="2025-v1",
        )
        return project

    def test_binding_is_portable_frozen_and_one_shot(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            workspace = initialize_workspace(root / "workspace", name="Quant Desk")
            source, dossier = self._source_with_dossier(
                workspace,
                root / "source-input",
                include_rl=True,
            )
            target = self._target(workspace, root / "target-input")

            cli_bind = run_cli(
                "holdout",
                "bind",
                str(source.root_dir),
                str(target.root_dir),
                "--dossier",
                dossier.dossier["id"],
                "--json",
            )
            self.assertEqual(cli_bind.returncode, 0, cli_bind.stderr)
            self.assertEqual(
                json.loads(cli_bind.stdout)["command"],
                "holdout.bind",
            )
            binding = load_holdout_binding(target)
            jsonschema.validate(binding.binding, HOLDOUT_BINDING_JSON_SCHEMA)
            self.assertEqual(
                [lane["id"] for lane in binding.binding["source"]["lanes"]],
                ["factor", "portfolio", "rl"],
            )
            self.assertTrue(binding.binding["nonOverlap"]["strictlyLater"])
            self.assertFalse(binding.binding["policy"]["selectionAllowed"])
            self.assertEqual(
                (target.root_dir / "factors/candidate.py").read_bytes(),
                (
                    binding.root_dir
                    / "imported-sources/factors/candidate.py"
                ).read_bytes(),
            )
            self.assertEqual(
                (target.root_dir / "models/candidate.py").read_bytes(),
                (
                    binding.root_dir
                    / "imported-sources/models/candidate.py"
                ).read_bytes(),
            )
            brief = build_agent_work_brief(target)
            jsonschema.validate(brief, AGENT_WORK_BRIEF_JSON_SCHEMA)
            self.assertEqual(brief["focus"]["laneId"], "external-holdout")
            self.assertFalse(brief["filesystem"]["writable"])
            self.assertEqual(brief["primaryAction"]["id"], "holdout.run")
            self.assertEqual(brief["externalHoldout"]["state"], "bound")
            self.assertEqual(
                brief["researchAgenda"]["status"],
                "waiting-evidence",
            )
            bound_snapshot = build_studio_snapshot(target.root_dir)
            jsonschema.validate(
                bound_snapshot,
                STUDIO_SNAPSHOT_JSON_SCHEMA,
            )
            self.assertEqual(
                bound_snapshot["projects"][0]["externalHoldout"]["state"],
                "bound",
            )
            bound_project = bound_snapshot["projects"][0]
            self.assertEqual(
                [item["id"] for item in bound_project["intake"]["commands"]],
                ["holdout.run"],
            )
            self.assertEqual(
                bound_project["researchProgramStatus"][
                    "recommendedAction"
                ]["id"],
                "holdout.run",
            )
            self.assertIsNone(
                bound_project["researchProgramStatus"]["recommendedLaneId"]
            )
            self.assertFalse(
                any(
                    command["effect"] != "read-only"
                    for lane in bound_project["researchProgramStatus"]["lanes"]
                    for command in lane["commands"]
                )
            )
            self.assertNotIn(
                "session.start",
                {item["id"] for item in bound_project["commands"]},
            )
            self.assertEqual(
                bound_project["dossierStatus"]["nextAction"]["id"],
                "holdout.run",
            )

            with self.assertRaises(AutoQuantValidationError) as session_error:
                start_session(target, OHLCV_STUDY_ID)
            self.assertEqual(
                session_error.exception.issues[0].code,
                "holdout.frozen-project",
            )
            with self.assertRaises(AutoQuantValidationError) as run_error:
                execute_study(target, OHLCV_STUDY_ID)
            self.assertEqual(
                run_error.exception.issues[0].code,
                "holdout.run-required",
            )

            cli_status = run_cli(
                "holdout",
                "status",
                str(target.root_dir),
                "--json",
            )
            self.assertEqual(cli_status.returncode, 0, cli_status.stderr)
            self.assertEqual(
                json.loads(cli_status.stdout)["data"]["state"],
                "bound",
            )
            cli_run = run_cli(
                "holdout",
                "run",
                str(target.root_dir),
                "--json",
            )
            self.assertEqual(cli_run.returncode, 0, cli_run.stderr)
            self.assertEqual(
                json.loads(cli_run.stdout)["command"],
                "holdout.run",
            )
            result = load_holdout_result(target)
            jsonschema.validate(result.result, HOLDOUT_RESULT_JSON_SCHEMA)
            self.assertEqual(result.result["status"], "succeeded")
            self.assertEqual(
                [lane["id"] for lane in result.result["lanes"]],
                ["factor", "portfolio", "rl"],
            )
            self.assertTrue(
                all(lane["delta"] is not None for lane in result.result["lanes"])
            )
            self.assertTrue(
                all(
                    lane["source"]["harness"]["commit"]
                    and lane["holdout"]["harness"]["commit"]
                    for lane in result.result["lanes"]
                )
            )
            repeated = run_holdout(target)
            self.assertEqual(repeated.result["id"], result.result["id"])
            self.assertEqual(
                [lane["holdout"]["runId"] for lane in repeated.result["lanes"]],
                [lane["holdout"]["runId"] for lane in result.result["lanes"]],
            )
            status = load_holdout_status(target)
            jsonschema.validate(status, HOLDOUT_STATUS_JSON_SCHEMA)
            self.assertEqual(status["state"], "completed")
            self.assertEqual(status["nextAction"]["id"], "holdout.assess")
            self.assertIn(
                "aq holdout assess",
                status["nextAction"]["display"],
            )
            self.assertEqual(
                status["nextAction"]["argv"][-2],
                str(target.root_dir / "holdout-analysis.json"),
            )
            completed_brief = build_agent_work_brief(target)
            jsonschema.validate(
                completed_brief,
                AGENT_WORK_BRIEF_JSON_SCHEMA,
            )
            self.assertEqual(completed_brief["review"]["status"], "pending")
            self.assertEqual(
                completed_brief["primaryAction"]["id"],
                "holdout.assess",
            )
            self.assertEqual(
                completed_brief["supportingActions"][0]["id"],
                "holdout.show",
            )
            self.assertEqual(
                completed_brief["externalHoldout"]["result"]["id"],
                result.result["id"],
            )
            completed_snapshot = build_studio_snapshot(target.root_dir)
            jsonschema.validate(
                completed_snapshot,
                STUDIO_SNAPSHOT_JSON_SCHEMA,
            )
            self.assertEqual(
                completed_snapshot["projects"][0]["externalHoldout"]["state"],
                "completed",
            )
            self.assertIsNotNone(
                completed_snapshot["projects"][0]["externalHoldout"]["evidence"]
            )
            evidence = build_holdout_evidence(target)
            self.assertEqual(
                [lane["id"] for lane in evidence["lanes"]],
                ["factor", "portfolio", "rl"],
            )
            self.assertIsNotNone(evidence["lanes"][0]["holdoutDiagnostics"])
            self.assertIsNotNone(evidence["lanes"][1]["holdoutDiagnostics"])
            self.assertIsNone(evidence["lanes"][2]["holdoutDiagnostics"])

            analysis = self._assessment_analysis(["factor", "portfolio", "rl"])
            jsonschema.validate(
                analysis,
                HOLDOUT_ASSESSMENT_ANALYSIS_JSON_SCHEMA,
            )
            analysis_path = root / "holdout-analysis.json"
            analysis_path.write_text(
                json.dumps(analysis, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            cli_assess = run_cli(
                "holdout",
                "assess",
                str(target.root_dir),
                "--analysis",
                str(analysis_path),
                "--json",
            )
            self.assertEqual(cli_assess.returncode, 0, cli_assess.stderr)
            self.assertEqual(
                json.loads(cli_assess.stdout)["command"],
                "holdout.assess",
            )
            assessment = load_holdout_assessment(target)
            jsonschema.validate(
                assessment.assessment,
                HOLDOUT_ASSESSMENT_JSON_SCHEMA,
            )
            self.assertEqual(assessment.assessment["overallAssessment"], "mixed")
            self.assertIn(
                "Universal pass threshold: `null`",
                (assessment.root_dir / "assessment.md").read_text(encoding="utf-8"),
            )
            self.assertEqual(
                load_holdout_assessment(target).assessment["id"],
                assessment.assessment["id"],
            )
            assessed_status = load_holdout_status(target)
            self.assertEqual(assessed_status["state"], "assessed")
            self.assertEqual(assessed_status["nextAction"]["id"], "holdout.show")
            assessed_brief = build_agent_work_brief(target)
            self.assertEqual(assessed_brief["review"]["status"], "complete")
            self.assertEqual(
                assessed_brief["focus"]["scientificStage"],
                "external-holdout-complete",
            )
            assessed_snapshot = build_studio_snapshot(target.root_dir)
            self.assertEqual(
                assessed_snapshot["projects"][0]["externalHoldout"]["state"],
                "assessed",
            )
            self.assertEqual(
                assessed_snapshot["projects"][0]["externalHoldout"][
                    "assessment"
                ]["id"],
                assessment.assessment["id"],
            )

            source_root = source.root_dir
            detached = source_root.with_name("detached-source")
            source_root.rename(detached)
            portable = load_project(target.root_dir)
            self.assertEqual(
                load_holdout_binding(portable).binding["id"],
                binding.binding["id"],
            )
            self.assertEqual(
                load_holdout_result(portable).result["id"],
                result.result["id"],
            )
            assessment_markdown = (
                target.root_dir / "holdout/assessment/assessment.md"
            )
            assessment_markdown_bytes = assessment_markdown.read_bytes()
            assessment_markdown.write_text(
                "# Fabricated conclusion\n",
                encoding="utf-8",
            )
            with self.assertRaises(AutoQuantValidationError) as assessment_error:
                load_holdout_assessment(portable)
            self.assertIn(
                "holdout.assessment-content",
                {issue.code for issue in assessment_error.exception.issues},
            )
            assessment_markdown.write_bytes(assessment_markdown_bytes)

            result_path = (
                target.root_dir / "holdout/result/result.json"
            )
            result_manifest_path = (
                target.root_dir / "holdout/result/manifest.json"
            )
            fabricated = json.loads(result_path.read_text(encoding="utf-8"))
            fabricated["lanes"][0]["delta"] += 1.0
            result_path.write_text(
                json.dumps(fabricated, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            result_manifest = json.loads(
                result_manifest_path.read_text(encoding="utf-8")
            )
            result_manifest["files"]["result.json"] = hash_file(result_path)
            result_manifest["resultHash"] = hash_file(result_path)
            result_manifest_path.write_text(
                json.dumps(result_manifest, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            with self.assertRaises(AutoQuantValidationError) as result_error:
                load_holdout_result(portable)
            self.assertIn(
                "holdout.result-delta",
                {issue.code for issue in result_error.exception.issues},
            )

    def test_binding_rejects_overlap_history_and_tampering(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            workspace = initialize_workspace(root / "workspace", name="Quant Desk")
            source, dossier = self._source_with_dossier(
                workspace,
                root / "source-input",
            )
            overlap, _ = self._intake_project(
                workspace,
                root / "overlap-input",
                "overlap-desk",
                start="2024-06-03",
                dataset_id="overlap-equities",
                dataset_version="2024-v2",
            )
            with self.assertRaises(AutoQuantValidationError) as overlap_error:
                bind_holdout(source, dossier.dossier["id"], overlap)
            self.assertIn(
                "holdout.period-overlap",
                {issue.code for issue in overlap_error.exception.issues},
            )

            mismatch, _ = self._intake_project(
                workspace,
                root / "mismatch-input",
                "mismatch-desk",
                start="2025-01-02",
                dataset_id="mismatch-equities",
                dataset_version="2025-v1",
                question="Does a different research question survive?",
            )
            with self.assertRaises(AutoQuantValidationError) as mismatch_error:
                bind_holdout(source, dossier.dossier["id"], mismatch)
            self.assertIn(
                "holdout.request-mismatch",
                {issue.code for issue in mismatch_error.exception.issues},
            )

            used = self._target(
                workspace,
                root / "used-input",
                "used-desk",
            )
            execute_study(used, OHLCV_STUDY_ID)
            with self.assertRaises(AutoQuantValidationError) as used_error:
                bind_holdout(source, dossier.dossier["id"], used)
            self.assertIn(
                "holdout.target-runs",
                {issue.code for issue in used_error.exception.issues},
            )

            target = self._target(
                workspace,
                root / "target-input",
                "tamper-desk",
            )
            bind_holdout(source, dossier.dossier["id"], target)
            (target.root_dir / "factors/candidate.py").write_text(
                "def compute_factor(panel):\n    return panel['close']\n",
                encoding="utf-8",
            )
            with self.assertRaises(AutoQuantValidationError) as tamper_error:
                load_holdout_binding(target)
            self.assertIn(
                "holdout.import-tampered",
                {issue.code for issue in tamper_error.exception.issues},
            )

            shutil.rmtree(target.root_dir / "holdout")
            self.assertIsNone(load_holdout_status(target, optional=True))


if __name__ == "__main__":
    unittest.main()
