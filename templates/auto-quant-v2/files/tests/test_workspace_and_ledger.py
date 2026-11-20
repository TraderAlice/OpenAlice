from __future__ import annotations

import os
from pathlib import Path
import tempfile
import unittest

import pandas as pd

import autoquant as aq


class WorkspaceAndLedgerTests(unittest.TestCase):
    def test_workspace_init_and_local_override_and_confinement(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws_dir = Path(tmp) / "desk"
            ws = aq.initialize_workspace(ws_dir, name="Alpha Desk", materialize_skills=False)
            self.assertEqual(ws.manifest.name, "Alpha Desk")
            self.assertEqual(ws.manifest.schema_version, 1)
            self.assertIsNone(ws.manifest.default_project)

            # Reject path traversal and symlinks in confined_path
            with self.assertRaises(aq.AutoQuantValidationError):
                aq.confined_path(ws_dir, "../escape")
            outside = Path(tmp) / "outside"
            outside.mkdir()
            link_path = ws_dir / "projects" / "evil-link"
            os.symlink(outside, link_path)
            with self.assertRaises(aq.AutoQuantValidationError):
                aq.list_projects(ws_dir)
            link_path.unlink()

            # Support autoquant-workspace.local.json with absolute projects_directory
            ext_projects = Path(tmp) / "external-projects"
            ext_projects.mkdir()
            (ws_dir / aq.WORKSPACE_LOCAL_MANIFEST).write_text(
                f'{{"projects_directory": "{ext_projects.as_posix()}"}}\n',
                encoding="utf-8",
            )
            ws_reloaded = aq.load_workspace(ws_dir)
            self.assertEqual(ws_reloaded.projects_dir, ext_projects.resolve())
            proj = aq.create_project(
                ws_reloaded,
                "us-momentum",
                name="US Momentum",
                description="Cross-sectional momentum",
                train_end="2022-12-31",
                val_end="2024-06-30",
                holdout_end="2025-12-31",
            )
            self.assertTrue((ext_projects / "us-momentum" / "project.json").is_file())
            self.assertTrue((ext_projects / "us-momentum" / "research.md").is_file())
            self.assertTrue((ext_projects / "us-momentum" / "data").is_dir())
            self.assertTrue((ext_projects / "us-momentum" / "runs").is_dir())
            self.assertEqual(proj.holdout_audit, {"unlock_count": 0, "unlocks": []})

    def test_project_id_and_split_chronology_validation(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = aq.initialize_workspace(Path(tmp) / "desk", materialize_skills=False)
            with self.assertRaises(aq.AutoQuantValidationError):
                aq.create_project(ws, "Invalid_Slug")
            with self.assertRaises(aq.AutoQuantValidationError):
                aq.create_project(
                    ws,
                    "bad-splits",
                    train_end="2024-06-30",
                    val_end="2023-01-01",
                )

    def test_immutable_run_ledger_artifacts_and_comparison(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = aq.initialize_workspace(Path(tmp) / "desk", materialize_skills=False)
            proj = aq.create_project(
                ws,
                "stat-arb",
                train_end="2022-12-31",
                val_end="2023-12-31",
                holdout_end="2024-12-31",
            )
            eq_df = pd.DataFrame(
                {
                    "timestamp": pd.to_datetime(["2023-01-03", "2023-01-04"], utc=True),
                    "equity": [1.0, 1.02],
                    "returns": [0.0, 0.02],
                    "drawdown": [0.0, 0.0],
                    "turnover": [0.0, 0.5],
                    "gross_exposure": [0.0, 1.0],
                    "net_exposure": [0.0, 0.0],
                }
            )
            custom_svg = Path(tmp) / "curve.svg"
            custom_svg.write_text("<svg></svg>", encoding="utf-8")

            r1 = aq.record_run(
                proj,
                kind="backtest",
                name="baseline-v1",
                split="val",
                metrics={"sharpe": 1.25, "annual_return": 0.14, "nan_metric": float("nan")},
                hypothesis="Mean reversion after 2-sigma move",
                parameters={"z_entry": 2.0},
                equity_df=eq_df,
                artifacts=[
                    custom_svg,
                    {
                        "name": "exposure_chart.json",
                        "content": {"title": "Exposure", "type": "line", "y": [1, 2]},
                    },
                ],
                notes="Clean validation run",
            )
            self.assertRegex(r1["id"], r"^run-\d{8}T\d{6}\d{6}Z-[0-9a-f]{8}$")
            self.assertEqual(r1["provenance"]["harness_version"], "1.0.0")
            self.assertNotIn("nan_metric", r1["metrics"])
            self.assertEqual(r1["series_files"], {"equity": "series/equity.csv"})
            self.assertEqual(len(r1["artifacts"]), 2)

            # Immutability check: duplicate run_id rejected
            with self.assertRaises(aq.AutoQuantValidationError):
                aq.record_run(proj, name="dup", run_id=r1["id"], metrics={"sharpe": 2.0})

            r2 = aq.record_run(
                proj,
                kind="backtest",
                name="improved-v2",
                split="val",
                metrics={"sharpe": 1.85, "annual_return": 0.21},
                parameters={"z_entry": 2.5},
            )
            loaded = aq.load_run(proj, r1["id"], include_series=True)
            self.assertEqual(len(loaded["series"]["equity"]), 2)

            cmp_report = aq.compare_runs(proj, sort_by="sharpe")
            self.assertEqual([row["id"] for row in cmp_report["runs"]], [r2["id"], r1["id"]])


if __name__ == "__main__":
    unittest.main()
