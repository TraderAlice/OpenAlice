#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

from gate_common import sha256_text, utc_now_iso, write_json


FORMULA_ID = "stress_net_trim10_decline_v1"
FORMULA_EXPR = (
    "max(0, (baseline_net_trim10_mean - candidate_net_trim10_mean) / "
    "max(abs(baseline_net_trim10_mean), 1e-9))"
)
FORMULA_HASH = sha256_text(FORMULA_EXPR)


def stress_net_trim10_decline(
    baseline_net_trim10_mean: float,
    candidate_net_trim10_mean: float,
) -> float:
    denom = max(abs(float(baseline_net_trim10_mean)), 1e-9)
    decline = max(
        0.0,
        (float(baseline_net_trim10_mean) - float(candidate_net_trim10_mean)) / denom,
    )
    return float(decline)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Compute stress_net_trim10_decline with fixed formula."
    )
    parser.add_argument("--baseline", required=True, type=float)
    parser.add_argument("--candidate", required=True, type=float)
    parser.add_argument("--output", default=None)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    decline = stress_net_trim10_decline(args.baseline, args.candidate)
    payload: dict[str, Any] = {
        "generatedAt": utc_now_iso(),
        "formulaId": FORMULA_ID,
        "formulaHash": FORMULA_HASH,
        "baselineNetTrim10Mean": args.baseline,
        "candidateNetTrim10Mean": args.candidate,
        "decline": decline,
    }
    if args.output:
        write_json(Path(args.output), payload)  # type: ignore[name-defined]
    else:
        print(payload)
    return 0


if __name__ == "__main__":
    sys.exit(main())
