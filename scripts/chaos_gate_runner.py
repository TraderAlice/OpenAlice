#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

from gate_common import utc_now_iso, write_json


SCENARIOS = {
    "unknown_reason_code",
    "missing_dataset_snapshot_input",
    "missing_attestation",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run isolated chaos scenarios against gate_runner."
    )
    parser.add_argument("--repo-root", default=".")
    parser.add_argument(
        "--isolated-root",
        default="/tmp/openalice-chaos",
        help="Isolated non-production directory used for chaos outputs.",
    )
    parser.add_argument(
        "--scenario",
        default="unknown_reason_code",
        choices=sorted(SCENARIOS),
    )
    parser.add_argument(
        "--profile",
        default="data/config/profiles/profile_m0_72h.v5_1.yaml",
    )
    parser.add_argument(
        "--output",
        default=None,
        help="Chaos report output path. Defaults to <isolated-root>/chaos_gate_runner_report.json",
    )
    return parser.parse_args()


def _tail(text: str, max_lines: int = 30) -> str:
    lines = text.strip().splitlines()
    if len(lines) <= max_lines:
        return "\n".join(lines)
    return "\n".join(lines[-max_lines:])


def _build_reason_codes_override(path: Path) -> None:
    payload = {
        "version": "v1",
        "canonicalOnly": True,
        "codes": [
            {
                "code": "BAD_REASON_CODE",
                "severity": "HARD",
                "hardGate": True,
                "descriptionZh": "chaos invalid code",
                "descriptionEn": "chaos invalid code",
            }
        ],
        "deprecatedAliases": [],
    }
    write_json(path, payload)


def main() -> int:
    args = parse_args()
    repo_root = Path(args.repo_root).resolve()
    isolated_root = Path(args.isolated_root).resolve()
    isolated_root.mkdir(parents=True, exist_ok=True)

    if isolated_root == repo_root:
        raise ValueError("isolated-root must differ from repo-root.")

    # Guardrail: avoid production folders by policy.
    isolated_marker = isolated_root / ".chaos_isolated"
    if not isolated_marker.exists():
        isolated_marker.write_text("chaos-only\n", encoding="utf-8")

    output_path = (
        Path(args.output).resolve()
        if args.output
        else isolated_root / "chaos_gate_runner_report.json"
    )

    cmd = [
        sys.executable,
        str(repo_root / "scripts/gate_runner.py"),
        "--repo-root",
        str(repo_root),
        "--profile",
        args.profile,
        "--output-root",
        str(isolated_root / "runtime" / "gates"),
    ]

    scenario_artifacts: dict[str, str] = {}
    if args.scenario == "unknown_reason_code":
        reason_codes_override = isolated_root / "reason_codes_override.json"
        _build_reason_codes_override(reason_codes_override)
        cmd.extend(["--reason-codes", str(reason_codes_override)])
        scenario_artifacts["reasonCodesOverride"] = str(reason_codes_override)
    elif args.scenario == "missing_dataset_snapshot_input":
        cmd.extend(
            [
                "--dataset-path",
                str(isolated_root / "missing_dataset.json"),
                "--features-path",
                str(isolated_root / "missing_features.json"),
                "--labels-path",
                str(isolated_root / "missing_labels.json"),
                "--split-path",
                str(isolated_root / "missing_split.json"),
            ]
        )
    elif args.scenario == "missing_attestation":
        # Force gates to run without attestation; G4 should fail if previous gates pass.
        pass

    proc = subprocess.run(
        cmd,
        cwd=str(repo_root),
        text=True,
        capture_output=True,
        check=False,
    )

    report: dict[str, Any] = {
        "version": "v1",
        "generatedAt": utc_now_iso(),
        "scenario": args.scenario,
        "repoRoot": str(repo_root),
        "isolatedRoot": str(isolated_root),
        "command": cmd,
        "exitCode": proc.returncode,
        "stdoutTail": _tail(proc.stdout),
        "stderrTail": _tail(proc.stderr),
        "artifacts": scenario_artifacts,
    }
    write_json(output_path, report)
    print(json.dumps(report, ensure_ascii=False))

    return 0 if proc.returncode in (0, 2, 3) else proc.returncode


if __name__ == "__main__":
    sys.exit(main())
