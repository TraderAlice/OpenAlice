from __future__ import annotations

import contextlib
import io
import sys
import unittest
from unittest import mock

from autoquant.python_runner import interpreter_command, main


class PythonRunnerTests(unittest.TestCase):
    def test_interpreter_command_uses_the_harness_python(self) -> None:
        self.assertEqual(
            interpreter_command(["script.py", "--flag"]),
            [sys.executable, "script.py", "--flag"],
        )

    def test_main_requires_a_python_target(self) -> None:
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            self.assertEqual(main([]), 2)
        self.assertIn("usage: aq-python", stderr.getvalue())

    def test_main_executes_with_the_harness_python(self) -> None:
        with mock.patch("autoquant.python_runner.os.execv") as execv:
            self.assertEqual(main(["script.py", "--flag"]), 1)
        execv.assert_called_once_with(
            sys.executable,
            [sys.executable, "script.py", "--flag"],
        )


if __name__ == "__main__":
    unittest.main()
