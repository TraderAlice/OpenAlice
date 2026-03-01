#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

from gate_common import sha256_file, utc_now_iso, write_json


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create or reuse frozen dataset snapshot lock for a run."
    )
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--dataset-path", required=True)
    parser.add_argument("--features-path", required=True)
    parser.add_argument("--labels-path", required=True)
    parser.add_argument("--split-path", required=True)
    parser.add_argument(
        "--output",
        default=None,
        help="Output lock path. Defaults to data/runtime/gates/<run-id>/dataset_snapshot_lock.json",
    )
    parser.add_argument(
        "--reuse-existing",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Reuse existing lock when present (default behavior for run retries).",
    )
    return parser.parse_args()


def build_snapshot(
    run_id: str,
    dataset_path: Path,
    features_path: Path,
    labels_path: Path,
    split_path: Path,
) -> dict[str, Any]:
    for p in (dataset_path, features_path, labels_path, split_path):
        if not p.exists():
            raise FileNotFoundError(f"snapshot input missing: {p}")

    return {
        "version": "v1",
        "runId": run_id,
        "frozenAt": utc_now_iso(),
        "datasetPath": str(dataset_path.resolve()),
        "featuresPath": str(features_path.resolve()),
        "labelsPath": str(labels_path.resolve()),
        "splitPath": str(split_path.resolve()),
        "datasetHash": sha256_file(dataset_path),
        "featuresHash": sha256_file(features_path),
        "labelHash": sha256_file(labels_path),
        "splitHash": sha256_file(split_path),
    }


def load_or_create_snapshot(
    *,
    run_id: str,
    dataset_path: Path,
    features_path: Path,
    labels_path: Path,
    split_path: Path,
    output_path: Path,
    reuse_existing: bool = True,
) -> dict[str, Any]:
    if reuse_existing and output_path.exists():
        from gate_common import read_json

        payload = read_json(output_path)
        existing_run_id = payload.get("runId")
        if isinstance(existing_run_id, str) and existing_run_id == run_id:
            return payload

    payload = build_snapshot(
        run_id=run_id,
        dataset_path=dataset_path,
        features_path=features_path,
        labels_path=labels_path,
        split_path=split_path,
    )
    write_json(output_path, payload)
    return payload


def main() -> int:
    args = parse_args()
    output_path = (
        Path(args.output)
        if args.output
        else Path("data/runtime/gates") / args.run_id / "dataset_snapshot_lock.json"
    )

    try:
        payload = load_or_create_snapshot(
            run_id=args.run_id,
            dataset_path=Path(args.dataset_path),
            features_path=Path(args.features_path),
            labels_path=Path(args.labels_path),
            split_path=Path(args.split_path),
            output_path=output_path,
            reuse_existing=bool(args.reuse_existing),
        )
    except FileNotFoundError as exc:
        write_json(
            output_path,
            {
                "version": "v1",
                "runId": args.run_id,
                "frozenAt": utc_now_iso(),
                "error": str(exc),
            },
        )
        return 2
    except Exception as exc:  # noqa: BLE001
        write_json(
            output_path,
            {
                "version": "v1",
                "runId": args.run_id,
                "frozenAt": utc_now_iso(),
                "error": f"tool_error: {exc}",
            },
        )
        return 3

    print(payload)
    return 0


if __name__ == "__main__":
    sys.exit(main())
