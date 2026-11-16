from __future__ import annotations

import json
import shlex
import sys
import tempfile
import unittest
from pathlib import Path

from autoquant.research import list_campaigns, load_campaign, run_campaign
from autoquant.sessions import list_experiments, load_session, start_session
from autoquant.studies import create_study, hash_file
from autoquant.workspace import AutoQuantValidationError
from tests.study_helpers import SUCCESS_JUDGE, make_project, study_definition


RESEARCHER = """\
import json
import os
from pathlib import Path

brief = json.loads(input())
candidate = Path(os.environ["AUTOQUANT_WORKTREE"]) / "factors/candidate.py"
turn = brief["turn"]
if turn == 1:
    candidate.write_text("SCORE = 2.0\\n")
    response = {
        "schema_version": 1,
        "action": "propose",
        "strategy": "increase-score",
        "hypothesis": "Increase the synthetic score.",
        "expected_effect": "Beat the locked baseline.",
    }
elif turn == 2:
    candidate.write_text("SCORE = 1.0\\n")
    response = {
        "schema_version": 1,
        "action": "propose",
        "strategy": "decrease-score",
        "hypothesis": "Test a weaker synthetic score.",
        "expected_effect": "Challenge the current leader.",
    }
else:
    response = {
        "schema_version": 1,
        "action": "stop",
        "reason": "The bounded demonstration is complete.",
    }
print(json.dumps(response))
"""


class ExternalResearchCampaignTests(unittest.TestCase):
    def _setup(self, directory: str):
        _, project = make_project(directory)
        create_study(project, study_definition())
        session = start_session(project, "factor-quality")
        return project, session

    def _script(self, directory: str, source: str) -> str:
        path = Path(directory) / "researcher.py"
        path.write_text(source, encoding="utf-8")
        return f"{shlex.quote(sys.executable)} {shlex.quote(str(path))}"

    def test_campaign_drives_keep_revert_then_stop_and_verifies_evidence(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project, session = self._setup(directory)
            campaign = run_campaign(
                project,
                session.manifest["id"],
                self._script(directory, RESEARCHER),
                max_turns=5,
                max_wall_seconds=30,
                turn_timeout_seconds=5,
            )

            self.assertEqual(campaign.result["status"], "stopped")
            self.assertEqual(campaign.result["turnsCompleted"], 3)
            self.assertEqual(campaign.result["verdicts"]["KEEP"], 1)
            self.assertEqual(campaign.result["verdicts"]["REVERT"], 1)
            self.assertEqual(len(campaign.result["experiments"]), 2)
            progress = json.loads(
                (campaign.root_dir / "progress.json").read_text()
            )
            self.assertEqual(progress["status"], "stopped")
            self.assertEqual(progress["phase"], "terminal")
            self.assertEqual(progress["experiments"], campaign.result["experiments"])
            current = load_session(project, session.manifest["id"])
            self.assertEqual(current.manifest["leader"]["value"], 2.0)
            self.assertEqual(
                (
                    current.worktree_project.root_dir / "factors/candidate.py"
                ).read_text(),
                "SCORE = 2.0\n",
            )
            self.assertEqual(
                (project.root_dir / "factors/candidate.py").read_text(),
                "SCORE = 1.25\n",
            )
            self.assertEqual(
                [item.verdict for item in list_experiments(project, current)],
                ["KEEP", "REVERT"],
            )
            summaries = list_campaigns(project, current)
            self.assertEqual([item.id for item in summaries], [campaign.result["id"]])
            loaded = load_campaign(project, current, campaign.result["id"])
            self.assertEqual(loaded.result, campaign.result)
            first_brief = json.loads(
                (campaign.root_dir / "turns/turn-0001/input.json").read_text()
            )
            third_brief = json.loads(
                (campaign.root_dir / "turns/turn-0003/input.json").read_text()
            )
            self.assertEqual(first_brief["editablePaths"], ["factors/**"])
            self.assertEqual(third_brief["leader"]["value"], 2.0)
            self.assertEqual(
                [item["verdict"] for item in third_brief["campaignHistory"]],
                ["KEEP", "REVERT"],
            )
            self.assertNotIn(
                self._script(directory, RESEARCHER),
                json.dumps(campaign.result),
            )

    def test_turn_budget_is_terminal_evidence(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project, session = self._setup(directory)
            campaign = run_campaign(
                project,
                session.manifest["id"],
                self._script(directory, RESEARCHER),
                max_turns=1,
                max_wall_seconds=30,
                turn_timeout_seconds=5,
            )

            self.assertEqual(campaign.result["status"], "budget_exhausted")
            self.assertEqual(campaign.result["turnsCompleted"], 1)
            self.assertEqual(campaign.result["verdicts"]["KEEP"], 1)
            self.assertEqual(campaign.result["budget"]["maxTurns"], 1)

        with tempfile.TemporaryDirectory() as directory:
            project, session = self._setup(directory)
            campaign = run_campaign(
                project,
                session.manifest["id"],
                self._script(directory, RESEARCHER),
                max_turns=5,
                max_wall_seconds=1,
                turn_timeout_seconds=1,
            )

            self.assertEqual(campaign.result["status"], "budget_exhausted")
            self.assertEqual(campaign.result["turnsCompleted"], 0)
            self.assertEqual(campaign.result["experiments"], [])
            self.assertIn("wall-clock", campaign.result["reason"])

    def test_protocol_and_command_failures_restore_the_leader(self) -> None:
        cases = {
            "exit": (
                """\
from pathlib import Path
import os
Path(os.environ["AUTOQUANT_WORKTREE"], "factors/candidate.py").write_text("SCORE = 8.0\\n")
raise SystemExit(7)
""",
                "researcher.exit",
                5,
            ),
            "timeout": (
                """\
from pathlib import Path
import os
import time
Path(os.environ["AUTOQUANT_WORKTREE"], "factors/candidate.py").write_text("SCORE = 8.0\\n")
time.sleep(2)
""",
                "researcher.timeout",
                1,
            ),
            "malformed": (
                'print("{not json")\n',
                "researcher.response-json",
                5,
            ),
            "fixed-mutation": (
                """\
import json
import os
from pathlib import Path
root = Path(os.environ["AUTOQUANT_WORKTREE"])
(root / "factors/candidate.py").write_text("SCORE = 8.0\\n")
(root / "judges/evaluate.py").write_text("raise SystemExit(9)\\n")
print(json.dumps({
    "schema_version": 1,
    "action": "propose",
    "strategy": "cheat",
    "hypothesis": "Change the locked Judge.",
    "expected_effect": "Illegally improve the result.",
}))
""",
                "session.lock-stale",
                5,
            ),
            "unchanged": (
                """\
import json
print(json.dumps({
    "schema_version": 1,
    "action": "propose",
    "strategy": "no-op",
    "hypothesis": "Submit the unchanged source.",
    "expected_effect": "No change.",
}))
""",
                "experiment.unchanged",
                5,
            ),
            "authority-claim": (
                """\
import json
import os
from pathlib import Path
Path(os.environ["AUTOQUANT_WORKTREE"], "factors/candidate.py").write_text("SCORE = 8.0\\n")
print(json.dumps({
    "schema_version": 1,
    "action": "propose",
    "strategy": "self-judged",
    "hypothesis": "Claim authority the Researcher does not have.",
    "expected_effect": "Attempt to bypass the fixed Judge.",
    "verdict": "KEEP",
}))
""",
                "schema.unknown",
                5,
            ),
            "changed-stop": (
                """\
import json
import os
from pathlib import Path
Path(os.environ["AUTOQUANT_WORKTREE"], "factors/candidate.py").write_text("SCORE = 8.0\\n")
print(json.dumps({
    "schema_version": 1,
    "action": "stop",
    "reason": "Stop after an unreviewed edit.",
}))
""",
                "researcher.stop-changed-source",
                5,
            ),
        }
        for name, (source, code, timeout) in cases.items():
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                project, session = self._setup(directory)
                campaign = run_campaign(
                    project,
                    session.manifest["id"],
                    self._script(directory, source),
                    max_turns=2,
                    max_wall_seconds=30,
                    turn_timeout_seconds=timeout,
                )

                self.assertEqual(campaign.result["status"], "failed")
                self.assertEqual(campaign.result["errors"][0]["code"], code)
                current = load_session(project, session.manifest["id"])
                self.assertEqual(
                    (
                        current.worktree_project.root_dir / "factors/candidate.py"
                    ).read_text(),
                    "SCORE = 1.25\n",
                )
                self.assertEqual(
                    (
                        current.worktree_project.root_dir / "judges/evaluate.py"
                    ).read_text(),
                    SUCCESS_JUDGE,
                )
                load_campaign(project, current, campaign.result["id"])

    def test_campaign_loader_rejects_tampering(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project, session = self._setup(directory)
            campaign = run_campaign(
                project,
                session.manifest["id"],
                self._script(directory, RESEARCHER),
                max_turns=1,
                max_wall_seconds=30,
                turn_timeout_seconds=5,
            )
            result_path = campaign.root_dir / "result.json"
            value = json.loads(result_path.read_text())
            value["reason"] = "tampered"
            result_path.write_text(json.dumps(value))

            with self.assertRaisesRegex(AutoQuantValidationError, "files changed"):
                load_campaign(
                    project,
                    load_session(project, session.manifest["id"]),
                    campaign.result["id"],
                )

    def test_campaign_loader_rejects_rehashed_invalid_contract(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project, session = self._setup(directory)
            campaign = run_campaign(
                project,
                session.manifest["id"],
                self._script(directory, RESEARCHER),
                max_turns=1,
                max_wall_seconds=30,
                turn_timeout_seconds=5,
            )
            result_path = campaign.root_dir / "result.json"
            result = json.loads(result_path.read_text())
            result["verdicts"]["KEEP"] = 9
            result_path.write_text(json.dumps(result))
            manifest_path = campaign.root_dir / "manifest.json"
            manifest = json.loads(manifest_path.read_text())
            result_hash = hash_file(result_path)
            manifest["files"]["result.json"] = result_hash
            manifest["resultHash"] = result_hash
            manifest_path.write_text(json.dumps(manifest))

            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "Verdict counts differ",
            ):
                load_campaign(
                    project,
                    load_session(project, session.manifest["id"]),
                    campaign.result["id"],
                )


if __name__ == "__main__":
    unittest.main()
