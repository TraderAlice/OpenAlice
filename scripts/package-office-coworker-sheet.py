#!/usr/bin/env python3
"""Package a transparent three-pose Office coworker sheet for the UI runtime."""

from __future__ import annotations

import argparse
from collections import deque
from pathlib import Path

from PIL import Image


POSES = (
    ("portrait-v2", (72, 104), (66, 100)),
    ("desk-v1", (176, 176), (164, 164)),
    ("desk-work-v1", (176, 176), (164, 164)),
)


def remove_baked_checkerboard(image: Image.Image) -> Image.Image:
    """Turn an edge-connected neutral checkerboard into real transparency."""
    rgba = image.convert("RGBA")
    if rgba.getchannel("A").getextrema()[0] < 255:
        return rgba

    pixels = rgba.load()
    width, height = rgba.size

    def is_background(x: int, y: int) -> bool:
        red, green, blue, _alpha = pixels[x, y]
        return min(red, green, blue) >= 235 and max(red, green, blue) - min(red, green, blue) <= 10

    queue: deque[tuple[int, int]] = deque()
    visited: set[tuple[int, int]] = set()
    for x in range(width):
        queue.extend(((x, 0), (x, height - 1)))
    for y in range(height):
        queue.extend(((0, y), (width - 1, y)))

    while queue:
        x, y = queue.popleft()
        if (x, y) in visited or not is_background(x, y):
            continue
        visited.add((x, y))
        red, green, blue, _alpha = pixels[x, y]
        pixels[x, y] = (red, green, blue, 0)
        if x > 0:
            queue.append((x - 1, y))
        if x + 1 < width:
            queue.append((x + 1, y))
        if y > 0:
            queue.append((x, y - 1))
        if y + 1 < height:
            queue.append((x, y + 1))

    return rgba


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

    sheet = remove_baked_checkerboard(Image.open(args.sheet))
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
