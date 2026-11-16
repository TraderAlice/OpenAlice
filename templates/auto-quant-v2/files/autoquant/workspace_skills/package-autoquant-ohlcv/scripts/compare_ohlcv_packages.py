"""Compare overlapping OHLCV observations from two staged packages."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
from typing import Any

import pandas as pd


FIELDS = ("open", "high", "low", "close")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def confined(root: Path, relative: str) -> Path:
    pure = PurePosixPath(relative)
    if pure.is_absolute() or not pure.parts or ".." in pure.parts:
        raise ValueError(f"unconfined asset path: {relative}")
    path = root.joinpath(*pure.parts)
    if path.is_symlink():
        raise ValueError(f"asset path cannot be a symlink: {path}")
    resolved = path.resolve()
    root_resolved = root.resolve()
    if root_resolved not in resolved.parents or not resolved.is_file():
        raise ValueError(f"asset path escapes or is unavailable: {relative}")
    return resolved


def load_package(path: Path) -> tuple[dict[str, Any], dict[str, Path]]:
    if path.is_symlink() or not path.is_file():
        raise ValueError(f"package must be a real file: {path}")
    package = json.loads(path.read_text(encoding="utf-8"))
    if (
        not isinstance(package, dict)
        or package.get("kind") != "autoquant-ohlcv-dataset-package"
    ):
        raise ValueError(f"invalid package: {path}")
    assets = package.get("assets")
    if not isinstance(assets, list) or not assets:
        raise ValueError(f"package has no assets: {path}")
    mapped: dict[str, Path] = {}
    for item in assets:
        if not isinstance(item, dict):
            raise ValueError(f"package has invalid asset: {path}")
        symbol = item.get("symbol")
        relative = item.get("path")
        if not isinstance(symbol, str) or not isinstance(relative, str):
            raise ValueError(f"package asset lacks symbol/path: {path}")
        if symbol in mapped:
            raise ValueError(f"duplicate package symbol: {symbol}")
        mapped[symbol] = confined(path.parent, relative)
    return package, mapped


def load_frame(path: Path) -> pd.DataFrame:
    if path.suffix.lower() == ".csv":
        frame = pd.read_csv(path)
    elif path.suffix.lower() == ".parquet":
        frame = pd.read_parquet(path)
    elif path.suffix.lower() == ".feather":
        frame = pd.read_feather(path)
    else:
        raise ValueError(f"unsupported asset format: {path}")
    frame.columns = [str(column).strip().lower() for column in frame.columns]
    if "date" not in frame:
        for alias in ("timestamp", "datetime", "time"):
            if alias in frame:
                frame = frame.rename(columns={alias: "date"})
                break
    required = {"date", *FIELDS, "volume"}
    if not required.issubset(frame.columns):
        raise ValueError(f"{path}: missing comparison columns")
    frame = frame.loc[:, ["date", *FIELDS, "volume"]].copy()
    frame["date"] = pd.to_datetime(frame["date"], utc=True, errors="raise")
    for field in (*FIELDS, "volume"):
        frame[field] = pd.to_numeric(frame[field], errors="raise")
    if frame["date"].duplicated().any():
        raise ValueError(f"{path}: duplicate timestamps")
    return frame.sort_values("date").reset_index(drop=True)


def compare(
    left_path: Path,
    right_path: Path,
    *,
    price_atol: float,
    price_rtol: float,
    volume_atol: float,
    volume_rtol: float,
    mode: str = "same-semantics",
) -> dict[str, Any]:
    left, left_assets = load_package(left_path)
    right, right_assets = load_package(right_path)
    if mode not in {"same-semantics", "coverage-only"}:
        raise ValueError(f"unsupported comparison mode: {mode}")
    semantic_compatibility = (
        left.get("priceAdjustment") == right.get("priceAdjustment")
    )
    if not semantic_compatibility and mode == "same-semantics":
        raise ValueError(
            "packages have different priceAdjustment claims: "
            f"{left.get('priceAdjustment')!r} vs "
            f"{right.get('priceAdjustment')!r}"
        )
    symbols = sorted(set(left_assets) & set(right_assets))
    if not symbols:
        raise ValueError("packages have no common symbols")
    summaries: dict[str, Any] = {}
    all_common_dates: set[pd.Timestamp] | None = None
    for symbol in symbols:
        left_frame = load_frame(left_assets[symbol])
        right_frame = load_frame(right_assets[symbol])
        merged = left_frame.merge(
            right_frame,
            on="date",
            how="outer",
            suffixes=("_left", "_right"),
            indicator=True,
        )
        overlap = merged.loc[merged["_merge"] == "both"].copy()
        if overlap.empty:
            raise ValueError(f"{symbol}: no overlapping observations")
        common_dates = set(overlap["date"])
        all_common_dates = (
            common_dates
            if all_common_dates is None
            else all_common_dates & common_dates
        )
        coverage = {
            "leftRows": len(left_frame),
            "rightRows": len(right_frame),
            "overlapRows": len(overlap),
            "leftOnlyRows": int((merged["_merge"] == "left_only").sum()),
            "rightOnlyRows": int((merged["_merge"] == "right_only").sum()),
            "leftFirst": left_frame["date"].iloc[0].isoformat(),
            "leftLast": left_frame["date"].iloc[-1].isoformat(),
            "rightFirst": right_frame["date"].iloc[0].isoformat(),
            "rightLast": right_frame["date"].iloc[-1].isoformat(),
            "firstOverlap": overlap["date"].iloc[0].isoformat(),
            "lastOverlap": overlap["date"].iloc[-1].isoformat(),
            "leftZeroVolumeRows": int(left_frame["volume"].eq(0).sum()),
            "rightZeroVolumeRows": int(right_frame["volume"].eq(0).sum()),
        }
        if mode == "coverage-only":
            summaries[symbol] = {
                **coverage,
                "pricesCompared": False,
                "volumeCompared": False,
            }
            continue
        price_fields: dict[str, Any] = {}
        for field in FIELDS:
            left_values = overlap[f"{field}_left"]
            right_values = overlap[f"{field}_right"]
            absolute = (left_values - right_values).abs()
            scale = pd.concat(
                [left_values.abs(), right_values.abs()],
                axis=1,
            ).max(axis=1)
            tolerance = price_atol + price_rtol * scale
            relative = absolute / scale.where(scale.ne(0), 1.0)
            price_fields[field] = {
                "mismatchRows": int(absolute.gt(tolerance).sum()),
                "maximumAbsoluteDifference": float(absolute.max()),
                "maximumRelativeDifference": float(relative.max()),
                "meanAbsoluteDifference": float(absolute.mean()),
                "largestDifferences": [
                    {
                        "date": row["date"].isoformat(),
                        "left": float(row[f"{field}_left"]),
                        "right": float(row[f"{field}_right"]),
                        "absoluteDifference": float(row["absolute"]),
                    }
                    for _, row in (
                        overlap.assign(absolute=absolute)
                        .nlargest(3, "absolute")
                        .iterrows()
                    )
                ],
            }

        left_volume = overlap["volume_left"]
        right_volume = overlap["volume_right"]
        volume_scale = pd.concat(
            [left_volume.abs(), right_volume.abs()],
            axis=1,
        ).max(axis=1)
        volume_difference = (left_volume - right_volume).abs()
        comparable = volume_scale.gt(0)
        ratio_rows = left_volume.gt(0) & right_volume.gt(0)
        summaries[symbol] = {
            **coverage,
            "pricesCompared": True,
            "volumeCompared": True,
            "prices": price_fields,
            "volume": {
                "mismatchRows": int(
                    (
                        comparable
                        & volume_difference.gt(
                            volume_atol + volume_rtol * volume_scale
                        )
                    ).sum()
                ),
                "maximumAbsoluteDifference": float(volume_difference.max()),
                "maximumRelativeDifference": (
                    float(
                        (
                            volume_difference[comparable]
                            / volume_scale[comparable]
                        ).max()
                    )
                    if comparable.any()
                    else None
                ),
                "leftToRightMedianRatio": (
                    float(
                        (
                            left_volume[ratio_rows]
                            / right_volume[ratio_rows]
                        ).median()
                    )
                    if ratio_rows.any()
                    else None
                ),
                "leftZeroRows": int(left_volume.eq(0).sum()),
                "rightZeroRows": int(right_volume.eq(0).sum()),
                "largestDifferences": [
                    {
                        "date": row["date"].isoformat(),
                        "left": float(row["volume_left"]),
                        "right": float(row["volume_right"]),
                        "absoluteDifference": float(row["absolute"]),
                    }
                    for _, row in (
                        overlap.assign(absolute=volume_difference)
                        .nlargest(3, "absolute")
                        .iterrows()
                    )
                ],
            },
        }
    assert all_common_dates is not None
    return {
        "schemaVersion": 1,
        "kind": "autoquant-ohlcv-source-comparison",
        "left": {
            "package": str(left_path),
            "packageSha256": sha256(left_path),
            "datasetId": left.get("id"),
            "provider": left.get("provider"),
        },
        "right": {
            "package": str(right_path),
            "packageSha256": sha256(right_path),
            "datasetId": right.get("id"),
            "provider": right.get("provider"),
        },
        "mode": mode,
        "semanticCompatibility": semantic_compatibility,
        "pricesCompared": mode == "same-semantics",
        "volumeCompared": mode == "same-semantics",
        "priceAdjustment": (
            left.get("priceAdjustment") if semantic_compatibility else None
        ),
        "priceAdjustmentClaims": {
            "left": left.get("priceAdjustment"),
            "right": right.get("priceAdjustment"),
        },
        "thresholds": {
            "priceAbsolute": price_atol,
            "priceRelative": price_rtol,
            "volumeAbsolute": volume_atol,
            "volumeRelative": volume_rtol,
        },
        "commonSymbols": symbols,
        "symbolsOnlyLeft": sorted(set(left_assets) - set(right_assets)),
        "symbolsOnlyRight": sorted(set(right_assets) - set(left_assets)),
        "commonPanelDates": len(all_common_dates),
        "assets": summaries,
        "limitations": [
            "Cross-provider agreement is consistency evidence, not venue truth.",
            "Different corporate-action, rounding, and volume policies can be legitimate.",
            *(
                [
                    "Coverage-only mode compares dates and row availability, not numerical prices or volume."
                ]
                if mode == "coverage-only"
                else []
            ),
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--left", type=Path, required=True)
    parser.add_argument("--right", type=Path, required=True)
    parser.add_argument("--price-atol", type=float, default=0.011)
    parser.add_argument("--price-rtol", type=float, default=1e-6)
    parser.add_argument("--volume-atol", type=float, default=100.0)
    parser.add_argument("--volume-rtol", type=float, default=1e-9)
    parser.add_argument(
        "--mode",
        choices=("same-semantics", "coverage-only"),
        default="same-semantics",
    )
    parser.add_argument("--write-audit", type=Path)
    args = parser.parse_args()
    if min(
        args.price_atol,
        args.price_rtol,
        args.volume_atol,
        args.volume_rtol,
    ) < 0:
        parser.error("comparison tolerances must be nonnegative")
    result = compare(
        args.left.expanduser().absolute(),
        args.right.expanduser().absolute(),
        price_atol=args.price_atol,
        price_rtol=args.price_rtol,
        volume_atol=args.volume_atol,
        volume_rtol=args.volume_rtol,
        mode=args.mode,
    )
    rendered = json.dumps(result, indent=2, sort_keys=True) + "\n"
    if args.write_audit:
        output = args.write_audit.expanduser().absolute()
        if output.exists() or output.is_symlink():
            parser.error(f"--write-audit target already exists: {output}")
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(rendered, encoding="utf-8")
    print(rendered, end="")


if __name__ == "__main__":
    main()
