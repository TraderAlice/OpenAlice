from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from autoquant.intake import load_project_intake, prepare_project_intake
from autoquant.reviews import (
    REVIEW_MARKDOWN,
    list_reviews,
    load_review,
    load_review_package,
    publish_review,
    validate_review_analysis,
)
from autoquant.reports import publish_report
from autoquant.run_reports import publish_run_report
from autoquant.runs import execute_study
from autoquant.sessions import start_session
from autoquant.studio import build_studio_snapshot
from autoquant.workspace import (
    AutoQuantValidationError,
    create_or_intake_project,
    initialize_workspace,
)
from tests.intake_helpers import write_intake_inputs
from tests.test_cli import json_output, run_cli


def report_analysis(
    run_id: str,
    artifact_path: str = "artifacts/factor-report.json",
) -> dict:
    return {
        "schemaVersion": 1,
        "kind": "autoquant-research-report-analysis",
        "title": "Completed fixed research",
        "executiveSummary": "The immutable Run records the bounded Factor result.",
        "findings": [
            {
                "id": "factor-result",
                "claim": "The fixed Factor Run completed.",
                "confidence": "high",
                "evidenceRefs": [
                    {
                        "kind": "run",
                        "id": run_id,
                        "artifactPath": artifact_path,
                    }
                ],
            }
        ],
        "recommendations": [],
        "limitations": ["Provider semantics are not authenticated."],
        "unresolvedQuestions": [],
    }


def review_analysis(
    report_id: str,
    run_id: str,
    artifact_path: str = "artifacts/factor-report.json",
) -> dict:
    return {
        "schemaVersion": 1,
        "kind": "autoquant-research-review-analysis",
        "title": "Independent completed-Report review",
        "executiveVerdict": (
            "The calculation is reproducible, provider semantics remain declared, "
            "and one comparison is visible only outside Report authority."
        ),
        "conclusion": "accepted-with-reservations",
        "claims": [
            {
                "id": "factor-result",
                "claim": "The central Factor result is present in immutable Run evidence.",
                "classification": "verified",
                "rationale": "The exact target Run declares and hashes the Factor artifact.",
                "evidenceRefs": [
                    {
                        "kind": "run",
                        "id": run_id,
                        "artifactPath": artifact_path,
                    }
                ],
            },
            {
                "id": "provider-semantics",
                "claim": "The dataset provider semantics are declarations.",
                "classification": "declared",
                "rationale": "The Report is immutable but does not authenticate its provider.",
                "evidenceRefs": [
                    {"kind": "report", "id": report_id, "artifactPath": "report.json"}
                ],
            },
            {
                "id": "workspace-comparison",
                "claim": "A comparison file is visible but not bound into target evidence.",
                "classification": "observed-unbound",
                "rationale": "Core records its digest without promoting it to Run authority.",
                "evidenceRefs": [
                    {"kind": "report", "id": report_id, "artifactPath": "analysis.json"},
                    {
                        "kind": "observed-file",
                        "id": "staging/comparison.json",
                        "artifactPath": None,
                    },
                ],
            },
            {
                "id": "exchange-truth",
                "claim": "Exchange-authenticated price truth is unavailable.",
                "classification": "unverified",
                "rationale": "No bound evidence authenticates exchange prints.",
                "evidenceRefs": [],
            },
        ],
        "remediations": [
            {
                "priority": "P1",
                "action": "Do not present the comparison as Report-bound evidence.",
                "rationale": "Its bytes are observed only in mutable Workspace staging.",
                "claimIds": ["workspace-comparison"],
            }
        ],
        "limitations": ["Review does not authenticate providers or accounts."],
        "unresolvedQuestions": [],
    }


class IndependentReviewTests(unittest.TestCase):
    def _completed_project(self, root: Path):
        workspace = initialize_workspace(root / "workspace")
        request, dataset = write_intake_inputs(root)
        prepared = prepare_project_intake(request, dataset, "ohlcv-research-desk")
        project = create_or_intake_project(
            workspace.root_dir,
            "review-desk",
            name="Review Desk",
            description="Completed research review fixture",
            template="ohlcv-research-desk",
            template_intake=prepared,
        )
        run = execute_study(project, "ohlcv-factor-quality")
        report = publish_run_report(
            project,
            "ohlcv-factor-quality",
            run.result["id"],
            report_analysis(run.result["id"]),
        )
        staging = workspace.root_dir / "staging"
        staging.mkdir()
        (staging / "comparison.json").write_text(
            '{"status":"supporting-only"}\n', encoding="utf-8"
        )
        return workspace, project, run, report

    def test_attached_review_is_strict_discoverable_and_studio_visible(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace, project, run, report = self._completed_project(Path(directory))
            review = publish_review(
                project,
                report.report["id"],
                review_analysis(report.report["id"], run.result["id"]),
                observation_root=workspace.root_dir,
                observation_scope="workspace",
            )

            self.assertEqual(review.root_dir.parent, project.root_dir / "reviews")
            self.assertEqual(load_review(project, review.review["id"]).review, review.review)
            self.assertEqual(list_reviews(project)[0].conclusion, "accepted-with-reservations")
            resolved = review.evidence["resolvedRefs"]
            observed = next(item for item in resolved if item["kind"] == "observed-file")
            self.assertEqual(observed["authority"], "observed-unbound")
            self.assertEqual(observed["scope"], "workspace")
            self.assertEqual(len(observed["sha256"]), 64)
            markdown = (review.root_dir / REVIEW_MARKDOWN).read_text(encoding="utf-8")
            self.assertIn("does not alter the target Report", markdown)
            self.assertIn("workspace-comparison — observed-unbound", markdown)

            snapshot = build_studio_snapshot(workspace.root_dir)
            projected = snapshot["projects"][0]
            self.assertEqual(projected["counts"]["reviews"], 1)
            self.assertEqual(projected["reviews"][0]["id"], review.review["id"])

            (review.root_dir / REVIEW_MARKDOWN).write_text("tampered\n", encoding="utf-8")
            with self.assertRaises(AutoQuantValidationError) as tampered:
                load_review(project, review.review["id"])
            self.assertIn("review.tampered", {item.code for item in tampered.exception.issues})

    def test_detached_review_preserves_workspace_and_verifies_portably(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            workspace, project, run, report = self._completed_project(root)
            before = {
                path.relative_to(workspace.root_dir).as_posix(): path.read_bytes()
                for path in workspace.root_dir.rglob("*")
                if path.is_file()
            }
            review = publish_review(
                project,
                report.report["id"],
                review_analysis(report.report["id"], run.result["id"]),
                observation_root=workspace.root_dir,
                observation_scope="workspace",
                output_root=root / "detached-reviews",
            )
            after = {
                path.relative_to(workspace.root_dir).as_posix(): path.read_bytes()
                for path in workspace.root_dir.rglob("*")
                if path.is_file()
            }
            self.assertEqual(before, after)
            self.assertEqual(list_reviews(project), [])
            self.assertEqual(load_review_package(review.root_dir).review, review.review)
            self.assertEqual(
                load_review_package(review.root_dir, project=project).review,
                review.review,
            )

            with self.assertRaises(AutoQuantValidationError) as boundary:
                publish_review(
                    project,
                    report.report["id"],
                    review_analysis(report.report["id"], run.result["id"]),
                    observation_root=workspace.root_dir,
                    observation_scope="workspace",
                    output_root=workspace.root_dir / "detached",
                )
            self.assertIn(
                "review.detached-boundary",
                {item.code for item in boundary.exception.issues},
            )

    def test_classification_and_target_reference_authority_are_enforced(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace, project, run, report = self._completed_project(Path(directory))
            invalid = review_analysis(report.report["id"], run.result["id"])
            invalid["claims"][0]["evidenceRefs"] = [
                {
                    "kind": "observed-file",
                    "id": "staging/comparison.json",
                    "artifactPath": None,
                }
            ]
            with self.assertRaises(AutoQuantValidationError) as classification:
                validate_review_analysis(invalid)
            self.assertIn(
                "review.bound-classification",
                {item.code for item in classification.exception.issues},
            )

            wrong = review_analysis(report.report["id"], run.result["id"])
            wrong["claims"][0]["evidenceRefs"][0]["id"] = (
                "run-20000101T000000000000Z-000000000000"
            )
            with self.assertRaises(AutoQuantValidationError) as target:
                publish_review(
                    project,
                    report.report["id"],
                    wrong,
                    observation_root=workspace.root_dir,
                    observation_scope="workspace",
                )
            self.assertIn("review.target-run", {item.code for item in target.exception.issues})

            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "Workspace staging requires a Workspace entry path plus --project",
            ):
                publish_review(
                    project,
                    report.report["id"],
                    review_analysis(report.report["id"], run.result["id"]),
                    observation_root=project.root_dir,
                    observation_scope="project",
                )

    def test_session_bound_report_review_preserves_exact_leader_anchor(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            workspace, project, _run, _report = self._completed_project(root)
            intake = load_project_intake(project)
            assert intake is not None
            session = start_session(
                project,
                "ohlcv-portfolio-quality",
                request=intake["request"],
            )
            session_report = publish_report(
                project,
                session.manifest["id"],
                report_analysis(
                    session.manifest["leader"]["runId"],
                    "artifacts/portfolio-report.json",
                ),
            )
            review = publish_review(
                project,
                session_report.report["id"],
                review_analysis(
                    session_report.report["id"],
                    session.manifest["leader"]["runId"],
                    "artifacts/portfolio-report.json",
                ),
                session_id=session.manifest["id"],
                observation_root=workspace.root_dir,
                observation_scope="workspace",
            )
            self.assertEqual(review.manifest["target"]["sessionId"], session.manifest["id"])
            self.assertEqual(
                review.evidence["target"]["anchor"]["kind"],
                "session",
            )
            self.assertEqual(
                review.evidence["target"]["run"]["id"],
                session.manifest["leader"]["runId"],
            )

    def test_cli_publishes_lists_and_shows_attached_and_detached_reviews(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            workspace, _project, run, report = self._completed_project(root)
            analysis_path = root / "review-analysis.json"
            analysis_path.write_text(
                json.dumps(review_analysis(report.report["id"], run.result["id"])),
                encoding="utf-8",
            )
            published = run_cli(
                "review", "publish", str(workspace.root_dir),
                "--project", "review-desk",
                "--report", report.report["id"],
                "--analysis", str(analysis_path),
                "--json",
            )
            self.assertEqual(published.returncode, 0, published.stderr)
            review_id = json_output(published)["data"]["review"]["id"]
            listed = run_cli(
                "review", "list", str(workspace.root_dir),
                "--project", "review-desk", "--json",
            )
            self.assertEqual(json_output(listed)["data"]["reviews"][0]["id"], review_id)
            shown = run_cli(
                "review", "show", str(workspace.root_dir),
                "--project", "review-desk", "--review", review_id, "--json",
            )
            self.assertEqual(json_output(shown)["data"]["review"]["id"], review_id)

            detached = run_cli(
                "review", "publish", str(workspace.root_dir),
                "--project", "review-desk",
                "--report", report.report["id"],
                "--analysis", str(analysis_path),
                "--output", str(root / "detached"),
                "--json",
            )
            self.assertEqual(detached.returncode, 0, detached.stderr)
            package = json_output(detached)["data"]["packagePath"]
            detached_show = run_cli("review", "show", package, "--json")
            self.assertEqual(detached_show.returncode, 0, detached_show.stderr)
            self.assertTrue(json_output(detached_show)["data"]["detached"])

            help_result = run_cli("review", "publish", "--help")
            self.assertEqual(help_result.returncode, 0, help_result.stderr)
            self.assertIn("Workspace path plus --project", help_result.stdout)


if __name__ == "__main__":
    unittest.main()
