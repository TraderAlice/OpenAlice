#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

EXIT_OK = 0
EXIT_INVALID_REPLAY = 2
EXIT_TOOL_ERROR = 3

STATE_SET = {
    "NORMAL",
    "WATCH",
    "DEGRADE_H0",
    "PAUSE_NEW_OPENS",
    "RECOVERY_SHADOW",
}

ALLOWED_TRANSITIONS = {
    "NORMAL": {"NORMAL", "WATCH", "DEGRADE_H0", "PAUSE_NEW_OPENS"},
    "WATCH": {"WATCH", "NORMAL", "DEGRADE_H0", "PAUSE_NEW_OPENS"},
    "DEGRADE_H0": {"DEGRADE_H0", "RECOVERY_SHADOW", "PAUSE_NEW_OPENS"},
    "PAUSE_NEW_OPENS": {"PAUSE_NEW_OPENS", "WATCH", "DEGRADE_H0", "RECOVERY_SHADOW"},
    "RECOVERY_SHADOW": {
        "RECOVERY_SHADOW",
        "NORMAL",
        "DEGRADE_H0",
        "PAUSE_NEW_OPENS",
    },
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Replay runtime state machine events and verify transition semantics."
    )
    parser.add_argument(
        "--log-file",
        default="decision_packet/state_machine_log.jsonl",
        help="Path to state machine jsonl log file.",
    )
    parser.add_argument(
        "--output",
        default="decision_packet/replay_report.json",
        help="Path to write replay report.",
    )
    parser.add_argument(
        "--simulate-tool-error",
        action="store_true",
        help="Return TOOL_ERROR for CI exit-code contract tests.",
    )
    return parser.parse_args()


def utc_now_iso() -> str:
    return (
        datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    )


def parse_iso(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def coalesce_state(record: dict[str, Any], keys: tuple[str, ...]) -> str | None:
    for key in keys:
        value = record.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip().upper()
    return None


def parse_log(log_file: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for idx, line in enumerate(
        log_file.read_text(encoding="utf-8").splitlines(), start=1
    ):
        if not line.strip():
            continue
        payload = json.loads(line)
        if not isinstance(payload, dict):
            raise ValueError(f"line {idx} must be JSON object.")
        payload["_line"] = idx
        records.append(payload)
    return records


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        f"{json.dumps(payload, ensure_ascii=False, indent=2)}\n", encoding="utf-8"
    )


def main() -> int:
    args = parse_args()
    log_path = Path(args.log_file)
    output_path = Path(args.output)

    try:
        if args.simulate_tool_error:
            raise RuntimeError("simulated tool error")

        if not log_path.exists():
            report = {
                "generatedAt": utc_now_iso(),
                "valid": False,
                "errors": [f"log file not found: {log_path}"],
                "finalState": None,
                "transitions": [],
            }
            write_json(output_path, report)
            return EXIT_INVALID_REPLAY

        records = parse_log(log_path)
        if len(records) == 0:
            report = {
                "generatedAt": utc_now_iso(),
                "valid": False,
                "errors": ["state machine log has no events."],
                "finalState": None,
                "transitions": [],
            }
            write_json(output_path, report)
            return EXIT_INVALID_REPLAY

        errors: list[str] = []
        warnings: list[str] = []
        transitions: list[dict[str, Any]] = []

        current_state: str | None = None
        last_ts: datetime | None = None

        for record in records:
            line_no = int(record.get("_line", -1))
            from_state = coalesce_state(
                record, ("from", "fromState", "prevState", "previousState")
            )
            to_state = coalesce_state(record, ("to", "toState", "nextState", "state"))

            if to_state is None:
                errors.append(f"line {line_no}: cannot determine to-state.")
                continue
            if to_state not in STATE_SET:
                errors.append(f"line {line_no}: unknown state '{to_state}'.")
                continue

            if from_state is None:
                from_state = current_state
            if from_state is not None and from_state not in STATE_SET:
                errors.append(f"line {line_no}: unknown from-state '{from_state}'.")
                continue

            ts = parse_iso(
                record.get("timestamp")
                or record.get("at")
                or record.get("createdAt")
                or record.get("time")
            )
            if ts and last_ts and ts < last_ts:
                warnings.append(f"line {line_no}: timestamp is out-of-order.")
            if ts:
                last_ts = ts

            if from_state is None:
                current_state = to_state
                transitions.append(
                    {
                        "line": line_no,
                        "from": None,
                        "to": to_state,
                        "allowed": True,
                        "event": record.get("event"),
                    }
                )
                continue

            allowed_set = ALLOWED_TRANSITIONS.get(from_state, set())
            allowed = to_state in allowed_set
            if not allowed:
                errors.append(
                    f"line {line_no}: invalid transition {from_state} -> {to_state}."
                )

            transitions.append(
                {
                    "line": line_no,
                    "from": from_state,
                    "to": to_state,
                    "allowed": allowed,
                    "event": record.get("event"),
                }
            )
            current_state = to_state

        valid = len(errors) == 0
        report = {
            "generatedAt": utc_now_iso(),
            "valid": valid,
            "logFile": str(log_path),
            "transitionCount": len(transitions),
            "finalState": current_state,
            "errors": errors,
            "warnings": warnings,
            "transitions": transitions,
        }
        write_json(output_path, report)
        return EXIT_OK if valid else EXIT_INVALID_REPLAY
    except (json.JSONDecodeError, ValueError) as exc:
        report = {
            "generatedAt": utc_now_iso(),
            "valid": False,
            "logFile": str(log_path),
            "errors": [f"invalid_replay_input: {exc}"],
            "finalState": None,
            "transitions": [],
        }
        write_json(output_path, report)
        return EXIT_INVALID_REPLAY
    except Exception as exc:  # noqa: BLE001
        report = {
            "generatedAt": utc_now_iso(),
            "valid": False,
            "logFile": str(log_path),
            "errors": [f"tool_error: {exc}"],
            "finalState": None,
            "transitions": [],
        }
        write_json(output_path, report)
        return EXIT_TOOL_ERROR


if __name__ == "__main__":
    sys.exit(main())
