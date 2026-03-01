#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from gate_common import read_json, utc_now_iso, write_json


STATE_CLOSED = "closed"
STATE_OPEN = "open"
STATE_HALF_OPEN = "half_open"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Evaluate gate runner health and produce guard state."
    )
    parser.add_argument(
        "--policy",
        default="data/config/runner_guard_policy.v1.json",
        help="Runner guard policy path.",
    )
    parser.add_argument(
        "--history",
        default="data/runtime/gates/history.ndjson",
        help="NDJSON history path for gate checkpoints.",
    )
    parser.add_argument(
        "--state",
        default="data/runtime/gates/runner_guard_state.json",
        help="Current runner guard state file path.",
    )
    parser.add_argument(
        "--output",
        default="data/runtime/gates/runner_guard_latest_report.json",
        help="Runner guard latest report output path.",
    )
    return parser.parse_args()


def load_history(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    rows: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        try:
            payload = json.loads(stripped)
            if isinstance(payload, dict):
                rows.append(payload)
        except json.JSONDecodeError:
            continue
    return rows


def compute_rates(history: list[dict[str, Any]]) -> dict[str, float]:
    total = float(len(history))
    if total == 0:
        return {
            "total": 0.0,
            "failRate": 0.0,
            "timeoutRate": 0.0,
            "retryStormRate": 0.0,
        }

    fail_count = 0.0
    timeout_count = 0.0
    retry_storm_count = 0.0
    for row in history:
        status = row.get("status")
        if status in ("tool_error", "policy_fail"):
            fail_count += 1.0
        issues = row.get("blockingIssues")
        if isinstance(issues, list):
            for issue in issues:
                if not isinstance(issue, str):
                    continue
                low = issue.lower()
                if "timeout" in low:
                    timeout_count += 1.0
                if "retry storm" in low:
                    retry_storm_count += 1.0

    return {
        "total": total,
        "failRate": fail_count / total,
        "timeoutRate": timeout_count / total,
        "retryStormRate": retry_storm_count / total,
    }


def transition_state(
    previous_state: str,
    policy: dict[str, Any],
    rates: dict[str, float],
) -> tuple[str, list[str]]:
    mode = str(policy.get("mode", "learning")).lower()
    thresholds = policy.get("thresholds", {})
    if not isinstance(thresholds, dict):
        thresholds = {}

    issues: list[str] = []
    fail_rate_max = float(thresholds.get("failRateMax", 1.0))
    timeout_rate_max = float(thresholds.get("timeoutRateMax", 1.0))
    retry_storm_max = float(thresholds.get("retryStormAttemptsPerGateMax", 9999))

    fail_rate = float(rates.get("failRate", 0.0))
    timeout_rate = float(rates.get("timeoutRate", 0.0))
    retry_storm_rate = float(rates.get("retryStormRate", 0.0))

    # learning mode never hard-opens the guard; it only reports recommendations.
    if mode == "learning":
        if fail_rate > fail_rate_max:
            issues.append(
                f"learning: failRate {fail_rate:.4f} > configured {fail_rate_max:.4f}"
            )
        if timeout_rate > timeout_rate_max:
            issues.append(
                f"learning: timeoutRate {timeout_rate:.4f} > configured {timeout_rate_max:.4f}"
            )
        if retry_storm_rate > retry_storm_max:
            issues.append(
                f"learning: retryStormRate {retry_storm_rate:.4f} > configured {retry_storm_max:.4f}"
            )
        return previous_state if previous_state else STATE_CLOSED, issues

    if previous_state not in (STATE_CLOSED, STATE_OPEN, STATE_HALF_OPEN):
        previous_state = STATE_CLOSED

    breach = fail_rate > fail_rate_max or timeout_rate > timeout_rate_max
    if breach:
        issues.append(
            f"guard threshold breach: failRate={fail_rate:.4f}, timeoutRate={timeout_rate:.4f}"
        )
        if previous_state == STATE_HALF_OPEN:
            return STATE_OPEN, issues
        return STATE_OPEN, issues

    if previous_state == STATE_OPEN:
        return STATE_HALF_OPEN, issues
    if previous_state == STATE_HALF_OPEN:
        return STATE_CLOSED, issues
    return STATE_CLOSED, issues


def evaluate_runner_guard(
    policy: dict[str, Any],
    history: list[dict[str, Any]],
    previous_state: str,
) -> dict[str, Any]:
    rates = compute_rates(history)
    next_state, issues = transition_state(previous_state, policy, rates)
    return {
        "generatedAt": utc_now_iso(),
        "mode": policy.get("mode", "learning"),
        "previousState": previous_state,
        "state": next_state,
        "rates": rates,
        "issues": issues,
    }


def main() -> int:
    args = parse_args()
    policy_path = Path(args.policy)
    history_path = Path(args.history)
    state_path = Path(args.state)
    output_path = Path(args.output)

    policy = read_json(policy_path)
    history = load_history(history_path)
    previous_state = STATE_CLOSED
    if state_path.exists():
        try:
            state_payload = read_json(state_path)
            prev = state_payload.get("state")
            if isinstance(prev, str):
                previous_state = prev
        except Exception:
            previous_state = STATE_CLOSED

    report = evaluate_runner_guard(policy, history, previous_state)
    write_json(output_path, report)
    write_json(state_path, {"state": report["state"], "updatedAt": report["generatedAt"]})

    if report["state"] == STATE_OPEN and str(policy.get("mode", "")).lower() != "learning":
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
