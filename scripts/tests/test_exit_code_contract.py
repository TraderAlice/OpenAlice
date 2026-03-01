#!/usr/bin/env python3
"""Exit-code contract tests for governance scripts.

Rules:
- Invalid/policy input must return exit 2.
- Tool/runtime exceptions must return exit 3.
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = REPO_ROOT / "scripts"
FREEZE_SCHEMA_PATH = (
    REPO_ROOT / "docs/research/templates/freeze_manifest.schema.v1.json"
)
EXIT_CODE_MAP_PATH = (
    REPO_ROOT / "docs/research/templates/ci_exit_code_map.v1.json"
)


def now_utc_iso() -> str:
    return (
        datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    )


def run_cmd(args: list[str], cwd: Path = REPO_ROOT) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        cwd=str(cwd),
        text=True,
        capture_output=True,
        check=False,
    )


def make_valid_freeze_manifest() -> dict[str, object]:
    return {
        "manifestVersion": "v1",
        "frozenAt": now_utc_iso(),
        "versions": {
            "sm": "sm-v1",
            "stats": "stats-v1",
            "hash": "hash-v1",
            "evidence": "evidence-v1",
        },
        "thresholds": {"transferPassRatioRolling14dMin": 0.25},
        "raciSnapshot": {
            "E7": {"dri": "a", "backup": "b", "nightOnCall": "c"},
            "E8": {"dri": "d", "backup": "e", "nightOnCall": "f"},
            "E9": {"dri": "g", "backup": "h", "nightOnCall": "i"},
        },
        "incidentCommander": "ic",
        "l2OverrideAllowlist": ["l2"],
        "signOff": {"approvedBy": ["cto"], "approvedAt": now_utc_iso()},
    }


class TestExitCodeContract(unittest.TestCase):
    def test_exit_code_map_declares_required_contract(self) -> None:
        payload = json.loads(EXIT_CODE_MAP_PATH.read_text(encoding="utf-8"))
        commands = payload.get("commands", {})
        self.assertIn("env:verify", commands)
        self.assertIn("freeze:verify", commands)
        self.assertIn("evidence:validate", commands)
        self.assertIn("runtime:replay-state", commands)
        for command in (
            "env:verify",
            "freeze:verify",
            "evidence:validate",
            "runtime:replay-state",
        ):
            mapping = commands.get(command, {})
            self.assertEqual("TOOL_ERROR", mapping.get("3"))
            self.assertIn(mapping.get("2"), {"POLICY_FAIL", "NO_GO", "REPLAY_INVALID"})

    def test_verify_freeze_manifest_invalid_input_is_2(self) -> None:
        with tempfile.TemporaryDirectory(prefix="openalice-exit-freeze-invalid-") as tmp:
            tmp_dir = Path(tmp)
            manifest_path = tmp_dir / "invalid_manifest.json"
            output_path = tmp_dir / "report.json"
            manifest_path.write_text("{ invalid json }\n", encoding="utf-8")

            proc = run_cmd(
                [
                    sys.executable,
                    str(SCRIPTS_DIR / "verify_freeze_manifest.py"),
                    "--manifest",
                    str(manifest_path),
                    "--schema",
                    str(FREEZE_SCHEMA_PATH),
                    "--output",
                    str(output_path),
                ]
            )
            self.assertEqual(2, proc.returncode, msg=proc.stderr)

    def test_verify_freeze_manifest_tool_error_is_3(self) -> None:
        proc = run_cmd(
            [
                sys.executable,
                str(SCRIPTS_DIR / "verify_freeze_manifest.py"),
                "--simulate-tool-error",
            ]
        )
        self.assertEqual(3, proc.returncode, msg=proc.stderr)

    def test_replay_runtime_state_invalid_input_is_2(self) -> None:
        with tempfile.TemporaryDirectory(prefix="openalice-exit-replay-invalid-") as tmp:
            tmp_dir = Path(tmp)
            log_file = tmp_dir / "bad.jsonl"
            out_file = tmp_dir / "report.json"
            log_file.write_text(
                json.dumps({"from": "BAD", "to": "WATCH", "timestamp": now_utc_iso()})
                + "\n",
                encoding="utf-8",
            )

            proc = run_cmd(
                [
                    sys.executable,
                    str(SCRIPTS_DIR / "replay_runtime_state.py"),
                    "--log-file",
                    str(log_file),
                    "--output",
                    str(out_file),
                ]
            )
            self.assertEqual(2, proc.returncode, msg=proc.stderr)

    def test_replay_runtime_state_tool_error_is_3(self) -> None:
        proc = run_cmd(
            [
                sys.executable,
                str(SCRIPTS_DIR / "replay_runtime_state.py"),
                "--simulate-tool-error",
            ]
        )
        self.assertEqual(3, proc.returncode, msg=proc.stderr)

    def test_validate_decision_packet_invalid_input_is_2(self) -> None:
        with tempfile.TemporaryDirectory(prefix="openalice-exit-validate-invalid-") as tmp:
            tmp_dir = Path(tmp)
            packet_dir = tmp_dir / "packet"
            packet_dir.mkdir(parents=True, exist_ok=True)
            evidence_pack = packet_dir / "evidence_pack.json"
            evidence_pack.write_text("{ invalid json }\n", encoding="utf-8")

            freeze_manifest = tmp_dir / "freeze_manifest.json"
            freeze_manifest.write_text(
                json.dumps(make_valid_freeze_manifest(), ensure_ascii=False, indent=2)
                + "\n",
                encoding="utf-8",
            )

            proc = run_cmd(
                [
                    sys.executable,
                    str(SCRIPTS_DIR / "validate_decision_packet.py"),
                    "--packet-dir",
                    str(packet_dir),
                    "--evidence-pack",
                    str(evidence_pack),
                    "--freeze-manifest",
                    str(freeze_manifest),
                    "--environment-report",
                    str(tmp_dir / "no_env_report.json"),
                ]
            )
            self.assertEqual(2, proc.returncode, msg=proc.stderr)

    def test_validate_decision_packet_tool_error_is_3(self) -> None:
        proc = run_cmd(
            [
                sys.executable,
                str(SCRIPTS_DIR / "validate_decision_packet.py"),
                "--simulate-tool-error",
            ]
        )
        self.assertEqual(3, proc.returncode, msg=proc.stderr)

    def test_verify_environment_lock_policy_fail_is_2(self) -> None:
        with tempfile.TemporaryDirectory(prefix="openalice-exit-env-invalid-") as tmp:
            tmp_dir = Path(tmp)
            lock_path = tmp_dir / "environment_lock.json"
            out_path = tmp_dir / "report.json"
            lock_path.write_text(
                json.dumps(
                    {
                        "version": "v1",
                        "required": {
                            "node": "0.0.1",
                            "pnpm": "0.0.1",
                            "python": "0.0.1",
                            "jsonschema": "0.0.1",
                        },
                    },
                    ensure_ascii=False,
                    indent=2,
                )
                + "\n",
                encoding="utf-8",
            )

            proc = run_cmd(
                [
                    sys.executable,
                    str(SCRIPTS_DIR / "verify_environment_lock.py"),
                    "--lock",
                    str(lock_path),
                    "--output",
                    str(out_path),
                ]
            )
            self.assertEqual(2, proc.returncode, msg=proc.stderr)

    def test_verify_environment_lock_tool_error_is_3(self) -> None:
        proc = run_cmd(
            [
                sys.executable,
                str(SCRIPTS_DIR / "verify_environment_lock.py"),
                "--simulate-tool-error",
            ]
        )
        self.assertEqual(3, proc.returncode, msg=proc.stderr)


if __name__ == "__main__":
    unittest.main()
