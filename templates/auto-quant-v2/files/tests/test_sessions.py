from __future__ import annotations

import json
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import autoquant.sessions as session_module
from autoquant.runs import execute_study, list_runs
from autoquant.sessions import (
    SESSION_WORKTREE_MARKER,
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
from autoquant.studies import (
    StudyResearchRequest,
    bind_upstream_evidence,
    create_study,
)
from autoquant.workspace import AutoQuantValidationError
from tests.study_helpers import (
    make_project,
    request_definition,
    study_definition,
)


class GovernedResearchSessionTests(unittest.TestCase):
    def test_session_preserves_exact_upstream_evidence_authority(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            _, project = make_project(directory)
            create_study(project, study_definition(study_id="path-stress"))
            prior = execute_study(project, "path-stress")
            request = project.root_dir / "requests" / "recovery.json"
            request.parent.mkdir()
            request.write_text(
                json.dumps(request_definition()) + "\n",
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

            session = start_session(project, "drawdown-recovery")
            snapshot = session_snapshot(project, session)

            self.assertTrue(snapshot["authority"]["valid"])
            self.assertEqual(
                len(session.manifest["locks"]["upstreamEvidenceHash"]),
                64,
            )
            self.assertEqual(
                session.baseline_run.result["upstreamEvidence"]["run_id"],
                prior.result["id"],
            )

    def _setup(self, directory: str):
        _, project = make_project(directory)
        create_study(project, study_definition())
        session = start_session(project, "factor-quality")
        return project, session

    def test_session_starts_from_successful_baseline_without_mutating_project(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project, session = self._setup(directory)

            self.assertEqual(session.manifest["status"], "active")
            self.assertEqual(session.manifest["baseline"], session.manifest["leader"])
            self.assertEqual(
                session.manifest["baselineGuard"],
                {
                    "mode": "fresh-run-no-preflight",
                    "baselineRunId": session.baseline_run.result["id"],
                    "preflight": None,
                },
            )
            self.assertEqual(session.manifest["leader"]["value"], 1.25)
            self.assertEqual(
                (project.root_dir / "factors/candidate.py").read_text(),
                "SCORE = 1.25\n",
            )
            self.assertEqual(
                (session.worktree_project.root_dir / "factors/candidate.py").read_text(),
                "SCORE = 1.25\n",
            )
            snapshot = session_snapshot(project, session)
            self.assertTrue(snapshot["authority"]["valid"])
            self.assertFalse(snapshot["candidate"]["differsFromLeader"])
            self.assertEqual(len(list_runs(project)), 1)
            self.assertEqual([item.id for item in list_sessions(project)], [session.manifest["id"]])

    def test_worktree_marker_resolves_only_its_exact_locked_owner(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project, session = self._setup(directory)
            marker = session.worktree_project.root_dir / SESSION_WORKTREE_MARKER

            self.assertTrue(marker.is_file())
            self.assertIn(
                SESSION_WORKTREE_MARKER,
                session.manifest["locks"]["fixedHashes"],
            )
            self.assertIn(
                SESSION_WORKTREE_MARKER,
                session_module._fixed_inventory(
                    session.worktree_project,
                    [SESSION_WORKTREE_MARKER],
                ),
            )
            resolved = resolve_session_worktree_owner(
                session.worktree_project
            )
            self.assertIsNotNone(resolved)
            owner, owning_session = resolved
            self.assertEqual(owner.root_dir, project.root_dir)
            self.assertEqual(
                owning_session.manifest["id"],
                session.manifest["id"],
            )

            detached_root = (
                Path(directory)
                / "detached"
                / project.manifest.id
            )
            detached_root.parent.mkdir()
            shutil.copytree(
                session.worktree_project.root_dir,
                detached_root,
            )
            detached = session_module.load_project(detached_root)
            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "detached from its owning Project",
            ):
                resolve_session_worktree_owner(detached)

    def test_worktree_marker_rejects_tampering_and_symlinks(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            _, session = self._setup(directory)
            marker = session.worktree_project.root_dir / SESSION_WORKTREE_MARKER
            value = json.loads(marker.read_text(encoding="utf-8"))
            value["projectId"] = "forged-project"
            marker.write_text(json.dumps(value), encoding="utf-8")
            forged = session_module.load_project(
                session.worktree_project.root_dir
            )
            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "Project id mismatch",
            ):
                resolve_session_worktree_owner(forged)

        with tempfile.TemporaryDirectory() as directory:
            _, session = self._setup(directory)
            marker = session.worktree_project.root_dir / SESSION_WORKTREE_MARKER
            value = json.loads(marker.read_text(encoding="utf-8"))
            marker.write_text(json.dumps(value), encoding="utf-8")
            reserialized = session_module.load_project(
                session.worktree_project.root_dir
            )
            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "differs from its fixed lock",
            ):
                resolve_session_worktree_owner(reserialized)

        with tempfile.TemporaryDirectory() as directory:
            _, session = self._setup(directory)
            marker = session.worktree_project.root_dir / SESSION_WORKTREE_MARKER
            target = Path(directory) / "outside-marker.json"
            target.write_text("{}", encoding="utf-8")
            marker.unlink()
            marker.symlink_to(target)
            linked = session_module.load_project(
                session.worktree_project.root_dir
            )
            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "marker must be a real file",
            ):
                resolve_session_worktree_owner(linked)

        with tempfile.TemporaryDirectory() as directory:
            _, session = self._setup(directory)
            marker = session.worktree_project.root_dir / SESSION_WORKTREE_MARKER
            marker.unlink()
            unmarked = session_module.load_project(
                session.worktree_project.root_dir
            )
            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "missing its locked owner marker",
            ):
                resolve_session_worktree_owner(unmarked)

        with tempfile.TemporaryDirectory() as directory:
            _, ordinary = make_project(directory)
            marker = ordinary.root_dir / SESSION_WORKTREE_MARKER
            marker.write_text(
                json.dumps(
                    {
                        "schemaVersion": 1,
                        "kind": "autoquant-session-worktree",
                        "projectId": ordinary.manifest.id,
                        "sessionId": (
                            "session-20260729T120000000000Z-aaaaaaaaaaaa"
                        ),
                    }
                ),
                encoding="utf-8",
            )
            forged = session_module.load_project(ordinary.root_dir)
            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "detached from its owning Project",
            ):
                resolve_session_worktree_owner(forged)

    def test_session_reuses_an_exact_successful_baseline_run(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            _, project = make_project(directory)
            create_study(project, study_definition())
            baseline = execute_study(project, "factor-quality")

            with mock.patch.object(
                session_module,
                "execute_study",
                side_effect=AssertionError("exact baseline must be reused"),
            ):
                session = start_session(project, "factor-quality")

            self.assertEqual(
                session.manifest["baseline"]["runId"],
                baseline.result["id"],
            )
            self.assertEqual(len(list_runs(project)), 1)

    def test_repository_research_commit_does_not_stale_or_duplicate_baseline(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            _, project = make_project(directory)
            create_study(project, study_definition())
            baseline = execute_study(project, "factor-quality")
            recorded = baseline.result["harness"]
            after_research_commit = {
                **recorded,
                "commit": "f" * 40,
                "dirty": not recorded["dirty"],
            }

            with (
                mock.patch.object(
                    session_module,
                    "harness_identity",
                    return_value=after_research_commit,
                ),
                mock.patch.object(
                    session_module,
                    "execute_study",
                    side_effect=AssertionError(
                        "a research-only commit must reuse the exact runtime"
                    ),
                ),
            ):
                session = start_session(project, "factor-quality")
                snapshot = session_snapshot(project, session)

            self.assertEqual(
                session.manifest["baseline"]["runId"],
                baseline.result["id"],
            )
            self.assertTrue(snapshot["authority"]["valid"])
            self.assertEqual(len(list_runs(project)), 1)

    def test_harness_source_change_stales_session(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project, session = self._setup(directory)
            changed_runtime = {
                **session.manifest["locks"]["harness"],
                "sourceHash": "f" * 64,
            }

            with mock.patch.object(
                session_module,
                "harness_identity",
                return_value=changed_runtime,
            ):
                snapshot = session_snapshot(project, session)

            self.assertFalse(snapshot["authority"]["valid"])
            self.assertIn(
                "session.harness-stale",
                {item["code"] for item in snapshot["authority"]["issues"]},
            )

    def test_keep_revert_and_crash_advance_or_restore_the_linear_leader(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project, session = self._setup(directory)
            candidate = session.worktree_project.root_dir / "factors/candidate.py"

            candidate.write_text("SCORE = 2.0\n")
            keep = evaluate_experiment(
                project,
                session.manifest["id"],
                "Increase the synthetic factor score.",
            )
            self.assertEqual(keep.result["verdict"], "KEEP")
            self.assertEqual(keep.result["candidate"]["value"], 2.0)
            session = load_session(project, session.manifest["id"])
            self.assertEqual(session.manifest["leader"]["value"], 2.0)
            self.assertEqual(candidate.read_text(), "SCORE = 2.0\n")

            candidate.write_text("SCORE = 1.0\n")
            revert = evaluate_experiment(
                project,
                session.manifest["id"],
                "Try a weaker coefficient.",
            )
            self.assertEqual(revert.result["verdict"], "REVERT")
            self.assertLess(revert.result["improvement"], 0)
            self.assertEqual(candidate.read_text(), "SCORE = 2.0\n")

            candidate.write_text("this is invalid python\n")
            crash = evaluate_experiment(
                project,
                session.manifest["id"],
                "Exercise failure evidence.",
            )
            self.assertEqual(crash.result["verdict"], "CRASH")
            self.assertTrue(crash.result["errors"])
            self.assertEqual(candidate.read_text(), "SCORE = 2.0\n")

            session = load_session(project, session.manifest["id"])
            history = list_experiments(project, session)
            self.assertEqual(
                [item.verdict for item in history],
                ["KEEP", "REVERT", "CRASH"],
            )
            self.assertEqual(session.manifest["nextExperiment"], 4)
            self.assertEqual(len(list_runs(project)), 4)
            self.assertEqual(
                (project.root_dir / "factors/candidate.py").read_text(),
                "SCORE = 1.25\n",
            )

    def test_fixed_and_undeclared_worktree_changes_are_rejected_before_run(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project, session = self._setup(directory)
            worktree = session.worktree_project.root_dir
            (worktree / "factors/candidate.py").write_text("SCORE = 2.0\n")
            (worktree / "judges/evaluate.py").write_text("raise SystemExit(9)\n")

            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "outside the editable closure changed",
            ):
                evaluate_experiment(project, session.manifest["id"], "Cheat")
            self.assertEqual(len(list_runs(project)), 1)

    def test_dependency_is_copied_read_only_and_upstream_change_stales_session(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            _, project = make_project(directory)
            models = project.root_dir / "models"
            models.mkdir(exist_ok=True)
            (models / "policy.py").write_text("POLICY = 'v1'\n", encoding="utf-8")
            create_study(
                project,
                study_definition(
                    editable=["models/**"],
                    dependencies=["factors/candidate.py"],
                ),
            )
            session = start_session(project, "factor-quality")
            dependency = (
                session.worktree_project.root_dir
                / "factors"
                / "candidate.py"
            )
            self.assertTrue(dependency.is_file())
            dependency.write_text("SCORE = 9.0\n", encoding="utf-8")
            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "dependencyHash differs|outside the editable closure changed",
            ):
                evaluate_experiment(
                    project,
                    session.manifest["id"],
                    "Attempt to edit the fixed upstream factor.",
                )

            dependency.write_text("SCORE = 1.25\n", encoding="utf-8")
            (project.root_dir / "factors" / "candidate.py").write_text(
                "SCORE = 2.0\n",
                encoding="utf-8",
            )
            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "dependencyHash differs",
            ):
                evaluate_experiment(
                    project,
                    session.manifest["id"],
                    "Use a stale upstream factor.",
                )

        with tempfile.TemporaryDirectory() as directory:
            project, session = self._setup(directory)
            worktree = session.worktree_project.root_dir
            (worktree / "factors/candidate.py").write_text("SCORE = 2.0\n")
            (worktree / "rogue.py").write_text("ROGUE = True\n")

            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "outside the editable closure changed",
            ):
                evaluate_experiment(project, session.manifest["id"], "Escape")
            self.assertEqual(len(list_runs(project)), 1)

    def test_promotion_applies_exact_keep_and_stale_base_changes_nothing(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project, session = self._setup(directory)
            candidate = session.worktree_project.root_dir / "factors/candidate.py"
            candidate.write_text("SCORE = 2.0\n")
            evaluate_experiment(project, session.manifest["id"], "Improve")

            receipt = promote_session(project, session.manifest["id"])
            self.assertEqual(receipt["beforeSourceHash"], session.manifest["leader"]["sourceHash"])
            self.assertNotEqual(receipt["afterSourceHash"], receipt["beforeSourceHash"])
            self.assertEqual(
                (project.root_dir / "factors/candidate.py").read_text(),
                "SCORE = 2.0\n",
            )
            promoted = load_session(project, session.manifest["id"])
            self.assertEqual(promoted.manifest["status"], "promoted")
            self.assertTrue((promoted.root_dir / "promotion.json").is_file())

        with tempfile.TemporaryDirectory() as directory:
            project, session = self._setup(directory)
            candidate = session.worktree_project.root_dir / "factors/candidate.py"
            candidate.write_text("SCORE = 2.0\n")
            evaluate_experiment(project, session.manifest["id"], "Improve")
            project_source = project.root_dir / "factors/candidate.py"
            project_source.write_text("SCORE = 9.0\n")

            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "changed since Session start",
            ):
                promote_session(project, session.manifest["id"])
            self.assertEqual(project_source.read_text(), "SCORE = 9.0\n")
            self.assertFalse((session.root_dir / "promotion.json").exists())

    def test_experiment_loader_rejects_tampering(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project, session = self._setup(directory)
            (session.worktree_project.root_dir / "factors/candidate.py").write_text(
                "SCORE = 2.0\n"
            )
            experiment = evaluate_experiment(
                project,
                session.manifest["id"],
                "Improve",
            )
            result_path = experiment.root_dir / "result.json"
            value = json.loads(result_path.read_text())
            value["hypothesis"] = "tampered"
            result_path.write_text(json.dumps(value))

            with self.assertRaisesRegex(AutoQuantValidationError, "files changed"):
                load_experiment(
                    project,
                    load_session(project, session.manifest["id"]),
                    experiment.result["id"],
                )

    def test_session_pointer_cannot_invent_a_keep_outside_experiment_history(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project, session = self._setup(directory)
            unrelated = execute_study(project, "factor-quality")
            manifest = json.loads(session.manifest_path.read_text())
            manifest["leader"] = {
                "runId": unrelated.result["id"],
                "sourceHash": unrelated.result["subject"]["sourceHash"],
                "metric": unrelated.result["objective"]["metric"],
                "value": unrelated.result["metrics"]["score"],
            }
            session.manifest_path.write_text(json.dumps(manifest))

            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "immutable KEEP history",
            ):
                promote_session(project, session.manifest["id"])

    def test_promotion_rolls_back_source_when_receipt_commit_fails(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project, session = self._setup(directory)
            candidate = session.worktree_project.root_dir / "factors/candidate.py"
            candidate.write_text("SCORE = 2.0\n")
            evaluate_experiment(project, session.manifest["id"], "Improve")
            original_atomic_write = session_module._atomic_write_json
            attempts = 0

            def fail_once(path, value):
                nonlocal attempts
                attempts += 1
                if attempts == 1:
                    raise OSError("simulated receipt commit failure")
                return original_atomic_write(path, value)

            with mock.patch(
                "autoquant.sessions._atomic_write_json",
                side_effect=fail_once,
            ):
                with self.assertRaisesRegex(OSError, "simulated"):
                    promote_session(project, session.manifest["id"])

            self.assertEqual(
                (project.root_dir / "factors/candidate.py").read_text(),
                "SCORE = 1.25\n",
            )
            recovered = load_session(project, session.manifest["id"])
            self.assertEqual(recovered.manifest["status"], "active")
            self.assertFalse((recovered.root_dir / "promotion.json").exists())


if __name__ == "__main__":
    unittest.main()
