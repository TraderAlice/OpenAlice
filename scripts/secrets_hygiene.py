#!/usr/bin/env python3
from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

from gate_common import utc_now_iso, write_json


HIGH_CONF_PATTERNS = [
    (re.compile(r"(?i)\b(openai|anthropic|api|secret|token|key)\b[^\\n]{0,40}[:=]\s*['\"]?sk-[a-zA-Z0-9]{20,}"), "openai_like_secret"),
    (re.compile(r"(?i)\baws_secret_access_key\b\s*[:=]\s*['\"]?[A-Za-z0-9/+=]{30,}"), "aws_secret_access_key"),
]


def candidate_files(repo_root: Path) -> list[Path]:
    proc = subprocess.run(
        ["git", "ls-files"],
        cwd=str(repo_root),
        text=True,
        capture_output=True,
        check=False,
    )
    if proc.returncode != 0:
        return []
    out: list[Path] = []
    for line in proc.stdout.splitlines():
        rel = line.strip()
        if not rel:
            continue
        if rel.startswith("node_modules/") or rel.startswith("logs/"):
            continue
        if rel.startswith("data/training-data/"):
            continue
        if rel.endswith(".png") or rel.endswith(".jpg") or rel.endswith(".pdf"):
            continue
        if rel == ".env":
            continue
        out.append(repo_root / rel)
    return out


def scan_repo(repo_root: Path) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    for path in candidate_files(repo_root):
        try:
            text = path.read_text(encoding="utf-8")
        except Exception:
            continue
        for regex, kind in HIGH_CONF_PATTERNS:
            for match in regex.finditer(text):
                findings.append(
                    {
                        "path": str(path),
                        "kind": kind,
                        "snippet": match.group(0)[:120],
                    }
                )
    return findings


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run high-confidence secrets hygiene scan."
    )
    parser.add_argument("--repo-root", default=".")
    parser.add_argument(
        "--output", default="data/runtime/gates/secrets_hygiene_report.json"
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    repo_root = Path(args.repo_root).resolve()
    findings = scan_repo(repo_root)
    report = {
        "generatedAt": utc_now_iso(),
        "repoRoot": str(repo_root),
        "highConfidenceFindings": findings,
        "passed": len(findings) == 0,
    }
    write_json(Path(args.output), report)
    return 0 if len(findings) == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
