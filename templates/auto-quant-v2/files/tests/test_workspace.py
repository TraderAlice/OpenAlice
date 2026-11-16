from __future__ import annotations

import json
import tempfile
import unittest
from importlib import resources
from pathlib import Path

from autoquant.templates import PROJECT_TEMPLATE_IDS
from autoquant.workspace import (
    PROJECT_MANIFEST,
    WORKSPACE_LOCAL_MANIFEST,
    WORKSPACE_MANIFEST,
    AutoQuantValidationError,
    create_project,
    initialize_workspace,
    list_workspace_projects,
    load_project,
    load_workspace,
    resolve_project_directory,
    set_default_project,
)


class WorkspaceProjectTests(unittest.TestCase):
    def _write_local_workspace(
        self,
        root: Path,
        projects_directory: str,
        *,
        default_project: str | None,
    ) -> Path:
        path = root / WORKSPACE_LOCAL_MANIFEST
        path.write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "name": "Local Development Desk",
                    "projects_directory": projects_directory,
                    "default_project": default_project,
                }
            ),
            encoding="utf-8",
        )
        return path

    def test_workspace_resolves_default_and_explicit_isolated_projects(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace = initialize_workspace(directory, name="Research Desk")
            first = create_project(
                workspace.root_dir,
                "factor-lab",
                name="Factor Lab",
                description="Mine robust factors",
            )
            second = create_project(workspace.root_dir, "ml-lab", name="ML Lab")

            projects = list_workspace_projects(workspace.root_dir)
            self.assertEqual([item.id for item in projects], ["factor-lab", "ml-lab"])
            self.assertTrue(projects[0].is_default)
            self.assertEqual(
                resolve_project_directory(workspace.root_dir),
                first.root_dir,
            )
            self.assertEqual(
                resolve_project_directory(workspace.root_dir, "ml-lab"),
                second.root_dir,
            )

            set_default_project(workspace.root_dir, "ml-lab")
            self.assertEqual(
                resolve_project_directory(workspace.root_dir),
                second.root_dir,
            )
            self.assertNotEqual(first.root_dir, second.root_dir)
            (first.root_dir / "factors" / "alpha.py").write_text("ALPHA = 1\n")
            self.assertFalse((second.root_dir / "factors" / "alpha.py").exists())

    def test_workspace_adoption_preserves_pre_staged_caller_files(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "workspace"
            raw = root / "staging" / "raw-ohlcv"
            raw.mkdir(parents=True)
            source = raw / "NVDA.csv"
            source.write_bytes(b"timestamp,close\n2026-07-30,100\n")
            request = root / "staging" / "research-request.json"
            request.write_bytes(b'{"caller":"preserved"}\n')
            source_before = source.read_bytes()
            request_before = request.read_bytes()

            with self.assertRaises(AutoQuantValidationError) as caught:
                initialize_workspace(root)
            self.assertEqual(
                {issue.code for issue in caught.exception.issues},
                {"path.not-empty"},
            )
            self.assertIn(
                "--adopt-existing",
                str(caught.exception),
            )
            self.assertIn(
                "staging outside",
                str(caught.exception),
            )
            self.assertFalse((root / WORKSPACE_MANIFEST).exists())
            self.assertFalse((root / "projects").exists())

            workspace = initialize_workspace(
                root,
                name="Adopted Desk",
                adopt_existing=True,
            )

            self.assertEqual(workspace.manifest.name, "Adopted Desk")
            self.assertEqual(source.read_bytes(), source_before)
            self.assertEqual(request.read_bytes(), request_before)
            self.assertEqual(
                {path.name for path in root.iterdir()},
                {
                    ".agents",
                    ".claude",
                    "autoquant-skills.json",
                    "autoquant-workspace.json",
                    "projects",
                    "staging",
                },
            )
            self.assertEqual(list(workspace.projects_dir.iterdir()), [])

    def test_workspace_adoption_rejects_owned_path_conflicts_without_mutation(
        self,
    ) -> None:
        conflict_cases = (
            (WORKSPACE_MANIFEST, "workspace.adopt-configuration", "file"),
            (
                WORKSPACE_LOCAL_MANIFEST,
                "workspace.adopt-configuration",
                "file",
            ),
            ("projects", "workspace.adopt-projects", "file"),
            ("projects", "workspace.adopt-projects", "directory"),
            ("projects", "workspace.adopt-projects", "symlink"),
        )
        for name, expected_code, kind in conflict_cases:
            with self.subTest(name=name, kind=kind):
                with (
                    tempfile.TemporaryDirectory() as directory,
                    tempfile.TemporaryDirectory() as outside,
                ):
                    root = Path(directory) / "workspace"
                    root.mkdir()
                    caller = root / "caller-input.bin"
                    caller.write_bytes(b"\x00caller-owned\xff")
                    conflict = root / name
                    if kind == "directory":
                        conflict.mkdir()
                        (conflict / "sentinel").write_bytes(b"project")
                    elif kind == "symlink":
                        outside_path = Path(outside)
                        (outside_path / "sentinel").write_bytes(b"outside")
                        conflict.symlink_to(
                            outside_path,
                            target_is_directory=True,
                        )
                    else:
                        conflict.write_bytes(b"pre-existing")
                    caller_before = caller.read_bytes()

                    with self.assertRaises(
                        AutoQuantValidationError
                    ) as caught:
                        initialize_workspace(
                            root,
                            adopt_existing=True,
                        )

                    self.assertEqual(
                        {issue.code for issue in caught.exception.issues},
                        {expected_code},
                    )
                    self.assertEqual(caller.read_bytes(), caller_before)
                    if name != WORKSPACE_MANIFEST:
                        self.assertFalse(
                            (root / WORKSPACE_MANIFEST).exists()
                        )
                    if kind == "directory":
                        self.assertEqual(
                            (conflict / "sentinel").read_bytes(),
                            b"project",
                        )
                    elif kind == "symlink":
                        self.assertTrue(conflict.is_symlink())
                        self.assertEqual(
                            (Path(outside) / "sentinel").read_bytes(),
                            b"outside",
                        )
                    else:
                        self.assertEqual(
                            conflict.read_bytes(),
                            b"pre-existing",
                        )

    def test_workspace_adoption_rejects_file_and_symlink_roots(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory)
            target_file = parent / "workspace-file"
            target_file.write_bytes(b"caller")
            with self.assertRaises(AutoQuantValidationError) as caught:
                initialize_workspace(
                    target_file,
                    adopt_existing=True,
                )
            self.assertEqual(
                {issue.code for issue in caught.exception.issues},
                {"path.not-directory"},
            )
            self.assertEqual(target_file.read_bytes(), b"caller")

            real = parent / "real"
            real.mkdir()
            link = parent / "workspace-link"
            link.symlink_to(real, target_is_directory=True)
            with self.assertRaises(AutoQuantValidationError) as caught:
                initialize_workspace(
                    link,
                    adopt_existing=True,
                )
            self.assertEqual(
                {issue.code for issue in caught.exception.issues},
                {"path.symlink"},
            )
            self.assertTrue(link.is_symlink())

    def test_created_project_is_a_complete_self_contained_construction_site(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace = initialize_workspace(directory)
            project = create_project(
                workspace.root_dir,
                "equity-research",
                description="Study session-market behavior",
            )

            self.assertTrue((project.root_dir / PROJECT_MANIFEST).is_file())
            self.assertIn(
                "Study session-market behavior",
                (project.root_dir / "research.md").read_text(),
            )
            research = (project.root_dir / "research.md").read_text()
            normalized_research = " ".join(research.split())
            self.assertIn("## Research brief and clarification", research)
            self.assertIn(
                "English is the internal working language of the AutoQuant desk",
                normalized_research,
            )
            self.assertIn(
                "ask the delegating Agent or user",
                normalized_research,
            )
            framework_needs = (
                project.root_dir / "framework-needs.md"
            ).read_text(encoding="utf-8")
            self.assertIn("## Open needs", framework_needs)
            self.assertIn(
                "Do not file speculative feature wishes",
                framework_needs,
            )
            for relative in project.manifest.directories.values():
                self.assertTrue((project.root_dir / relative).is_dir(), relative)
            self.assertEqual(
                (project.root_dir / "data" / ".gitignore").read_text(),
                "*\n!.gitignore\n",
            )
            self.assertEqual(
                (project.root_dir / ".autoquant" / ".gitignore").read_text(),
                "*\n!.gitignore\n",
            )

    def test_every_builtin_template_requires_the_same_research_start_gate(
        self,
    ) -> None:
        template_root = resources.files("autoquant").joinpath("project_templates")
        iterative_templates = {
            "ohlcv-factor-lab",
            "ohlcv-portfolio-lab",
            "ohlcv-rl-factor-lab",
            "ohlcv-research-desk",
        }
        for template in PROJECT_TEMPLATE_IDS:
            if template == "blank":
                continue
            with self.subTest(template=template):
                research = (
                    template_root
                    .joinpath(template.replace("-", "_"))
                    .joinpath("research.md")
                    .read_text(encoding="utf-8")
                )
                normalized_research = " ".join(research.split())
                self.assertIn("## Research brief and clarification", research)
                self.assertIn(
                    "English is the internal working language of the AutoQuant desk",
                    normalized_research,
                )
                self.assertIn(
                    "ask the delegating Agent or user",
                    normalized_research,
                )
                if template in iterative_templates:
                    self.assertIn(
                        "--request request.json",
                        research,
                    )

    def test_framework_needs_is_required_real_project_state(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace = initialize_workspace(directory)
            project = create_project(workspace.root_dir, "needs-audit")
            needs = project.root_dir / "framework-needs.md"
            needs.unlink()

            with self.assertRaises(AutoQuantValidationError) as caught:
                load_project(project.root_dir)

            self.assertIn(
                "project.framework-needs",
                {issue.code for issue in caught.exception.issues},
            )

    def test_workspace_projects_directory_cannot_escape_or_be_a_symlink(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            initialize_workspace(root)
            manifest_path = root / WORKSPACE_MANIFEST
            manifest = json.loads(manifest_path.read_text())
            manifest["projects_directory"] = "../outside"
            manifest_path.write_text(json.dumps(manifest))
            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "confined POSIX relative path",
            ):
                load_workspace(root)

        with (
            tempfile.TemporaryDirectory() as directory,
            tempfile.TemporaryDirectory() as outside,
        ):
            root = Path(directory)
            initialize_workspace(root)
            projects = root / "projects"
            projects.rmdir()
            projects.symlink_to(Path(outside), target_is_directory=True)
            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "cannot be symlinks",
            ):
                load_workspace(root)

    def test_local_configuration_can_select_external_projects_and_owns_writes(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            workspace = initialize_workspace(root / "repository")
            external = initialize_workspace(root / "external")
            create_project(external.root_dir, "existing-project")
            base_before = (workspace.root_dir / WORKSPACE_MANIFEST).read_text()
            local_path = self._write_local_workspace(
                workspace.root_dir,
                "../external/projects",
                default_project="existing-project",
            )

            selected = load_workspace(workspace.root_dir)
            self.assertEqual(selected.configuration_source, "local-override")
            self.assertEqual(selected.configuration_path, local_path)
            self.assertEqual(selected.projects_dir, external.projects_dir)
            self.assertEqual(
                [item.id for item in list_workspace_projects(workspace.root_dir)],
                ["existing-project"],
            )

            created = create_project(workspace.root_dir, "new-project")
            self.assertEqual(created.root_dir.parent, external.projects_dir)
            set_default_project(workspace.root_dir, "new-project")
            self.assertEqual(
                json.loads(local_path.read_text())["default_project"],
                "new-project",
            )
            self.assertEqual(
                (workspace.root_dir / WORKSPACE_MANIFEST).read_text(),
                base_before,
            )

    def test_local_configuration_accepts_an_absolute_projects_directory(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            workspace = initialize_workspace(root / "repository")
            external = initialize_workspace(root / "external")
            self._write_local_workspace(
                workspace.root_dir,
                str(external.projects_dir),
                default_project=None,
            )

            selected = load_workspace(workspace.root_dir)
            self.assertEqual(selected.projects_dir, external.projects_dir)
            self.assertEqual(selected.configuration_source, "local-override")

    def test_local_configuration_is_strict_and_never_silently_falls_back(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            workspace = initialize_workspace(root / "repository")
            local_path = self._write_local_workspace(
                workspace.root_dir,
                "../missing-projects",
                default_project=None,
            )

            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "Missing Workspace projects directory",
            ):
                load_workspace(workspace.root_dir)

            value = json.loads(local_path.read_text())
            value["unexpected"] = True
            local_path.write_text(json.dumps(value), encoding="utf-8")
            with self.assertRaisesRegex(AutoQuantValidationError, "Unknown field"):
                load_workspace(workspace.root_dir)

    def test_local_configuration_rejects_symlink_projects_and_wrong_default(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            workspace = initialize_workspace(root / "repository")
            external = initialize_workspace(root / "external")
            link = root / "linked-projects"
            link.symlink_to(external.projects_dir, target_is_directory=True)
            local_path = self._write_local_workspace(
                workspace.root_dir,
                str(link),
                default_project=None,
            )

            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "cannot be a symlink",
            ):
                load_workspace(workspace.root_dir)

            local_path.unlink()
            self._write_local_workspace(
                workspace.root_dir,
                str(external.projects_dir),
                default_project="missing-project",
            )
            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "does not exist",
            ):
                list_workspace_projects(workspace.root_dir)

    def test_checked_in_manifest_can_be_loaded_without_a_local_override(
        self,
    ) -> None:
        repository = Path(__file__).resolve().parents[1]
        workspace = load_workspace(repository, use_local_override=False)

        self.assertEqual(workspace.configuration_source, "workspace-manifest")
        self.assertEqual(workspace.projects_dir, repository / "projects")
        self.assertIsNone(workspace.manifest.default_project)
        self.assertEqual(list_workspace_projects(repository), [])

    def test_workspace_rejects_symlink_project_entries(self) -> None:
        with (
            tempfile.TemporaryDirectory() as directory,
            tempfile.TemporaryDirectory() as outside,
        ):
            workspace = initialize_workspace(directory)
            (workspace.projects_dir / "unsafe").symlink_to(
                Path(outside),
                target_is_directory=True,
            )
            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "real directories",
            ):
                list_workspace_projects(workspace.root_dir)

    def test_project_rejects_symlink_components_in_owned_paths(self) -> None:
        with (
            tempfile.TemporaryDirectory() as directory,
            tempfile.TemporaryDirectory() as outside,
        ):
            workspace = initialize_workspace(directory)
            project = create_project(workspace.root_dir, "confined-project")
            manifest_path = project.root_dir / PROJECT_MANIFEST
            manifest = json.loads(manifest_path.read_text())
            manifest["research_program"] = "guidance/research.md"
            manifest_path.write_text(json.dumps(manifest))
            (project.root_dir / "guidance").symlink_to(
                Path(outside),
                target_is_directory=True,
            )
            (Path(outside) / "research.md").write_text("escaped")

            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "components cannot be symlinks",
            ):
                load_project(project.root_dir)

    def test_project_rejects_unknown_fields_mismatched_id_and_missing_paths(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace = initialize_workspace(directory)
            project = create_project(workspace.root_dir, "strict-project")
            manifest_path = project.root_dir / PROJECT_MANIFEST

            manifest = json.loads(manifest_path.read_text())
            manifest["surprise"] = True
            manifest_path.write_text(json.dumps(manifest))
            with self.assertRaisesRegex(AutoQuantValidationError, "Unknown field"):
                load_project(project.root_dir)

            manifest.pop("surprise")
            manifest["id"] = "another-id"
            manifest_path.write_text(json.dumps(manifest))
            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "must match directory",
            ):
                load_project(project.root_dir)

            manifest["id"] = "strict-project"
            manifest_path.write_text(json.dumps(manifest))
            (project.root_dir / "models").rmdir()
            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "Missing Project-owned 'models'",
            ):
                load_project(project.root_dir)

    def test_direct_project_rejects_redundant_workspace_selection(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace = initialize_workspace(directory)
            project = create_project(workspace.root_dir, "direct-project")
            with self.assertRaisesRegex(
                AutoQuantValidationError,
                "--project cannot be used",
            ):
                resolve_project_directory(project.root_dir, "direct-project")


if __name__ == "__main__":
    unittest.main()
