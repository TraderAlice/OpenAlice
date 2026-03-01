#!/usr/bin/env python3
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any

try:
    from jsonschema import Draft202012Validator
except Exception:  # noqa: BLE001
    Draft202012Validator = None  # type: ignore[assignment]


EXIT_OK = 0
EXIT_MISSING_ARTIFACTS = 2
EXIT_TOOL_ERROR = 3

NON_COPY_ARTIFACT_KEYS = {"manifest", "evidencePack"}

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
        description="Build decision_packet artifacts for Go/No-Go validation."
    )
    parser.add_argument(
        "--template",
        default="docs/research/templates/go_no_go_evidence_pack.template.json",
    )
    parser.add_argument("--output-dir", default="decision_packet")
    parser.add_argument("--protocol-spec")
    parser.add_argument("--protocol-hash-file")
    parser.add_argument("--comparability-report")
    parser.add_argument("--champion-registry-snapshot")
    parser.add_argument("--release-gate-status")
    parser.add_argument("--offline-metrics")
    parser.add_argument("--live-shadow-metrics")
    parser.add_argument("--state-machine-log")
    parser.add_argument("--decision-markdown")
    parser.add_argument(
        "--generated-by",
        default="build_decision_packet.py",
        help="Fallback provenance.generatedBy when sidecar metadata is absent.",
    )
    parser.add_argument(
        "--data-window",
        default="unspecified",
        help="Fallback provenance.dataWindow when sidecar metadata is absent.",
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


def read_json(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"{path} must be a JSON object.")
    return data


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalize_artifact_rel_path(raw_path: str, output_dir_name: str) -> str:
    normalized = raw_path.replace("\\", "/").strip()
    if not normalized:
        raise ValueError("invalid artifact path: empty")
    if normalized.startswith("/"):
        raise ValueError(f"artifact path must not be absolute: {raw_path!r}")
    if len(normalized) >= 2 and normalized[1] == ":" and normalized[0].isalpha():
        raise ValueError(f"artifact path must not be absolute: {raw_path!r}")

    p = PurePosixPath(normalized)
    parts = [part for part in p.parts if part not in ("", ".", "/")]
    if parts and parts[0] in (output_dir_name, "decision_packet"):
        parts = parts[1:]
    if not parts:
        raise ValueError(f"invalid artifact path: {raw_path!r}")
    if any(part == ".." for part in parts):
        raise ValueError(f"artifact path must not traverse directories: {raw_path!r}")
    return str(PurePosixPath(*parts))


def try_read_json(path: Path) -> dict[str, Any] | None:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else None
    except Exception:  # noqa: BLE001
        return None


def maybe_get_number(payload: dict[str, Any], dotted_paths: list[str]) -> float | None:
    for dotted in dotted_paths:
        current: Any = payload
        ok = True
        for part in dotted.split("."):
            if not isinstance(current, dict) or part not in current:
                ok = False
                break
            current = current[part]
        if ok and isinstance(current, (int, float)):
            return float(current)
    return None


def maybe_get_bool(payload: dict[str, Any], dotted_paths: list[str]) -> bool | None:
    for dotted in dotted_paths:
        current: Any = payload
        ok = True
        for part in dotted.split("."):
            if not isinstance(current, dict) or part not in current:
                ok = False
                break
            current = current[part]
        if ok and isinstance(current, bool):
            return current
    return None


def maybe_get_string(payload: dict[str, Any], dotted_paths: list[str]) -> str | None:
    for dotted in dotted_paths:
        current: Any = payload
        ok = True
        for part in dotted.split("."):
            if not isinstance(current, dict) or part not in current:
                ok = False
                break
            current = current[part]
        if ok and isinstance(current, str) and current.strip():
            return current.strip()
    return None


def maybe_get_list(
    payload: dict[str, Any], dotted_paths: list[str]
) -> list[Any] | None:
    for dotted in dotted_paths:
        current: Any = payload
        ok = True
        for part in dotted.split("."):
            if not isinstance(current, dict) or part not in current:
                ok = False
                break
            current = current[part]
        if ok and isinstance(current, list):
            return current
    return None


def is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def set_metric_if_unset(
    measured: dict[str, Any], key: str, value: float | None
) -> None:
    if value is None:
        return
    existing = measured.get(key)
    if not is_number(existing):
        measured[key] = value


def read_nonempty_text(path: Path) -> str | None:
    text = path.read_text(encoding="utf-8").strip()
    return text or None


def read_provenance_sidecar(path: Path) -> dict[str, Any] | None:
    sidecar_path = path.with_name(f"{path.name}.meta.json")
    if not sidecar_path.exists():
        return None
    payload = try_read_json(sidecar_path)
    return payload if isinstance(payload, dict) else None


def infer_generated_at(payload: dict[str, Any]) -> str | None:
    for key in ("generatedAt", "updatedAt", "createdAt"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def infer_data_window(payload: dict[str, Any]) -> str | dict[str, Any] | None:
    for key in ("dataWindow", "window", "timeWindow"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
        if isinstance(value, dict) and value:
            return value
    start = payload.get("windowStart")
    end = payload.get("windowEnd")
    if isinstance(start, str) and start.strip() and isinstance(end, str) and end.strip():
        return {"start": start.strip(), "end": end.strip()}
    return None


def parse_comparability_status(payload: dict[str, Any]) -> tuple[bool, str]:
    status = maybe_get_bool(
        payload,
        [
            "allComparable",
            "all_comparable",
            "comparable",
            "summary.allComparable",
            "summary.all_comparable",
            "meta.allComparable",
        ],
    )
    if status is not None:
        return status, "derived from boolean comparability flag"

    failed_count = maybe_get_number(
        payload,
        [
            "failedCount",
            "failureCount",
            "incomparableCount",
            "nonComparableCount",
            "summary.failedCount",
            "summary.failureCount",
            "summary.incomparableCount",
        ],
    )
    if failed_count is not None:
        return failed_count <= 0.0, f"derived from failure count={failed_count}"

    failed_runs = maybe_get_list(
        payload,
        [
            "incomparableRuns",
            "failedRuns",
            "summary.incomparableRuns",
            "summary.failedRuns",
        ],
    )
    if failed_runs is not None:
        return len(
            failed_runs
        ) == 0, f"derived from failed runs count={len(failed_runs)}"

    return False, "comparability status is not inferable from report"


def normalize_state(raw: Any) -> str | None:
    if isinstance(raw, str) and raw.strip():
        value = raw.strip().upper()
        if value in STATE_SET:
            return value
    return None


def coalesce_raw_value(payload: dict[str, Any], keys: tuple[str, ...]) -> Any:
    for key in keys:
        if key in payload:
            return payload[key]
    return None


def validate_state_machine_log(path: Path) -> tuple[bool, str]:
    lines = [
        line for line in path.read_text(encoding="utf-8").splitlines() if line.strip()
    ]
    if not lines:
        return False, "state machine log has no events"

    current_state: str | None = None
    for idx, line in enumerate(lines, start=1):
        payload = json.loads(line)
        if not isinstance(payload, dict):
            return False, f"line {idx} is not a JSON object"
        raw_from_state = coalesce_raw_value(
            payload, ("from", "fromState", "prevState", "previousState")
        )
        from_state = normalize_state(raw_from_state)

        raw_to_state = coalesce_raw_value(payload, ("to", "toState", "nextState", "state"))
        to_state = normalize_state(raw_to_state)

        if raw_from_state is not None and from_state is None:
            return False, f"line {idx} unknown from-state: {raw_from_state!r}"
        if raw_to_state is not None and to_state is None:
            return False, f"line {idx} unknown target state: {raw_to_state!r}"

        if to_state is None:
            return False, f"line {idx} missing target state"
        if from_state is None:
            from_state = current_state
        if from_state is not None:
            if to_state not in ALLOWED_TRANSITIONS.get(from_state, set()):
                return False, f"line {idx} invalid transition {from_state}->{to_state}"
        current_state = to_state

    return True, f"validated {len(lines)} transitions"


def validate_champion_registry_snapshot(payload: dict[str, Any]) -> tuple[bool, str]:
    schema_path = Path("docs/research/templates/champion_registry.schema.v1.json")

    if Draft202012Validator is not None and schema_path.exists():
        try:
            schema_payload = read_json(schema_path)
            validator = Draft202012Validator(
                schema_payload,
                format_checker=Draft202012Validator.FORMAT_CHECKER,
            )
            errors = sorted(
                validator.iter_errors(payload), key=lambda err: list(err.path)
            )
            if errors:
                first = errors[0]
                location = ".".join(str(part) for part in first.path) or "$"
                return False, f"schema validation failed at {location}: {first.message}"
        except Exception as exc:  # noqa: BLE001
            return False, f"schema validation error: {exc}"

    required_fields = (
        "schemaVersion",
        "version",
        "updatedAt",
        "writer",
        "protocolHash",
        "datasetSnapshotId",
        "championConfigId",
        "status",
        "fallbackConfigId",
    )
    missing = [field for field in required_fields if field not in payload]
    if missing:
        return False, f"missing required fields: {', '.join(missing)}"

    if payload.get("schemaVersion") != "v1":
        return False, "schemaVersion must be v1"
    if payload.get("fallbackConfigId") != "H0":
        return False, "fallbackConfigId must be H0"

    return True, "champion registry snapshot validated"


def upsert_hard_gate(
    hard_gate_checks: list[dict[str, Any]],
    name: str,
    passed: bool,
    reason: str,
) -> None:
    for item in hard_gate_checks:
        if isinstance(item, dict) and item.get("name") == name:
            item["passed"] = bool(passed)
            item["reason"] = reason
            return

    hard_gate_checks.append(
        {
            "name": name,
            "passed": bool(passed),
            "reason": reason,
        }
    )


def ensure_decision_shape(pack: dict[str, Any]) -> None:
    decision = pack.setdefault("decision", {})
    if not isinstance(decision, dict):
        decision = {}
        pack["decision"] = decision
    decision.setdefault("result", "NO_GO")
    decision.setdefault("mode", "hard_gate")
    decision.setdefault("verdictReasonCodes", [])
    decision.setdefault("notes", [])
    decision.setdefault("constraints", [])
    decision.setdefault("rollbackTriggers", [])
    decision.setdefault("expiryAt", None)
    decision.setdefault("maxDurationHours", None)


def collect_measured_metrics(
    pack: dict[str, Any],
    copied_paths: dict[str, Path],
) -> None:
    measured = pack.setdefault("measured", {})
    if not isinstance(measured, dict):
        return

    offline = (
        try_read_json(copied_paths["offlineMetrics"])
        if "offlineMetrics" in copied_paths
        else None
    )
    live = (
        try_read_json(copied_paths["liveShadowMetrics14d"])
        if "liveShadowMetrics14d" in copied_paths
        else None
    )
    release = (
        try_read_json(copied_paths["releaseGateStatus"])
        if "releaseGateStatus" in copied_paths
        else None
    )

    if offline:
        set_metric_if_unset(
            measured,
            "winnerEligibleRatioRolling14d",
            maybe_get_number(
                offline,
                [
                    "winnerEligibleRatioRolling14d",
                    "strategyValidation.significancePassRatio",
                ],
            ),
        )
        set_metric_if_unset(
            measured,
            "meanPbo",
            maybe_get_number(offline, ["meanPbo", "strategyValidation.meanPbo"]),
        )
        set_metric_if_unset(
            measured,
            "meanDsrProbability",
            maybe_get_number(
                offline,
                ["meanDsrProbability", "strategyValidation.meanDsrProbability"],
            ),
        )
        set_metric_if_unset(
            measured,
            "fdrQ",
            maybe_get_number(offline, ["fdrQ", "statistics.fdrQ"]),
        )
        set_metric_if_unset(
            measured,
            "transferPassRatioRolling14d",
            maybe_get_number(
                offline,
                ["transferPassRatioRolling14d", "strategyValidation.paperPassRatio"],
            ),
        )

    if live:
        set_metric_if_unset(
            measured,
            "quoteAgeP95Ms",
            maybe_get_number(live, ["quoteAgeP95Ms", "quote_age_p95_ms"]),
        )
        set_metric_if_unset(
            measured,
            "decisionToSubmitP95Ms",
            maybe_get_number(
                live,
                ["decisionToSubmitP95Ms", "decision_to_submit_p95_ms"],
            ),
        )
        set_metric_if_unset(
            measured,
            "decisionToFirstFillP95Ms",
            maybe_get_number(
                live,
                ["decisionToFirstFillP95Ms", "decision_to_first_fill_p95_ms"],
            ),
        )

    if release:
        generated = release.get("generatedAt")
        if isinstance(generated, str):
            try:
                ts = datetime.fromisoformat(generated.replace("Z", "+00:00"))
                age_hours = (datetime.now(timezone.utc) - ts).total_seconds() / 3600
                set_metric_if_unset(measured, "releaseGateStatusAgeHours", age_hours)
            except ValueError:
                pass


def collect_hard_gate_checks(
    pack: dict[str, Any],
    copied_paths: dict[str, Path],
) -> None:
    hard_gate_checks = pack.setdefault("hardGateChecks", [])
    if not isinstance(hard_gate_checks, list):
        hard_gate_checks = []
        pack["hardGateChecks"] = hard_gate_checks

    comparability_path = copied_paths.get("comparabilityReport")
    if comparability_path:
        comparability_payload = try_read_json(comparability_path)
        if comparability_payload is not None:
            passed, reason = parse_comparability_status(comparability_payload)
            upsert_hard_gate(
                hard_gate_checks, "comparability_all_runs_valid", passed, reason
            )
        else:
            upsert_hard_gate(
                hard_gate_checks,
                "comparability_all_runs_valid",
                False,
                "comparability report is not a valid JSON object",
            )
    else:
        upsert_hard_gate(
            hard_gate_checks,
            "comparability_all_runs_valid",
            False,
            "comparability report missing",
        )

    protocol_hash_path = copied_paths.get("protocolHashFile")
    protocol_spec_path = copied_paths.get("protocolSpec")
    protocol_hash = None
    protocol_hash_reason = "protocol hash missing"
    protocol_hash_ok = False
    if protocol_hash_path:
        protocol_hash = read_nonempty_text(protocol_hash_path)
        if protocol_hash:
            pack["protocolHash"] = protocol_hash
            protocol_hash_ok = True
            protocol_hash_reason = "protocol hash file present"
        else:
            protocol_hash_reason = "protocol hash file is empty"

    if protocol_hash_ok and protocol_spec_path:
        protocol_spec = try_read_json(protocol_spec_path)
        if protocol_spec is not None:
            expected_hash = maybe_get_string(
                protocol_spec,
                [
                    "runtimeProtocolHash",
                    "protocolHash",
                    "meta.runtimeProtocolHash",
                ],
            )
            if expected_hash and expected_hash != protocol_hash:
                protocol_hash_ok = False
                protocol_hash_reason = "protocol hash mismatch between protocol spec and protocol hash file"

    upsert_hard_gate(
        hard_gate_checks,
        "protocol_hash_matches_runtime",
        protocol_hash_ok,
        protocol_hash_reason,
    )

    champion_path = copied_paths.get("championRegistrySnapshot")
    if champion_path:
        champion_payload = try_read_json(champion_path)
        if champion_payload is None:
            upsert_hard_gate(
                hard_gate_checks,
                "champion_registry_schema_valid",
                False,
                "champion registry snapshot is not a valid JSON object",
            )
        else:
            champion_ok, champion_reason = validate_champion_registry_snapshot(
                champion_payload
            )
            upsert_hard_gate(
                hard_gate_checks,
                "champion_registry_schema_valid",
                champion_ok,
                champion_reason,
            )
    else:
        upsert_hard_gate(
            hard_gate_checks,
            "champion_registry_schema_valid",
            False,
            "champion registry snapshot missing",
        )

    state_log_path = copied_paths.get("stateMachineLog")
    if state_log_path:
        try:
            state_ok, state_reason = validate_state_machine_log(state_log_path)
        except Exception as exc:  # noqa: BLE001
            state_ok = False
            state_reason = f"state machine log parsing error: {exc}"
        upsert_hard_gate(
            hard_gate_checks,
            "state_machine_drill_passed",
            state_ok,
            state_reason,
        )
    else:
        upsert_hard_gate(
            hard_gate_checks,
            "state_machine_drill_passed",
            False,
            "state machine log missing",
        )


def main() -> int:
    args = parse_args()
    template_path = Path(args.template)
    output_dir = Path(args.output_dir)

    try:
        if args.simulate_tool_error:
            raise RuntimeError("simulated tool error")

        template = read_json(template_path)
        artifacts = template.get("artifacts")
        if not isinstance(artifacts, dict):
            raise ValueError("template.artifacts must be an object.")
        effective_artifacts = dict(artifacts)
        release_cfg = template.get("releaseGateStatus")
        if "releaseGateStatus" not in effective_artifacts and isinstance(
            release_cfg, dict
        ) and isinstance(release_cfg.get("path"), str):
            # Legacy template compatibility:
            # when artifacts.releaseGateStatus is absent but releaseGateStatus.path exists,
            # keep the canonical destination path and use releaseGateStatus.path as source.
            effective_artifacts["releaseGateStatus"] = "decision_packet/release_gate_status.json"

        overrides: dict[str, str | None] = {
            "protocolSpec": args.protocol_spec,
            "protocolHashFile": args.protocol_hash_file,
            "comparabilityReport": args.comparability_report,
            "championRegistrySnapshot": args.champion_registry_snapshot,
            "releaseGateStatus": args.release_gate_status,
            "offlineMetrics": args.offline_metrics,
            "liveShadowMetrics14d": args.live_shadow_metrics,
            "stateMachineLog": args.state_machine_log,
            "decisionMarkdown": args.decision_markdown,
        }

        required_keys = [
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
        for key in required_keys:
            if key not in effective_artifacts:
                raise ValueError(f"template.artifacts missing required key: {key}")

        output_dir.mkdir(parents=True, exist_ok=True)
        output_dir_name = output_dir.name
        copied_paths: dict[str, Path] = {}
        provenance_entries: dict[str, dict[str, Any]] = {}
        manifest_entries: list[dict[str, Any]] = []
        missing: list[dict[str, str]] = []

        for key, raw_dest in effective_artifacts.items():
            if not isinstance(raw_dest, str):
                raise ValueError(f"artifacts.{key} must be string path.")

            rel_dest = normalize_artifact_rel_path(raw_dest, output_dir_name)
            dest_path = output_dir / rel_dest
            output_root = output_dir.resolve()
            if output_root != dest_path.resolve() and output_root not in dest_path.resolve().parents:
                raise ValueError(
                    f"artifact destination must stay under output dir: {dest_path}"
                )

            if key in NON_COPY_ARTIFACT_KEYS:
                continue

            override = overrides.get(key)
            if override:
                source_path = Path(override)
            elif key == "releaseGateStatus":
                release_cfg = template.get("releaseGateStatus")
                if isinstance(release_cfg, dict) and isinstance(
                    release_cfg.get("path"), str
                ):
                    source_path = Path(release_cfg["path"])
                else:
                    source_path = Path(raw_dest)
            else:
                source_path = Path(raw_dest)

            entry: dict[str, Any] = {
                "key": key,
                "sourcePath": str(source_path),
                "destinationPath": str(dest_path),
                "copied": False,
                "exists": False,
                "sha256": None,
                "sizeBytes": None,
            }

            provenance_entries[key] = {
                "sourcePath": str(source_path.resolve()),
                "sha256": None,
                "generatedAt": None,
                "generatedBy": None,
                "dataWindow": None,
            }

            if not source_path.exists():
                missing.append({"key": key, "sourcePath": str(source_path)})
                manifest_entries.append(entry)
                continue

            dest_path.parent.mkdir(parents=True, exist_ok=True)
            if source_path.resolve() != dest_path.resolve():
                shutil.copy2(source_path, dest_path)
                entry["copied"] = True
            entry["exists"] = True
            entry["sizeBytes"] = dest_path.stat().st_size
            entry["sha256"] = sha256_file(dest_path)
            manifest_entries.append(entry)
            copied_paths[key] = dest_path

            sidecar = read_provenance_sidecar(source_path)
            payload = try_read_json(dest_path)
            generated_at = None
            generated_by = None
            data_window: Any = None
            if isinstance(sidecar, dict):
                generated_at = maybe_get_string(
                    sidecar,
                    ["generatedAt", "generated_at", "createdAt", "updatedAt"],
                )
                generated_by = maybe_get_string(
                    sidecar,
                    ["generatedBy", "generated_by", "writer", "owner"],
                )
                data_window = sidecar.get("dataWindow") or sidecar.get("window")
            if generated_at is None and isinstance(payload, dict):
                generated_at = infer_generated_at(payload)
            if data_window is None and isinstance(payload, dict):
                data_window = infer_data_window(payload)

            provenance_entries[key] = {
                "sourcePath": str(source_path.resolve()),
                "sha256": entry["sha256"],
                "generatedAt": generated_at or utc_now_iso(),
                "generatedBy": generated_by or args.generated_by,
                "dataWindow": data_window if data_window is not None else args.data_window,
            }

        evidence_pack = copy.deepcopy(template)
        evidence_pack["generatedAt"] = utc_now_iso()
        ensure_decision_shape(evidence_pack)
        collect_measured_metrics(evidence_pack, copied_paths)
        collect_hard_gate_checks(evidence_pack, copied_paths)

        normalized_artifacts: dict[str, str] = {}
        for key, raw_dest in effective_artifacts.items():
            rel_dest = normalize_artifact_rel_path(str(raw_dest), output_dir_name)
            normalized_artifacts[key] = f"{output_dir_name}/{rel_dest}"
        evidence_pack["artifacts"] = normalized_artifacts

        artifact_provenance = evidence_pack.get("artifactProvenance")
        if not isinstance(artifact_provenance, dict):
            artifact_provenance = {}
            evidence_pack["artifactProvenance"] = artifact_provenance
        for key, provenance in provenance_entries.items():
            if key in NON_COPY_ARTIFACT_KEYS:
                continue
            artifact_provenance[key] = provenance

        release_status = evidence_pack.get("releaseGateStatus")
        if isinstance(release_status, dict):
            release_dest = normalized_artifacts.get(
                "releaseGateStatus", f"{output_dir_name}/release_gate_status.json"
            )
            release_status["path"] = release_dest
            copied_release = copied_paths.get("releaseGateStatus")
            if copied_release:
                release_payload = try_read_json(copied_release)
                if release_payload:
                    release_status["generatedAt"] = release_payload.get("generatedAt")
                    release_status["expiresAt"] = release_payload.get("expiresAt")
                    release_status["allowPaperTrading"] = release_payload.get(
                        "allowPaperTrading"
                    )
                    release_status["allowLiveTrading"] = release_payload.get(
                        "allowLiveTrading"
                    )

        evidence_pack_rel = normalize_artifact_rel_path(
            str(artifacts.get("evidencePack", f"{output_dir_name}/evidence_pack.json")),
            output_dir_name,
        )
        evidence_pack_path = output_dir / evidence_pack_rel
        evidence_pack_path.parent.mkdir(parents=True, exist_ok=True)
        evidence_pack_path.write_text(
            f"{json.dumps(evidence_pack, ensure_ascii=False, indent=2)}\n",
            encoding="utf-8",
        )

        manifest_rel = normalize_artifact_rel_path(
            str(artifacts.get("manifest", f"{output_dir_name}/manifest.json")),
            output_dir_name,
        )
        manifest_path = output_dir / manifest_rel
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        manifest_payload = {
            "version": "v1",
            "generatedAt": utc_now_iso(),
            "templatePath": str(template_path),
            "outputDir": str(output_dir),
            "missingCount": len(missing),
            "missing": missing,
            "artifacts": manifest_entries,
            "evidencePackPath": str(evidence_pack_path),
        }
        manifest_path.write_text(
            f"{json.dumps(manifest_payload, ensure_ascii=False, indent=2)}\n",
            encoding="utf-8",
        )

        print(
            json.dumps(
                {
                    "status": "built" if not missing else "incomplete",
                    "outputDir": str(output_dir),
                    "manifest": str(manifest_path),
                    "evidencePack": str(evidence_pack_path),
                    "missingCount": len(missing),
                },
                ensure_ascii=False,
            )
        )
        return EXIT_OK if not missing else EXIT_MISSING_ARTIFACTS
    except Exception as exc:  # noqa: BLE001
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
