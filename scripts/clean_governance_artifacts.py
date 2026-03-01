#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

EXIT_OK = 0
EXIT_TOOL_ERROR = 3


def utc_now_iso() -> str:
    return (
        datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Clean governance runtime artifacts while keeping tracked templates."
    )
    parser.add_argument(
        "--packet-dir",
        default="decision_packet",
        help="Decision packet output directory.",
    )
    parser.add_argument(
        "--runtime-dir",
        default="data/runtime",
        help="Runtime report directory.",
    )
    parser.add_argument(
        "--output",
        default="data/runtime/governance_clean_report.json",
        help="Cleanup report path.",
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
    packet_dir = Path(args.packet_dir)
    runtime_dir = Path(args.runtime_dir)
    output_path = Path(args.output)
    removed: list[str] = []
    kept: list[str] = []

    try:
        if packet_dir.exists():
            shutil.rmtree(packet_dir)
            removed.append(str(packet_dir))
        else:
            kept.append(str(packet_dir))

        if runtime_dir.exists():
            for path in runtime_dir.glob("*_report.json"):
                path.unlink(missing_ok=True)
                removed.append(str(path))
            for name in (
                "environment_verify_report.json",
                "takeover_ready_report.json",
                "governance_seed_report.json",
                "governance_clean_report.json",
            ):
                target = runtime_dir / name
                if target.exists():
                    target.unlink(missing_ok=True)
                    removed.append(str(target))

        report = {
            "passed": True,
            "generatedAt": utc_now_iso(),
            "removed": removed,
            "kept": kept,
        }
        write_json(output_path, report)
        return EXIT_OK
    except Exception as exc:  # noqa: BLE001
        report = {
            "passed": False,
            "generatedAt": utc_now_iso(),
            "removed": removed,
            "kept": kept,
            "failures": [f"tool_error: {exc}"],
        }
        write_json(output_path, report)
        return EXIT_TOOL_ERROR


if __name__ == "__main__":
    sys.exit(main())
