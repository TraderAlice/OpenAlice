#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

EXIT_OK = 0
EXIT_POLICY_FAIL = 2
EXIT_TOOL_ERROR = 3


def utc_now_iso() -> str:
    return (
        datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Post-pull one-shot sync: seed governance config + required checks."
    )
    parser.add_argument(
        "--repo-root",
        default=".",
        help="Repository root (default: current directory).",
    )
    parser.add_argument(
        "--run-evidence",
        choices=["auto", "always", "never"],
        default="auto",
        help="Whether to run decision packet validation.",
    )
    parser.add_argument(
        "--output",
        default="data/runtime/post_pull_sync_report.json",
        help="Machine-readable report output path.",
    )
    return parser.parse_args()


def run_cmd(cmd: list[str], cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        cmd,
        cwd=str(cwd),
        text=True,
        capture_output=True,
        check=False,
    )


def trim_tail(text: str, max_lines: int = 30) -> str:
    lines = text.strip().splitlines()
    if len(lines) <= max_lines:
        return "\n".join(lines)
    return "\n".join(lines[-max_lines:])


def classify_exit(code: int) -> str:
    if code == 0:
        return "pass"
    if code == 2:
        return "policy_fail"
    if code == 3:
        return "tool_error"
    if code == 127:
        return "env_error"
    return "failed"


def should_run_evidence(run_mode: str, repo_root: Path) -> bool:
    if run_mode == "always":
        return True
    if run_mode == "never":
        return False
    return (repo_root / "decision_packet" / "evidence_pack.json").exists()


def load_scheduler_status(repo_root: Path) -> dict[str, Any]:
    heartbeat_path = repo_root / "data/config/heartbeat.json"
    jobs_path = repo_root / "data/cron/jobs.json"

    heartbeat_enabled: bool | None = None
    heartbeat_error: str | None = None
    if heartbeat_path.exists():
        try:
            payload = json.loads(heartbeat_path.read_text(encoding="utf-8"))
            if isinstance(payload, dict) and isinstance(payload.get("enabled"), bool):
                heartbeat_enabled = payload["enabled"]
            else:
                heartbeat_error = "heartbeat.json missing boolean field: enabled"
        except Exception as exc:  # noqa: BLE001
            heartbeat_error = f"heartbeat.json parse error: {exc}"
    else:
        heartbeat_error = f"heartbeat.json not found: {heartbeat_path}"

    heartbeat_job_enabled: bool | None = None
    heartbeat_job_id: str | None = None
    jobs_error: str | None = None
    if jobs_path.exists():
        try:
            payload = json.loads(jobs_path.read_text(encoding="utf-8"))
            jobs = payload.get("jobs") if isinstance(payload, dict) else None
            if isinstance(jobs, list):
                for item in jobs:
                    if not isinstance(item, dict):
                        continue
                    if item.get("name") == "__heartbeat__":
                        heartbeat_job_id = (
                            item.get("id")
                            if isinstance(item.get("id"), str)
                            else None
                        )
                        if isinstance(item.get("enabled"), bool):
                            heartbeat_job_enabled = item["enabled"]
                        break
            if heartbeat_job_enabled is None and heartbeat_job_id is None:
                jobs_error = "__heartbeat__ job not found"
        except Exception as exc:  # noqa: BLE001
            jobs_error = f"jobs.json parse error: {exc}"
    else:
        jobs_error = f"jobs.json not found: {jobs_path}"

    return {
        "heartbeatConfig": {
            "path": str(heartbeat_path),
            "enabled": heartbeat_enabled,
            "error": heartbeat_error,
        },
        "heartbeatCronJob": {
            "path": str(jobs_path),
            "id": heartbeat_job_id,
            "enabled": heartbeat_job_enabled,
            "error": jobs_error,
        },
    }


def execute_step(name: str, cmd: list[str], required: bool, cwd: Path) -> dict[str, Any]:
    proc = run_cmd(cmd, cwd)
    return {
        "name": name,
        "required": required,
        "cmd": cmd,
        "exitCode": proc.returncode,
        "status": classify_exit(proc.returncode),
        "stdoutTail": trim_tail(proc.stdout),
        "stderrTail": trim_tail(proc.stderr),
    }


def resolve_overall_exit(step_results: list[dict[str, Any]]) -> int:
    codes = [int(step["exitCode"]) for step in step_results if step.get("status") != "skipped"]
    if any(code == EXIT_TOOL_ERROR for code in codes):
        return EXIT_TOOL_ERROR
    if any(code == EXIT_POLICY_FAIL for code in codes):
        return EXIT_POLICY_FAIL
    if any(code != EXIT_OK for code in codes):
        return EXIT_TOOL_ERROR
    return EXIT_OK


def run_sync(repo_root: Path, run_evidence_mode: str) -> tuple[dict[str, Any], int]:
    evidence_enabled = should_run_evidence(run_evidence_mode, repo_root)

    steps: list[dict[str, Any]] = []
    steps.append(
        execute_step(
            "governance_seed_config",
            [
                "node",
                "--import",
                "tsx",
                "scripts/python_fallback.ts",
                "scripts/seed_governance_config.py",
            ],
            required=True,
            cwd=repo_root,
        )
    )
    steps.append(
        execute_step(
            "verify_environment_lock",
            [
                "node",
                "--import",
                "tsx",
                "scripts/python_fallback.ts",
                "scripts/verify_environment_lock.py",
            ],
            required=True,
            cwd=repo_root,
        )
    )
    steps.append(
        execute_step(
            "verify_freeze_manifest",
            [
                "node",
                "--import",
                "tsx",
                "scripts/python_fallback.ts",
                "scripts/verify_freeze_manifest.py",
            ],
            required=True,
            cwd=repo_root,
        )
    )

    if evidence_enabled:
        steps.append(
            execute_step(
                "validate_decision_packet",
                [
                    "node",
                    "--import",
                    "tsx",
                    "scripts/python_fallback.ts",
                    "scripts/validate_decision_packet.py",
                ],
                required=False,
                cwd=repo_root,
            )
        )
    else:
        steps.append(
            {
                "name": "validate_decision_packet",
                "required": False,
                "cmd": [
                    "node",
                    "--import",
                    "tsx",
                    "scripts/python_fallback.ts",
                    "scripts/validate_decision_packet.py",
                ],
                "exitCode": 0,
                "status": "skipped",
                "stdoutTail": "",
                "stderrTail": "",
                "skipReason": "decision_packet/evidence_pack.json not found",
            }
        )

    overall_exit = resolve_overall_exit(steps)
    report = {
        "version": "v1",
        "generatedAt": utc_now_iso(),
        "repoRoot": str(repo_root.resolve()),
        "runEvidence": run_evidence_mode,
        "evidenceStepExecuted": evidence_enabled,
        "steps": steps,
        "schedulerStatus": load_scheduler_status(repo_root),
        "overall": {
            "exitCode": overall_exit,
            "status": classify_exit(overall_exit),
            "success": overall_exit == EXIT_OK,
        },
    }
    return report, overall_exit


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        f"{json.dumps(payload, ensure_ascii=False, indent=2)}\n",
        encoding="utf-8",
    )


def main() -> int:
    args = parse_args()
    repo_root = Path(args.repo_root).resolve()
    output_path = Path(args.output)
    if not output_path.is_absolute():
        output_path = repo_root / output_path

    report, exit_code = run_sync(repo_root, args.run_evidence)
    write_json(output_path, report)

    print(
        json.dumps(
            {
                "status": report["overall"]["status"],
                "exitCode": exit_code,
                "output": str(output_path),
            },
            ensure_ascii=False,
        )
    )
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
