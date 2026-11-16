#!/usr/bin/env python3
"""Validate repository-root-relative wiki links in Markdown documents."""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
IGNORED_PARTS = {
    ".git",
    ".pytest_cache",
    ".venv",
    "__pycache__",
    "data",
}
LINK_PATTERN = re.compile(
    r"\[\["
    r"(?P<target>[^\]|#]+)"
    r"(?:#[^\]|]+)?"
    r"(?:\|[^\]]+)?"
    r"\]\]"
)


@dataclass(frozen=True)
class LinkFailure:
    source: Path
    line: int
    target: str

    def render(self) -> str:
        return (
            f"{self.source.relative_to(ROOT)}:{self.line}: "
            f"unresolved [[{self.target}]]"
        )


def markdown_files(root: Path = ROOT) -> list[Path]:
    return sorted(
        path
        for path in root.rglob("*.md")
        if not IGNORED_PARTS.intersection(path.relative_to(root).parts)
    )


def candidate_paths(source: Path, raw_target: str) -> list[Path]:
    base = source.parent if raw_target.startswith(".") else ROOT
    unresolved = (base / raw_target).resolve()

    try:
        unresolved.relative_to(ROOT)
    except ValueError:
        return []

    if unresolved.suffix:
        return [unresolved]
    return [unresolved.with_suffix(".md"), unresolved / "README.md"]


def check_links(root: Path = ROOT) -> tuple[int, list[LinkFailure]]:
    checked = 0
    failures: list[LinkFailure] = []

    for source in markdown_files(root):
        text = source.read_text(encoding="utf-8")
        for line_number, line in enumerate(text.splitlines(), start=1):
            for match in LINK_PATTERN.finditer(line):
                target = match.group("target").strip()
                checked += 1
                if not any(path.is_file() for path in candidate_paths(source, target)):
                    failures.append(LinkFailure(source, line_number, target))

    return checked, failures


def main() -> int:
    checked, failures = check_links()
    if failures:
        for failure in failures:
            print(failure.render(), file=sys.stderr)
        return 1

    print(f"✓ {checked} documentation double-links resolve")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
