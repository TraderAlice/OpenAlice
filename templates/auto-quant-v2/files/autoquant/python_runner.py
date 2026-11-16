"""Run a Python command with the interpreter that owns the AutoQuant install."""

from __future__ import annotations

import os
import sys
from collections.abc import Sequence


def interpreter_command(arguments: Sequence[str]) -> list[str]:
    """Return the exact Python command owned by the installed Harness."""

    return [sys.executable, *arguments]


def main(argv: Sequence[str] | None = None) -> int:
    """Replace this process with the owning Python interpreter."""

    arguments = list(argv if argv is not None else sys.argv[1:])
    if not arguments:
        print(
            "usage: aq-python <python-script-or-option> [arguments ...]",
            file=sys.stderr,
        )
        return 2
    command = interpreter_command(arguments)
    os.execv(command[0], command)
    return 1
