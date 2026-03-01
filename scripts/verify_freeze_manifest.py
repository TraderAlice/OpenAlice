#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    from jsonschema import Draft202012Validator
except Exception:  # noqa: BLE001
    Draft202012Validator = None  # type: ignore[assignment]


EXIT_OK = 0
EXIT_POLICY_FAIL = 2
EXIT_TOOL_ERROR = 3


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Verify OpenAlice freeze manifest before execution."
    )
    parser.add_argument(
        "--manifest",
        default="docs/research/freeze_manifest.json",
        help="Path to freeze_manifest.json",
    )
    parser.add_argument(
        "--schema",
        default="docs/research/templates/freeze_manifest.schema.v1.json",
        help="Path to freeze manifest schema file (tracked for audit).",
    )
    parser.add_argument(
        "--output",
        default="data/runtime/freeze_verify_report.json",
        help="Path to write machine-readable verification report.",
    )
    parser.add_argument(
        "--simulate-tool-error",
        action="store_true",
        help="Return TOOL_ERROR for CI exit-code contract tests.",
    )
    return parser.parse_args()


def is_nonempty_identity(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    trimmed = value.strip()
    if not trimmed:
        return False
    upper = trimmed.upper()
    if upper.startswith("TODO") or upper.startswith("TBD"):
        return False
    if trimmed.startswith("<") and trimmed.endswith(">"):
        return False
    return True


def is_valid_iso8601(value: Any) -> bool:
    if not isinstance(value, str) or not value.strip():
        return False
    normalized = value.replace("Z", "+00:00")
    try:
        datetime.fromisoformat(normalized)
        return True
    except ValueError:
        return False


def validate_manifest(manifest: dict[str, Any]) -> list[str]:
    failures: list[str] = []

    if manifest.get("manifestVersion") != "v1":
        failures.append("manifestVersion must equal 'v1'.")

    if not is_valid_iso8601(manifest.get("frozenAt")):
        failures.append("frozenAt must be a valid ISO8601 timestamp.")

    versions = manifest.get("versions")
    if not isinstance(versions, dict):
        failures.append("versions must be an object.")
    else:
        for key in ("sm", "stats", "hash", "evidence"):
            if not is_nonempty_identity(versions.get(key)):
                failures.append(f"versions.{key} must be non-empty and concrete.")

    thresholds = manifest.get("thresholds")
    if not isinstance(thresholds, dict) or not thresholds:
        failures.append("thresholds must be a non-empty object.")

    raci = manifest.get("raciSnapshot")
    if not isinstance(raci, dict):
        failures.append("raciSnapshot must be an object.")
    else:
        for stream in ("E7", "E8", "E9"):
            item = raci.get(stream)
            if not isinstance(item, dict):
                failures.append(f"raciSnapshot.{stream} must be an object.")
                continue
            for role in ("dri", "backup", "nightOnCall"):
                if not is_nonempty_identity(item.get(role)):
                    failures.append(
                        f"raciSnapshot.{stream}.{role} must be non-empty and concrete."
                    )

    if not is_nonempty_identity(manifest.get("incidentCommander")):
        failures.append("incidentCommander must be non-empty and concrete.")

    allowlist = manifest.get("l2OverrideAllowlist")
    if not isinstance(allowlist, list) or len(allowlist) == 0:
        failures.append("l2OverrideAllowlist must contain at least one identity.")
    else:
        for idx, item in enumerate(allowlist):
            if not is_nonempty_identity(item):
                failures.append(
                    f"l2OverrideAllowlist[{idx}] must be a concrete identity."
                )

    sign_off = manifest.get("signOff")
    if not isinstance(sign_off, dict):
        failures.append("signOff must be an object.")
    else:
        approved_by = sign_off.get("approvedBy")
        if not isinstance(approved_by, list) or len(approved_by) == 0:
            failures.append("signOff.approvedBy must contain at least one signer.")
        else:
            for idx, signer in enumerate(approved_by):
                if not is_nonempty_identity(signer):
                    failures.append(f"signOff.approvedBy[{idx}] must be non-empty.")
        if not is_valid_iso8601(sign_off.get("approvedAt")):
            failures.append("signOff.approvedAt must be a valid ISO8601 timestamp.")

    return failures


def validate_schema(
    manifest: dict[str, Any],
    schema_payload: dict[str, Any],
) -> list[str]:
    if Draft202012Validator is None:
        # Fallback structural validation for environments without jsonschema.
        errors: list[str] = []
        allowed_top = {
            "manifestVersion",
            "frozenAt",
            "versions",
            "thresholds",
            "raciSnapshot",
            "incidentCommander",
            "l2OverrideAllowlist",
            "signOff",
        }
        extra_top = sorted(set(manifest.keys()) - allowed_top)
        if extra_top:
            errors.append(
                f"schema:$: additional properties are not allowed: {', '.join(extra_top)}"
            )

        versions = manifest.get("versions")
        if isinstance(versions, dict):
            extra_versions = sorted(
                set(versions.keys()) - {"sm", "stats", "hash", "evidence"}
            )
            if extra_versions:
                errors.append(
                    "schema:versions: additional properties are not allowed: "
                    + ", ".join(extra_versions)
                )

        raci = manifest.get("raciSnapshot")
        if isinstance(raci, dict):
            extra_streams = sorted(set(raci.keys()) - {"E7", "E8", "E9"})
            if extra_streams:
                errors.append(
                    "schema:raciSnapshot: additional properties are not allowed: "
                    + ", ".join(extra_streams)
                )
            for stream in ("E7", "E8", "E9"):
                item = raci.get(stream)
                if isinstance(item, dict):
                    extra_roles = sorted(
                        set(item.keys()) - {"dri", "backup", "nightOnCall"}
                    )
                    if extra_roles:
                        errors.append(
                            f"schema:raciSnapshot.{stream}: additional properties are not allowed: "
                            + ", ".join(extra_roles)
                        )

        sign_off = manifest.get("signOff")
        if isinstance(sign_off, dict):
            extra_signoff = sorted(set(sign_off.keys()) - {"approvedBy", "approvedAt"})
            if extra_signoff:
                errors.append(
                    "schema:signOff: additional properties are not allowed: "
                    + ", ".join(extra_signoff)
                )

        return errors

    validator = Draft202012Validator(
        schema_payload,
        format_checker=Draft202012Validator.FORMAT_CHECKER,
    )
    errors = sorted(validator.iter_errors(manifest), key=lambda err: list(err.path))
    formatted: list[str] = []
    for error in errors:
        location = ".".join(str(part) for part in error.path) or "$"
        formatted.append(f"schema:{location}: {error.message}")
    return formatted


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        f"{json.dumps(payload, indent=2, ensure_ascii=False)}\n", encoding="utf-8"
    )


def main() -> int:
    args = parse_args()
    manifest_path = Path(args.manifest)
    schema_path = Path(args.schema)
    output_path = Path(args.output)

    try:
        if args.simulate_tool_error:
            raise RuntimeError("simulated tool error")

        if not manifest_path.exists():
            report = {
                "passed": False,
                "generatedAt": datetime.now(timezone.utc)
                .isoformat(timespec="seconds")
                .replace("+00:00", "Z"),
                "manifestPath": str(manifest_path),
                "schemaPath": str(schema_path),
                "failures": [f"manifest file not found: {manifest_path}"],
            }
            write_json(output_path, report)
            return EXIT_POLICY_FAIL

        manifest_raw = manifest_path.read_text(encoding="utf-8")
        manifest = json.loads(manifest_raw)
        if not isinstance(manifest, dict):
            raise ValueError("freeze manifest must be a JSON object.")

        failures: list[str] = []
        schema_errors: list[str] = []

        if not schema_path.exists():
            failures.append(f"schema file not found: {schema_path}")
        else:
            schema_payload = json.loads(schema_path.read_text(encoding="utf-8"))
            if not isinstance(schema_payload, dict):
                raise ValueError("freeze manifest schema must be a JSON object.")
            schema_errors = validate_schema(manifest, schema_payload)
            failures.extend(schema_errors)

        semantic_errors = validate_manifest(manifest)
        failures.extend(semantic_errors)

        report = {
            "passed": len(failures) == 0,
            "generatedAt": datetime.now(timezone.utc)
            .isoformat(timespec="seconds")
            .replace("+00:00", "Z"),
            "manifestPath": str(manifest_path),
            "schemaPath": str(schema_path),
            "schemaExists": schema_path.exists(),
            "schemaValidationErrors": schema_errors,
            "semanticValidationErrors": semantic_errors,
            "failures": failures,
        }
        write_json(output_path, report)
        return EXIT_OK if not failures else EXIT_POLICY_FAIL
    except (json.JSONDecodeError, ValueError) as exc:
        report = {
            "passed": False,
            "generatedAt": datetime.now(timezone.utc)
            .isoformat(timespec="seconds")
            .replace("+00:00", "Z"),
            "manifestPath": str(manifest_path),
            "schemaPath": str(schema_path),
            "failures": [f"invalid_manifest_input: {exc}"],
        }
        write_json(output_path, report)
        return EXIT_POLICY_FAIL
    except Exception as exc:  # noqa: BLE001
        report = {
            "passed": False,
            "generatedAt": datetime.now(timezone.utc)
            .isoformat(timespec="seconds")
            .replace("+00:00", "Z"),
            "manifestPath": str(manifest_path),
            "schemaPath": str(schema_path),
            "failures": [f"tool_error: {exc}"],
        }
        write_json(output_path, report)
        return EXIT_TOOL_ERROR


if __name__ == "__main__":
    sys.exit(main())
