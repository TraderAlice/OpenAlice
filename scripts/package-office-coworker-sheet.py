#!/usr/bin/env python3
"""Package a transparent three-pose Office coworker sheet for the UI runtime."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


POSES = (
    ("portrait-v2", (72, 104), (66, 100)),
    ("desk-v1", (176, 176), (164, 164)),
    ("desk-work-v1", (176, 176), (164, 164)),
)


def hard_matte(image: Image.Image, threshold: int = 88) -> Image.Image:
    rgba = image.convert("RGBA")
    alpha = rgba.getchannel("A").point(lambda value: 255 if value >= threshold else 0)
    rgba.putalpha(alpha)
    return rgba


def trim_pose(sheet: Image.Image, index: int) -> Image.Image:
    left = round(sheet.width * index / 3)
    right = round(sheet.width * (index + 1) / 3)
    # Generated sheets often retain a faint alpha haze around the character.
    # Matte it before measuring so that invisible fringe cannot make the
    # packaged character look much smaller than its coworkers.
    panel = hard_matte(sheet.crop((left, 0, right, sheet.height)))
    bounds = panel.getchannel("A").getbbox()
    if bounds is None:
        raise ValueError(f"pose {index + 1} has no visible pixels")
    return panel.crop(bounds)


def fit_scale(image: Image.Image, fit_size: tuple[int, int]) -> float:
    return min(fit_size[0] / image.width, fit_size[1] / image.height)


def fit_pose(
    image: Image.Image,
    canvas_size: tuple[int, int],
    fit_size: tuple[int, int],
    scale: float | None = None,
) -> Image.Image:
    scale = fit_scale(image, fit_size) if scale is None else scale
    resized = image.resize(
        (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
        Image.Resampling.NEAREST,
    )
    resized = hard_matte(resized)
    canvas = Image.new("RGBA", canvas_size, (0, 0, 0, 0))
    x = (canvas_size[0] - resized.width) // 2
    y = canvas_size[1] - resized.height - 2
    canvas.alpha_composite(resized, (x, y))
    return canvas


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sheet", type=Path, required=True)
    parser.add_argument("--slug", required=True)
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=Path("ui/public/office/coworkers"),
    )
    args = parser.parse_args()

    sheet = Image.open(args.sheet).convert("RGBA")
    args.out_dir.mkdir(parents=True, exist_ok=True)
    poses = [trim_pose(sheet, index) for index in range(len(POSES))]
    desk_fit = POSES[1][2]
    desk_scale = min(
        desk_fit[0] / max(pose.width for pose in poses[1:]),
        desk_fit[1] / max(pose.height for pose in poses[1:]),
    )

    for index, (suffix, canvas_size, fit_size) in enumerate(POSES):
        scale = None if index == 0 else desk_scale
        packaged = fit_pose(poses[index], canvas_size, fit_size, scale)
        output = args.out_dir / f"{args.slug}-{suffix}.png"
        packaged.save(output, optimize=True)
        print(output)


if __name__ == "__main__":
    main()
