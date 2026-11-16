from __future__ import annotations

import ast
import json
import re
import subprocess
import sys
import tarfile
import tempfile
import tomllib
import unittest
import zipfile
from pathlib import Path

from hatch_build import resolve_build_identity
from autoquant.runs import harness_identity
from autoquant.studio import STUDIO_MANAGED_PORT_NAMES
from autoquant.version import current_build_identity, current_version


PROJECT_DIR = Path(__file__).resolve().parents[1]


class VersionContractTests(unittest.TestCase):
    def test_manifest_readme_package_cli_and_runs_agree(self) -> None:
        package_version = tomllib.loads(
            (PROJECT_DIR / "pyproject.toml").read_text(encoding="utf-8")
        )["project"]["version"]
        readme = (PROJECT_DIR / "README.md").read_text(encoding="utf-8")
        match = re.match(
            r"\A---\s*\n.*?^version:\s*[\"']?([^\"'\s]+)[\"']?\s*$.*?^---\s*$",
            readme,
            flags=re.MULTILINE | re.DOTALL,
        )

        self.assertIsNotNone(match, "README must start with version frontmatter")
        self.assertEqual(match.group(1), package_version)
        self.assertEqual(current_version(), package_version)
        self.assertEqual(harness_identity()["version"], package_version)
        harness_manifest = json.loads(
            (PROJECT_DIR / "harness.json").read_text(encoding="utf-8")
        )
        self.assertEqual(
            harness_manifest,
            {
                "manifestVersion": 1,
                "version": package_version,
                "capabilities": {
                    "studio": {
                        "command": [
                            "uv",
                            "run",
                            "--frozen",
                            "--no-sync",
                            "aq",
                            "studio",
                            "serve",
                            ".",
                            "--no-open",
                        ],
                        "ports": ["http"],
                        "entryPort": "http",
                        "readinessPath": "/api/v1/health",
                    }
                },
            },
        )
        self.assertEqual(
            set(harness_manifest["capabilities"]["studio"]["ports"]),
            STUDIO_MANAGED_PORT_NAMES,
        )

        cli = subprocess.run(
            [sys.executable, "-m", "autoquant", "--version"],
            cwd=PROJECT_DIR,
            capture_output=True,
            check=False,
            text=True,
        )
        self.assertEqual(cli.returncode, 0, cli.stderr)
        self.assertEqual(cli.stdout.strip(), f"aq {package_version}")

        exact = subprocess.run(
            [sys.executable, "-m", "autoquant", "version", "--json"],
            cwd=PROJECT_DIR,
            capture_output=True,
            check=False,
            text=True,
        )
        self.assertEqual(exact.returncode, 0, exact.stderr)
        payload = json.loads(exact.stdout)
        self.assertEqual(payload["data"]["harness"], harness_identity())
        self.assertEqual(
            payload["data"]["harness"]["buildProvenance"],
            current_build_identity()["provenance"],
        )

    def test_build_identity_uses_only_exact_root_and_relevant_dirty_state(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory) / "parent"
            source = parent / "source"
            (source / "autoquant").mkdir(parents=True)
            (source / "autoquant" / "runtime.py").write_text("VALUE = 1\n")
            (source / "pyproject.toml").write_text("[project]\nname='probe'\n")
            (source / "uv.lock").write_text("version = 1\n")
            (source / "hatch_build.py").write_text("# build\n")
            subprocess.run(["git", "init", "-q"], cwd=source, check=True)
            subprocess.run(["git", "add", "."], cwd=source, check=True)
            subprocess.run(
                [
                    "git",
                    "-c",
                    "user.name=AutoQuant Test",
                    "-c",
                    "user.email=autoquant@example.invalid",
                    "commit",
                    "-qm",
                    "initial",
                ],
                cwd=source,
                check=True,
            )
            expected_commit = subprocess.run(
                ["git", "rev-parse", "HEAD"],
                cwd=source,
                capture_output=True,
                check=True,
                text=True,
            ).stdout.strip()
            self.assertEqual(resolve_build_identity(source), (expected_commit, False))

            (source / "README.md").write_text("unpackaged docs\n")
            self.assertEqual(resolve_build_identity(source), (expected_commit, False))
            (source / "autoquant" / "runtime.py").write_text("VALUE = 2\n")
            self.assertEqual(resolve_build_identity(source), (expected_commit, True))

            nested = source / "nested-archive"
            nested.mkdir()
            self.assertEqual(resolve_build_identity(nested), ("unavailable", False))

    def test_sdist_wheel_and_parent_repo_install_preserve_build_identity(self) -> None:
        expected = resolve_build_identity(PROJECT_DIR)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            first_dist = root / "dist"
            build = subprocess.run(
                ["uv", "build", "--out-dir", str(first_dist)],
                cwd=PROJECT_DIR,
                capture_output=True,
                check=False,
                text=True,
            )
            self.assertEqual(build.returncode, 0, build.stderr)
            sdist = next(first_dist.glob("auto_quant-*.tar.gz"))
            wheel = next(first_dist.glob("auto_quant-*.whl"))

            with tarfile.open(sdist) as archive:
                identity_member = next(
                    member
                    for member in archive.getmembers()
                    if member.name.endswith("/autoquant/_build_identity.py")
                )
                sdist_source = archive.extractfile(identity_member)
                self.assertIsNotNone(sdist_source)
                sdist_identity = self._identity_from_source(
                    sdist_source.read().decode("utf-8")
                )
                self.assertTrue(
                    any(
                        member.name.endswith("/hatch_build.py")
                        for member in archive.getmembers()
                    )
                )
            self.assertEqual(sdist_identity, expected)
            self.assertEqual(self._wheel_identity(wheel), expected)

            rebuilt_dist = root / "rebuilt"
            rebuilt = subprocess.run(
                [
                    "uv",
                    "build",
                    "--wheel",
                    "--out-dir",
                    str(rebuilt_dist),
                    str(sdist),
                ],
                cwd=root,
                capture_output=True,
                check=False,
                text=True,
            )
            self.assertEqual(rebuilt.returncode, 0, rebuilt.stderr)
            rebuilt_wheel = next(rebuilt_dist.glob("auto_quant-*.whl"))
            self.assertEqual(self._wheel_identity(rebuilt_wheel), expected)

            parent_repo = root / "consumer"
            parent_repo.mkdir()
            subprocess.run(["git", "init", "-q"], cwd=parent_repo, check=True)
            venv = parent_repo / ".venv"
            subprocess.run(
                ["uv", "venv", "--python", "3.11", str(venv)],
                cwd=parent_repo,
                check=True,
                capture_output=True,
                text=True,
            )
            subprocess.run(
                [
                    "uv",
                    "pip",
                    "install",
                    "--no-deps",
                    "--python",
                    str(venv / "bin/python"),
                    str(rebuilt_wheel),
                ],
                cwd=parent_repo,
                check=True,
                capture_output=True,
                text=True,
            )
            observed = subprocess.run(
                [
                    str(venv / "bin/python"),
                    "-c",
                    (
                        "import json; from autoquant.version import "
                        "current_build_identity; "
                        "print(json.dumps(current_build_identity()))"
                    ),
                ],
                cwd=parent_repo,
                capture_output=True,
                check=True,
                text=True,
            )
            self.assertEqual(
                json.loads(observed.stdout),
                {
                    "commit": expected[0],
                    "dirty": expected[1],
                    "provenance": "embedded-distribution",
                },
            )

    @staticmethod
    def _identity_from_source(source: str) -> tuple[str, bool]:
        values: dict[str, object] = {}
        for node in ast.parse(source).body:
            if (
                isinstance(node, ast.Assign)
                and len(node.targets) == 1
                and isinstance(node.targets[0], ast.Name)
            ):
                values[node.targets[0].id] = ast.literal_eval(node.value)
        return str(values["BUILD_COMMIT"]), bool(values["BUILD_DIRTY"])

    @classmethod
    def _wheel_identity(cls, wheel: Path) -> tuple[str, bool]:
        with zipfile.ZipFile(wheel) as archive:
            source = archive.read("autoquant/_build_identity.py").decode("utf-8")
        return cls._identity_from_source(source)


if __name__ == "__main__":
    unittest.main()
