from __future__ import annotations

import contextlib
import hashlib
import importlib.util
import io
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import jsonschema
import pandas as pd

from autoquant.candidate_contracts import FACTOR_CANDIDATE_CONTRACT_JSON_SCHEMA
from autoquant.factor_explorer import load_factor_diagnostics
from autoquant.intake import (
    OHLCV_DATASET_PACKAGE_JSON_SCHEMA,
    load_project_intake,
    prepare_project_intake,
)
from autoquant.run_reports import publish_run_report
from autoquant.runs import execute_study
from autoquant.orientation import build_agent_work_brief
from autoquant.skill_bundle import (
    SKILL_DISCOVERY_ROOTS,
    WORKSPACE_SKILLS_MANIFEST,
    SkillBundleError,
    bundled_workspace_skills,
    materialize_workspace_skills,
    verify_materialized_workspace_skills,
)
from autoquant.studio import build_studio_snapshot
from autoquant.templates import OHLCV_STUDY_ID
from autoquant.workspace import (
    WORKSPACE_MANIFEST,
    AutoQuantValidationError,
    create_project,
    initialize_workspace,
)

ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "autoquant" / "workspace_skills"


def load_script(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise AssertionError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    digest.update(path.read_bytes())
    return digest.hexdigest()


def write_daily_close_time_inputs(
    root: Path,
    materializer,
    *,
    long_history: bool = False,
) -> tuple[Path, Path, Path]:
    source = root / "daily-source"
    source.mkdir()
    if long_history:
        calendars = {
            name: materializer.xcals.get_calendar(
                name,
                start="2024-01-01",
                end="2025-03-31",
            )
            for name in ("XTKS", "XNYS")
        }
        dates_by_calendar = {
            name: [timestamp.date() for timestamp in calendar.sessions[:240]]
            for name, calendar in calendars.items()
        }
    else:
        dates = [
            pd.Timestamp(value).date()
            for value in (
                "2024-10-31",
                "2024-11-01",
                "2024-11-05",
                "2024-11-06",
            )
        ]
        dates_by_calendar = {"XTKS": dates, "XNYS": dates}

    asset_specs = (
        ("7203.T", "equity", "XTKS", "JPY", "XTKS"),
        ("SPY", "fund", "XNYS", "USD", "XNYS"),
    )
    assets: list[dict[str, str]] = []
    for asset_number, (
        symbol,
        asset_class,
        venue,
        currency,
        calendar,
    ) in enumerate(asset_specs):
        rows: list[dict[str, float | str]] = []
        close = 100.0 + 1_000.0 * asset_number
        for row_number, session_date in enumerate(dates_by_calendar[calendar]):
            close *= 1.0 + 0.0004 + 0.002 * ((row_number % 11) - 5) / 5
            open_value = close * (1.0 - 0.001 * ((row_number % 3) - 1))
            rows.append(
                {
                    "date": session_date.isoformat(),
                    "open": open_value,
                    "high": max(open_value, close) * 1.002,
                    "low": min(open_value, close) * 0.998,
                    "close": close,
                    "volume": 1_000_000.0 + 10_000 * row_number,
                }
            )
        filename = f"{symbol}.csv"
        pd.DataFrame(rows).to_csv(source / filename, index=False)
        assets.append(
            {
                "symbol": symbol,
                "assetClass": asset_class,
                "venue": venue,
                "currency": currency,
                "path": filename,
            }
        )

    package = {
        "schemaVersion": 4,
        "kind": "autoquant-ohlcv-dataset-package",
        "id": "date-labelled-cross-market-daily",
        "version": "2024-v1",
        "assetClass": "mixed",
        "frequency": "1d",
        "panelPolicy": {
            "alignment": "observed-only",
            "missingObservation": "absent-no-fill",
        },
        "market": {
            "clock": "session",
            "calendar": "provider-observed",
            "timezone": "UTC",
        },
        "priceAdjustment": "provider-adjusted",
        "provider": {
            "name": "deterministic-close-time-fixture",
            "retrievedAt": "2026-08-02T00:00:00Z",
            "sourceUri": None,
            "terms": "deterministic test fixture only",
        },
        "assets": assets,
    }
    package_path = source / "dataset-package.json"
    package_path.write_text(
        json.dumps(package, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    authority = {
        "schemaVersion": 1,
        "kind": "autoquant-daily-close-time-authority",
        "sourcePackage": {
            "id": package["id"],
            "version": package["version"],
            "sha256": file_sha256(package_path),
        },
        "outputDataset": {
            "id": "calendar-close-cross-market-daily",
            "version": "2024-close-v1",
        },
        "calendarAuthority": {
            "library": "exchange_calendars",
            "version": materializer.distribution_version(
                "exchange-calendars"
            ),
            "closeSemantics": "scheduled-regular-session-close",
            "limitations": [
                "Library schedules are research authority, not authenticated exchange records."
            ],
        },
        "assets": [
            {
                "symbol": "7203.T",
                "calendar": "XTKS",
                "timezone": "Asia/Tokyo",
                "volumeSemantics": "provider-reported-nonnegative",
            },
            {
                "symbol": "SPY",
                "calendar": "XNYS",
                "timezone": "America/New_York",
                "volumeSemantics": "provider-reported-nonnegative",
            },
        ],
    }
    authority_path = root / "close-time-authority.json"
    authority_path.write_text(
        json.dumps(authority, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    request = {
        "schemaVersion": 1,
        "kind": "autoquant-research-request",
        "title": "Tokyo target with completed New York context",
        "question": (
            "Does prior completed SPY daily momentum predict the next "
            "observed Toyota close return?"
        ),
        "decisionContext": "Deterministic close-time packaging integration test.",
        "assets": [
            {
                "symbol": "7203.T",
                "assetClass": "equity",
                "venue": "XTKS",
                "positionRole": "long-only",
            },
            {
                "symbol": "SPY",
                "assetClass": "fund",
                "venue": "XNYS",
                "positionRole": "context-only",
            },
        ],
        "direction": "long",
        "factorPolicy": {
            "claim": "decision-signal",
            "knownStyle": None,
            "predictionAssets": ["7203.T"],
        },
        "horizonPolicy": {
            "primaryForwardBars": 1,
            "diagnosticForwardBars": [1, 5],
        },
        "horizon": "The next observed Toyota close.",
        "hypotheses": ["Prior completed context may be measurable."],
        "constraints": ["No same-date future New York close or trading authority."],
        "deliverables": ["Causal Factor evidence"],
        "source": {
            "system": "local",
            "workspaceId": None,
            "sessionId": None,
            "artifactPath": None,
            "artifactRevision": None,
        },
    }
    request_path = root / "research-request.json"
    request_path.write_text(
        json.dumps(request, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return request_path, package_path, authority_path


def write_observed_composition_inputs(
    root: Path,
    *,
    observations: int = 240,
) -> tuple[Path, Path, list[Path]]:
    timestamps = pd.date_range(
        "2024-01-02",
        periods=observations,
        freq="B",
        tz="UTC",
    )
    source_specs = (
        (
            "tokyo-source",
            "7203.T",
            "equity",
            "XTKS",
            "JPY",
            "fixture-yahoo",
            "06:00:00",
            100.0,
        ),
        (
            "new-york-source",
            "SPY",
            "fund",
            "XNYS",
            "USD",
            "fixture-nasdaq",
            "21:00:00",
            500.0,
        ),
    )
    package_paths: list[Path] = []
    source_authority: list[dict[str, str]] = []
    for source_number, (
        source_id,
        symbol,
        asset_class,
        venue,
        currency,
        provider,
        close_time,
        initial_close,
    ) in enumerate(source_specs):
        source_root = root / source_id
        source_root.mkdir()
        closes: list[float] = []
        close = initial_close
        for row_number in range(observations):
            close *= 1.0 + 0.0003 + 0.002 * (
                ((row_number + source_number * 3) % 13) - 6
            ) / 6
            closes.append(close)
        frame = pd.DataFrame(
            {
                "timestamp": [
                    f"{timestamp.date().isoformat()}T{close_time}Z"
                    for timestamp in timestamps
                ],
                "open": [value * 0.999 for value in closes],
                "high": [value * 1.002 for value in closes],
                "low": [value * 0.998 for value in closes],
                "close": closes,
                "volume": [1_000_000.0 + row * 1_000 for row in range(observations)],
            }
        )
        asset_path = source_root / f"{symbol}.csv"
        frame.to_csv(asset_path, index=False, lineterminator="\n")
        package = {
            "schemaVersion": 5,
            "kind": "autoquant-ohlcv-dataset-package",
            "id": f"{source_id}-observed",
            "version": "2024-v1",
            "assetClass": asset_class,
            "baseInterval": "1d",
            "timestampSemantics": "bar-close",
            "panelPolicy": {
                "alignment": "observed-only",
                "missingObservation": "absent-no-fill",
                "horizonClock": "per-target-observed-bars",
            },
            "market": {
                "clock": "observed",
                "calendar": "provider-observed",
                "timezone": "UTC",
            },
            "priceAdjustment": "split-adjusted",
            "provider": {
                "name": provider,
                "retrievedAt": "2026-08-02T00:00:00Z",
                "sourceUri": None,
                "terms": "deterministic test fixture only",
            },
            "assets": [
                {
                    "symbol": symbol,
                    "assetClass": asset_class,
                    "venue": venue,
                    "currency": currency,
                    "path": asset_path.name,
                    "volumeSemantics": "provider-reported-nonnegative",
                }
            ],
        }
        package_path = source_root / "dataset-package.json"
        package_path.write_text(
            json.dumps(package, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        package_paths.append(package_path)
        source_authority.append(
            {
                "id": source_id,
                "path": package_path.relative_to(root).as_posix(),
                "sha256": file_sha256(package_path),
            }
        )
    authority = {
        "schemaVersion": 1,
        "kind": "autoquant-observed-package-composition",
        "outputDataset": {
            "id": "dual-provider-observed-daily",
            "version": "2024-v1",
        },
        "sourcePackages": source_authority,
    }
    authority_path = root / "composition-authority.json"
    authority_path.write_text(
        json.dumps(authority, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    request = {
        "schemaVersion": 1,
        "kind": "autoquant-research-request",
        "title": "Tokyo target with distinct New York source context",
        "question": "Does completed SPY momentum predict the next Toyota close?",
        "decisionContext": "Deterministic multi-source packaging integration test.",
        "assets": [
            {
                "symbol": "7203.T",
                "assetClass": "equity",
                "venue": "XTKS",
                "positionRole": "long-only",
            },
            {
                "symbol": "SPY",
                "assetClass": "fund",
                "venue": "XNYS",
                "positionRole": "context-only",
            },
        ],
        "direction": "long",
        "factorPolicy": {
            "claim": "decision-signal",
            "knownStyle": None,
            "predictionAssets": ["7203.T"],
        },
        "horizonPolicy": {
            "primaryForwardBars": 1,
            "diagnosticForwardBars": [1, 5],
        },
        "horizon": "The next observed Toyota close.",
        "hypotheses": ["Prior completed context may be measurable."],
        "constraints": ["No trading authority or provider authentication."],
        "deliverables": ["Causal Factor evidence"],
        "source": {
            "system": "local",
            "workspaceId": None,
            "sessionId": None,
            "artifactPath": None,
            "artifactRevision": None,
        },
    }
    request_path = root / "research-request.json"
    request_path.write_text(
        json.dumps(request, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return request_path, authority_path, package_paths


def yahoo_intraday_payload(
    route,
    schedule: pd.DataFrame,
    *,
    omitted_starts: set[pd.Timestamp] | None = None,
    null_starts: set[pd.Timestamp] | None = None,
    extra_rows: list[tuple[pd.Timestamp, dict[str, float]]] | None = None,
) -> dict:
    """Build deterministic Yahoo-style bucket-start evidence."""

    omitted = omitted_starts or set()
    nulls = null_starts or set()
    observations: list[tuple[pd.Timestamp, dict[str, float | None]]] = []
    for number, slot in enumerate(route.expected_slots(schedule)):
        if slot.provider_start in omitted:
            continue
        close = 100.0 + number * 0.05
        values: dict[str, float | None] = {
            "open": close - 0.02,
            "high": close + 0.04,
            "low": close - 0.05,
            "close": close,
            "volume": 100_000.0 + number,
        }
        if slot.provider_start in nulls:
            values = {column: None for column in route.OHLCV_COLUMNS}
        observations.append((slot.provider_start, values))
    observations.extend(extra_rows or [])
    observations.sort(key=lambda item: item[0])
    return {
        "chart": {
            "error": None,
            "result": [
                {
                    "meta": {
                        "symbol": "SPY",
                        "instrumentType": "ETF",
                        "exchangeName": "PCX",
                        "fullExchangeName": "NYSEArca",
                        "currency": "USD",
                        "exchangeTimezoneName": "America/New_York",
                        "dataGranularity": "1h",
                    },
                    "timestamp": [
                        int(timestamp.timestamp())
                        for timestamp, _ in observations
                    ],
                    "indicators": {
                        "quote": [
                            {
                                column: [
                                    values[column]
                                    for _, values in observations
                                ]
                                for column in route.OHLCV_COLUMNS
                            }
                        ]
                    },
                    "events": {
                        "dividends": {
                            "fixture": {"amount": 0.25}
                        }
                    },
                }
            ],
        }
    }


class WorkspaceSkillTests(unittest.TestCase):
    def test_route_attempt_preserves_standard_failure_without_false_success(
        self,
    ) -> None:
        runner = load_script(
            "autoquant_skill_route_attempt",
            SKILLS
            / "acquire-market-ohlcv"
            / "scripts"
            / "run_route_attempt.py",
        )
        with tempfile.TemporaryDirectory() as directory:
            audit_path = Path(directory) / "route-failure.json"
            with contextlib.redirect_stderr(io.StringIO()):
                exit_code = runner.run_route(
                    "fixture-provider",
                    audit_path,
                    [
                        sys.executable,
                        "-c",
                        (
                            "import sys; print('blocked', file=sys.stderr); "
                            "sys.exit(7)"
                        ),
                    ],
                )
            self.assertEqual(exit_code, 7)
            record = json.loads(audit_path.read_text(encoding="utf-8"))
            self.assertEqual(
                record["kind"],
                "autoquant-provider-route-failure",
            )
            self.assertEqual(record["provider"], "fixture-provider")
            self.assertEqual(record["exitCode"], 7)
            self.assertIn("blocked", record["stderrTail"])

    def test_canonical_bundle_materializes_and_detects_drift(self) -> None:
        expected_ids = {
            "acquire-market-ohlcv",
            "fetch-binance-ohlcv",
            "fetch-daum-ohlcv",
            "fetch-eastmoney-ohlcv",
            "fetch-euronext-ohlcv",
            "fetch-finmind-ohlcv",
            "fetch-nasdaq-ohlcv",
            "fetch-naver-ohlcv",
            "fetch-nikkei-ohlcv",
            "fetch-sina-ohlcv",
            "fetch-sohu-ohlcv",
            "fetch-tencent-ohlcv",
            "fetch-twse-ohlcv",
            "fetch-vndirect-ohlcv",
            "fetch-yahoo-ohlcv",
            "package-autoquant-ohlcv",
        }
        self.assertEqual(
            {skill["id"] for skill in bundled_workspace_skills()},
            expected_ids,
        )
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = materialize_workspace_skills(root)
            self.assertEqual(
                {skill["id"] for skill in manifest["skills"]},
                expected_ids,
            )
            self.assertEqual(
                verify_materialized_workspace_skills(root),
                manifest,
            )
            for discovery_root in SKILL_DISCOVERY_ROOTS:
                self.assertEqual(
                    {
                        path.name
                        for path in (root / discovery_root).iterdir()
                    },
                    expected_ids,
                )

            drifted = (
                root
                / SKILL_DISCOVERY_ROOTS[0]
                / "acquire-market-ohlcv"
                / "SKILL.md"
            )
            drifted.write_text("drift\n", encoding="utf-8")
            with self.assertRaisesRegex(SkillBundleError, "drifted"):
                verify_materialized_workspace_skills(root)

    def test_daily_close_time_materializer_preserves_values_and_real_transitions(
        self,
    ) -> None:
        materializer = load_script(
            "autoquant_skill_daily_close_time",
            SKILLS
            / "package-autoquant-ohlcv"
            / "scripts"
            / "materialize_daily_close_time.py",
        )
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            _, package_path, authority_path = write_daily_close_time_inputs(
                root,
                materializer,
            )
            output = root / "close-time-output"
            result = materializer.materialize(
                package_path,
                authority_path,
                output,
            )

            self.assertEqual(result["assets"], 2)
            self.assertEqual(result["observations"], 8)
            package = json.loads(
                (output / "dataset-package.json").read_text(encoding="utf-8")
            )
            self.assertEqual(package["schemaVersion"], 5)
            self.assertEqual(package["baseInterval"], "1d")
            self.assertEqual(package["timestampSemantics"], "bar-close")
            self.assertEqual(
                package["market"],
                {
                    "clock": "observed",
                    "calendar": "provider-observed",
                    "timezone": "UTC",
                },
            )
            audit = json.loads(
                (output / "close-time-audit.json").read_text(encoding="utf-8")
            )
            self.assertIn(
                {
                    "sessionDate": "2024-11-05",
                    "previousCloseTimeUtc": "20:00:00Z",
                    "scheduledCloseTimeUtc": "21:00:00Z",
                },
                audit["assets"]["SPY"]["closeTimeTransitions"],
            )
            self.assertIn(
                {
                    "sessionDate": "2024-11-05",
                    "previousCloseTimeUtc": "06:00:00Z",
                    "scheduledCloseTimeUtc": "06:30:00Z",
                },
                audit["assets"]["7203.T"]["closeTimeTransitions"],
            )
            self.assertEqual(
                audit["assets"]["SPY"]["sourceOhlcvSha256"],
                audit["assets"]["SPY"]["outputOhlcvSha256"],
            )
            self.assertTrue(
                audit["assets"]["7203.T"]["preservation"][
                    "ohlcvValuesUnchanged"
                ]
            )
            toyota = pd.read_csv(output / "assets" / "7203.T.csv")
            spy = pd.read_csv(output / "assets" / "SPY.csv")
            self.assertEqual(
                toyota["timestamp"].tolist(),
                [
                    "2024-10-31T06:00:00Z",
                    "2024-11-01T06:00:00Z",
                    "2024-11-05T06:30:00Z",
                    "2024-11-06T06:30:00Z",
                ],
            )
            self.assertEqual(
                spy["timestamp"].tolist(),
                [
                    "2024-10-31T20:00:00Z",
                    "2024-11-01T20:00:00Z",
                    "2024-11-05T21:00:00Z",
                    "2024-11-06T21:00:00Z",
                ],
            )

    def test_daily_close_time_materializer_fails_closed_without_partial_output(
        self,
    ) -> None:
        materializer = load_script(
            "autoquant_skill_daily_close_time_failures",
            SKILLS
            / "package-autoquant-ohlcv"
            / "scripts"
            / "materialize_daily_close_time.py",
        )

        def mutate_unknown_calendar(root, package_path, authority_path):
            authority = json.loads(authority_path.read_text(encoding="utf-8"))
            authority["assets"][0]["calendar"] = "NOT-A-CALENDAR"
            authority_path.write_text(json.dumps(authority), encoding="utf-8")

        def mutate_timezone(root, package_path, authority_path):
            authority = json.loads(authority_path.read_text(encoding="utf-8"))
            authority["assets"][0]["timezone"] = "UTC"
            authority_path.write_text(json.dumps(authority), encoding="utf-8")

        def mutate_inventory(root, package_path, authority_path):
            authority = json.loads(authority_path.read_text(encoding="utf-8"))
            authority["assets"].pop()
            authority_path.write_text(json.dumps(authority), encoding="utf-8")

        def mutate_non_session(root, package_path, authority_path):
            source = package_path.parent / "7203.T.csv"
            frame = pd.read_csv(source)
            frame.loc[len(frame) - 1, "date"] = "2024-11-09"
            frame.to_csv(source, index=False)

        def mutate_symlink(root, package_path, authority_path):
            source = package_path.parent / "7203.T.csv"
            outside = root / "outside.csv"
            shutil.move(source, outside)
            source.symlink_to(outside)

        def mutate_source_contract(root, package_path, authority_path):
            package = json.loads(package_path.read_text(encoding="utf-8"))
            package["schemaVersion"] = 3
            package_path.write_text(json.dumps(package), encoding="utf-8")
            authority = json.loads(authority_path.read_text(encoding="utf-8"))
            authority["sourcePackage"]["sha256"] = file_sha256(package_path)
            authority_path.write_text(json.dumps(authority), encoding="utf-8")

        cases = (
            ("unknown-calendar", mutate_unknown_calendar, "unknown or unavailable"),
            ("timezone", mutate_timezone, "differs from XTKS timezone"),
            ("inventory", mutate_inventory, "inventory must exactly match"),
            ("non-session", mutate_non_session, "is not a XTKS session"),
            ("symlink", mutate_symlink, "cannot traverse a symlink"),
            ("source-contract", mutate_source_contract, "must be strict AutoQuant V4"),
        )
        for label, mutate, expected in cases:
            with self.subTest(case=label), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                _, package_path, authority_path = write_daily_close_time_inputs(
                    root,
                    materializer,
                )
                output = root / "output"
                mutate(root, package_path, authority_path)
                with self.assertRaisesRegex(ValueError, expected):
                    materializer.materialize(package_path, authority_path, output)
                self.assertFalse(output.exists())
                self.assertEqual(list(root.glob(".output.creating-*")), [])

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            _, package_path, authority_path = write_daily_close_time_inputs(
                root,
                materializer,
            )
            output = root / "output"
            output.mkdir()
            with self.assertRaisesRegex(ValueError, "output must be absent"):
                materializer.materialize(package_path, authority_path, output)
            self.assertEqual(list(output.iterdir()), [])

    def test_daily_close_time_package_runs_through_factor_report(self) -> None:
        materializer = load_script(
            "autoquant_skill_daily_close_time_integration",
            SKILLS
            / "package-autoquant-ohlcv"
            / "scripts"
            / "materialize_daily_close_time.py",
        )
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            request_path, package_path, authority_path = (
                write_daily_close_time_inputs(
                    root,
                    materializer,
                    long_history=True,
                )
            )
            output = root / "close-time-output"
            materializer.materialize(package_path, authority_path, output)
            prepared = prepare_project_intake(
                request_path,
                output / "dataset-package.json",
                "ohlcv-factor-lab",
            )
            self.assertEqual(prepared.package["schemaVersion"], 5)
            self.assertEqual(prepared.package["baseInterval"], "1d")
            workspace = initialize_workspace(root / "workspace")
            project = create_project(
                workspace.root_dir,
                "calendar-close-factor",
                template=prepared.template,
                template_intake=prepared,
            )
            (project.root_dir / "factors" / "candidate.py").write_text(
                """\
from __future__ import annotations

import pandas as pd


def compute_factor(panel: pd.DataFrame) -> pd.Series:
    result = pd.Series(float("nan"), index=panel.index, dtype=float)
    target = (
        panel.loc[panel["asset"].eq("7203.T"), ["timestamp"]]
        .assign(row_index=lambda frame: frame.index)
        .sort_values("timestamp", kind="stable")
    )
    context = (
        panel.loc[panel["asset"].eq("SPY"), ["timestamp", "close"]]
        .sort_values("timestamp", kind="stable")
    )
    context["completed_return"] = context["close"].pct_change(fill_method=None)
    aligned = pd.merge_asof(
        target,
        context[["timestamp", "completed_return"]],
        on="timestamp",
        direction="backward",
        allow_exact_matches=True,
    )
    result.loc[aligned["row_index"].to_numpy()] = aligned[
        "completed_return"
    ].to_numpy()
    return result
""",
                encoding="utf-8",
            )
            run = execute_study(project, OHLCV_STUDY_ID)
            self.assertEqual(run.result["status"], "succeeded", run.result["errors"])
            diagnostics = load_factor_diagnostics(project, run.result["id"])
            self.assertEqual(
                diagnostics["inputAvailability"]["timestamps"],
                run.result["metrics"]["input_availability"]["timestamps"],
            )
            report = publish_run_report(
                project,
                OHLCV_STUDY_ID,
                run.result["id"],
                {
                    "schemaVersion": 1,
                    "kind": "autoquant-research-report-analysis",
                    "title": "Calendar-derived close-time evidence",
                    "executiveSummary": (
                        "The deterministic package completed the public Factor path."
                    ),
                    "findings": [
                        {
                            "id": "calendar-close-path",
                            "claim": "The V4 source was admitted only after exact close materialization.",
                            "confidence": "high",
                            "evidenceRefs": [
                                {
                                    "kind": "run",
                                    "id": run.result["id"],
                                    "artifactPath": "artifacts/factor-report.json",
                                }
                            ],
                        }
                    ],
                    "recommendations": [],
                    "limitations": [
                        "The deterministic fixture is not market evidence."
                    ],
                    "unresolvedQuestions": [],
                },
            )
            self.assertEqual(
                report.report["anchor"]["runId"],
                run.result["id"],
            )

    def test_observed_package_composition_preserves_bytes_and_runs_factor_report(
        self,
    ) -> None:
        compositor = load_script(
            "autoquant_skill_observed_compositor",
            SKILLS
            / "package-autoquant-ohlcv"
            / "scripts"
            / "compose_observed_packages.py",
        )
        package_audit = load_script(
            "autoquant_skill_v6_package_audit",
            SKILLS
            / "package-autoquant-ohlcv"
            / "scripts"
            / "audit_ohlcv_package.py",
        )
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            request_path, authority_path, source_packages = (
                write_observed_composition_inputs(root)
            )
            output = root / "composed"
            result = compositor.compose(authority_path, output)
            self.assertEqual(result["sources"], 2)
            self.assertEqual(result["assets"], 2)
            package_path = output / "dataset-package.json"
            package = json.loads(package_path.read_text(encoding="utf-8"))
            self.assertEqual(package["schemaVersion"], 6)
            jsonschema.validate(package, OHLCV_DATASET_PACKAGE_JSON_SCHEMA)
            self.assertEqual(
                [source["id"] for source in package["sources"]],
                ["tokyo-source", "new-york-source"],
            )
            self.assertEqual(
                [asset["sourceId"] for asset in package["assets"]],
                ["tokyo-source", "new-york-source"],
            )
            for source_package, asset in zip(
                source_packages,
                package["assets"],
                strict=True,
            ):
                source_manifest = json.loads(
                    source_package.read_text(encoding="utf-8")
                )
                source_asset = source_package.parent / source_manifest["assets"][0]["path"]
                self.assertEqual(
                    file_sha256(source_asset),
                    file_sha256(output / asset["path"]),
                )
            audit = json.loads(
                (output / "composition-audit.json").read_text(encoding="utf-8")
            )
            self.assertFalse(audit["composition"]["alignment"])
            self.assertFalse(audit["composition"]["fill"])
            self.assertTrue(
                all(
                    asset["preservation"]["bytesUnchanged"]
                    for source in audit["sources"]
                    for asset in source["assets"]
                )
            )
            independent_audit = package_audit.audit(package_path)
            self.assertEqual(independent_audit["datasetSchemaVersion"], 6)
            self.assertEqual(
                {item["id"] for item in independent_audit["sources"]},
                {"tokyo-source", "new-york-source"},
            )

            prepared = prepare_project_intake(
                request_path,
                package_path,
                "ohlcv-factor-lab",
            )
            self.assertEqual(prepared.package["schemaVersion"], 6)
            self.assertTrue(prepared.multi_source)
            self.assertEqual(
                [asset.source_id for asset in prepared.assets],
                ["tokyo-source", "new-york-source"],
            )
            cli_workspace = initialize_workspace(root / "cli-workspace")
            cli_result = subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "autoquant",
                    "project",
                    "intake",
                    str(cli_workspace.root_dir),
                    "multi-source-cli",
                    "--request",
                    str(request_path),
                    "--dataset",
                    str(package_path),
                    "--template",
                    "ohlcv-factor-lab",
                    "--json",
                ],
                cwd=ROOT,
                capture_output=True,
                check=False,
                text=True,
            )
            self.assertEqual(cli_result.returncode, 0, cli_result.stderr)
            cli_envelope = json.loads(cli_result.stdout)
            self.assertEqual(
                [
                    source["id"]
                    for source in cli_envelope["data"]["intake"]["dataset"]["sources"]
                ],
                ["tokyo-source", "new-york-source"],
            )
            workspace = initialize_workspace(root / "workspace")
            project = create_project(
                workspace.root_dir,
                "multi-source-factor",
                template=prepared.template,
                template_intake=prepared,
            )
            candidate_contract = build_agent_work_brief(project)[
                "candidateContract"
            ]
            self.assertEqual(
                candidate_contract["data"]["surfaceSource"],
                "content-locked-snapshot-v6",
            )
            self.assertEqual(
                candidate_contract["data"]["observationSemantics"],
                {
                    "timestampMeaning": "completed-bar-close",
                    "panelShape": "ragged-observed-only",
                    "missingObservation": "absent-no-fill",
                    "contextVisibility": (
                        "Candidate code may use only observations whose "
                        "timestamp is at or before the evaluated row "
                        "timestamp; absent context remains absent unless the "
                        "candidate performs an explicit backward as-of "
                        "operation."
                    ),
                    "targetClock": "per-target-observed-bars",
                },
            )
            jsonschema.validate(
                candidate_contract,
                FACTOR_CANDIDATE_CONTRACT_JSON_SCHEMA,
            )
            (project.root_dir / "factors" / "candidate.py").write_text(
                """\
from __future__ import annotations

import pandas as pd


def compute_factor(panel: pd.DataFrame) -> pd.Series:
    result = pd.Series(float("nan"), index=panel.index, dtype=float)
    target = (
        panel.loc[panel["asset"].eq("7203.T"), ["timestamp"]]
        .assign(row_index=lambda frame: frame.index)
        .sort_values("timestamp", kind="stable")
    )
    context = (
        panel.loc[panel["asset"].eq("SPY"), ["timestamp", "close"]]
        .sort_values("timestamp", kind="stable")
    )
    context["completed_return"] = context["close"].pct_change(fill_method=None)
    aligned = pd.merge_asof(
        target,
        context[["timestamp", "completed_return"]],
        on="timestamp",
        direction="backward",
        allow_exact_matches=True,
    )
    result.loc[aligned["row_index"].to_numpy()] = aligned[
        "completed_return"
    ].to_numpy()
    return result
""",
                encoding="utf-8",
            )
            run = execute_study(project, OHLCV_STUDY_ID)
            self.assertEqual(run.result["status"], "succeeded", run.result["errors"])
            report = publish_run_report(
                project,
                OHLCV_STUDY_ID,
                run.result["id"],
                {
                    "schemaVersion": 1,
                    "kind": "autoquant-research-report-analysis",
                    "title": "Multi-source observed Factor evidence",
                    "executiveSummary": "The strict V6 path completed.",
                    "findings": [
                        {
                            "id": "v6-path",
                            "claim": "Distinct source authority survived intake and execution.",
                            "confidence": "high",
                            "evidenceRefs": [
                                {
                                    "kind": "run",
                                    "id": run.result["id"],
                                    "artifactPath": "artifacts/factor-report.json",
                                }
                            ],
                        }
                    ],
                    "recommendations": [],
                    "limitations": ["The fixture is not market evidence."],
                    "unresolvedQuestions": [],
                },
            )
            self.assertEqual(report.report["anchor"]["runId"], run.result["id"])
            studio = build_studio_snapshot(workspace.root_dir)
            studio_project = next(
                item
                for item in studio["projects"]
                if item["id"] == "multi-source-factor"
            )
            self.assertEqual(
                [
                    source["provider"]["name"]
                    for source in studio_project["intake"]["dataset"]["sources"]
                ],
                ["fixture-yahoo", "fixture-nasdaq"],
            )
            snapshot_path = project.root_dir / "data" / "ohlcv" / "snapshot.json"
            snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
            snapshot["assets"][0]["sourceId"] = "unknown-source"
            snapshot_path.write_text(
                json.dumps(snapshot, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            intake_path = project.root_dir / "intake.json"
            intake = json.loads(intake_path.read_text(encoding="utf-8"))
            intake["datasetSnapshotHash"] = file_sha256(snapshot_path)
            intake_path.write_text(
                json.dumps(intake, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "sourceId must name one declared source",
            ):
                load_project_intake(project)

    def test_observed_package_composition_fails_closed_on_unsafe_or_incompatible_inputs(
        self,
    ) -> None:
        compositor = load_script(
            "autoquant_skill_observed_compositor_failures",
            SKILLS
            / "package-autoquant-ohlcv"
            / "scripts"
            / "compose_observed_packages.py",
        )

        def rewrite_hash(authority_path: Path, package_path: Path) -> None:
            authority = json.loads(authority_path.read_text(encoding="utf-8"))
            for source in authority["sourcePackages"]:
                if source["path"] == package_path.relative_to(
                    authority_path.parent
                ).as_posix():
                    source["sha256"] = file_sha256(package_path)
            authority_path.write_text(json.dumps(authority), encoding="utf-8")

        def one_source(root, authority_path, packages):
            authority = json.loads(authority_path.read_text(encoding="utf-8"))
            authority["sourcePackages"].pop()
            authority_path.write_text(json.dumps(authority), encoding="utf-8")

        def same_provider(root, authority_path, packages):
            left = json.loads(packages[0].read_text(encoding="utf-8"))
            right = json.loads(packages[1].read_text(encoding="utf-8"))
            right["provider"] = left["provider"]
            packages[1].write_text(json.dumps(right), encoding="utf-8")
            rewrite_hash(authority_path, packages[1])

        def adjustment_mismatch(root, authority_path, packages):
            package = json.loads(packages[1].read_text(encoding="utf-8"))
            package["priceAdjustment"] = "raw"
            packages[1].write_text(json.dumps(package), encoding="utf-8")
            rewrite_hash(authority_path, packages[1])

        def duplicate_symbol(root, authority_path, packages):
            package = json.loads(packages[1].read_text(encoding="utf-8"))
            package["assets"][0]["symbol"] = "7203.T"
            packages[1].write_text(json.dumps(package), encoding="utf-8")
            rewrite_hash(authority_path, packages[1])

        def tampered_hash(root, authority_path, packages):
            authority = json.loads(authority_path.read_text(encoding="utf-8"))
            authority["sourcePackages"][0]["sha256"] = "0" * 64
            authority_path.write_text(json.dumps(authority), encoding="utf-8")

        def invalid_v5(root, authority_path, packages):
            package = json.loads(packages[1].read_text(encoding="utf-8"))
            package["schemaVersion"] = 4
            packages[1].write_text(json.dumps(package), encoding="utf-8")
            rewrite_hash(authority_path, packages[1])

        def symlink_manifest(root, authority_path, packages):
            outside = root / "outside-package.json"
            shutil.move(packages[1], outside)
            packages[1].symlink_to(outside)

        cases = (
            ("one-source", one_source, "at least two packages"),
            ("same-provider", same_provider, "distinct provider claims"),
            ("adjustment", adjustment_mismatch, "disagree on priceAdjustment"),
            ("duplicate-symbol", duplicate_symbol, "inventories must be disjoint"),
            ("tampered-hash", tampered_hash, "does not bind source package"),
            ("invalid-v5", invalid_v5, "strict AutoQuant V5"),
            ("symlink", symlink_manifest, "cannot traverse a symlink"),
        )
        for label, mutate, expected in cases:
            with self.subTest(case=label), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                _, authority_path, packages = write_observed_composition_inputs(
                    root,
                    observations=8,
                )
                output = root / "output"
                mutate(root, authority_path, packages)
                with self.assertRaisesRegex(ValueError, expected):
                    compositor.compose(authority_path, output)
                self.assertFalse(output.exists())
                self.assertEqual(list(root.glob(".output.creating-*")), [])

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            _, authority_path, _ = write_observed_composition_inputs(
                root,
                observations=8,
            )
            output = root / "output"
            output.mkdir()
            with self.assertRaisesRegex(ValueError, "output must be absent"):
                compositor.compose(authority_path, output)
            self.assertEqual(list(output.iterdir()), [])

    def test_workspace_init_materializes_skills_and_conflict_rolls_back(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace = initialize_workspace(Path(directory) / "new")
            verified = verify_materialized_workspace_skills(
                workspace.root_dir
            )
            self.assertTrue((workspace.root_dir / WORKSPACE_SKILLS_MANIFEST).is_file())
            self.assertEqual(len(verified["skills"]), 16)

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "adopted"
            conflict = (
                root
                / ".agents"
                / "skills"
                / "acquire-market-ohlcv"
            )
            conflict.mkdir(parents=True)
            marker = conflict / "caller.txt"
            marker.write_text("preserve\n", encoding="utf-8")
            with self.assertRaises(AutoQuantValidationError) as caught:
                initialize_workspace(root, adopt_existing=True)
            self.assertEqual(
                {issue.code for issue in caught.exception.issues},
                {"workspace.skill-bundle"},
            )
            self.assertEqual(marker.read_text(encoding="utf-8"), "preserve\n")
            self.assertFalse((root / WORKSPACE_MANIFEST).exists())
            self.assertFalse((root / "projects").exists())

    def test_yahoo_adjustment_applies_ratio_to_all_ohlc_only(self) -> None:
        yahoo = load_script(
            "autoquant_skill_yahoo",
            SKILLS
            / "fetch-yahoo-ohlcv"
            / "scripts"
            / "fetch_yahoo_daily.py",
        )
        result = {
            "timestamp": [1_704_153_600, 1_704_240_000],
            "indicators": {
                "quote": [
                    {
                        "open": [100.0, 110.0],
                        "high": [120.0, 115.0],
                        "low": [90.0, 100.0],
                        "close": [100.0, 110.0],
                        "volume": [1_000.0, 2_000.0],
                    }
                ],
                "adjclose": [{"adjclose": [50.0, 110.0]}],
            },
        }
        frame, audit = yahoo.frame_for(
            "SYNTH",
            result,
            "split-and-dividend-adjusted",
        )
        self.assertEqual(frame.loc[0, "open"], 50.0)
        self.assertEqual(frame.loc[0, "high"], 60.0)
        self.assertEqual(frame.loc[0, "low"], 45.0)
        self.assertEqual(frame.loc[0, "close"], 50.0)
        self.assertEqual(frame.loc[0, "volume"], 1_000.0)
        self.assertEqual(audit["adjustedFactorRows"], 1)

    def test_yahoo_session_date_boundary_is_applied_after_parsing(self) -> None:
        yahoo = load_script(
            "autoquant_skill_yahoo_bounds",
            SKILLS
            / "fetch-yahoo-ohlcv"
            / "scripts"
            / "fetch_yahoo_daily.py",
        )
        frame = pd.DataFrame(
            {
                "date": ["2026-07-29", "2026-07-30"],
                "open": [1.0, 2.0],
                "high": [1.0, 2.0],
                "low": [1.0, 2.0],
                "close": [1.0, 2.0],
                "volume": [10.0, 20.0],
            }
        )
        bounded, dropped = yahoo.bound_session_dates(
            frame,
            yahoo.parse_date("2026-07-29"),
            yahoo.parse_date("2026-07-30"),
        )
        self.assertEqual(bounded["date"].tolist(), ["2026-07-29"])
        self.assertEqual(dropped, 1)

    def test_yahoo_uses_exchange_timezone_for_session_date(self) -> None:
        yahoo = load_script(
            "autoquant_skill_yahoo_timezone",
            SKILLS
            / "fetch-yahoo-ohlcv"
            / "scripts"
            / "fetch_yahoo_daily.py",
        )
        timestamp = int(
            pd.Timestamp("2025-01-01T17:00:00Z").timestamp()
        )
        result = {
            "meta": {"exchangeTimezoneName": "Asia/Ho_Chi_Minh"},
            "timestamp": [timestamp],
            "indicators": {
                "quote": [
                    {
                        "open": [100.0],
                        "high": [101.0],
                        "low": [99.0],
                        "close": [100.0],
                        "volume": [1_000.0],
                    }
                ]
            },
        }
        frame, audit = yahoo.frame_for(
            "VNM.VN",
            result,
            "split-adjusted",
        )
        self.assertEqual(frame.loc[0, "date"], "2025-01-02")
        self.assertEqual(
            audit["sessionDateTimezone"],
            "Asia/Ho_Chi_Minh",
        )

    def test_yahoo_intraday_maps_bucket_starts_and_early_close(self) -> None:
        intraday = load_script(
            "autoquant_skill_yahoo_intraday_mapping",
            SKILLS
            / "fetch-yahoo-ohlcv"
            / "scripts"
            / "fetch_yahoo_intraday.py",
        )
        schedule = intraday.requested_schedule(
            intraday.parse_date("2024-11-27"),
            intraday.parse_date("2024-11-30"),
        )
        payload = yahoo_intraday_payload(intraday, schedule)
        result = intraday.result_for("SPY", payload)
        frame, audit = intraday.evaluate_result("SPY", result, schedule)

        self.assertIsNotNone(frame)
        assert frame is not None
        slots = intraday.expected_slots(schedule)
        self.assertEqual(len(slots), 11)
        self.assertEqual(len(frame), 11)
        self.assertEqual(
            frame["timestamp"].tolist(),
            [intraday.utc_iso(slot.canonical_close) for slot in slots],
        )
        self.assertEqual(
            frame.iloc[-1]["timestamp"],
            "2024-11-29T18:00:00+00:00",
        )
        self.assertEqual(frame.iloc[-1]["close"], 100.5)
        self.assertEqual(audit["status"], "accepted")
        self.assertEqual(audit["missingRows"], 0)
        self.assertIn("OHLCV values unchanged", audit["timestampTransformation"])

    def test_yahoo_intraday_rejects_missing_null_and_close_marker_rows(
        self,
    ) -> None:
        intraday = load_script(
            "autoquant_skill_yahoo_intraday_gap",
            SKILLS
            / "fetch-yahoo-ohlcv"
            / "scripts"
            / "fetch_yahoo_intraday.py",
        )
        schedule = intraday.requested_schedule(
            intraday.parse_date("2024-11-29"),
            intraday.parse_date("2024-11-30"),
        )
        slots = intraday.expected_slots(schedule)
        close_marker = schedule.iloc[0].close
        payload = yahoo_intraday_payload(
            intraday,
            schedule,
            omitted_starts={slots[-1].provider_start},
            null_starts={slots[1].provider_start},
            extra_rows=[
                (
                    close_marker,
                    {
                        "open": 100.0,
                        "high": 102.0,
                        "low": 99.0,
                        "close": 101.0,
                        "volume": 0.0,
                    },
                )
            ],
        )
        frame, audit = intraday.evaluate_result(
            "SPY",
            intraday.result_for("SPY", payload),
            schedule,
        )

        self.assertIsNone(frame)
        self.assertEqual(audit["status"], "rejected")
        self.assertEqual(audit["missingRows"], 1)
        self.assertEqual(audit["invalidRows"], 1)
        self.assertEqual(audit["unexpectedRows"], 1)
        self.assertEqual(
            {issue["code"] for issue in audit["issues"]},
            {
                "provider.noncanonical-start",
                "provider.missing-bars",
                "provider.invalid-bars",
            },
        )

    def test_yahoo_intraday_rejects_duplicate_metadata_and_value_defects(
        self,
    ) -> None:
        intraday = load_script(
            "autoquant_skill_yahoo_intraday_defects",
            SKILLS
            / "fetch-yahoo-ohlcv"
            / "scripts"
            / "fetch_yahoo_intraday.py",
        )
        schedule = intraday.requested_schedule(
            intraday.parse_date("2026-04-01"),
            intraday.parse_date("2026-04-03"),
        )
        payload = yahoo_intraday_payload(intraday, schedule)
        base = payload["chart"]["result"][0]
        cases: list[tuple[str, dict, str]] = []

        wrong_timezone = json.loads(json.dumps(base))
        wrong_timezone["meta"]["exchangeTimezoneName"] = "UTC"
        cases.append(("timezone", wrong_timezone, "provider.timezone"))

        wrong_interval = json.loads(json.dumps(base))
        wrong_interval["meta"]["dataGranularity"] = "30m"
        cases.append(("interval", wrong_interval, "provider.interval"))

        duplicate = json.loads(json.dumps(base))
        duplicate["timestamp"].insert(1, duplicate["timestamp"][0])
        for column in intraday.OHLCV_COLUMNS:
            duplicate["indicators"]["quote"][0][column].insert(
                1,
                duplicate["indicators"]["quote"][0][column][0],
            )
        cases.append(("duplicate", duplicate, "provider.duplicate-start"))

        invalid_ohlc = json.loads(json.dumps(base))
        quote = invalid_ohlc["indicators"]["quote"][0]
        quote["high"][0] = quote["open"][0] - 1.0
        cases.append(("ohlc", invalid_ohlc, "provider.invalid-bars"))

        negative_volume = json.loads(json.dumps(base))
        negative_volume["indicators"]["quote"][0]["volume"][0] = -1.0
        cases.append(("volume", negative_volume, "provider.invalid-bars"))

        unequal_arrays = json.loads(json.dumps(base))
        unequal_arrays["indicators"]["quote"][0]["volume"].pop()
        cases.append(("shape", unequal_arrays, "provider.array-length"))

        for label, result, expected_code in cases:
            with self.subTest(label=label):
                frame, audit = intraday.evaluate_result(
                    "SPY",
                    result,
                    schedule,
                )
                self.assertIsNone(frame)
                self.assertIn(
                    expected_code,
                    {issue["code"] for issue in audit["issues"]},
                )

    def test_yahoo_intraday_range_includes_required_warmup(self) -> None:
        intraday = load_script(
            "autoquant_skill_yahoo_intraday_range",
            SKILLS
            / "fetch-yahoo-ohlcv"
            / "scripts"
            / "fetch_yahoo_intraday.py",
        )
        first_open = pd.Timestamp("2024-08-01T13:30:00Z")
        exact = intraday.range_eligibility(
            first_open,
            pd.Timestamp("2026-08-01T12:30:00Z").to_pydatetime(),
        )
        self.assertTrue(exact["locallyEligible"])
        self.assertEqual(
            exact["providerPeriod1"],
            "2024-08-01T12:30:00+00:00",
        )
        outside = intraday.range_eligibility(
            first_open,
            pd.Timestamp("2026-08-01T12:30:01Z").to_pydatetime(),
        )
        self.assertFalse(outside["locallyEligible"])

    def test_yahoo_intraday_main_emits_intake_ready_v3_or_failure_only(
        self,
    ) -> None:
        intraday = load_script(
            "autoquant_skill_yahoo_intraday_main",
            SKILLS
            / "fetch-yahoo-ohlcv"
            / "scripts"
            / "fetch_yahoo_intraday.py",
        )
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            assets = root / "assets.json"
            symbols = ("SPY", "QQQ", "IWM", "TLT", "GLD")
            assets.write_text(
                json.dumps(
                    [
                        {
                            "symbol": symbol,
                            "providerSymbol": symbol,
                            "venue": "ARCX",
                            "currency": "USD",
                            "assetClass": "fund",
                        }
                        for symbol in symbols
                    ]
                ),
                encoding="utf-8",
            )
            start = intraday.parse_date("2026-04-01")
            end_exclusive = intraday.parse_date("2026-06-06")
            schedule = intraday.requested_schedule(start, end_exclusive)
            body = json.dumps(
                yahoo_intraday_payload(intraday, schedule)
            ).encode()
            output = root / "success"
            argv = [
                "fetch_yahoo_intraday.py",
                "--output",
                str(output),
                "--assets",
                str(assets),
                "--dataset-id",
                "us-etf-hourly-fixture",
                "--start",
                start.isoformat(),
                "--end-exclusive",
                end_exclusive.isoformat(),
                "--calendar",
                "XNYS",
                "--timezone",
                "America/New_York",
                "--interval",
                "1h",
                "--feature-interval",
                "1d",
                "--adjustment",
                "split-adjusted",
                "--panel",
                "aligned",
                "--terms",
                "deterministic fixture only",
            ]
            attempts = [
                {
                    "attempt": 1,
                    "attemptedAt": "2026-08-01T00:00:00+00:00",
                    "status": 200,
                    "headers": {"Content-Type": "application/json"},
                    "bodyBytes": len(body),
                    "bodySha256": intraday.sha256_bytes(body),
                }
            ]
            with mock.patch.object(
                intraday,
                "fetch_bytes",
                return_value=(body, attempts),
            ), mock.patch.object(sys, "argv", argv), contextlib.redirect_stdout(
                io.StringIO()
            ):
                intraday.main()

            package_path = output / "dataset-package.json"
            package = json.loads(package_path.read_text(encoding="utf-8"))
            self.assertEqual(package["schemaVersion"], 3)
            self.assertEqual(package["baseInterval"], "1h")
            self.assertEqual(package["featureIntervals"], ["1d"])
            self.assertFalse((output / "provider-failure.json").exists())
            self.assertTrue((output / "provider-audit.json").is_file())

            request = {
                "schemaVersion": 1,
                "kind": "autoquant-research-request",
                "title": "Hourly ETF reversal fixture",
                "question": "Does completed hourly reversal predict four bars?",
                "decisionContext": "Deterministic intake contract test.",
                "assets": [
                    {
                        "symbol": symbol,
                        "assetClass": "fund",
                        "venue": "ARCX",
                    }
                    for symbol in symbols
                ],
                "direction": "long",
                "factorPolicy": {
                    "claim": "novel-factor",
                    "knownStyle": None,
                },
                "horizonPolicy": {
                    "primaryForwardBars": 4,
                    "diagnosticForwardBars": [1, 4, 8],
                },
                "horizon": "Four completed hourly bars.",
                "hypotheses": ["Short-horizon reversal may be measurable."],
                "constraints": ["No live trading authority."],
                "deliverables": ["Factor evidence"],
                "source": {
                    "system": "openalice",
                    "workspaceId": "workspace-fixture",
                    "sessionId": "session-fixture",
                    "artifactPath": None,
                    "artifactRevision": None,
                },
            }
            request_path = root / "request.json"
            request_path.write_text(json.dumps(request), encoding="utf-8")
            prepared = prepare_project_intake(
                request_path,
                package_path,
                "ohlcv-factor-lab",
            )
            self.assertEqual(prepared.package["schemaVersion"], 3)
            self.assertEqual(
                prepared.interval_surface["featureIntervals"],
                ["1d"],
            )

            failed_output = root / "failure"
            failed_schedule = intraday.requested_schedule(
                intraday.parse_date("2026-04-01"),
                intraday.parse_date("2026-04-04"),
            )
            missing = intraday.expected_slots(failed_schedule)[2].provider_start
            failed_body = json.dumps(
                yahoo_intraday_payload(
                    intraday,
                    failed_schedule,
                    omitted_starts={missing},
                )
            ).encode()
            failed_argv = list(argv)
            failed_argv[2] = str(failed_output)
            failed_argv[8] = "2026-04-01"
            failed_argv[10] = "2026-04-04"
            with mock.patch.object(
                intraday,
                "fetch_bytes",
                side_effect=[
                    *((body, attempts),) * (len(symbols) - 1),
                    (failed_body, attempts),
                ],
            ), mock.patch.object(sys, "argv", failed_argv):
                with self.assertRaisesRegex(
                    RuntimeError,
                    "cannot form exact XNYS V3 authority",
                ):
                    intraday.main()
            failure = json.loads(
                (failed_output / "provider-failure.json").read_text(
                    encoding="utf-8"
                )
            )
            self.assertEqual(failure["status"], "no-dataset-authority")
            self.assertFalse(failure["packageCreated"])
            self.assertEqual(
                [item.get("symbol") for item in failure["failures"]],
                ["GLD"],
            )
            self.assertFalse((failed_output / "dataset-package.json").exists())

    def test_yahoo_invalid_ohlc_requires_explicit_audited_drop(self) -> None:
        yahoo = load_script(
            "autoquant_skill_yahoo_invalid_ohlc",
            SKILLS
            / "fetch-yahoo-ohlcv"
            / "scripts"
            / "fetch_yahoo_daily.py",
        )
        result = {
            "timestamp": [1_704_153_600, 1_704_240_000],
            "indicators": {
                "quote": [
                    {
                        "open": [100.0, 110.0],
                        "high": [101.0, 109.9],
                        "low": [99.0, 100.0],
                        "close": [100.5, 110.0],
                        "volume": [1_000.0, 2_000.0],
                    }
                ]
            },
        }

        with self.assertRaisesRegex(ValueError, "drop-observation"):
            yahoo.frame_for("SYNTH", result, "split-adjusted")

        frame, audit = yahoo.frame_for(
            "SYNTH",
            result,
            "split-adjusted",
            "drop-observation",
        )
        self.assertEqual(frame["date"].tolist(), ["2024-01-02"])
        self.assertEqual(audit["invalidOhlcPolicy"], "drop-observation")
        self.assertEqual(audit["invalidOhlcBoundsRows"], 1)
        self.assertEqual(audit["invalidOhlcBoundsRowsDropped"], 1)
        self.assertEqual(audit["invalidOhlcBoundsDropLimit"], 1)
        self.assertEqual(
            audit["invalidOhlcBoundsObservations"],
            [
                {
                    "date": "2024-01-03",
                    "open": 110.0,
                    "high": 109.9,
                    "low": 100.0,
                    "close": 110.0,
                    "volume": 2_000.0,
                }
            ],
        )

        excessive = {
            "timestamp": list(
                range(
                    1_704_153_600,
                    1_704_153_600 + 100 * 86_400,
                    86_400,
                )
            ),
            "indicators": {
                "quote": [
                    {
                        "open": [100.0] * 100,
                        "high": [99.0, 99.0] + [101.0] * 98,
                        "low": [99.0] * 100,
                        "close": [100.0] * 100,
                        "volume": [1_000.0] * 100,
                    }
                ]
            },
        }
        with self.assertRaisesRegex(ValueError, "exceed audited drop limit 1"):
            yahoo.frame_for(
                "SYNTH",
                excessive,
                "split-adjusted",
                "drop-observation",
            )

        summary = yahoo.invalid_ohlc_summary(
            {
                "8035.T": {
                    **audit,
                    "providerSymbol": "8035.T",
                },
                "8306.T": {
                    **audit,
                    "providerSymbol": "8306.T",
                    "invalidOhlcBoundsObservations": [
                        {
                            **audit["invalidOhlcBoundsObservations"][0],
                            "date": "2024-01-04",
                        }
                    ],
                },
                "7203.T": {
                    "providerSymbol": "7203.T",
                    "invalidOhlcPolicy": "drop-observation",
                    "invalidOhlcBoundsRowsDropped": 0,
                    "invalidOhlcBoundsObservations": [],
                },
            }
        )
        self.assertEqual(summary["policy"], "drop-observation")
        self.assertEqual(summary["affectedAssets"], ["8035.T", "8306.T"])
        self.assertEqual(summary["observationsFound"], 2)
        self.assertEqual(summary["observationsDropped"], 2)
        self.assertEqual(
            [item["symbol"] for item in summary["observations"]],
            ["8035.T", "8306.T"],
        )

    def test_yahoo_transient_price_scale_requires_separate_audited_drop(
        self,
    ) -> None:
        yahoo = load_script(
            "autoquant_skill_yahoo_transient_scale",
            SKILLS
            / "fetch-yahoo-ohlcv"
            / "scripts"
            / "fetch_yahoo_daily.py",
        )
        rows = 1_001
        closes = [100.0] * rows
        closes[500:503] = [10.0, 10.2, 101.0]
        result = {
            "timestamp": [
                1_704_153_600 + offset * 86_400
                for offset in range(rows)
            ],
            "indicators": {
                "quote": [
                    {
                        "open": closes,
                        "high": [value * 1.01 for value in closes],
                        "low": [value * 0.99 for value in closes],
                        "close": closes,
                        "volume": [1_000.0] * rows,
                    }
                ]
            },
        }

        with self.assertRaisesRegex(ValueError, "transient-scale"):
            yahoo.frame_for("SYNTH", result, "split-adjusted")

        frame, audit = yahoo.frame_for(
            "SYNTH",
            result,
            "split-adjusted",
            "reject",
            "drop-observation",
        )
        self.assertEqual(len(frame), rows - 2)
        self.assertEqual(audit["transientScalePolicy"], "drop-observation")
        self.assertEqual(audit["transientScaleRows"], 2)
        self.assertEqual(audit["transientScaleRowsDropped"], 2)
        self.assertEqual(audit["transientScaleDropLimit"], 2)
        self.assertEqual(
            [item["close"] for item in audit["transientScaleObservations"]],
            [10.0, 10.2],
        )
        summary = yahoo.transient_scale_summary(
            {
                "1306.T": {
                    **audit,
                    "providerSymbol": "1306.T",
                },
                "7203.T": {
                    "providerSymbol": "7203.T",
                    "transientScalePolicy": "drop-observation",
                    "transientScaleRowsDropped": 0,
                    "transientScaleObservations": [],
                },
            }
        )
        self.assertEqual(summary["affectedAssets"], ["1306.T"])
        self.assertEqual(summary["observationsFound"], 2)
        self.assertEqual(summary["observationsDropped"], 2)
        self.assertTrue(
            all(item["symbol"] == "1306.T" for item in summary["observations"])
        )

    def test_nikkei_keeps_peer_canonical_symbol_separate_from_code(self) -> None:
        nikkei = load_script(
            "autoquant_skill_nikkei_canonical_symbol",
            SKILLS
            / "fetch-nikkei-ohlcv"
            / "scripts"
            / "fetch_nikkei_daily.py",
        )
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "assets.json"
            path.write_text(
                json.dumps(
                    [
                        {
                            "symbol": "7203.T",
                            "providerCode": "7203",
                            "providerMarket": "1",
                            "venue": "XTKS",
                            "currency": "JPY",
                            "assetClass": "equity",
                        }
                    ]
                ),
                encoding="utf-8",
            )
            assets = nikkei.load_assets(path)

        self.assertEqual(assets[0]["symbol"], "7203.T")
        self.assertEqual(assets[0]["providerCode"], "7203")

    def test_eastmoney_lots_become_shares_only_after_amount_check(self) -> None:
        eastmoney = load_script(
            "autoquant_skill_eastmoney",
            SKILLS
            / "fetch-eastmoney-ohlcv"
            / "scripts"
            / "fetch_eastmoney_daily.py",
        )
        payload = {
            "rc": 0,
            "data": {
                "code": "600519",
                "name": "fixture",
                "market": 1,
                "decimal": 2,
                "klines": [
                    (
                        "2026-07-28,1400.00,1410.00,1420.00,1390.00,"
                        "1000,140500000,2.13,0.71,10.00,0.01"
                    ),
                    (
                        "2026-07-29,1410.00,1400.00,1430.00,1395.00,"
                        "2000,281000000,2.48,-0.71,-10.00,0.02"
                    ),
                ],
            },
        }
        frame, audit = eastmoney.parse_payload(
            "1.600519",
            json.dumps(payload).encode(),
            eastmoney.date(2026, 7, 28),
            eastmoney.date(2026, 7, 30),
        )
        self.assertEqual(frame["volume"].tolist(), [100_000.0, 200_000.0])
        self.assertEqual(audit["providerVolumeUnit"], "lot")
        self.assertEqual(audit["outputVolumeUnit"], "share")
        self.assertEqual(audit["amountVwapRowsChecked"], 2)

        payload["data"]["klines"][0] = (
            "2026-07-28,1400.00,1410.00,1420.00,1390.00,"
            "1000,1405000,2.13,0.71,10.00,0.01"
        )
        with self.assertRaisesRegex(ValueError, "lot-to-share"):
            eastmoney.parse_payload(
                "1.600519",
                json.dumps(payload).encode(),
                eastmoney.date(2026, 7, 28),
                eastmoney.date(2026, 7, 30),
            )

    def test_tencent_lots_become_shares_and_prefix_matches_venue(self) -> None:
        tencent = load_script(
            "autoquant_skill_tencent",
            SKILLS
            / "fetch-tencent-ohlcv"
            / "scripts"
            / "fetch_tencent_daily.py",
        )
        payload = {
            "code": 0,
            "msg": "",
            "data": {
                "sh600519": {
                    "day": [
                        [
                            "2026-07-28",
                            "1400",
                            "1410",
                            "1420",
                            "1390",
                            "1000",
                        ],
                        [
                            "2026-07-29",
                            "1410",
                            "1400",
                            "1430",
                            "1395",
                            "2000",
                        ],
                    ],
                    "qt": {"sh600519": ["fixture"]},
                }
            },
        }
        frame, audit = tencent.parse_payload(
            "sh600519",
            json.dumps(payload).encode(),
            tencent.date(2026, 7, 28),
            tencent.date(2026, 7, 30),
        )
        self.assertEqual(frame["volume"].tolist(), [100_000.0, 200_000.0])
        self.assertEqual(audit["volumeMultiplier"], 100)
        with tempfile.TemporaryDirectory() as directory:
            assets = Path(directory) / "assets.json"
            assets.write_text(
                json.dumps(
                    [
                        {
                            "symbol": "600519",
                            "providerSymbol": "sz600519",
                            "venue": "XSHG",
                            "currency": "CNY",
                            "assetClass": "equity",
                        }
                    ]
                ),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(ValueError, "prefix mismatches"):
                tencent.load_assets(assets)

    def test_mainland_raw_routes_preserve_listed_fund_class(self) -> None:
        routes = (
            (
                "eastmoney",
                "fetch-eastmoney-ohlcv/scripts/fetch_eastmoney_daily.py",
                "providerSecid",
                "1.510300",
            ),
            (
                "tencent",
                "fetch-tencent-ohlcv/scripts/fetch_tencent_daily.py",
                "providerSymbol",
                "sh510300",
            ),
            (
                "sina",
                "fetch-sina-ohlcv/scripts/fetch_sina_daily.py",
                "providerSymbol",
                "sh510300",
            ),
            (
                "sohu",
                "fetch-sohu-ohlcv/scripts/fetch_sohu_daily.py",
                "providerSymbol",
                "cn_510300",
            ),
        )
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name, relative, provider_key, provider_value in routes:
                with self.subTest(route=name):
                    route = load_script(
                        f"autoquant_skill_{name}_fund",
                        SKILLS / relative,
                    )
                    path = root / f"{name}.json"
                    path.write_text(
                        json.dumps(
                            [
                                {
                                    "symbol": "510300",
                                    provider_key: provider_value,
                                    "venue": "XSHG",
                                    "currency": "CNY",
                                    "assetClass": "fund",
                                }
                            ]
                        ),
                        encoding="utf-8",
                    )
                    loaded = route.load_assets(path)
                    self.assertEqual(loaded[0]["assetClass"], "fund")

    def test_twse_monthly_rows_preserve_official_share_volume(self) -> None:
        twse = load_script(
            "autoquant_skill_twse",
            SKILLS
            / "fetch-twse-ohlcv"
            / "scripts"
            / "fetch_twse_daily.py",
        )
        payload = {
            "stat": "OK",
            "title": "113/07 2330",
            "fields": [
                "日期",
                "成交股數",
                "成交金額",
                "開盤價",
                "最高價",
                "最低價",
                "收盤價",
                "漲跌價差",
                "成交筆數",
            ],
            "data": [
                [
                    "113/07/01",
                    "20,000,000",
                    "19,300,000,000",
                    "960.00",
                    "980.00",
                    "955.00",
                    "970.00",
                    "+10.00",
                    "40,000",
                ],
                [
                    "113/07/02",
                    "0",
                    "0",
                    "--",
                    "--",
                    "--",
                    "--",
                    "--",
                    "0",
                ],
            ],
        }
        frame, audit = twse.parse_month(
            "2330",
            json.dumps(payload).encode(),
        )
        self.assertEqual(str(frame.loc[0, "date"]), "2024-07-01")
        self.assertEqual(frame.loc[0, "volume"], 20_000_000.0)
        self.assertEqual(audit["rows"], 1)
        self.assertEqual(audit["providerRows"], 2)
        self.assertEqual(audit["unusableRowsDropped"], 1)
        self.assertEqual(
            list(
                twse.months(
                    twse.date(2024, 7, 15),
                    twse.date(2024, 9, 1),
                )
            ),
            [twse.date(2024, 7, 1), twse.date(2024, 8, 1)],
        )
        self.assertEqual(
            list(
                twse.months(
                    twse.date(2024, 7, 15),
                    twse.date(2024, 9, 2),
                )
            ),
            [
                twse.date(2024, 7, 1),
                twse.date(2024, 8, 1),
                twse.date(2024, 9, 1),
            ],
        )

    def test_twse_security_block_preserves_provider_response_receipts(
        self,
    ) -> None:
        twse = load_script(
            "autoquant_skill_twse_failure",
            SKILLS
            / "fetch-twse-ohlcv"
            / "scripts"
            / "fetch_twse_daily.py",
        )
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            assets = root / "assets.json"
            assets.write_text(
                json.dumps(
                    [
                        {
                            "symbol": "2330",
                            "providerStockNo": "2330",
                            "venue": "TWSE",
                            "currency": "TWD",
                            "assetClass": "equity",
                        }
                    ]
                ),
                encoding="utf-8",
            )
            output = root / "output"

            def blocked():
                return twse.urllib.error.HTTPError(
                    twse.request_uri("2330", twse.date(2025, 1, 1)),
                    307,
                    "Temporary Redirect",
                    {
                        "Content-Type": "text/html",
                        "Location": "https://www.twse.com.tw/security",
                        "Set-Cookie": "must-not-be-retained",
                    },
                    io.BytesIO(b"<html>security block</html>"),
                )

            argv = [
                "fetch_twse_daily.py",
                "--output",
                str(output),
                "--assets",
                str(assets),
                "--dataset-id",
                "twse-fixture",
                "--start",
                "2025-01-01",
                "--end-exclusive",
                "2025-02-01",
                "--request-delay",
                "0",
                "--terms",
                "fixture research retrieval",
            ]
            with mock.patch.object(
                twse.urllib.request,
                "urlopen",
                side_effect=[blocked() for _ in range(5)],
            ), mock.patch.object(twse.time, "sleep"), mock.patch.object(
                sys,
                "argv",
                argv,
            ):
                with self.assertRaisesRegex(
                    RuntimeError,
                    "failed after 5 attempts",
                ):
                    twse.main()

            provider_failure = json.loads(
                (output / "provider-failure.json").read_text(encoding="utf-8")
            )
            self.assertEqual(
                provider_failure["kind"],
                "autoquant-provider-acquisition-failure",
            )
            self.assertEqual(
                provider_failure["failedRequest"]["providerStockNo"],
                "2330",
            )
            self.assertFalse((output / "dataset-package.json").exists())
            receipt_root = output / "request-attempts" / "2330" / "2025-01"
            receipt = json.loads(
                (receipt_root / "request-attempts.json").read_text(
                    encoding="utf-8"
                )
            )
            self.assertEqual(receipt["status"], "failed")
            self.assertEqual(len(receipt["attempts"]), 5)
            for attempt in receipt["attempts"]:
                response = attempt["response"]
                self.assertEqual(response["status"], 307)
                self.assertEqual(response["bodyBytes"], 27)
                self.assertNotIn("Set-Cookie", response["headers"])
                body = receipt_root / response["bodyPath"]
                self.assertEqual(
                    body.read_bytes(),
                    b"<html>security block</html>",
                )

    def test_twse_http_200_security_page_is_preserved(self) -> None:
        twse = load_script(
            "autoquant_skill_twse_html_failure",
            SKILLS
            / "fetch-twse-ohlcv"
            / "scripts"
            / "fetch_twse_daily.py",
        )

        class SecurityPage:
            status = 200
            headers = {
                "Content-Type": "text/html",
                "Content-Length": "32",
            }

            def __enter__(self):
                return self

            def __exit__(self, _kind, _value, _traceback):
                return False

            def read(self):
                return b"<!doctype html><html>blocked</html>"

            def geturl(self):
                return twse.BASE_URL

        with tempfile.TemporaryDirectory() as directory:
            attempts = Path(directory) / "attempts"
            with mock.patch.object(
                twse.urllib.request,
                "urlopen",
                side_effect=[SecurityPage() for _ in range(5)],
            ), mock.patch.object(twse.time, "sleep"):
                with self.assertRaisesRegex(
                    RuntimeError,
                    "security page blocked",
                ):
                    twse.fetch_bytes(
                        twse.request_uri("2330", twse.date(2025, 1, 1)),
                        attempt_directory=attempts,
                    )
            receipt = json.loads(
                (attempts / "request-attempts.json").read_text(
                    encoding="utf-8"
                )
            )
            self.assertEqual(receipt["status"], "failed")
            self.assertEqual(receipt["attempts"][0]["response"]["status"], 200)
            body = attempts / receipt["attempts"][0]["response"]["bodyPath"]
            self.assertEqual(
                body.read_bytes(),
                b"<!doctype html><html>blocked</html>",
            )

    def test_finmind_preserves_raw_twd_and_checks_traded_money(self) -> None:
        finmind = load_script(
            "autoquant_skill_finmind",
            SKILLS
            / "fetch-finmind-ohlcv"
            / "scripts"
            / "fetch_finmind_daily.py",
        )
        payload = {
            "msg": "success",
            "status": 200,
            "data": [
                {
                    "date": "2026-07-28",
                    "stock_id": "2330",
                    "Trading_Volume": 20_000_000,
                    "Trading_money": 19_300_000_000,
                    "open": 960.0,
                    "max": 980.0,
                    "min": 955.0,
                    "close": 970.0,
                    "spread": 10.0,
                    "Trading_turnover": 40_000,
                },
                {
                    "date": "2026-07-29",
                    "stock_id": "2330",
                    "Trading_Volume": 10_000_000,
                    "Trading_money": 9_850_000_000,
                    "open": 975.0,
                    "max": 995.0,
                    "min": 970.0,
                    "close": 990.0,
                    "spread": 20.0,
                    "Trading_turnover": 25_000,
                },
            ],
        }
        frame, audit = finmind.parse_payload(
            "2330",
            json.dumps(payload).encode(),
            finmind.date(2026, 7, 28),
            finmind.date(2026, 7, 30),
        )
        self.assertEqual(frame["date"].tolist(), ["2026-07-28", "2026-07-29"])
        self.assertEqual(frame.loc[1, "close"], 990.0)
        self.assertEqual(frame.loc[1, "volume"], 10_000_000)
        self.assertEqual(audit["valueVolumeRowsChecked"], 2)
        self.assertEqual(audit["valueVolumeAnomalyRows"], 0)

    def test_nasdaq_display_history_parses_prices_and_shares(self) -> None:
        nasdaq = load_script(
            "autoquant_skill_nasdaq",
            SKILLS
            / "fetch-nasdaq-ohlcv"
            / "scripts"
            / "fetch_nasdaq_daily.py",
        )
        payload = {
            "data": {
                "symbol": "AAPL",
                "totalRecords": 3,
                "tradesTable": {
                    "rows": [
                        {
                            "date": "07/29/2026",
                            "close": "$338.19",
                            "volume": "56,090,840",
                            "open": "$339.73",
                            "high": "$344.5699",
                            "low": "$337.3501",
                        },
                        {
                            "date": "07/28/2026",
                            "close": "$340.08",
                            "volume": "51,859,040",
                            "open": "$340.03",
                            "high": "$342.89",
                            "low": "$335.60",
                        },
                        {
                            "date": "07/27/2026",
                            "close": "$340.00",
                            "volume": "N/A",
                            "open": "$339.00",
                            "high": "$341.00",
                            "low": "$338.00",
                        },
                    ]
                },
            },
            "status": {
                "rCode": 200,
                "bCodeMessage": None,
                "developerMessage": None,
            },
        }
        frame, audit = nasdaq.parse_payload(
            "AAPL",
            json.dumps(payload).encode(),
            nasdaq.date(2026, 7, 28),
            nasdaq.date(2026, 7, 30),
        )
        self.assertEqual(frame["date"].tolist(), ["2026-07-28", "2026-07-29"])
        self.assertEqual(frame.loc[1, "close"], 338.19)
        self.assertEqual(frame.loc[1, "volume"], 56_090_840.0)
        self.assertEqual(audit["declaredTotalRecords"], 3)
        self.assertEqual(audit["unusableRowsDropped"], 1)

    def test_us_provider_guidance_uses_aligned_panels_for_fixed_labs(
        self,
    ) -> None:
        nasdaq_skill = (
            SKILLS / "fetch-nasdaq-ohlcv" / "SKILL.md"
        ).read_text(encoding="utf-8")
        us_reference = (
            SKILLS
            / "acquire-market-ohlcv"
            / "references"
            / "us-equities.md"
        ).read_text(encoding="utf-8")

        self.assertIn("--panel aligned", nasdaq_skill)
        self.assertIn("fixed Event, Book Risk, Allocation", nasdaq_skill)
        self.assertIn("emits an aligned V1 package", nasdaq_skill)
        self.assertIn("Book Risk", us_reference)
        self.assertIn("require `aligned`", us_reference)
        self.assertIn("observed-only V4", us_reference)

    def test_naver_literal_table_preserves_provider_adjusted_krw_and_volume(
        self,
    ) -> None:
        naver = load_script(
            "autoquant_skill_naver",
            SKILLS
            / "fetch-naver-ohlcv"
            / "scripts"
            / "fetch_naver_daily.py",
        )
        raw = (
            "[['날짜','시가','고가','저가','종가','거래량','외국인소진율'],"
            "['20260728',200000,205000,198000,203000,12000000,54.0],"
            "['20260729',203000,208000,201000,207000,13000000,54.1]]"
        ).encode()
        frame, audit = naver.parse_payload(
            "005930",
            raw,
            naver.date(2026, 7, 28),
            naver.date(2026, 7, 30),
        )
        self.assertEqual(frame["date"].tolist(), ["2026-07-28", "2026-07-29"])
        self.assertEqual(frame.loc[1, "close"], 207_000)
        self.assertEqual(frame.loc[1, "volume"], 13_000_000)
        self.assertEqual(audit["providerVolumeUnit"], "share")
        self.assertEqual(audit["nonTradingPlaceholderRows"], 0)
        self.assertEqual(audit["nonTradingPlaceholderObservations"], [])
        self.assertEqual(audit["roundedBoundRows"], 0)
        self.assertEqual(audit["roundedBoundObservations"], [])
        self.assertEqual(naver.PRICE_ADJUSTMENT, "provider-adjusted")

    def test_naver_omits_only_exact_non_trading_placeholders(self) -> None:
        naver = load_script(
            "autoquant_skill_naver_placeholders",
            SKILLS
            / "fetch-naver-ohlcv"
            / "scripts"
            / "fetch_naver_daily.py",
        )
        headers = ["날짜", "시가", "고가", "저가", "종가", "거래량"]
        table = [
            headers,
            ["20260728", 200000, 205000, 198000, 203000, 12000000],
            ["20260729", 0, 0, 0, 203000, 0],
            ["20260730", 203000, 208000, 201000, 207000, 13000000],
        ]
        frame, audit = naver.parse_payload(
            "005930",
            repr(table).encode(),
            naver.date(2026, 7, 28),
            naver.date(2026, 7, 31),
        )
        self.assertEqual(frame["date"].tolist(), ["2026-07-28", "2026-07-30"])
        self.assertEqual(audit["nonTradingPlaceholderRows"], 1)
        self.assertEqual(
            audit["nonTradingPlaceholderObservations"],
            [
                {
                    "providerSymbol": "005930",
                    "date": "2026-07-29",
                    "open": 0.0,
                    "high": 0.0,
                    "low": 0.0,
                    "close": 203000.0,
                    "volume": 0.0,
                }
            ],
        )

        for invalid_row in (
            ["20260729", 0, 0, 0, 203000, 1],
            ["20260729", 0, 205000, 198000, 203000, 0],
            ["20260729", 0, 0, 0, 0, 0],
        ):
            with self.subTest(invalid_row=invalid_row):
                invalid_table = [table[0], table[1], invalid_row, table[3]]
                with self.assertRaisesRegex(ValueError, "nonpositive price"):
                    naver.parse_payload(
                        "005930",
                        repr(invalid_table).encode(),
                        naver.date(2026, 7, 28),
                        naver.date(2026, 7, 31),
                    )

    def test_naver_normalizes_only_one_krw_rounded_bounds(self) -> None:
        naver = load_script(
            "autoquant_skill_naver_rounding",
            SKILLS
            / "fetch-naver-ohlcv"
            / "scripts"
            / "fetch_naver_daily.py",
        )
        table = [
            ["날짜", "시가", "고가", "저가", "종가", "거래량"],
            ["20260728", 200000, 205000, 198000, 205001, 12000000],
            ["20260729", 203000, 208000, 201000, 207000, 13000000],
        ]
        frame, audit = naver.parse_payload(
            "005930",
            repr(table).encode(),
            naver.date(2026, 7, 28),
            naver.date(2026, 7, 30),
        )
        self.assertEqual(frame.loc[0, "high"], 205001)
        self.assertEqual(audit["roundedBoundRows"], 1)
        self.assertEqual(
            audit["roundedBoundObservations"],
            [
                {
                    "providerSymbol": "005930",
                    "date": "2026-07-28",
                    "rawHigh": 205000.0,
                    "normalizedHigh": 205001.0,
                    "rawLow": 198000.0,
                    "normalizedLow": 198000.0,
                }
            ],
        )

        table[1][4] = 205002
        with self.assertRaisesRegex(ValueError, "inconsistent OHLC bounds"):
            naver.parse_payload(
                "005930",
                repr(table).encode(),
                naver.date(2026, 7, 28),
                naver.date(2026, 7, 30),
            )

    def test_daum_page_preserves_raw_krw_and_checks_traded_value(self) -> None:
        daum = load_script(
            "autoquant_skill_daum",
            SKILLS
            / "fetch-daum-ohlcv"
            / "scripts"
            / "fetch_daum_daily.py",
        )
        payload = {
            "code": 200,
            "message": None,
            "currentPage": 1,
            "pageSize": 1000,
            "totalCount": 2,
            "totalPages": 1,
            "data": [
                {
                    "symbolCode": "A005930",
                    "date": "2026-07-29 00:00:00",
                    "openingPrice": 203000,
                    "highPrice": 208000,
                    "lowPrice": 201000,
                    "tradePrice": 207000,
                    "accTradeVolume": 13000000,
                    "accTradePrice": 2665000000000,
                },
                {
                    "symbolCode": "A005930",
                    "date": "2026-07-28 00:00:00",
                    "openingPrice": 200000,
                    "highPrice": 205000,
                    "lowPrice": 198000,
                    "tradePrice": 203000,
                    "accTradeVolume": 12000000,
                    "accTradePrice": 2418000000000,
                },
            ],
        }
        records, page_audit = daum.parse_page(
            "A005930", json.dumps(payload).encode(), 1
        )
        frame, audit = daum.frame_for(
            "A005930",
            records,
            daum.date(2026, 7, 28),
            daum.date(2026, 7, 30),
        )
        self.assertEqual(frame["date"].tolist(), ["2026-07-28", "2026-07-29"])
        self.assertEqual(frame.loc[1, "close"], 207_000)
        self.assertEqual(frame.loc[1, "volume"], 13_000_000)
        self.assertEqual(audit["valueVolumeRowsChecked"], 2)
        self.assertEqual(audit["valueVolumeAnomalyRows"], 0)
        self.assertEqual(audit["valueVolumeAnomalies"], [])
        self.assertEqual(page_audit["totalCount"], 2)
        self.assertEqual(daum.PRICE_ADJUSTMENT, "raw")

    def test_daum_value_volume_scope_mismatch_is_diagnostic_only(self) -> None:
        daum = load_script(
            "autoquant_skill_daum_diagnostic",
            SKILLS
            / "fetch-daum-ohlcv"
            / "scripts"
            / "fetch_daum_daily.py",
        )
        records = [
            {
                "symbolCode": "A005930",
                "date": "2026-07-29 00:00:00",
                "openingPrice": 203000,
                "highPrice": 208000,
                "lowPrice": 201000,
                "tradePrice": 207000,
                "accTradeVolume": 13000000,
                "accTradePrice": 13000000 * 190000,
            },
            {
                "symbolCode": "A005930",
                "date": "2026-07-28 00:00:00",
                "openingPrice": 200000,
                "highPrice": 205000,
                "lowPrice": 198000,
                "tradePrice": 203000,
                "accTradeVolume": 12000000,
                "accTradePrice": 2418000000000,
            },
        ]
        frame, audit = daum.frame_for(
            "A005930",
            records,
            daum.date(2026, 7, 28),
            daum.date(2026, 7, 30),
        )
        self.assertEqual(frame["date"].tolist(), ["2026-07-28", "2026-07-29"])
        self.assertEqual(audit["valueVolumeRowsChecked"], 2)
        self.assertEqual(audit["valueVolumeAnomalyRows"], 1)
        self.assertEqual(
            audit["valueVolumeAnomalies"][0]["relation"], "below-low"
        )
        self.assertEqual(
            audit["valueVolumeAnomalies"][0]["date"], "2026-07-29"
        )
        self.assertAlmostEqual(
            audit["valueVolumeAnomalies"][0][
                "relativeDistanceFromNearestBound"
            ],
            11_000 / 201_000,
        )

        invalid_records = [dict(record) for record in records]
        invalid_records[0]["accTradePrice"] = -1
        with self.assertRaisesRegex(ValueError, "invalid accumulated trade fields"):
            daum.frame_for(
                "A005930",
                invalid_records,
                daum.date(2026, 7, 28),
                daum.date(2026, 7, 30),
            )

    def test_vndirect_price_scale_and_invalid_bounds_are_audited(self) -> None:
        vndirect = load_script(
            "autoquant_skill_vndirect",
            SKILLS
            / "fetch-vndirect-ohlcv"
            / "scripts"
            / "fetch_vndirect_daily.py",
        )
        asset = {
            "symbol": "VCB",
            "providerSymbol": "VCB",
            "providerFloor": "HOSE",
            "venue": "HOSE",
            "currency": "VND",
            "assetClass": "equity",
        }
        records = [
            {
                "code": "VCB",
                "floor": "HOSE",
                "date": "2026-07-28",
                "open": 60.0,
                "high": 62.0,
                "low": 59.0,
                "close": 61.0,
                "adOpen": 30.0,
                "adHigh": 31.0,
                "adLow": 29.5,
                "adClose": 30.5,
                "nmVolume": 1_000,
                "nmValue": 60_500_000,
                "average": 60.5,
            },
            {
                "code": "VCB",
                "floor": "HOSE",
                "date": "2026-07-29",
                "open": 61.0,
                "high": 62.0,
                "low": 61.5,
                "close": 61.2,
                "adOpen": 30.5,
                "adHigh": 31.0,
                "adLow": 30.75,
                "adClose": 30.6,
                "nmVolume": 2_000,
                "nmValue": 122_400_000,
                "average": 61.2,
            },
        ]
        frame, audit = vndirect.frame_for(
            asset,
            records,
            "raw",
            vndirect.date(2026, 7, 28),
            vndirect.date(2026, 7, 30),
        )
        self.assertEqual(frame["date"].tolist(), ["2026-07-28"])
        self.assertEqual(frame.loc[0, "close"], 61_000.0)
        self.assertEqual(frame.loc[0, "volume"], 1_000.0)
        self.assertEqual(audit["priceMultiplier"], 1_000)
        self.assertEqual(audit["normalValueChecks"], 2)
        self.assertEqual(audit["invalidBoundsRowsDropped"], 1)

    def test_euronext_official_csv_preserves_share_volume(self) -> None:
        euronext = load_script(
            "autoquant_skill_euronext",
            SKILLS
            / "fetch-euronext-ohlcv"
            / "scripts"
            / "fetch_euronext_daily.py",
        )
        raw = (
            "\ufeff\"Historical Data\"\n"
            "\"From 2026-07-28 to 2026-07-29\"\n"
            "FR0000121014\n"
            "Date;Open;High;Low;Last;Close;Number of Shares;"
            "Number of Trades;Turnover;vwap\n"
            "29/07/2026;477.00;486.40;465.25;467.95;467.95;"
            "684597;36414;322427655;470.9744\n"
            "28/07/2026;469.40;481.15;451.80;470.30;470.30;"
            "876705;44524;408412667;465.8496\n"
        ).encode()
        frame, audit = euronext.parse_payload(
            "FR0000121014-XPAR",
            raw,
            euronext.date(2026, 7, 28),
            euronext.date(2026, 7, 30),
        )
        self.assertEqual(frame["date"].tolist(), ["2026-07-28", "2026-07-29"])
        self.assertEqual(frame.loc[1, "close"], 467.95)
        self.assertEqual(frame.loc[1, "volume"], 684_597.0)
        self.assertEqual(audit["declaredIsin"], "FR0000121014")
        self.assertEqual(audit["lastCloseMismatchRows"], 0)

    def test_nikkei_recent_table_resolves_year_and_preserves_volume(self) -> None:
        nikkei = load_script(
            "autoquant_skill_nikkei",
            SKILLS
            / "fetch-nikkei-ohlcv"
            / "scripts"
            / "fetch_nikkei_daily.py",
        )
        raw = """
        <html><div class="l-miH02_date">2026年1月5日（月）</div>
        <table><thead><tr>
        <th>日付</th><th>始値</th><th>高値</th><th>安値</th>
        <th>終値</th><th>売買高</th><th>修正後終値</th>
        </tr></thead><tbody>
        <tr><th>1/5（月）</th><td>3,100</td><td>3,200</td>
        <td>3,050</td><td>3,180</td><td>12,345,600</td>
        <td>3,180.0</td></tr>
        <tr><th>12/30（火）</th><td>3,000</td><td>3,100</td>
        <td>2,980</td><td>3,050</td><td>10,000,000</td>
        <td>3,050.0</td></tr>
        </tbody></table></html>
        """.encode()
        frame, audit = nikkei.parse_payload(
            "7203",
            raw,
            nikkei.date(2025, 12, 30),
            nikkei.date(2026, 1, 6),
        )
        self.assertEqual(frame["date"].tolist(), ["2025-12-30", "2026-01-05"])
        self.assertEqual(frame.loc[1, "volume"], 12_345_600.0)
        self.assertEqual(audit["pageAsOf"], "2026-01-05")
        self.assertEqual(audit["adjustedCloseDifferenceRows"], 0)

    def test_sina_recent_kline_preserves_raw_prices_and_shares(self) -> None:
        sina = load_script(
            "autoquant_skill_sina",
            SKILLS
            / "fetch-sina-ohlcv"
            / "scripts"
            / "fetch_sina_daily.py",
        )
        payload = {
            "result": {
                "status": {"code": 0},
                "data": [
                    {
                        "day": "2026-07-28",
                        "open": "1300.000",
                        "high": "1320.000",
                        "low": "1290.000",
                        "close": "1310.000",
                        "volume": "3569892",
                    },
                    {
                        "day": "2026-07-29",
                        "open": "1310.000",
                        "high": "1330.000",
                        "low": "1300.000",
                        "close": "1325.000",
                        "volume": "7187261",
                    },
                ],
            }
        }
        frame, audit = sina.parse_payload(
            "sh600519",
            json.dumps(payload).encode(),
            sina.date(2026, 7, 28),
            sina.date(2026, 7, 30),
        )
        self.assertEqual(frame["date"].tolist(), ["2026-07-28", "2026-07-29"])
        self.assertEqual(frame.loc[1, "close"], 1325.0)
        self.assertEqual(frame.loc[1, "volume"], 7_187_261.0)
        self.assertEqual(audit["providerVolumeUnit"], "share")

    def test_sohu_jsonp_converts_lots_and_checks_traded_value(self) -> None:
        sohu = load_script(
            "autoquant_skill_sohu",
            SKILLS
            / "fetch-sohu-ohlcv"
            / "scripts"
            / "fetch_sohu_daily.py",
        )
        payload = [
            {
                "status": 0,
                "code": "cn_920019",
                "hq": [
                    [
                        "2026-07-29",
                        "13.690",
                        "14.030",
                        "0.300",
                        "2.18%",
                        "13.520",
                        "14.060",
                        "16975",
                        "2352.156",
                        "1.01%",
                    ],
                    [
                        "2026-07-28",
                        "13.450",
                        "13.730",
                        "0.130",
                        "0.96%",
                        "13.400",
                        "13.940",
                        "16448",
                        "2250.000",
                        "0.98%",
                    ],
                ],
                "stat": ["累计:", "2026-07-28至2026-07-29"],
            }
        ]
        raw = (
            "historySearchHandler("
            + json.dumps(payload, ensure_ascii=False)
            + ")\n"
        ).encode("gb18030")
        frame, audit = sohu.parse_payload(
            "cn_920019",
            raw,
            sohu.date(2026, 7, 28),
            sohu.date(2026, 7, 30),
        )
        self.assertEqual(frame["date"].tolist(), ["2026-07-28", "2026-07-29"])
        self.assertEqual(frame.loc[1, "close"], 14.03)
        self.assertEqual(frame.loc[1, "volume"], 1_697_500)
        self.assertEqual(audit["volumeMultiplier"], 100)
        self.assertEqual(audit["valueVolumeRowsChecked"], 2)

    def test_package_audit_reconciles_a_confined_daily_panel(self) -> None:
        package_audit = load_script(
            "autoquant_skill_package",
            SKILLS
            / "package-autoquant-ohlcv"
            / "scripts"
            / "audit_ohlcv_package.py",
        )
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            frame = pd.DataFrame(
                {
                    "date": ["2026-07-28", "2026-07-29"],
                    "open": [100.0, 101.0],
                    "high": [102.0, 103.0],
                    "low": [99.0, 100.0],
                    "close": [101.0, 102.0],
                    "volume": [1_000.0, 1_100.0],
                }
            )
            frame.to_csv(root / "AAPL.csv", index=False)
            package = {
                "schemaVersion": 1,
                "kind": "autoquant-ohlcv-dataset-package",
                "id": "skill-audit",
                "version": "2026-07-29",
                "assetClass": "equity",
                "frequency": "1d",
                "market": {
                    "clock": "session",
                    "calendar": "XNYS",
                    "timezone": "America/New_York",
                },
                "priceAdjustment": "raw",
                "provider": {
                    "name": "fixture",
                    "retrievedAt": None,
                    "sourceUri": None,
                    "terms": "deterministic fixture",
                },
                "assets": [
                    {
                        "symbol": "AAPL",
                        "venue": "XNAS",
                        "currency": "USD",
                        "path": "AAPL.csv",
                    }
                ],
            }
            package_path = root / "dataset-package.json"
            package_path.write_text(
                json.dumps(package),
                encoding="utf-8",
            )
            audit = package_audit.audit(package_path)
            self.assertEqual(audit["assets"]["AAPL"]["rows"], 2)
            self.assertTrue(audit["panel"]["fullyAligned"])
            self.assertEqual(audit["panel"]["unionTimestamps"], 2)

    def test_package_comparison_preserves_quantization_and_adjustment(self) -> None:
        comparison = load_script(
            "autoquant_skill_compare",
            SKILLS
            / "package-autoquant-ohlcv"
            / "scripts"
            / "compare_ohlcv_packages.py",
        )
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paths = []
            for side, close, volume in (
                ("left", 101.00, 1_000.0),
                ("right", 101.01, 1_050.0),
            ):
                side_root = root / side
                side_root.mkdir()
                pd.DataFrame(
                    {
                        "date": ["2026-07-29"],
                        "open": [100.0],
                        "high": [102.0],
                        "low": [99.0],
                        "close": [close],
                        "volume": [volume],
                    }
                ).to_csv(side_root / "AAPL.csv", index=False)
                package = {
                    "kind": "autoquant-ohlcv-dataset-package",
                    "id": side,
                    "priceAdjustment": "raw",
                    "provider": {"name": side},
                    "assets": [{"symbol": "AAPL", "path": "AAPL.csv"}],
                }
                path = side_root / "dataset-package.json"
                path.write_text(json.dumps(package), encoding="utf-8")
                paths.append(path)
            audit = comparison.compare(
                paths[0],
                paths[1],
                price_atol=0.011,
                price_rtol=0.0,
                volume_atol=100.0,
                volume_rtol=0.0,
            )
            self.assertEqual(audit["commonPanelDates"], 1)
            self.assertEqual(
                audit["assets"]["AAPL"]["prices"]["close"]["mismatchRows"],
                0,
            )
            self.assertEqual(
                audit["assets"]["AAPL"]["volume"]["mismatchRows"],
                0,
            )
            right = json.loads(paths[1].read_text(encoding="utf-8"))
            right["priceAdjustment"] = "provider-adjusted"
            paths[1].write_text(json.dumps(right), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "different priceAdjustment"):
                comparison.compare(
                    paths[0],
                    paths[1],
                    price_atol=0.011,
                    price_rtol=0.0,
                    volume_atol=100.0,
                    volume_rtol=0.0,
                )
            coverage = comparison.compare(
                paths[0],
                paths[1],
                price_atol=0.011,
                price_rtol=0.0,
                volume_atol=100.0,
                volume_rtol=0.0,
                mode="coverage-only",
            )
            self.assertFalse(coverage["semanticCompatibility"])
            self.assertFalse(coverage["pricesCompared"])
            self.assertFalse(coverage["volumeCompared"])
            self.assertEqual(
                coverage["priceAdjustmentClaims"],
                {"left": "raw", "right": "provider-adjusted"},
            )
            self.assertNotIn("prices", coverage["assets"]["AAPL"])
