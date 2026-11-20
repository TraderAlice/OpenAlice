"""Fetch a bounded auditable Yahoo Chart daily OHLCV staging package."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd


CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
SAFE_SYMBOL = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._=-]{0,63}$")
ASSET_CLASSES = {
    "crypto",
    "equity",
    "forex",
    "fund",
    "future",
    "index",
    "mixed",
}
TRANSIENT_SCALE_JUMP_RATIO = 5.0
TRANSIENT_SCALE_MAX_ISLAND_ROWS = 3
TRANSIENT_SCALE_RECOVERY_MIN = 0.75
TRANSIENT_SCALE_RECOVERY_MAX = 4.0 / 3.0


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_date(value: str) -> datetime:
    try:
        parsed = datetime.strptime(value, "%Y-%m-%d")
    except ValueError as exc:
        raise argparse.ArgumentTypeError("expected YYYY-MM-DD") from exc
    return parsed.replace(tzinfo=timezone.utc)


def load_assets(path: Path) -> list[dict[str, str]]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, list) or not raw:
        raise ValueError("assets file must contain a non-empty JSON array")
    required = {"symbol", "providerSymbol", "venue", "currency", "assetClass"}
    assets: list[dict[str, str]] = []
    for index, item in enumerate(raw):
        if not isinstance(item, dict) or set(item) != required:
            raise ValueError(
                f"assets[{index}] must contain exactly {sorted(required)}"
            )
        normalized = {
            key: value.strip() if isinstance(value, str) else value
            for key, value in item.items()
        }
        if not all(isinstance(value, str) and value for value in normalized.values()):
            raise ValueError(f"assets[{index}] values must be non-empty strings")
        if not SAFE_SYMBOL.fullmatch(normalized["symbol"]):
            raise ValueError(f"assets[{index}].symbol is not path-safe")
        if normalized["assetClass"] not in ASSET_CLASSES - {"mixed"}:
            raise ValueError(f"assets[{index}].assetClass is unsupported")
        assets.append(normalized)
    for key in ("symbol", "providerSymbol"):
        values = [item[key] for item in assets]
        if len(values) != len(set(values)):
            raise ValueError(f"asset {key} values must be unique")
    return assets


def fetch(provider_symbol: str, start: datetime, end_exclusive: datetime) -> dict:
    query = urllib.parse.urlencode(
        {
            "period1": int(start.timestamp()),
            "period2": int(end_exclusive.timestamp()),
            "interval": "1d",
            "events": "div,splits",
            "includeAdjustedClose": "true",
        }
    )
    encoded = urllib.parse.quote(provider_symbol, safe="")
    request = urllib.request.Request(
        f"{CHART_URL.format(symbol=encoded)}?{query}",
        headers={"User-Agent": "Mozilla/5.0 AutoQuantMarketDataSkill/1.0"},
    )
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.load(response)
        except Exception:
            if attempt == 3:
                raise
            time.sleep(1.0 + attempt)
    raise AssertionError("unreachable")


def result_for(provider_symbol: str, payload: dict) -> dict:
    chart = payload.get("chart")
    if not isinstance(chart, dict):
        raise ValueError(f"{provider_symbol}: Yahoo response lacks chart")
    if chart.get("error") is not None or not chart.get("result"):
        raise ValueError(
            f"{provider_symbol}: Yahoo returned {chart.get('error')!r}"
        )
    return chart["result"][0]


def detect_transient_scale_observations(
    frame: pd.DataFrame,
) -> list[dict[str, Any]]:
    """Find a short price-scale island that quickly reverses near its origin."""

    observations: list[dict[str, Any]] = []
    closes = frame["close"].astype(float).reset_index(drop=True)
    index = 1
    while index < len(frame) - 1:
        preceding_close = float(closes.iloc[index - 1])
        entry_ratio = float(closes.iloc[index]) / preceding_close
        entry_down = entry_ratio <= 1.0 / TRANSIENT_SCALE_JUMP_RATIO
        entry_up = entry_ratio >= TRANSIENT_SCALE_JUMP_RATIO
        if not (entry_down or entry_up):
            index += 1
            continue
        island_end: int | None = None
        for candidate_end in range(
            index,
            min(
                index + TRANSIENT_SCALE_MAX_ISLAND_ROWS,
                len(frame) - 1,
            ),
        ):
            island_close = float(closes.iloc[candidate_end])
            following_close = float(closes.iloc[candidate_end + 1])
            exit_ratio = following_close / island_close
            recovery_ratio = following_close / preceding_close
            exit_reverses = (
                entry_down and exit_ratio >= TRANSIENT_SCALE_JUMP_RATIO
            ) or (
                entry_up and exit_ratio <= 1.0 / TRANSIENT_SCALE_JUMP_RATIO
            )
            if (
                exit_reverses
                and TRANSIENT_SCALE_RECOVERY_MIN
                <= recovery_ratio
                <= TRANSIENT_SCALE_RECOVERY_MAX
            ):
                island_end = candidate_end
                break
        if island_end is None:
            index += 1
            continue
        following_close = float(closes.iloc[island_end + 1])
        exit_ratio = following_close / float(closes.iloc[island_end])
        recovery_ratio = following_close / preceding_close
        for row_index in range(index, island_end + 1):
            row = frame.iloc[row_index]
            observations.append(
                {
                    "date": str(row["date"]),
                    **{
                        column: float(row[column])
                        for column in (
                            "open",
                            "high",
                            "low",
                            "close",
                            "volume",
                        )
                    },
                    "precedingClose": preceding_close,
                    "followingClose": following_close,
                    "entryRatio": entry_ratio,
                    "exitRatio": exit_ratio,
                    "recoveryRatio": recovery_ratio,
                    "islandRows": island_end - index + 1,
                }
            )
        index = island_end + 1
    return observations


def frame_for(
    provider_symbol: str,
    result: dict,
    adjustment: str,
    invalid_ohlc_policy: str = "reject",
    transient_scale_policy: str = "reject",
) -> tuple[pd.DataFrame, dict[str, Any]]:
    if invalid_ohlc_policy not in {"reject", "drop-observation"}:
        raise ValueError(
            f"{provider_symbol}: unsupported invalid OHLC policy "
            f"{invalid_ohlc_policy!r}"
        )
    if transient_scale_policy not in {"reject", "drop-observation"}:
        raise ValueError(
            f"{provider_symbol}: unsupported transient scale policy "
            f"{transient_scale_policy!r}"
        )
    timestamps = result.get("timestamp")
    indicators = result.get("indicators", {})
    quotes = indicators.get("quote") or []
    if not timestamps or not quotes:
        raise ValueError(f"{provider_symbol}: missing timestamps or quote data")
    quote = quotes[0]
    exchange_timezone = (
        result.get("meta", {}).get("exchangeTimezoneName") or "UTC"
    )
    try:
        session_dates = (
            pd.to_datetime(timestamps, unit="s", utc=True)
            .tz_convert(exchange_timezone)
            .strftime("%Y-%m-%d")
        )
    except Exception as exc:
        raise ValueError(
            f"{provider_symbol}: invalid exchange timezone "
            f"{exchange_timezone!r}"
        ) from exc
    raw = pd.DataFrame(
        {
            "date": session_dates,
            "open": quote.get("open"),
            "high": quote.get("high"),
            "low": quote.get("low"),
            "close": quote.get("close"),
            "volume": quote.get("volume"),
        }
    )
    source_rows = len(raw)
    adjusted_rows = 0
    if adjustment == "split-and-dividend-adjusted":
        adjusted_values = indicators.get("adjclose") or []
        if not adjusted_values or "adjclose" not in adjusted_values[0]:
            raise ValueError(
                f"{provider_symbol}: adjusted close is unavailable"
            )
        raw["adjusted_close"] = adjusted_values[0]["adjclose"]
        factor = raw["adjusted_close"] / raw["close"]
        valid_factor = factor.notna() & factor.gt(0)
        adjusted_rows = int((valid_factor & factor.ne(1.0)).sum())
        for column in ("open", "high", "low", "close"):
            raw[column] = raw[column] * factor
        raw = raw.drop(columns="adjusted_close")

    for column in ("open", "high", "low", "close", "volume"):
        raw[column] = pd.to_numeric(raw[column], errors="coerce")
    null_rows = int(raw.isna().any(axis=1).sum())
    raw = raw.dropna()
    invalid_rows = int(
        (
            ~(raw[["open", "high", "low", "close"]] > 0).all(axis=1)
            | raw["volume"].lt(0)
        ).sum()
    )
    raw = raw.loc[
        (raw[["open", "high", "low", "close"]] > 0).all(axis=1)
        & raw["volume"].ge(0)
    ]
    duplicate_rows = int(raw["date"].duplicated(keep="last").sum())
    raw = (
        raw.drop_duplicates("date", keep="last")
        .sort_values("date")
        .reset_index(drop=True)
    )
    invalid_bounds = (
        raw["high"].lt(raw[["open", "low", "close"]].max(axis=1))
        | raw["low"].gt(raw[["open", "high", "close"]].min(axis=1))
    )
    invalid_bound_rows = int(invalid_bounds.sum())
    invalid_bound_observations = [
        {
            "date": str(row["date"]),
            **{
                column: float(row[column])
                for column in ("open", "high", "low", "close", "volume")
            },
        }
        for _, row in raw.loc[invalid_bounds].iterrows()
    ]
    invalid_bound_drop_limit = min(
        10,
        max(1, math.ceil(len(raw) * 0.001)),
    )
    if invalid_bound_rows and invalid_ohlc_policy == "reject":
        dates = ", ".join(
            item["date"] for item in invalid_bound_observations[:5]
        )
        raise ValueError(
            f"{provider_symbol}: {invalid_bound_rows} inconsistent OHLC "
            f"bounds observation(s) on {dates}; use the explicit "
            "drop-observation policy only when the research contract permits "
            "audited observation removal"
        )
    if invalid_bound_rows > invalid_bound_drop_limit:
        raise ValueError(
            f"{provider_symbol}: {invalid_bound_rows} inconsistent OHLC bounds "
            f"observations exceed audited drop limit {invalid_bound_drop_limit}"
        )
    if invalid_bound_rows:
        raw = raw.loc[~invalid_bounds].reset_index(drop=True)
    transient_scale_observations = detect_transient_scale_observations(raw)
    transient_scale_rows = len(transient_scale_observations)
    transient_scale_drop_limit = min(
        10,
        max(1, math.ceil(len(raw) * 0.001)),
    )
    if transient_scale_rows and transient_scale_policy == "reject":
        dates = ", ".join(
            item["date"] for item in transient_scale_observations[:5]
        )
        raise ValueError(
            f"{provider_symbol}: {transient_scale_rows} transient price-scale "
            f"observation(s) on {dates}; use the explicit transient-scale "
            "drop-observation policy only when the research contract permits "
            "audited observation removal"
        )
    if transient_scale_rows > transient_scale_drop_limit:
        raise ValueError(
            f"{provider_symbol}: {transient_scale_rows} transient price-scale "
            "observations exceed audited drop limit "
            f"{transient_scale_drop_limit}"
        )
    if transient_scale_rows:
        transient_dates = {
            item["date"] for item in transient_scale_observations
        }
        raw = raw.loc[~raw["date"].isin(transient_dates)].reset_index(drop=True)
    if raw.empty:
        raise ValueError(f"{provider_symbol}: no valid observations")
    return raw, {
        "sourceRows": source_rows,
        "normalizedRows": len(raw),
        "nullRowsDropped": null_rows,
        "invalidRowsDropped": invalid_rows,
        "duplicateRowsDropped": duplicate_rows,
        "invalidOhlcPolicy": invalid_ohlc_policy,
        "invalidOhlcBoundsRows": invalid_bound_rows,
        "invalidOhlcBoundsRowsDropped": (
            invalid_bound_rows
            if invalid_ohlc_policy == "drop-observation"
            else 0
        ),
        "invalidOhlcBoundsDropLimit": invalid_bound_drop_limit,
        "invalidOhlcBoundsObservations": invalid_bound_observations,
        "transientScalePolicy": transient_scale_policy,
        "transientScaleRows": transient_scale_rows,
        "transientScaleRowsDropped": (
            transient_scale_rows
            if transient_scale_policy == "drop-observation"
            else 0
        ),
        "transientScaleDropLimit": transient_scale_drop_limit,
        "transientScaleObservations": transient_scale_observations,
        "adjustedFactorRows": adjusted_rows,
        "zeroVolumeRows": int(raw["volume"].eq(0).sum()),
        "firstDate": str(raw["date"].iloc[0]),
        "lastDate": str(raw["date"].iloc[-1]),
        "sessionDateTimezone": exchange_timezone,
    }


def bound_session_dates(
    frame: pd.DataFrame,
    start: datetime,
    end_exclusive: datetime,
) -> tuple[pd.DataFrame, int]:
    """Enforce the caller's Gregorian session-date half-open interval."""

    observed = pd.to_datetime(
        frame["date"],
        format="%Y-%m-%d",
        errors="raise",
    ).dt.date
    selected = (
        (observed >= start.date())
        & (observed < end_exclusive.date())
    )
    bounded = frame.loc[selected].reset_index(drop=True)
    if bounded.empty:
        raise ValueError("no observations in explicit session-date range")
    return bounded, int((~selected).sum())


def ensure_output(path: Path) -> None:
    if path.exists() and (not path.is_dir() or any(path.iterdir())):
        raise ValueError(f"output must be absent or empty: {path}")
    path.mkdir(parents=True, exist_ok=True)


def invalid_ohlc_summary(audits: dict[str, Any]) -> dict[str, Any]:
    """Project per-asset invalid-bound evidence into one visible summary."""

    affected_assets: list[str] = []
    observations: list[dict[str, Any]] = []
    observations_dropped = 0
    policies: set[str] = set()
    for symbol, asset_audit in audits.items():
        policy = asset_audit.get("invalidOhlcPolicy")
        if isinstance(policy, str):
            policies.add(policy)
        asset_observations = asset_audit.get(
            "invalidOhlcBoundsObservations",
            [],
        )
        if asset_observations:
            affected_assets.append(symbol)
            provider_symbol = asset_audit.get("providerSymbol")
            for observation in asset_observations:
                observations.append(
                    {
                        "symbol": symbol,
                        "providerSymbol": provider_symbol,
                        **observation,
                    }
                )
        observations_dropped += int(
            asset_audit.get("invalidOhlcBoundsRowsDropped", 0)
        )
    return {
        "policy": next(iter(policies)) if len(policies) == 1 else "mixed",
        "affectedAssets": affected_assets,
        "observationsFound": len(observations),
        "observationsDropped": observations_dropped,
        "observations": observations,
    }


def transient_scale_summary(audits: dict[str, Any]) -> dict[str, Any]:
    """Project every per-asset transient scale island into one summary."""

    affected_assets: list[str] = []
    observations: list[dict[str, Any]] = []
    observations_dropped = 0
    policies: set[str] = set()
    for symbol, asset_audit in audits.items():
        policy = asset_audit.get("transientScalePolicy")
        if isinstance(policy, str):
            policies.add(policy)
        asset_observations = asset_audit.get(
            "transientScaleObservations",
            [],
        )
        if asset_observations:
            affected_assets.append(symbol)
            provider_symbol = asset_audit.get("providerSymbol")
            for observation in asset_observations:
                observations.append(
                    {
                        "symbol": symbol,
                        "providerSymbol": provider_symbol,
                        **observation,
                    }
                )
        observations_dropped += int(
            asset_audit.get("transientScaleRowsDropped", 0)
        )
    return {
        "policy": next(iter(policies)) if len(policies) == 1 else "mixed",
        "affectedAssets": affected_assets,
        "observationsFound": len(observations),
        "observationsDropped": observations_dropped,
        "observations": observations,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--assets", type=Path, required=True)
    parser.add_argument("--dataset-id", required=True)
    parser.add_argument("--start", type=parse_date, required=True)
    parser.add_argument("--end-exclusive", type=parse_date, required=True)
    parser.add_argument("--calendar", required=True)
    parser.add_argument("--timezone", required=True)
    parser.add_argument(
        "--adjustment",
        choices=("split-adjusted", "split-and-dividend-adjusted"),
        required=True,
    )
    parser.add_argument(
        "--panel",
        choices=("aligned", "observed-only"),
        default="aligned",
    )
    parser.add_argument(
        "--invalid-ohlc-policy",
        choices=("reject", "drop-observation"),
        default="reject",
        help=(
            "reject inconsistent provider OHLC geometry, or explicitly drop "
            "a tightly bounded observation while retaining its audit"
        ),
    )
    parser.add_argument(
        "--transient-scale-policy",
        choices=("reject", "drop-observation"),
        default="reject",
        help=(
            "reject a short provider price-scale island that reverses near "
            "its origin, or explicitly drop its tightly bounded observations "
            "while retaining their exact audit"
        ),
    )
    parser.add_argument("--terms", required=True)
    args = parser.parse_args()
    if args.end_exclusive <= args.start:
        parser.error("--end-exclusive must be after --start")
    if not SAFE_SYMBOL.fullmatch(args.dataset_id):
        parser.error("--dataset-id must be a path-safe AutoQuant identifier")

    assets = load_assets(args.assets.expanduser().absolute())
    output = args.output.expanduser().absolute()
    ensure_output(output)
    raw_dir = output / "raw"
    raw_dir.mkdir()
    retrieved_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    frames: dict[str, pd.DataFrame] = {}
    audits: dict[str, Any] = {}

    for asset in assets:
        payload = fetch(asset["providerSymbol"], args.start, args.end_exclusive)
        raw_path = raw_dir / f"{asset['symbol']}.json"
        raw_path.write_text(
            json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        result = result_for(asset["providerSymbol"], payload)
        frame, summary = frame_for(
            asset["providerSymbol"],
            result,
            args.adjustment,
            args.invalid_ohlc_policy,
            args.transient_scale_policy,
        )
        frame, out_of_range = bound_session_dates(
            frame,
            args.start,
            args.end_exclusive,
        )
        summary["outOfRangeRowsDropped"] = out_of_range
        summary["normalizedRows"] = len(frame)
        summary["firstDate"] = str(frame["date"].iloc[0])
        summary["lastDate"] = str(frame["date"].iloc[-1])
        summary["zeroVolumeRows"] = int(frame["volume"].eq(0).sum())
        frames[asset["symbol"]] = frame
        metadata = result.get("meta", {})
        audits[asset["symbol"]] = {
            **summary,
            "providerSymbol": asset["providerSymbol"],
            "declaredVenue": asset["venue"],
            "declaredCurrency": asset["currency"],
            "declaredAssetClass": asset["assetClass"],
            "providerMetadata": {
                key: metadata.get(key)
                for key in (
                    "symbol",
                    "instrumentType",
                    "exchangeName",
                    "currency",
                    "exchangeTimezoneName",
                    "dataGranularity",
                    "longName",
                    "shortName",
                )
            },
            "rawPath": raw_path.relative_to(output).as_posix(),
            "rawSha256": sha256(raw_path),
        }

    if args.panel == "aligned":
        common = sorted(
            set.intersection(
                *(set(frame["date"]) for frame in frames.values())
            )
        )
        if not common:
            raise ValueError("assets have no common observed dates")
        for symbol in frames:
            frames[symbol] = (
                frames[symbol]
                .set_index("date")
                .loc[common]
                .reset_index()
            )

    for asset in assets:
        symbol = asset["symbol"]
        csv_path = output / f"{symbol}.csv"
        frames[symbol].to_csv(csv_path, index=False)
        audits[symbol]["outputRows"] = len(frames[symbol])
        audits[symbol]["csvPath"] = csv_path.relative_to(output).as_posix()
        audits[symbol]["csvSha256"] = sha256(csv_path)

    classes = {asset["assetClass"] for asset in assets}
    schema_version = 1 if args.panel == "aligned" else 4
    all_dates = sorted(
        set.union(*(set(frame["date"]) for frame in frames.values()))
    )
    package: dict[str, Any] = {
        "schemaVersion": schema_version,
        "kind": "autoquant-ohlcv-dataset-package",
        "id": args.dataset_id,
        "version": f"{all_dates[0]}_{all_dates[-1]}",
        "assetClass": next(iter(classes)) if len(classes) == 1 else "mixed",
        "frequency": "1d",
        "market": {
            "clock": "session",
            "calendar": args.calendar,
            "timezone": args.timezone,
        },
        "priceAdjustment": args.adjustment,
        "provider": {
            "name": "yahoo-finance-chart",
            "retrievedAt": retrieved_at,
            "sourceUri": "https://query1.finance.yahoo.com/v8/finance/chart/",
            "terms": args.terms,
        },
        "assets": [
            {
                "symbol": asset["symbol"],
                "assetClass": asset["assetClass"],
                "venue": asset["venue"],
                "currency": asset["currency"],
                "path": f"{asset['symbol']}.csv",
            }
            for asset in assets
        ],
    }
    if schema_version == 4:
        package["panelPolicy"] = {
            "alignment": "observed-only",
            "missingObservation": "absent-no-fill",
        }
    package_path = output / "dataset-package.json"
    package_path.write_text(
        json.dumps(package, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    invalid_ohlc = invalid_ohlc_summary(audits)
    transient_scale = transient_scale_summary(audits)
    audit = {
        "schemaVersion": 1,
        "kind": "autoquant-provider-acquisition-audit",
        "provider": package["provider"],
        "request": {
            "start": args.start.isoformat(),
            "endExclusive": args.end_exclusive.isoformat(),
            "interval": "1d",
            "panel": args.panel,
            "adjustment": args.adjustment,
            "invalidOhlcPolicy": args.invalid_ohlc_policy,
            "transientScalePolicy": args.transient_scale_policy,
        },
        "transformation": {
            "split-and-dividend-adjusted": (
                "adjusted-close/raw-close ratio applied to OHLC; "
                "provider volume unchanged"
            ),
            "split-adjusted": (
                "provider quote OHLCV preserved; Yahoo historical quote "
                "fields are treated as split-adjusted"
            ),
        }[args.adjustment],
        "invalidOhlc": invalid_ohlc,
        "transientScale": transient_scale,
        "assets": audits,
        "packagePath": package_path.name,
        "packageSha256": sha256(package_path),
        "limitations": [
            "Yahoo Chart is broad provider evidence, not venue authority.",
            "Provider metadata and adjustment claims are not authenticated.",
            (
                "Explicit drop-observation removes only tightly bounded "
                "provider rows with impossible OHLC geometry; it never repairs "
                "prices and every removed observation remains in the audit."
            ),
            (
                "A separate explicit transient-scale drop removes only a "
                "short price-scale island bounded by a fivefold entry/reversal "
                "and near-origin recovery; it never rescales prices and keeps "
                "every removed observation in the audit."
            ),
            "No survivorship, delisting, or official calendar claim follows.",
        ],
    }
    (output / "provider-audit.json").write_text(
        json.dumps(audit, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "datasetPackage": str(package_path),
                "retrievedAt": retrieved_at,
                "assets": len(assets),
                "panel": args.panel,
                "firstDate": all_dates[0],
                "lastDate": all_dates[-1],
                "invalidOhlc": invalid_ohlc,
                "transientScale": transient_scale,
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
