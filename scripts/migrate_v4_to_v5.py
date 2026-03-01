#!/usr/bin/env python3
from __future__ import annotations

import argparse
import copy
import json
import sys
from pathlib import Path
from typing import Any

from gate_common import utc_now_iso, write_json


REASON_CODE_ALIAS = {
    "LEAKAGE_DETECTED": "HARD_LEAKAGE_DETECTED",
    "SOURCE_HEALTH_FAIL": "HARD_SOURCE_HEALTH_FAIL",
    "BUDGET_HARD_CAP_HIT": "HARD_BUDGET_HARD_CAP_HIT",
    "DATASET_SNAPSHOT_DRIFT": "HARD_DATASET_SNAPSHOT_DRIFT",
    "SECRETS_HYGIENE_FAIL": "HARD_SECRETS_HYGIENE_FAIL",
    "GATE_RUNNER_SELF_HEALTH_FAIL": "HARD_GATE_RUNNER_SELF_HEALTH_FAIL",
    "CLOCK_DRIFT_EXCEEDED": "HARD_CLOCK_DRIFT_EXCEEDED",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Migrate legacy V4-style gate profile into V5.1.1 profile schema."
    )
    parser.add_argument(
        "--input",
        default=None,
        help="Legacy profile/config JSON path. Defaults to --base-profile when omitted.",
    )
    parser.add_argument(
        "--base-profile",
        default="data/config/profiles/profile_m0_72h.v5_1.yaml",
        help="Base V5 profile to clone and patch.",
    )
    parser.add_argument(
        "--output",
        default="data/config/profiles/profile_m0_72h.v5_1.migrated.yaml",
        help="Migrated profile output path.",
    )
    parser.add_argument(
        "--report-output",
        default="data/runtime/gates/migration_report.v1.json",
        help="Machine-readable migration report.",
    )
    parser.add_argument(
        "--conversion-log-output",
        default="data/runtime/gates/config_conversion_log.v1.json",
        help="Machine-readable value conversion log.",
    )
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def read_json(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"{path} must be a JSON object.")
    return payload


def get_path(payload: dict[str, Any], path: str) -> Any:
    cursor: Any = payload
    for part in path.split("."):
        if not isinstance(cursor, dict):
            return None
        cursor = cursor.get(part)
    return cursor


def set_path(payload: dict[str, Any], path: str, value: Any) -> None:
    parts = path.split(".")
    cursor: dict[str, Any] = payload
    for part in parts[:-1]:
        next_value = cursor.get(part)
        if not isinstance(next_value, dict):
            next_value = {}
            cursor[part] = next_value
        cursor = next_value
    cursor[parts[-1]] = value


def migrate_legacy_to_v5(
    *,
    legacy: dict[str, Any],
    base_profile: dict[str, Any],
) -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]], list[str]]:
    target = copy.deepcopy(base_profile)
    mappings: list[dict[str, Any]] = []
    conversions: list[dict[str, Any]] = []
    warnings: list[str] = []

    mapping_rules = [
        ("strategy.pbo_max", ["strategy.pbo_max", "thresholds.meanPboMax"]),
        (
            "strategy.dsr_probability_min",
            ["strategy.dsr_probability_min", "thresholds.meanDsrProbabilityMin"],
        ),
        ("strategy.fdr_q_max", ["strategy.fdr_q_max", "thresholds.fdrQMax"]),
        ("strategy.min_trades", ["strategy.min_trades", "thresholds.minTrades"]),
        (
            "strategy.min_backtest_days",
            ["strategy.min_backtest_days", "thresholds.minBacktestDays"],
        ),
        (
            "strategy.min_effective_observations",
            ["strategy.min_effective_observations", "thresholds.minEffectiveObservations"],
        ),
        (
            "strategy.stress_net_trim10_decline_max",
            [
                "strategy.stress_net_trim10_decline_max",
                "thresholds.stressNetTrim10DeclineMax",
            ],
        ),
        ("g0.clock_drift_ms_max", ["g0.clock_drift_ms_max", "gates.g0.clockDriftMsMax"]),
        ("validation_mode", ["validation_mode", "validation.mode"]),
    ]

    for target_path, legacy_candidates in mapping_rules:
        found = False
        for source_path in legacy_candidates:
            value = get_path(legacy, source_path)
            if value is None:
                continue
            set_path(target, target_path, value)
            mappings.append(
                {
                    "from": source_path,
                    "to": target_path,
                    "status": "mapped",
                    "note": "direct copy",
                }
            )
            found = True
            break
        if not found:
            mappings.append(
                {
                    "from": "|".join(legacy_candidates),
                    "to": target_path,
                    "status": "defaulted",
                    "note": "kept value from base profile",
                }
            )

    legacy_reason_codes = get_path(legacy, "hard_block_reason_codes_g3")
    if isinstance(legacy_reason_codes, list):
        normalized: list[str] = []
        for item in legacy_reason_codes:
            if not isinstance(item, str):
                continue
            canonical = REASON_CODE_ALIAS.get(item, item)
            normalized.append(canonical)
            if canonical != item:
                conversions.append(
                    {
                        "field": "hard_block_reason_codes_g3",
                        "originalValue": item,
                        "convertedValue": canonical,
                        "ruleId": "reason_code_alias_v1",
                        "severity": "warning",
                    }
                )
        set_path(target, "hard_block_reason_codes_g3", normalized)
        mappings.append(
            {
                "from": "hard_block_reason_codes_g3",
                "to": "hard_block_reason_codes_g3",
                "status": "mapped",
                "note": "reason codes normalized to canonical V5 names",
            }
        )
    else:
        mappings.append(
            {
                "from": "hard_block_reason_codes_g3",
                "to": "hard_block_reason_codes_g3",
                "status": "defaulted",
                "note": "kept base profile canonical reason codes",
            }
        )

    known_top_level = {
        "strategy",
        "thresholds",
        "g0",
        "gates",
        "validation_mode",
        "validation",
        "hard_block_reason_codes_g3",
    }
    unknown_fields = sorted(set(legacy.keys()) - known_top_level)
    if unknown_fields:
        warnings.append(
            "unknown top-level legacy fields were ignored: " + ", ".join(unknown_fields)
        )
        for name in unknown_fields:
            mappings.append(
                {
                    "from": name,
                    "to": "",
                    "status": "dropped",
                    "note": "no mapping rule",
                }
            )

    return target, mappings, conversions, warnings


def main() -> int:
    args = parse_args()
    base_path = Path(args.base_profile)
    input_path = Path(args.input) if args.input else base_path
    output_path = Path(args.output)
    report_output_path = Path(args.report_output)
    conversion_output_path = Path(args.conversion_log_output)

    legacy = read_json(input_path)
    base_profile = read_json(base_path)
    migrated, mappings, conversion_entries, warnings = migrate_legacy_to_v5(
        legacy=legacy,
        base_profile=base_profile,
    )

    report = {
        "version": "v1",
        "generatedAt": utc_now_iso(),
        "sourcePath": str(input_path.resolve()),
        "targetPath": str(output_path.resolve()),
        "mappings": mappings,
        "warnings": warnings,
    }
    conversion_log = {
        "version": "v1",
        "generatedAt": utc_now_iso(),
        "entries": conversion_entries,
    }

    if not args.dry_run:
        write_json(output_path, migrated)
    write_json(report_output_path, report)
    write_json(conversion_output_path, conversion_log)

    print(
        json.dumps(
            {
                "dryRun": args.dry_run,
                "output": str(output_path.resolve()),
                "report": str(report_output_path.resolve()),
                "conversionLog": str(conversion_output_path.resolve()),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
