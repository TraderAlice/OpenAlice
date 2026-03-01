#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from importlib import metadata
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
        description="Verify runtime environment against locked versions."
    )
    parser.add_argument(
        "--lock",
        default="docs/research/templates/environment_lock.v1.json",
        help="Path to environment lock file.",
    )
    parser.add_argument(
        "--output",
        default="data/runtime/environment_verify_report.json",
        help="Path to write machine-readable verification report.",
    )
    parser.add_argument(
        "--simulate-tool-error",
        action="store_true",
        help="Return TOOL_ERROR for CI exit-code contract tests.",
    )
    return parser.parse_args()


def read_json(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"{path} must be a JSON object.")
    return payload


def run_version_cmd(cmd: list[str], prefix: str = "") -> str:
    proc = subprocess.run(
        cmd,
        check=False,
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        stderr = proc.stderr.strip()
        raise RuntimeError(f"{' '.join(cmd)} failed: {stderr or 'unknown error'}")
    out = proc.stdout.strip()
    if prefix and out.startswith(prefix):
        return out[len(prefix) :]
    return out


def get_actual_versions() -> dict[str, str | None]:
    node_version = run_version_cmd(["node", "-v"], prefix="v")
    pnpm_version = run_version_cmd(["pnpm", "-v"])
    python_version = ".".join(str(part) for part in sys.version_info[:3])
    try:
        jsonschema_version = metadata.version("jsonschema")
    except metadata.PackageNotFoundError:
        jsonschema_version = None

    return {
        "node": node_version,
        "pnpm": pnpm_version,
        "python": python_version,
        "jsonschema": jsonschema_version,
    }


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        f"{json.dumps(payload, ensure_ascii=False, indent=2)}\n",
        encoding="utf-8",
    )


def main() -> int:
    args = parse_args()
    lock_path = Path(args.lock)
    output_path = Path(args.output)

    try:
        if args.simulate_tool_error:
            raise RuntimeError("simulated tool error")

        if not lock_path.exists():
            report = {
                "passed": False,
                "generatedAt": utc_now_iso(),
                "lockPath": str(lock_path),
                "actual": {},
                "expected": {},
                "mismatches": [f"lock file not found: {lock_path}"],
            }
            write_json(output_path, report)
            return EXIT_POLICY_FAIL

        lock_payload = read_json(lock_path)
        required = lock_payload.get("required")
        if not isinstance(required, dict) or len(required) == 0:
            raise ValueError("lock.required must be a non-empty object.")

        actual = get_actual_versions()
        mismatches: list[dict[str, Any]] = []
        for key in ("node", "pnpm", "python", "jsonschema"):
            expected_value = required.get(key)
            actual_value = actual.get(key)
            if not isinstance(expected_value, str) or not expected_value.strip():
                raise ValueError(f"lock.required.{key} must be non-empty string.")
            if actual_value != expected_value:
                mismatches.append(
                    {
                        "name": key,
                        "expected": expected_value,
                        "actual": actual_value,
                    }
                )

        report = {
            "passed": len(mismatches) == 0,
            "generatedAt": utc_now_iso(),
            "lockPath": str(lock_path),
            "actual": actual,
            "expected": required,
            "mismatches": mismatches,
        }
        write_json(output_path, report)
        return EXIT_OK if len(mismatches) == 0 else EXIT_POLICY_FAIL
    except (json.JSONDecodeError, ValueError) as exc:
        report = {
            "passed": False,
            "generatedAt": utc_now_iso(),
            "lockPath": str(lock_path),
            "actual": {},
            "expected": {},
            "mismatches": [f"invalid_lock_input: {exc}"],
        }
        write_json(output_path, report)
        return EXIT_POLICY_FAIL
    except Exception as exc:  # noqa: BLE001
        report = {
            "passed": False,
            "generatedAt": utc_now_iso(),
            "lockPath": str(lock_path),
            "actual": {},
            "expected": {},
            "mismatches": [f"tool_error: {exc}"],
        }
        write_json(output_path, report)
        return EXIT_TOOL_ERROR


if __name__ == "__main__":
    sys.exit(main())
