#!/usr/bin/env python3
"""Idempotency test for decision packet build output.

Same input -> same output (excluding timestamp fields).
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = REPO_ROOT / "scripts"
TEMPLATE_PATH = (
    REPO_ROOT / "docs/research/templates/go_no_go_evidence_pack.template.json"
)


def now_utc_iso() -> str:
    return (
        datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    )


def run_cmd(args: list[str], cwd: Path = REPO_ROOT) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        cwd=str(cwd),
        text=True,
        capture_output=True,
        check=False,
    )


def normalize_payload(value: Any) -> Any:
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for key, item in value.items():
            if key in ("generatedAt", "releaseGateStatusAgeHours"):
                continue
            out[key] = normalize_payload(item)
        return out
    if isinstance(value, list):
        return [normalize_payload(item) for item in value]
    return value


class TestDecisionPacketIdempotency(unittest.TestCase):
    def test_build_twice_with_same_input_produces_same_payload(self) -> None:
        with tempfile.TemporaryDirectory(prefix="openalice-idempotency-") as tmp:
            tmp_dir = Path(tmp)
            protocol_hash = f"phash:v1:{'a' * 64}"
            dataset_snapshot = f"dsnap:v1:{'b' * 24}"
            now = datetime.now(timezone.utc)

            protocol_spec = tmp_dir / "protocol_spec.json"
            protocol_spec.write_text(
                json.dumps(
                    {"runtimeProtocolHash": protocol_hash, "seed": 42},
                    ensure_ascii=False,
                    indent=2,
                )
                + "\n",
                encoding="utf-8",
            )

            protocol_hash_file = tmp_dir / "protocol_hash.txt"
            protocol_hash_file.write_text(f"{protocol_hash}\n", encoding="utf-8")

            comparability_report = tmp_dir / "comparability_report.json"
            comparability_report.write_text(
                json.dumps({"allComparable": True}, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )

            champion_registry = tmp_dir / "champion_registry_snapshot.json"
            champion_registry.write_text(
                json.dumps(
                    {
                        "schemaVersion": "v1",
                        "version": 1,
                        "updatedAt": now_utc_iso(),
                        "writer": "idempotency-test",
                        "protocolHash": protocol_hash,
                        "datasetSnapshotId": dataset_snapshot,
                        "championConfigId": "H1",
                        "status": "active",
                        "fallbackConfigId": "H0",
                    },
                    ensure_ascii=False,
                    indent=2,
                )
                + "\n",
                encoding="utf-8",
            )

            release_gate_status = tmp_dir / "release_gate_status.json"
            release_gate_status.write_text(
                json.dumps(
                    {
                        "generatedAt": now_utc_iso(),
                        "expiresAt": (now + timedelta(hours=6))
                        .isoformat(timespec="seconds")
                        .replace("+00:00", "Z"),
                        "allowPaperTrading": True,
                        "allowLiveTrading": True,
                    },
                    ensure_ascii=False,
                    indent=2,
                )
                + "\n",
                encoding="utf-8",
            )

            offline_metrics = tmp_dir / "offline_metrics.json"
            offline_metrics.write_text(
                json.dumps(
                    {
                        "transferPassRatioRolling14d": 0.3,
                        "winnerEligibleRatioRolling14d": 0.4,
                        "meanPbo": 0.1,
                        "meanDsrProbability": 0.6,
                        "fdrQ": 0.08,
                    },
                    ensure_ascii=False,
                    indent=2,
                )
                + "\n",
                encoding="utf-8",
            )

            live_shadow = tmp_dir / "live_shadow_metrics_14d.json"
            live_shadow.write_text(
                json.dumps(
                    {
                        "quoteAgeP95Ms": 1000,
                        "decisionToSubmitP95Ms": 700,
                        "decisionToFirstFillP95Ms": 2000,
                    },
                    ensure_ascii=False,
                    indent=2,
                )
                + "\n",
                encoding="utf-8",
            )

            state_machine_log = tmp_dir / "state_machine_log.jsonl"
            state_machine_log.write_text(
                "\n".join(
                    [
                        json.dumps({"from": "NORMAL", "to": "WATCH", "timestamp": now_utc_iso()}),
                        json.dumps({"from": "WATCH", "to": "NORMAL", "timestamp": now_utc_iso()}),
                    ]
                )
                + "\n",
                encoding="utf-8",
            )

            decision_md = tmp_dir / "decision.md"
            decision_md.write_text("# decision\n\nidempotent\n", encoding="utf-8")

            def build(target_dir: Path) -> None:
                proc = run_cmd(
                    [
                        sys.executable,
                        str(SCRIPTS_DIR / "build_decision_packet.py"),
                        "--template",
                        str(TEMPLATE_PATH),
                        "--output-dir",
                        str(target_dir),
                        "--protocol-spec",
                        str(protocol_spec),
                        "--protocol-hash-file",
                        str(protocol_hash_file),
                        "--comparability-report",
                        str(comparability_report),
                        "--champion-registry-snapshot",
                        str(champion_registry),
                        "--release-gate-status",
                        str(release_gate_status),
                        "--offline-metrics",
                        str(offline_metrics),
                        "--live-shadow-metrics",
                        str(live_shadow),
                        "--state-machine-log",
                        str(state_machine_log),
                        "--decision-markdown",
                        str(decision_md),
                        "--generated-by",
                        "idempotency-test",
                        "--data-window",
                        "2026-02-01..2026-02-14",
                    ]
                )
                self.assertEqual(0, proc.returncode, msg=proc.stderr)

            packet_dir = tmp_dir / "packet"
            build(packet_dir)
            manifest_a = normalize_payload(
                json.loads((packet_dir / "manifest.json").read_text(encoding="utf-8"))
            )
            evidence_a = normalize_payload(
                json.loads((packet_dir / "evidence_pack.json").read_text(encoding="utf-8"))
            )

            # Rebuild with the same inputs and same output directory.
            build(packet_dir)
            manifest_b = normalize_payload(
                json.loads((packet_dir / "manifest.json").read_text(encoding="utf-8"))
            )
            evidence_b = normalize_payload(
                json.loads((packet_dir / "evidence_pack.json").read_text(encoding="utf-8"))
            )

            self.assertEqual(manifest_a, manifest_b)
            self.assertEqual(evidence_a, evidence_b)


if __name__ == "__main__":
    unittest.main()
