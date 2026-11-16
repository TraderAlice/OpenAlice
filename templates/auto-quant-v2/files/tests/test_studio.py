from __future__ import annotations

import json
import os
import shlex
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from autoquant.research import run_campaign
from autoquant.runs import harness_identity
from autoquant.sessions import evaluate_experiment, start_session
from autoquant.studies import create_study, hash_json
from autoquant.studio import (
    build_studio_snapshot,
    create_studio_server,
    resolve_studio_launch,
)
from autoquant.version import current_version
from autoquant.workspace import (
    AutoQuantValidationError,
    create_project,
    initialize_workspace,
)
from tests.study_helpers import make_project, study_definition


SLOW_RESEARCHER = """\
import json
import os
import time
from pathlib import Path

brief = json.loads(input())
Path(os.environ["AUTOQUANT_WORKTREE"], "factors/candidate.py").write_text("SCORE = 3.0\\n")
time.sleep(1)
print(json.dumps({
    "schema_version": 1,
    "action": "propose",
    "strategy": "slow-bounded-proposal",
    "hypothesis": "Expose one bounded in-progress turn.",
    "expected_effect": "Improve the synthetic score.",
}))
"""


class StudioObservationTests(unittest.TestCase):
    def _setup(self, directory: str):
        workspace, project = make_project(directory)
        create_study(project, study_definition())
        session = start_session(project, "factor-quality")
        candidate = session.worktree_project.root_dir / "factors/candidate.py"
        candidate.write_text("SCORE = 2.0\n")
        evaluate_experiment(project, session.manifest["id"], "Improve the factor")
        return workspace, project, session

    def _script(self, directory: str, source: str) -> str:
        path = Path(directory) / "studio-researcher.py"
        path.write_text(source, encoding="utf-8")
        return f"{shlex.quote(sys.executable)} {shlex.quote(str(path))}"

    def _managed_environment(self, port: int) -> dict[str, str]:
        environment = os.environ.copy()
        environment.update(
            {
                "HARNESS_CAPABILITY": "studio",
                "HARNESS_HOST": "127.0.0.1",
                "HARNESS_PORTS": json.dumps({"http": port}),
                "HARNESS_NO_OPEN": "1",
            }
        )
        return environment

    def _manifest_command(self) -> list[str]:
        root = Path(__file__).resolve().parents[1]
        manifest = json.loads((root / "harness.json").read_text(encoding="utf-8"))
        return manifest["capabilities"]["studio"]["command"]

    def _standalone_environment(self) -> dict[str, str]:
        environment = os.environ.copy()
        for name in (
            "HARNESS_CAPABILITY",
            "HARNESS_HOST",
            "HARNESS_PORTS",
            "HARNESS_NO_OPEN",
        ):
            environment.pop(name, None)
        return environment

    def _ordinary_parent_environment(self) -> dict[str, str]:
        environment = self._standalone_environment()
        excluded = {
            Path(sys.executable).parent.resolve(),
            (Path(__file__).resolve().parents[1] / ".venv" / "bin").resolve(),
        }
        environment["PATH"] = os.pathsep.join(
            entry
            for entry in environment.get("PATH", "").split(os.pathsep)
            if entry and Path(entry).resolve() not in excluded
        )
        environment.pop("VIRTUAL_ENV", None)
        environment.pop("UV_PROJECT_ENVIRONMENT", None)
        self.assertIsNotNone(shutil.which("uv", path=environment["PATH"]))
        return environment

    def _copy_source_workspace(self, directory: str) -> Path:
        source = Path(__file__).resolve().parents[1]
        target = Path(directory) / "source-workspace"
        shutil.copytree(
            source,
            target,
            ignore=shutil.ignore_patterns(
                ".git",
                ".venv",
                ".pytest_cache",
                ".ruff_cache",
                "__pycache__",
                "*.pyc",
                "autoquant-workspace.local.json",
                "dist*",
                "run.log",
            ),
        )
        return target

    def _prepare_source_workspace(
        self,
        directory: str,
    ) -> tuple[Path, dict[str, str]]:
        workspace = self._copy_source_workspace(directory)
        environment = self._ordinary_parent_environment()
        prepared = subprocess.run(
            ["uv", "sync", "--frozen"],
            cwd=workspace,
            env=environment,
            capture_output=True,
            check=False,
            text=True,
            timeout=120,
        )
        self.assertEqual(prepared.returncode, 0, prepared.stderr)
        self.assertTrue((workspace / ".venv" / "bin" / "aq").is_file())
        self.assertNotIn(str(workspace / ".venv" / "bin"), environment["PATH"])
        return workspace, environment

    def test_workspace_and_project_snapshots_share_verified_contract(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace, project, session = self._setup(directory)
            research_path = project.root_dir / "research.md"
            research_path.write_text(
                "# Factor Project\n\n"
                "## Research question\n\n"
                "Does Studio receive the maintained question?\n",
                encoding="utf-8",
            )
            create_project(
                workspace.root_dir,
                "empty-lab",
                name="Empty Lab",
                description="A second bounded research Project",
            )

            snapshot = build_studio_snapshot(workspace.root_dir)
            self.assertEqual(snapshot["kind"], "autoquant-studio-snapshot")
            self.assertEqual(snapshot["harness"], harness_identity())
            self.assertEqual(snapshot["harness"]["version"], current_version())
            self.assertRegex(snapshot["harness"]["sourceHash"], r"^[0-9a-f]{64}$")
            self.assertIn(
                snapshot["harness"]["buildProvenance"],
                {"source-checkout", "embedded-distribution"},
            )
            self.assertEqual(snapshot["source"]["scope"], "workspace")
            self.assertEqual(
                snapshot["source"]["workspace"]["projectsDir"],
                str(workspace.projects_dir),
            )
            self.assertEqual(
                snapshot["source"]["workspace"]["configurationSource"],
                "workspace-manifest",
            )
            self.assertEqual(
                snapshot["source"]["workspace"]["configurationPath"],
                str(workspace.root_dir / "autoquant-workspace.json"),
            )
            self.assertEqual(
                [item["id"] for item in snapshot["projects"]],
                ["empty-lab", "factor-project"],
            )
            observed = next(
                item for item in snapshot["projects"] if item["id"] == "factor-project"
            )
            self.assertTrue(observed["valid"])
            self.assertEqual(observed["counts"]["studies"], 1)
            self.assertEqual(observed["counts"]["runs"], 2)
            self.assertEqual(
                observed["agentWorkBrief"]["kind"],
                "autoquant-agent-work-brief",
            )
            self.assertEqual(
                observed["agentWorkBrief"]["question"],
                {
                    "title": project.manifest.name,
                    "text": "Does Studio receive the maintained question?",
                    "origin": "project-research-brief",
                    "sourcePath": str(research_path),
                    "requestPath": None,
                },
            )
            self.assertEqual(
                len(observed["agentWorkBriefHash"]),
                64,
            )
            self.assertEqual(
                observed["agentWorkBriefHash"],
                hash_json(observed["agentWorkBrief"]),
            )
            self.assertEqual(
                observed["agentWorkBrief"]["filesystem"]["operatingRoot"],
                str(session.worktree_project.root_dir),
            )
            self.assertEqual(
                observed["agentWorkBrief"]["researchAgenda"]["status"],
                "unsupported-study",
            )
            self.assertEqual(
                observed["agentWorkBrief"]["researchAgenda"]["moves"],
                [],
            )
            self.assertEqual(observed["counts"]["activeSessions"], 1)
            self.assertEqual(observed["counts"]["dossiers"], 0)
            self.assertEqual(observed["counts"]["verdicts"]["KEEP"], 1)
            self.assertIsNone(observed["dossierStatus"])
            self.assertEqual(observed["dossiers"], [])
            self.assertEqual(observed["sessions"][0]["session"]["id"], session.manifest["id"])
            self.assertEqual(
                observed["sessions"][0]["session"]["baselineGuard"],
                session.manifest["baselineGuard"],
            )
            self.assertTrue(observed["sessions"][0]["authority"]["valid"])
            self.assertEqual(
                observed["sessions"][0]["selectionIntegrity"][
                    "selectionSplit"
                ],
                "unspecified",
            )
            self.assertIsNone(
                observed["sessions"][0]["selectionIntegrity"][
                    "externalHoldoutRequired"
                ]
            )
            self.assertEqual(
                observed["sessions"][0]["selectionIntegrity"][
                    "researchFamily"
                ]["uniqueSourceTrials"],
                2,
            )
            self.assertEqual(
                observed["sessions"][0]["selectionIntegrity"][
                    "selectionAdjustment"
                ]["status"],
                "unsupported",
            )
            self.assertEqual(
                observed["sessions"][0]["selectionIntegrity"][
                    "verdictAuthority"
                ],
                "diagnostic-only",
            )
            self.assertTrue(
                any(item["kind"] == "experiment" for item in observed["timeline"])
            )
            json.dumps(snapshot)

            direct = build_studio_snapshot(project.root_dir)
            self.assertEqual(direct["source"]["scope"], "project")
            self.assertIsNone(direct["source"]["workspace"])
            self.assertEqual([item["id"] for item in direct["projects"]], ["factor-project"])

            selected = build_studio_snapshot(
                workspace.root_dir,
                project_id="empty-lab",
            )
            self.assertEqual([item["id"] for item in selected["projects"]], ["empty-lab"])
            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "cannot select inside a direct Project",
            ):
                build_studio_snapshot(project.root_dir, project_id="factor-project")

    def test_empty_and_partially_invalid_workspaces_remain_observable(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace = initialize_workspace(Path(directory) / "empty")
            empty = build_studio_snapshot(workspace.root_dir)
            self.assertTrue(empty["valid"])
            self.assertEqual(empty["projects"], [])

            (workspace.projects_dir / "broken-project").mkdir()
            partial = build_studio_snapshot(workspace.root_dir)
            self.assertFalse(partial["valid"])
            self.assertEqual(partial["projects"], [])
            self.assertEqual(
                partial["diagnostics"][0]["category"],
                "workspace",
            )

    def test_invalid_run_category_does_not_become_unverified_display_data(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            _, project, _ = self._setup(directory)
            runs = sorted((project.root_dir / "runs").iterdir())
            result_path = runs[0] / "result.json"
            value = json.loads(result_path.read_text())
            value["summary"] = "tampered"
            result_path.write_text(json.dumps(value))

            snapshot = build_studio_snapshot(project.root_dir)
            observed = snapshot["projects"][0]
            self.assertFalse(snapshot["valid"])
            self.assertFalse(observed["valid"])
            self.assertEqual(observed["runs"], [])
            self.assertEqual(observed["sessions"], [])
            self.assertEqual(len(observed["studies"]), 1)
            self.assertIn(
                "runs",
                {item["category"] for item in observed["diagnostics"]},
            )

    def test_running_progress_is_mutable_then_replaced_by_terminal_campaign(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace, project, session = self._setup(directory)
            command = self._script(directory, SLOW_RESEARCHER)
            outcome: list[object] = []

            def execute() -> None:
                try:
                    outcome.append(
                        run_campaign(
                            project,
                            session.manifest["id"],
                            command,
                            max_turns=1,
                            max_wall_seconds=30,
                            turn_timeout_seconds=5,
                        )
                    )
                except Exception as error:
                    outcome.append(error)

            thread = threading.Thread(target=execute)
            thread.start()
            deadline = time.monotonic() + 5
            running = None
            while time.monotonic() < deadline:
                snapshot = build_studio_snapshot(workspace.root_dir)
                observed = next(
                    item
                    for item in snapshot["projects"]
                    if item["id"] == project.manifest.id
                )
                if observed["counts"]["runningCampaigns"] == 1:
                    candidate = observed["sessions"][0]["progress"][0]
                    if candidate["phase"] == "researcher":
                        running = candidate
                        break
                time.sleep(0.02)

            self.assertIsNotNone(running)
            self.assertTrue(running["mutable"])
            self.assertEqual(running["status"], "running")
            self.assertEqual(running["phase"], "researcher")
            self.assertEqual(running["turn"], 1)
            thread.join(timeout=10)
            self.assertFalse(thread.is_alive())
            self.assertEqual(len(outcome), 1)
            self.assertFalse(isinstance(outcome[0], Exception), outcome[0])

            terminal = build_studio_snapshot(workspace.root_dir)
            observed = next(
                item
                for item in terminal["projects"]
                if item["id"] == project.manifest.id
            )
            self.assertEqual(observed["counts"]["runningCampaigns"], 0)
            self.assertEqual(observed["counts"]["campaigns"], 1)
            self.assertEqual(
                observed["sessions"][0]["campaigns"][0]["status"],
                "budget_exhausted",
            )

    def test_http_server_exposes_only_fixed_read_only_routes_and_headers(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace, _, _ = self._setup(directory)
            server = create_studio_server(workspace.root_dir, port=0)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            base = f"http://127.0.0.1:{server.server_port}"
            try:
                with urlopen(f"{base}/api/v1/health", timeout=3) as response:
                    health = json.loads(response.read())
                    self.assertTrue(health["ok"])
                    self.assertEqual(health["mode"], "read-only")
                    self.assertEqual(response.headers["X-Frame-Options"], "DENY")
                    self.assertEqual(
                        response.headers["Cross-Origin-Resource-Policy"],
                        "same-origin",
                    )
                    self.assertIn(
                        "default-src 'none'",
                        response.headers["Content-Security-Policy"],
                    )
                    self.assertIn(
                        "frame-ancestors 'none'",
                        response.headers["Content-Security-Policy"],
                    )
                    self.assertIsNone(response.headers["Access-Control-Allow-Origin"])

                with urlopen(f"{base}/api/v1/snapshot", timeout=3) as response:
                    snapshot = json.loads(response.read())
                    self.assertEqual(snapshot["kind"], "autoquant-studio-snapshot")
                    self.assertEqual(response.headers["Cache-Control"], "no-store")

                with urlopen(f"{base}/", timeout=3) as response:
                    html = response.read().decode()
                    self.assertIn("Quant research desk", html)
                    self.assertIn("Research cockpit", html)
                    self.assertIn("Current research decision brief", html)
                    self.assertIn('id="decision-brief"', html)
                    self.assertIn('id="rail-workspace"', html)
                    self.assertIn('id="desk-nav"', html)
                    self.assertIn("Research handoff", html)
                    self.assertIn('id="handoff-board"', html)
                    self.assertIn('id="evidence-workbench"', html)
                    self.assertIn('id="evidence-lane-tabs"', html)
                    self.assertIn(
                        'id="portfolio-mechanical-decision"',
                        html,
                    )
                    self.assertIn(
                        'id="portfolio-sizing-anatomy"',
                        html,
                    )
                    self.assertIn(
                        'id="portfolio-diversification-stress"',
                        html,
                    )
                    self.assertIn(
                        'id="portfolio-strategy-viability"',
                        html,
                    )
                    self.assertIn(
                        'id="portfolio-signal-monetization"',
                        html,
                    )
                    self.assertIn(
                        'id="factor-qualification"',
                        html,
                    )
                    self.assertIn('id="factor-components"', html)
                    self.assertIn('id="research-agenda"', html)
                    self.assertIn('id="research-agenda-board"', html)
                    self.assertIn('id="external-holdout"', html)
                    self.assertIn('id="external-holdout-board"', html)
                    self.assertIn(
                        "Current mechanical decision",
                        html,
                    )
                    self.assertIn('id="inspector-toggle"', html)
                    self.assertIn('id="rl-opportunity"', html)
                    self.assertIn(
                        'id="rl-fusion-diagnosis"',
                        html,
                    )
                    self.assertIn('href="/assets/studio.css"', html)
                    self.assertNotIn("<script>", html)

                with urlopen(f"{base}/assets/studio.css", timeout=3) as response:
                    css = response.read().decode()
                    self.assertIn(".handoff-board", css)
                    self.assertIn(".decision-brief", css)
                    self.assertIn(".workspace-context", css)
                    self.assertIn(".desk-nav-button", css)
                    self.assertIn('[data-lane-count="1"]', css)
                    self.assertIn(".program-assessment", css)
                    self.assertIn(".admission-chip", css)
                    self.assertIn(".program-lane.admission-locked", css)
                    self.assertIn(".evidence-lane-tabs", css)
                    self.assertIn(".mandate-strip", css)
                    self.assertIn(".mechanical-chain", css)
                    self.assertIn(".mechanical-table", css)
                    self.assertIn(".trigger-condition", css)
                    self.assertIn(".report-decision-proof", css)
                    self.assertIn(".sizing-summary", css)
                    self.assertIn(".sizing-table", css)
                    self.assertIn(".diversification-summary", css)
                    self.assertIn(".diversification-ladder", css)
                    self.assertIn(".diversification-table", css)
                    self.assertIn(".viability-diagnosis", css)
                    self.assertIn(".viability-chain", css)
                    self.assertIn(".monetization-chain", css)
                    self.assertIn(".monetization-deltas", css)
                    self.assertIn(".factor-qualification-chain", css)
                    self.assertIn(
                        ".factor-qualification-diagnosis",
                        css,
                    )
                    self.assertIn(".factor-component-diagnosis", css)
                    self.assertIn(".factor-component-table", css)
                    self.assertIn(".factor-table-wrap", css)
                    self.assertIn("overflow-x: auto", css)
                    self.assertIn(".research-agenda-board", css)
                    self.assertIn(".holdout-board", css)
                    self.assertIn(".holdout-lane", css)
                    self.assertIn(".research-move-evidence", css)
                    self.assertIn(
                        "content: attr(data-label)",
                        css,
                    )
                    self.assertIn(
                        ".book-risk-scenario-table .factor-table td::before",
                        css,
                    )
                    self.assertIn(
                        ".book-risk-scenario-contribution-table .factor-table td::before",
                        css,
                    )
                    self.assertIn(".inspector-lane", css)
                    self.assertIn(".inspector-collapsed", css)
                    self.assertIn(".rl-opportunity-panel", css)
                    self.assertIn(".rl-incremental-panel", css)
                    self.assertIn(".rl-fusion-diagnosis", css)
                    self.assertIn(".rl-fusion-chain", css)
                    self.assertIn(".selection-risk", css)
                    self.assertIn(".command-button", css)
                    self.assertIn("@media (max-width: 680px)", css)
                    self.assertIn(":focus-visible", css)

                with urlopen(f"{base}/assets/studio.js", timeout=3) as response:
                    javascript = response.read().decode()
                    self.assertIn("programAssessment", javascript)
                    self.assertIn("laneAdmission", javascript)
                    self.assertIn("progressionGate", javascript)
                    self.assertIn("REQUIRED RESEARCH COMPLETE", javascript)
                    self.assertIn("researchDecisionBrief", javascript)
                    self.assertIn("project.agentWorkBrief", javascript)
                    self.assertIn("project.agentWorkBriefHash", javascript)
                    self.assertIn("ORIENTATION UNAVAILABLE", javascript)
                    self.assertNotIn("DO NOT PROMOTE ADAPTIVITY", javascript)
                    self.assertIn("projectFocusStudy", javascript)
                    self.assertIn("fixed event policy", javascript)
                    self.assertIn("DESCRIPTIVE EVIDENCE READY", javascript)
                    self.assertIn("renderDeskContext", javascript)
                    self.assertIn("updateDeskNavActive", javascript)
                    self.assertIn("validationBaselineAdvantage", javascript)
                    self.assertIn("renderFactorComponents", javascript)
                    self.assertIn("renderResearchAgenda", javascript)
                    self.assertIn("OPTIONAL FOLLOW-UP", javascript)
                    self.assertIn(
                        "project.agentWorkBrief?.researchAgenda",
                        javascript,
                    )
                    self.assertIn(
                        "project.externalHoldout",
                        javascript,
                    )
                    self.assertIn(
                        "renderExternalHoldout(project)",
                        javascript,
                    )
                    self.assertIn(
                        "Sessions are disabled in this frozen external-audit Project.",
                        javascript,
                    )
                    self.assertIn(
                        "FROZEN SOURCE → LATER DATA → EXTERNAL AUDIT",
                        javascript,
                    )
                    self.assertIn(
                        "REQUEST → DATASET → FIXED RUN → REVIEW",
                        javascript,
                    )
                    self.assertIn(
                        "Copy Book Risk Explorer CLI",
                        javascript,
                    )
                    self.assertIn(
                        "no Session, optimization, order, or trading authority",
                        javascript,
                    )
                    self.assertIn(
                        'data-label="Validation raw ${scoreLabel}"',
                        javascript,
                    )
                    self.assertIn("data-evidence-lane", javascript)
                    self.assertIn("mandateMarkup", javascript)
                    self.assertIn(
                        "renderPortfolioMechanicalDecision",
                        javascript,
                    )
                    self.assertIn(
                        "renderPortfolioSizingAnatomy",
                        javascript,
                    )
                    self.assertIn(
                        "renderPortfolioDiversificationStress",
                        javascript,
                    )
                    self.assertIn(
                        "25% / 50% / 100% ceiling-breach rate",
                        javascript,
                    )
                    self.assertIn(
                        "renderPortfolioStrategyViability",
                        javascript,
                    )
                    self.assertIn(
                        "renderPortfolioSignalMonetization",
                        javascript,
                    )
                    self.assertIn(
                        "renderFactorQualification",
                        javascript,
                    )
                    self.assertIn(
                        "First missing qualification layer",
                        javascript,
                    )
                    self.assertIn(
                        "Core could not verify the Agent Work Brief",
                        javascript,
                    )
                    self.assertIn(
                        "Frozen factor qualification",
                        javascript,
                    )
                    self.assertIn(
                        "Material train/validation contrast",
                        javascript,
                    )
                    self.assertIn("Quantiles · N/A", javascript)
                    self.assertIn(
                        "quantiles protocol-unavailable",
                        javascript,
                    )
                    self.assertIn(
                        "TEST · VISIBLE AUDIT ONLY",
                        javascript,
                    )
                    self.assertIn(
                        "Diagonal risk is a sizing heuristic",
                        javascript,
                    )
                    self.assertIn(
                        "reportDecisionProof",
                        javascript,
                    )
                    self.assertIn(
                        "Frozen leader decision",
                        javascript,
                    )
                    self.assertIn(
                        "Same-timestamp percentile across prediction assets only",
                        javascript,
                    )
                    self.assertIn("Causal own-history percentile", javascript)
                    self.assertIn("NO-TRADE HOLD", javascript)
                    self.assertIn("Authorized positions", javascript)
                    self.assertIn("syncEvidenceSelection", javascript)
                    self.assertIn("dossierState", javascript)
                    self.assertIn("PROJECT DOSSIER", javascript)
                    self.assertIn("OpenAlice return artifact", javascript)
                    self.assertIn("Copy completion CLI", javascript)
                    self.assertIn("no trading authority", javascript)
                    self.assertIn("browser-authored verdict", javascript)
                    self.assertIn("selectionRiskSection", javascript)
                    self.assertIn("renderRlOpportunity", javascript)
                    self.assertIn("renderRlIncremental", javascript)
                    self.assertIn(
                        "renderRlFusionDiagnosis",
                        javascript,
                    )
                    self.assertIn(
                        "Where adaptive value stops",
                        javascript,
                    )
                    self.assertIn(
                        "Frozen RL factor-fusion diagnosis",
                        javascript,
                    )
                    self.assertIn("Gross selection edge", javascript)
                    self.assertIn("factorOpportunity", javascript)
                    self.assertIn("contextualBaselines", javascript)
                    self.assertIn("train-only frozen learner", javascript)
                    self.assertIn("learningContract", javascript)
                    self.assertIn("SAME-PRETRADE · TRAIN ONLY", javascript)
                    self.assertIn("Family trials", javascript)
                    self.assertIn("Project-family trials", javascript)
                    self.assertIn("diagnostic only", javascript)
                    self.assertNotIn("RESEARCH CHAIN PASSES", javascript)

                request = Request(
                    f"{base}/api/v1/snapshot",
                    method="POST",
                    data=b"{}",
                )
                with self.assertRaises(HTTPError) as raised:
                    urlopen(request, timeout=3)
                self.assertEqual(raised.exception.code, 405)
                self.assertEqual(
                    json.loads(raised.exception.read())["error"]["code"],
                    "studio.read-only",
                )

                with self.assertRaises(HTTPError) as raised:
                    urlopen(f"{base}/files/research.md", timeout=3)
                self.assertEqual(raised.exception.code, 404)
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=3)

    def test_invalid_port_and_workspace_manifest_remain_core_errors(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace, _, _ = self._setup(directory)
            with self.assertRaisesRegex(AutoQuantValidationError, "port"):
                create_studio_server(workspace.root_dir, port=70000)

            manifest_path = workspace.root_dir / "autoquant-workspace.json"
            manifest = json.loads(manifest_path.read_text())
            manifest["unknown"] = True
            manifest_path.write_text(json.dumps(manifest))
            with self.assertRaisesRegex(AutoQuantValidationError, "Unknown field"):
                build_studio_snapshot(workspace.root_dir)

    def test_managed_launch_strictly_resolves_injected_authority(self) -> None:
        environment = self._managed_environment(49321)
        launch = resolve_studio_launch(
            host=None,
            port=None,
            no_open=False,
            environ=environment,
        )

        self.assertTrue(launch.managed)
        self.assertEqual(launch.host, "127.0.0.1")
        self.assertEqual(launch.port, 49321)
        self.assertFalse(launch.open_browser)
        self.assertEqual(
            resolve_studio_launch(
                host="127.0.0.1",
                port=49321,
                no_open=True,
                environ=environment,
            ),
            launch,
        )

        with self.assertRaisesRegex(AutoQuantValidationError, "conflicts"):
            resolve_studio_launch(
                host="localhost",
                port=None,
                no_open=True,
                environ=environment,
            )
        with self.assertRaisesRegex(AutoQuantValidationError, "conflicts"):
            resolve_studio_launch(
                host=None,
                port=49322,
                no_open=True,
                environ=environment,
            )

        for host in ("localhost", "LOCALHOST", "127.0.0.2", "127.255.255.254"):
            with self.subTest(host=host):
                accepted = self._managed_environment(49321)
                accepted["HARNESS_HOST"] = host
                self.assertEqual(
                    resolve_studio_launch(
                        host=None,
                        port=None,
                        no_open=False,
                        environ=accepted,
                    ).host,
                    host,
                )

    def test_managed_launch_fails_closed_for_invalid_port_authority(self) -> None:
        invalid_ports = (
            None,
            "not-json",
            "[]",
            "{}",
            '{"http":49321,"controlPlane":49322}',
            '{"http":49321,"http":49322}',
            '{"http":true}',
            '{"http":49321.0}',
            '{"http":"49321"}',
            '{"http":0}',
            '{"http":65536}',
        )
        for raw in invalid_ports:
            with self.subTest(raw=raw):
                environment = {
                    "HARNESS_CAPABILITY": "studio",
                    "HARNESS_HOST": "127.0.0.1",
                    "HARNESS_NO_OPEN": "1",
                }
                if raw is not None:
                    environment["HARNESS_PORTS"] = raw
                with self.assertRaises(AutoQuantValidationError):
                    resolve_studio_launch(
                        host=None,
                        port=None,
                        no_open=False,
                        environ=environment,
                    )

        with self.assertRaisesRegex(AutoQuantValidationError, "host"):
            resolve_studio_launch(
                host=None,
                port=None,
                no_open=False,
                environ={
                    "HARNESS_CAPABILITY": "studio",
                    "HARNESS_PORTS": '{"http":49321}',
                },
            )

        for host in (
            "",
            " ",
            " 127.0.0.1",
            "127.0.0.1 ",
            "0.0.0.0",
            "10.0.0.1",
            "192.0.2.1",
            "example.com",
            "localhost.example",
            "::1",
            "[::1]",
            "127.1",
            "127.000.000.001",
        ):
            with self.subTest(host=host), self.assertRaisesRegex(
                AutoQuantValidationError,
                "host",
            ):
                resolve_studio_launch(
                    host=None,
                    port=None,
                    no_open=False,
                    environ={
                        "HARNESS_CAPABILITY": "studio",
                        "HARNESS_HOST": host,
                        "HARNESS_PORTS": '{"http":49321}',
                    },
                )

    def test_non_managed_environment_preserves_standalone_launch(self) -> None:
        noisy_environment = {
            "HARNESS_CAPABILITY": "another-capability",
            "HARNESS_HOST": "192.0.2.1",
            "HARNESS_PORTS": "not-json",
            "HARNESS_NO_OPEN": "1",
            "OPENALICE_CAPABILITY": "studio",
            "OPENALICE_CAPABILITY_HOST": "192.0.2.1",
            "OPENALICE_CAPABILITY_PORTS": "not-json",
            "OPENALICE_CAPABILITY_NO_OPEN": "1",
        }
        default = resolve_studio_launch(
            host=None,
            port=None,
            no_open=False,
            environ=noisy_environment,
        )
        explicit = resolve_studio_launch(
            host="0.0.0.0",
            port=0,
            no_open=True,
            environ=noisy_environment,
        )

        self.assertFalse(default.managed)
        self.assertEqual(default.host, "127.0.0.1")
        self.assertEqual(default.port, 8765)
        self.assertTrue(default.open_browser)
        self.assertEqual(explicit.host, "0.0.0.0")
        self.assertEqual(explicit.port, 0)
        self.assertFalse(explicit.open_browser)

    def test_managed_cli_forces_no_browser_and_exact_bind(self) -> None:
        from autoquant.cli import main

        environment = self._managed_environment(49321)
        with mock.patch.dict(os.environ, environment, clear=True), mock.patch(
            "autoquant.cli.serve_studio"
        ) as serve:
            exit_code = main(["studio", "serve", "."])

        self.assertEqual(exit_code, 0)
        serve.assert_called_once_with(
            ".",
            project_id=None,
            host="127.0.0.1",
            port=49321,
            open_browser=False,
            managed=True,
        )

    def test_managed_cli_uses_real_fixed_port_and_health_readiness(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace, _, _ = self._setup(directory)
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
                probe.bind(("127.0.0.1", 0))
                port = probe.getsockname()[1]
            process = subprocess.Popen(
                [
                    sys.executable,
                    "-m",
                    "autoquant",
                    "studio",
                    "serve",
                    str(workspace.root_dir),
                    "--no-open",
                ],
                cwd=Path(__file__).resolve().parents[1],
                env=self._managed_environment(port),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            try:
                announcement = process.stdout.readline().strip()
                self.assertEqual(
                    announcement,
                    f"AutoQuant Studio: http://127.0.0.1:{port}",
                    process.stderr.read() if process.poll() is not None else "",
                )
                with urlopen(
                    f"http://127.0.0.1:{port}/api/v1/health",
                    timeout=3,
                ) as response:
                    self.assertEqual(response.status, 200)
                    health = json.loads(response.read())
                self.assertTrue(health["ok"])
                self.assertEqual(health["service"], "autoquant-studio")
                self.assertEqual(health["mode"], "read-only")
            finally:
                process.terminate()
                process.wait(timeout=5)
                process.stdout.close()
                process.stderr.close()

    def test_manifest_command_is_origin_neutral_embeddable_and_releases_on_sigterm(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace, parent_environment = self._prepare_source_workspace(directory)
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
                probe.bind(("127.0.0.1", 0))
                port = probe.getsockname()[1]
            default_was_free = False
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as default_probe:
                default_was_free = default_probe.connect_ex(
                    ("127.0.0.1", 8765)
                ) != 0
            environment = self._managed_environment(port)
            environment["PATH"] = parent_environment["PATH"]
            environment.pop("VIRTUAL_ENV", None)
            environment.pop("UV_PROJECT_ENVIRONMENT", None)
            process = subprocess.Popen(
                self._manifest_command(),
                cwd=workspace,
                env=environment,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            try:
                announcement = process.stdout.readline().strip()
                self.assertEqual(
                    announcement,
                    f"AutoQuant Studio: http://127.0.0.1:{port}",
                    process.stderr.read() if process.poll() is not None else "",
                )
                base = f"http://127.0.0.1:{port}"
                headers = {
                    "Host": "oa-surface-autoquant.localhost",
                    "Cookie": "openalice-session=must-not-be-required",
                    "Authorization": "Bearer must-not-be-required",
                    "X-CSRF-Token": "must-not-be-required",
                }
                for path, expected in (
                    ("/", b"Quant research desk"),
                    ("/assets/studio.css", b"--bg"),
                    ("/assets/studio.js", b'/api/v1/snapshot'),
                ):
                    with urlopen(Request(f"{base}{path}", headers=headers), timeout=3) as response:
                        body = response.read()
                        self.assertEqual(response.status, 200)
                        self.assertIn(expected, body)
                        csp = response.headers["Content-Security-Policy"]
                        self.assertIn(
                            "frame-ancestors app: http://127.0.0.1:* "
                            "http://localhost:* http://*.localhost:*",
                            csp,
                        )
                        self.assertNotIn("frame-ancestors *", csp)
                        self.assertIsNone(response.headers["X-Frame-Options"])
                        self.assertIsNone(
                            response.headers["Cross-Origin-Resource-Policy"]
                        )
                        self.assertIsNone(response.headers["Location"])
                with urlopen(
                    Request(f"{base}/api/v1/health", headers=headers), timeout=3
                ) as response:
                    self.assertEqual(response.status, 200)
                    self.assertEqual(
                        json.loads(response.read())["service"],
                        "autoquant-studio",
                    )
                with urlopen(
                    Request(f"{base}/api/v1/snapshot", headers=headers), timeout=3
                ) as response:
                    self.assertEqual(response.status, 200)
                    self.assertEqual(
                        json.loads(response.read())["kind"],
                        "autoquant-studio-snapshot",
                    )
                if default_was_free:
                    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as check:
                        self.assertNotEqual(check.connect_ex(("127.0.0.1", 8765)), 0)
            finally:
                process.terminate()
                process.wait(timeout=5)
                process.stdout.close()
                process.stderr.close()

            self.assertNotEqual(process.returncode, None)
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener_check:
                self.assertNotEqual(
                    listener_check.connect_ex(("127.0.0.1", port)), 0
                )
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as released:
                released.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                released.bind(("127.0.0.1", port))

    def test_manifest_command_fails_clearly_without_prepared_environment(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace = self._copy_source_workspace(directory)
            parent_environment = self._ordinary_parent_environment()
            environment = self._managed_environment(49321)
            environment["PATH"] = parent_environment["PATH"]
            environment.pop("VIRTUAL_ENV", None)
            environment.pop("UV_PROJECT_ENVIRONMENT", None)
            lock_before = (workspace / "uv.lock").read_bytes()

            result = subprocess.run(
                self._manifest_command(),
                cwd=workspace,
                env=environment,
                capture_output=True,
                check=False,
                text=True,
                timeout=15,
            )

            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(result.stdout, "")
            self.assertIn("Failed to spawn", result.stderr)
            self.assertIn("aq", result.stderr)
            self.assertEqual((workspace / "uv.lock").read_bytes(), lock_before)
            self.assertFalse((workspace / ".venv" / "bin" / "aq").exists())

    def test_managed_no_open_environment_suppresses_real_browser_opener(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace = initialize_workspace(Path(directory) / "desk")
            marker = Path(directory) / "browser-opened"
            opener = Path(directory) / "browser-opener"
            opener.write_text(
                "#!/bin/sh\nprintf opened > \"$AUTOQUANT_BROWSER_MARKER\"\n",
                encoding="utf-8",
            )
            opener.chmod(0o755)
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
                probe.bind(("127.0.0.1", 0))
                port = probe.getsockname()[1]
            command = [
                sys.executable,
                "-m",
                "autoquant",
                "studio",
                "serve",
                str(workspace.root_dir),
            ]
            environment = self._managed_environment(port)
            environment.update(
                {
                    "AUTOQUANT_BROWSER_MARKER": str(marker),
                    "BROWSER": str(opener),
                }
            )
            process = subprocess.Popen(
                command,
                cwd=workspace.root_dir,
                env=environment,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            try:
                process.stdout.readline()
                with urlopen(
                    f"http://127.0.0.1:{port}/api/v1/health", timeout=3
                ) as response:
                    self.assertEqual(response.status, 200)
                time.sleep(0.2)
                self.assertFalse(marker.exists())
            finally:
                process.terminate()
                process.wait(timeout=5)
                process.stdout.close()
                process.stderr.close()

    def test_frontend_has_only_current_origin_http_transport(self) -> None:
        assets = Path(__file__).resolve().parents[1] / "autoquant" / "studio_assets"
        html = (assets / "index.html").read_text(encoding="utf-8")
        javascript = (assets / "studio.js").read_text(encoding="utf-8")
        self.assertIn('href="/assets/studio.css"', html)
        self.assertIn('src="/assets/studio.js"', html)
        self.assertIn('fetch("/api/v1/snapshot"', javascript)
        for fixed_origin in (
            "http://127.0.0.1",
            "http://localhost",
            "ws://",
            "wss://",
        ):
            self.assertNotIn(fixed_origin, html)
            self.assertNotIn(fixed_origin, javascript)
        self.assertNotIn("EventSource(", javascript)
        self.assertNotIn("WebSocket(", javascript)

    def test_managed_cli_fails_when_injected_port_is_occupied(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace, _, _ = self._setup(directory)
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as occupied:
                occupied.bind(("127.0.0.1", 0))
                occupied.listen()
                port = occupied.getsockname()[1]
                result = subprocess.run(
                    [
                        sys.executable,
                        "-m",
                        "autoquant",
                        "studio",
                        "serve",
                        str(workspace.root_dir),
                        "--no-open",
                    ],
                    cwd=Path(__file__).resolve().parents[1],
                    env=self._managed_environment(port),
                    capture_output=True,
                    check=False,
                    text=True,
                    timeout=5,
                )

        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, "")
        self.assertIn("Address already in use", result.stderr)

    def test_managed_cli_subprocess_rejects_conflicting_explicit_port(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace = initialize_workspace(Path(directory) / "desk")
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
                probe.bind(("127.0.0.1", 0))
                port = probe.getsockname()[1]
            environment = self._managed_environment(port)
            result = subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "autoquant",
                    "studio",
                    "serve",
                    str(workspace.root_dir),
                    "--no-open",
                    "--port",
                    str(port + 1),
                ],
                cwd=Path(__file__).resolve().parents[1],
                env=environment,
                capture_output=True,
                check=False,
                text=True,
                timeout=5,
            )

        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, "")
        self.assertIn("conflicts with injected port", result.stderr)

    def test_cli_serve_announces_a_live_local_read_only_url(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace, _, _ = self._setup(directory)
            process = subprocess.Popen(
                [
                    sys.executable,
                    "-m",
                    "autoquant",
                    "studio",
                    "serve",
                    str(workspace.root_dir),
                    "--port",
                    "0",
                    "--no-open",
                ],
                env=self._standalone_environment(),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            try:
                announcement = process.stdout.readline().strip()
                self.assertTrue(
                    announcement.startswith("AutoQuant Studio: http://127.0.0.1:"),
                    process.stderr.read() if process.poll() is not None else announcement,
                )
                url = announcement.removeprefix("AutoQuant Studio: ")
                with urlopen(f"{url}/api/v1/health", timeout=3) as response:
                    self.assertEqual(json.loads(response.read())["mode"], "read-only")
                    self.assertEqual(response.headers["X-Frame-Options"], "DENY")
                    self.assertEqual(
                        response.headers["Cross-Origin-Resource-Policy"],
                        "same-origin",
                    )
                    self.assertIn(
                        "frame-ancestors 'none'",
                        response.headers["Content-Security-Policy"],
                    )
            finally:
                process.terminate()
                process.wait(timeout=5)
                process.stdout.close()
                process.stderr.close()


if __name__ == "__main__":
    unittest.main()
