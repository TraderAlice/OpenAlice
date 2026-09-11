#!/usr/bin/env python3
"""Package generated Office route artwork into small native-size sprites."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


def package(source: Path, output: Path, canvas_size: int, fit_size: int) -> None:
    image = Image.open(source).convert("RGBA")
    bounds = image.getchannel("A").getbbox()
    if bounds is None:
        raise ValueError(f"{source} has no visible pixels")
    image = image.crop(bounds)
    scale = min(fit_size / image.width, fit_size / image.height)
    size = (
        max(1, round(image.width * scale)),
        max(1, round(image.height * scale)),
    )
    image = image.resize(size, Image.Resampling.BOX)
    alpha = image.getchannel("A").point(lambda value: 255 if value >= 72 else 0)
    image.putalpha(alpha)

    canvas = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    canvas.alpha_composite(
        image,
        ((canvas_size - image.width) // 2, (canvas_size - image.height) // 2),
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output, optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--footsteps", type=Path, required=True)
    parser.add_argument("--destination", type=Path, required=True)
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=Path("ui/public/office/furniture"),
    )
    args = parser.parse_args()

    package(args.footsteps, args.out_dir / "route-footsteps-v1.png", 12, 10)
    package(args.destination, args.out_dir / "route-destination-v1.png", 20, 18)


if __name__ == "__main__":
    main()
