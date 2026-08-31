#!/usr/bin/env python3
"""Fail before release mutation when any Railway Project retains legacy ownership."""

from __future__ import annotations

import json
import os
import stat
import sys


LOCK_PATHS = (
    ("state/guardian.lock", lambda project, _launcher: os.path.join(project, "state", "guardian.lock")),
    ("state/runtime.lock", lambda project, _launcher: os.path.join(project, "state", "runtime.lock")),
    (
        "workspaces/state/runtime.lock",
        lambda _project, launcher: os.path.join(launcher, "state", "runtime.lock"),
    ),
    (
        "data/state/config-bootstrap.lock",
        lambda project, _launcher: os.path.join(project, "data", "state", "config-bootstrap.lock"),
    ),
)


def read_fenced_owner(lock_dir: str, expected_machine_id: str) -> bool:
    try:
        lock_stat = os.lstat(lock_dir)
    except FileNotFoundError:
        return True
    if not stat.S_ISDIR(lock_stat.st_mode) or stat.S_ISLNK(lock_stat.st_mode):
        return False

    owner_path = os.path.join(lock_dir, "owner.json")
    try:
        descriptor = os.open(owner_path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    except (FileNotFoundError, OSError):
        return False
    try:
        owner_stat = os.fstat(descriptor)
        if not stat.S_ISREG(owner_stat.st_mode):
            return False
        with os.fdopen(descriptor, "r", encoding="utf-8", closefd=False) as stream:
            owner = json.load(stream)
    except (OSError, UnicodeError, json.JSONDecodeError):
        return False
    finally:
        os.close(descriptor)

    return bool(
        isinstance(owner, dict)
        and owner.get("schemaVersion") == 1
        and isinstance(owner.get("pid"), int)
        and owner["pid"] > 0
        and isinstance(owner.get("hostname"), str)
        and owner["hostname"]
        and owner.get("machineId") == expected_machine_id
        and isinstance(owner.get("token"), str)
        and owner["token"]
        and isinstance(owner.get("launcher"), str)
        and owner["launcher"]
        and isinstance(owner.get("acquiredAt"), str)
        and isinstance(owner.get("heartbeatAt"), str)
        and owner.get("fencingProtocol") == "railway-flock-v1"
    )


def looks_like_project_home(path: str) -> bool:
    if os.path.isfile(os.path.join(path, "data", "config", "alice-project.json")):
        return True
    return any(os.path.lexists(resolve_path(path, os.path.join(path, "workspaces"))) for _, resolve_path in LOCK_PATHS)


def discover_project_homes(volume_root: str, selected_home: str) -> list[str]:
    homes = {selected_home}
    reserved = {os.path.realpath(os.path.join(volume_root, "quarantine"))}
    for root, directories, _files in os.walk(volume_root, topdown=True, followlinks=False):
        root = os.path.realpath(root)
        if root in reserved:
            directories[:] = []
            continue
        directories[:] = [
            name
            for name in directories
            if not os.path.islink(os.path.join(root, name))
            and os.path.realpath(os.path.join(root, name)) not in reserved
        ]
        if root != volume_root and looks_like_project_home(root):
            homes.add(root)
    return sorted(homes)


def is_within(root: str, path: str) -> bool:
    try:
        return os.path.commonpath((root, path)) == root and path != root
    except ValueError:
        return False


def main(argv: list[str]) -> int:
    if len(argv) != 5:
        print(
            "openalice railway: retained-lock preflight requires Volume root, Project Home, launcher root, and machine identity",
            file=sys.stderr,
        )
        return 2

    volume_root = os.path.realpath(os.path.abspath(argv[1]))
    project_home = os.path.realpath(os.path.abspath(argv[2]))
    launcher_root = os.path.realpath(os.path.abspath(argv[3]))
    expected_machine_id = argv[4]
    if not is_within(volume_root, project_home) or not is_within(volume_root, launcher_root):
        print("openalice railway: retained-lock preflight paths escape the Volume", file=sys.stderr)
        return 2

    invalid: list[str] = []
    for candidate_home in discover_project_homes(volume_root, project_home):
        candidate_launcher = launcher_root if candidate_home == project_home else os.path.join(candidate_home, "workspaces")
        for relative, resolve_path in LOCK_PATHS:
            lock_path = resolve_path(candidate_home, candidate_launcher)
            if read_fenced_owner(lock_path, expected_machine_id):
                continue
            invalid.append(os.path.relpath(lock_path, volume_root))
    if not invalid:
        return 0

    print(
        "openalice railway: retained pre-fence Runtime ownership blocks release mutation: "
        + ", ".join(invalid)
        + ". Verify the previous deployment is stopped, then move only these exact lock directories "
        "to the documented reversible quarantine; do not clear the Project or Volume.",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
