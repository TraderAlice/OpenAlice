#!/usr/bin/env python3
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import sys

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = REPO_ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from dataset_snapshot_lock import load_or_create_snapshot  # noqa: E402


class TestDatasetSnapshotLock(unittest.TestCase):
    def test_create_and_reuse_snapshot(self) -> None:
        with tempfile.TemporaryDirectory(prefix="openalice-ds-lock-") as tmp:
            tmp_dir = Path(tmp)
            dataset = tmp_dir / "dataset.json"
            features = tmp_dir / "features.json"
            labels = tmp_dir / "labels.json"
            split = tmp_dir / "split.json"
            output = tmp_dir / "lock.json"

            dataset.write_text('{"a":1}\n', encoding="utf-8")
            features.write_text('{"b":2}\n', encoding="utf-8")
            labels.write_text('{"c":3}\n', encoding="utf-8")
            split.write_text('{"d":4}\n', encoding="utf-8")

            created = load_or_create_snapshot(
                run_id="run-001",
                dataset_path=dataset,
                features_path=features,
                labels_path=labels,
                split_path=split,
                output_path=output,
                reuse_existing=True,
            )
            self.assertTrue(output.exists())
            self.assertEqual("run-001", created["runId"])

            reused = load_or_create_snapshot(
                run_id="run-001",
                dataset_path=dataset,
                features_path=features,
                labels_path=labels,
                split_path=split,
                output_path=output,
                reuse_existing=True,
            )
            self.assertEqual(created["datasetHash"], reused["datasetHash"])
            self.assertEqual(created["featuresHash"], reused["featuresHash"])
            self.assertEqual(created["labelHash"], reused["labelHash"])
            self.assertEqual(created["splitHash"], reused["splitHash"])

    def test_missing_input_raises(self) -> None:
        with tempfile.TemporaryDirectory(prefix="openalice-ds-lock-missing-") as tmp:
            tmp_dir = Path(tmp)
            dataset = tmp_dir / "dataset.json"
            features = tmp_dir / "features.json"
            labels = tmp_dir / "labels.json"
            split = tmp_dir / "split.json"
            output = tmp_dir / "lock.json"
            dataset.write_text("{}\n", encoding="utf-8")
            features.write_text("{}\n", encoding="utf-8")
            labels.write_text("{}\n", encoding="utf-8")

            with self.assertRaises(FileNotFoundError):
                load_or_create_snapshot(
                    run_id="run-002",
                    dataset_path=dataset,
                    features_path=features,
                    labels_path=labels,
                    split_path=split,
                    output_path=output,
                    reuse_existing=False,
                )


if __name__ == "__main__":
    unittest.main()
