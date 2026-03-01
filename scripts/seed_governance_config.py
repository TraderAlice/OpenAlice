#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

EXIT_OK = 0
EXIT_POLICY_FAIL = 2
EXIT_TOOL_ERROR = 3

DEFAULT_GOVERNANCE_CONFIG: dict[str, Any] = {
    "enabled": True,
    "fallbackConfigId": "H0",
    "releaseGate": {
        "enabled": True,
        "statusPath": "data/runtime/release_gate_status.json",
        "maxStatusAgeHours": 24,
        "blockOnExpired": True,
    },
    "liveGate": {
        "enabled": True,
        "quoteAgeP95MsMax": 2000,
        "decisionToSubmitP95MsMax": 800,
        "decisionToFirstFillP95MsMax": 2500,
    },
    "statsGate": {
        "fdrQMax": 0.10,
        "transferPassRatioRolling14dMin": 0.25,
        "winnerEligibleRatioRolling14dMin": 0.35,
        "meanPboMax": 0.20,
        "meanDsrProbabilityMin": 0.50,
    },
}


def utc_now_iso() -> str:
    return (
        datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Seed governance config for D0-D1; hard-fail missing file in strict mode."
    )
    parser.add_argument(
        "--config",
        default="data/config/governance.json",
        help="Path to governance config file.",
    )
    parser.add_argument(
        "--mode",
        choices=["seed", "hard_fail"],
        default=os.environ.get("OPENALICE_GOVERNANCE_CONFIG_MODE", "seed"),
        help="seed: create if missing; hard_fail: block if missing.",
    )
    parser.add_argument(
        "--output",
        default="data/runtime/governance_seed_report.json",
        help="Path to write report.",
    )
    return parser.parse_args()


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        f"{json.dumps(payload, ensure_ascii=False, indent=2)}\n",
        encoding="utf-8",
    )


def main() -> int:
    args = parse_args()
    config_path = Path(args.config)
    output_path = Path(args.output)

    try:
        if config_path.exists():
            report = {
                "passed": True,
                "mode": args.mode,
                "generatedAt": utc_now_iso(),
                "configPath": str(config_path),
                "action": "already_exists",
            }
            write_json(output_path, report)
            return EXIT_OK

        if args.mode == "hard_fail":
            report = {
                "passed": False,
                "mode": args.mode,
                "generatedAt": utc_now_iso(),
                "configPath": str(config_path),
                "action": "blocked_missing_config",
                "failures": [
                    f"governance config missing in hard_fail mode: {config_path}"
                ],
            }
            write_json(output_path, report)
            return EXIT_POLICY_FAIL

        config_path.parent.mkdir(parents=True, exist_ok=True)
        config_path.write_text(
            f"{json.dumps(DEFAULT_GOVERNANCE_CONFIG, ensure_ascii=False, indent=2)}\n",
            encoding="utf-8",
        )
        report = {
            "passed": True,
            "mode": args.mode,
            "generatedAt": utc_now_iso(),
            "configPath": str(config_path),
            "action": "seeded_default_config",
        }
        write_json(output_path, report)
        return EXIT_OK
    except Exception as exc:  # noqa: BLE001
        report = {
            "passed": False,
            "mode": args.mode,
            "generatedAt": utc_now_iso(),
            "configPath": str(config_path),
            "action": "tool_error",
            "failures": [f"tool_error: {exc}"],
        }
        write_json(output_path, report)
        return EXIT_TOOL_ERROR


if __name__ == "__main__":
    sys.exit(main())
