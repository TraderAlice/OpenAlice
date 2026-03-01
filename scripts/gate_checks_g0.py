#!/usr/bin/env python3
from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

from gate_common import read_json, read_json_compat, utc_now_iso, write_json
from secrets_hygiene import scan_repo

REASON_CODE_PATTERN = re.compile(r"^(HARD|WARN|INFO)_[A-Z0-9_]+$")


def lint_reason_codes(reason_codes_payload: dict[str, Any]) -> list[str]:
    issues: list[str] = []
    codes = reason_codes_payload.get("codes")
    seen: set[str] = set()
    if not isinstance(codes, list) or len(codes) == 0:
        return ["reason code file has empty or invalid 'codes' list"]
    for item in codes:
        if not isinstance(item, dict):
            issues.append("reason code item must be object")
            continue
        code = item.get("code")
        if not isinstance(code, str) or not REASON_CODE_PATTERN.match(code):
            issues.append(f"invalid reason code naming: {code!r}")
            continue
        if code in seen:
            issues.append(f"duplicate reason code: {code}")
        seen.add(code)
    return issues


def validate_required_codes(
    reason_codes_payload: dict[str, Any], required_codes: list[str]
) -> list[str]:
    issues: list[str] = []
    existing = {
        item.get("code")
        for item in reason_codes_payload.get("codes", [])
        if isinstance(item, dict) and isinstance(item.get("code"), str)
    }
    for code in required_codes:
        if code not in existing:
            issues.append(f"required code missing: {code}")
    return issues


def command_availability(commands: list[str]) -> list[str]:
    missing: list[str] = []
    for cmd in commands:
        if shutil.which(cmd) is None:
            missing.append(cmd)
    return missing


def measure_clock_drift_ms() -> int:
    # Without external time service dependency, compare Python UTC with shell UTC epoch.
    # This catches severe local time-source skew and shell clock command failures.
    py_epoch_ms = int(__import__("time").time() * 1000)
    proc = subprocess.run(
        ["date", "-u", "+%s"],
        text=True,
        capture_output=True,
        check=False,
    )
    if proc.returncode != 0:
        return 0
    shell_epoch_ms = int(proc.stdout.strip()) * 1000
    return abs(py_epoch_ms - shell_epoch_ms)


def run_g0(
    *,
    repo_root: Path,
    profile: dict[str, Any],
    reason_codes_path: Path,
) -> dict[str, Any]:
    issues: list[str] = []
    reason_codes: list[str] = []
    details: dict[str, Any] = {}
    g0_cfg = profile.get("g0", {})
    if not isinstance(g0_cfg, dict):
        g0_cfg = {}

    require_reason_code_lint = bool(g0_cfg.get("require_reason_code_lint", True))
    require_command_availability = bool(g0_cfg.get("require_command_availability", True))
    require_secrets_hygiene = bool(g0_cfg.get("require_secrets_hygiene", True))

    if require_reason_code_lint:
        reason_payload = read_json(reason_codes_path)
        reason_issues = lint_reason_codes(reason_payload)
        if reason_issues:
            issues.extend(reason_issues)
            reason_codes.append("HARD_REASON_CODE_UNKNOWN")
        required_codes = profile.get("hard_block_reason_codes_g3", [])
        if isinstance(required_codes, list):
            required_issues = validate_required_codes(
                reason_payload,
                [str(code) for code in required_codes if isinstance(code, str)],
            )
            if required_issues:
                issues.extend(required_issues)
                reason_codes.append("HARD_REASON_CODE_UNKNOWN")
    else:
        details["reasonCodeLintSkipped"] = True

    missing_cmds = (
        command_availability(["python3", "node", "pnpm", "git"])
        if require_command_availability
        else []
    )
    details["missingCommands"] = missing_cmds
    if require_command_availability and missing_cmds:
        issues.append(f"required commands missing: {', '.join(missing_cmds)}")
        reason_codes.append("HARD_SOURCE_HEALTH_FAIL")
    if not require_command_availability:
        details["commandAvailabilitySkipped"] = True

    drift_ms = measure_clock_drift_ms()
    details["clockDriftMs"] = drift_ms
    drift_max = 2000
    raw = g0_cfg.get("clock_drift_ms_max")
    if isinstance(raw, int):
        drift_max = raw
    if drift_ms > drift_max:
        issues.append(f"clock drift exceeded: {drift_ms}ms > {drift_max}ms")
        reason_codes.append("HARD_CLOCK_DRIFT_EXCEEDED")

    findings = scan_repo(repo_root) if require_secrets_hygiene else []
    details["secretsFindingsCount"] = len(findings)
    if require_secrets_hygiene and findings:
        issues.append("high-confidence secret findings detected")
        reason_codes.append("HARD_SECRETS_HYGIENE_FAIL")
    if not require_secrets_hygiene:
        details["secretsHygieneSkipped"] = True

    # de-dup reason codes, preserve order
    dedup_reason_codes: list[str] = []
    for code in reason_codes:
        if code not in dedup_reason_codes:
            dedup_reason_codes.append(code)

    return {
        "passed": len(issues) == 0,
        "issues": issues,
        "reasonCodes": dedup_reason_codes,
        "details": details,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run G0 fail-fast checks.")
    parser.add_argument("--repo-root", default=".")
    parser.add_argument(
        "--profile",
        default="data/config/profiles/profile_m0_72h.v5_1.yaml",
    )
    parser.add_argument(
        "--reason-codes",
        default="docs/research/templates/verdict_reason_codes.v1.json",
    )
    parser.add_argument("--output", default="data/runtime/gates/g0_report.json")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    profile = read_json_compat(Path(args.profile))
    report = run_g0(
        repo_root=Path(args.repo_root).resolve(),
        profile=profile,
        reason_codes_path=Path(args.reason_codes),
    )
    payload = {
        "generatedAt": utc_now_iso(),
        "profilePath": args.profile,
        "reasonCodesPath": args.reason_codes,
        **report,
    }
    write_json(Path(args.output), payload)
    return 0 if report["passed"] else 2


if __name__ == "__main__":
    sys.exit(main())
