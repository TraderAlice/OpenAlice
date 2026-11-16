from __future__ import annotations

import json
import tempfile
import unittest
from dataclasses import replace

import jsonschema

from autoquant.runs import execute_study
from autoquant.studies import (
    StudyResearchRequest,
    STUDY_JSON_SCHEMA,
    StudyUpstreamArtifact,
    bind_upstream_evidence,
    create_study,
    hash_json,
    list_studies,
    load_study,
)
from autoquant.workspace import AutoQuantValidationError
from tests.study_helpers import make_project, request_definition, study_definition


class StudyContractTests(unittest.TestCase):
    def test_study_binds_exact_request_and_prior_run_artifact(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            _, project = make_project(directory)
            create_study(project, study_definition(study_id="path-stress"))
            prior = execute_study(project, "path-stress")
            requests = project.root_dir / "requests"
            requests.mkdir()
            request_path = requests / "recovery.json"
            request_path.write_text(
                json.dumps(request_definition()),
                encoding="utf-8",
            )
            upstream = bind_upstream_evidence(
                project,
                prior.result["id"],
                ["artifacts/report.json"],
            )
            study = create_study(
                project,
                study_definition(
                    study_id="drawdown-recovery",
                    dependencies=["requests/recovery.json"],
                    research_request=StudyResearchRequest(
                        "requests/recovery.json"
                    ),
                    upstream_evidence=upstream,
                ),
            )

            self.assertEqual(
                study.definition.research_request.path,
                "requests/recovery.json",
            )
            self.assertEqual(
                study.definition.upstream_evidence.run_id,
                prior.result["id"],
            )
            self.assertEqual(
                study.upstream_evidence_hash,
                hash_json(study.definition.to_dict()["upstream_evidence"]),
            )
            self.assertIn("requests/recovery.json", study.dependency_hashes)
            jsonschema.validate(study.definition.to_dict(), STUDY_JSON_SCHEMA)

    def test_request_and_upstream_bindings_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            _, project = make_project(directory)
            create_study(project, study_definition(study_id="path-stress"))
            prior = execute_study(project, "path-stress")
            request_dir = project.root_dir / "requests"
            request_dir.mkdir()
            (request_dir / "recovery.json").write_text(
                json.dumps(request_definition()) + "\n",
                encoding="utf-8",
            )
            upstream = bind_upstream_evidence(
                project,
                prior.result["id"],
                ["artifacts/report.json"],
            )

            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "must be exact fixed dependencies",
            ):
                create_study(
                    project,
                    study_definition(
                        study_id="missing-request-binding",
                        research_request=StudyResearchRequest(
                            "requests/recovery.json"
                        ),
                        upstream_evidence=upstream,
                    ),
                )

            bad_artifact = replace(
                upstream.artifacts[0],
                sha256="0" * 64,
            )
            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "artifact hash differs",
            ):
                create_study(
                    project,
                    study_definition(
                        study_id="bad-upstream-binding",
                        dependencies=["requests/recovery.json"],
                        research_request=StudyResearchRequest(
                            "requests/recovery.json"
                        ),
                        upstream_evidence=replace(
                            upstream,
                            artifacts=[
                                StudyUpstreamArtifact(
                                    bad_artifact.path,
                                    bad_artifact.sha256,
                                )
                            ],
                        ),
                    ),
                )

    def test_legacy_dataset_preserves_v1_serialization_and_hash(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            _, project = make_project(directory)
            definition = study_definition()
            self.assertNotIn("paths", definition.to_dict()["dataset"])
            study = create_study(project, definition)
            self.assertEqual(
                study.dataset_hash,
                hash_json(definition.to_dict()["dataset"]),
            )
            self.assertEqual(study.dataset_hashes, {})

    def test_content_locked_dataset_hash_tracks_file_bytes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            _, project = make_project(directory)
            data = project.root_dir / "data" / "bars"
            data.mkdir()
            source = data / "AAA.csv"
            source.write_text("timestamp,close\n2026-01-01,1\n", encoding="utf-8")
            create_study(
                project,
                study_definition(dataset_paths=["bars/**"]),
            )
            before = load_study(project, "factor-quality")
            self.assertEqual(list(before.dataset_hashes), ["bars/AAA.csv"])
            source.write_text("timestamp,close\n2026-01-01,2\n", encoding="utf-8")
            after = load_study(project, "factor-quality")
            self.assertNotEqual(before.dataset_hash, after.dataset_hash)
            self.assertNotEqual(before.input_hash, after.input_hash)

    def test_fixed_dependency_changes_input_without_becoming_editable_source(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            _, project = make_project(directory)
            models = project.root_dir / "models"
            models.mkdir(exist_ok=True)
            (models / "policy.py").write_text("POLICY = 'v1'\n", encoding="utf-8")
            study = create_study(
                project,
                study_definition(
                    editable=["models/**"],
                    dependencies=["factors/candidate.py"],
                ),
            )
            self.assertEqual(
                list(study.dependency_hashes),
                ["factors/candidate.py"],
            )
            self.assertNotIn(
                "dependencies",
                study_definition().to_dict(),
            )
            before_source = study.source_hash
            before_dependency = study.dependency_hash
            before_input = study.input_hash

            (project.root_dir / "factors" / "candidate.py").write_text(
                "SCORE = 3.5\n",
                encoding="utf-8",
            )
            changed = load_study(project, "factor-quality")
            self.assertEqual(changed.source_hash, before_source)
            self.assertNotEqual(changed.dependency_hash, before_dependency)
            self.assertNotEqual(changed.input_hash, before_input)

    def test_dependency_must_be_nonempty_fixed_source_disjoint_from_editable(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            _, project = make_project(directory)
            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "cannot also be editable",
            ):
                create_study(
                    project,
                    study_definition(
                        dependencies=["factors/candidate.py"],
                    ),
                )

        with tempfile.TemporaryDirectory() as directory:
            _, project = make_project(directory)
            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "not a file|matched no files",
            ):
                create_study(
                    project,
                    study_definition(
                        editable=["models/**"],
                        dependencies=["models/missing.py"],
                    ),
                )

    def test_study_pins_program_judge_sources_editable_sources_and_dataset(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            _, project = make_project(directory)
            study = create_study(project, study_definition())

            self.assertEqual(study.definition.id, "factor-quality")
            self.assertIn("judges/evaluate.py", study.judge_hashes)
            self.assertIn("factors/candidate.py", study.editable_hashes)
            self.assertEqual(len(study.study_hash), 64)
            self.assertEqual(len(study.program_hash), 64)
            self.assertEqual(len(study.judge_hash), 64)
            self.assertEqual(len(study.source_hash), 64)
            self.assertEqual(len(study.dataset_hash), 64)
            self.assertEqual(len(study.input_hash), 64)
            self.assertIn("fixed", study.program_path.read_text())

            summaries = list_studies(project)
            self.assertEqual([item.id for item in summaries], ["factor-quality"])
            self.assertEqual(summaries[0].subject_kind, "factor")
            self.assertEqual(summaries[0].primary_metric, "score")

    def test_editable_closure_cannot_contain_judge_or_study_contract(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            _, project = make_project(directory)
            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "strategy, factor, or model source directories",
            ):
                create_study(
                    project,
                    study_definition(editable=["judges/**"]),
                )

        with tempfile.TemporaryDirectory() as directory:
            _, project = make_project(directory)
            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "strategy, factor, or model source directories",
            ):
                create_study(
                    project,
                    study_definition(editable=["studies/**"]),
                )

    def test_editable_closure_cannot_claim_data_runs_or_cache(self) -> None:
        for pattern in ("data/**", "runs/**", ".autoquant/**"):
            with self.subTest(pattern=pattern), tempfile.TemporaryDirectory() as directory:
                _, project = make_project(directory)
                with self.assertRaisesRegex(
                    AutoQuantValidationError,
                    "strategy, factor, or model source directories",
                ):
                    create_study(
                        project,
                        study_definition(editable=[pattern]),
                    )

    def test_study_hash_changes_only_for_the_identity_surface_that_changed(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            _, project = make_project(directory)
            first = create_study(project, study_definition())
            original_study_hash = first.study_hash
            original_judge_hash = first.judge_hash
            original_source_hash = first.source_hash

            (project.root_dir / "factors" / "candidate.py").write_text(
                "SCORE = 2.5\n",
                encoding="utf-8",
            )
            changed = load_study(project, "factor-quality")
            self.assertEqual(changed.study_hash, original_study_hash)
            self.assertEqual(changed.judge_hash, original_judge_hash)
            self.assertNotEqual(changed.source_hash, original_source_hash)
            self.assertNotEqual(changed.input_hash, first.input_hash)

    def test_unknown_keys_and_judge_outside_fixed_closure_fail(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            _, project = make_project(directory)
            study = create_study(project, study_definition())
            raw = json.loads(study.manifest_path.read_text())
            raw["unknown"] = True
            study.manifest_path.write_text(json.dumps(raw))
            with self.assertRaisesRegex(AutoQuantValidationError, "Unknown field"):
                load_study(project, "factor-quality")

        with tempfile.TemporaryDirectory() as directory:
            _, project = make_project(directory)
            definition = study_definition()
            definition = type(definition)(
                **{
                    **definition.__dict__,
                    "judge": type(definition.judge)(
                        "python",
                        "factors/candidate.py",
                        ["judges/**"],
                        [],
                        10,
                    ),
                }
            )
            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "entrypoint must be included",
            ):
                create_study(project, definition)


if __name__ == "__main__":
    unittest.main()
