#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

EXIT_OK = 0
EXIT_NO_GO = 2
EXIT_TOOL_ERROR = 3

REASON_CODE_PATTERN = re.compile(r"^(HARD|WARN|INFO)_[A-Z0-9_]+$")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate decision_packet and emit machine-readable verdict."
    )
    parser.add_argument("--packet-dir", default="decision_packet")
    parser.add_argument("--evidence-pack", default=None)
    parser.add_argument(
        "--reason-codes",
        default="docs/research/templates/verdict_reason_codes.v1.json",
    )
    parser.add_argument(
        "--freeze-manifest",
        default="docs/research/freeze_manifest.json",
    )
    parser.add_argument(
        "--environment-report",
        default="data/runtime/environment_verify_report.json",
    )
    parser.add_argument(
        "--idempotency-report",
        default="decision_packet/idempotency_report.json",
    )
    parser.add_argument(
        "--require-idempotency",
        action="store_true",
        help="Require idempotency report to be present and passed.",
    )
    parser.add_argument("--output", default=None)
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


def read_json(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"{path} must be a JSON object.")
    return data


def parse_iso(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def ensure_list_of_str(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    out: list[str] = []
    for item in value:
        if isinstance(item, str):
            out.append(item)
    return out


def is_safe_template_artifact_path(value: str) -> bool:
    normalized = value.replace("\\", "/").strip()
    if not normalized:
        return False
    if normalized.startswith("/"):
        return False
    if len(normalized) >= 2 and normalized[1] == ":" and normalized[0].isalpha():
        return False
    parts = [part for part in normalized.split("/") if part not in ("", ".")]
    if not parts:
        return False
    return ".." not in parts


def validate_artifact_provenance(
    payload: Any, artifact_keys: list[str]
) -> list[str]:
    errors: list[str] = []
    if not isinstance(payload, dict):
        return ["artifactProvenance must be an object."]

    required_fields = ("sourcePath", "sha256", "generatedAt", "generatedBy", "dataWindow")
    for key in artifact_keys:
        item = payload.get(key)
        if not isinstance(item, dict):
            errors.append(f"artifactProvenance.{key} missing or not object")
            continue
        for field in required_fields:
            value = item.get(field)
            if field == "dataWindow":
                if isinstance(value, str) and value.strip():
                    continue
                if isinstance(value, dict) and len(value) > 0:
                    continue
                errors.append(f"artifactProvenance.{key}.{field} missing")
                continue
            if not isinstance(value, str) or not value.strip():
                errors.append(f"artifactProvenance.{key}.{field} missing")
    return errors


def validate_reason_codes_file(
    payload: dict[str, Any],
) -> tuple[set[str], dict[str, str]]:
    canonical: set[str] = set()
    deprecated: dict[str, str] = {}
    codes = payload.get("codes")
    if not isinstance(codes, list) or len(codes) == 0:
        raise ValueError("reason codes file has empty codes list.")
    for item in codes:
        if not isinstance(item, dict):
            raise ValueError("reason code item must be object.")
        code = item.get("code")
        if not isinstance(code, str) or not REASON_CODE_PATTERN.match(code):
            raise ValueError(f"invalid canonical reason code: {code!r}")
        canonical.add(code)
    aliases = payload.get("deprecatedAliases", [])
    if isinstance(aliases, list):
        for alias_item in aliases:
            if not isinstance(alias_item, dict):
                continue
            alias = alias_item.get("alias")
            canonical_name = alias_item.get("canonical")
            if isinstance(alias, str) and isinstance(canonical_name, str):
                deprecated[alias] = canonical_name
    return canonical, deprecated


def add_reason(reason_list: list[str], code: str) -> None:
    if code not in reason_list:
        reason_list.append(code)


def collect_threshold_results(
    thresholds: dict[str, Any],
    measured: dict[str, Any],
) -> list[dict[str, Any]]:
    rules = [
        ("transferPassRatioRolling14dMin", "transferPassRatioRolling14d", ">="),
        ("winnerEligibleRatioRolling14dMin", "winnerEligibleRatioRolling14d", ">="),
        ("meanPboMax", "meanPbo", "<="),
        ("meanDsrProbabilityMin", "meanDsrProbability", ">="),
        ("fdrQMax", "fdrQ", "<="),
        ("quoteAgeP95MsMax", "quoteAgeP95Ms", "<="),
        ("decisionToSubmitP95MsMax", "decisionToSubmitP95Ms", "<="),
        ("decisionToFirstFillP95MsMax", "decisionToFirstFillP95Ms", "<="),
        ("releaseGateStatusAgeHoursMax", "releaseGateStatusAgeHours", "<="),
    ]
    results: list[dict[str, Any]] = []
    for threshold_key, measured_key, op in rules:
        threshold_value = thresholds.get(threshold_key)
        measured_value = measured.get(measured_key)
        if not isinstance(threshold_value, (int, float)):
            continue
        if not isinstance(measured_value, (int, float)):
            results.append(
                {
                    "thresholdKey": threshold_key,
                    "measuredKey": measured_key,
                    "operator": op,
                    "threshold": threshold_value,
                    "measured": measured_value,
                    "passed": False,
                    "missingMeasured": True,
                }
            )
            continue
        if op == ">=":
            passed = measured_value >= threshold_value
        else:
            passed = measured_value <= threshold_value
        results.append(
            {
                "thresholdKey": threshold_key,
                "measuredKey": measured_key,
                "operator": op,
                "threshold": threshold_value,
                "measured": measured_value,
                "passed": passed,
                "missingMeasured": False,
            }
        )
    return results


def validate_freeze_manifest_basics(payload: dict[str, Any]) -> list[str]:
    failures: list[str] = []
    if payload.get("manifestVersion") != "v1":
        failures.append("manifestVersion must be v1")
    versions = payload.get("versions")
    if not isinstance(versions, dict):
        failures.append("versions missing")
    else:
        for key in ("sm", "stats", "hash", "evidence"):
            value = versions.get(key)
            if not isinstance(value, str) or not value.strip():
                failures.append(f"versions.{key} missing")
    raci = payload.get("raciSnapshot")
    if not isinstance(raci, dict):
        failures.append("raciSnapshot missing")
    else:
        for stream in ("E7", "E8", "E9"):
            item = raci.get(stream)
            if not isinstance(item, dict):
                failures.append(f"raciSnapshot.{stream} missing")
                continue
            for role in ("dri", "backup", "nightOnCall"):
                identity = item.get(role)
                if not isinstance(identity, str) or not identity.strip():
                    failures.append(f"raciSnapshot.{stream}.{role} missing")
    commander = payload.get("incidentCommander")
    if not isinstance(commander, str) or not commander.strip():
        failures.append("incidentCommander missing")
    allowlist = payload.get("l2OverrideAllowlist")
    if not isinstance(allowlist, list) or len(allowlist) == 0:
        failures.append("l2OverrideAllowlist missing")
    return failures


def resolve_artifact_paths(
    packet_dir: Path,
    artifacts: dict[str, Any],
) -> dict[str, Path]:
    resolved: dict[str, Path] = {}
    packet_name = packet_dir.name
    for key, raw in artifacts.items():
        if not isinstance(raw, str):
            continue
        raw_path = Path(raw)
        candidates: list[Path] = []
        if raw_path.is_absolute():
            candidates.append(raw_path)
        else:
            rel = raw_path
            if rel.parts and rel.parts[0] == packet_name:
                rel = Path(*rel.parts[1:]) if len(rel.parts) > 1 else Path(rel.name)
            candidates.append(packet_dir / rel)
            candidates.append(Path.cwd() / raw_path)
            candidates.append(packet_dir / raw_path.name)
        chosen = next(
            (candidate for candidate in candidates if candidate.exists()), candidates[0]
        )
        resolved[key] = chosen
    return resolved


def main() -> int:
    args = parse_args()
    packet_dir = Path(args.packet_dir)
    evidence_pack_path = (
        Path(args.evidence_pack)
        if args.evidence_pack
        else packet_dir / "evidence_pack.json"
    )
    reason_codes_path = Path(args.reason_codes)
    freeze_manifest_path = Path(args.freeze_manifest)
    env_report_path = Path(args.environment_report)
    idempotency_report_path = Path(args.idempotency_report)
    output_path = Path(args.output) if args.output else packet_dir / "verdict.json"

    try:
        if args.simulate_tool_error:
            raise RuntimeError("simulated tool error")

        reasons_hard: list[str] = []
        reasons_warn: list[str] = []
        reasons_info: list[str] = []
        checks: list[dict[str, Any]] = []

        if not evidence_pack_path.exists():
            add_reason(reasons_hard, "HARD_MISSING_ARTIFACT")
            checks.append(
                {
                    "name": "evidence_pack_exists",
                    "passed": False,
                    "detail": f"missing: {evidence_pack_path}",
                }
            )
            evidence_pack = {}
        else:
            evidence_pack = read_json(evidence_pack_path)
            checks.append({"name": "evidence_pack_exists", "passed": True})

        reason_codes_payload = read_json(reason_codes_path)
        canonical_codes, deprecated_aliases = validate_reason_codes_file(
            reason_codes_payload
        )

        for required_code in (
            "HARD_MISSING_ARTIFACT",
            "HARD_ARTIFACT_PROVENANCE_MISSING",
            "HARD_TEMPLATE_PATH_UNSAFE",
            "HARD_ENV_MISMATCH",
            "HARD_IDEMPOTENCY_FAILED",
            "HARD_REASON_CODE_UNKNOWN",
            "HARD_FREEZE_MANIFEST_INVALID",
            "HARD_HARD_GATE_CHECK_FAILED",
            "HARD_METRIC_MISSING",
            "HARD_THRESHOLD_BREACH",
            "HARD_RELEASE_GATE_BLOCKED",
            "HARD_RELEASE_GATE_EXPIRED",
            "HARD_CONSTRAINTS_INVALID",
            "WARN_CONSTRAINTS_PRESENT",
            "INFO_VALIDATION_PASSED",
        ):
            if required_code not in canonical_codes:
                raise ValueError(
                    f"reason code missing in canonical list: {required_code}"
                )

        freeze_failures: list[str] = []
        if not freeze_manifest_path.exists():
            freeze_failures.append(f"missing: {freeze_manifest_path}")
        else:
            freeze_manifest = read_json(freeze_manifest_path)
            freeze_failures.extend(validate_freeze_manifest_basics(freeze_manifest))
        if freeze_failures:
            add_reason(reasons_hard, "HARD_FREEZE_MANIFEST_INVALID")
        checks.append(
            {
                "name": "freeze_manifest_valid",
                "passed": len(freeze_failures) == 0,
                "detail": freeze_failures,
            }
        )

        env_mismatch_details: list[str] = []
        if env_report_path.exists():
            env_report = read_json(env_report_path)
            if env_report.get("passed") is not True:
                add_reason(reasons_hard, "HARD_ENV_MISMATCH")
                mismatches = env_report.get("mismatches")
                if isinstance(mismatches, list):
                    env_mismatch_details.extend(str(item) for item in mismatches)
                else:
                    env_mismatch_details.append("environment report indicates mismatch")
        checks.append(
            {
                "name": "environment_lock_status",
                "passed": len(env_mismatch_details) == 0,
                "detail": env_mismatch_details,
            }
        )

        artifacts_raw = evidence_pack.get("artifacts", {})
        artifacts = artifacts_raw if isinstance(artifacts_raw, dict) else {}
        unsafe_artifact_paths: list[str] = []
        for key, raw in artifacts.items():
            if not isinstance(raw, str) or not is_safe_template_artifact_path(raw):
                unsafe_artifact_paths.append(f"{key}={raw!r}")
        if unsafe_artifact_paths:
            add_reason(reasons_hard, "HARD_TEMPLATE_PATH_UNSAFE")
        checks.append(
            {
                "name": "template_artifact_paths_safe",
                "passed": len(unsafe_artifact_paths) == 0,
                "detail": unsafe_artifact_paths,
            }
        )

        resolved_artifacts = resolve_artifact_paths(packet_dir, artifacts)
        required_artifacts = [
            "manifest",
            "evidencePack",
            "protocolSpec",
            "protocolHashFile",
            "comparabilityReport",
            "championRegistrySnapshot",
            "releaseGateStatus",
            "offlineMetrics",
            "liveShadowMetrics14d",
            "stateMachineLog",
            "decisionMarkdown",
        ]
        provenance_required_artifacts = [
            key for key in required_artifacts if key not in ("manifest", "evidencePack")
        ]
        missing_artifacts: list[str] = []
        for key in required_artifacts:
            path = resolved_artifacts.get(key)
            if not path or not path.exists():
                missing_artifacts.append(key)
        if missing_artifacts:
            add_reason(reasons_hard, "HARD_MISSING_ARTIFACT")
        checks.append(
            {
                "name": "required_artifacts_present",
                "passed": len(missing_artifacts) == 0,
                "detail": missing_artifacts,
            }
        )

        provenance_errors = validate_artifact_provenance(
            evidence_pack.get("artifactProvenance"),
            provenance_required_artifacts,
        )
        if provenance_errors:
            add_reason(reasons_hard, "HARD_ARTIFACT_PROVENANCE_MISSING")
        checks.append(
            {
                "name": "artifact_provenance_valid",
                "passed": len(provenance_errors) == 0,
                "detail": provenance_errors,
            }
        )

        decision = evidence_pack.get("decision", {})
        if not isinstance(decision, dict):
            decision = {}
        existing_reason_codes = ensure_list_of_str(decision.get("verdictReasonCodes"))
        for code in existing_reason_codes:
            if code in deprecated_aliases:
                add_reason(reasons_hard, "HARD_REASON_CODE_UNKNOWN")
                checks.append(
                    {
                        "name": "reason_code_deprecated_alias",
                        "passed": False,
                        "detail": f"{code} is deprecated, use {deprecated_aliases[code]}",
                    }
                )
                continue
            if code not in canonical_codes:
                add_reason(reasons_hard, "HARD_REASON_CODE_UNKNOWN")
                checks.append(
                    {
                        "name": "reason_code_unknown",
                        "passed": False,
                        "detail": code,
                    }
                )

        hard_gate_checks = evidence_pack.get("hardGateChecks")
        hard_gate_failed: list[str] = []
        if isinstance(hard_gate_checks, list):
            for item in hard_gate_checks:
                if not isinstance(item, dict):
                    continue
                if item.get("passed") is not True:
                    name = item.get("name", "unknown_hard_gate")
                    hard_gate_failed.append(str(name))
        if hard_gate_failed:
            add_reason(reasons_hard, "HARD_HARD_GATE_CHECK_FAILED")
        checks.append(
            {
                "name": "hard_gate_checks",
                "passed": len(hard_gate_failed) == 0,
                "detail": hard_gate_failed,
            }
        )

        idempotency_details: list[str] = []
        idempotency_passed = True
        if idempotency_report_path.exists():
            idempotency_payload = read_json(idempotency_report_path)
            idempotency_passed = idempotency_payload.get("passed") is True
            if not idempotency_passed:
                idempotency_details.append("idempotency report indicates failure")
                diffs = idempotency_payload.get("differences")
                if isinstance(diffs, list):
                    idempotency_details.extend(str(item) for item in diffs)
        elif args.require_idempotency:
            idempotency_passed = False
            idempotency_details.append(
                f"idempotency report missing: {idempotency_report_path}"
            )
        if not idempotency_passed:
            add_reason(reasons_hard, "HARD_IDEMPOTENCY_FAILED")
        checks.append(
            {
                "name": "decision_packet_idempotency",
                "passed": idempotency_passed,
                "detail": idempotency_details,
            }
        )

        release_status_path = resolved_artifacts.get("releaseGateStatus")
        release_status_present = bool(
            release_status_path and release_status_path.exists()
        )
        release_age_hours: float | None = None
        release_details: list[str] = []
        if release_status_present and release_status_path is not None:
            release_payload = read_json(release_status_path)
            allow_live = release_payload.get("allowLiveTrading")
            if allow_live is False:
                add_reason(reasons_hard, "HARD_RELEASE_GATE_BLOCKED")
                release_details.append("allowLiveTrading=false")

            generated_at = parse_iso(release_payload.get("generatedAt"))
            if generated_at:
                release_age_hours = (
                    datetime.now(timezone.utc) - generated_at.astimezone(timezone.utc)
                ).total_seconds() / 3600

            expires_at = parse_iso(release_payload.get("expiresAt"))
            if expires_at and datetime.now(timezone.utc) > expires_at.astimezone(
                timezone.utc
            ):
                add_reason(reasons_hard, "HARD_RELEASE_GATE_EXPIRED")
                release_details.append("expiresAt has passed")
        else:
            release_details.append("release status file missing")
        checks.append(
            {
                "name": "release_gate_status",
                "passed": release_status_present
                and "HARD_RELEASE_GATE_BLOCKED" not in reasons_hard
                and "HARD_RELEASE_GATE_EXPIRED" not in reasons_hard,
                "detail": release_details,
            }
        )

        thresholds = evidence_pack.get("thresholds", {})
        measured = evidence_pack.get("measured", {})
        if isinstance(measured, dict) and release_age_hours is not None:
            measured["releaseGateStatusAgeHours"] = release_age_hours
        if not isinstance(thresholds, dict):
            thresholds = {}
        if not isinstance(measured, dict):
            measured = {}
        threshold_results = collect_threshold_results(thresholds, measured)
        metric_missing = [item for item in threshold_results if item["missingMeasured"]]
        metric_failed = [
            item
            for item in threshold_results
            if not item["passed"] and not item["missingMeasured"]
        ]
        if metric_missing:
            add_reason(reasons_hard, "HARD_METRIC_MISSING")
        if metric_failed:
            add_reason(reasons_hard, "HARD_THRESHOLD_BREACH")
        if any(
            item["thresholdKey"] == "releaseGateStatusAgeHoursMax"
            and not item["missingMeasured"]
            and not item["passed"]
            for item in threshold_results
        ):
            add_reason(reasons_hard, "HARD_RELEASE_GATE_EXPIRED")
        checks.append(
            {
                "name": "thresholds",
                "passed": len(metric_failed) == 0,
                "detail": threshold_results,
            }
        )

        constraints = ensure_list_of_str(
            decision.get("constraints")
            if isinstance(decision.get("constraints"), list)
            else decision.get("constraintsIfGo")
        )
        rollback_triggers = ensure_list_of_str(decision.get("rollbackTriggers"))
        expiry_at = decision.get("expiryAt")
        max_duration = decision.get("maxDurationHours")

        has_constraints = len(constraints) > 0
        if has_constraints:
            add_reason(reasons_warn, "WARN_CONSTRAINTS_PRESENT")
            expiry_ok = parse_iso(expiry_at) is not None
            rollback_ok = len(rollback_triggers) > 0
            duration_ok = isinstance(max_duration, (int, float)) and max_duration > 0
            if not (expiry_ok and rollback_ok and duration_ok):
                add_reason(reasons_hard, "HARD_CONSTRAINTS_INVALID")
                checks.append(
                    {
                        "name": "constraints_integrity",
                        "passed": False,
                        "detail": {
                            "expiryOk": expiry_ok,
                            "rollbackOk": rollback_ok,
                            "durationOk": duration_ok,
                        },
                    }
                )
            else:
                checks.append(
                    {
                        "name": "constraints_integrity",
                        "passed": True,
                    }
                )

        verdict = "NO_GO"
        if not reasons_hard:
            verdict = "GO_WITH_CONSTRAINTS" if has_constraints else "GO"
        if verdict == "GO" and not reasons_warn:
            add_reason(reasons_info, "INFO_VALIDATION_PASSED")

        output_reason_codes: list[str] = []
        for bucket in (reasons_hard, reasons_warn, reasons_info):
            for code in bucket:
                if code not in canonical_codes:
                    add_reason(reasons_hard, "HARD_REASON_CODE_UNKNOWN")
                    continue
                add_reason(output_reason_codes, code)

        output_payload = {
            "version": "v1",
            "generatedAt": utc_now_iso(),
            "packetDir": str(packet_dir),
            "evidencePackPath": str(evidence_pack_path),
            "verdict": verdict,
            "ciStatus": {
                "GO": "passed",
                "GO_WITH_CONSTRAINTS": "passed_with_constraints",
                "NO_GO": "failed",
            }[verdict],
            "reasonCodes": {
                "all": output_reason_codes,
                "hard": reasons_hard,
                "warn": reasons_warn,
                "info": reasons_info,
            },
            "checks": checks,
            "thresholdResults": threshold_results,
        }

        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(
            f"{json.dumps(output_payload, ensure_ascii=False, indent=2)}\n",
            encoding="utf-8",
        )

        print(
            json.dumps(
                {
                    "verdict": verdict,
                    "output": str(output_path),
                    "reasonCodes": output_reason_codes,
                },
                ensure_ascii=False,
            )
        )
        return EXIT_OK if verdict != "NO_GO" else EXIT_NO_GO
    except (json.JSONDecodeError, ValueError) as exc:
        fallback = {
            "version": "v1",
            "generatedAt": utc_now_iso(),
            "verdict": "NO_GO",
            "ciStatus": "failed",
            "reasonCodes": {
                "all": ["HARD_REASON_CODE_UNKNOWN"],
                "hard": ["HARD_REASON_CODE_UNKNOWN"],
                "warn": [],
                "info": [],
            },
            "checks": [{"name": "input_invalid", "passed": False, "detail": str(exc)}],
        }
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(
            f"{json.dumps(fallback, ensure_ascii=False, indent=2)}\n",
            encoding="utf-8",
        )
        print(
            json.dumps(
                {"status": "invalid_input", "message": str(exc)},
                ensure_ascii=False,
            ),
            file=sys.stderr,
        )
        return EXIT_NO_GO
    except Exception as exc:  # noqa: BLE001
        fallback = {
            "version": "v1",
            "generatedAt": utc_now_iso(),
            "verdict": "NO_GO",
            "ciStatus": "error",
            "reasonCodes": {
                "all": ["HARD_REASON_CODE_UNKNOWN"],
                "hard": ["HARD_REASON_CODE_UNKNOWN"],
                "warn": [],
                "info": [],
            },
            "checks": [{"name": "tool_error", "passed": False, "detail": str(exc)}],
        }
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(
            f"{json.dumps(fallback, ensure_ascii=False, indent=2)}\n",
            encoding="utf-8",
        )
        print(
            json.dumps(
                {"status": "tool_error", "message": str(exc)},
                ensure_ascii=False,
            ),
            file=sys.stderr,
        )
        return EXIT_TOOL_ERROR


if __name__ == "__main__":
    sys.exit(main())
