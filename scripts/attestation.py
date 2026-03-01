#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

from gate_common import read_json, utc_now_iso, write_json


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate manual attestation against controlled acting-owner list."
    )
    parser.add_argument(
        "--owners",
        default="data/config/acting_owners.v1.json",
        help="Controlled acting owners config path.",
    )
    parser.add_argument(
        "--attestation",
        required=True,
        help="Attestation JSON file path.",
    )
    parser.add_argument(
        "--output",
        default="data/runtime/gates/attestation_report.json",
        help="Validation report output path.",
    )
    return parser.parse_args()


def active_owner_ids(owners_payload: dict[str, Any]) -> set[str]:
    owners = owners_payload.get("owners")
    if not isinstance(owners, list):
        return set()
    ids: set[str] = set()
    for item in owners:
        if not isinstance(item, dict):
            continue
        if item.get("active") is not True:
            continue
        owner_id = item.get("id")
        if isinstance(owner_id, str) and owner_id.strip():
            ids.add(owner_id)
    return ids


def validate_attestation(
    attestation_payload: dict[str, Any],
    owners_payload: dict[str, Any],
) -> tuple[bool, list[str]]:
    issues: list[str] = []
    mode = attestation_payload.get("mode")
    if mode not in ("manual_attest", "key_signed_attest", "service_attest"):
        issues.append("attestation.mode invalid")
        return False, issues

    allowed = active_owner_ids(owners_payload)
    attested_by = attestation_payload.get("attestedBy")
    reviewed_by = attestation_payload.get("reviewedBy")
    if not isinstance(attested_by, str) or attested_by not in allowed:
        issues.append("attestedBy not in active owner allowlist")
    if not isinstance(reviewed_by, str) or reviewed_by not in allowed:
        issues.append("reviewedBy not in active owner allowlist")
    if isinstance(attested_by, str) and isinstance(reviewed_by, str):
        if attested_by == reviewed_by:
            issues.append("attestedBy must differ from reviewedBy")

    if not isinstance(attestation_payload.get("attestedAt"), str):
        issues.append("attestedAt missing")
    if not isinstance(attestation_payload.get("reviewedAt"), str):
        issues.append("reviewedAt missing")
    scope = attestation_payload.get("scope")
    if not isinstance(scope, list) or len(scope) == 0:
        issues.append("scope must be non-empty list")

    return len(issues) == 0, issues


def main() -> int:
    args = parse_args()
    owners_payload = read_json(Path(args.owners))
    attestation_payload = read_json(Path(args.attestation))
    passed, issues = validate_attestation(attestation_payload, owners_payload)
    report = {
        "generatedAt": utc_now_iso(),
        "ownersPath": args.owners,
        "attestationPath": args.attestation,
        "passed": passed,
        "issues": issues,
    }
    write_json(Path(args.output), report)
    return 0 if passed else 2


if __name__ == "__main__":
    sys.exit(main())
