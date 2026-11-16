from __future__ import annotations

import json
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import jsonschema

from autoquant.intake import prepare_project_intake
from autoquant.orientation import (
    AGENT_WORK_BRIEF_JSON_SCHEMA,
    _factor_split_contrast,
    build_agent_work_brief,
)
from autoquant.reports import publish_report
from autoquant.run_reports import publish_run_report
from autoquant.runs import execute_study
from autoquant.sessions import (
    complete_session,
    evaluate_experiment,
    promote_session,
    start_session,
)
from autoquant.studies import (
    StudyResearchRequest,
    bind_upstream_evidence,
    create_study,
)
from autoquant.studio import build_studio_snapshot
from autoquant.templates import OHLCV_STUDY_ID
from autoquant.workspace import create_project, initialize_workspace
from tests.intake_helpers import (
    write_intake_inputs,
    write_multi_interval_inputs,
)
from tests.study_helpers import MALFORMED_JUDGE, make_project, study_definition
from tests.test_reports import report_analysis, research_request


class AgentOrientationTests(unittest.TestCase):
    def test_material_factor_split_contrast_is_visible_but_not_a_gate(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            _, project = make_project(directory)
            create_study(project, study_definition())
            run = execute_study(project, "factor-quality")
            factor_study = SimpleNamespace(
                definition=SimpleNamespace(
                    objective=SimpleNamespace(metric="validation_mean_ic")
                )
            )
            diagnostics = {
                "researchHorizon": {"primaryForwardBars": 1},
                "horizonProfile": [
                    {
                        "horizon": 1,
                        "train": {"meanRankIc": -0.04},
                        "validation": {"meanRankIc": 0.63},
                    }
                ],
            }

            with patch(
                "autoquant.orientation.load_run",
                return_value=SimpleNamespace(result={"status": "succeeded"}),
            ), patch(
                "autoquant.orientation.load_factor_diagnostics",
                return_value=diagnostics,
            ):
                contrast = _factor_split_contrast(
                    project,
                    run.result["id"],
                    factor_study,
                )

            self.assertEqual(contrast["runId"], run.result["id"])
            self.assertEqual(contrast["status"], "material-divergence")
            self.assertEqual(contrast["trainMeanRankIc"], -0.04)
            self.assertEqual(contrast["validationMeanRankIc"], 0.63)
            self.assertAlmostEqual(contrast["absoluteGap"], 0.67)
            self.assertEqual(contrast["visibilityThreshold"], 0.20)
            self.assertEqual(contrast["selectionSplit"], "validation")
            self.assertFalse(contrast["testEntersContrast"])
            self.assertEqual(contrast["authority"], "orientation-only-no-gate")

            with patch(
                "autoquant.orientation._factor_split_contrast",
                return_value=contrast,
            ):
                brief = build_agent_work_brief(project)
            jsonschema.validate(brief, AGENT_WORK_BRIEF_JSON_SCHEMA)
            self.assertEqual(brief["factorSplitContrast"], contrast)
            self.assertNotEqual(brief["reasons"][0]["code"], "factor-split-contrast")

            diagnostics["horizonProfile"][0]["train"]["meanRankIc"] = 0.50
            with patch(
                "autoquant.orientation.load_run",
                return_value=SimpleNamespace(result={"status": "succeeded"}),
            ), patch(
                "autoquant.orientation.load_factor_diagnostics",
                return_value=diagnostics,
            ):
                below_threshold = _factor_split_contrast(
                    project,
                    run.result["id"],
                    factor_study,
                )
            self.assertIsNone(below_threshold)

    def test_failed_baseline_requires_inspection_before_any_retry(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            _, project = make_project(directory)
            judge = project.root_dir / "judges" / "malformed.py"
            judge.write_text(MALFORMED_JUDGE, encoding="utf-8")
            create_study(
                project,
                study_definition(judge="judges/malformed.py"),
            )
            run = execute_study(project, "factor-quality")

            self.assertEqual(
                run.result["failureDisposition"],
                "repair-required",
            )
            brief = build_agent_work_brief(project)
            jsonschema.validate(brief, AGENT_WORK_BRIEF_JSON_SCHEMA)
            self.assertEqual(brief["evidence"]["runId"], run.result["id"])
            self.assertEqual(
                brief["evidence"]["failureDisposition"],
                "repair-required",
            )
            self.assertEqual(
                brief["reasons"][0]["code"],
                "baseline-repair-required",
            )
            self.assertEqual(brief["primaryAction"]["id"], "run.show")
            self.assertEqual(brief["primaryAction"]["effect"], "read-only")
            self.assertEqual(brief["researchAgenda"]["status"], "repair-required")
            self.assertNotIn(
                "run.execute",
                [brief["primaryAction"]["id"]]
                + [item["id"] for item in brief["supportingActions"]],
            )

            candidate = project.root_dir / "factors" / "candidate.py"
            candidate.write_text("SCORE = 2.0\n", encoding="utf-8")
            changed = build_agent_work_brief(project)
            self.assertIsNone(changed["evidence"]["runId"])
            self.assertIsNone(changed["evidence"]["failureDisposition"])
            self.assertEqual(
                changed["reasons"][0]["code"],
                "baseline-evidence-missing",
            )
            self.assertEqual(changed["primaryAction"]["id"], "session.start")

    def test_factor_candidate_contract_discloses_actual_interval_surface(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            workspace = initialize_workspace(root / "workspace")
            legacy = create_project(
                workspace.root_dir,
                "legacy-portfolio",
                template="ohlcv-portfolio-lab",
            )

            legacy_contract = build_agent_work_brief(legacy)[
                "candidateContract"
            ]

            self.assertEqual(legacy_contract["data"]["baseInterval"], "1d")
            self.assertEqual(legacy_contract["data"]["featureIntervals"], [])
            self.assertIn(
                "source branches and component declarations do not add",
                legacy_contract["data"]["availabilityRule"],
            )
            self.assertEqual(
                legacy_contract["components"]["roles"],
                ["cross-sectional-score", "timestamp-context"],
            )
            self.assertNotIn(
                "close__12h",
                legacy_contract["data"]["panelColumns"],
            )

            daily_root = root / "daily"
            daily_root.mkdir()
            daily_request, daily_package = write_intake_inputs(
                daily_root,
                observations=260,
            )
            package = json.loads(
                daily_package.read_text(encoding="utf-8")
            )
            package["schemaVersion"] = 4
            package["panelPolicy"] = {
                "alignment": "observed-only",
                "missingObservation": "absent-no-fill",
            }
            daily_package.write_text(
                json.dumps(package, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            daily_prepared = prepare_project_intake(
                daily_request,
                daily_package,
                "ohlcv-factor-lab",
            )
            daily = create_project(
                workspace.root_dir,
                "daily-factor",
                template=daily_prepared.template,
                template_intake=daily_prepared,
            )

            daily_contract = build_agent_work_brief(daily)[
                "candidateContract"
            ]
            jsonschema.validate(
                build_agent_work_brief(daily),
                AGENT_WORK_BRIEF_JSON_SCHEMA,
            )

            self.assertEqual(
                daily_contract["data"]["surfaceSource"],
                "content-locked-snapshot-v4",
            )
            self.assertEqual(daily_contract["data"]["baseInterval"], "1d")
            self.assertEqual(daily_contract["data"]["featureIntervals"], [])
            self.assertEqual(
                daily_contract["data"]["observationSemantics"]["timestampMeaning"],
                "session-date",
            )
            self.assertEqual(
                daily_contract["data"]["observationSemantics"]["targetClock"],
                "per-observed-timestamp",
            )
            self.assertNotIn(
                "close__12h",
                daily_contract["data"]["panelColumns"],
            )

            multi_root = root / "multi"
            multi_root.mkdir()
            request_path, package_path = write_multi_interval_inputs(
                multi_root,
            )
            prepared = prepare_project_intake(
                request_path,
                package_path,
                "ohlcv-portfolio-lab",
            )
            multi = create_project(
                workspace.root_dir,
                "multi-portfolio",
                template=prepared.template,
                template_intake=prepared,
            )

            multi_contract = build_agent_work_brief(multi)[
                "candidateContract"
            ]

            jsonschema.validate(
                build_agent_work_brief(multi),
                AGENT_WORK_BRIEF_JSON_SCHEMA,
            )
            self.assertEqual(multi_contract["data"]["baseInterval"], "1h")
            self.assertEqual(
                multi_contract["data"]["featureIntervals"],
                ["3h", "4h", "6h", "12h", "1d"],
            )
            self.assertIn(
                "close__12h",
                multi_contract["data"]["panelColumns"],
            )

    def test_fixed_template_surfaces_dependency_bound_project_request(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace = initialize_workspace(
                Path(directory) / "workspace",
                name="Quant Desk",
            )
            project = create_project(
                workspace.root_dir,
                "allocation-lab",
                template="ohlcv-allocation-lab",
            )
            request_path = project.root_dir / "request.json"

            brief = build_agent_work_brief(project)

            jsonschema.validate(brief, AGENT_WORK_BRIEF_JSON_SCHEMA)
            self.assertEqual(
                brief["question"],
                {
                    "title": "Synthetic equal-risk-contribution allocation",
                    "text": (
                        "Does fixed ERC improve on a fixed 60/40 reference?"
                    ),
                    "origin": "project-request",
                    "sourcePath": str(request_path),
                    "requestPath": str(request_path),
                },
            )

    def test_every_fixed_request_template_surfaces_project_request(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace = initialize_workspace(
                Path(directory) / "workspace",
                name="Quant Desk",
            )

            for template in (
                "ohlcv-allocation-lab",
                "ohlcv-book-risk-lab",
                "ohlcv-event-study-lab",
            ):
                with self.subTest(template=template):
                    project = create_project(
                        workspace.root_dir,
                        template.removeprefix("ohlcv-"),
                        template=template,
                    )
                    request_path = project.root_dir / "request.json"

                    question = build_agent_work_brief(project)["question"]

                    self.assertEqual(question["origin"], "project-request")
                    self.assertTrue(question["text"])
                    self.assertEqual(question["sourcePath"], str(request_path))
                    self.assertEqual(question["requestPath"], str(request_path))

    def test_unbound_tampered_invalid_and_symlink_requests_are_not_authority(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            workspace = initialize_workspace(root / "workspace", name="Quant Desk")
            project = create_project(
                workspace.root_dir,
                "allocation-lab",
                template="ohlcv-allocation-lab",
            )
            request_path = project.root_dir / "request.json"
            request = json.loads(request_path.read_text(encoding="utf-8"))
            request["question"] = "Tampered but schema-valid question"
            request_path.write_text(
                json.dumps(request, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            research_path = project.root_dir / "research.md"
            research_path.write_text(
                "# Allocation Lab\n\n"
                "## Question\n\n"
                "Does the explicit Markdown fallback remain visible?\n",
                encoding="utf-8",
            )

            tampered = build_agent_work_brief(project)["question"]

            self.assertEqual(tampered["origin"], "project-research-brief")
            self.assertEqual(
                tampered["text"],
                "Does the explicit Markdown fallback remain visible?",
            )
            request_path.write_text("{}\n", encoding="utf-8")
            invalid = build_agent_work_brief(project)["question"]
            self.assertEqual(invalid["origin"], "project-research-brief")

            unbound = create_project(
                workspace.root_dir,
                "unbound-lab",
                description="Safe manifest fallback",
            )
            (unbound.root_dir / "request.json").write_text(
                json.dumps(request, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            (unbound.root_dir / "research.md").write_text(
                "# Unbound Lab\n\n## Purpose\n\nNo explicit question.\n",
                encoding="utf-8",
            )
            unbound_question = build_agent_work_brief(unbound)["question"]
            self.assertEqual(unbound_question["origin"], "local")
            self.assertEqual(
                unbound_question["text"],
                "Safe manifest fallback",
            )

            symlinked = create_project(
                workspace.root_dir,
                "symlinked-lab",
                description="Safe symlink fallback",
                template="ohlcv-allocation-lab",
            )
            symlink_request = symlinked.root_dir / "request.json"
            outside = root / "outside-request.json"
            outside.write_bytes(symlink_request.read_bytes())
            symlink_request.unlink()
            symlink_request.symlink_to(outside)
            symlink_question = build_agent_work_brief(symlinked)["question"]
            self.assertEqual(symlink_question["origin"], "local")

    def test_local_question_comes_from_explicit_research_brief_section(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace = initialize_workspace(
                Path(directory) / "workspace",
                name="Quant Desk",
            )
            project = create_project(
                workspace.root_dir,
                "brief-lab",
                name="Brief Lab",
                description="Stale create-time description",
            )
            research_path = project.root_dir / "research.md"
            research_path.write_text(
                """# Brief Lab

## Context

Do not mistake this prose for the active question.

```markdown
## Research question

This fenced example is not authority.
```

### Research question and hypotheses

Does the maintained
multi-line question reach a replacement Agent?

#### Supporting detail

Preserve this deeper detail with the question.

### Constraints

Stop the extracted section here.
""",
                encoding="utf-8",
            )

            brief = build_agent_work_brief(project)

            jsonschema.validate(brief, AGENT_WORK_BRIEF_JSON_SCHEMA)
            self.assertEqual(
                brief["question"],
                {
                    "title": "Brief Lab",
                    "text": (
                        "Does the maintained\n"
                        "multi-line question reach a replacement Agent?\n\n"
                        "#### Supporting detail\n\n"
                        "Preserve this deeper detail with the question."
                    ),
                    "origin": "project-research-brief",
                    "sourcePath": str(research_path),
                    "requestPath": None,
                },
            )

    def test_research_brief_question_is_bounded_for_compact_orientation(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace = initialize_workspace(
                Path(directory) / "workspace",
                name="Quant Desk",
            )
            project = create_project(workspace.root_dir, "bounded-lab")
            (project.root_dir / "research.md").write_text(
                "# Bounded Lab\n\n## Research question\n\n"
                + "signal " * 1_000,
                encoding="utf-8",
            )

            question = build_agent_work_brief(project)["question"]

            self.assertEqual(question["origin"], "project-research-brief")
            self.assertLessEqual(len(question["text"]), 4_000)
            self.assertTrue(question["text"].endswith("…"))

    def test_qualified_question_heading_is_explicit_research_authority(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace = initialize_workspace(
                Path(directory) / "workspace",
                name="Quant Desk",
            )
            project = create_project(
                workspace.root_dir,
                "qualified-question-lab",
                description="Stale fallback",
            )
            research_path = project.root_dir / "research.md"
            research_path.write_text(
                """# Qualified Question Lab

### Question (bounded, falsifiable)

Does relative volume add validation-period information?

### Deliverable

Do not include this sibling section.
""",
                encoding="utf-8",
            )

            question = build_agent_work_brief(project)["question"]

            self.assertEqual(question["origin"], "project-research-brief")
            self.assertEqual(
                question["text"],
                "Does relative volume add validation-period information?",
            )
            self.assertEqual(question["sourcePath"], str(research_path))

    def test_local_question_falls_back_when_brief_has_no_question_heading(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace = initialize_workspace(
                Path(directory) / "workspace",
                name="Quant Desk",
            )
            project = create_project(
                workspace.root_dir,
                "fallback-lab",
                name="Fallback Lab",
                description="Use the manifest fallback",
            )
            (project.root_dir / "research.md").write_text(
                "# Fallback Lab\n\n## Purpose\n\nArbitrary method prose.\n",
                encoding="utf-8",
            )

            brief = build_agent_work_brief(project)

            jsonschema.validate(brief, AGENT_WORK_BRIEF_JSON_SCHEMA)
            self.assertEqual(
                brief["question"],
                {
                    "title": "Fallback Lab",
                    "text": "Use the manifest fallback",
                    "origin": "local",
                    "sourcePath": None,
                    "requestPath": None,
                },
            )

    def test_single_study_moves_from_baseline_to_session_worktree(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            _, project = make_project(directory)
            create_study(project, study_definition())

            initial = build_agent_work_brief(project)
            jsonschema.validate(initial, AGENT_WORK_BRIEF_JSON_SCHEMA)
            self.assertEqual(
                initial["primaryAction"]["id"],
                "session.start",
            )
            self.assertFalse(initial["filesystem"]["writable"])
            self.assertEqual(initial["filesystem"]["editablePaths"], [])
            self.assertEqual(
                initial["filesystem"]["declaredEditablePaths"],
                ["factors/**"],
            )

            execute_study(project, "factor-quality")
            baseline = build_agent_work_brief(project)
            jsonschema.validate(baseline, AGENT_WORK_BRIEF_JSON_SCHEMA)
            self.assertEqual(
                baseline["researchAgenda"]["status"],
                "unsupported-study",
            )
            self.assertEqual(
                baseline["primaryAction"]["id"],
                "session.start",
            )
            self.assertFalse(baseline["filesystem"]["writable"])

            session = start_session(project, "factor-quality")
            active = build_agent_work_brief(project)
            jsonschema.validate(active, AGENT_WORK_BRIEF_JSON_SCHEMA)
            self.assertEqual(
                active["primaryAction"]["id"],
                "experiment.evaluate",
            )
            self.assertTrue(active["filesystem"]["writable"])
            self.assertEqual(
                active["filesystem"]["operatingRoot"],
                str(session.worktree_project.root_dir),
            )
            self.assertEqual(
                active["filesystem"]["editablePaths"],
                ["factors/**"],
            )
            self.assertEqual(
                active["authority"]["tradingAuthority"],
                "none",
            )

            (project.root_dir / "judges" / "evaluate.py").write_text(
                "raise SystemExit('changed fixed authority')\n",
                encoding="utf-8",
            )
            stale = build_agent_work_brief(project)
            jsonschema.validate(stale, AGENT_WORK_BRIEF_JSON_SCHEMA)
            self.assertEqual(
                stale["reasons"][0]["code"],
                "current-evidence-stale",
            )
            self.assertEqual(
                stale["primaryAction"]["id"],
                "session.show",
            )
            self.assertEqual(stale["review"]["status"], "blocked")
            self.assertFalse(stale["filesystem"]["writable"])
            self.assertEqual(
                stale["filesystem"]["operatingRoot"],
                str(project.root_dir),
            )

    def test_custom_fixed_study_never_recommends_an_impossible_session(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            _, project = make_project(directory)
            request = research_request()
            request_path = project.root_dir / "requests" / "fixed.json"
            request_path.parent.mkdir()
            request_path.write_text(
                json.dumps(request, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            definition = study_definition(
                dependencies=["requests/fixed.json", "factors/**"],
                research_request=StudyResearchRequest("requests/fixed.json"),
            )
            definition = replace(
                definition,
                editable={"paths": []},
            )
            create_study(project, definition)
            run = execute_study(project, "factor-quality")

            evidence_ready = build_agent_work_brief(project)
            jsonschema.validate(evidence_ready, AGENT_WORK_BRIEF_JSON_SCHEMA)
            self.assertEqual(
                evidence_ready["reasons"][0]["code"],
                "descriptive-evidence-ready",
            )
            self.assertEqual(evidence_ready["review"]["status"], "complete")
            self.assertEqual(
                [item["id"] for item in evidence_ready["supportingActions"]],
                ["run.show"],
            )

            report = publish_run_report(
                project,
                "factor-quality",
                run.result["id"],
                report_analysis(run.result["id"]),
            )
            reported = build_agent_work_brief(project)
            jsonschema.validate(reported, AGENT_WORK_BRIEF_JSON_SCHEMA)
            self.assertEqual(
                reported["reasons"][0]["code"],
                "frozen-run-reported",
            )
            self.assertEqual(reported["review"]["status"], "complete")
            self.assertEqual(
                [item["id"] for item in reported["supportingActions"]],
                ["report.show"],
            )
            self.assertEqual(reported["evidence"]["reportId"], report.report["id"])
            self.assertIn(
                "no candidate Session surface",
                reported["review"]["next"],
            )

    def test_completed_single_study_is_terminal_with_optional_continuation(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            _, project = make_project(directory)
            create_study(project, study_definition())
            baseline = execute_study(project, "factor-quality")
            session = start_session(
                project,
                "factor-quality",
                request=research_request(),
            )
            report = publish_report(
                project,
                session.manifest["id"],
                report_analysis(baseline.result["id"]),
            )
            receipt = complete_session(
                project,
                session.manifest["id"],
                report.report["id"],
            )

            brief = build_agent_work_brief(project)

            jsonschema.validate(brief, AGENT_WORK_BRIEF_JSON_SCHEMA)
            self.assertIsNone(brief["primaryAction"])
            self.assertEqual(
                brief["reasons"][0]["code"],
                "required-research-complete",
            )
            self.assertEqual(brief["review"]["status"], "complete")
            self.assertEqual(
                brief["focus"]["coordinationPhase"],
                "evidence-ready",
            )
            self.assertEqual(brief["focus"]["operatingMode"], "observe")
            self.assertEqual(
                brief["evidence"]["reportId"],
                receipt["report"]["id"],
            )
            self.assertEqual(
                [item["id"] for item in brief["supportingActions"]],
                ["session.show", "session.start"],
            )
            self.assertEqual(
                brief["researchAgenda"]["moveRole"],
                "unavailable",
            )
            self.assertIn(
                "Optionally continue",
                brief["supportingActions"][1]["description"],
            )
            snapshot = build_studio_snapshot(project.root_dir)
            self.assertEqual(
                snapshot["projects"][0]["agentWorkBrief"],
                brief,
            )

    def test_promoted_single_study_is_terminal_with_optional_continuation(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            _, project = make_project(directory)
            create_study(project, study_definition())
            execute_study(project, "factor-quality")
            session = start_session(
                project,
                "factor-quality",
                request=research_request(),
            )
            candidate = (
                session.worktree_project.root_dir
                / "factors"
                / "candidate.py"
            )
            candidate.write_text("SCORE = 2.0\n", encoding="utf-8")
            experiment = evaluate_experiment(
                project,
                session.manifest["id"],
                "Improve the bounded synthetic score once.",
            )
            report = publish_report(
                project,
                session.manifest["id"],
                report_analysis(experiment.result["candidate"]["runId"]),
            )
            receipt = promote_session(
                project,
                session.manifest["id"],
                report.report["id"],
            )

            brief = build_agent_work_brief(project)

            jsonschema.validate(brief, AGENT_WORK_BRIEF_JSON_SCHEMA)
            self.assertIsNone(brief["primaryAction"])
            self.assertEqual(
                brief["reasons"][0]["code"],
                "required-research-complete",
            )
            self.assertEqual(brief["review"]["status"], "complete")
            self.assertEqual(brief["evidence"]["sessionStatus"], "promoted")
            self.assertEqual(
                brief["evidence"]["reportId"],
                receipt["report"]["id"],
            )
            self.assertEqual(
                [item["id"] for item in brief["supportingActions"]],
                ["session.show", "session.start"],
            )
            self.assertEqual(
                brief["researchAgenda"]["moveRole"],
                "unavailable",
            )
            self.assertIn(
                "does not assert scientific qualification",
                brief["reasons"][0]["message"],
            )

    def test_crash_restored_strong_baseline_honors_freeze_agenda(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace = initialize_workspace(Path(directory) / "workspace")
            project = create_project(
                workspace.root_dir,
                "freeze-portfolio",
                template="ohlcv-portfolio-lab",
            )
            execute_study(project, "ohlcv-portfolio-quality")
            session = start_session(project, "ohlcv-portfolio-quality")
            before_trial = build_agent_work_brief(project)
            self.assertEqual(
                before_trial["reasons"][0]["code"],
                "candidate-edit-required",
            )
            self.assertIn(
                "explicitly predeclared bounded alternative",
                before_trial["reasons"][0]["message"],
            )
            self.assertIn(
                "does not authorize open-ended tuning",
                before_trial["reasons"][0]["message"],
            )
            candidate = (
                session.worktree_project.root_dir
                / "factors"
                / "candidate.py"
            )
            candidate.write_text(
                "import pandas as pd\n\n"
                "FACTOR_COMPONENTS = {\n"
                "    'pullback': {\n"
                "        'label': 'Pullback',\n"
                "        'role': 'context-state',\n"
                "        'intervals': ['base'],\n"
                "        'hypothesis': 'Short returns reverse.',\n"
                "    },\n"
                "}\n\n"
                "def compute_factor(panel):\n"
                "    return -panel.groupby('asset', sort=False)"
                "['close'].pct_change(fill_method=None)\n\n"
                "def compute_factor_components(panel):\n"
                "    return pd.DataFrame({'pullback': panel['close']}, "
                "index=panel.index)\n",
                encoding="utf-8",
            )
            experiment = evaluate_experiment(
                project,
                session.manifest["id"],
                "Test one invalid declaration fixture.",
            )
            self.assertEqual(experiment.result["verdict"], "CRASH")

            brief = build_agent_work_brief(project)

            jsonschema.validate(brief, AGENT_WORK_BRIEF_JSON_SCHEMA)
            self.assertEqual(
                brief["researchAgenda"]["status"],
                "no-further-in-sample-tuning",
            )
            self.assertEqual(
                brief["researchAgenda"]["moveRole"],
                "optional-follow-up",
            )
            self.assertEqual(
                brief["reasons"][0]["code"],
                "in-sample-freeze-ready",
            )
            self.assertIsNone(brief["primaryAction"])
            self.assertEqual(
                [item["id"] for item in brief["supportingActions"]],
                ["session.show"],
            )
            self.assertEqual(brief["focus"]["operatingMode"], "observe")
            self.assertEqual(brief["review"]["status"], "complete")
            self.assertIn(
                "freeze the current source",
                brief["review"]["next"],
            )

    def test_settled_keep_routes_to_primary_promotion_before_another_edit(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            _, project = make_project(directory)
            create_study(project, study_definition())
            session = start_session(project, "factor-quality")
            candidate = (
                session.worktree_project.root_dir / "factors" / "candidate.py"
            )
            candidate.write_text("SCORE = 2.0\n", encoding="utf-8")
            experiment = evaluate_experiment(
                project,
                session.manifest["id"],
                "Raise the bounded synthetic score once.",
            )
            self.assertEqual(experiment.result["verdict"], "KEEP")

            settled = build_agent_work_brief(project)

            jsonschema.validate(settled, AGENT_WORK_BRIEF_JSON_SCHEMA)
            self.assertEqual(
                settled["method"],
                "verified-project-agent-orientation-v13",
            )
            self.assertEqual(
                [item["code"] for item in settled["reasons"]],
                ["promotion-ready"],
            )
            self.assertEqual(
                settled["primaryAction"]["id"],
                "session.promote",
            )
            self.assertEqual(settled["supportingActions"], [])
            self.assertEqual(settled["focus"]["operatingMode"], "promote")
            self.assertEqual(
                settled["review"]["next"],
                settled["primaryAction"]["description"],
            )
            snapshot = build_studio_snapshot(project.root_dir)
            self.assertEqual(
                snapshot["projects"][0]["agentWorkBrief"]["primaryAction"],
                settled["primaryAction"],
            )

            candidate.write_text("SCORE = 3.0\n", encoding="utf-8")
            newer_candidate = build_agent_work_brief(project)

            self.assertEqual(
                newer_candidate["primaryAction"]["id"],
                "experiment.evaluate",
            )
            self.assertEqual(
                [item["id"] for item in newer_candidate["supportingActions"]],
                ["session.promote"],
            )
            self.assertEqual(
                [item["code"] for item in newer_candidate["reasons"]],
                ["session-active", "promotion-ready"],
            )

    def test_research_desk_orients_to_verified_factor_gate(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            request_path, package_path = write_intake_inputs(root)
            workspace = initialize_workspace(
                root / "workspace",
                name="Quant Desk",
            )
            prepared = prepare_project_intake(
                request_path,
                package_path,
                "ohlcv-research-desk",
            )
            project = create_project(
                workspace.root_dir,
                "agent-desk",
                name=prepared.request["title"],
                description=prepared.request["question"],
                template=prepared.template,
                template_intake=prepared,
            )
            (project.root_dir / "research.md").write_text(
                "# Conflicting local brief\n\n"
                "## Research question\n\n"
                "This local text must not replace delegated authority.\n",
                encoding="utf-8",
            )

            brief = build_agent_work_brief(project)
            jsonschema.validate(brief, AGENT_WORK_BRIEF_JSON_SCHEMA)
            self.assertEqual(brief["question"]["origin"], "delegated-request")
            self.assertEqual(
                brief["question"]["text"],
                prepared.request["question"],
            )
            self.assertEqual(
                brief["question"]["requestPath"],
                str(project.root_dir / "request.json"),
            )
            self.assertEqual(
                brief["question"]["sourcePath"],
                str(project.root_dir / "request.json"),
            )
            self.assertEqual(brief["focus"]["laneId"], "factor")
            self.assertEqual(brief["focus"]["studyId"], OHLCV_STUDY_ID)
            self.assertEqual(
                brief["focus"]["scientificStage"],
                "factor-evidence-required",
            )
            self.assertEqual(
                brief["reasons"][0]["code"],
                "session-required",
            )
            self.assertEqual(brief["primaryAction"]["id"], "session.start")
            self.assertEqual(
                brief["researchAgenda"]["status"],
                "waiting-evidence",
            )
            self.assertEqual(brief["researchAgenda"]["moves"], [])
            self.assertEqual(
                brief["authority"],
                {
                    "researchAuthority": "research-prioritization-only",
                    "selectionSplit": "validation",
                    "testRole": "visible-audit",
                    "testEntersSelection": False,
                    "tradingAuthority": "none",
                },
            )

    def test_blank_project_is_observable_but_not_writable(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace = initialize_workspace(
                Path(directory) / "workspace",
                name="Quant Desk",
            )
            project = create_project(
                workspace.root_dir,
                "blank-lab",
                name="Blank Lab",
            )
            brief = build_agent_work_brief(project)
            jsonschema.validate(brief, AGENT_WORK_BRIEF_JSON_SCHEMA)
            self.assertEqual(brief["reasons"][0]["code"], "study-required")
            self.assertIsNone(brief["primaryAction"])
            self.assertFalse(brief["filesystem"]["writable"])

    def test_uncoordinated_multi_study_project_is_not_guessed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            _, project = make_project(directory)
            create_study(project, study_definition(study_id="first-study"))
            create_study(project, study_definition(study_id="second-study"))

            brief = build_agent_work_brief(project)
            jsonschema.validate(brief, AGENT_WORK_BRIEF_JSON_SCHEMA)
            self.assertEqual(
                brief["reasons"][0]["code"],
                "study-selection-required",
            )
            self.assertIsNone(brief["primaryAction"])
            self.assertFalse(brief["filesystem"]["writable"])
            self.assertEqual(
                [item["id"] for item in brief["supportingActions"]],
                ["study.inspect", "study.inspect"],
            )
            self.assertEqual(
                brief["researchAgenda"]["status"],
                "waiting-evidence",
            )
            self.assertIn(
                "evidence remains available",
                brief["researchAgenda"]["reason"],
            )
            self.assertNotIn(
                "No current successful verified Run",
                brief["researchAgenda"]["reason"],
            )

    def test_single_upstream_chain_orients_to_terminal_continuation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace, project = make_project(directory)
            create_study(project, study_definition(study_id="path-stress"))
            prior = execute_study(project, "path-stress")
            request = research_request()
            request["title"] = "Recovery continuation"
            request["question"] = "When did each fixed stress path recover?"
            request_path = project.root_dir / "requests" / "recovery.json"
            request_path.parent.mkdir()
            request_path.write_text(
                json.dumps(request, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            create_study(
                project,
                study_definition(
                    study_id="drawdown-recovery",
                    dependencies=["requests/recovery.json"],
                    research_request=StudyResearchRequest(
                        "requests/recovery.json"
                    ),
                    upstream_evidence=bind_upstream_evidence(
                        project,
                        prior.result["id"],
                        ["artifacts/report.json"],
                    ),
                ),
            )

            brief = build_agent_work_brief(project)
            jsonschema.validate(brief, AGENT_WORK_BRIEF_JSON_SCHEMA)
            self.assertEqual(
                brief["focus"]["studyId"],
                "drawdown-recovery",
            )
            self.assertNotEqual(
                brief["reasons"][0]["code"],
                "study-selection-required",
            )
            self.assertEqual(
                brief["continuation"]["run_id"],
                prior.result["id"],
            )
            self.assertEqual(brief["question"]["origin"], "study-request")
            self.assertEqual(
                brief["question"]["text"],
                "When did each fixed stress path recover?",
            )
            studio = build_studio_snapshot(workspace.root_dir)
            projected = studio["projects"][0]
            continuation = next(
                item
                for item in projected["studies"]
                if item["id"] == "drawdown-recovery"
            )["upstreamEvidence"]
            self.assertEqual(continuation["run_id"], prior.result["id"])
            self.assertEqual(
                projected["agentWorkBrief"]["continuation"]["run_id"],
                prior.result["id"],
            )
