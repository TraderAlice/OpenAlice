from __future__ import annotations

import csv
import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import jsonschema
import pandas as pd

from autoquant.event_explorer import (
    EVENT_STUDY_DIAGNOSTICS_JSON_SCHEMA,
    load_event_study_diagnostics,
)
from autoquant.event_studies import (
    EVENT_STUDY_POLICY,
    load_event_study_policy,
)
from autoquant.intake import load_project_intake, prepare_project_intake
from autoquant.orientation import build_agent_work_brief
from autoquant.runs import execute_study
from autoquant.sessions import start_session
from autoquant.studio import build_studio_snapshot
from autoquant.templates import EVENT_STUDY_ID
from autoquant.workspace import (
    AutoQuantValidationError,
    create_project,
    initialize_workspace,
)
from tests.intake_helpers import write_intake_inputs


PROJECT_DIR = Path(__file__).resolve().parents[1]


def _event_inputs(
    root: Path,
    *,
    threshold: float = -0.05,
    minimum_events: int = 3,
) -> tuple[Path, Path]:
    request_path, package_path = write_intake_inputs(
        root,
        observations=260,
        request_assets=("NVDA", "SPY"),
    )
    request = json.loads(request_path.read_text(encoding="utf-8"))
    request["title"] = "NVDA fixed downside-gap delayed reaction"
    request["question"] = "Does the fixed delayed gap reaction have advantage?"
    request["direction"] = "research-only"
    request["eventPolicy"] = {
        "kind": "opening-gap-delayed-close-return",
        "asset": "NVDA",
        "comparator": "less-than-or-equal",
        "thresholdReturn": threshold,
        "waitBars": 2,
        "holdingBars": 5,
        "referenceAsset": "SPY",
        "overlapPolicy": "keep-first-until-exit",
        "minimumEvents": minimum_events,
    }
    request["horizon"] = "Enter at t+2 close and exit at t+7 close."
    request_path.write_text(
        json.dumps(request, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    if threshold == -0.05:
        path = root / "external-data" / "NVDA.csv"
        frame = pd.read_csv(path)
        for position in (30, 34, 80, 130, 200, 256):
            frame.loc[position, "open"] = (
                float(frame.loc[position - 1, "close"]) * 0.94
            )
            frame.loc[position, "low"] = min(
                float(frame.loc[position, "low"]),
                float(frame.loc[position, "open"]) * 0.99,
            )
        frame.to_csv(path, index=False)
    return request_path, package_path


def _rehash_run(run_root: Path) -> None:
    manifest_path = run_root / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["files"] = {
        path.relative_to(run_root).as_posix(): hashlib.sha256(
            path.read_bytes()
        ).hexdigest()
        for path in sorted(run_root.rglob("*"))
        if path.is_file() and path != manifest_path
    }
    manifest["resultHash"] = manifest["files"]["result.json"]
    manifest_path.write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


class EventStudyLabTests(unittest.TestCase):
    def test_synthetic_template_reconciles_timing_overlap_and_censoring(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace = initialize_workspace(Path(directory) / "workspace")
            project = create_project(
                workspace.root_dir,
                "event-study",
                template="ohlcv-event-study-lab",
            )
            study_path = (
                project.root_dir / "studies" / EVENT_STUDY_ID / "study.json"
            )
            study = json.loads(study_path.read_text(encoding="utf-8"))
            self.assertEqual(study["editable"]["paths"], [])
            self.assertEqual(
                study["dependencies"]["paths"],
                [EVENT_STUDY_POLICY],
            )
            run = execute_study(project, EVENT_STUDY_ID)
            self.assertEqual(run.result["status"], "succeeded")
            self.assertEqual(
                run.result["metrics"]["primary_eligible_event_count"],
                4,
            )
            diagnostics = load_event_study_diagnostics(
                project,
                run.result["id"],
            )
            jsonschema.validate(
                diagnostics,
                EVENT_STUDY_DIAGNOSTICS_JSON_SCHEMA,
            )
            self.assertEqual(
                diagnostics["populations"],
                {
                    "qualifyingEvents": 6,
                    "completeEvents": 5,
                    "rightCensoredEvents": 1,
                    "primaryEvents": 4,
                    "overlapExcludedEvents": 1,
                    "unconditionalObservations": 315,
                },
            )
            self.assertEqual(
                diagnostics["events"][0]["entryTimestamp"],
                "2024-03-28",
            )
            self.assertEqual(
                diagnostics["events"][0]["exitTimestamp"],
                "2024-04-04",
            )
            self.assertEqual(
                diagnostics["events"][1]["overlapReason"],
                "overlapping-prior-primary",
            )
            self.assertEqual(
                diagnostics["events"][-1]["outcomeStatus"],
                "right-censored",
            )
            self.assertEqual(
                diagnostics["conclusion"]["tradingAuthority"],
                "none",
            )
            brief = build_agent_work_brief(project)
            self.assertIsNone(brief["primaryAction"])
            self.assertEqual(
                [item["id"] for item in brief["supportingActions"]],
                ["run.event-study"],
            )
            self.assertEqual(brief["focus"]["operatingMode"], "observe")
            self.assertEqual(brief["review"]["status"], "complete")
            self.assertIn(
                "Write and return the decision-support answer",
                brief["review"]["next"],
            )
            self.assertFalse(brief["filesystem"]["writable"])
            self.assertEqual(brief["filesystem"]["declaredEditablePaths"], [])
            self.assertEqual(
                brief["researchAgenda"]["status"],
                "descriptive-audit-complete",
            )
            self.assertEqual(
                brief["researchAgenda"]["laneId"],
                "event-study",
            )
            self.assertEqual(
                brief["researchAgenda"]["authority"]["testRole"],
                "event-population-and-reference-context",
            )
            self.assertEqual(brief["researchAgenda"]["moves"], [])
            self.assertEqual(
                brief["researchAgenda"]["run"]["inputHash"],
                run.result["inputHash"],
            )
            snapshot = build_studio_snapshot(project.root_dir)
            projected = snapshot["projects"][0]["eventStudyExplorer"]
            self.assertEqual(
                projected["run"]["id"],
                run.result["id"],
            )
            self.assertIn(
                "run.event-study",
                {
                    command["id"]
                    for command in snapshot["projects"][0]["commands"]
                },
            )

    def test_external_intake_binds_policy_and_runs_without_session(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            request_path, package_path = _event_inputs(root)
            intake = prepare_project_intake(
                request_path,
                package_path,
                "ohlcv-event-study-lab",
            )
            project = create_project(
                initialize_workspace(root / "workspace").root_dir,
                "nvda-event",
                template=intake.template,
                template_intake=intake,
            )
            loaded = load_project_intake(project)
            self.assertEqual(loaded["manifest"]["status"], "ready-for-run")
            self.assertTrue(loaded["study"]["current"])
            policy = load_event_study_policy(
                project.root_dir / EVENT_STUDY_POLICY
            )
            self.assertEqual(policy["event"]["asset"], "NVDA")
            self.assertEqual(policy["references"]["matchedAsset"], "SPY")
            with self.assertRaises(AutoQuantValidationError) as captured:
                start_session(project, EVENT_STUDY_ID)
            self.assertEqual(
                {issue.code for issue in captured.exception.issues},
                {"session.fixed-study"},
            )
            run = execute_study(project, EVENT_STUDY_ID)
            diagnostics = load_event_study_diagnostics(
                project,
                run.result["id"],
            )
            self.assertEqual(diagnostics["populations"]["qualifyingEvents"], 6)
            self.assertEqual(diagnostics["populations"]["primaryEvents"], 4)

            result = subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "autoquant",
                    "run",
                    "event-study",
                    str(project.root_dir),
                    "--run",
                    run.result["id"],
                    "--json",
                ],
                cwd=PROJECT_DIR,
                capture_output=True,
                check=False,
                text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            envelope = json.loads(result.stdout)
            self.assertEqual(envelope["command"], "run.event-study")
            self.assertEqual(
                envelope["data"]["conclusion"]["tradingAuthority"],
                "none",
            )

    def test_descriptive_event_keeps_zero_volume_session_and_context_roles(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            request_path, package_path = _event_inputs(root)
            request = json.loads(request_path.read_text(encoding="utf-8"))
            for asset in request["assets"]:
                asset["positionRole"] = "context-only"
            request_path.write_text(
                json.dumps(request, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            package = json.loads(package_path.read_text(encoding="utf-8"))
            reference = next(
                item for item in package["assets"] if item["symbol"] == "SPY"
            )
            source = package_path.parent / reference["path"]
            frame = pd.read_csv(source)
            zero_date = frame.loc[25, "date"]
            frame.loc[25, "volume"] = 0.0
            frame.to_csv(source, index=False)

            intake = prepare_project_intake(
                request_path,
                package_path,
                "ohlcv-event-study-lab",
            )
            self.assertEqual(len(intake.assets[0].frame), 260)
            self.assertEqual(len(intake.assets[1].frame), 260)
            self.assertIn(zero_date, intake.assets[1].frame["timestamp"].tolist())
            project = create_project(
                initialize_workspace(root / "workspace").root_dir,
                "context-event",
                template=intake.template,
                template_intake=intake,
            )
            run = execute_study(project, EVENT_STUDY_ID)
            self.assertEqual(run.result["status"], "succeeded")
            self.assertEqual(
                {asset["positionRole"] for asset in request["assets"]},
                {"context-only"},
            )

    def test_zero_event_study_succeeds_with_insufficient_conclusion(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            request_path, package_path = _event_inputs(
                root,
                threshold=-0.5,
            )
            intake = prepare_project_intake(
                request_path,
                package_path,
                "ohlcv-event-study-lab",
            )
            project = create_project(
                initialize_workspace(root / "workspace").root_dir,
                "no-event",
                template=intake.template,
                template_intake=intake,
            )
            run = execute_study(project, EVENT_STUDY_ID)
            self.assertEqual(run.result["status"], "succeeded")
            diagnostics = load_event_study_diagnostics(
                project,
                run.result["id"],
            )
            self.assertEqual(
                diagnostics["conclusion"]["status"],
                "insufficient-events",
            )
            self.assertEqual(diagnostics["events"], [])
            self.assertEqual(
                diagnostics["distributions"]["primaryEventAsset"]["count"],
                0,
            )

    def test_rehashed_semantic_tampering_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace = initialize_workspace(Path(directory) / "workspace")
            project = create_project(
                workspace.root_dir,
                "tamper-event",
                template="ohlcv-event-study-lab",
            )
            run = execute_study(project, EVENT_STUDY_ID)
            event_path = (
                run.root_dir / "artifacts" / "event-study-events.csv"
            )
            with event_path.open("r", encoding="utf-8", newline="") as handle:
                rows = list(csv.DictReader(handle))
                columns = tuple(rows[0])
            rows[0]["entryTimestamp"] = rows[0]["eventTimestamp"]
            with event_path.open("w", encoding="utf-8", newline="") as handle:
                writer = csv.DictWriter(
                    handle,
                    fieldnames=columns,
                    lineterminator="\n",
                )
                writer.writeheader()
                writer.writerows(rows)
            _rehash_run(run.root_dir)
            with self.assertRaises(AutoQuantValidationError) as captured:
                load_event_study_diagnostics(project, run.result["id"])
            self.assertIn(
                "event-study.timing",
                {issue.code for issue in captured.exception.issues},
            )

    def test_authority_tampering_invalidates_intake(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            request_path, package_path = _event_inputs(root)
            intake = prepare_project_intake(
                request_path,
                package_path,
                "ohlcv-event-study-lab",
            )
            project = create_project(
                initialize_workspace(root / "workspace").root_dir,
                "tamper-policy",
                template=intake.template,
                template_intake=intake,
            )
            path = project.root_dir / EVENT_STUDY_POLICY
            policy = json.loads(path.read_text(encoding="utf-8"))
            policy["timing"]["waitBars"] = 3
            path.write_text(
                json.dumps(policy, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            with self.assertRaises(AutoQuantValidationError):
                load_project_intake(project)

    def test_event_intake_rejects_raw_prices_and_parallel_policy_clocks(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            request_path, package_path = _event_inputs(root)
            request = json.loads(request_path.read_text(encoding="utf-8"))
            request["horizonPolicy"] = {
                "primaryForwardBars": 5,
                "diagnosticForwardBars": [5],
            }
            request_path.write_text(
                json.dumps(request, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            package = json.loads(package_path.read_text(encoding="utf-8"))
            package["priceAdjustment"] = "raw"
            package_path.write_text(
                json.dumps(package, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            with self.assertRaises(AutoQuantValidationError) as captured:
                prepare_project_intake(
                    request_path,
                    package_path,
                    "ohlcv-event-study-lab",
                )
            self.assertEqual(
                {issue.code for issue in captured.exception.issues},
                {
                    "request.event-policy-adjustment",
                    "request.event-policy-exclusive",
                },
            )


if __name__ == "__main__":
    unittest.main()
