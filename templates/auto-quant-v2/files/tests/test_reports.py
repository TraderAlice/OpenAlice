from __future__ import annotations

import json
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest import mock

import autoquant.reports as report_module
import jsonschema
from autoquant.decision_support import sizing_anatomy_markdown_lines
from autoquant.reports import (
    REPORT_ANALYSIS_JSON_SCHEMA,
    list_reports,
    load_report,
    publish_report,
)
from autoquant.research import run_campaign
from autoquant.sessions import (
    SESSION_COMPLETION_JSON_SCHEMA,
    complete_session,
    evaluate_experiment,
    load_session,
    promote_session,
    session_snapshot,
    start_session,
)
from autoquant.studio import build_studio_snapshot
from autoquant.studies import create_study, hash_file, hash_json
from autoquant.workspace import AutoQuantValidationError
from tests.study_helpers import make_project, study_definition
from tests.test_cli import json_output, run_cli


def research_request() -> dict:
    return {
        "schemaVersion": 1,
        "kind": "autoquant-research-request",
        "title": "Assess AAA directional factor support",
        "question": "Does the current factor support a conditional long view on AAA?",
        "decisionContext": "OpenAlice needs quantitative evidence before discussion.",
        "assets": [
            {
                "symbol": "AAA/USD",
                "assetClass": "equity",
                "venue": "TEST",
            }
        ],
        "direction": "long",
        "horizon": "one month",
        "hypotheses": ["The factor remains positive out of sample."],
        "constraints": ["Use only the fixed Study dataset and Judge."],
        "deliverables": ["factor evidence", "limitations", "conditional guidance"],
        "source": {
            "system": "openalice",
            "workspaceId": "equity-desk",
            "sessionId": "resume-test-origin",
            "artifactPath": "requests/aaa.md",
            "artifactRevision": "sha256:test-request-revision",
        },
    }


def report_analysis(run_id: str) -> dict:
    reference = {
        "kind": "run",
        "id": run_id,
        "artifactPath": "artifacts/report.json",
    }
    return {
        "schemaVersion": 1,
        "kind": "autoquant-research-report-analysis",
        "title": "AAA factor evidence",
        "executiveSummary": (
            "The fixed synthetic Judge reports positive evidence, but this tiny "
            "fixture is not sufficient for a live-trading decision."
        ),
        "findings": [
            {
                "id": "positive-fixed-score",
                "claim": "The current candidate clears the fixed baseline score.",
                "confidence": "medium",
                "evidenceRefs": [reference],
            }
        ],
        "recommendations": [
            {
                "action": "Continue bounded research before any forward decision.",
                "rationale": "The evidence is causal but intentionally synthetic.",
                "conditions": ["Add realistic cost and portfolio evidence."],
                "evidenceRefs": [reference],
            }
        ],
        "limitations": ["The checked-in fixture is not market data."],
        "unresolvedQuestions": ["Does the factor survive portfolio costs?"],
    }


def fully_rehash_report(report, forged: dict, session_id: str) -> tuple[Path, str]:
    forged["evidenceHash"] = hash_json(forged["evidence"])
    identity = hash_json(
        {
            "sessionId": forged["sessionId"],
            "briefHash": forged["brief"]["briefHash"],
            "analysisHash": forged["analysisHash"],
            "evidenceHash": forged["evidenceHash"],
            "publishedAt": forged["publishedAt"],
        }
    )
    stamp = datetime.fromisoformat(forged["publishedAt"]).strftime(
        "%Y%m%dT%H%M%S%fZ"
    )
    forged_id = f"report-{stamp}-{identity[:12]}"
    forged["id"] = forged_id
    forged_root = report.root_dir.with_name(forged_id)
    report.root_dir.rename(forged_root)
    (forged_root / "report.json").write_text(
        json.dumps(forged, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    (forged_root / "report.md").write_text(
        report_module._render_markdown(forged),
        encoding="utf-8",
    )
    files = {
        name: hash_file(forged_root / name)
        for name in ("analysis.json", "report.json", "report.md")
    }
    manifest = {
        "schemaVersion": 1,
        "id": forged_id,
        "sessionId": session_id,
        "completed": True,
        "reportHash": files["report.json"],
        "files": files,
    }
    (forged_root / "manifest.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return forged_root, forged_id


class ResearchHandoffTests(unittest.TestCase):
    def test_sizing_markdown_is_canonical_across_mapping_order(self) -> None:
        sizing = {
            "method": "test",
            "timestamp": "2026-07-27",
            "construction": {
                "rawGross": 0.9,
                "governedGross": 0.9,
                "executedGross": 0.9,
                "unfundedGross": 0.1,
                "maxAbsWeight": 0.3,
                "riskGovernorScale": 1.0,
                "assetMaxAbsWeights": {
                    "SPY": 0.3,
                    "QQQ": 0.3,
                    "IWM": 0.3,
                },
                "assetPositionRoles": {
                    "SPY": "long-only",
                    "QQQ": "long-only",
                    "IWM": "long-only",
                },
                "longGrossLimit": 1.0,
                "shortGrossLimit": 0.0,
            },
            "componentRisk": {
                "available": True,
                "absoluteConcentrationHhi": 0.4,
                "largestAbsoluteContributor": "IWM",
            },
            "sides": [],
            "positions": [],
        }
        support = {
            "portfolioSizingAnatomy": sizing,
            "portfolioSizingAnatomyHash": "test-hash",
        }
        rendered = sizing_anatomy_markdown_lines(
            support,
            heading="## Sizing",
        )
        round_tripped = json.loads(json.dumps(support, sort_keys=True))
        self.assertEqual(
            rendered,
            sizing_anatomy_markdown_lines(
                round_tripped,
                heading="## Sizing",
            ),
        )
        self.assertIn(
            "Effective per-asset caps: `IWM`=`0.3`, `QQQ`=`0.3`, "
            "`SPY`=`0.3`",
            "\n".join(rendered),
        )

    def _project(self, directory: str):
        _, project = make_project(directory)
        create_study(project, study_definition())
        return project

    def test_delegated_session_binds_request_brief_and_researcher_input(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project = self._project(directory)
            session = start_session(
                project,
                "factor-quality",
                request=research_request(),
            )

            self.assertIsNotNone(session.delegation)
            self.assertEqual(
                session.delegation["request"]["title"],
                "Assess AAA directional factor support",
            )
            self.assertEqual(
                session.delegation["brief"]["authorityBoundary"]["trading"],
                "none",
            )
            self.assertTrue((session.root_dir / "request.json").is_file())
            self.assertTrue((session.root_dir / "brief.json").is_file())
            self.assertEqual(
                session_snapshot(project, session)["delegation"]["brief"]["id"],
                session.manifest["brief"]["id"],
            )

            researcher = Path(directory) / "researcher.py"
            researcher.write_text(
                "import json\n"
                "print(json.dumps({'schema_version': 1, 'action': 'stop', "
                "'reason': 'request inspected'}))\n",
                encoding="utf-8",
            )
            campaign = run_campaign(
                project,
                session.manifest["id"],
                f"python3 {researcher}",
                max_turns=1,
                max_wall_seconds=20,
                turn_timeout_seconds=5,
            )
            turn_input = json.loads(
                (
                    campaign.root_dir / "turns" / "turn-0001" / "input.json"
                ).read_text(encoding="utf-8")
            )
            self.assertEqual(
                turn_input["delegation"]["request"]["question"],
                research_request()["question"],
            )

    def test_session_report_draft_prefills_exact_evidence_and_cannot_publish(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project = self._project(directory)
            session = start_session(
                project,
                "factor-quality",
                request=research_request(),
            )
            drafted = run_cli(
                "report",
                "draft",
                str(project.root_dir),
                "--session",
                session.manifest["id"],
                "--json",
            )
            self.assertEqual(drafted.returncode, 0, drafted.stderr)
            envelope = json_output(drafted)
            draft = envelope["data"]["analysis"]
            self.assertEqual(draft["authoringState"], "draft")
            self.assertFalse(envelope["data"]["publishable"])
            self.assertEqual(
                envelope["data"]["anchor"]["runId"],
                session.manifest["leader"]["runId"],
            )
            jsonschema.validate(draft, REPORT_ANALYSIS_JSON_SCHEMA)
            references = draft["findings"][0]["evidenceRefs"]
            self.assertEqual(
                {item["artifactPath"] for item in references},
                {
                    artifact["path"]
                    for artifact in session.leader_run.result["artifacts"]
                },
            )
            draft_path = Path(envelope["data"]["draftPath"])
            blocked = run_cli(
                "report",
                "publish",
                str(project.root_dir),
                "--session",
                session.manifest["id"],
                "--analysis",
                str(draft_path),
                "--json",
            )
            self.assertEqual(blocked.returncode, 1)
            self.assertEqual(
                {
                    item["code"]
                    for item in json_output(blocked)["error"]["issues"]
                },
                {"report.draft-incomplete", "report.draft-placeholder"},
            )
            duplicate = run_cli(
                "report",
                "draft",
                str(project.root_dir),
                "--session",
                session.manifest["id"],
                "--json",
            )
            self.assertEqual(duplicate.returncode, 1)
            self.assertEqual(
                json_output(duplicate)["error"]["issues"][0]["code"],
                "report.draft-exists",
            )

    def test_delegated_keep_promotion_requires_exact_current_report(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project = self._project(directory)
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
                "Improve the delegated candidate.",
            )
            self.assertEqual(experiment.result["verdict"], "KEEP")
            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "requires an exact current Research Report",
            ):
                promote_session(project, session.manifest["id"])

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
            self.assertEqual(receipt["report"]["id"], report.report["id"])
            self.assertEqual(
                load_session(project, session.manifest["id"]).manifest[
                    "status"
                ],
                "promoted",
            )
            with self.assertRaises(AutoQuantValidationError) as captured:
                complete_session(
                    project,
                    session.manifest["id"],
                    report.report["id"],
                )
            self.assertEqual(
                captured.exception.issues[0].code,
                "completion.already-promoted",
            )
            self.assertIn(
                "already terminally closed by KEEP promotion",
                captured.exception.issues[0].message,
            )

    def test_request_scope_and_tampering_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project = self._project(directory)
            outside = research_request()
            outside["assets"][0]["symbol"] = "BBB/USD"
            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "outside the selected Study universe",
            ):
                start_session(project, "factor-quality", request=outside)

            session = start_session(
                project,
                "factor-quality",
                request=research_request(),
            )
            request_path = session.root_dir / "request.json"
            changed = json.loads(request_path.read_text(encoding="utf-8"))
            changed["title"] = "Rewritten request"
            request_path.write_text(json.dumps(changed), encoding="utf-8")
            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "Request hash mismatch",
            ):
                load_session(project, session.manifest["id"])

    def test_report_publication_is_immutable_and_survives_later_research(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project = self._project(directory)
            session = start_session(
                project,
                "factor-quality",
                request=research_request(),
            )
            baseline_id = session.manifest["baseline"]["runId"]
            report = publish_report(
                project,
                session.manifest["id"],
                report_analysis(baseline_id),
            )

            self.assertEqual(report.report["tradingAuthority"], "none")
            self.assertEqual(report.report["request"], research_request())
            decision_support = report.report["evidence"][
                "leaderDecisionSupport"
            ]
            self.assertEqual(
                decision_support["runId"],
                baseline_id,
            )
            self.assertEqual(
                decision_support["resultHash"],
                report.report["evidence"]["runs"][0]["resultHash"],
            )
            self.assertIsNone(
                decision_support["portfolioMechanicalDecisionHash"]
            )
            self.assertIsNone(
                decision_support["portfolioMechanicalDecision"]
            )
            self.assertIsNone(
                decision_support["portfolioSizingAnatomyHash"]
            )
            self.assertIsNone(
                decision_support["portfolioSizingAnatomy"]
            )
            self.assertIsNone(
                decision_support["portfolioDiversificationStressHash"]
            )
            self.assertIsNone(
                decision_support["portfolioDiversificationStress"]
            )
            self.assertIsNone(
                decision_support["portfolioStrategyViabilityHash"]
            )
            self.assertIsNone(
                decision_support["portfolioStrategyViability"]
            )
            self.assertIsNone(
                decision_support["portfolioSignalMonetizationHash"]
            )
            self.assertIsNone(
                decision_support["portfolioSignalMonetization"]
            )
            self.assertEqual(
                report.report["evidence"]["selectionIntegrity"][
                    "selectionSplit"
                ],
                "unspecified",
            )
            self.assertEqual(
                report.report["evidence"]["selectionIntegrity"][
                    "candidateTrials"
                ],
                0,
            )
            self.assertEqual(
                report.report["evidence"]["selectionIntegrity"][
                    "researchFamily"
                ]["uniqueSourceTrials"],
                1,
            )
            self.assertIn(
                "quantitative decision support only",
                (report.root_dir / "report.md").read_text(encoding="utf-8"),
            )
            self.assertIn(
                "Research selection integrity",
                (report.root_dir / "report.md").read_text(encoding="utf-8"),
            )
            self.assertIn(
                "Project-family unique trials",
                (report.root_dir / "report.md").read_text(encoding="utf-8"),
            )
            self.assertIn(
                "Selection adjustment",
                (report.root_dir / "report.md").read_text(encoding="utf-8"),
            )
            self.assertEqual(
                [item.id for item in list_reports(project, session)],
                [report.report["id"]],
            )
            studio = build_studio_snapshot(project.root_dir)
            observation = studio["projects"][0]
            self.assertEqual(observation["counts"]["delegatedSessions"], 1)
            self.assertEqual(observation["counts"]["reports"], 1)
            studio_session = observation["sessions"][0]
            self.assertEqual(
                studio_session["delegation"]["request"]["title"],
                research_request()["title"],
            )
            self.assertEqual(studio_session["reports"][0]["id"], report.report["id"])
            self.assertEqual(
                [item["id"] for item in studio_session["commands"]],
                [
                    "session.show",
                    "session.compare",
                    "report.publish",
                    "report.show",
                    "session.complete",
                ],
            )
            self.assertEqual(observation["timeline"][0]["kind"], "report")

            candidate = session.worktree_project.root_dir / "factors/candidate.py"
            candidate.write_text("SCORE = 2.0\n", encoding="utf-8")
            evaluate_experiment(
                project,
                session.manifest["id"],
                "Improve after the first report snapshot.",
            )
            later = load_session(project, session.manifest["id"])
            later_snapshot = session_snapshot(project, later)
            self.assertEqual(
                later_snapshot["selectionIntegrity"]["candidateTrials"],
                1,
            )
            self.assertEqual(
                later_snapshot["selectionIntegrity"]["verdicts"]["KEEP"],
                1,
            )
            self.assertEqual(
                later_snapshot["selectionIntegrity"]["researchFamily"][
                    "uniqueSourceTrials"
                ],
                2,
            )
            loaded = load_report(project, later, report.report["id"])
            self.assertEqual(
                loaded.report["evidence"]["session"]["leader"]["runId"],
                baseline_id,
            )
            self.assertEqual(
                loaded.report["evidence"]["selectionIntegrity"][
                    "candidateTrials"
                ],
                0,
            )
            self.assertEqual(
                loaded.report["evidence"]["selectionIntegrity"][
                    "researchFamily"
                ]["uniqueSourceTrials"],
                1,
            )
            self.assertNotEqual(later.manifest["leader"]["runId"], baseline_id)

            result_path = report.root_dir / "report.json"
            changed = json.loads(result_path.read_text(encoding="utf-8"))
            changed["analysis"]["executiveSummary"] = "tampered"
            result_path.write_text(json.dumps(changed), encoding="utf-8")
            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "files changed",
            ):
                load_report(project, later, report.report["id"])

    def test_legacy_report_without_selection_v2_fields_remains_loadable(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project = self._project(directory)
            session = start_session(
                project,
                "factor-quality",
                request=research_request(),
            )
            report = publish_report(
                project,
                session.manifest["id"],
                report_analysis(session.manifest["baseline"]["runId"]),
            )
            historical = json.loads(json.dumps(report.report))
            historical["evidence"].pop("leaderDecisionSupport")
            integrity = historical["evidence"]["selectionIntegrity"]
            for key in (
                "researchFamily",
                "selectionAdjustment",
                "verdictAuthority",
            ):
                integrity.pop(key)
            _, report_id = fully_rehash_report(
                report,
                historical,
                session.manifest["id"],
            )

            loaded = load_report(project, session, report_id)

            self.assertNotIn(
                "researchFamily",
                loaded.report["evidence"]["selectionIntegrity"],
            )
            self.assertNotIn(
                "leaderDecisionSupport",
                loaded.report["evidence"],
            )
            self.assertIn(
                "Research selection integrity",
                (loaded.root_dir / "report.md").read_text(encoding="utf-8"),
            )

    def test_prior_decision_support_without_viability_remains_loadable(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project = self._project(directory)
            session = start_session(
                project,
                "factor-quality",
                request=research_request(),
            )
            report = publish_report(
                project,
                session.manifest["id"],
                report_analysis(session.manifest["baseline"]["runId"]),
            )
            historical = json.loads(json.dumps(report.report))
            support = historical["evidence"]["leaderDecisionSupport"]
            support.pop("portfolioStrategyViabilityHash")
            support.pop("portfolioStrategyViability")
            _, report_id = fully_rehash_report(
                report,
                historical,
                session.manifest["id"],
            )

            loaded = load_report(project, session, report_id)

            self.assertNotIn(
                "portfolioStrategyViability",
                loaded.report["evidence"]["leaderDecisionSupport"],
            )

    def test_prior_decision_support_without_monetization_remains_loadable(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project = self._project(directory)
            session = start_session(
                project,
                "factor-quality",
                request=research_request(),
            )
            report = publish_report(
                project,
                session.manifest["id"],
                report_analysis(session.manifest["baseline"]["runId"]),
            )
            historical = json.loads(json.dumps(report.report))
            support = historical["evidence"]["leaderDecisionSupport"]
            support.pop("portfolioSignalMonetizationHash")
            support.pop("portfolioSignalMonetization")
            _, report_id = fully_rehash_report(
                report,
                historical,
                session.manifest["id"],
            )

            loaded = load_report(project, session, report_id)

            self.assertNotIn(
                "portfolioSignalMonetization",
                loaded.report["evidence"]["leaderDecisionSupport"],
            )

    def test_prior_decision_support_without_diversification_remains_loadable(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project = self._project(directory)
            session = start_session(
                project,
                "factor-quality",
                request=research_request(),
            )
            report = publish_report(
                project,
                session.manifest["id"],
                report_analysis(session.manifest["baseline"]["runId"]),
            )
            historical = json.loads(json.dumps(report.report))
            support = historical["evidence"]["leaderDecisionSupport"]
            support.pop("portfolioDiversificationStressHash")
            support.pop("portfolioDiversificationStress")
            _, report_id = fully_rehash_report(
                report,
                historical,
                session.manifest["id"],
            )

            loaded = load_report(project, session, report_id)

            self.assertNotIn(
                "portfolioDiversificationStress",
                loaded.report["evidence"]["leaderDecisionSupport"],
            )

    def test_prior_decision_support_without_rl_diagnosis_remains_loadable(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project = self._project(directory)
            session = start_session(
                project,
                "factor-quality",
                request=research_request(),
            )
            report = publish_report(
                project,
                session.manifest["id"],
                report_analysis(session.manifest["baseline"]["runId"]),
            )
            historical = json.loads(json.dumps(report.report))
            support = historical["evidence"]["leaderDecisionSupport"]
            support.pop("rlFactorFusionDiagnosisHash")
            support.pop("rlFactorFusionDiagnosis")
            _, report_id = fully_rehash_report(
                report,
                historical,
                session.manifest["id"],
            )

            loaded = load_report(project, session, report_id)

            self.assertNotIn(
                "rlFactorFusionDiagnosis",
                loaded.report["evidence"]["leaderDecisionSupport"],
            )

    def test_prior_decision_support_without_factor_qualification_remains_loadable(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project = self._project(directory)
            session = start_session(
                project,
                "factor-quality",
                request=research_request(),
            )
            report = publish_report(
                project,
                session.manifest["id"],
                report_analysis(session.manifest["baseline"]["runId"]),
            )
            historical = json.loads(json.dumps(report.report))
            support = historical["evidence"]["leaderDecisionSupport"]
            support.pop("factorQualificationHash")
            support.pop("factorQualification")
            _, report_id = fully_rehash_report(
                report,
                historical,
                session.manifest["id"],
            )

            loaded = load_report(project, session, report_id)

            self.assertNotIn(
                "factorQualification",
                loaded.report["evidence"]["leaderDecisionSupport"],
            )

    def test_prior_decision_support_without_factor_components_remains_loadable(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project = self._project(directory)
            session = start_session(
                project,
                "factor-quality",
                request=research_request(),
            )
            report = publish_report(
                project,
                session.manifest["id"],
                report_analysis(session.manifest["baseline"]["runId"]),
            )
            historical = json.loads(json.dumps(report.report))
            support = historical["evidence"]["leaderDecisionSupport"]
            support.pop("factorComponentsHash")
            support.pop("factorComponents")
            _, report_id = fully_rehash_report(
                report,
                historical,
                session.manifest["id"],
            )

            loaded = load_report(project, session, report_id)

            self.assertNotIn(
                "factorComponents",
                loaded.report["evidence"]["leaderDecisionSupport"],
            )

    def test_prior_decision_support_without_factor_availability_remains_loadable(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project = self._project(directory)
            session = start_session(
                project,
                "factor-quality",
                request=research_request(),
            )
            report = publish_report(
                project,
                session.manifest["id"],
                report_analysis(session.manifest["baseline"]["runId"]),
            )
            historical = json.loads(json.dumps(report.report))
            support = historical["evidence"]["leaderDecisionSupport"]
            support.pop("factorInputAvailabilityHash")
            support.pop("factorInputAvailability")
            _, report_id = fully_rehash_report(
                report,
                historical,
                session.manifest["id"],
            )

            loaded = load_report(project, session, report_id)

            self.assertNotIn(
                "factorInputAvailability",
                loaded.report["evidence"]["leaderDecisionSupport"],
            )

    def test_legacy_decision_support_without_sizing_remains_loadable(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project = self._project(directory)
            session = start_session(
                project,
                "factor-quality",
                request=research_request(),
            )
            report = publish_report(
                project,
                session.manifest["id"],
                report_analysis(session.manifest["baseline"]["runId"]),
            )
            historical = json.loads(json.dumps(report.report))
            support = historical["evidence"]["leaderDecisionSupport"]
            support.pop("portfolioSizingAnatomyHash")
            support.pop("portfolioSizingAnatomy")
            support.pop("portfolioStrategyViabilityHash")
            support.pop("portfolioStrategyViability")
            _, report_id = fully_rehash_report(
                report,
                historical,
                session.manifest["id"],
            )

            loaded = load_report(project, session, report_id)

            self.assertNotIn(
                "portfolioSizingAnatomy",
                loaded.report["evidence"]["leaderDecisionSupport"],
            )

    def test_baseline_report_completes_session_without_project_mutation(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project = self._project(directory)
            source_path = project.root_dir / "factors" / "candidate.py"
            original_source = source_path.read_bytes()
            session = start_session(
                project,
                "factor-quality",
                request=research_request(),
            )
            report = publish_report(
                project,
                session.manifest["id"],
                report_analysis(session.manifest["baseline"]["runId"]),
            )

            with mock.patch(
                "autoquant.research.list_campaign_progress",
                return_value=[{"phase": "researcher"}],
            ), self.assertRaisesRegex(
                AutoQuantValidationError,
                "Campaign is running",
            ):
                complete_session(
                    project,
                    session.manifest["id"],
                    report.report["id"],
                )
            receipt = complete_session(
                project,
                session.manifest["id"],
                report.report["id"],
            )
            jsonschema.validate(receipt, SESSION_COMPLETION_JSON_SCHEMA)
            completed = load_session(project, session.manifest["id"])
            self.assertEqual(completed.manifest["status"], "completed")
            self.assertEqual(receipt["disposition"], "baseline-reported")
            self.assertEqual(receipt["report"]["id"], report.report["id"])
            self.assertEqual(source_path.read_bytes(), original_source)
            self.assertTrue((completed.root_dir / "completion.json").is_file())

            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "Session is not active",
            ):
                evaluate_experiment(
                    project,
                    session.manifest["id"],
                    "Cannot continue terminal research.",
                )
            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "Session is not active",
            ):
                complete_session(
                    project,
                    session.manifest["id"],
                    report.report["id"],
                )
            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "only while the Session is active",
            ):
                report_module.publish_report(
                    project,
                    session.manifest["id"],
                    report_analysis(session.manifest["baseline"]["runId"]),
                )

    def test_completion_rejects_unpromoted_or_incomplete_evidence_and_tampering(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project = self._project(directory)
            session = start_session(
                project,
                "factor-quality",
                request=research_request(),
            )
            old_report = publish_report(
                project,
                session.manifest["id"],
                report_analysis(session.manifest["baseline"]["runId"]),
            )
            candidate = (
                session.worktree_project.root_dir
                / "factors"
                / "candidate.py"
            )
            candidate.write_text("SCORE = 1.0\n", encoding="utf-8")
            evaluate_experiment(
                project,
                session.manifest["id"],
                "Record a reverted candidate after the old Report.",
            )
            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "complete current Session evidence",
            ):
                complete_session(
                    project,
                    session.manifest["id"],
                    old_report.report["id"],
                )
            session = load_session(project, session.manifest["id"])
            current_report = publish_report(
                project,
                session.manifest["id"],
                report_analysis(session.manifest["leader"]["runId"]),
            )
            receipt = complete_session(
                project,
                session.manifest["id"],
                current_report.report["id"],
            )
            completion_path = session.root_dir / "completion.json"
            changed = json.loads(completion_path.read_text(encoding="utf-8"))
            changed["disposition"] = "invented"
            completion_path.write_text(
                json.dumps(changed),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "Completion receipt differs",
            ):
                load_session(project, session.manifest["id"])

        with tempfile.TemporaryDirectory() as directory:
            project = self._project(directory)
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
            evaluate_experiment(
                project,
                session.manifest["id"],
                "Create an improved unpromoted leader.",
            )
            session = load_session(project, session.manifest["id"])
            report = publish_report(
                project,
                session.manifest["id"],
                report_analysis(session.manifest["leader"]["runId"]),
            )
            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "improved KEEP leader",
            ):
                complete_session(
                    project,
                    session.manifest["id"],
                    report.report["id"],
                )

        with tempfile.TemporaryDirectory() as directory:
            project = self._project(directory)
            session = start_session(
                project,
                "factor-quality",
                request=research_request(),
            )
            report = publish_report(
                project,
                session.manifest["id"],
                report_analysis(session.manifest["baseline"]["runId"]),
            )
            complete_session(
                project,
                session.manifest["id"],
                report.report["id"],
            )
            (report.root_dir / "report.md").write_text(
                "tampered\n",
                encoding="utf-8",
            )
            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "Completion Report files changed",
            ):
                load_session(project, session.manifest["id"])

    def test_report_rejects_unknown_evidence_and_legacy_session(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project = self._project(directory)
            session = start_session(
                project,
                "factor-quality",
                request=research_request(),
            )
            invalid = report_analysis(session.manifest["baseline"]["runId"])
            invalid["findings"][0]["evidenceRefs"][0]["id"] = "run-invented"
            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "Unknown Session evidence",
            ):
                publish_report(project, session.manifest["id"], invalid)

            legacy = start_session(project, "factor-quality")
            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "require a delegated Session brief",
            ):
                publish_report(
                    project,
                    legacy.manifest["id"],
                    report_analysis(legacy.manifest["baseline"]["runId"]),
                )

    def test_report_loader_rejects_fully_rehashed_fabricated_metrics(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project = self._project(directory)
            session = start_session(
                project,
                "factor-quality",
                request=research_request(),
            )
            report = publish_report(
                project,
                session.manifest["id"],
                report_analysis(session.manifest["baseline"]["runId"]),
            )
            forged = json.loads(
                json.dumps(report.report)
            )
            forged["evidence"]["runs"][0]["metrics"]["score"] = 999.0
            _, forged_id = fully_rehash_report(
                report,
                forged,
                session.manifest["id"],
            )

            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "Frozen Run differs",
            ):
                load_report(
                    project,
                    load_session(project, session.manifest["id"]),
                    forged_id,
                )

    def test_report_loader_rejects_rehashed_selection_integrity(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project = self._project(directory)
            session = start_session(
                project,
                "factor-quality",
                request=research_request(),
            )
            report = publish_report(
                project,
                session.manifest["id"],
                report_analysis(session.manifest["baseline"]["runId"]),
            )
            forged = json.loads(json.dumps(report.report))
            forged["evidence"]["selectionIntegrity"]["candidateTrials"] = 99
            forged["evidence"]["selectionIntegrity"]["evaluatedRuns"] = 100
            _, forged_id = fully_rehash_report(
                report,
                forged,
                session.manifest["id"],
            )

            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "selection integrity differs",
            ):
                load_report(
                    project,
                    load_session(project, session.manifest["id"]),
                    forged_id,
                )


if __name__ == "__main__":
    unittest.main()
