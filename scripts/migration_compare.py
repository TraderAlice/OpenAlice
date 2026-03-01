#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from gate_common import utc_now_iso, write_json


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Compare baseline and candidate gate verdict outputs."
    )
    parser.add_argument(
        "--repo-root",
        default=".",
        help="Repository root for default verdict lookup.",
    )
    parser.add_argument("--baseline", default=None, help="Baseline verdict JSON path.")
    parser.add_argument("--candidate", default=None, help="Candidate verdict JSON path.")
    parser.add_argument(
        "--output",
        default="data/runtime/gates/migration_compare_report.json",
        help="Comparison report output path.",
    )
    return parser.parse_args()


def read_json(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"{path} must be a JSON object.")
    return payload


def resolve_latest_verdict(repo_root: Path) -> Path:
    candidates = sorted(
        (repo_root / "data/runtime/gates").glob("*/verdict.v2.json"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    if not candidates:
        raise FileNotFoundError(
            "no verdict.v2.json found under data/runtime/gates; provide --baseline/--candidate explicitly"
        )
    return candidates[0]


def validate_verdict_payload(name: str, payload: dict[str, Any]) -> list[str]:
    issues: list[str] = []
    required = {
        "version": str,
        "generatedAt": str,
        "runId": str,
        "result": str,
        "decisionWeight": str,
        "reasonCodes": list,
        "profileHash": str,
        "thresholdsHash": str,
        "statisticsLockHash": str,
        "registryVersion": str,
        "metricVersions": dict,
    }
    for field, expected_type in required.items():
        value = payload.get(field)
        if not isinstance(value, expected_type):
            issues.append(
                f"{name}: field {field!r} must be {expected_type.__name__}, got {type(value).__name__}"
            )

    result = payload.get("result")
    if isinstance(result, str) and result not in {
        "NO_GO",
        "PAPER_ONLY_GO",
        "BLOCKED_WITH_RECOVERY_PLAN",
    }:
        issues.append(f"{name}: result has invalid enum value {result!r}")

    reason_codes = payload.get("reasonCodes")
    if isinstance(reason_codes, list):
        non_string = [item for item in reason_codes if not isinstance(item, str)]
        if non_string:
            issues.append(f"{name}: reasonCodes must contain only strings")

    return issues


def compare_verdicts(
    baseline: dict[str, Any],
    candidate: dict[str, Any],
) -> dict[str, Any]:
    baseline_result = baseline.get("result")
    candidate_result = candidate.get("result")

    baseline_reasons = {
        str(item) for item in baseline.get("reasonCodes", []) if isinstance(item, str)
    }
    candidate_reasons = {
        str(item) for item in candidate.get("reasonCodes", []) if isinstance(item, str)
    }

    only_baseline = sorted(baseline_reasons - candidate_reasons)
    only_candidate = sorted(candidate_reasons - baseline_reasons)

    return {
        "sameResult": baseline_result == candidate_result,
        "baselineResult": baseline_result,
        "candidateResult": candidate_result,
        "reasonCodes": {
            "baselineCount": len(baseline_reasons),
            "candidateCount": len(candidate_reasons),
            "onlyInBaseline": only_baseline,
            "onlyInCandidate": only_candidate,
        },
        "profileHashChanged": baseline.get("profileHash") != candidate.get("profileHash"),
        "thresholdsHashChanged": baseline.get("thresholdsHash") != candidate.get("thresholdsHash"),
        "statisticsLockHashChanged": baseline.get("statisticsLockHash") != candidate.get("statisticsLockHash"),
    }


def main() -> int:
    args = parse_args()
    repo_root = Path(args.repo_root).resolve()
    try:
        default_verdict = resolve_latest_verdict(repo_root)
    except FileNotFoundError:
        default_verdict = repo_root / "data/runtime/gates/latest/verdict.v2.json"

    baseline_path = (
        Path(args.baseline).resolve()
        if isinstance(args.baseline, str) and args.baseline.strip()
        else default_verdict
    )
    candidate_path = (
        Path(args.candidate).resolve()
        if isinstance(args.candidate, str) and args.candidate.strip()
        else default_verdict
    )
    output_path = Path(args.output)

    report: dict[str, Any] = {
        "version": "v1",
        "generatedAt": utc_now_iso(),
        "baselinePath": str(baseline_path.resolve()),
        "candidatePath": str(candidate_path.resolve()),
    }

    try:
        baseline = read_json(baseline_path)
        candidate = read_json(candidate_path)
    except Exception as exc:  # noqa: BLE001
        report["valid"] = False
        report["errors"] = [f"input_load_error: {exc}"]
        write_json(output_path, report)
        print(json.dumps(report, ensure_ascii=False))
        return 2

    validation_errors = [
        *validate_verdict_payload("baseline", baseline),
        *validate_verdict_payload("candidate", candidate),
    ]
    if validation_errors:
        report["valid"] = False
        report["errors"] = validation_errors
        write_json(output_path, report)
        print(json.dumps(report, ensure_ascii=False))
        return 2

    comparison = compare_verdicts(baseline, candidate)
    report["valid"] = True
    report["errors"] = []
    report["comparison"] = comparison
    write_json(output_path, report)
    print(json.dumps(report, ensure_ascii=False))

    if comparison["sameResult"] and not comparison["reasonCodes"]["onlyInCandidate"]:
        return 0
    return 2


if __name__ == "__main__":
    sys.exit(main())
