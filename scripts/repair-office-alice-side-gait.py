#!/usr/bin/env python3
"""Repair Alice's rightward Office gait from the approved leftward row."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


CELL_SIZE = 48
ATLAS_SIZE = (CELL_SIZE * 3, CELL_SIZE * 4)
LEFT_ROW = 1
RIGHT_ROW = 2


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("atlas", type=Path)
    args = parser.parse_args()

    atlas = Image.open(args.atlas).convert("RGBA")
    if atlas.size != ATLAS_SIZE:
        raise ValueError(f"expected {ATLAS_SIZE[0]}x{ATLAS_SIZE[1]} atlas, got {atlas.size}")

    for column in range(3):
        left = column * CELL_SIZE
        source = atlas.crop(
            (
                left,
                LEFT_ROW * CELL_SIZE,
                left + CELL_SIZE,
                (LEFT_ROW + 1) * CELL_SIZE,
            ),
        )
        mirrored = source.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
        atlas.paste(mirrored, (left, RIGHT_ROW * CELL_SIZE))

    atlas.save(args.atlas, optimize=True)
    print(args.atlas)


if __name__ == "__main__":
    main()
