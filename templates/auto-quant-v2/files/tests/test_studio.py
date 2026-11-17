"""Comprehensive tests for AutoQuant's modular Studio backend, security policy, and frontend."""

from __future__ import annotations

import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from autoquant.studio import (
    StudioError,
    StudioNotFoundError,
    build_studio_snapshot,
    create_studio_server,
    load_studio_run,
    resolve_studio_launch,
)
from autoquant.version import current_version

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
ASSETS_DIR = PACKAGE_ROOT / "autoquant" / "studio_assets"


def _write_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def _make_sample_workspace(base: Path) -> Path:
    ws = base / "desk"
    _write_json(
        ws / "autoquant-workspace.json",
        {
            "schema_version": 1,
            "name": "Alpha Research Desk",
            "projects_directory": "projects",
            "default_project": "us-momentum",
        },
    )
    proj = ws / "projects" / "us-momentum"
    _write_json(
        proj / "project.json",
        {
            "schema_version": 1,
            "id": "us-momentum",
            "name": "US Momentum",
            "description": "Cross-sectional momentum factor and vol-targeted book",
            "created_at": "2026-11-17T00:00:00Z",
            "splits": {
                "train_end": "2022-12-31",
                "val_end": "2024-06-30",
                "holdout_end": "2025-12-31",
            },
            "holdout_audit": {
                "unlock_count": 1,
                "unlocks": [
                    {
                        "unlocked_at": "2026-11-17T05:00:00Z",
                        "run_id": "run-20261117T050000000000Z-bbbb2222",
                        "code_sha256": "a" * 64,
                        "git_commit": "b" * 40,
                        "git_dirty": False,
                    }
                ],
            },
        },
    )
    (proj / "research.md").write_text("# US Momentum\n\n- Test 20d cross-sectional return signal.\n", encoding="utf-8")
    _write_json(
        proj / "data" / "manifest.json",
        {
            "schema_version": 1,
            "datasets": {
                "equities-1d": {
                    "id": "equities-1d",
                    "path": "data/equities-1d.csv",
                    "format": "csv",
                    "sha256": "c" * 64,
                    "symbols": ["AAPL", "MSFT", "NVDA"],
                    "interval": "1d",
                    "start": "2020-01-01",
                    "end": "2025-12-31",
                    "rows": 3600,
                    "source": "local",
                    "ingested_at": "2026-11-17T00:05:00Z",
                }
            },
        },
    )

    run1 = proj / "runs" / "run-20261117T040000000000Z-aaaa1111"
    _write_json(
        run1 / "run.json",
        {
            "schema_version": 1,
            "id": run1.name,
            "project_id": "us-momentum",
            "kind": "factor",
            "name": "mom-20d-val",
            "split": "val",
            "created_at": "2026-11-17T04:00:00Z",
            "hypothesis": "20-day momentum predicts next-week cross-sectional winners.",
            "parameters": {"lookback": 20, "quantiles": 5},
            "dataset": {"id": "equities-1d"},
            "provenance": {
                "harness_version": "1.0.0",
                "code_sha256": "d" * 64,
                "git_commit": "e" * 40,
                "git_dirty": False,
            },
            "metrics": {
                "sharpe": 1.35,
                "annual_return": 0.162,
                "max_drawdown": -0.084,
                "ic_mean": 0.042,
                "rank_ic_mean": 0.051,
                "ic_ir": 0.68,
            },
            "series_files": {
                "equity": "series/equity.csv",
                "ic": "series/ic.csv",
                "quantiles": "series/quantiles.json",
            },
            "artifacts": [
                {"name": "Sector Attribution", "path": "artifacts/sector_bars.json", "kind": "chart"}
            ],
            "notes": "Clean monotonic quantile spread across Q1..Q5.",
        },
    )
    (run1 / "series").mkdir(parents=True, exist_ok=True)
    (run1 / "series" / "equity.csv").write_text(
        "timestamp,equity,returns,turnover,benchmark_equity\n"
        "2024-01-02,1.000,0.000,0.00,1.000\n"
        "2024-01-03,1.025,0.025,0.12,1.010\n"
        "2024-01-04,1.010,-0.0146,0.08,1.005\n",
        encoding="utf-8",
    )
    (run1 / "series" / "ic.csv").write_text(
        "timestamp,ic,rank_ic\n"
        "2024-01-02,0.03,0.04\n"
        "2024-01-03,0.05,0.06\n",
        encoding="utf-8",
    )
    _write_json(
        run1 / "series" / "quantiles.json",
        {
            "quantiles": [
                {"bucket": 1, "mean_return": -0.0012, "sharpe": -0.4},
                {"bucket": 5, "mean_return": 0.0028, "sharpe": 1.5},
            ],
            "decay": [
                {"horizon": 1, "ic_mean": 0.042, "rank_ic_mean": 0.051},
                {"horizon": 5, "ic_mean": 0.031, "rank_ic_mean": 0.039},
            ],
        },
    )
    _write_json(
        run1 / "artifacts" / "sector_bars.json",
        {
            "title": "Sector Attribution",
            "type": "bar",
            "bars": [{"label": "Tech", "value": 0.08}, {"label": "Energy", "value": -0.02}],
        },
    )
    (run1 / "artifacts" / "regime.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40" onload="alert(1)">'
        '<script>evil()</script><rect width="90" height="30" fill="#10b981"/>'
        '<a href="https://evil.example"><text x="8" y="20">Regime</text></a></svg>',
        encoding="utf-8",
    )
    (run1 / "artifacts" / "summary.md").write_text("## Walk-Forward Note\nStable turnover.", encoding="utf-8")
    (run1 / "artifacts" / "weights.csv").write_text("asset,weight\nAAPL,0.5\nMSFT,0.5\n", encoding="utf-8")

    run2 = proj / "runs" / "run-20261117T050000000000Z-bbbb2222"
    _write_json(
        run2 / "run.json",
        {
            "schema_version": 1,
            "id": run2.name,
            "project_id": "us-momentum",
            "kind": "backtest",
            "name": "mom-20d-holdout",
            "split": "holdout",
            "created_at": "2026-11-17T05:00:00Z",
            "metrics": {"sharpe": 1.18, "annual_return": 0.141, "max_drawdown": -0.091},
        },
    )

    proj2 = ws / "projects" / "empty-crypto"
    _write_json(
        proj2 / "project.json",
        {
            "schema_version": 1,
            "id": "empty-crypto",
            "name": "Empty Crypto",
            "description": "Empty project with zero runs",
            "created_at": "2026-11-17T01:00:00Z",
            "splits": {"train_end": None, "val_end": None, "holdout_end": None},
            "holdout_audit": {"unlock_count": 0, "unlocks": []},
        },
    )
    return ws


class StudioLaunchAndPolicyTests(unittest.TestCase):
    def _managed_env(self, port: int = 49321) -> dict[str, str]:
        return {
            "HARNESS_CAPABILITY": "studio",
            "HARNESS_HOST": "127.0.0.1",
            "HARNESS_PORTS": json.dumps({"http": port}),
            "HARNESS_NO_OPEN": "1",
        }

    def test_managed_launch_accepts_loopback_and_rejects_conflicts(self) -> None:
        env = self._managed_env(49321)
        launch = resolve_studio_launch(host=None, port=None, no_open=False, environ=env)
        self.assertTrue(launch.managed)
        self.assertEqual(launch.host, "127.0.0.1")
        self.assertEqual(launch.port, 49321)
        self.assertFalse(launch.open_browser)

        self.assertEqual(
            resolve_studio_launch(host="127.0.0.1", port=49321, no_open=True, environ=env),
            launch,
        )
        with self.assertRaisesRegex(StudioError, "conflicts"):
            resolve_studio_launch(host="localhost", port=None, no_open=True, environ=env)
        with self.assertRaisesRegex(StudioError, "conflicts"):
            resolve_studio_launch(host=None, port=49322, no_open=True, environ=env)

        for valid_host in ("localhost", "LOCALHOST", "127.0.0.2", "127.255.255.254"):
            with self.subTest(host=valid_host):
                custom = {**env, "HARNESS_HOST": valid_host}
                self.assertEqual(resolve_studio_launch(environ=custom).host, valid_host)

    def test_managed_launch_fails_closed_on_invalid_ports_or_hosts(self) -> None:
        bad_ports = (
            None,
            "not-json",
            "[]",
            "{}",
            '{"http":49321,"extra":49322}',
            '{"http":49321,"http":49322}',
            '{"http":true}',
            '{"http":49321.0}',
            '{"http":"49321"}',
            '{"http":0}',
            '{"http":65536}',
        )
        for raw in bad_ports:
            with self.subTest(ports=raw):
                env = {"HARNESS_CAPABILITY": "studio", "HARNESS_HOST": "127.0.0.1"}
                if raw is not None:
                    env["HARNESS_PORTS"] = raw
                with self.assertRaises(StudioError):
                    resolve_studio_launch(environ=env)

        bad_hosts = (
            None,
            "",
            " ",
            " 127.0.0.1",
            "127.0.0.1 ",
            "0.0.0.0",
            "10.0.0.1",
            "example.com",
            "::1",
            "[::1]",
            "127.1",
            "127.000.000.001",
        )
        for host in bad_hosts:
            with self.subTest(host=host):
                env = {"HARNESS_CAPABILITY": "studio", "HARNESS_PORTS": '{"http":49321}'}
                if host is not None:
                    env["HARNESS_HOST"] = host
                with self.assertRaises(StudioError):
                    resolve_studio_launch(environ=env)

    def test_standalone_launch_ignores_unrelated_harness_noise(self) -> None:
        noisy = {
            "HARNESS_CAPABILITY": "other",
            "HARNESS_HOST": "192.0.2.1",
            "HARNESS_PORTS": "broken",
            "HARNESS_NO_OPEN": "1",
        }
        default = resolve_studio_launch(environ=noisy)
        self.assertFalse(default.managed)
        self.assertEqual(default.host, "127.0.0.1")
        self.assertEqual(default.port, 8765)
        self.assertTrue(default.open_browser)

        explicit = resolve_studio_launch(host="0.0.0.0", port=0, open_browser=False, environ=noisy)
        self.assertEqual(explicit.host, "0.0.0.0")
        self.assertEqual(explicit.port, 0)
        self.assertFalse(explicit.open_browser)


class StudioSnapshotAndHttpTests(unittest.TestCase):
    def test_snapshot_workspace_direct_project_and_local_override(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = _make_sample_workspace(Path(tmp))
            snap = build_studio_snapshot(ws)
            self.assertEqual(snap["kind"], "autoquant-studio-snapshot")
            self.assertEqual(snap["version"], current_version())
            self.assertEqual(snap["source"]["scope"], "workspace")
            self.assertEqual(snap["active_project_id"], "us-momentum")
            self.assertEqual([p["id"] for p in snap["projects"]], ["empty-crypto", "us-momentum"])

            mom = next(p for p in snap["projects"] if p["id"] == "us-momentum")
            self.assertEqual(mom["holdout_audit"]["unlock_count"], 1)
            self.assertEqual(len(mom["datasets"]), 1)
            self.assertIn("Test 20d cross-sectional", mom["research_markdown"])
            # Newest run sorted first
            self.assertEqual(
                [r["name"] for r in mom["runs"]],
                ["mom-20d-holdout", "mom-20d-val"],
            )

            filtered = build_studio_snapshot(ws, project_id="empty-crypto")
            self.assertEqual([p["id"] for p in filtered["projects"]], ["empty-crypto"])

            direct = build_studio_snapshot(ws / "projects" / "us-momentum")
            self.assertEqual(direct["source"]["scope"], "project")
            self.assertEqual([p["id"] for p in direct["projects"]], ["us-momentum"])
            with self.assertRaises(StudioNotFoundError):
                build_studio_snapshot(ws / "projects" / "us-momentum", project_id="other")

            # Optional autoquant-workspace.local.json override pointing to external projects directory
            ext_projects = Path(tmp) / "external-projects"
            shutil.copytree(ws / "projects", ext_projects)
            _write_json(
                ws / "autoquant-workspace.local.json",
                {
                    "schema_version": 1,
                    "name": "Local Override Desk",
                    "projects_directory": str(ext_projects),
                    "default_project": "empty-crypto",
                },
            )
            overridden = build_studio_snapshot(ws)
            self.assertEqual(overridden["source"]["configuration_source"], "local-override")
            self.assertEqual(overridden["active_project_id"], "empty-crypto")

    def test_empty_workspace_snapshot_succeeds_without_projects_dir(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp) / "fresh"
            _write_json(
                ws / "autoquant-workspace.json",
                {"schema_version": 1, "name": "Fresh Desk", "projects_directory": "projects", "default_project": None},
            )
            snap = build_studio_snapshot(ws)
            self.assertEqual(snap["projects"], [])
            self.assertIsNone(snap["active_project_id"])

    def test_http_endpoints_headers_series_and_custom_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = _make_sample_workspace(Path(tmp))
            for managed in (False, True):
                with self.subTest(managed=managed):
                    server = create_studio_server(ws, host="127.0.0.1", port=0, managed=managed)
                    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True)
                    thread.start()
                    base = f"http://127.0.0.1:{server.server_port}"
                    try:
                        req_headers = {"Host": "oa-surface-test.localhost"} if managed else {}
                        with urlopen(Request(f"{base}/api/v1/health", headers=req_headers), timeout=3) as resp:
                            self.assertEqual(resp.status, 200)
                            health = json.loads(resp.read())
                            self.assertTrue(health["ok"])
                            self.assertEqual(health["kind"], "autoquant-studio-health")
                            self.assertEqual(health["version"], current_version())
                            self.assertEqual(health["managed"], managed)
                            csp = resp.headers["Content-Security-Policy"]
                            if managed:
                                self.assertIn(
                                    "frame-ancestors app: http://127.0.0.1:* http://localhost:* http://*.localhost:*",
                                    csp,
                                )
                                self.assertIsNone(resp.headers["X-Frame-Options"])
                                self.assertIsNone(resp.headers["Cross-Origin-Resource-Policy"])
                            else:
                                self.assertIn("frame-ancestors 'none'", csp)
                                self.assertEqual(resp.headers["X-Frame-Options"], "DENY")
                                self.assertEqual(resp.headers["Cross-Origin-Resource-Policy"], "same-origin")

                        with urlopen(f"{base}/api/v1/snapshot", timeout=3) as resp:
                            self.assertEqual(resp.status, 200)
                            snap = json.loads(resp.read())
                            self.assertEqual(len(snap["projects"]), 2)

                        run_id = "run-20261117T040000000000Z-aaaa1111"
                        for url in (
                            f"{base}/api/v1/runs/us-momentum/{run_id}",
                            f"{base}/api/v1/run?project=us-momentum&run={run_id}",
                        ):
                            with urlopen(url, timeout=3) as resp:
                                self.assertEqual(resp.status, 200)
                                detail = json.loads(resp.read())
                            self.assertTrue(detail["ok"])
                            self.assertEqual(len(detail["series"]["equity"]), 3)
                            # Drawdown computed automatically when absent from CSV
                            self.assertAlmostEqual(detail["series"]["equity"][2]["drawdown"], 1.010 / 1.025 - 1.0, places=6)
                            self.assertEqual(detail["series"]["equity"][1]["benchmark_equity"], 1.010)
                            self.assertEqual(len(detail["series"]["ic"]), 2)
                            self.assertEqual(len(detail["series"]["quantiles"]["quantiles"]), 2)
                            by_kind = {a["kind"]: a for a in detail["artifacts"]}
                            self.assertEqual(by_kind["json"]["data"]["type"], "bar")
                            self.assertNotIn("<script>", by_kind["svg"]["text"])
                            self.assertNotIn("onload=", by_kind["svg"]["text"])
                            self.assertNotIn("https://evil.example", by_kind["svg"]["text"])
                            self.assertIn("Walk-Forward Note", by_kind["markdown"]["text"])
                            self.assertEqual(by_kind["csv"]["columns"], ["asset", "weight"])

                        for asset_path, marker in (
                            ("/", b"AutoQuant Studio"),
                            ("/index.html", b"Holdout Untouched"),
                            ("/assets/studio.css", b"prefers-color-scheme: light"),
                            ("/assets/studio.js", b'/api/v1/snapshot'),
                        ):
                            with urlopen(f"{base}{asset_path}", timeout=3) as resp:
                                self.assertEqual(resp.status, 200)
                                self.assertIn(marker, resp.read())

                        # Read-only enforcement
                        post_req = Request(f"{base}/api/v1/snapshot", data=b"{}", method="POST")
                        with self.assertRaises(HTTPError) as ctx:
                            urlopen(post_req, timeout=3)
                        self.assertEqual(ctx.exception.code, 405)
                        ctx.exception.close()
                    finally:
                        server.shutdown()
                        server.server_close()
                        thread.join(timeout=2)

    def test_symlink_and_path_traversal_rejection(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            ws = _make_sample_workspace(base)
            secret = base / "secret.json"
            secret.write_text('{"leaked": true}', encoding="utf-8")

            # 1. Symlinked workspace root rejected
            ws_link = base / "desk-link"
            ws_link.symlink_to(ws)
            with self.assertRaises(StudioError):
                build_studio_snapshot(ws_link)

            # 2. Traversal in run query / path rejected
            run_id = "run-20261117T040000000000Z-aaaa1111"
            with self.assertRaises(StudioError):
                load_studio_run(ws, project_id="../escape", run_id=run_id)
            with self.assertRaises(StudioError):
                load_studio_run(ws, project_id="us-momentum", run_id="../escape")

            # 3. Symlink inside artifacts/ rejected
            art_link = ws / "projects" / "us-momentum" / "runs" / run_id / "artifacts" / "leak.json"
            art_link.symlink_to(secret)
            with self.assertRaises(StudioError):
                load_studio_run(ws, project_id="us-momentum", run_id=run_id)
            art_link.unlink()

            # 4. Broken symlink inside artifacts/ also rejected
            art_link.symlink_to(base / "does-not-exist.json")
            with self.assertRaises(StudioError):
                load_studio_run(ws, project_id="us-momentum", run_id=run_id)
            art_link.unlink()

            # 5. Escaping series_files path in run.json rejected
            run2_json = ws / "projects" / "us-momentum" / "runs" / "run-20261117T050000000000Z-bbbb2222" / "run.json"
            bad_run = json.loads(run2_json.read_text(encoding="utf-8"))
            bad_run["series_files"] = {"equity": "../../../secret.json"}
            _write_json(run2_json, bad_run)
            with self.assertRaises(StudioError):
                load_studio_run(ws, project_id="us-momentum", run_id="run-20261117T050000000000Z-bbbb2222")

            # 6. Symlinked project directory rejected
            proj_link = ws / "projects" / "linked-proj"
            proj_link.symlink_to(base)
            with self.assertRaises(StudioError):
                build_studio_snapshot(ws)

    def test_managed_occupied_port_fails_fast_and_sigterm_releases_port(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = _make_sample_workspace(Path(tmp))
            serve_code = (
                "import sys; from autoquant.studio import serve_studio; "
                "serve_studio(sys.argv[1], open_browser=True)"
            )
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as occupied:
                occupied.bind(("127.0.0.1", 0))
                occupied.listen(1)
                busy_port = occupied.getsockname()[1]
                env = {
                    **os.environ,
                    "PYTHONPATH": str(PACKAGE_ROOT),
                    "HARNESS_CAPABILITY": "studio",
                    "HARNESS_HOST": "127.0.0.1",
                    "HARNESS_PORTS": json.dumps({"http": busy_port}),
                    "HARNESS_NO_OPEN": "1",
                }
                failed = subprocess.run(
                    [sys.executable, "-c", serve_code, str(ws)],
                    env=env,
                    capture_output=True,
                    text=True,
                    timeout=5,
                )
                self.assertNotEqual(failed.returncode, 0)
                self.assertIn("Address already in use", failed.stderr)

            # Now test live managed process + HARNESS_NO_OPEN browser suppression + SIGTERM release
            marker = Path(tmp) / "browser-marker"
            opener = Path(tmp) / "fake-browser.sh"
            opener.write_text(f'#!/bin/sh\nprintf opened > "{marker}"\n', encoding="utf-8")
            opener.chmod(0o755)
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
                probe.bind(("127.0.0.1", 0))
                free_port = probe.getsockname()[1]
            live_env = {
                **os.environ,
                "PYTHONPATH": str(PACKAGE_ROOT),
                "HARNESS_CAPABILITY": "studio",
                "HARNESS_HOST": "127.0.0.1",
                "HARNESS_PORTS": json.dumps({"http": free_port}),
                "HARNESS_NO_OPEN": "1",
                "BROWSER": str(opener),
            }
            proc = subprocess.Popen(
                [sys.executable, "-c", serve_code, str(ws)],
                env=live_env,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            try:
                line = proc.stdout.readline().strip()
                self.assertEqual(line, f"AutoQuant Studio: http://127.0.0.1:{free_port}")
                with urlopen(f"http://127.0.0.1:{free_port}/api/v1/health", timeout=3) as resp:
                    self.assertEqual(resp.status, 200)
                time.sleep(0.15)
                self.assertFalse(marker.exists())
            finally:
                proc.terminate()
                proc.wait(timeout=5)
                proc.stdout.close()
                proc.stderr.close()

            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as check_rebind:
                check_rebind.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                check_rebind.bind(("127.0.0.1", free_port))

    def test_frontend_csp_safety_and_js_syntax(self) -> None:
        html = (ASSETS_DIR / "index.html").read_text(encoding="utf-8")
        js = (ASSETS_DIR / "studio.js").read_text(encoding="utf-8")
        self.assertIn('href="/assets/studio.css"', html)
        self.assertIn('src="/assets/studio.js"', html)
        self.assertIn('fetch("/api/v1/snapshot"', js)
        self.assertIsNone(re.search(r"\bstyle\s*=", html))
        for forbidden in ("http://127.0.0.1", "http://localhost", "ws://", "wss://", "WebSocket(", "EventSource("):
            self.assertNotIn(forbidden, html)
            self.assertNotIn(forbidden, js)

        node = shutil.which("node")
        self.assertIsNotNone(node, "node binary required for studio.js syntax verification")
        checked = subprocess.run(
            [node, "--check", str(ASSETS_DIR / "studio.js")],
            capture_output=True,
            text=True,
            timeout=10,
        )
        self.assertEqual(checked.returncode, 0, checked.stderr)


if __name__ == "__main__":
    unittest.main()
