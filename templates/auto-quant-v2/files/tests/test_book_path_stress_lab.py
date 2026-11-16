from __future__ import annotations

import csv
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

import jsonschema

from autoquant.book_path_stress import BOOK_PATH_STRESS_POLICY, load_book_path_stress_policy
from autoquant.book_path_stress_explorer import BOOK_PATH_STRESS_DIAGNOSTICS_JSON_SCHEMA, load_book_path_stress_diagnostics
from autoquant.intake import load_project_intake, prepare_project_intake
from autoquant.orientation import build_agent_work_brief
from autoquant.runs import execute_study
from autoquant.studio import build_studio_snapshot
from autoquant.templates import BOOK_PATH_STRESS_STUDY_ID
from autoquant.workspace import AutoQuantValidationError, create_project, initialize_workspace
from tests.intake_helpers import write_intake_inputs


def _inputs(root: Path) -> tuple[Path, Path]:
    request_path, package_path = write_intake_inputs(
        root,
        observations=260,
        request_assets=("QQQ", "NVDA", "AAPL"),
        asset_position_roles={"QQQ": "long-only", "NVDA": "long-only", "AAPL": "long-only"},
    )
    package = json.loads(package_path.read_text(encoding="utf-8"))
    package["priceAdjustment"] = "split-adjusted"
    package_path.write_text(json.dumps(package, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    request = json.loads(request_path.read_text(encoding="utf-8"))
    request.update(
        {
            "title": "Reported book historical path stress",
            "question": "Which five non-overlapping twenty-session paths hurt this book most?",
            "direction": "research-only",
            "positionSnapshot": {
                "kind": "reported-weights",
                "asOf": "2024-12-27T21:00:00Z",
                "baseCurrency": "USD",
                "weights": {"QQQ": 0.4, "NVDA": 0.25, "AAPL": 0.2},
                "cashWeight": 0.15,
            },
            "pathStressPolicy": {
                "kind": "fixed-unit-worst-terminal-loss-episodes",
                "holdingBars": 20,
                "episodeCount": 5,
                "overlapPolicy": "greedy-worst-terminal-loss-non-overlapping",
            },
            "horizon": "All complete windows ending exactly twenty following sessions later.",
        }
    )
    request_path.write_text(json.dumps(request, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return request_path, package_path


def _rehash_run(run_root: Path) -> None:
    manifest_path = run_root / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["files"] = {
        path.relative_to(run_root).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(run_root.rglob("*"))
        if path.is_file() and path != manifest_path
    }
    manifest["resultHash"] = manifest["files"]["result.json"]
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")


class BookPathStressLabTests(unittest.TestCase):
    def test_synthetic_template_reconciles_selection_paths_and_attribution(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace = initialize_workspace(Path(directory) / "workspace")
            project = create_project(workspace.root_dir, "path-stress", template="ohlcv-book-path-stress-lab")
            run = execute_study(project, BOOK_PATH_STRESS_STUDY_ID)
            self.assertEqual(run.result["status"], "succeeded")
            diagnostics = load_book_path_stress_diagnostics(project, run.result["id"])
            jsonschema.validate(diagnostics, BOOK_PATH_STRESS_DIAGNOSTICS_JSON_SCHEMA)
            self.assertEqual(diagnostics["summary"]["eligibleWindowCount"], 300)
            self.assertEqual(diagnostics["summary"]["selectedEpisodeCount"], 5)
            self.assertEqual(len(diagnostics["episodes"]), 5)
            self.assertEqual(len(diagnostics["paths"]), 105)
            intervals = [(item["startTimestamp"], item["endTimestamp"]) for item in diagnostics["episodes"]]
            for index, left in enumerate(intervals):
                for right in intervals[index + 1 :]:
                    self.assertTrue(left[1] < right[0] or left[0] > right[1])
            for rank in range(1, 6):
                contribution = sum(item["terminalContribution"] for item in diagnostics["contributions"] if item["rank"] == rank)
                self.assertAlmostEqual(contribution, diagnostics["episodes"][rank - 1]["terminalBookReturn"])
            brief = build_agent_work_brief(project)
            self.assertEqual([item["id"] for item in brief["supportingActions"]], ["run.book-path-stress"])
            self.assertEqual(brief["researchAgenda"]["laneId"], "book-path-stress")
            self.assertEqual(brief["researchAgenda"]["moves"], [])
            snapshot = build_studio_snapshot(project.root_dir)["projects"][0]
            self.assertEqual(snapshot["bookPathStressExplorer"]["run"]["id"], run.result["id"])
            self.assertIn("run.book-path-stress", {item["id"] for item in snapshot["commands"]})

    def test_external_intake_binds_reported_book_and_split_adjusted_package(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            request_path, package_path = _inputs(root)
            intake = prepare_project_intake(request_path, package_path, "ohlcv-book-path-stress-lab")
            project = create_project(
                initialize_workspace(root / "workspace").root_dir,
                "reported-path",
                template=intake.template,
                template_intake=intake,
            )
            loaded = load_project_intake(project)
            self.assertEqual(loaded["manifest"]["status"], "ready-for-run")
            policy = load_book_path_stress_policy(project.root_dir / BOOK_PATH_STRESS_POLICY)
            self.assertEqual(policy["path"]["holdingBars"], 20)
            run = execute_study(project, BOOK_PATH_STRESS_STUDY_ID)
            diagnostics = load_book_path_stress_diagnostics(project, run.result["id"])
            self.assertEqual(diagnostics["snapshot"]["snapshotKind"], "reported-weights")
            self.assertEqual(diagnostics["dataset"]["priceAdjustment"], "split-adjusted")

    def test_explorer_rejects_semantically_rehashed_selection_tamper(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project = create_project(
                initialize_workspace(Path(directory) / "workspace").root_dir,
                "path-stress",
                template="ohlcv-book-path-stress-lab",
            )
            run = execute_study(project, BOOK_PATH_STRESS_STUDY_ID)
            run_root = run.root_dir
            path = run_root / "artifacts" / "book-path-stress-windows.csv"
            with path.open("r", encoding="utf-8", newline="") as handle:
                rows = list(csv.DictReader(handle))
                columns = list(rows[0])
            selected = next(row for row in rows if row["selectedRank"] == "1")
            replacement = next(row for row in rows if row["selectedRank"] == "")
            selected["selectedRank"] = ""
            replacement["selectedRank"] = "1"
            with path.open("w", encoding="utf-8", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=columns, lineterminator="\n")
                writer.writeheader()
                writer.writerows(rows)
            _rehash_run(run_root)
            with self.assertRaises(AutoQuantValidationError) as captured:
                load_book_path_stress_diagnostics(project, run.result["id"])
            self.assertEqual({item.code for item in captured.exception.issues}, {"book-path-stress.selection"})

    def test_raw_or_provider_adjusted_package_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            request_path, package_path = _inputs(root)
            package = json.loads(package_path.read_text(encoding="utf-8"))
            package["priceAdjustment"] = "provider-adjusted"
            package_path.write_text(json.dumps(package, indent=2, sort_keys=True) + "\n", encoding="utf-8")
            with self.assertRaises(AutoQuantValidationError) as captured:
                prepare_project_intake(request_path, package_path, "ohlcv-book-path-stress-lab")
            self.assertIn("request.path-stress-adjustment", {item.code for item in captured.exception.issues})


if __name__ == "__main__":
    unittest.main()
