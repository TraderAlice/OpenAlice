from __future__ import annotations

import re
import subprocess
import sys
import unittest
from pathlib import Path


PROJECT_DIR = Path(__file__).resolve().parents[1]


class DocumentationTests(unittest.TestCase):
    def test_repository_double_links_resolve(self) -> None:
        result = subprocess.run(
            [sys.executable, "scripts/check_doc_links.py"],
            cwd=PROJECT_DIR,
            capture_output=True,
            check=False,
            text=True,
        )

        self.assertEqual(
            result.returncode,
            0,
            result.stderr or result.stdout,
        )
        self.assertIn("documentation double-links resolve", result.stdout)

    def test_release_document_ownership_does_not_drift(self) -> None:
        readme = (PROJECT_DIR / "README.md").read_text(encoding="utf-8")
        operator_guide = (
            PROJECT_DIR / "docs" / "OPERATOR_GUIDE.md"
        ).read_text(encoding="utf-8")
        status = (PROJECT_DIR / "docs" / "STATUS.md").read_text(
            encoding="utf-8"
        )
        changelog = (PROJECT_DIR / "docs" / "CHANGELOG.md").read_text(
            encoding="utf-8"
        )
        agents = (PROJECT_DIR / "AGENTS.md").read_text(encoding="utf-8")

        self.assertEqual(
            len(
                re.findall(
                    r"^## Current release(?: candidate)?:",
                    readme,
                    re.MULTILINE,
                )
            ),
            1,
        )
        self.assertNotRegex(
            readme,
            re.compile(r"^#{2,}\s+`?v?0\.\d+\.\d+`?\s*$", re.MULTILINE),
        )
        self.assertLessEqual(
            len(readme.splitlines()),
            220,
            "README is a bounded entrance; route detail to canonical docs",
        )
        for detailed_heading in (
            "Start from a real research request",
            "Acquire and bind data",
            "Research loop",
            "Evidence and deliverables",
            "Required release audit",
            "Publish order",
        ):
            self.assertNotRegex(
                readme,
                re.compile(
                    rf"^##\s+{re.escape(detailed_heading)}\s*$",
                    re.MULTILINE,
                ),
            )
        for operator_heading in (
            "Enter the Workspace",
            "Start a real assignment",
            "Acquire and bind data",
            "Work with Factors, Portfolios, and governed RL",
            "Read and publish evidence",
            "Observe with Studio",
        ):
            self.assertRegex(
                operator_guide,
                re.compile(
                    rf"^##\s+{re.escape(operator_heading)}\s*$",
                    re.MULTILINE,
                ),
            )
        self.assertNotRegex(
            status,
            re.compile(
                r"^#{2,}.*(?:v0\.\d+\.\d+|verification snapshot)",
                re.MULTILINE,
            ),
        )
        self.assertRegex(
            changelog,
            re.compile(r"^\| `v0\.9\.24` \|", re.MULTILINE),
        )
        self.assertIn("[[docs/CHANGELOG]]", agents[:5000])
        self.assertIn("[[docs/OPERATOR_GUIDE]]", agents[:5000])
        self.assertIn("[[docs/design/versioning-and-release]]", agents[:5000])


if __name__ == "__main__":
    unittest.main()
