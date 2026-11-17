from __future__ import annotations

import contextlib
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock

import pandas as pd

import autoquant as aq
from autoquant.cli import main as cli_main


class DataAndCliTests(unittest.TestCase):
    def _run_cli_json(self, argv: list[str]) -> tuple[int, dict]:
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = cli_main([*argv, "--json"])
        return code, json.loads(buf.getvalue())

    def test_ingest_directory_and_sha256_tamper_detection(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            csv_dir = root / "raw_bars"
            csv_dir.mkdir()
            for sym, px0 in (("AAPL", 180.0), ("MSFT", 380.0)):
                pd.DataFrame(
                    {
                        "date": ["2024-01-02", "2024-01-03", "2024-01-04"],
                        "open": [px0, px0 + 1, px0 + 2],
                        "high": [px0 + 2, px0 + 3, px0 + 4],
                        "low": [px0 - 1, px0, px0 + 1],
                        "close": [px0 + 1, px0 + 2, px0 + 3],
                        "volume": [1000, 1200, 1100],
                    }
                ).to_csv(csv_dir / f"{sym}.csv", index=False)

            ws = aq.initialize_workspace(root / "desk", materialize_skills=False)
            proj = aq.create_project(ws, "equities")
            entry = aq.ingest_ohlcv(proj, csv_dir, dataset_id="us_daily", source="csv-dir")
            self.assertEqual(entry["symbols"], ["AAPL", "MSFT"])
            self.assertEqual(entry["rows"], 6)

            # Corrupt stored CSV and verify SHA-256 check catches tamper
            stored = proj.root_dir / entry["path"]
            stored.write_text(stored.read_text(encoding="utf-8") + "2024-01-05,AAPL,1,1,1,1,1\n", encoding="utf-8")
            with self.assertRaises(aq.AutoQuantValidationError):
                aq.load_panel(proj, dataset_id="us_daily")

    def test_fetch_alice_bars_parses_openalice_json(self) -> None:
        sample_output = json.dumps(
            {
                "bars": [
                    {
                        "date": "2024-02-01",
                        "open": 100.0,
                        "high": 105.0,
                        "low": 99.0,
                        "close": 104.0,
                        "volume": None,
                    },
                    {
                        "date": "2024-02-02",
                        "open": 104.0,
                        "high": 106.0,
                        "low": 103.0,
                        "close": 105.5,
                        "volume": 25000,
                    },
                ],
                "meta": {"symbol": "AAPL", "barId": "yfinance|AAPL"},
            }
        )
        completed = subprocess.CompletedProcess(
            args=["alice"],
            returncode=0,
            stdout=sample_output,
            stderr="",
        )
        with (
            mock.patch("autoquant.data.shutil.which", return_value="/usr/local/bin/alice"),
            mock.patch("autoquant.data.subprocess.run", return_value=completed) as run_mock,
        ):
            df = aq.fetch_alice_bars(
                ["yfinance|AAPL"],
                interval="1d",
                count=250,
                asset_class="equity",
            )
        self.assertEqual(len(df), 2)
        self.assertEqual(list(df["asset"].unique()), ["AAPL"])
        self.assertEqual(float(df.iloc[0]["volume"]), 0.0)
        called_cmd = run_mock.call_args[0][0]
        self.assertEqual(
            called_cmd[:6],
            ["/usr/local/bin/alice", "market", "bars", "--bar-id", "yfinance|AAPL", "--interval"],
        )

    def test_cli_subcommands_end_to_end(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            ws_dir = root / "desk"

            code, ver = self._run_cli_json(["version"])
            self.assertEqual(code, 0)
            self.assertEqual(ver["version"], "1.0.0")

            code, ws_out = self._run_cli_json(["workspace", "init", str(ws_dir), "--name", "Desk"])
            self.assertEqual(code, 0)
            self.assertEqual(ws_out["manifest"]["name"], "Desk")

            code, proj_out = self._run_cli_json(
                [
                    "project",
                    "create",
                    str(ws_dir),
                    "us-mom",
                    "--train-end",
                    "2023-06-30",
                    "--val-end",
                    "2023-12-31",
                    "--holdout-end",
                    "2024-06-30",
                ]
            )
            self.assertEqual(code, 0)
            self.assertEqual(proj_out["id"], "us-mom")

            csv_file = root / "bars.csv"
            pd.DataFrame(
                {
                    "timestamp": ["2023-07-03", "2023-07-03", "2023-07-05", "2023-07-05"],
                    "asset": ["AAPL", "MSFT", "AAPL", "MSFT"],
                    "open": [100.0, 200.0, 101.0, 202.0],
                    "high": [102.0, 204.0, 103.0, 205.0],
                    "low": [99.0, 199.0, 100.0, 201.0],
                    "close": [101.0, 203.0, 102.5, 204.0],
                    "volume": [5000, 6000, 5200, 6100],
                }
            ).to_csv(csv_file, index=False)

            code, ing = self._run_cli_json(
                ["data", "ingest", str(ws_dir), str(csv_file), "--project", "us-mom"]
            )
            self.assertEqual(code, 0)
            self.assertEqual(ing["rows"], 4)

            code, dlist = self._run_cli_json(["data", "list", str(ws_dir), "--project", "us-mom"])
            self.assertEqual(code, 0)
            self.assertEqual(dlist["count"], 1)

            # Record a run and verify status, orient alias, run list/show/compare
            r = aq.record_run(ws_dir, project_id="us-mom", kind="backtest", name="r1", split="val", metrics={"sharpe": 1.5})

            code, st = self._run_cli_json(["status", str(ws_dir)])
            self.assertEqual(code, 0)
            self.assertEqual(st["active_project"]["run_count"], 1)

            code, orient_st = self._run_cli_json(["orient", str(ws_dir), "--project", "us-mom"])
            self.assertEqual(code, 0)
            self.assertEqual(orient_st["active_project"]["id"], "us-mom")

            code, rlist = self._run_cli_json(["run", "list", str(ws_dir), "--project", "us-mom"])
            self.assertEqual(code, 0)
            self.assertEqual(rlist["count"], 1)

            code, rshow = self._run_cli_json(["run", "show", str(ws_dir), r["id"], "--project", "us-mom"])
            self.assertEqual(code, 0)
            self.assertEqual(rshow["id"], r["id"])

            code, rcmp = self._run_cli_json(["run", "compare", str(ws_dir), "--project", "us-mom"])
            self.assertEqual(code, 0)
            self.assertEqual(rcmp["count"], 1)

    def test_cli_studio_delegation_signatures(self) -> None:
        fake_studio = mock.MagicMock()
        fake_studio.build_studio_snapshot.return_value = {"projects": [{"id": "us-mom"}]}

        def fake_serve_explicit(
            path: str,
            *,
            project_id: str | None = None,
            host: str = "127.0.0.1",
            port: int = 8765,
            open_browser: bool = True,
            explicit_host: bool = False,
            explicit_port: bool = False,
        ) -> None:
            fake_studio.recorded = (path, project_id, host, port, open_browser, explicit_host, explicit_port)

        fake_studio.serve_studio = fake_serve_explicit
        with mock.patch.dict("sys.modules", {"autoquant.studio": fake_studio}):
            code, snap = self._run_cli_json(["studio", "snapshot", ".", "--project", "us-mom"])
            self.assertEqual(code, 0)
            self.assertEqual(snap["projects"][0]["id"], "us-mom")

            rc = cli_main(["studio", "serve", ".", "--no-open"])
            self.assertEqual(rc, 0)
            self.assertEqual(
                fake_studio.recorded,
                (".", None, "127.0.0.1", 8765, False, False, False),
            )


if __name__ == "__main__":
    unittest.main()
