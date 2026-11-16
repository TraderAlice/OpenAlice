"""Request-driven, content-locked OHLCV Project intake."""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import numpy as np
import pandas as pd

from .allocation_policies import (
    ALLOCATION_POLICY,
    build_allocation_contract,
    load_allocation_contract,
)
from .briefs import (
    ASSET_CLASSES,
    load_research_request,
    validate_research_request,
)
from .factor_claims import (
    FACTOR_CLAIM,
    FORWARD_REALIZED_VOLATILITY_OUTCOME,
    build_factor_claim,
    factor_outcome,
    load_factor_claim,
)
from .event_studies import (
    EVENT_STUDY_POLICY,
    build_event_study_policy,
    load_event_study_policy,
)
from .book_path_stress import (
    BOOK_PATH_STRESS_POLICY,
    build_book_path_stress_policy,
    load_book_path_stress_policy,
)
from .ohlcv import normalize_ohlcv
from .horizons import (
    RESEARCH_HORIZON,
    build_research_horizon,
    load_research_horizon,
    normalize_horizon_policy,
    validate_external_holdout_horizon_capacity,
    validate_horizon_capacity,
)
from .intervals import (
    AGGREGATION_METHOD,
    BASE_INTERVAL,
    CONTINUOUS_AGGREGATION_METHOD,
    CONTINUOUS_TERMINAL_POLICY,
    IntervalContractError,
    OBSERVED_PANEL_POLICY,
    SESSION_TERMINAL_POLICY,
    SUPPORTED_BASE_INTERVALS,
    SUPPORTED_FEATURE_INTERVALS,
    SUPPORTED_INTERVALS,
    XNYS_AGGREGATION_METHOD,
    aggregate_interval_ohlcv,
    aggregate_completed_ohlcv,
    annualization_periods as infer_annualization_periods,
    canonical_interval_surface,
    configurable_interval_surface,
    interval_surface,
    load_multi_interval_asset,
    normalize_feature_intervals,
    observed_interval_surface,
    validate_base_ohlcv,
    validate_continuous_hourly_ohlcv,
    validate_observed_ohlcv,
)
from .mandates import (
    PORTFOLIO_MANDATE,
    build_portfolio_mandate,
    load_portfolio_mandate,
)
from .position_snapshots import (
    POSITION_SNAPSHOT,
    build_position_snapshot,
    load_position_snapshot,
)
from .prediction_modes import (
    FACTOR_POPULATION,
    PredictionModeError,
    build_factor_population,
    load_factor_population,
)
from .studies import StudyContext, hash_file, hash_json, load_study
from .workspace import (
    SCHEMA_VERSION,
    AutoQuantValidationError,
    ProjectContext,
    ValidationIssue,
    confined_path,
)


DATASET_PACKAGE_KIND = "autoquant-ohlcv-dataset-package"
DATASET_SNAPSHOT_KIND = "autoquant-ohlcv-dataset-snapshot"
PROJECT_INTAKE_KIND = "autoquant-project-intake"
PROJECT_REQUEST = "request.json"
PROJECT_INTAKE = "intake.json"
DATASET_SNAPSHOT = "data/ohlcv/snapshot.json"
SAFE_SYMBOL = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._=-]{0,63}$")
SUPPORTED_SOURCE_SUFFIXES = {".csv", ".parquet", ".feather"}
RAGGED_DAILY_SCHEMA_VERSION = 4
OBSERVED_INTRADAY_SCHEMA_VERSION = 5
MULTI_SOURCE_OBSERVED_SCHEMA_VERSION = 6
OBSERVED_SCHEMA_VERSIONS = {
    OBSERVED_INTRADAY_SCHEMA_VERSION,
    MULTI_SOURCE_OBSERVED_SCHEMA_VERSION,
}
RAGGED_PANEL_POLICY = {
    "alignment": "observed-only",
    "missingObservation": "absent-no-fill",
}
FACTOR_MIN_ASSETS_PER_TIMESTAMP = 4
FACTOR_MIN_ASSET_OBSERVATIONS = 120
OBSERVED_INTRADAY_MARKET = {
    "clock": "observed",
    "calendar": "provider-observed",
    "timezone": "UTC",
}
OBSERVED_VOLUME_SEMANTICS = {
    "provider-reported-nonnegative",
    "unavailable-zero",
}
PRICE_ADJUSTMENTS = {
    "raw",
    "split-adjusted",
    "split-and-dividend-adjusted",
    "provider-adjusted",
}
PROVIDER_KEYS = {"name", "retrievedAt", "sourceUri", "terms"}
SAFE_SOURCE_ID = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")
INTAKE_TEMPLATE_REQUIREMENTS = {
    "ohlcv-factor-lab": (4, 180),
    "ohlcv-portfolio-lab": (5, 180),
    "ohlcv-rl-factor-lab": (5, 240),
    "ohlcv-book-risk-lab": (2, 120),
    "ohlcv-event-study-lab": (2, 120),
    "ohlcv-book-path-stress-lab": (2, 120),
    "ohlcv-allocation-lab": (5, 180),
    "ohlcv-research-desk": (5, 240),
}
STUDY_OWNED_DATASET_PROFILE = "study-owned-ohlcv"
STUDY_OWNED_DATASET_REQUIREMENTS = (1, 2)


def _issue(path: Path | str, code: str, message: str) -> ValidationIssue:
    return ValidationIssue(str(path), code, message)


def _strict_keys(
    value: dict[str, Any],
    required: set[str],
    path: Path | str,
) -> list[ValidationIssue]:
    issues = [
        _issue(f"{path}/{key}", "schema.missing", f"Missing required field '{key}'")
        for key in sorted(required - value.keys())
    ]
    issues.extend(
        _issue(f"{path}/{key}", "schema.unknown", f"Unknown field '{key}'")
        for key in sorted(value.keys() - required)
    )
    return issues


def _non_empty(value: Any, path: Path | str) -> list[ValidationIssue]:
    if not isinstance(value, str) or not value.strip():
        return [_issue(path, "schema.string", "Must be a non-empty string")]
    return []


def _asset_class_summary(asset_classes: list[str]) -> str:
    distinct = set(asset_classes)
    return next(iter(distinct)) if len(distinct) == 1 else "mixed"


def _optional_asset_class_issues(
    assets: list[Any],
    path: Path,
    package_asset_class: Any,
) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    declared = [
        index
        for index, asset in enumerate(assets)
        if isinstance(asset, dict) and "assetClass" in asset
    ]
    if declared and len(declared) != len(assets):
        issues.append(
            _issue(
                f"{path}/assets",
                "dataset.partial-asset-classes",
                "Per-asset assetClass is optional only as a complete vector",
            )
        )
    asset_classes: list[str] = []
    for index in declared:
        asset_class = assets[index].get("assetClass")
        if asset_class not in ASSET_CLASSES:
            issues.append(
                _issue(
                    f"{path}/assets/{index}/assetClass",
                    "dataset.asset-class",
                    "Unsupported asset class",
                )
            )
        else:
            asset_classes.append(asset_class)
    if len(asset_classes) == len(assets) and asset_classes:
        expected = _asset_class_summary(asset_classes)
        if package_asset_class != expected:
            issues.append(
                _issue(
                    f"{path}/assetClass",
                    "dataset.asset-class-summary",
                    "assetClass must summarize per-asset classes as "
                    f"'{expected}'",
                )
            )
    return issues


def _validate_provider_claim(
    value: Any,
    path: Path | str,
) -> tuple[dict[str, Any], list[ValidationIssue]]:
    if not isinstance(value, dict):
        return {}, [
            _issue(path, "schema.type", "Provider must be an object")
        ]
    issues = _strict_keys(value, PROVIDER_KEYS, path)
    for key in ("name", "terms"):
        issues.extend(_non_empty(value.get(key), f"{path}/{key}"))
    retrieved_at = value.get("retrievedAt")
    if retrieved_at is not None:
        if not isinstance(retrieved_at, str) or not retrieved_at.strip():
            issues.append(
                _issue(
                    f"{path}/retrievedAt",
                    "dataset.retrieved-at",
                    "retrievedAt must be null when the original provider "
                    "retrieval time is unknown, or a timezone-aware ISO-8601 "
                    "timestamp when known",
                )
            )
        else:
            try:
                parsed = datetime.fromisoformat(
                    retrieved_at.replace("Z", "+00:00")
                )
                if parsed.tzinfo is None:
                    raise ValueError("timezone required")
            except ValueError:
                issues.append(
                    _issue(
                        f"{path}/retrievedAt",
                        "dataset.retrieved-at",
                        "retrievedAt must be null when the original provider "
                        "retrieval time is unknown, or a timezone-aware "
                        "ISO-8601 timestamp when known",
                    )
                )
    source_uri = value.get("sourceUri")
    if source_uri is not None:
        issues.extend(_non_empty(source_uri, f"{path}/sourceUri"))
    return value, issues


def _normalize_provider_claim(provider: dict[str, Any]) -> dict[str, Any]:
    retrieved_at = provider["retrievedAt"]
    return {
        "name": provider["name"].strip(),
        "retrievedAt": (
            retrieved_at.strip()
            if isinstance(retrieved_at, str)
            else None
        ),
        "sourceUri": (
            provider["sourceUri"].strip()
            if isinstance(provider["sourceUri"], str)
            else None
        ),
        "terms": provider["terms"].strip(),
    }


def _validate_source_claims(
    value: Any,
    path: Path | str,
) -> tuple[list[dict[str, Any]], list[ValidationIssue]]:
    """Validate ordered V6 source-package and provider authority."""

    issues: list[ValidationIssue] = []
    if not isinstance(value, list) or len(value) < 2:
        return [], [
            _issue(
                path,
                "schema.array",
                "V6 sources must contain at least two source claims",
            )
        ]
    normalized: list[dict[str, Any]] = []
    source_ids: list[str] = []
    package_hashes: list[str] = []
    provider_claims: list[str] = []
    for index, source in enumerate(value):
        source_path = f"{path}/{index}"
        if not isinstance(source, dict):
            issues.append(
                _issue(source_path, "schema.type", "Source must be an object")
            )
            continue
        issues.extend(
            _strict_keys(
                source,
                {"id", "sourcePackage", "provider"},
                source_path,
            )
        )
        source_id = source.get("id")
        if (
            not isinstance(source_id, str)
            or not SAFE_SOURCE_ID.fullmatch(source_id)
        ):
            issues.append(
                _issue(
                    f"{source_path}/id",
                    "dataset.source-id",
                    "Source id must be a lowercase path-safe identifier",
                )
            )
        else:
            source_ids.append(source_id)

        package = source.get("sourcePackage")
        if not isinstance(package, dict):
            issues.append(
                _issue(
                    f"{source_path}/sourcePackage",
                    "schema.type",
                    "sourcePackage must be an object",
                )
            )
            package = {}
        else:
            issues.extend(
                _strict_keys(
                    package,
                    {"id", "version", "sha256"},
                    f"{source_path}/sourcePackage",
                )
            )
        for key in ("id", "version"):
            issues.extend(
                _non_empty(
                    package.get(key),
                    f"{source_path}/sourcePackage/{key}",
                )
            )
        package_hash = package.get("sha256")
        if not _valid_hash(package_hash):
            issues.append(
                _issue(
                    f"{source_path}/sourcePackage/sha256",
                    "schema.hash",
                    "sourcePackage sha256 must be a lowercase SHA-256 digest",
                )
            )
        else:
            package_hashes.append(package_hash)

        provider, provider_issues = _validate_provider_claim(
            source.get("provider"),
            f"{source_path}/provider",
        )
        issues.extend(provider_issues)
        if provider and not provider_issues:
            normalized_provider = _normalize_provider_claim(provider)
            provider_claims.append(
                json.dumps(
                    normalized_provider,
                    sort_keys=True,
                    separators=(",", ":"),
                )
            )
        else:
            normalized_provider = {}

        if (
            isinstance(source_id, str)
            and SAFE_SOURCE_ID.fullmatch(source_id)
            and isinstance(package.get("id"), str)
            and isinstance(package.get("version"), str)
            and _valid_hash(package_hash)
            and normalized_provider
        ):
            normalized.append(
                {
                    "id": source_id,
                    "sourcePackage": {
                        "id": package["id"].strip(),
                        "version": package["version"].strip(),
                        "sha256": package_hash,
                    },
                    "provider": normalized_provider,
                }
            )

    if len(source_ids) != len(set(source_ids)):
        issues.append(
            _issue(path, "dataset.duplicate-source-id", "Source ids must be unique")
        )
    if len(package_hashes) != len(set(package_hashes)):
        issues.append(
            _issue(
                path,
                "dataset.duplicate-source-package",
                "Source-package hashes must be unique",
            )
        )
    if len(set(provider_claims)) < 2:
        issues.append(
            _issue(
                path,
                "dataset.distinct-provider-authority",
                "V6 requires at least two distinct provider claims",
            )
        )
    return normalized, issues


def _read_json(path: Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise AutoQuantValidationError(
            [_issue(path, f"{label}.missing", f"Missing {label}: {path}")]
        ) from None
    except json.JSONDecodeError as error:
        raise AutoQuantValidationError(
            [
                _issue(
                    path,
                    f"{label}.json",
                    f"Invalid JSON at line {error.lineno}, column "
                    f"{error.colno}: {error.msg}",
                )
            ]
        ) from None
    if not isinstance(value, dict):
        raise AutoQuantValidationError(
            [_issue(path, f"{label}.type", f"{label} must be a JSON object")]
        )
    return value


def _write_json(path: Path, value: dict[str, Any]) -> None:
    path.write_text(
        json.dumps(value, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _valid_hash(value: Any) -> bool:
    return (
        isinstance(value, str)
        and len(value) == 64
        and all(character in "0123456789abcdef" for character in value)
    )


def _read_source(path: Path) -> pd.DataFrame:
    suffix = path.suffix.lower()
    if suffix == ".csv":
        return pd.read_csv(path)
    try:
        if suffix == ".parquet":
            return pd.read_parquet(path)
        if suffix == ".feather":
            return pd.read_feather(path)
    except ImportError as error:
        raise AutoQuantValidationError(
            [
                _issue(
                    path,
                    "dataset.columnar-runtime",
                    "Parquet and Feather intake require the optional "
                    "'columnar' dependency; run `uv sync --extra columnar` "
                    "or supply CSV",
                )
            ]
        ) from error
    raise AutoQuantValidationError(
        [
            _issue(
                path,
                "dataset.format",
                "OHLCV source must be CSV, Parquet, or Feather",
            )
        ]
    )


def _canonical_frame(
    path: Path,
    *,
    market_clock: str,
    allow_zero_volume: bool = False,
) -> pd.DataFrame:
    try:
        frame = normalize_ohlcv(_read_source(path), source=str(path))
    except (ValueError, TypeError) as error:
        raise AutoQuantValidationError(
            [_issue(path, "dataset.ohlcv", str(error))]
        ) from error
    prices = frame[["open", "high", "low", "close"]].to_numpy(dtype=float)
    volume = frame["volume"].to_numpy(dtype=float)
    if not np.isfinite(prices).all() or (prices <= 0).any():
        raise AutoQuantValidationError(
            [
                _issue(
                    path,
                    "dataset.non-positive-price",
                    "Daily OHLC prices must be finite and strictly positive",
                )
            ]
        )
    invalid_volume = (
        (volume < 0).any() if allow_zero_volume else (volume <= 0).any()
    )
    if not np.isfinite(volume).all() or invalid_volume:
        qualifier = "non-negative" if allow_zero_volume else "strictly positive"
        raise AutoQuantValidationError(
            [
                _issue(
                    path,
                    "dataset.invalid-volume",
                    f"Daily volume must be finite and {qualifier}",
                )
            ]
        )
    timestamps = pd.DatetimeIndex(frame["date"])
    if market_clock == "session" and (timestamps.weekday >= 5).any():
        raise AutoQuantValidationError(
            [
                _issue(
                    path,
                    "dataset.weekend",
                    "Session dataset cannot contain weekend rows",
                )
            ]
        )
    dates = pd.Index(timestamps.date, dtype="object")
    if dates.duplicated().any():
        raise AutoQuantValidationError(
            [
                _issue(
                    path,
                    "dataset.daily-duplicate",
                    "Daily source contains more than one row for a session date",
                )
            ]
        )
    result = frame[["open", "high", "low", "close", "volume"]].copy()
    result.insert(0, "timestamp", [value.isoformat() for value in dates])
    return result.reset_index(drop=True)


@dataclass(frozen=True)
class PreparedAsset:
    symbol: str
    venue: str
    currency: str
    source_relative_path: str
    source_path: Path
    source_hash: str
    frame: pd.DataFrame
    interval_frames: dict[str, pd.DataFrame] | None = None
    asset_class: str | None = None
    volume_semantics: str | None = None
    source_id: str | None = None


@dataclass(frozen=True)
class PreparedIntake:
    template: str
    request: dict[str, Any]
    request_hash: str
    package: dict[str, Any]
    package_path: Path
    assets: tuple[PreparedAsset, ...]
    start: str
    end: str

    @property
    def universe(self) -> list[str]:
        return [asset.symbol for asset in self.assets]

    @property
    def multi_interval(self) -> bool:
        return self.package["schemaVersion"] in {
            2,
            3,
            *OBSERVED_SCHEMA_VERSIONS,
        }

    @property
    def ragged_daily(self) -> bool:
        return self.package["schemaVersion"] == RAGGED_DAILY_SCHEMA_VERSION

    @property
    def observed_intraday(self) -> bool:
        return self.package["schemaVersion"] in OBSERVED_SCHEMA_VERSIONS

    @property
    def multi_source(self) -> bool:
        return (
            self.package["schemaVersion"]
            == MULTI_SOURCE_OBSERVED_SCHEMA_VERSION
        )

    @property
    def per_asset_classes(self) -> bool:
        return all(
            "assetClass" in asset
            for asset in self.package["assets"]
        )

    @property
    def interval_surface(self) -> dict[str, Any] | None:
        if not self.multi_interval:
            return None
        if self.package["schemaVersion"] == 2:
            return interval_surface(
                self.package["featureIntervals"]
            ).to_dict()
        if self.observed_intraday:
            return observed_interval_surface(
                self.package["baseInterval"],
            ).to_dict()
        return configurable_interval_surface(
            self.package["baseInterval"],
            self.package["featureIntervals"],
            self.package["market"],
        ).to_dict()

    @property
    def annualization_periods(self) -> int:
        if not self.multi_interval:
            return 252
        if self.observed_intraday:
            requested = {
                item["symbol"]: item.get("positionRole")
                for item in self.request["assets"]
            }
            target = next(
                asset
                for asset in self.assets
                if requested.get(asset.symbol) != "context-only"
            )
            return infer_annualization_periods(target.frame["timestamp"])
        return infer_annualization_periods(self.assets[0].frame["timestamp"])


def _validate_v1_package_manifest(
    value: dict[str, Any],
    path: Path,
) -> dict[str, Any]:
    required = {
        "schemaVersion",
        "kind",
        "id",
        "version",
        "assetClass",
        "frequency",
        "market",
        "priceAdjustment",
        "provider",
        "assets",
    }
    issues = _strict_keys(value, required, path)
    if value.get("schemaVersion") != SCHEMA_VERSION:
        issues.append(
            _issue(f"{path}/schemaVersion", "schema.version", "Expected V1")
        )
    if value.get("kind") != DATASET_PACKAGE_KIND:
        issues.append(
            _issue(
                f"{path}/kind",
                "dataset.kind",
                f"Expected {DATASET_PACKAGE_KIND}",
            )
        )
    for key in ("id", "version", "assetClass"):
        issues.extend(_non_empty(value.get(key), f"{path}/{key}"))
    if value.get("frequency") != "1d":
        issues.append(
            _issue(
                f"{path}/frequency",
                "dataset.frequency",
                "V1 intake supports frequency '1d' only",
            )
        )
    if value.get("priceAdjustment") not in PRICE_ADJUSTMENTS:
        issues.append(
            _issue(
                f"{path}/priceAdjustment",
                "dataset.adjustment",
                "Unsupported priceAdjustment",
            )
        )

    market = value.get("market")
    if not isinstance(market, dict):
        issues.append(
            _issue(f"{path}/market", "schema.type", "Market must be an object")
        )
        market = {}
    else:
        issues.extend(
            _strict_keys(
                market,
                {"clock", "calendar", "timezone"},
                f"{path}/market",
            )
        )
    if market.get("clock") != "session":
        issues.append(
            _issue(
                f"{path}/market/clock",
                "dataset.market-clock",
                "V1 intake supports session markets only",
            )
        )
    for key in ("calendar", "timezone"):
        issues.extend(_non_empty(market.get(key), f"{path}/market/{key}"))
    if isinstance(market.get("timezone"), str):
        try:
            ZoneInfo(market["timezone"])
        except (ValueError, ZoneInfoNotFoundError):
            issues.append(
                _issue(
                    f"{path}/market/timezone",
                    "dataset.timezone",
                    "Timezone must be an IANA timezone name",
                )
            )

    provider, provider_issues = _validate_provider_claim(
        value.get("provider"),
        f"{path}/provider",
    )
    issues.extend(provider_issues)

    assets = value.get("assets")
    if not isinstance(assets, list) or not assets:
        issues.append(
            _issue(
                f"{path}/assets",
                "schema.array",
                "Assets must be a non-empty array",
            )
        )
        assets = []
    symbols: list[str] = []
    source_paths: list[str] = []
    for index, asset in enumerate(assets):
        asset_path = f"{path}/assets/{index}"
        if not isinstance(asset, dict):
            issues.append(
                _issue(asset_path, "schema.type", "Asset must be an object")
            )
            continue
        issues.extend(
            _strict_keys(
                asset,
                {
                    "symbol",
                    "venue",
                    "currency",
                    "path",
                    *(
                        ("assetClass",)
                        if "assetClass" in asset
                        else ()
                    ),
                },
                asset_path,
            )
        )
        for key in ("symbol", "venue", "currency", "path"):
            issues.extend(_non_empty(asset.get(key), f"{asset_path}/{key}"))
        symbol = asset.get("symbol")
        if isinstance(symbol, str) and not SAFE_SYMBOL.fullmatch(symbol):
            issues.append(
                _issue(
                    f"{asset_path}/symbol",
                    "dataset.symbol",
                    "Symbol must be a path-safe 1-64 character identifier",
                )
            )
        relative = asset.get("path")
        if isinstance(relative, str):
            try:
                confined_path(path.parent, relative, f"{asset_path}/path")
            except AutoQuantValidationError as error:
                issues.extend(error.issues)
            if Path(relative).suffix.lower() not in SUPPORTED_SOURCE_SUFFIXES:
                issues.append(
                    _issue(
                        f"{asset_path}/path",
                        "dataset.format",
                        "Asset path must end in .csv, .parquet, or .feather",
                    )
                )
        if isinstance(symbol, str):
            symbols.append(symbol)
        if isinstance(relative, str):
            source_paths.append(relative)
    issues.extend(
        _optional_asset_class_issues(
            assets,
            path,
            value.get("assetClass"),
        )
    )
    if len(symbols) != len(set(symbols)):
        issues.append(
            _issue(f"{path}/assets", "dataset.duplicate-symbol", "Symbols must be unique")
        )
    if len(source_paths) != len(set(source_paths)):
        issues.append(
            _issue(
                f"{path}/assets",
                "dataset.duplicate-path",
                "Asset source paths must be unique",
            )
        )
    if issues:
        raise AutoQuantValidationError(issues)
    return {
        **value,
        "id": value["id"].strip(),
        "version": value["version"].strip(),
        "assetClass": value["assetClass"].strip(),
        "market": {
            "clock": market["clock"],
            "calendar": market["calendar"].strip(),
            "timezone": market["timezone"].strip(),
        },
        "provider": _normalize_provider_claim(provider),
        "assets": [
            {
                **{
                    key: asset[key].strip()
                    for key in ("symbol", "venue", "currency", "path")
                },
                **(
                    {"assetClass": asset["assetClass"].strip()}
                    if "assetClass" in asset
                    else {}
                ),
            }
            for asset in assets
        ],
    }


def _validate_v4_package_manifest(
    value: dict[str, Any],
    path: Path,
) -> dict[str, Any]:
    required = {
        "schemaVersion",
        "kind",
        "id",
        "version",
        "assetClass",
        "frequency",
        "panelPolicy",
        "market",
        "priceAdjustment",
        "provider",
        "assets",
    }
    issues = _strict_keys(value, required, path)
    if value.get("schemaVersion") != RAGGED_DAILY_SCHEMA_VERSION:
        issues.append(
            _issue(
                f"{path}/schemaVersion",
                "schema.version",
                f"Expected V{RAGGED_DAILY_SCHEMA_VERSION}",
            )
        )
    if value.get("panelPolicy") != RAGGED_PANEL_POLICY:
        issues.append(
            _issue(
                f"{path}/panelPolicy",
                "dataset.panel-policy",
                "V4 requires the fixed observed-only, absent-no-fill "
                "daily panel policy",
            )
        )
    common = {
        key: item
        for key, item in value.items()
        if key not in {"schemaVersion", "panelPolicy"}
    }
    common["schemaVersion"] = SCHEMA_VERSION
    try:
        normalized = _validate_v1_package_manifest(common, path)
    except AutoQuantValidationError as error:
        issues.extend(error.issues)
        normalized = common
    if issues:
        raise AutoQuantValidationError(issues)
    return {
        **normalized,
        "schemaVersion": RAGGED_DAILY_SCHEMA_VERSION,
        "panelPolicy": dict(RAGGED_PANEL_POLICY),
    }


def _validate_v5_package_manifest(
    value: dict[str, Any],
    path: Path,
) -> dict[str, Any]:
    """Validate a Factor-only observed base-bar package."""

    required = {
        "schemaVersion",
        "kind",
        "id",
        "version",
        "assetClass",
        "baseInterval",
        "timestampSemantics",
        "panelPolicy",
        "market",
        "priceAdjustment",
        "provider",
        "assets",
    }
    issues = _strict_keys(value, required, path)
    if value.get("schemaVersion") != OBSERVED_INTRADAY_SCHEMA_VERSION:
        issues.append(
            _issue(
                f"{path}/schemaVersion",
                "schema.version",
                f"Expected V{OBSERVED_INTRADAY_SCHEMA_VERSION}",
            )
        )
    if value.get("kind") != DATASET_PACKAGE_KIND:
        issues.append(
            _issue(
                f"{path}/kind",
                "dataset.kind",
                f"Expected {DATASET_PACKAGE_KIND}",
            )
        )
    for key in ("id", "version", "assetClass"):
        issues.extend(_non_empty(value.get(key), f"{path}/{key}"))
    try:
        surface = observed_interval_surface(value.get("baseInterval")).to_dict()
    except IntervalContractError as error:
        issues.append(_issue(f"{path}/baseInterval", error.code, str(error)))
        surface = observed_interval_surface(BASE_INTERVAL).to_dict()
    if value.get("timestampSemantics") != "bar-close":
        issues.append(
            _issue(
                f"{path}/timestampSemantics",
                "dataset.timestamp-semantics",
                "V5 source timestamps must already mean completed bar close",
            )
        )
    if value.get("panelPolicy") != OBSERVED_PANEL_POLICY:
        issues.append(
            _issue(
                f"{path}/panelPolicy",
                "dataset.panel-policy",
                "V5 requires observed-only, absent-no-fill, "
                "per-target-observed-bar horizon authority",
            )
        )
    if value.get("market") != OBSERVED_INTRADAY_MARKET:
        issues.append(
            _issue(
                f"{path}/market",
                "dataset.market-clock",
                "V5 requires provider-observed UTC timestamp authority",
            )
        )
    if value.get("priceAdjustment") not in PRICE_ADJUSTMENTS:
        issues.append(
            _issue(
                f"{path}/priceAdjustment",
                "dataset.adjustment",
                "Unsupported priceAdjustment",
            )
        )

    provider, provider_issues = _validate_provider_claim(
        value.get("provider"),
        f"{path}/provider",
    )
    issues.extend(provider_issues)

    assets = value.get("assets")
    if not isinstance(assets, list) or not assets:
        issues.append(
            _issue(f"{path}/assets", "schema.array", "Assets must be non-empty")
        )
        assets = []
    symbols: list[str] = []
    source_paths: list[str] = []
    asset_classes: list[str] = []
    normalized_assets: list[dict[str, str]] = []
    for index, asset in enumerate(assets):
        asset_path = f"{path}/assets/{index}"
        if not isinstance(asset, dict):
            issues.append(_issue(asset_path, "schema.type", "Asset must be an object"))
            continue
        issues.extend(
            _strict_keys(
                asset,
                {
                    "symbol",
                    "assetClass",
                    "venue",
                    "currency",
                    "path",
                    "volumeSemantics",
                },
                asset_path,
            )
        )
        for key in (
            "symbol",
            "assetClass",
            "venue",
            "currency",
            "path",
            "volumeSemantics",
        ):
            issues.extend(_non_empty(asset.get(key), f"{asset_path}/{key}"))
        symbol = asset.get("symbol")
        if isinstance(symbol, str):
            symbols.append(symbol)
            if not SAFE_SYMBOL.fullmatch(symbol):
                issues.append(
                    _issue(
                        f"{asset_path}/symbol",
                        "dataset.symbol",
                        "Symbol must be a path-safe 1-64 character identifier",
                    )
                )
        asset_class = asset.get("assetClass")
        if asset_class not in ASSET_CLASSES:
            issues.append(
                _issue(
                    f"{asset_path}/assetClass",
                    "dataset.asset-class",
                    "Unsupported asset class",
                )
            )
        elif isinstance(asset_class, str):
            asset_classes.append(asset_class)
        volume_semantics = asset.get("volumeSemantics")
        if volume_semantics not in OBSERVED_VOLUME_SEMANTICS:
            issues.append(
                _issue(
                    f"{asset_path}/volumeSemantics",
                    "dataset.volume-semantics",
                    "Unsupported observed volume semantics",
                )
            )
        relative = asset.get("path")
        if isinstance(relative, str):
            source_paths.append(relative)
            try:
                confined_path(path.parent, relative, f"{asset_path}/path")
            except AutoQuantValidationError as error:
                issues.extend(error.issues)
            if Path(relative).suffix.lower() not in SUPPORTED_SOURCE_SUFFIXES:
                issues.append(
                    _issue(
                        f"{asset_path}/path",
                        "dataset.format",
                        "Asset path must end in .csv, .parquet, or .feather",
                    )
                )
        if all(
            isinstance(asset.get(key), str)
            for key in (
                "symbol",
                "assetClass",
                "venue",
                "currency",
                "path",
                "volumeSemantics",
            )
        ):
            normalized_assets.append(
                {
                    key: asset[key].strip()
                    for key in (
                        "symbol",
                        "assetClass",
                        "venue",
                        "currency",
                        "path",
                        "volumeSemantics",
                    )
                }
            )
    if len(symbols) != len(set(symbols)):
        issues.append(
            _issue(
                f"{path}/assets",
                "dataset.duplicate-symbol",
                "Symbols must be unique",
            )
        )
    if len(source_paths) != len(set(source_paths)):
        issues.append(
            _issue(
                f"{path}/assets",
                "dataset.duplicate-path",
                "Asset source paths must be unique",
            )
        )
    expected_class = (
        next(iter(set(asset_classes)))
        if len(set(asset_classes)) == 1
        else "mixed"
    )
    if asset_classes and value.get("assetClass") != expected_class:
        issues.append(
            _issue(
                f"{path}/assetClass",
                "dataset.asset-class-summary",
                f"assetClass must summarize per-asset classes as '{expected_class}'",
            )
        )
    if issues:
        raise AutoQuantValidationError(issues)
    return {
        **value,
        "id": value["id"].strip(),
        "version": value["version"].strip(),
        "assetClass": value["assetClass"].strip(),
        "baseInterval": surface["baseInterval"],
        "timestampSemantics": "bar-close",
        "panelPolicy": dict(OBSERVED_PANEL_POLICY),
        "market": dict(OBSERVED_INTRADAY_MARKET),
        "provider": _normalize_provider_claim(provider),
        "assets": normalized_assets,
    }


def _validate_v6_package_manifest(
    value: dict[str, Any],
    path: Path,
) -> dict[str, Any]:
    """Validate one multi-source observed base-bar Factor package."""

    required = {
        "schemaVersion",
        "kind",
        "id",
        "version",
        "assetClass",
        "baseInterval",
        "timestampSemantics",
        "panelPolicy",
        "market",
        "priceAdjustment",
        "sources",
        "assets",
    }
    issues = _strict_keys(value, required, path)
    if value.get("schemaVersion") != MULTI_SOURCE_OBSERVED_SCHEMA_VERSION:
        issues.append(
            _issue(
                f"{path}/schemaVersion",
                "schema.version",
                f"Expected V{MULTI_SOURCE_OBSERVED_SCHEMA_VERSION}",
            )
        )
    sources, source_issues = _validate_source_claims(
        value.get("sources"),
        f"{path}/sources",
    )
    issues.extend(source_issues)

    raw_assets = value.get("assets")
    projected_assets: list[Any] = []
    source_ids: list[str] = []
    if isinstance(raw_assets, list):
        for index, asset in enumerate(raw_assets):
            if not isinstance(asset, dict):
                projected_assets.append(asset)
                continue
            asset_path = f"{path}/assets/{index}"
            source_id = asset.get("sourceId")
            if not isinstance(source_id, str) or not SAFE_SOURCE_ID.fullmatch(
                source_id
            ):
                issues.append(
                    _issue(
                        f"{asset_path}/sourceId",
                        "dataset.source-id",
                        "Every V6 asset must name one path-safe source id",
                    )
                )
            else:
                source_ids.append(source_id)
            projected_assets.append(
                {key: item for key, item in asset.items() if key != "sourceId"}
            )
    else:
        projected_assets = raw_assets

    fallback_provider = (
        sources[0]["provider"]
        if sources
        else {
            "name": "invalid",
            "retrievedAt": None,
            "sourceUri": None,
            "terms": "invalid",
        }
    )
    v5_projection = {
        **{
            key: item
            for key, item in value.items()
            if key not in {"sources", "assets"}
        },
        "schemaVersion": OBSERVED_INTRADAY_SCHEMA_VERSION,
        "provider": fallback_provider,
        "assets": projected_assets,
    }
    normalized_v5: dict[str, Any] | None = None
    try:
        normalized_v5 = _validate_v5_package_manifest(v5_projection, path)
    except AutoQuantValidationError as error:
        issues.extend(error.issues)

    declared_source_ids = [source["id"] for source in sources]
    unknown = sorted(set(source_ids) - set(declared_source_ids))
    unused = sorted(set(declared_source_ids) - set(source_ids))
    if unknown:
        issues.append(
            _issue(
                f"{path}/assets",
                "dataset.unknown-source-id",
                "Assets reference unknown source ids: " + ", ".join(unknown),
            )
        )
    if unused:
        issues.append(
            _issue(
                f"{path}/sources",
                "dataset.unused-source",
                "Every V6 source must own at least one asset: " + ", ".join(unused),
            )
        )
    if issues:
        raise AutoQuantValidationError(issues)
    assert normalized_v5 is not None
    return {
        **{
            key: item
            for key, item in normalized_v5.items()
            if key != "provider"
        },
        "schemaVersion": MULTI_SOURCE_OBSERVED_SCHEMA_VERSION,
        "sources": sources,
        "assets": [
            {
                **asset,
                "sourceId": raw_assets[index]["sourceId"].strip(),
            }
            for index, asset in enumerate(normalized_v5["assets"])
        ],
    }


def _validate_v2_package_manifest(
    value: dict[str, Any],
    path: Path,
) -> dict[str, Any]:
    required = {
        "schemaVersion",
        "kind",
        "id",
        "version",
        "assetClass",
        "baseInterval",
        "featureIntervals",
        "timestampSemantics",
        "aggregation",
        "market",
        "priceAdjustment",
        "provider",
        "assets",
    }
    issues = _strict_keys(value, required, path)
    if value.get("schemaVersion") != 2:
        issues.append(_issue(path, "schema.version", "Expected V2 dataset package"))
    if value.get("kind") != DATASET_PACKAGE_KIND:
        issues.append(
            _issue(
                f"{path}/kind",
                "dataset.kind",
                f"Expected {DATASET_PACKAGE_KIND}",
            )
        )
    for key in ("id", "version", "assetClass"):
        issues.extend(_non_empty(value.get(key), f"{path}/{key}"))
    if value.get("baseInterval") != BASE_INTERVAL:
        issues.append(
            _issue(
                f"{path}/baseInterval",
                "dataset.base-interval",
                "V2 intake currently requires baseInterval '1h'",
            )
        )
    try:
        feature_intervals = normalize_feature_intervals(
            value.get("featureIntervals", [])
        )
        if not feature_intervals:
            raise IntervalContractError(
                "interval.empty",
                "featureIntervals must contain at least one higher interval",
            )
    except IntervalContractError as error:
        issues.append(
            _issue(
                f"{path}/featureIntervals",
                error.code,
                str(error),
            )
        )
        feature_intervals = ()
    if value.get("timestampSemantics") != "bar-close":
        issues.append(
            _issue(
                f"{path}/timestampSemantics",
                "dataset.timestamp-semantics",
                "V2 timestamps must mean bar-close",
            )
        )
    aggregation = value.get("aggregation")
    if not isinstance(aggregation, dict):
        issues.append(
            _issue(
                f"{path}/aggregation",
                "schema.type",
                "aggregation must be an object",
            )
        )
        aggregation = {}
    else:
        issues.extend(
            _strict_keys(
                aggregation,
                {"method", "anchor"},
                f"{path}/aggregation",
            )
        )
    if aggregation.get("method") != AGGREGATION_METHOD:
        issues.append(
            _issue(
                f"{path}/aggregation/method",
                "dataset.aggregation",
                f"V2 aggregation method must be {AGGREGATION_METHOD}",
            )
        )
    if aggregation.get("anchor") != "00:00":
        issues.append(
            _issue(
                f"{path}/aggregation/anchor",
                "dataset.anchor",
                "V2 continuous aggregation anchor must be UTC 00:00",
            )
        )
    market = value.get("market")
    if not isinstance(market, dict):
        issues.append(_issue(f"{path}/market", "schema.type", "Market must be an object"))
        market = {}
    else:
        issues.extend(
            _strict_keys(
                market,
                {"clock", "calendar", "timezone"},
                f"{path}/market",
            )
        )
    expected_market = {
        "clock": "continuous",
        "calendar": "24/7",
        "timezone": "UTC",
    }
    if market != expected_market:
        issues.append(
            _issue(
                f"{path}/market",
                "dataset.market-clock",
                "V2 currently requires continuous 24/7 UTC market authority",
            )
        )
    if value.get("priceAdjustment") not in PRICE_ADJUSTMENTS:
        issues.append(
            _issue(
                f"{path}/priceAdjustment",
                "dataset.adjustment",
                "Unsupported priceAdjustment",
            )
        )

    provider, provider_issues = _validate_provider_claim(
        value.get("provider"),
        f"{path}/provider",
    )
    issues.extend(provider_issues)

    assets = value.get("assets")
    if not isinstance(assets, list) or not assets:
        issues.append(_issue(f"{path}/assets", "schema.array", "Assets must be non-empty"))
        assets = []
    symbols: list[str] = []
    source_paths: list[str] = []
    for index, asset in enumerate(assets):
        asset_path = f"{path}/assets/{index}"
        if not isinstance(asset, dict):
            issues.append(_issue(asset_path, "schema.type", "Asset must be an object"))
            continue
        issues.extend(
            _strict_keys(
                asset,
                {
                    "symbol",
                    "venue",
                    "currency",
                    "path",
                    *(
                        ("assetClass",)
                        if "assetClass" in asset
                        else ()
                    ),
                },
                asset_path,
            )
        )
        for key in ("symbol", "venue", "currency", "path"):
            issues.extend(_non_empty(asset.get(key), f"{asset_path}/{key}"))
        symbol = asset.get("symbol")
        relative = asset.get("path")
        if isinstance(symbol, str):
            if not SAFE_SYMBOL.fullmatch(symbol):
                issues.append(
                    _issue(f"{asset_path}/symbol", "dataset.symbol", "Invalid symbol")
                )
            symbols.append(symbol)
        if isinstance(relative, str):
            try:
                confined_path(path.parent, relative, f"{asset_path}/path")
            except AutoQuantValidationError as error:
                issues.extend(error.issues)
            if Path(relative).suffix.lower() not in SUPPORTED_SOURCE_SUFFIXES:
                issues.append(
                    _issue(
                        f"{asset_path}/path",
                        "dataset.format",
                        "Asset path must end in .csv, .parquet, or .feather",
                    )
                )
            source_paths.append(relative)
    issues.extend(
        _optional_asset_class_issues(
            assets,
            path,
            value.get("assetClass"),
        )
    )
    if len(symbols) != len(set(symbols)):
        issues.append(_issue(f"{path}/assets", "dataset.duplicate-symbol", "Symbols must be unique"))
    if len(source_paths) != len(set(source_paths)):
        issues.append(_issue(f"{path}/assets", "dataset.duplicate-path", "Paths must be unique"))
    if issues:
        raise AutoQuantValidationError(issues)
    return {
        **value,
        "id": value["id"].strip(),
        "version": value["version"].strip(),
        "assetClass": value["assetClass"].strip(),
        "featureIntervals": list(feature_intervals),
        "aggregation": {
            "method": aggregation["method"],
            "anchor": aggregation["anchor"],
        },
        "market": expected_market,
        "provider": _normalize_provider_claim(provider),
        "assets": [
            {
                **{
                    key: asset[key].strip()
                    for key in ("symbol", "venue", "currency", "path")
                },
                **(
                    {"assetClass": asset["assetClass"].strip()}
                    if "assetClass" in asset
                    else {}
                ),
            }
            for asset in assets
        ],
    }


def _validate_v3_package_manifest(
    value: dict[str, Any],
    path: Path,
) -> dict[str, Any]:
    required = {
        "schemaVersion",
        "kind",
        "id",
        "version",
        "assetClass",
        "baseInterval",
        "featureIntervals",
        "timestampSemantics",
        "aggregation",
        "market",
        "priceAdjustment",
        "provider",
        "assets",
    }
    issues = _strict_keys(value, required, path)
    if value.get("schemaVersion") != 3:
        issues.append(_issue(path, "schema.version", "Expected V3 dataset package"))
    if value.get("kind") != DATASET_PACKAGE_KIND:
        issues.append(
            _issue(
                f"{path}/kind",
                "dataset.kind",
                f"Expected {DATASET_PACKAGE_KIND}",
            )
        )
    market = value.get("market")
    if not isinstance(market, dict):
        issues.append(
            _issue(f"{path}/market", "schema.type", "Market must be an object")
        )
        market = {}
    else:
        issues.extend(
            _strict_keys(
                market,
                {"clock", "calendar", "timezone"},
                f"{path}/market",
            )
        )
    try:
        surface = configurable_interval_surface(
            value.get("baseInterval"),
            value.get("featureIntervals", []),
            market,
        ).to_dict()
    except IntervalContractError as error:
        issues.append(
            _issue(f"{path}/featureIntervals", error.code, str(error))
        )
        surface = None
    if value.get("timestampSemantics") != "bar-close":
        issues.append(
            _issue(
                f"{path}/timestampSemantics",
                "dataset.timestamp-semantics",
                "V3 timestamps must mean bar-close",
            )
        )
    aggregation = value.get("aggregation")
    if not isinstance(aggregation, dict):
        issues.append(
            _issue(
                f"{path}/aggregation",
                "schema.type",
                "aggregation must be an object",
            )
        )
        aggregation = {}
    else:
        issues.extend(
            _strict_keys(
                aggregation,
                {"method", "anchor", "terminalBucketPolicy"},
                f"{path}/aggregation",
            )
        )
    if surface is not None:
        expected_aggregation = {
            "method": surface["aggregationMethod"],
            "anchor": surface["anchor"],
            "terminalBucketPolicy": surface["terminalBucketPolicy"],
        }
        if aggregation != expected_aggregation:
            issues.append(
                _issue(
                    f"{path}/aggregation",
                    "dataset.aggregation",
                    "V3 aggregation must match its canonical interval surface",
                )
            )
    common_projection = {
        **{
            key: value.get(key)
            for key in (
                "kind",
                "id",
                "version",
                "assetClass",
                "priceAdjustment",
                "provider",
                "assets",
            )
        },
        "schemaVersion": 2,
        "baseInterval": BASE_INTERVAL,
        "featureIntervals": ["3h"],
        "timestampSemantics": "bar-close",
        "aggregation": {
            "method": AGGREGATION_METHOD,
            "anchor": "00:00",
        },
        "market": {
            "clock": "continuous",
            "calendar": "24/7",
            "timezone": "UTC",
        },
    }
    normalized_common = None
    try:
        normalized_common = _validate_v2_package_manifest(
            common_projection,
            path,
        )
    except AutoQuantValidationError as error:
        issues.extend(error.issues)
    if issues:
        raise AutoQuantValidationError(issues)
    assert normalized_common is not None and surface is not None
    return {
        **value,
        "id": normalized_common["id"],
        "version": normalized_common["version"],
        "assetClass": normalized_common["assetClass"],
        "baseInterval": surface["baseInterval"],
        "featureIntervals": surface["featureIntervals"],
        "aggregation": {
            "method": surface["aggregationMethod"],
            "anchor": surface["anchor"],
            "terminalBucketPolicy": surface["terminalBucketPolicy"],
        },
        "market": {
            "clock": surface["marketClock"],
            "calendar": surface["calendar"],
            "timezone": surface["timezone"],
        },
        "provider": normalized_common["provider"],
        "assets": normalized_common["assets"],
    }


def _validate_package_manifest(
    value: dict[str, Any],
    path: Path,
) -> dict[str, Any]:
    if value.get("schemaVersion") == MULTI_SOURCE_OBSERVED_SCHEMA_VERSION:
        return _validate_v6_package_manifest(value, path)
    if value.get("schemaVersion") == OBSERVED_INTRADAY_SCHEMA_VERSION:
        return _validate_v5_package_manifest(value, path)
    if value.get("schemaVersion") == RAGGED_DAILY_SCHEMA_VERSION:
        return _validate_v4_package_manifest(value, path)
    if value.get("schemaVersion") == 3:
        return _validate_v3_package_manifest(value, path)
    if value.get("schemaVersion") == 2:
        return _validate_v2_package_manifest(value, path)
    return _validate_v1_package_manifest(value, path)


def _daily_panel_availability_from_dates(
    asset_dates: list[list[str]],
    *,
    minimum_assets_per_factor_timestamp: int = (
        FACTOR_MIN_ASSETS_PER_TIMESTAMP
    ),
    eligible_dates: list[str] | None = None,
) -> tuple[list[str], dict[str, Any]]:
    if not asset_dates:
        return [], {
            "alignment": RAGGED_PANEL_POLICY["alignment"],
            "missingObservation": RAGGED_PANEL_POLICY[
                "missingObservation"
            ],
            "unionObservations": 0,
            "intersectionObservations": 0,
            "eligibleFactorObservations": 0,
            "minimumAssetsPerFactorTimestamp": (
                minimum_assets_per_factor_timestamp
            ),
            "observedRows": 0,
            "possibleRows": 0,
            "observationCoverage": 0.0,
            "assetsPerTimestamp": {
                "minimum": 0,
                "median": 0.0,
                "maximum": 0,
            },
        }
    date_sets = [set(dates) for dates in asset_dates]
    union_dates = sorted(set().union(*date_sets))
    intersection_dates = sorted(set.intersection(*date_sets))
    counts = [
        sum(date in dates for dates in date_sets)
        for date in union_dates
    ]
    possible = len(union_dates) * len(asset_dates)
    observed = sum(len(dates) for dates in date_sets)
    eligible = (
        len(eligible_dates)
        if eligible_dates is not None
        else sum(
            count >= minimum_assets_per_factor_timestamp
            for count in counts
        )
    )
    return union_dates, {
        "alignment": RAGGED_PANEL_POLICY["alignment"],
        "missingObservation": RAGGED_PANEL_POLICY["missingObservation"],
        "unionObservations": len(union_dates),
        "intersectionObservations": len(intersection_dates),
        "eligibleFactorObservations": eligible,
        "minimumAssetsPerFactorTimestamp": (
            minimum_assets_per_factor_timestamp
        ),
        "observedRows": observed,
        "possibleRows": possible,
        "observationCoverage": (
            float(observed / possible) if possible else 0.0
        ),
        "assetsPerTimestamp": {
            "minimum": min(counts) if counts else 0,
            "median": (
                float(np.median(np.asarray(counts, dtype=float)))
                if counts
                else 0.0
            ),
            "maximum": max(counts) if counts else 0,
        },
    }


def _daily_panel_availability(
    assets: list[PreparedAsset] | tuple[PreparedAsset, ...],
) -> tuple[list[str], dict[str, Any]]:
    return _daily_panel_availability_from_dates(
        [
            [str(value) for value in asset.frame["timestamp"]]
            for asset in assets
        ]
    )


def prepare_project_intake(
    request_path: str | Path,
    package_path: str | Path,
    template: str,
    *,
    minimum_observations_override: int | None = None,
    external_holdout: bool = False,
) -> PreparedIntake:
    """Validate external request/data before a Project staging directory exists."""

    study_owned = template == STUDY_OWNED_DATASET_PROFILE
    admitted_profiles = {
        **INTAKE_TEMPLATE_REQUIREMENTS,
        STUDY_OWNED_DATASET_PROFILE: STUDY_OWNED_DATASET_REQUIREMENTS,
    }
    if template not in admitted_profiles:
        raise AutoQuantValidationError(
            [
                _issue(
                    template,
                    "intake.template",
                    "Intake profile must be one of: "
                    + ", ".join(admitted_profiles),
                )
            ]
    )
    request = load_research_request(request_path)
    manifest_path = Path(package_path).expanduser().absolute()
    if manifest_path.is_symlink():
        raise AutoQuantValidationError(
            [_issue(manifest_path, "path.symlink", "Dataset manifest cannot be a symlink")]
        )
    if manifest_path.is_dir():
        raise AutoQuantValidationError(
            [
                _issue(
                    manifest_path,
                    "dataset.manifest-path-required",
                    "--dataset must point to the dataset-package JSON "
                    "manifest file, not its containing directory",
                )
            ]
        )
    if external_holdout and template != "ohlcv-research-desk":
        raise AutoQuantValidationError(
            [
                _issue(
                    template,
                    "holdout.template",
                    "Frozen holdout target intake requires "
                    "ohlcv-research-desk",
                )
            ]
        )
    if (
        minimum_observations_override is not None
        and (
            not isinstance(minimum_observations_override, int)
            or isinstance(minimum_observations_override, bool)
            or minimum_observations_override < 1
        )
    ):
        raise AutoQuantValidationError(
            [
                _issue(
                    template,
                    "holdout.minimum-observations",
                    "Holdout minimum observations must be a positive integer",
                )
            ]
        )
    manifest_path = manifest_path.resolve()
    package = _validate_package_manifest(
        _read_json(manifest_path, "dataset package"),
        manifest_path,
    )
    prepared: list[PreparedAsset] = []
    issues: list[ValidationIssue] = []
    expected_dates: list[Any] | None = None
    ragged_daily = (
        package["schemaVersion"] == RAGGED_DAILY_SCHEMA_VERSION
    )
    observed_intraday = (
        package["schemaVersion"] in OBSERVED_SCHEMA_VERSIONS
    )
    factor_policy = request.get("factorPolicy")
    observed_target_symbols = (
        list(factor_policy.get("predictionAssets", []))
        if isinstance(factor_policy, dict)
        and factor_policy.get("claim") == "decision-signal"
        else []
    )
    if ragged_daily and template != "ohlcv-factor-lab":
        issues.append(
            _issue(
                manifest_path,
                "dataset.ragged-factor-only",
                "V4 observed-only ragged daily panels are supported only "
                "by the ohlcv-factor-lab template",
            )
        )
    if observed_intraday and template != "ohlcv-factor-lab":
        issues.append(
            _issue(
                manifest_path,
                "dataset.observed-bar-factor-only",
                "V5/V6 observed-only base-bar panels are supported only by "
                "the ohlcv-factor-lab template",
            )
        )
    if observed_intraday and len(observed_target_symbols) != 1:
        issues.append(
            _issue(
                "request/assets",
                "request.observed-bar-target",
                "V5/V6 require a decision-signal factorPolicy with exactly "
                "one explicit prediction asset",
            )
        )
    package_surface = (
        configurable_interval_surface(
            package["baseInterval"],
            package["featureIntervals"],
            package["market"],
        ).to_dict()
        if package["schemaVersion"] == 3
        else (
            observed_interval_surface(
                package["baseInterval"],
            ).to_dict()
            if observed_intraday
            else None
        )
    )
    portfolio_policy = request.get("portfolioPolicy")
    decision_schedule = (
        portfolio_policy.get("decisionSchedule")
        if isinstance(portfolio_policy, dict)
        else None
    )
    if (
        isinstance(decision_schedule, dict)
        and decision_schedule.get("kind") == "every-bars"
        and decision_schedule.get("anchor") == "session-start"
        and (
            package["schemaVersion"] != 3
            or not isinstance(package_surface, dict)
            or package_surface.get("marketClock") != "session"
            or package_surface.get("calendar") != "XNYS"
            or package_surface.get("baseInterval") == "1d"
        )
    ):
        issues.append(
            _issue(
                "request/portfolioPolicy/decisionSchedule/anchor",
                "request.dataset-decision-anchor",
                "session-start requires a V3 intraday XNYS "
                "regular-session package",
            )
        )
    if (
        isinstance(decision_schedule, dict)
        and decision_schedule.get("kind") == "calendar-month-end"
        and (
            package["schemaVersion"] != 1
            or package.get("frequency") != "1d"
            or package.get("market", {}).get("clock") != "session"
            or package.get("market", {}).get("calendar") != "XNYS"
        )
    ):
        issues.append(
            _issue(
                "request/portfolioPolicy/decisionSchedule",
                "request.dataset-decision-schedule",
                "calendar-month-end requires a V1 daily XNYS "
                "regular-session package",
            )
        )
    for index, asset in enumerate(package["assets"]):
        source = confined_path(
            manifest_path.parent,
            asset["path"],
            f"{manifest_path}/assets/{index}/path",
        )
        if not source.is_file():
            issues.append(
                _issue(source, "dataset.source-missing", f"Missing asset source: {source}")
            )
            continue
        interval_frames = None
        if package["schemaVersion"] in {2, 3}:
            try:
                frame = (
                    validate_continuous_hourly_ohlcv(
                        _read_source(source),
                        label=asset["symbol"],
                    )
                    if package["schemaVersion"] == 2
                    else validate_base_ohlcv(
                        _read_source(source),
                        package_surface,
                        label=asset["symbol"],
                    )
                )
                interval_frames = {
                    package["baseInterval"]: frame,
                    **{
                        interval: (
                            aggregate_completed_ohlcv(frame, interval)
                            if package["schemaVersion"] == 2
                            else aggregate_interval_ohlcv(
                                frame,
                                package_surface,
                                interval,
                            )
                        )
                        for interval in package["featureIntervals"]
                    },
                }
            except IntervalContractError as error:
                issues.append(_issue(source, error.code, str(error)))
                continue
        elif observed_intraday:
            try:
                frame = validate_observed_ohlcv(
                    _read_source(source).rename(
                        columns={"date": "timestamp"}
                    ),
                    label=asset["symbol"],
                )
                if (
                    asset["volumeSemantics"] == "unavailable-zero"
                    and not frame["volume"].eq(0).all()
                ):
                    raise IntervalContractError(
                        "interval.volume-semantics",
                        f"{asset['symbol']} declares unavailable-zero volume "
                        "but contains nonzero observations",
                    )
                interval_frames = {
                    package["baseInterval"]: frame,
                }
            except IntervalContractError as error:
                issues.append(_issue(source, error.code, str(error)))
                continue
        else:
            frame = _canonical_frame(
                source,
                market_clock=package["market"]["clock"],
                allow_zero_volume=(template == "ohlcv-event-study-lab"),
            )
        dates = frame["timestamp"].tolist()
        if expected_dates is None:
            expected_dates = dates
        elif (
            dates != expected_dates
            and not ragged_daily
            and not observed_intraday
        ):
            panel = (
                "exact base timestamp panel"
                if package["schemaVersion"] in {2, 3}
                else "exact daily timestamp panel"
            )
            issues.append(
                _issue(
                    source,
                    "dataset.panel-misaligned",
                    f"Every asset must share the {panel}",
                )
            )
        prepared.append(
            PreparedAsset(
                symbol=asset["symbol"],
                venue=asset["venue"],
                currency=asset["currency"],
                source_relative_path=asset["path"],
                source_path=source,
                source_hash=hash_file(source),
                frame=frame,
                interval_frames=interval_frames,
                asset_class=asset.get(
                    "assetClass",
                    package["assetClass"],
                ),
                volume_semantics=(
                    asset["volumeSemantics"]
                    if observed_intraday
                    else None
                ),
                source_id=asset.get("sourceId"),
            )
        )
    prepared_by_symbol = {asset.symbol: asset for asset in prepared}
    observed_target = (
        prepared_by_symbol.get(observed_target_symbols[0])
        if observed_intraday and len(observed_target_symbols) == 1
        else None
    )
    panel_dates = (
        _daily_panel_availability(prepared)[0]
        if ragged_daily
        else (
            observed_target.frame["timestamp"].tolist()
            if observed_target is not None
            else list(expected_dates or [])
        )
    )
    availability = (
        _daily_panel_availability(prepared)[1]
        if ragged_daily or observed_intraday
        else None
    )
    if ragged_daily or observed_intraday:
        for asset in prepared:
            if len(asset.frame) < FACTOR_MIN_ASSET_OBSERVATIONS:
                issues.append(
                    _issue(
                        asset.source_path,
                        "dataset.asset-observations",
                        f"{asset.symbol} has fewer than "
                        f"{FACTOR_MIN_ASSET_OBSERVATIONS} observed rows",
                    )
                )
    minimum_assets, minimum_observations = admitted_profiles[template]
    if minimum_observations_override is not None:
        minimum_observations = minimum_observations_override
    if observed_intraday:
        minimum_assets = 1
    resolved_factor_outcome = factor_outcome(
        factor_policy if isinstance(factor_policy, dict) else {}
    )
    if (
        resolved_factor_outcome == FORWARD_REALIZED_VOLATILITY_OUTCOME
        and not study_owned
        and template != "ohlcv-factor-lab"
    ):
        issues.append(
            _issue(
                "request/factorPolicy/outcome",
                "request.factor-outcome-template",
                "forward-realized-volatility is consumed only by the "
                "standalone ohlcv-factor-lab; Portfolio and governed RL "
                "currently require forward-return meaning",
            )
        )
    if (
        resolved_factor_outcome == FORWARD_REALIZED_VOLATILITY_OUTCOME
        and isinstance(factor_policy, dict)
        and factor_policy.get("claim") == "decision-signal"
        and len(observed_target_symbols) in {2, 3}
    ):
        issues.append(
            _issue(
                "request/factorPolicy/outcome",
                "request.factor-outcome-population",
                "forward-realized-volatility supports one temporal target "
                "or at least four cross-sectional prediction assets; it "
                "does not define a two-asset risk contrast or three-asset "
                "basket",
            )
        )
    if (
        template == "ohlcv-factor-lab"
        and isinstance(factor_policy, dict)
        and factor_policy.get("claim") == "decision-signal"
        and len(observed_target_symbols) in {1, 2}
    ):
        minimum_assets = len(observed_target_symbols)
    if template in {
        "ohlcv-factor-lab",
        "ohlcv-portfolio-lab",
        "ohlcv-rl-factor-lab",
        "ohlcv-research-desk",
    }:
        try:
            build_factor_population(request, list(prepared_by_symbol))
        except PredictionModeError as error:
            issues.append(
                _issue(
                    "request/factorPolicy/predictionAssets",
                    error.code,
                    str(error),
                )
            )
    if len(prepared) < minimum_assets:
        issues.append(
            _issue(
                manifest_path,
                "dataset.breadth",
                f"{template} requires at least {minimum_assets} aligned assets",
            )
        )
    observations = len(panel_dates)
    if observations < minimum_observations:
        unit = (
            f"base {package['baseInterval']}"
            if package["schemaVersion"]
            in {2, 3, *OBSERVED_SCHEMA_VERSIONS}
            else "daily"
        )
        issues.append(
            _issue(
                manifest_path,
                "dataset.observations",
                (
                    "Frozen external holdout target"
                    if external_holdout
                    else template
                )
                + f" requires at least {minimum_observations} {unit} rows",
            )
        )
    if (
        availability is not None
        and not observed_intraday
        and availability["eligibleFactorObservations"]
        < minimum_observations
    ):
        issues.append(
            _issue(
                manifest_path,
                "dataset.factor-breadth-history",
                (
                    "Frozen external holdout target"
                    if external_holdout
                    else template
                )
                + f" requires at least {minimum_observations} "
                f"timestamps with {FACTOR_MIN_ASSETS_PER_TIMESTAMP} or "
                "more observed assets",
            )
        )

    package_by_symbol = prepared_by_symbol
    for item in request["assets"]:
        source = package_by_symbol.get(item["symbol"])
        if source is None:
            issues.append(
                _issue(
                    "request/assets",
                    "request.dataset-universe",
                    f"Requested asset is absent from dataset: {item['symbol']}",
                )
            )
        elif item["venue"] is not None and item["venue"] != source.venue:
            issues.append(
                _issue(
                    "request/assets",
                    "request.dataset-venue",
                    f"Requested venue for {item['symbol']} differs from dataset",
                )
            )
        elif item["assetClass"] != source.asset_class:
            issues.append(
                _issue(
                    "request/assets",
                    "request.dataset-asset-class",
                    "Every requested asset class must match its dataset "
                    f"assetClass; {item['symbol']} differs from "
                    f"'{source.asset_class}'",
                )
            )
    if panel_dates:
        try:
            (
                validate_external_holdout_horizon_capacity
                if external_holdout
                else validate_horizon_capacity
            )(
                normalize_horizon_policy(request.get("horizonPolicy")),
                len(panel_dates),
                "request/horizonPolicy",
            )
        except AutoQuantValidationError as error:
            issues.extend(error.issues)
    position_snapshot = request.get("positionSnapshot")
    position_scenarios = request.get("positionScenarios")
    position_sizing = request.get("positionSizing")
    event_policy = request.get("eventPolicy")
    path_stress_policy = request.get("pathStressPolicy")
    allocation_policy = request.get("allocationPolicy")
    if (
        position_snapshot is not None
        and not study_owned
        and template not in {"ohlcv-book-risk-lab", "ohlcv-book-path-stress-lab"}
    ):
        issues.append(
            _issue(
                "request/positionSnapshot",
                "request.position-snapshot-template",
                "positionSnapshot is consumed only by "
                "ohlcv-book-risk-lab or ohlcv-book-path-stress-lab",
            )
        )
    if (
        position_scenarios is not None
        and not study_owned
        and template != "ohlcv-book-risk-lab"
    ):
        issues.append(
            _issue(
                "request/positionScenarios",
                "request.position-scenarios-template",
                "positionScenarios is consumed only by "
                "ohlcv-book-risk-lab",
            )
        )
    if (
        position_sizing is not None
        and not study_owned
        and template != "ohlcv-book-risk-lab"
    ):
        issues.append(
            _issue(
                "request/positionSizing",
                "request.position-sizing-template",
                "positionSizing is consumed only by ohlcv-book-risk-lab",
            )
        )
    if (
        event_policy is not None
        and not study_owned
        and template != "ohlcv-event-study-lab"
    ):
        issues.append(
            _issue(
                "request/eventPolicy",
                "request.event-policy-template",
                "eventPolicy is consumed only by ohlcv-event-study-lab",
            )
        )
    if (
        path_stress_policy is not None
        and not study_owned
        and template != "ohlcv-book-path-stress-lab"
    ):
        issues.append(
            _issue(
                "request/pathStressPolicy",
                "request.path-stress-policy-template",
                "pathStressPolicy is consumed only by "
                "ohlcv-book-path-stress-lab",
            )
        )
    if (
        allocation_policy is not None
        and not study_owned
        and template != "ohlcv-allocation-lab"
    ):
        issues.append(
            _issue(
                "request/allocationPolicy",
                "request.allocation-policy-template",
                "allocationPolicy is consumed only by ohlcv-allocation-lab",
            )
        )
    if template == "ohlcv-allocation-lab":
        if not isinstance(allocation_policy, dict):
            issues.append(
                _issue(
                    "request/allocationPolicy",
                    "request.allocation-policy-required",
                    "ohlcv-allocation-lab requires allocationPolicy",
                )
            )
        if request.get("direction") != "long":
            issues.append(
                _issue(
                    "request/direction",
                    "request.allocation-direction",
                    "ohlcv-allocation-lab requires direction long",
                )
            )
        roles = {
            item["symbol"]: item.get("positionRole")
            for item in request["assets"]
        }
        if any(
            role not in {"long-only", "context-only"}
            for role in roles.values()
        ) or not any(role == "long-only" for role in roles.values()):
            issues.append(
                _issue(
                    "request/assets",
                    "request.allocation-roles",
                    "Allocation assets must explicitly be long-only or "
                    "context-only with at least one long-only asset",
                )
            )
        if not isinstance(request.get("portfolioPolicy"), dict):
            issues.append(
                _issue(
                    "request/portfolioPolicy",
                    "request.allocation-portfolio-policy",
                    "ohlcv-allocation-lab requires portfolioPolicy",
                )
            )
        benchmark = request.get("benchmarkPolicy")
        if (
            not isinstance(benchmark, dict)
            or benchmark.get("kind") != "fixed-weights"
        ):
            issues.append(
                _issue(
                    "request/benchmarkPolicy",
                    "request.allocation-benchmark",
                    "ohlcv-allocation-lab requires a fixed-weights benchmark",
                )
            )
        incompatible = {
            "factorPolicy": request.get("factorPolicy"),
            "eventPolicy": request.get("eventPolicy"),
            "positionSnapshot": request.get("positionSnapshot"),
            "positionScenarios": request.get("positionScenarios"),
            "positionSizing": request.get("positionSizing"),
        }
        for key, item in incompatible.items():
            if item is not None:
                issues.append(
                    _issue(
                        f"request/{key}",
                        "request.allocation-exclusive",
                        f"{key} is not accepted by ohlcv-allocation-lab",
                    )
                )
    if template == "ohlcv-event-study-lab":
        if not isinstance(event_policy, dict):
            issues.append(
                _issue(
                    "request/eventPolicy",
                    "request.event-policy-required",
                    "ohlcv-event-study-lab requires eventPolicy",
                )
            )
        else:
            requested = {item["symbol"] for item in request["assets"]}
            for key in ("asset", "referenceAsset"):
                symbol = event_policy[key]
                if symbol not in package_by_symbol or symbol not in requested:
                    issues.append(
                        _issue(
                            f"request/eventPolicy/{key}",
                            "request.event-policy-dataset",
                            f"{key} must name one requested dataset asset",
                        )
                    )
        if package["priceAdjustment"] == "raw":
            issues.append(
                _issue(
                    "dataset/priceAdjustment",
                    "request.event-policy-adjustment",
                    "ohlcv-event-study-lab requires adjusted OHLCV so splits "
                    "cannot masquerade as price events",
                )
            )
        incompatible_policies = {
            "horizonPolicy": request.get("horizonPolicy"),
            "factorPolicy": request.get("factorPolicy"),
            "portfolioPolicy": request.get("portfolioPolicy"),
            "benchmarkPolicy": request.get("benchmarkPolicy"),
        }
        for key, value in incompatible_policies.items():
            if value is not None:
                issues.append(
                    _issue(
                        f"request/{key}",
                        "request.event-policy-exclusive",
                        "eventPolicy owns the complete event, timing, and "
                        f"reference contract; {key} is not accepted by "
                        "ohlcv-event-study-lab",
                    )
                )
    if template == "ohlcv-book-path-stress-lab":
        if not isinstance(path_stress_policy, dict):
            issues.append(
                _issue(
                    "request/pathStressPolicy",
                    "request.path-stress-policy-required",
                    "ohlcv-book-path-stress-lab requires pathStressPolicy",
                )
            )
        if not isinstance(position_snapshot, dict):
            issues.append(
                _issue(
                    "request/positionSnapshot",
                    "request.position-snapshot-required",
                    "ohlcv-book-path-stress-lab requires positionSnapshot",
                )
            )
        if position_scenarios is not None or position_sizing is not None:
            issues.append(
                _issue(
                    "request",
                    "request.path-stress-exclusive",
                    "Path Stress accepts one reported baseline only; "
                    "positionScenarios and positionSizing are not accepted",
                )
            )
        if package["priceAdjustment"] != "split-adjusted":
            issues.append(
                _issue(
                    "dataset/priceAdjustment",
                    "request.path-stress-adjustment",
                    "ohlcv-book-path-stress-lab requires split-adjusted OHLCV",
                )
            )
        incompatible_policies = {
            "horizonPolicy": request.get("horizonPolicy"),
            "factorPolicy": request.get("factorPolicy"),
            "portfolioPolicy": request.get("portfolioPolicy"),
            "benchmarkPolicy": request.get("benchmarkPolicy"),
            "eventPolicy": request.get("eventPolicy"),
            "allocationPolicy": request.get("allocationPolicy"),
        }
        for key, value in incompatible_policies.items():
            if value is not None:
                issues.append(
                    _issue(
                        f"request/{key}",
                        "request.path-stress-exclusive",
                        f"{key} is not accepted by ohlcv-book-path-stress-lab",
                    )
                )
    if issues:
        raise AutoQuantValidationError(issues)
    assert panel_dates
    start = panel_dates[0]
    end = panel_dates[-1]
    if template in {"ohlcv-book-risk-lab", "ohlcv-book-path-stress-lab"}:
        if not isinstance(position_snapshot, dict):
            raise AutoQuantValidationError(
                [
                    _issue(
                        "request/positionSnapshot",
                        "request.position-snapshot-required",
                        "ohlcv-book-risk-lab requires positionSnapshot",
                    )
                ]
            )
    if isinstance(position_snapshot, dict) and (
        study_owned
        or template in {"ohlcv-book-risk-lab", "ohlcv-book-path-stress-lab"}
    ):
        as_of = pd.Timestamp(position_snapshot["asOf"])
        start_timestamp = pd.Timestamp(start)
        end_timestamp = pd.Timestamp(end)
        if start_timestamp.tzinfo is None and as_of.tzinfo is not None:
            as_of = as_of.tz_localize(None).normalize()
        if not start_timestamp <= as_of <= end_timestamp:
            raise AutoQuantValidationError(
                [
                    _issue(
                        "request/positionSnapshot/asOf",
                        "request.position-snapshot-range",
                        "Position snapshot asOf must lie within the closed "
                        "dataset range",
                    )
                ]
            )
    if isinstance(start, pd.Timestamp):
        start = start.isoformat().replace("+00:00", "Z")
        end = end.isoformat().replace("+00:00", "Z")
    return PreparedIntake(
        template=template,
        request=request,
        request_hash=hash_json(request),
        package=package,
        package_path=manifest_path,
        assets=tuple(prepared),
        start=str(start),
        end=str(end),
    )


def prepare_study_dataset_intake(
    request_path: str | Path,
    package_path: str | Path,
) -> PreparedIntake:
    """Validate an external V1-V3 OHLCV package for one custom fixed Study.

    This profile owns structural data authority only. The Study's fixed Judge
    remains responsible for the scientific meaning of optional request policy
    fields.
    """

    return prepare_project_intake(
        request_path,
        package_path,
        STUDY_OWNED_DATASET_PROFILE,
    )


def materialize_intake_dataset(
    project: ProjectContext,
    intake: PreparedIntake,
    study_id: str,
    *,
    dataset_relative: str = "ohlcv",
    request_relative: str = PROJECT_REQUEST,
) -> tuple[dict[str, Any], str]:
    """Write one canonical Project-local OHLCV closure and its request."""

    data_root = confined_path(
        project.root_dir,
        project.manifest.directories["data"],
        "project/directories/data",
    )
    output = confined_path(
        data_root,
        dataset_relative,
        "intake/dataset-relative",
    )
    request_target = confined_path(
        project.root_dir,
        request_relative,
        "intake/request-relative",
    )
    output.mkdir(parents=True)
    asset_records: list[dict[str, Any]] = []
    observed_intraday_dates: list[list[str]] = []
    for asset in intake.assets:
        asset_start = str(asset.frame["timestamp"].iloc[0])
        asset_end = str(asset.frame["timestamp"].iloc[-1])
        common = {
            "symbol": asset.symbol,
            "venue": asset.venue,
            "currency": asset.currency,
            "sourcePath": asset.source_relative_path,
            "sourceHash": asset.source_hash,
            "start": (
                asset_start
                if intake.ragged_daily or intake.observed_intraday
                else intake.start
            ),
            "end": (
                asset_end
                if intake.ragged_daily or intake.observed_intraday
                else intake.end
            ),
        }
        if intake.per_asset_classes:
            common["assetClass"] = asset.asset_class
        if intake.observed_intraday:
            common["volumeSemantics"] = asset.volume_semantics
        if intake.multi_source:
            common["sourceId"] = asset.source_id
        if intake.multi_interval:
            assert asset.interval_frames is not None
            interval_records = []
            for interval, raw_frame in asset.interval_frames.items():
                target_directory = output / interval
                target_directory.mkdir(exist_ok=True)
                target = target_directory / f"{asset.symbol}.csv"
                frame = raw_frame.copy()
                if intake.observed_intraday:
                    start_at = pd.Timestamp(intake.start)
                    end_at = pd.Timestamp(intake.end)
                    frame = frame[
                        (frame["timestamp"] >= start_at)
                        & (frame["timestamp"] <= end_at)
                    ].reset_index(drop=True)
                    if frame.empty:
                        raise AutoQuantValidationError(
                            [
                                _issue(
                                    asset.source_path,
                                    "dataset.observed-range",
                                    f"{asset.symbol} has no observations in "
                                    "the target time range",
                                )
                            ]
                        )
                    common["start"] = pd.Timestamp(
                        frame["timestamp"].iloc[0]
                    ).isoformat().replace("+00:00", "Z")
                    common["end"] = pd.Timestamp(
                        frame["timestamp"].iloc[-1]
                    ).isoformat().replace("+00:00", "Z")
                    observed_intraday_dates.append(
                        [
                            pd.Timestamp(value)
                            .isoformat()
                            .replace("+00:00", "Z")
                            for value in frame["timestamp"]
                        ]
                    )
                frame["timestamp"] = frame["timestamp"].map(
                    lambda value: pd.Timestamp(value)
                    .isoformat()
                    .replace("+00:00", "Z")
                )
                frame.to_csv(
                    target,
                    index=False,
                    lineterminator="\n",
                    float_format="%.12g",
                )
                interval_records.append(
                    {
                        "interval": interval,
                        "normalizedPath": f"ohlcv/{interval}/{asset.symbol}.csv",
                        "normalizedHash": hash_file(target),
                        "observations": len(frame),
                        "start": (
                            str(frame["timestamp"].iloc[0])
                            if len(frame)
                            else None
                        ),
                        "end": (
                            str(frame["timestamp"].iloc[-1])
                            if len(frame)
                            else None
                        ),
                    }
                )
            asset_records.append({**common, "intervals": interval_records})
        else:
            target = output / f"{asset.symbol}.csv"
            asset.frame.to_csv(
                target,
                index=False,
                lineterminator="\n",
                float_format="%.12g",
            )
            asset_records.append(
                {
                    **common,
                    "normalizedPath": f"ohlcv/{asset.symbol}.csv",
                    "normalizedHash": hash_file(target),
                    "observations": len(asset.frame),
                }
            )
    snapshot = {
        "schemaVersion": SCHEMA_VERSION,
        "kind": DATASET_SNAPSHOT_KIND,
        "id": intake.package["id"],
        "version": intake.package["version"],
        "assetClass": intake.package["assetClass"],
        "market": intake.package["market"],
        "priceAdjustment": intake.package["priceAdjustment"],
        "packageManifestHash": hash_file(intake.package_path),
        "requestHash": intake.request_hash,
        "requestedAssets": [
            item["symbol"] for item in intake.request["assets"]
        ],
        "universe": intake.universe,
        "timeRange": {"start": intake.start, "end": intake.end},
        "template": intake.template,
        "studyId": study_id,
        "assets": asset_records,
    }
    if intake.multi_source:
        snapshot["sources"] = intake.package["sources"]
    else:
        snapshot["provider"] = intake.package["provider"]
    if intake.multi_interval:
        snapshot["schemaVersion"] = intake.package["schemaVersion"]
        snapshot["intervalSurface"] = intake.interval_surface
        if intake.observed_intraday:
            snapshot["panelPolicy"] = dict(OBSERVED_PANEL_POLICY)
            target_symbol = next(
                item["symbol"]
                for item in intake.request["assets"]
                if item.get("positionRole") != "context-only"
            )
            target_dates = observed_intraday_dates[
                intake.universe.index(target_symbol)
            ]
            snapshot["availability"] = _daily_panel_availability_from_dates(
                observed_intraday_dates,
                minimum_assets_per_factor_timestamp=1,
                eligible_dates=target_dates,
            )[1]
    else:
        snapshot["frequency"] = intake.package["frequency"]
        if intake.ragged_daily:
            snapshot["schemaVersion"] = RAGGED_DAILY_SCHEMA_VERSION
            snapshot["panelPolicy"] = dict(RAGGED_PANEL_POLICY)
            snapshot["availability"] = _daily_panel_availability(
                intake.assets
            )[1]
    snapshot_path = output / "snapshot.json"
    _write_json(snapshot_path, snapshot)
    interval_line = (
        "- Interval surface: `"
        + " / ".join(
            [
                intake.package["baseInterval"],
                *intake.interval_surface["featureIntervals"],
            ]
        )
        + "`\n"
        if intake.multi_interval
        else f"- Frequency: `{snapshot['frequency']}`\n"
    )
    provider_summary = (
        ", ".join(
            source["provider"]["name"]
            for source in snapshot["sources"]
        )
        if intake.multi_source
        else snapshot["provider"]["name"]
    )
    readme = (
        "# Content-locked external OHLCV snapshot\n\n"
        f"- Dataset: `{snapshot['id']}@{snapshot['version']}`\n"
        f"- Provider claim(s): `{provider_summary}`\n"
        f"- Price adjustment claim: `{snapshot['priceAdjustment']}`\n"
        f"- Calendar claim: `{snapshot['market']['calendar']}`\n"
        f"{interval_line}"
        f"- Coverage: `{intake.start}` through `{intake.end}`\n"
        f"- Universe: {', '.join(intake.universe)}\n\n"
        + (
            "- Panel: observed-only ragged daily rows; missing observations "
            "remain absent and are never filled.\n\n"
            if intake.ragged_daily
            else (
                "- Panel: provider-observed base bars; closures and missing "
                "observations remain absent, and horizons advance on the "
                "prediction asset's own observed bars.\n\n"
                if intake.observed_intraday
                else ""
            )
        )
        + "The fixed Study hashes every file in this directory. Provider, "
        "calendar, adjustment, venue, and terms values are caller-supplied "
        "claims, not authenticated by AutoQuant.\n"
    )
    (output / "README.md").write_text(readme, encoding="utf-8")
    request_target.parent.mkdir(parents=True, exist_ok=True)
    _write_json(request_target, intake.request)
    return snapshot, hash_file(snapshot_path)


def finalize_project_intake(
    project: ProjectContext,
    intake: PreparedIntake,
    study: StudyContext,
    snapshot_hash: str,
) -> dict[str, Any]:
    manifest = {
        "schemaVersion": SCHEMA_VERSION,
        "kind": PROJECT_INTAKE_KIND,
        "template": intake.template,
        "requestPath": PROJECT_REQUEST,
        "requestHash": intake.request_hash,
        "datasetSnapshotPath": DATASET_SNAPSHOT,
        "datasetSnapshotHash": snapshot_hash,
        "studyId": study.definition.id,
        "studyHash": study.study_hash,
        "studyInputHash": study.input_hash,
        "datasetHash": study.dataset_hash,
        "status": (
            "ready-for-run"
            if intake.template
            in {
                "ohlcv-book-risk-lab",
                "ohlcv-event-study-lab",
                "ohlcv-book-path-stress-lab",
                "ohlcv-allocation-lab",
            }
            else "ready-for-session"
        ),
    }
    _write_json(project.root_dir / PROJECT_INTAKE, manifest)
    return manifest


def _validate_v1_snapshot(
    snapshot: dict[str, Any],
    path: Path,
    *,
    ragged: bool = False,
) -> list[ValidationIssue]:
    required = {
        "schemaVersion",
        "kind",
        "id",
        "version",
        "assetClass",
        "frequency",
        "market",
        "priceAdjustment",
        "provider",
        "packageManifestHash",
        "requestHash",
        "requestedAssets",
        "universe",
        "timeRange",
        "template",
        "studyId",
        "assets",
    }
    if ragged:
        required.update({"panelPolicy", "availability"})
    issues = _strict_keys(snapshot, required, path)
    if (
        snapshot.get("schemaVersion")
        != (
            RAGGED_DAILY_SCHEMA_VERSION
            if ragged
            else SCHEMA_VERSION
        )
        or snapshot.get("kind") != DATASET_SNAPSHOT_KIND
    ):
        issues.append(_issue(path, "intake.snapshot-schema", "Invalid dataset snapshot"))
    if ragged and snapshot.get("panelPolicy") != RAGGED_PANEL_POLICY:
        issues.append(
            _issue(
                f"{path}/panelPolicy",
                "intake.snapshot-panel-policy",
                "Ragged daily snapshot must preserve the fixed "
                "observed-only policy",
            )
        )
    availability = snapshot.get("availability")
    if ragged:
        availability_required = {
            "alignment",
            "missingObservation",
            "unionObservations",
            "intersectionObservations",
            "eligibleFactorObservations",
            "minimumAssetsPerFactorTimestamp",
            "observedRows",
            "possibleRows",
            "observationCoverage",
            "assetsPerTimestamp",
        }
        if not isinstance(availability, dict):
            issues.append(
                _issue(
                    f"{path}/availability",
                    "schema.type",
                    "Ragged daily availability must be an object",
                )
            )
            availability = {}
        else:
            issues.extend(
                _strict_keys(
                    availability,
                    availability_required,
                    f"{path}/availability",
                )
            )
        if (
            availability.get("alignment")
            != RAGGED_PANEL_POLICY["alignment"]
            or availability.get("missingObservation")
            != RAGGED_PANEL_POLICY["missingObservation"]
            or availability.get("minimumAssetsPerFactorTimestamp")
            != FACTOR_MIN_ASSETS_PER_TIMESTAMP
        ):
            issues.append(
                _issue(
                    f"{path}/availability",
                    "intake.snapshot-availability-policy",
                    "Snapshot availability policy differs from the fixed "
                    "Factor contract",
                )
            )
        for key in (
            "unionObservations",
            "intersectionObservations",
            "eligibleFactorObservations",
            "observedRows",
            "possibleRows",
        ):
            value = availability.get(key)
            if (
                not isinstance(value, int)
                or isinstance(value, bool)
                or value < 0
            ):
                issues.append(
                    _issue(
                        f"{path}/availability/{key}",
                        "schema.integer",
                        f"{key} must be a non-negative integer",
                    )
                )
        coverage = availability.get("observationCoverage")
        if (
            not isinstance(coverage, (int, float))
            or isinstance(coverage, bool)
            or not math.isfinite(float(coverage))
            or not 0.0 <= float(coverage) <= 1.0
        ):
            issues.append(
                _issue(
                    f"{path}/availability/observationCoverage",
                    "schema.number",
                    "observationCoverage must be a finite ratio",
                )
            )
        breadth = availability.get("assetsPerTimestamp")
        if not isinstance(breadth, dict):
            issues.append(
                _issue(
                    f"{path}/availability/assetsPerTimestamp",
                    "schema.type",
                    "assetsPerTimestamp must be an object",
                )
            )
        else:
            issues.extend(
                _strict_keys(
                    breadth,
                    {"minimum", "median", "maximum"},
                    f"{path}/availability/assetsPerTimestamp",
                )
            )
    for key in ("id", "version", "assetClass", "template", "studyId"):
        issues.extend(_non_empty(snapshot.get(key), f"{path}/{key}"))
    if snapshot.get("frequency") != "1d":
        issues.append(
            _issue(
                f"{path}/frequency",
                "intake.snapshot-frequency",
                "Snapshot frequency must be '1d'",
            )
        )
    if snapshot.get("priceAdjustment") not in PRICE_ADJUSTMENTS:
        issues.append(
            _issue(
                f"{path}/priceAdjustment",
                "intake.snapshot-adjustment",
                "Snapshot priceAdjustment is unsupported",
            )
        )
    for key in ("packageManifestHash", "requestHash"):
        if not _valid_hash(snapshot.get(key)):
            issues.append(
                _issue(f"{path}/{key}", "schema.hash", f"Invalid {key}")
            )

    market = snapshot.get("market")
    if not isinstance(market, dict):
        issues.append(
            _issue(f"{path}/market", "schema.type", "Market must be an object")
        )
    else:
        issues.extend(
            _strict_keys(
                market,
                {"clock", "calendar", "timezone"},
                f"{path}/market",
            )
        )
        if market.get("clock") != "session":
            issues.append(
                _issue(
                    f"{path}/market/clock",
                    "intake.snapshot-market",
                    "Snapshot market clock must be 'session'",
                )
            )
        for key in ("calendar", "timezone"):
            issues.extend(_non_empty(market.get(key), f"{path}/market/{key}"))

    _, provider_issues = _validate_provider_claim(
        snapshot.get("provider"),
        f"{path}/provider",
    )
    issues.extend(provider_issues)

    requested_assets = snapshot.get("requestedAssets")
    if (
        not isinstance(requested_assets, list)
        or not requested_assets
        or not all(isinstance(item, str) and item for item in requested_assets)
        or len(requested_assets) != len(set(requested_assets))
    ):
        issues.append(
            _issue(
                f"{path}/requestedAssets",
                "schema.array",
                "requestedAssets must be unique non-empty strings",
            )
        )
        requested_assets = []
    universe = snapshot.get("universe")
    if (
        not isinstance(universe, list)
        or not universe
        or not all(isinstance(item, str) and item for item in universe)
        or len(universe) != len(set(universe))
    ):
        issues.append(
            _issue(
                f"{path}/universe",
                "schema.array",
                "Universe must be unique non-empty strings",
            )
        )
        universe = []
    if not set(requested_assets).issubset(universe):
        issues.append(
            _issue(
                f"{path}/requestedAssets",
                "intake.snapshot-requested-assets",
                "Requested assets must be a subset of the research universe",
            )
        )

    time_range = snapshot.get("timeRange")
    if not isinstance(time_range, dict):
        issues.append(
            _issue(
                f"{path}/timeRange",
                "schema.type",
                "timeRange must be an object",
            )
        )
        time_range = {}
    else:
        issues.extend(
            _strict_keys(time_range, {"start", "end"}, f"{path}/timeRange")
        )
    for key in ("start", "end"):
        issues.extend(_non_empty(time_range.get(key), f"{path}/timeRange/{key}"))

    assets = snapshot.get("assets")
    if not isinstance(assets, list) or not assets:
        issues.append(
            _issue(f"{path}/assets", "schema.array", "Snapshot assets must be non-empty")
        )
        assets = []
    asset_symbols: list[str] = []
    snapshot_asset_classes: list[str] = []
    for index, asset in enumerate(assets):
        asset_path = f"{path}/assets/{index}"
        if not isinstance(asset, dict):
            issues.append(_issue(asset_path, "schema.type", "Asset must be an object"))
            continue
        asset_fields = {
            "symbol",
            "venue",
            "currency",
            "sourcePath",
            "sourceHash",
            "normalizedPath",
            "normalizedHash",
            "observations",
            "start",
            "end",
        }
        if "assetClass" in asset:
            asset_fields.add("assetClass")
        issues.extend(
            _strict_keys(
                asset,
                asset_fields,
                asset_path,
            )
        )
        for key in (
            "symbol",
            "venue",
            "currency",
            "sourcePath",
            "normalizedPath",
            "start",
            "end",
        ):
            issues.extend(_non_empty(asset.get(key), f"{asset_path}/{key}"))
        for key in ("sourceHash", "normalizedHash"):
            if not _valid_hash(asset.get(key)):
                issues.append(
                    _issue(
                        f"{asset_path}/{key}",
                        "schema.hash",
                        f"Invalid {key}",
                    )
                )
        observations = asset.get("observations")
        if (
            not isinstance(observations, int)
            or isinstance(observations, bool)
            or observations < 1
        ):
            issues.append(
                _issue(
                    f"{asset_path}/observations",
                    "schema.integer",
                    "observations must be a positive integer",
                )
            )
        symbol = asset.get("symbol")
        if isinstance(symbol, str):
            asset_symbols.append(symbol)
        if "assetClass" in asset:
            if asset.get("assetClass") not in ASSET_CLASSES:
                issues.append(
                    _issue(
                        f"{asset_path}/assetClass",
                        "dataset.asset-class",
                        "Unsupported asset class",
                    )
                )
            else:
                snapshot_asset_classes.append(asset["assetClass"])
        if not ragged and (
            asset.get("start") != time_range.get("start")
            or asset.get("end") != time_range.get("end")
        ):
            issues.append(
                _issue(
                    asset_path,
                    "intake.snapshot-coverage",
                    "Every asset must match snapshot timeRange",
                )
            )
        if ragged:
            try:
                asset_start = pd.Timestamp(asset.get("start"))
                asset_end = pd.Timestamp(asset.get("end"))
                range_start = pd.Timestamp(time_range.get("start"))
                range_end = pd.Timestamp(time_range.get("end"))
                if not (
                    range_start
                    <= asset_start
                    <= asset_end
                    <= range_end
                ):
                    raise ValueError
            except (TypeError, ValueError):
                issues.append(
                    _issue(
                        asset_path,
                        "intake.snapshot-coverage",
                        "Ragged asset coverage must be contained within "
                        "the snapshot union timeRange",
                    )
                )
    if asset_symbols != universe:
        issues.append(
            _issue(
                f"{path}/assets",
                "intake.snapshot-universe",
                "Snapshot asset order must exactly match the research universe",
            )
        )
    if snapshot_asset_classes:
        if len(snapshot_asset_classes) != len(assets):
            issues.append(
                _issue(
                    f"{path}/assets",
                    "intake.snapshot-partial-asset-classes",
                    "Snapshot per-asset assetClass must be a complete vector",
                )
            )
        else:
            expected_class = _asset_class_summary(snapshot_asset_classes)
            if snapshot.get("assetClass") != expected_class:
                issues.append(
                    _issue(
                        f"{path}/assetClass",
                        "intake.snapshot-asset-class-summary",
                        f"Snapshot assetClass must be '{expected_class}'",
                    )
                )
    return issues


def _validate_multi_interval_snapshot(
    snapshot: dict[str, Any],
    path: Path,
    *,
    schema_version: int,
) -> list[ValidationIssue]:
    observed = schema_version in OBSERVED_SCHEMA_VERSIONS
    required = {
        "schemaVersion",
        "kind",
        "id",
        "version",
        "assetClass",
        "intervalSurface",
        "market",
        "priceAdjustment",
        "packageManifestHash",
        "requestHash",
        "requestedAssets",
        "universe",
        "timeRange",
        "template",
        "studyId",
        "assets",
    }
    required.add(
        "sources"
        if schema_version == MULTI_SOURCE_OBSERVED_SCHEMA_VERSION
        else "provider"
    )
    if observed:
        required.update({"panelPolicy", "availability"})
    issues = _strict_keys(snapshot, required, path)
    if (
        snapshot.get("schemaVersion") != schema_version
        or snapshot.get("kind") != DATASET_SNAPSHOT_KIND
    ):
        issues.append(
            _issue(
                path,
                "intake.snapshot-schema",
                f"Invalid V{schema_version} dataset snapshot",
            )
        )
    for key in ("id", "version", "assetClass", "template", "studyId"):
        issues.extend(_non_empty(snapshot.get(key), f"{path}/{key}"))
    for key in ("packageManifestHash", "requestHash"):
        if not _valid_hash(snapshot.get(key)):
            issues.append(_issue(f"{path}/{key}", "schema.hash", f"Invalid {key}"))
    if snapshot.get("priceAdjustment") not in PRICE_ADJUSTMENTS:
        issues.append(
            _issue(
                f"{path}/priceAdjustment",
                "intake.snapshot-adjustment",
                "Snapshot priceAdjustment is unsupported",
            )
        )
    surface = snapshot.get("intervalSurface")
    if not isinstance(surface, dict):
        issues.append(
            _issue(
                f"{path}/intervalSurface",
                "schema.type",
                "intervalSurface must be an object",
            )
        )
        surface = {}
    else:
        surface_keys = {
            "baseInterval",
            "featureIntervals",
            "timestampSemantics",
            "marketClock",
            "timezone",
            "anchor",
            "aggregationMethod",
        }
        if schema_version == 3:
            surface_keys |= {"calendar", "terminalBucketPolicy"}
        elif observed:
            surface_keys = {
                "baseInterval",
                "featureIntervals",
                "timestampSemantics",
                "marketClock",
                "calendar",
                "timezone",
                "aggregationMethod",
                "alignment",
                "missingObservation",
                "horizonClock",
            }
        issues.extend(
            _strict_keys(
                surface,
                surface_keys,
                f"{path}/intervalSurface",
            )
        )
    try:
        expected_surface = canonical_interval_surface(
            surface,
            schema_version=(
                OBSERVED_INTRADAY_SCHEMA_VERSION
                if observed
                else schema_version
            ),
        )
        if surface != expected_surface:
            issues.append(
                _issue(
                    f"{path}/intervalSurface",
                    "intake.snapshot-interval-surface",
                    "Snapshot interval surface differs from fixed authority",
                )
            )
    except IntervalContractError as error:
        issues.append(
            _issue(f"{path}/intervalSurface", error.code, str(error))
        )
        expected_surface = (
            interval_surface([]).to_dict()
            if schema_version == 2
            else {
                "baseInterval": snapshot.get("baseInterval", BASE_INTERVAL),
                "featureIntervals": [],
            }
        )
    expected_intervals = [
        expected_surface["baseInterval"],
        *expected_surface["featureIntervals"],
    ]
    expected_market = (
        {
            "clock": "continuous",
            "calendar": "24/7",
            "timezone": "UTC",
        }
        if schema_version == 2
        else {
            "clock": expected_surface.get("marketClock"),
            "calendar": expected_surface.get("calendar"),
            "timezone": expected_surface.get("timezone"),
        }
    )
    if snapshot.get("market") != expected_market:
        issues.append(
            _issue(
                f"{path}/market",
                "intake.snapshot-market",
                f"V{schema_version} snapshot market differs from interval authority",
            )
        )
    if observed:
        if snapshot.get("panelPolicy") != OBSERVED_PANEL_POLICY:
            issues.append(
                _issue(
                    f"{path}/panelPolicy",
                    "intake.snapshot-panel-policy",
                    "Observed snapshot must preserve target-bar authority",
                )
            )
        availability = snapshot.get("availability")
        if not isinstance(availability, dict):
            issues.append(
                _issue(
                    f"{path}/availability",
                    "schema.type",
                    "Observed snapshot availability must be an object",
                )
            )
    source_claims: list[dict[str, Any]] = []
    if schema_version == MULTI_SOURCE_OBSERVED_SCHEMA_VERSION:
        source_claims, source_issues = _validate_source_claims(
            snapshot.get("sources"),
            f"{path}/sources",
        )
        issues.extend(source_issues)
    else:
        _, provider_issues = _validate_provider_claim(
            snapshot.get("provider"),
            f"{path}/provider",
        )
        issues.extend(provider_issues)

    requested_assets = snapshot.get("requestedAssets")
    universe = snapshot.get("universe")
    for key, value in (
        ("requestedAssets", requested_assets),
        ("universe", universe),
    ):
        if (
            not isinstance(value, list)
            or not value
            or not all(isinstance(item, str) and item for item in value)
            or len(value) != len(set(value))
        ):
            issues.append(
                _issue(
                    f"{path}/{key}",
                    "schema.array",
                    f"{key} must contain unique non-empty strings",
                )
            )
    requested_assets = requested_assets if isinstance(requested_assets, list) else []
    universe = universe if isinstance(universe, list) else []
    if not set(requested_assets).issubset(universe):
        issues.append(
            _issue(
                f"{path}/requestedAssets",
                "intake.snapshot-requested-assets",
                "Requested assets must be a subset of the research universe",
            )
        )
    time_range = snapshot.get("timeRange")
    if not isinstance(time_range, dict):
        issues.append(_issue(f"{path}/timeRange", "schema.type", "timeRange must be an object"))
        time_range = {}
    else:
        issues.extend(_strict_keys(time_range, {"start", "end"}, f"{path}/timeRange"))
    for key in ("start", "end"):
        issues.extend(_non_empty(time_range.get(key), f"{path}/timeRange/{key}"))

    assets = snapshot.get("assets")
    if not isinstance(assets, list) or not assets:
        issues.append(_issue(f"{path}/assets", "schema.array", "Snapshot assets must be non-empty"))
        assets = []
    symbols: list[str] = []
    snapshot_asset_classes: list[str] = []
    snapshot_source_ids: list[str] = []
    for asset_index, asset in enumerate(assets):
        asset_path = f"{path}/assets/{asset_index}"
        if not isinstance(asset, dict):
            issues.append(_issue(asset_path, "schema.type", "Asset must be an object"))
            continue
        asset_keys = {
            "symbol",
            "venue",
            "currency",
            "sourcePath",
            "sourceHash",
            "start",
            "end",
            "intervals",
        }
        if observed or "assetClass" in asset:
            asset_keys.add("assetClass")
        if observed:
            asset_keys.add("volumeSemantics")
        if schema_version == MULTI_SOURCE_OBSERVED_SCHEMA_VERSION:
            asset_keys.add("sourceId")
        issues.extend(_strict_keys(asset, asset_keys, asset_path))
        for key in ("symbol", "venue", "currency", "sourcePath", "start", "end"):
            issues.extend(_non_empty(asset.get(key), f"{asset_path}/{key}"))
        if not _valid_hash(asset.get("sourceHash")):
            issues.append(_issue(f"{asset_path}/sourceHash", "schema.hash", "Invalid sourceHash"))
        symbol = asset.get("symbol")
        if isinstance(symbol, str):
            symbols.append(symbol)
        if (
            not observed
            and (
                asset.get("start") != time_range.get("start")
                or asset.get("end") != time_range.get("end")
            )
        ):
            issues.append(
                _issue(
                    asset_path,
                    "intake.snapshot-coverage",
                    "Base asset coverage must match snapshot timeRange",
                )
            )
        if "assetClass" in asset:
            if asset.get("assetClass") not in ASSET_CLASSES:
                issues.append(
                    _issue(
                        f"{asset_path}/assetClass",
                        "dataset.asset-class",
                        "Unsupported asset class",
                    )
                )
            else:
                snapshot_asset_classes.append(asset["assetClass"])
        if observed:
            if asset.get("volumeSemantics") not in OBSERVED_VOLUME_SEMANTICS:
                issues.append(
                    _issue(
                        f"{asset_path}/volumeSemantics",
                        "dataset.volume-semantics",
                        "Unsupported observed volume semantics",
                    )
                )
            try:
                asset_start = pd.Timestamp(asset.get("start"))
                asset_end = pd.Timestamp(asset.get("end"))
                range_start = pd.Timestamp(time_range.get("start"))
                range_end = pd.Timestamp(time_range.get("end"))
                if not (
                    range_start
                    <= asset_start
                    <= asset_end
                    <= range_end
                ):
                    raise ValueError
            except (TypeError, ValueError):
                issues.append(
                    _issue(
                        asset_path,
                        "intake.snapshot-coverage",
                        "Observed asset coverage must be contained within "
                        "the target timeRange",
                    )
                )
        if schema_version == MULTI_SOURCE_OBSERVED_SCHEMA_VERSION:
            source_id = asset.get("sourceId")
            if not isinstance(source_id, str) or source_id not in {
                source["id"] for source in source_claims
            }:
                issues.append(
                    _issue(
                        f"{asset_path}/sourceId",
                        "intake.snapshot-source",
                        "V6 asset sourceId must name one declared source",
                    )
                )
            else:
                snapshot_source_ids.append(source_id)
        rows = asset.get("intervals")
        if not isinstance(rows, list) or not rows:
            issues.append(
                _issue(f"{asset_path}/intervals", "schema.array", "Missing interval inventory")
            )
            rows = []
        observed_intervals: list[str] = []
        for row_index, row in enumerate(rows):
            row_path = f"{asset_path}/intervals/{row_index}"
            if not isinstance(row, dict):
                issues.append(_issue(row_path, "schema.type", "Interval row must be an object"))
                continue
            issues.extend(
                _strict_keys(
                    row,
                    {
                        "interval",
                        "normalizedPath",
                        "normalizedHash",
                        "observations",
                        "start",
                        "end",
                    },
                    row_path,
                )
            )
            for key in ("interval", "normalizedPath", "start", "end"):
                issues.extend(_non_empty(row.get(key), f"{row_path}/{key}"))
            if not _valid_hash(row.get("normalizedHash")):
                issues.append(
                    _issue(f"{row_path}/normalizedHash", "schema.hash", "Invalid normalizedHash")
                )
            observations = row.get("observations")
            if (
                not isinstance(observations, int)
                or isinstance(observations, bool)
                or observations < 1
            ):
                issues.append(
                    _issue(
                        f"{row_path}/observations",
                        "schema.integer",
                        "observations must be a positive integer",
                    )
                )
            observed_intervals.append(row.get("interval"))
            if (
                isinstance(symbol, str)
                and isinstance(row.get("interval"), str)
                and row.get("normalizedPath")
                != f"ohlcv/{row['interval']}/{symbol}.csv"
            ):
                issues.append(
                    _issue(
                        f"{row_path}/normalizedPath",
                        "intake.snapshot-interval-path",
                        "Interval path must match its canonical asset inventory",
                    )
                )
        if observed_intervals != expected_intervals:
            issues.append(
                _issue(
                    f"{asset_path}/intervals",
                    "intake.snapshot-interval-inventory",
                    "Asset interval inventory must match intervalSurface order",
                )
            )
    if symbols != universe:
        issues.append(
            _issue(
                f"{path}/assets",
                "intake.snapshot-universe",
                "Snapshot asset order must exactly match the research universe",
            )
        )
    if schema_version == MULTI_SOURCE_OBSERVED_SCHEMA_VERSION:
        unused_sources = sorted(
            {source["id"] for source in source_claims}
            - set(snapshot_source_ids)
        )
        if unused_sources:
            issues.append(
                _issue(
                    f"{path}/sources",
                    "intake.snapshot-unused-source",
                    "Every V6 source must own at least one asset: "
                    + ", ".join(unused_sources),
                )
            )
    if snapshot_asset_classes:
        if len(snapshot_asset_classes) != len(assets):
            issues.append(
                _issue(
                    f"{path}/assets",
                    "intake.snapshot-partial-asset-classes",
                    "Snapshot per-asset assetClass must be a complete vector",
                )
            )
        else:
            expected_class = _asset_class_summary(snapshot_asset_classes)
            if snapshot.get("assetClass") != expected_class:
                issues.append(
                    _issue(
                        f"{path}/assetClass",
                        "intake.snapshot-asset-class-summary",
                        f"Snapshot assetClass must be '{expected_class}'",
                    )
                )
    return issues


def _validate_v2_snapshot(
    snapshot: dict[str, Any],
    path: Path,
) -> list[ValidationIssue]:
    return _validate_multi_interval_snapshot(
        snapshot,
        path,
        schema_version=2,
    )


def _validate_v3_snapshot(
    snapshot: dict[str, Any],
    path: Path,
) -> list[ValidationIssue]:
    return _validate_multi_interval_snapshot(
        snapshot,
        path,
        schema_version=3,
    )


def _validate_v4_snapshot(
    snapshot: dict[str, Any],
    path: Path,
) -> list[ValidationIssue]:
    return _validate_v1_snapshot(snapshot, path, ragged=True)


def _validate_v5_snapshot(
    snapshot: dict[str, Any],
    path: Path,
) -> list[ValidationIssue]:
    return _validate_multi_interval_snapshot(
        snapshot,
        path,
        schema_version=OBSERVED_INTRADAY_SCHEMA_VERSION,
    )


def _validate_v6_snapshot(
    snapshot: dict[str, Any],
    path: Path,
) -> list[ValidationIssue]:
    return _validate_multi_interval_snapshot(
        snapshot,
        path,
        schema_version=MULTI_SOURCE_OBSERVED_SCHEMA_VERSION,
    )


def _validate_snapshot(
    snapshot: dict[str, Any],
    path: Path,
) -> list[ValidationIssue]:
    if snapshot.get("schemaVersion") == MULTI_SOURCE_OBSERVED_SCHEMA_VERSION:
        return _validate_v6_snapshot(snapshot, path)
    if snapshot.get("schemaVersion") == OBSERVED_INTRADAY_SCHEMA_VERSION:
        return _validate_v5_snapshot(snapshot, path)
    if snapshot.get("schemaVersion") == RAGGED_DAILY_SCHEMA_VERSION:
        return _validate_v4_snapshot(snapshot, path)
    if snapshot.get("schemaVersion") == 3:
        return _validate_v3_snapshot(snapshot, path)
    if snapshot.get("schemaVersion") == 2:
        return _validate_v2_snapshot(snapshot, path)
    return _validate_v1_snapshot(snapshot, path)


def load_project_intake(project: ProjectContext) -> dict[str, Any] | None:
    """Verify and project optional request-driven Project intake state."""

    manifest_path = project.root_dir / PROJECT_INTAKE
    if not manifest_path.exists():
        return None
    manifest = _read_json(manifest_path, "project intake")
    required = {
        "schemaVersion",
        "kind",
        "template",
        "requestPath",
        "requestHash",
        "datasetSnapshotPath",
        "datasetSnapshotHash",
        "studyId",
        "studyHash",
        "studyInputHash",
        "datasetHash",
        "status",
    }
    issues = _strict_keys(manifest, required, manifest_path)
    expected_status = (
        "ready-for-run"
        if manifest.get("template")
        in {
            "ohlcv-book-risk-lab",
            "ohlcv-event-study-lab",
            "ohlcv-book-path-stress-lab",
            "ohlcv-allocation-lab",
        }
        else "ready-for-session"
    )
    if (
        manifest.get("schemaVersion") != SCHEMA_VERSION
        or manifest.get("kind") != PROJECT_INTAKE_KIND
        or manifest.get("status") != expected_status
    ):
        issues.append(_issue(manifest_path, "intake.schema", "Invalid Project intake"))
    for key in (
        "requestHash",
        "datasetSnapshotHash",
        "studyHash",
        "studyInputHash",
        "datasetHash",
    ):
        if not _valid_hash(manifest.get(key)):
            issues.append(
                _issue(f"{manifest_path}/{key}", "schema.hash", f"Invalid {key}")
            )
    request_path = confined_path(
        project.root_dir,
        manifest.get("requestPath", ""),
        f"{manifest_path}/requestPath",
    )
    snapshot_path = confined_path(
        project.root_dir,
        manifest.get("datasetSnapshotPath", ""),
        f"{manifest_path}/datasetSnapshotPath",
    )
    request = validate_research_request(
        _read_json(request_path, "research request"),
        request_path,
    )
    snapshot = _read_json(snapshot_path, "dataset snapshot")
    issues.extend(_validate_snapshot(snapshot, snapshot_path))
    surface = snapshot.get("intervalSurface")
    portfolio_policy = request.get("portfolioPolicy")
    decision_schedule = (
        portfolio_policy.get("decisionSchedule")
        if isinstance(portfolio_policy, dict)
        else None
    )
    if (
        isinstance(decision_schedule, dict)
        and decision_schedule.get("kind") == "every-bars"
        and decision_schedule.get("anchor") == "session-start"
        and (
            snapshot.get("schemaVersion") != 3
            or not isinstance(surface, dict)
            or surface.get("marketClock") != "session"
            or surface.get("calendar") != "XNYS"
            or surface.get("baseInterval") == "1d"
        )
    ):
        issues.append(
            _issue(
                f"{request_path}/portfolioPolicy/"
                "decisionSchedule/anchor",
                "request.dataset-decision-anchor",
                "session-start requires a V3 intraday XNYS "
                "regular-session package",
            )
        )
    if (
        isinstance(decision_schedule, dict)
        and decision_schedule.get("kind") == "calendar-month-end"
        and (
            snapshot.get("schemaVersion") != 1
            or snapshot.get("frequency") != "1d"
            or snapshot.get("market", {}).get("clock") != "session"
            or snapshot.get("market", {}).get("calendar") != "XNYS"
        )
    ):
        issues.append(
            _issue(
                f"{request_path}/portfolioPolicy/decisionSchedule",
                "request.dataset-decision-schedule",
                "calendar-month-end requires a V1 daily XNYS "
                "regular-session package",
            )
        )
    if hash_json(request) != manifest.get("requestHash"):
        issues.append(_issue(request_path, "intake.request-hash", "Request hash mismatch"))
    position_path = project.root_dir / POSITION_SNAPSHOT
    if manifest.get("template") in {
        "ohlcv-book-risk-lab",
        "ohlcv-book-path-stress-lab",
    }:
        try:
            position_snapshot = load_position_snapshot(position_path)
            if position_snapshot != build_position_snapshot(request):
                issues.append(
                    _issue(
                        position_path,
                        "intake.position-snapshot",
                        "Position snapshot differs from the normalized request",
                    )
                )
        except AutoQuantValidationError as error:
            issues.extend(error.issues)
    if hash_file(snapshot_path) != manifest.get("datasetSnapshotHash"):
        issues.append(
            _issue(snapshot_path, "intake.snapshot-hash", "Dataset snapshot hash mismatch")
        )
    if snapshot.get("requestHash") != manifest.get("requestHash"):
        issues.append(
            _issue(snapshot_path, "intake.snapshot-request", "Snapshot request mismatch")
        )
    if snapshot.get("template") != manifest.get("template"):
        issues.append(
            _issue(
                snapshot_path,
                "intake.snapshot-template",
                "Snapshot template differs from Project intake",
            )
        )
    if snapshot.get("studyId") != manifest.get("studyId"):
        issues.append(
            _issue(
                snapshot_path,
                "intake.snapshot-study",
                "Snapshot Study differs from Project intake",
            )
        )
    requested_symbols = [item["symbol"] for item in request["assets"]]
    if snapshot.get("requestedAssets") != requested_symbols:
        issues.append(
            _issue(
                snapshot_path,
                "intake.snapshot-request-assets",
                "Snapshot requested assets differ from the Research Request",
            )
        )
    if any(
        isinstance(item, dict) and "assetClass" in item
        for item in snapshot.get("assets", [])
    ):
        snapshot_classes = {
            item.get("symbol"): item.get("assetClass")
            for item in snapshot.get("assets", [])
            if isinstance(item, dict)
        }
        mismatched_classes = [
            item["symbol"]
            for item in request["assets"]
            if snapshot_classes.get(item["symbol"]) != item["assetClass"]
        ]
        if mismatched_classes:
            issues.append(
                _issue(
                    snapshot_path,
                    "intake.snapshot-request-asset-classes",
                    "Snapshot asset classes differ from the Research Request: "
                    + ", ".join(mismatched_classes),
                )
            )
    ragged_dates_by_symbol: dict[str, list[str]] = {}
    observed_dates_by_symbol: dict[str, list[str]] = {}
    for asset in snapshot.get("assets", []):
        if not isinstance(asset, dict):
            continue
        normalized_rows = (
            asset.get("intervals", [])
            if snapshot.get("schemaVersion")
            in {2, 3, *OBSERVED_SCHEMA_VERSIONS}
            else [asset]
        )
        for row in normalized_rows:
            if not isinstance(row, dict):
                continue
            normalized_path = confined_path(
                project.root_dir / project.manifest.directories["data"],
                row.get("normalizedPath", ""),
                f"{snapshot_path}/assets/normalizedPath",
            )
            if not normalized_path.is_file():
                issues.append(
                    _issue(
                        normalized_path,
                        "intake.data-missing",
                        "Normalized asset is missing",
                    )
                )
            elif hash_file(normalized_path) != row.get("normalizedHash"):
                issues.append(
                    _issue(
                        normalized_path,
                        "intake.data-hash",
                        "Normalized asset hash mismatch",
                    )
                )
            elif (
                snapshot.get("schemaVersion")
                == RAGGED_DAILY_SCHEMA_VERSION
                and isinstance(asset.get("symbol"), str)
            ):
                try:
                    normalized = _canonical_frame(
                        normalized_path,
                        market_clock="session",
                    )
                except AutoQuantValidationError as error:
                    issues.extend(error.issues)
                else:
                    dates = [
                        str(value)
                        for value in normalized["timestamp"].tolist()
                    ]
                    ragged_dates_by_symbol[asset["symbol"]] = dates
                    if (
                        row.get("observations") != len(dates)
                        or row.get("start")
                        != (dates[0] if dates else None)
                        or row.get("end")
                        != (dates[-1] if dates else None)
                    ):
                        issues.append(
                            _issue(
                                normalized_path,
                                "intake.snapshot-asset-availability",
                                "Ragged asset availability differs from "
                                "canonical normalized rows",
                            )
                        )
        if (
            snapshot.get("schemaVersion")
            in {2, 3, *OBSERVED_SCHEMA_VERSIONS}
            and isinstance(asset.get("symbol"), str)
            and isinstance(snapshot.get("timeRange"), dict)
        ):
            try:
                loaded_interval_asset = load_multi_interval_asset(
                    project.root_dir / project.manifest.directories["data"],
                    asset["symbol"],
                    start=snapshot["timeRange"].get("start", ""),
                    end=snapshot["timeRange"].get("end", ""),
                )
            except (IntervalContractError, TypeError, ValueError) as error:
                issues.append(
                    _issue(
                        snapshot_path,
                        getattr(error, "code", "interval.reconciliation"),
                        str(error),
                    )
                )
            else:
                if (
                    snapshot.get("schemaVersion") in OBSERVED_SCHEMA_VERSIONS
                    and loaded_interval_asset is not None
                ):
                    dates = [
                        pd.Timestamp(value)
                        .isoformat()
                        .replace("+00:00", "Z")
                        for value in loaded_interval_asset["timestamp"]
                    ]
                    observed_dates_by_symbol[asset["symbol"]] = dates
                    base_interval = snapshot["intervalSurface"]["baseInterval"]
                    base_record = next(
                        (
                            row
                            for row in asset.get("intervals", [])
                            if row.get("interval") == base_interval
                        ),
                        None,
                    )
                    if (
                        not isinstance(base_record, dict)
                        or base_record.get("observations") != len(dates)
                        or base_record.get("start")
                        != (dates[0] if dates else None)
                        or base_record.get("end")
                        != (dates[-1] if dates else None)
                        or asset.get("start")
                        != (dates[0] if dates else None)
                        or asset.get("end")
                        != (dates[-1] if dates else None)
                    ):
                        issues.append(
                            _issue(
                                snapshot_path,
                                "intake.snapshot-asset-availability",
                                "Observed asset availability differs from "
                                "canonical normalized rows",
                            )
                        )
    if (
        snapshot.get("schemaVersion") == RAGGED_DAILY_SCHEMA_VERSION
        and len(ragged_dates_by_symbol)
        == len(snapshot.get("universe", []))
    ):
        ordered_dates = [
            ragged_dates_by_symbol[symbol]
            for symbol in snapshot["universe"]
        ]
        union_dates, availability = _daily_panel_availability_from_dates(
            ordered_dates
        )
        if snapshot.get("availability") != availability:
            issues.append(
                _issue(
                    snapshot_path,
                    "intake.snapshot-availability",
                    "Snapshot availability summary differs from canonical "
                    "normalized rows",
                )
            )
        expected_range = {
            "start": union_dates[0] if union_dates else None,
            "end": union_dates[-1] if union_dates else None,
        }
        if snapshot.get("timeRange") != expected_range:
            issues.append(
                _issue(
                    snapshot_path,
                    "intake.snapshot-time-range",
                    "Snapshot timeRange must equal the ragged panel union",
                )
            )
    study = load_study(project, manifest.get("studyId", ""))
    if study.study_hash != manifest.get("studyHash"):
        issues.append(
            _issue(study.manifest_path, "intake.study-hash", "Study hash mismatch")
        )
    # `studyInputHash` is the immutable identity created at intake time. The
    # editable Study subject is expected to evolve after that handoff, so a
    # different current input hash is evidence staleness, not intake
    # corruption. Run/Session/Report projections compare against the current
    # Study identity and surface that state explicitly.
    if study.dataset_hash != manifest.get("datasetHash"):
        issues.append(
            _issue(
                study.manifest_path,
                "intake.dataset-hash",
                "Study dataset hash mismatch",
            )
        )
    if (
        snapshot.get("schemaVersion") in OBSERVED_SCHEMA_VERSIONS
        and len(observed_dates_by_symbol)
        == len(snapshot.get("universe", []))
    ):
        ordered_dates = [
            observed_dates_by_symbol[symbol]
            for symbol in snapshot["universe"]
        ]
        target_symbol = next(
            (
                item["symbol"]
                for item in request["assets"]
                if item.get("positionRole") != "context-only"
            ),
            None,
        )
        target_dates = observed_dates_by_symbol.get(target_symbol, [])
        _, availability = _daily_panel_availability_from_dates(
            ordered_dates,
            minimum_assets_per_factor_timestamp=1,
            eligible_dates=target_dates,
        )
        if snapshot.get("availability") != availability:
            issues.append(
                _issue(
                    snapshot_path,
                    "intake.snapshot-availability",
                    "V5 availability summary differs from canonical "
                    "observed rows",
                )
            )
    time_range = (
        snapshot.get("timeRange")
        if isinstance(snapshot.get("timeRange"), dict)
        else {}
    )
    expected_dataset = {
        "id": snapshot.get("id"),
        "version": snapshot.get("version"),
        "assetClass": snapshot.get("assetClass"),
        "universe": snapshot.get("universe"),
        "timeRange": time_range,
    }
    actual_dataset = study.definition.dataset
    if (
        actual_dataset.id != expected_dataset["id"]
        or actual_dataset.version != expected_dataset["version"]
        or actual_dataset.asset_class != expected_dataset["assetClass"]
        or actual_dataset.universe != expected_dataset["universe"]
        or actual_dataset.time_range.start
        != expected_dataset["timeRange"].get("start")
        or actual_dataset.time_range.end
        != expected_dataset["timeRange"].get("end")
    ):
        issues.append(
            _issue(study.manifest_path, "intake.study-dataset", "Study differs from snapshot")
        )
    mandate_studies = {
        "ohlcv-portfolio-lab": ("ohlcv-portfolio-quality",),
        "ohlcv-rl-factor-lab": ("ohlcv-rl-factor-policy",),
        "ohlcv-research-desk": (
            "ohlcv-portfolio-quality",
            "ohlcv-rl-factor-policy",
        ),
    }.get(manifest.get("template"), ())
    requires_mandate = False
    for mandate_study_id in mandate_studies:
        mandate_study = load_study(project, mandate_study_id)
        if (
            mandate_study.definition.dependencies is not None
            and PORTFOLIO_MANDATE
            in mandate_study.definition.dependencies["paths"]
        ):
            requires_mandate = True
    mandate_path = project.root_dir / PORTFOLIO_MANDATE
    if requires_mandate or mandate_path.exists() or mandate_path.is_symlink():
        mandate = load_portfolio_mandate(mandate_path)
        annualization = 252
        if (
            snapshot.get("schemaVersion")
            in {2, 3, *OBSERVED_SCHEMA_VERSIONS}
            and snapshot.get("assets")
        ):
            target_symbol = next(
                (
                    item["symbol"]
                    for item in request["assets"]
                    if item.get("positionRole") != "context-only"
                ),
                None,
            )
            first_asset = next(
                (
                    item
                    for item in snapshot["assets"]
                    if (
                        snapshot.get("schemaVersion") in OBSERVED_SCHEMA_VERSIONS
                        and item.get("symbol") == target_symbol
                    )
                ),
                snapshot["assets"][0],
            )
            if isinstance(first_asset, dict):
                base_interval = snapshot["intervalSurface"]["baseInterval"]
                base_record = next(
                    (
                        row
                        for row in first_asset.get("intervals", [])
                        if row.get("interval") == base_interval
                    ),
                    None,
                )
                if isinstance(base_record, dict):
                    normalized_path = confined_path(
                        project.root_dir
                        / project.manifest.directories["data"],
                        base_record.get("normalizedPath", ""),
                        f"{snapshot_path}/assets/0/intervals",
                    )
                    annualization = infer_annualization_periods(
                        _read_source(normalized_path)["timestamp"]
                    )
        expected_mandate = build_portfolio_mandate(
            request,
            list(snapshot.get("universe", [])),
            annualization_periods=annualization,
        )
        if mandate != expected_mandate:
            issues.append(
                _issue(
                    mandate_path,
                    "intake.portfolio-mandate",
                    "Portfolio Mandate differs from the normalized request",
                )
            )
    horizon_studies = {
        "ohlcv-factor-lab": ("ohlcv-factor-quality",),
        "ohlcv-portfolio-lab": ("ohlcv-portfolio-quality",),
        "ohlcv-rl-factor-lab": ("ohlcv-rl-factor-policy",),
        "ohlcv-research-desk": (
            "ohlcv-factor-quality",
            "ohlcv-portfolio-quality",
            "ohlcv-rl-factor-policy",
        ),
    }.get(manifest.get("template"), ())
    requires_horizon = False
    for horizon_study_id in horizon_studies:
        horizon_study = load_study(project, horizon_study_id)
        if (
            horizon_study.definition.dependencies is not None
            and RESEARCH_HORIZON
            in horizon_study.definition.dependencies["paths"]
        ):
            requires_horizon = True
        else:
            issues.append(
                _issue(
                    horizon_study.manifest_path,
                    "intake.research-horizon-dependency",
                    "Study does not bind the fixed research horizon",
                )
            )
    horizon_path = project.root_dir / RESEARCH_HORIZON
    if requires_horizon or horizon_path.exists() or horizon_path.is_symlink():
        horizon = load_research_horizon(horizon_path)
        expected_horizon = build_research_horizon(request)
        if horizon != expected_horizon:
            issues.append(
                _issue(
                    horizon_path,
                    "intake.research-horizon",
                    "Horizon Mandate differs from the normalized request",
                )
            )
    factor_claim_studies = {
        "ohlcv-factor-lab": ("ohlcv-factor-quality",),
        "ohlcv-portfolio-lab": ("ohlcv-portfolio-quality",),
        "ohlcv-rl-factor-lab": ("ohlcv-rl-factor-policy",),
        "ohlcv-research-desk": (
            "ohlcv-factor-quality",
            "ohlcv-portfolio-quality",
            "ohlcv-rl-factor-policy",
        ),
    }.get(manifest.get("template"), ())
    factor_claim_path = project.root_dir / FACTOR_CLAIM
    factor_claim_present = (
        factor_claim_path.exists() or factor_claim_path.is_symlink()
    )
    factor_claim_dependencies: dict[str, bool] = {}
    for factor_study_id in factor_claim_studies:
        factor_study = load_study(project, factor_study_id)
        factor_claim_dependencies[factor_study_id] = (
            factor_study.definition.dependencies is not None
            and FACTOR_CLAIM
            in factor_study.definition.dependencies["paths"]
        )
    requires_factor_claim = any(factor_claim_dependencies.values())
    factor_claim_contract = factor_claim_present or requires_factor_claim
    if factor_claim_contract:
        for factor_study_id, binds_claim in factor_claim_dependencies.items():
            if binds_claim:
                continue
            factor_study = load_study(project, factor_study_id)
            issues.append(
                _issue(
                    factor_study.manifest_path,
                    "intake.factor-claim-dependency",
                    "Factor Study does not bind the fixed Factor claim",
                )
            )
    if factor_claim_contract:
        factor_claim = load_factor_claim(factor_claim_path)
        expected_factor_claim = build_factor_claim(request)
        if factor_claim != expected_factor_claim:
            issues.append(
                _issue(
                    factor_claim_path,
                    "intake.factor-claim",
                    "Factor claim differs from the normalized request",
                )
            )
    factor_population_path = project.root_dir / FACTOR_POPULATION
    factor_population_present = (
        factor_population_path.exists() or factor_population_path.is_symlink()
    )
    factor_population_dependencies: dict[str, bool] = {}
    for factor_study_id in factor_claim_studies:
        factor_study = load_study(project, factor_study_id)
        factor_population_dependencies[factor_study_id] = (
            factor_study.definition.dependencies is not None
            and FACTOR_POPULATION
            in factor_study.definition.dependencies["paths"]
        )
    requires_factor_population = any(
        factor_population_dependencies.values()
    )
    factor_population_contract = (
        factor_population_present or requires_factor_population
    )
    if factor_population_contract:
        for factor_study_id, binds_population in (
            factor_population_dependencies.items()
        ):
            if binds_population:
                continue
            factor_study = load_study(project, factor_study_id)
            issues.append(
                _issue(
                    factor_study.manifest_path,
                    "intake.factor-population-dependency",
                    "Factor Study does not bind the fixed Factor population",
                )
            )
        factor_population = load_factor_population(factor_population_path)
        try:
            expected_factor_population = build_factor_population(
                request,
                list(snapshot.get("universe", [])),
            )
        except PredictionModeError as error:
            issues.append(
                _issue(
                    factor_population_path,
                    error.code,
                    str(error),
                )
            )
        else:
            if factor_population != expected_factor_population:
                issues.append(
                    _issue(
                        factor_population_path,
                        "intake.factor-population",
                        "Factor population differs from the normalized request",
                    )
                )
    event_policy_path = project.root_dir / EVENT_STUDY_POLICY
    event_policy_present = (
        event_policy_path.exists() or event_policy_path.is_symlink()
    )
    requires_event_policy = (
        manifest.get("template") == "ohlcv-event-study-lab"
        and study.definition.dependencies is not None
        and EVENT_STUDY_POLICY in study.definition.dependencies["paths"]
    )
    if (
        manifest.get("template") == "ohlcv-event-study-lab"
        and not requires_event_policy
    ):
        issues.append(
            _issue(
                study.manifest_path,
                "intake.event-study-dependency",
                "Event Study does not bind fixed event authority",
            )
        )
    if event_policy_present or requires_event_policy:
        try:
            event_policy = load_event_study_policy(event_policy_path)
            expected_event_policy = build_event_study_policy(request)
            if event_policy != expected_event_policy:
                issues.append(
                    _issue(
                        event_policy_path,
                        "intake.event-study-policy",
                        "Event Study authority differs from normalized request",
                    )
                )
        except AutoQuantValidationError as error:
            issues.extend(error.issues)
    path_stress_path = project.root_dir / BOOK_PATH_STRESS_POLICY
    path_stress_present = path_stress_path.exists() or path_stress_path.is_symlink()
    requires_path_stress = (
        manifest.get("template") == "ohlcv-book-path-stress-lab"
        and study.definition.dependencies is not None
        and BOOK_PATH_STRESS_POLICY in study.definition.dependencies["paths"]
    )
    if manifest.get("template") == "ohlcv-book-path-stress-lab" and not requires_path_stress:
        issues.append(
            _issue(
                study.manifest_path,
                "intake.path-stress-dependency",
                "Path Stress Study does not bind fixed path authority",
            )
        )
    if path_stress_present or requires_path_stress:
        try:
            path_stress = load_book_path_stress_policy(path_stress_path)
            expected_path_stress = build_book_path_stress_policy(request)
            if path_stress != expected_path_stress:
                issues.append(
                    _issue(
                        path_stress_path,
                        "intake.path-stress-policy",
                        "Path Stress authority differs from normalized request",
                    )
                )
        except AutoQuantValidationError as error:
            issues.extend(error.issues)
    allocation_path = project.root_dir / ALLOCATION_POLICY
    allocation_present = (
        allocation_path.exists() or allocation_path.is_symlink()
    )
    requires_allocation = (
        manifest.get("template") == "ohlcv-allocation-lab"
        and study.definition.dependencies is not None
        and ALLOCATION_POLICY in study.definition.dependencies["paths"]
    )
    if (
        manifest.get("template") == "ohlcv-allocation-lab"
        and not requires_allocation
    ):
        issues.append(
            _issue(
                study.manifest_path,
                "intake.allocation-dependency",
                "Allocation Study does not bind fixed allocation authority",
            )
        )
    if allocation_present or requires_allocation:
        try:
            allocation = load_allocation_contract(allocation_path)
            allocation_annualization = 252
            if (
                snapshot.get("schemaVersion")
                in {2, 3, *OBSERVED_SCHEMA_VERSIONS}
                and snapshot.get("assets")
            ):
                target_symbol = next(
                    (
                        item["symbol"]
                        for item in request["assets"]
                        if item.get("positionRole") == "long-only"
                    ),
                    None,
                )
                first_asset = next(
                    (
                        item
                        for item in snapshot["assets"]
                        if item.get("symbol") == target_symbol
                    ),
                    snapshot["assets"][0],
                )
                base_interval = snapshot["intervalSurface"]["baseInterval"]
                base_record = next(
                    (
                        row
                        for row in first_asset.get("intervals", [])
                        if row.get("interval") == base_interval
                    ),
                    None,
                )
                if isinstance(base_record, dict):
                    normalized_path = confined_path(
                        project.root_dir
                        / project.manifest.directories["data"],
                        base_record.get("normalizedPath", ""),
                        f"{snapshot_path}/assets/0/intervals",
                    )
                    allocation_annualization = infer_annualization_periods(
                        _read_source(normalized_path)["timestamp"]
                    )
            expected_allocation = build_allocation_contract(
                request,
                list(snapshot.get("universe", [])),
                annualization_periods=allocation_annualization,
            )
            if allocation != expected_allocation:
                issues.append(
                    _issue(
                        allocation_path,
                        "intake.allocation-policy",
                        "Allocation authority differs from normalized request",
                    )
                )
        except (AutoQuantValidationError, ValueError) as error:
            if isinstance(error, AutoQuantValidationError):
                issues.extend(error.issues)
            else:
                issues.append(
                    _issue(
                        allocation_path,
                        "intake.allocation-policy",
                        str(error),
                    )
                )
    if issues:
        raise AutoQuantValidationError(issues)
    return {
        "manifest": manifest,
        "request": request,
        "dataset": snapshot,
        "study": {
            "id": study.definition.id,
            "name": study.definition.name,
            "hash": study.study_hash,
            "inputHash": study.input_hash,
            "intakeInputHash": manifest["studyInputHash"],
            "current": study.input_hash == manifest["studyInputHash"],
        },
    }


def intake_dataset_class_context(
    intake: dict[str, Any],
) -> dict[str, Any]:
    """Project one verified snapshot's complete economic-class read model."""

    return dataset_snapshot_class_context(intake["dataset"])


def dataset_snapshot_class_context(
    snapshot: dict[str, Any],
) -> dict[str, Any]:
    """Project one verified dataset snapshot's economic-class read model."""

    summary = snapshot["assetClass"]
    assets = snapshot["assets"]
    per_asset = all("assetClass" in asset for asset in assets)
    return {
        "assetClass": summary,
        "assetClasses": {
            asset["symbol"]: asset.get("assetClass", summary)
            for asset in assets
        },
        "assetClassSource": (
            "per-asset" if per_asset else "package-summary"
        ),
    }


def load_study_dataset_snapshot(
    project: ProjectContext,
    study: StudyContext,
) -> dict[str, Any] | None:
    """Verify and load the AutoQuant snapshot bound by one Study dataset."""

    candidates = sorted(
        relative
        for relative in study.dataset_hashes
        if relative == "ohlcv/snapshot.json"
        or relative.endswith("/ohlcv/snapshot.json")
    )
    if not candidates:
        return None
    if len(candidates) != 1:
        raise AutoQuantValidationError(
            [
                _issue(
                    study.manifest_path,
                    "study.dataset-snapshot-count",
                    "Study dataset must bind at most one AutoQuant OHLCV snapshot",
                )
            ]
        )
    relative = candidates[0]
    data_root = confined_path(
        project.root_dir,
        project.manifest.directories["data"],
        "project/directories/data",
    )
    snapshot_path = confined_path(
        data_root,
        relative,
        f"{study.manifest_path}/dataset/paths",
    )
    snapshot = _read_json(snapshot_path, "Study dataset snapshot")
    issues = _validate_snapshot(snapshot, snapshot_path)
    definition = study.definition.dataset
    expected = {
        "id": definition.id,
        "version": definition.version,
        "assetClass": definition.asset_class,
        "universe": definition.universe,
        "timeRange": {
            "start": definition.time_range.start,
            "end": definition.time_range.end,
        },
    }
    for key, value in expected.items():
        if snapshot.get(key) != value:
            issues.append(
                _issue(
                    snapshot_path,
                    f"study.dataset-snapshot-{key}",
                    f"Dataset snapshot {key} differs from Study definition",
                )
            )
    study_owned = relative.startswith(f"studies/{study.definition.id}/")
    if study_owned and snapshot.get("studyId") != study.definition.id:
        issues.append(
            _issue(
                snapshot_path,
                "study.dataset-snapshot-study",
                "Study-owned dataset snapshot names a different Study",
            )
        )
    if study_owned:
        request_candidates = sorted(
            path
            for path in study.dependency_hashes
            if path.endswith(f"/{study.definition.id}/request.json")
        )
        if len(request_candidates) != 1:
            issues.append(
                _issue(
                    study.manifest_path,
                    "study.dataset-request-count",
                    "Study-owned dataset requires one fixed Study request",
                )
            )
        else:
            request_path = confined_path(
                project.root_dir,
                request_candidates[0],
                f"{study.manifest_path}/dependencies/paths",
            )
            request = load_research_request(request_path)
            if hash_json(request) != snapshot.get("requestHash"):
                issues.append(
                    _issue(
                        snapshot_path,
                        "study.dataset-request-hash",
                        "Study-owned dataset snapshot differs from its fixed request",
                    )
                )
            requested_symbols = [item["symbol"] for item in request["assets"]]
            if snapshot.get("requestedAssets") != requested_symbols:
                issues.append(
                    _issue(
                        snapshot_path,
                        "study.dataset-request-assets",
                        "Study-owned dataset requested assets differ from its fixed request",
                    )
                )
    namespace_relative = Path(relative).parent.parent
    namespace_root = (
        data_root
        if namespace_relative.as_posix() == "."
        else confined_path(
            data_root,
            namespace_relative.as_posix(),
            f"{study.manifest_path}/dataset/namespace",
        )
    )
    for asset in snapshot.get("assets", []):
        if not isinstance(asset, dict):
            continue
        rows = (
            asset.get("intervals", [])
            if snapshot.get("schemaVersion")
            in {2, 3, *OBSERVED_SCHEMA_VERSIONS}
            else [asset]
        )
        for row in rows:
            if not isinstance(row, dict) or not isinstance(
                row.get("normalizedPath"), str
            ):
                continue
            normalized_path = confined_path(
                namespace_root,
                row["normalizedPath"],
                f"{snapshot_path}/assets/normalizedPath",
            )
            full_relative = normalized_path.relative_to(data_root).as_posix()
            if (
                not normalized_path.is_file()
                or full_relative not in study.dataset_hashes
            ):
                issues.append(
                    _issue(
                        normalized_path,
                        "study.dataset-file",
                        "Snapshot asset is outside the Study dataset closure",
                    )
                )
            elif hash_file(normalized_path) != row.get("normalizedHash"):
                issues.append(
                    _issue(
                        normalized_path,
                        "study.dataset-file-hash",
                        "Snapshot asset hash differs from normalized evidence",
                    )
                )
    if issues:
        raise AutoQuantValidationError(issues)
    return snapshot


OHLCV_PACKAGE_ASSET_PATH_DESCRIPTION = (
    "Portable POSIX-relative source path resolved from the directory "
    "containing the dataset-package manifest. To intake already staged "
    "nested files without an intermediate copy, place the manifest at their "
    "common ancestor (for example staging/dataset-package.json with "
    "raw-ohlcv/AAPL.csv). Parent traversal, absolute paths, and symlinks are "
    "rejected."
)
OHLCV_PACKAGE_ASSET_PROPERTIES: dict[str, Any] = {
    "symbol": {
        "type": "string",
        "pattern": SAFE_SYMBOL.pattern,
    },
    "assetClass": {
        "description": (
            "Exact economic class for this asset. Supply it on every asset "
            "or omit it from every asset; Core never fills a partial vector."
        ),
        "enum": sorted(ASSET_CLASSES),
    },
    "venue": {"type": "string", "minLength": 1},
    "currency": {"type": "string", "minLength": 1},
    "path": {
        "type": "string",
        "minLength": 1,
        "description": OHLCV_PACKAGE_ASSET_PATH_DESCRIPTION,
    },
}
OHLCV_PACKAGE_ASSETS_JSON_SCHEMA: dict[str, Any] = {
    "type": "array",
    "minItems": 1,
    "description": (
        "Asset inventory. Use either the legacy homogeneous shape with no "
        "per-asset assetClass fields, or one complete classified vector."
    ),
    "oneOf": [
        {
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["symbol", "venue", "currency", "path"],
                "not": {"required": ["assetClass"]},
                "properties": OHLCV_PACKAGE_ASSET_PROPERTIES,
            }
        },
        {
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "symbol",
                    "assetClass",
                    "venue",
                    "currency",
                    "path",
                ],
                "properties": OHLCV_PACKAGE_ASSET_PROPERTIES,
            }
        },
    ],
}


OHLCV_DATASET_PACKAGE_V1_JSON_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "AutoQuant external OHLCV dataset package",
    "type": "object",
    "additionalProperties": False,
    "required": [
        "schemaVersion",
        "kind",
        "id",
        "version",
        "assetClass",
        "frequency",
        "market",
        "priceAdjustment",
        "provider",
        "assets",
    ],
    "properties": {
        "schemaVersion": {"const": SCHEMA_VERSION},
        "kind": {"const": DATASET_PACKAGE_KIND},
        "id": {"type": "string", "minLength": 1},
        "version": {"type": "string", "minLength": 1},
        "assetClass": {
            "type": "string",
            "minLength": 1,
            "description": (
                "Package class for a legacy homogeneous inventory, or the "
                "canonical common class / 'mixed' summary when every asset "
                "declares assetClass."
            ),
        },
        "frequency": {"const": "1d"},
        "market": {
            "type": "object",
            "additionalProperties": False,
            "required": ["clock", "calendar", "timezone"],
            "properties": {
                "clock": {"const": "session"},
                "calendar": {"type": "string", "minLength": 1},
                "timezone": {"type": "string", "minLength": 1},
            },
        },
        "priceAdjustment": {"enum": sorted(PRICE_ADJUSTMENTS)},
        "provider": {
            "type": "object",
            "additionalProperties": False,
            "required": ["name", "retrievedAt", "sourceUri", "terms"],
            "properties": {
                "name": {"type": "string", "minLength": 1},
                "retrievedAt": {
                    "description": (
                        "Original provider retrieval time as a timezone-aware "
                        "ISO-8601 timestamp when known. Use null when "
                        "caller-supplied bytes do not preserve that time; "
                        "never substitute a later packaging timestamp."
                    ),
                    "anyOf": [
                        {"type": "null"},
                        {"type": "string", "minLength": 1},
                    ],
                },
                "sourceUri": {
                    "anyOf": [
                        {"type": "null"},
                        {"type": "string", "minLength": 1},
                    ]
                },
                "terms": {"type": "string", "minLength": 1},
            },
        },
        "assets": OHLCV_PACKAGE_ASSETS_JSON_SCHEMA,
    },
}

OHLCV_DATASET_PACKAGE_V4_JSON_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "AutoQuant observed-only ragged daily OHLCV package",
    "description": (
        "Only valid with project intake --template ohlcv-factor-lab. "
        "Use V1 for aligned daily fixed Book Risk, Event, Allocation, "
        "Portfolio, RL, or research-desk intake."
    ),
    "type": "object",
    "additionalProperties": False,
    "required": [
        "schemaVersion",
        "kind",
        "id",
        "version",
        "assetClass",
        "frequency",
        "panelPolicy",
        "market",
        "priceAdjustment",
        "provider",
        "assets",
    ],
    "properties": {
        **OHLCV_DATASET_PACKAGE_V1_JSON_SCHEMA["properties"],
        "schemaVersion": {"const": RAGGED_DAILY_SCHEMA_VERSION},
        "panelPolicy": {"const": RAGGED_PANEL_POLICY},
    },
}

OHLCV_DATASET_PACKAGE_V2_JSON_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "AutoQuant causal multi-interval OHLCV dataset package",
    "type": "object",
    "additionalProperties": False,
    "required": [
        "schemaVersion",
        "kind",
        "id",
        "version",
        "assetClass",
        "baseInterval",
        "featureIntervals",
        "timestampSemantics",
        "aggregation",
        "market",
        "priceAdjustment",
        "provider",
        "assets",
    ],
    "properties": {
        "schemaVersion": {"const": 2},
        "kind": {"const": DATASET_PACKAGE_KIND},
        "id": {"type": "string", "minLength": 1},
        "version": {"type": "string", "minLength": 1},
        "assetClass": OHLCV_DATASET_PACKAGE_V1_JSON_SCHEMA["properties"][
            "assetClass"
        ],
        "baseInterval": {"const": BASE_INTERVAL},
        "featureIntervals": {
            "type": "array",
            "minItems": 1,
            "uniqueItems": True,
            "items": {"enum": list(SUPPORTED_FEATURE_INTERVALS)},
        },
        "timestampSemantics": {"const": "bar-close"},
        "aggregation": {
            "type": "object",
            "additionalProperties": False,
            "required": ["method", "anchor"],
            "properties": {
                "method": {"const": AGGREGATION_METHOD},
                "anchor": {"const": "00:00"},
            },
        },
        "market": {
            "const": {
                "clock": "continuous",
                "calendar": "24/7",
                "timezone": "UTC",
            }
        },
        "priceAdjustment": {"enum": sorted(PRICE_ADJUSTMENTS)},
        "provider": OHLCV_DATASET_PACKAGE_V1_JSON_SCHEMA["properties"]["provider"],
        "assets": OHLCV_PACKAGE_ASSETS_JSON_SCHEMA,
    },
}
OHLCV_DATASET_PACKAGE_V3_JSON_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "AutoQuant configurable session-aware OHLCV dataset package",
    "type": "object",
    "additionalProperties": False,
    "required": [
        "schemaVersion",
        "kind",
        "id",
        "version",
        "assetClass",
        "baseInterval",
        "featureIntervals",
        "timestampSemantics",
        "aggregation",
        "market",
        "priceAdjustment",
        "provider",
        "assets",
    ],
    "properties": {
        "schemaVersion": {"const": 3},
        "kind": {"const": DATASET_PACKAGE_KIND},
        "id": {"type": "string", "minLength": 1},
        "version": {"type": "string", "minLength": 1},
        "assetClass": {"type": "string", "minLength": 1},
        "baseInterval": {"enum": list(SUPPORTED_BASE_INTERVALS)},
        "featureIntervals": {
            "type": "array",
            "minItems": 1,
            "uniqueItems": True,
            "items": {"enum": list(SUPPORTED_INTERVALS)},
        },
        "timestampSemantics": {"const": "bar-close"},
        "aggregation": {
            "type": "object",
            "additionalProperties": False,
            "required": ["method", "anchor", "terminalBucketPolicy"],
            "properties": {
                "method": {
                    "enum": [
                        CONTINUOUS_AGGREGATION_METHOD,
                        XNYS_AGGREGATION_METHOD,
                    ]
                },
                "anchor": {"enum": ["00:00", "market-open"]},
                "terminalBucketPolicy": {
                    "enum": [
                        CONTINUOUS_TERMINAL_POLICY,
                        SESSION_TERMINAL_POLICY,
                    ]
                },
            },
        },
        "market": {
            "oneOf": [
                {
                    "const": {
                        "clock": "continuous",
                        "calendar": "24/7",
                        "timezone": "UTC",
                    }
                },
                {
                    "const": {
                        "clock": "session",
                        "calendar": "XNYS",
                        "timezone": "America/New_York",
                    }
                },
            ]
        },
        "priceAdjustment": {"enum": sorted(PRICE_ADJUSTMENTS)},
        "provider": OHLCV_DATASET_PACKAGE_V1_JSON_SCHEMA["properties"]["provider"],
        "assets": OHLCV_DATASET_PACKAGE_V1_JSON_SCHEMA["properties"]["assets"],
    },
}
OHLCV_DATASET_PACKAGE_V5_JSON_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "AutoQuant observed-only base-bar Factor dataset package",
    "description": (
        "Only valid with project intake --template ohlcv-factor-lab and "
        "exactly one non-context temporal target."
    ),
    "type": "object",
    "additionalProperties": False,
    "required": [
        "schemaVersion",
        "kind",
        "id",
        "version",
        "assetClass",
        "baseInterval",
        "timestampSemantics",
        "panelPolicy",
        "market",
        "priceAdjustment",
        "provider",
        "assets",
    ],
    "properties": {
        "schemaVersion": {"const": OBSERVED_INTRADAY_SCHEMA_VERSION},
        "kind": {"const": DATASET_PACKAGE_KIND},
        "id": {"type": "string", "minLength": 1},
        "version": {"type": "string", "minLength": 1},
        "assetClass": {"type": "string", "minLength": 1},
        "baseInterval": {"enum": list(SUPPORTED_INTERVALS)},
        "timestampSemantics": {"const": "bar-close"},
        "panelPolicy": {"const": OBSERVED_PANEL_POLICY},
        "market": {"const": OBSERVED_INTRADAY_MARKET},
        "priceAdjustment": {"enum": sorted(PRICE_ADJUSTMENTS)},
        "provider": OHLCV_DATASET_PACKAGE_V1_JSON_SCHEMA["properties"][
            "provider"
        ],
        "assets": {
            "type": "array",
            "minItems": 1,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "symbol",
                    "assetClass",
                    "venue",
                    "currency",
                    "path",
                    "volumeSemantics",
                ],
                "properties": {
                    "symbol": {
                        "type": "string",
                        "pattern": SAFE_SYMBOL.pattern,
                    },
                    "assetClass": {"enum": sorted(ASSET_CLASSES)},
                    "venue": {"type": "string", "minLength": 1},
                    "currency": {"type": "string", "minLength": 1},
                    "path": {
                        "type": "string",
                        "minLength": 1,
                        "description": OHLCV_PACKAGE_ASSET_PATH_DESCRIPTION,
                    },
                    "volumeSemantics": {
                        "enum": sorted(OBSERVED_VOLUME_SEMANTICS)
                    },
                },
            },
        },
    },
}
OHLCV_DATASET_PACKAGE_V6_JSON_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "AutoQuant multi-source observed Factor dataset package",
    "description": (
        "Only valid with project intake --template ohlcv-factor-lab and "
        "exactly one non-context temporal target. Every asset binds to one "
        "content-addressed source package and provider claim."
    ),
    "type": "object",
    "additionalProperties": False,
    "required": [
        "schemaVersion",
        "kind",
        "id",
        "version",
        "assetClass",
        "baseInterval",
        "timestampSemantics",
        "panelPolicy",
        "market",
        "priceAdjustment",
        "sources",
        "assets",
    ],
    "properties": {
        **{
            key: item
            for key, item in OHLCV_DATASET_PACKAGE_V5_JSON_SCHEMA[
                "properties"
            ].items()
            if key not in {"schemaVersion", "provider", "assets"}
        },
        "schemaVersion": {"const": MULTI_SOURCE_OBSERVED_SCHEMA_VERSION},
        "sources": {
            "type": "array",
            "minItems": 2,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["id", "sourcePackage", "provider"],
                "properties": {
                    "id": {
                        "type": "string",
                        "pattern": SAFE_SOURCE_ID.pattern,
                    },
                    "sourcePackage": {
                        "type": "object",
                        "additionalProperties": False,
                        "required": ["id", "version", "sha256"],
                        "properties": {
                            "id": {"type": "string", "minLength": 1},
                            "version": {"type": "string", "minLength": 1},
                            "sha256": {
                                "type": "string",
                                "pattern": r"^[0-9a-f]{64}$",
                            },
                        },
                    },
                    "provider": OHLCV_DATASET_PACKAGE_V1_JSON_SCHEMA[
                        "properties"
                    ]["provider"],
                },
            },
        },
        "assets": {
            "type": "array",
            "minItems": 1,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "symbol",
                    "assetClass",
                    "venue",
                    "currency",
                    "path",
                    "volumeSemantics",
                    "sourceId",
                ],
                "properties": {
                    **OHLCV_DATASET_PACKAGE_V5_JSON_SCHEMA["properties"][
                        "assets"
                    ]["items"]["properties"],
                    "sourceId": {
                        "type": "string",
                        "pattern": SAFE_SOURCE_ID.pattern,
                    },
                },
            },
        },
    },
}
OHLCV_DATASET_PACKAGE_JSON_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "AutoQuant external OHLCV dataset package",
    "description": (
        "Select the package version together with the intake template: V1 "
        "is aligned daily and supports every intake template; V2 is fixed "
        "continuous hourly; V3 is configurable continuous/XNYS; V4 ragged "
        "daily and V5/V6 observed base-bar are ohlcv-factor-lab only. Asset "
        "paths are portable POSIX-relative paths rooted at the directory "
        "containing this manifest; placing the manifest at staged files' "
        "common ancestor avoids an intermediate copy without weakening "
        "confinement."
    ),
    "type": "object",
    "properties": {
        "schemaVersion": {
            "enum": [
                1,
                2,
                3,
                RAGGED_DAILY_SCHEMA_VERSION,
                OBSERVED_INTRADAY_SCHEMA_VERSION,
                MULTI_SOURCE_OBSERVED_SCHEMA_VERSION,
            ]
        },
        "kind": {"const": DATASET_PACKAGE_KIND},
        "frequency": {"const": "1d"},
        "baseInterval": {"enum": list(SUPPORTED_INTERVALS)},
        "featureIntervals": {
            "type": "array",
            "items": {"enum": list(SUPPORTED_INTERVALS)},
        },
    },
    "oneOf": [
        OHLCV_DATASET_PACKAGE_V1_JSON_SCHEMA,
        OHLCV_DATASET_PACKAGE_V2_JSON_SCHEMA,
        OHLCV_DATASET_PACKAGE_V3_JSON_SCHEMA,
        OHLCV_DATASET_PACKAGE_V4_JSON_SCHEMA,
        OHLCV_DATASET_PACKAGE_V5_JSON_SCHEMA,
        OHLCV_DATASET_PACKAGE_V6_JSON_SCHEMA,
    ],
}
