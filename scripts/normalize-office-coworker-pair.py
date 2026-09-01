#!/usr/bin/env python3
"""Normalize an existing Office coworker's idle/work pair to one visual scale."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


CANVAS_SIZE = (176, 176)
FIT_SIZE = (164, 164)


def hard_matte(image: Image.Image, threshold: int = 88) -> Image.Image:
    rgba = image.convert("RGBA")
    alpha = rgba.getchannel("A").point(lambda value: 255 if value >= threshold else 0)
    rgba.putalpha(alpha)
    return rgba


def trim_visible(image: Image.Image) -> Image.Image:
    matte = hard_matte(image)
    bounds = matte.getchannel("A").getbbox()
    if bounds is None:
        raise ValueError("pose has no visible pixels")
    return matte.crop(bounds)


def compose(pose: Image.Image, scale: float) -> Image.Image:
    resized = pose.resize(
        (max(1, round(pose.width * scale)), max(1, round(pose.height * scale))),
        Image.Resampling.NEAREST,
    )
    resized = hard_matte(resized)
    canvas = Image.new("RGBA", CANVAS_SIZE, (0, 0, 0, 0))
    x = (CANVAS_SIZE[0] - resized.width) // 2
    y = CANVAS_SIZE[1] - resized.height - 2
    canvas.alpha_composite(resized, (x, y))
    return canvas


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--slug", required=True)
    parser.add_argument(
        "--asset-dir",
        type=Path,
        default=Path("ui/public/office/coworkers"),
    )
    args = parser.parse_args()

    paths = (
        args.asset_dir / f"{args.slug}-desk-v1.png",
        args.asset_dir / f"{args.slug}-desk-work-v1.png",
    )
    poses = [trim_visible(Image.open(path)) for path in paths]
    scale = min(
        FIT_SIZE[0] / max(pose.width for pose in poses),
        FIT_SIZE[1] / max(pose.height for pose in poses),
    )

    for path, pose in zip(paths, poses):
        compose(pose, scale).save(path, optimize=True)
        print(path)


if __name__ == "__main__":
    main()
