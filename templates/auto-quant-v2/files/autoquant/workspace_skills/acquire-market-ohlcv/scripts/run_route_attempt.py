"""Run one provider route and preserve a standard failure audit on error."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Sequence


def failure_record(
    provider: str,
    *,
    exit_code: int,
    stdout: str,
    stderr: str,
    executable: str,
) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "kind": "autoquant-provider-route-failure",
        "status": "failed",
        "provider": provider,
        "attemptedAt": datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat(),
        "exitCode": exit_code,
        "executable": Path(executable).name,
        "stdoutTail": stdout[-4000:],
        "stderrTail": stderr[-4000:],
        "limitations": [
            "This record proves the local route process failed; it does not prove the provider was globally unavailable."
        ],
    }


def run_route(
    provider: str,
    audit_path: Path,
    command: Sequence[str],
) -> int:
    if not command:
        raise ValueError("provider command is required after --")
    if audit_path.exists() or audit_path.is_symlink():
        raise ValueError(f"failure audit already exists: {audit_path}")
    try:
        completed = subprocess.run(
            list(command),
            capture_output=True,
            check=False,
            text=True,
        )
        exit_code = completed.returncode
        stdout = completed.stdout
        stderr = completed.stderr
    except OSError as error:
        exit_code = 127
        stdout = ""
        stderr = f"{type(error).__name__}: {error}"
    sys.stdout.write(stdout)
    sys.stderr.write(stderr)
    if exit_code == 0:
        return 0
    audit_path.parent.mkdir(parents=True, exist_ok=True)
    audit_path.write_text(
        json.dumps(
            failure_record(
                provider,
                exit_code=exit_code,
                stdout=stdout,
                stderr=stderr,
                executable=command[0],
            ),
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )
    return exit_code


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--provider", required=True)
    parser.add_argument("--write-failure", type=Path, required=True)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    try:
        exit_code = run_route(
            args.provider.strip(),
            args.write_failure.expanduser().absolute(),
            command,
        )
    except ValueError as error:
        parser.error(str(error))
    raise SystemExit(exit_code)


if __name__ == "__main__":
    main()
