#!/usr/bin/env python3
"""Fail before release mutation when any Railway Project retains legacy ownership."""

from __future__ import annotations

import json
import os
import re
import stat
import sys
import time
from dataclasses import dataclass


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


EMPTY_LOCK_GRACE_SECONDS = 2.0
FENCING_INSTANCE_ID_PATTERN = re.compile(r"[A-Za-z0-9-]{16,128}")
UUID_PATTERN_TEXT = r"[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"
MUTATION_OWNER_PATTERN = re.compile(rf"owner\.({UUID_PATTERN_TEXT})\.json", re.IGNORECASE)
MUTATION_TEMP_PATTERN = re.compile(rf"\.owner\.({UUID_PATTERN_TEXT})\.({UUID_PATTERN_TEXT})\.tmp", re.IGNORECASE)
CANONICAL_OWNER_TEMP_PATTERN = re.compile(
    rf"\.owner\.json\.({UUID_PATTERN_TEXT})\.({UUID_PATTERN_TEXT})\.tmp",
    re.IGNORECASE,
)
DIRECTORY_OPEN_FLAGS = (
    os.O_RDONLY
    | getattr(os, "O_CLOEXEC", 0)
    | getattr(os, "O_DIRECTORY", 0)
    | getattr(os, "O_NOFOLLOW", 0)
)
OWNER_OPEN_FLAGS = (
    os.O_RDONLY
    | getattr(os, "O_CLOEXEC", 0)
    | getattr(os, "O_NONBLOCK", 0)
    | getattr(os, "O_NOFOLLOW", 0)
)
LockIdentity = tuple[int, int, int]


@dataclass(frozen=True)
class MutationClaimCleanup:
    identity: LockIdentity
    entry_name: str | None
    entry_identity: LockIdentity | None
    entry_kind: str
    token: str | None
    needs_grace: bool


@dataclass(frozen=True)
class RetainedLockCleanup:
    lock_identity: LockIdentity
    canonical_temp_name: str | None
    canonical_temp_identity: LockIdentity | None
    claim: MutationClaimCleanup | None
    remove_lock: bool


def relative_components(volume_root: str, path: str) -> tuple[str, ...] | None:
    try:
        relative = os.path.relpath(os.path.abspath(path), volume_root)
    except ValueError:
        return None
    components = tuple(part for part in relative.split(os.sep) if part not in ("", "."))
    if relative == os.pardir or relative.startswith(os.pardir + os.sep) or os.pardir in components:
        return None
    return components


def open_directory_beneath(
    volume_fd: int,
    volume_root: str,
    path: str,
) -> tuple[str, int | None]:
    components = relative_components(volume_root, path)
    if components is None:
        return ("invalid", None)

    descriptor = os.dup(volume_fd)
    for component in components:
        try:
            child = os.open(component, DIRECTORY_OPEN_FLAGS, dir_fd=descriptor)
        except FileNotFoundError:
            os.close(descriptor)
            return ("missing", None)
        except OSError:
            os.close(descriptor)
            return ("invalid", None)
        os.close(descriptor)
        descriptor = child
    return ("directory", descriptor)


def lock_identity(lock_stat: os.stat_result) -> LockIdentity:
    return (lock_stat.st_dev, lock_stat.st_ino, lock_stat.st_mtime_ns)


def read_regular_json(
    directory_fd: int,
    name: str,
) -> tuple[dict[str, object], LockIdentity] | None:
    try:
        descriptor = os.open(name, OWNER_OPEN_FLAGS, dir_fd=directory_fd)
    except OSError:
        return None
    try:
        owner_stat = os.fstat(descriptor)
        if not stat.S_ISREG(owner_stat.st_mode):
            return None
        with os.fdopen(descriptor, "r", encoding="utf-8", closefd=False) as stream:
            owner = json.load(stream)
        if not isinstance(owner, dict):
            return None
        return (owner, lock_identity(owner_stat))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return None
    finally:
        os.close(descriptor)


def valid_fenced_owner(
    owner: dict[str, object],
    expected_machine_id: str,
    *,
    require_instance_id: bool,
) -> bool:
    instance_id = owner.get("fencingInstanceId")
    return bool(
        type(owner.get("schemaVersion")) is int
        and owner["schemaVersion"] == 1
        and type(owner.get("pid")) is int
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
        and (
            (
                not require_instance_id
                and "fencingInstanceId" not in owner
            )
            or (
                isinstance(instance_id, str)
                and FENCING_INSTANCE_ID_PATTERN.fullmatch(instance_id) is not None
            )
        )
    )


def inspect_mutation_claim(
    lock_fd: int,
    expected_machine_id: str,
) -> MutationClaimCleanup | None:
    try:
        claim_fd = os.open("reclaiming", DIRECTORY_OPEN_FLAGS, dir_fd=lock_fd)
    except OSError:
        return None
    try:
        claim_stat = os.fstat(claim_fd)
        try:
            with os.scandir(claim_fd) as iterator:
                entries = [entry.name for entry in iterator]
        except OSError:
            return None
        if not entries:
            return MutationClaimCleanup(
                identity=lock_identity(claim_stat),
                entry_name=None,
                entry_identity=None,
                entry_kind="empty",
                token=None,
                needs_grace=True,
            )
        if len(entries) != 1:
            return None

        entry_name = entries[0]
        owner_match = MUTATION_OWNER_PATTERN.fullmatch(entry_name)
        if owner_match is not None:
            record = read_regular_json(claim_fd, entry_name)
            if record is None:
                return None
            owner, owner_identity = record
            token = owner_match.group(1)
            if (
                not valid_fenced_owner(owner, expected_machine_id, require_instance_id=True)
                or not isinstance(owner.get("token"), str)
                or owner["token"].lower() != token.lower()
            ):
                return None
            return MutationClaimCleanup(
                identity=lock_identity(claim_stat),
                entry_name=entry_name,
                entry_identity=owner_identity,
                entry_kind="owner",
                token=token,
                needs_grace=False,
            )

        temp_match = MUTATION_TEMP_PATTERN.fullmatch(entry_name)
        if temp_match is None:
            return None
        try:
            descriptor = os.open(entry_name, OWNER_OPEN_FLAGS, dir_fd=claim_fd)
        except OSError:
            return None
        try:
            entry_stat = os.fstat(descriptor)
            if not stat.S_ISREG(entry_stat.st_mode):
                return None
            return MutationClaimCleanup(
                identity=lock_identity(claim_stat),
                entry_name=entry_name,
                entry_identity=lock_identity(entry_stat),
                entry_kind="temp",
                token=temp_match.group(1),
                needs_grace=True,
            )
        finally:
            os.close(descriptor)
    finally:
        os.close(claim_fd)


def inspect_retained_lock(
    volume_fd: int,
    volume_root: str,
    lock_dir: str,
    expected_machine_id: str,
) -> tuple[str, LockIdentity | RetainedLockCleanup | None]:
    directory_state, lock_fd = open_directory_beneath(volume_fd, volume_root, lock_dir)
    if directory_state != "directory" or lock_fd is None:
        return (directory_state, None)

    try:
        lock_stat = os.fstat(lock_fd)
        try:
            with os.scandir(lock_fd) as iterator:
                entries = [entry.name for entry in iterator]
        except OSError:
            return ("invalid", None)
        if not entries:
            return ("empty", lock_identity(lock_stat))

        owner_record = read_regular_json(lock_fd, "owner.json") if "owner.json" in entries else None
        if "owner.json" in entries and owner_record is None:
            return ("invalid", None)
        owner = owner_record[0] if owner_record is not None else None
        if owner is not None and not valid_fenced_owner(owner, expected_machine_id, require_instance_id=False):
            return ("invalid", None)

        claim = inspect_mutation_claim(lock_fd, expected_machine_id) if "reclaiming" in entries else None
        if "reclaiming" in entries and claim is None:
            return ("invalid", None)

        canonical_temps = [name for name in entries if CANONICAL_OWNER_TEMP_PATTERN.fullmatch(name)]
        known = {"owner.json", "reclaiming", *canonical_temps}
        if len(canonical_temps) > 1 or any(name not in known for name in entries):
            return ("invalid", None)
        if owner is None and claim is None:
            return ("invalid", None)

        canonical_temp_name = canonical_temps[0] if canonical_temps else None
        canonical_temp_identity = None
        if canonical_temp_name is not None:
            match = CANONICAL_OWNER_TEMP_PATTERN.fullmatch(canonical_temp_name)
            expected_token = owner.get("token") if owner is not None else claim.token if claim is not None else None
            if match is None or not isinstance(expected_token, str) or match.group(1).lower() != expected_token.lower():
                return ("invalid", None)
            try:
                descriptor = os.open(canonical_temp_name, OWNER_OPEN_FLAGS, dir_fd=lock_fd)
            except OSError:
                return ("invalid", None)
            try:
                temp_stat = os.fstat(descriptor)
                if not stat.S_ISREG(temp_stat.st_mode):
                    return ("invalid", None)
                canonical_temp_identity = lock_identity(temp_stat)
            finally:
                os.close(descriptor)

        if claim is None and canonical_temp_name is None:
            return ("fenced", None)
        return (
            "recoverable",
            RetainedLockCleanup(
                lock_identity=lock_identity(lock_stat),
                canonical_temp_name=canonical_temp_name,
                canonical_temp_identity=canonical_temp_identity,
                claim=claim,
                remove_lock=owner is None,
            ),
        )
    finally:
        os.close(lock_fd)


def reclaim_empty_lock(
    volume_fd: int,
    volume_root: str,
    lock_dir: str,
    identity: LockIdentity,
) -> bool:
    dev, ino, mtime_ns = identity
    remaining_grace = EMPTY_LOCK_GRACE_SECONDS - max(0.0, time.time() - (mtime_ns / 1_000_000_000))
    if remaining_grace > 0:
        time.sleep(remaining_grace)

    components = relative_components(volume_root, lock_dir)
    if not components:
        return False
    parent_path = os.path.join(volume_root, *components[:-1])
    parent_state, parent_fd = open_directory_beneath(volume_fd, volume_root, parent_path)
    if parent_state == "missing":
        return True
    if parent_state != "directory" or parent_fd is None:
        return False
    try:
        lock_name = components[-1]
        try:
            lock_fd = os.open(lock_name, DIRECTORY_OPEN_FLAGS, dir_fd=parent_fd)
        except FileNotFoundError:
            return True
        except OSError:
            return False
        try:
            latest = os.fstat(lock_fd)
            if lock_identity(latest) != (dev, ino, mtime_ns):
                return False
            try:
                with os.scandir(lock_fd) as entries:
                    if next(entries, None) is not None:
                        return False
            except OSError:
                return False
            try:
                os.rmdir(lock_name, dir_fd=parent_fd)
                return True
            except FileNotFoundError:
                return True
            except OSError:
                return False
        finally:
            os.close(lock_fd)
    finally:
        os.close(parent_fd)


def reclaim_recoverable_lock(
    volume_fd: int,
    volume_root: str,
    lock_dir: str,
    cleanup: RetainedLockCleanup,
    expected_machine_id: str,
) -> bool:
    claim = cleanup.claim
    if claim is not None and claim.needs_grace:
        remaining_grace = EMPTY_LOCK_GRACE_SECONDS - max(
            0.0,
            time.time() - (claim.identity[2] / 1_000_000_000),
        )
        if remaining_grace > 0:
            time.sleep(remaining_grace)

    components = relative_components(volume_root, lock_dir)
    if not components:
        return False
    parent_path = os.path.join(volume_root, *components[:-1])
    parent_state, parent_fd = open_directory_beneath(volume_fd, volume_root, parent_path)
    if parent_state == "missing":
        return True
    if parent_state != "directory" or parent_fd is None:
        return False

    try:
        lock_name = components[-1]
        try:
            lock_fd = os.open(lock_name, DIRECTORY_OPEN_FLAGS, dir_fd=parent_fd)
        except FileNotFoundError:
            return True
        except OSError:
            return False
        try:
            if lock_identity(os.fstat(lock_fd)) != cleanup.lock_identity:
                return False

            if cleanup.canonical_temp_name is not None:
                try:
                    descriptor = os.open(cleanup.canonical_temp_name, OWNER_OPEN_FLAGS, dir_fd=lock_fd)
                except OSError:
                    return False
                try:
                    temp_stat = os.fstat(descriptor)
                    if (
                        not stat.S_ISREG(temp_stat.st_mode)
                        or lock_identity(temp_stat) != cleanup.canonical_temp_identity
                    ):
                        return False
                finally:
                    os.close(descriptor)
                try:
                    os.unlink(cleanup.canonical_temp_name, dir_fd=lock_fd)
                except OSError:
                    return False

            if claim is not None:
                try:
                    claim_fd = os.open("reclaiming", DIRECTORY_OPEN_FLAGS, dir_fd=lock_fd)
                except OSError:
                    return False
                try:
                    if lock_identity(os.fstat(claim_fd)) != claim.identity:
                        return False
                    if claim.entry_name is not None:
                        try:
                            descriptor = os.open(claim.entry_name, OWNER_OPEN_FLAGS, dir_fd=claim_fd)
                        except OSError:
                            return False
                        try:
                            entry_stat = os.fstat(descriptor)
                            if (
                                not stat.S_ISREG(entry_stat.st_mode)
                                or lock_identity(entry_stat) != claim.entry_identity
                            ):
                                return False
                        finally:
                            os.close(descriptor)

                        if claim.entry_kind == "owner":
                            record = read_regular_json(claim_fd, claim.entry_name)
                            if record is None:
                                return False
                            owner, owner_identity = record
                            if (
                                owner_identity != claim.entry_identity
                                or not valid_fenced_owner(owner, expected_machine_id, require_instance_id=True)
                                or not isinstance(owner.get("token"), str)
                                or claim.token is None
                                or owner["token"].lower() != claim.token.lower()
                            ):
                                return False
                        elif claim.entry_kind == "temp":
                            record = read_regular_json(claim_fd, claim.entry_name)
                            if record is not None:
                                owner, owner_identity = record
                                if (
                                    owner_identity != claim.entry_identity
                                    or not isinstance(owner.get("token"), str)
                                    or claim.token is None
                                    or owner["token"].lower() != claim.token.lower()
                                ):
                                    return False
                        try:
                            os.unlink(claim.entry_name, dir_fd=claim_fd)
                        except OSError:
                            return False
                    try:
                        with os.scandir(claim_fd) as iterator:
                            if next(iterator, None) is not None:
                                return False
                    except OSError:
                        return False
                finally:
                    os.close(claim_fd)
                try:
                    os.rmdir("reclaiming", dir_fd=lock_fd)
                except OSError:
                    return False

            if cleanup.remove_lock:
                try:
                    with os.scandir(lock_fd) as iterator:
                        if next(iterator, None) is not None:
                            return False
                except OSError:
                    return False
                try:
                    os.rmdir(lock_name, dir_fd=parent_fd)
                except FileNotFoundError:
                    return True
                except OSError:
                    return False
            return True
        finally:
            os.close(lock_fd)
    finally:
        os.close(parent_fd)


def looks_like_project_home(path: str) -> bool:
    try:
        marker = os.lstat(os.path.join(path, "data", "config", "alice-project.json"))
    except FileNotFoundError:
        marker = None
    if marker is not None and stat.S_ISREG(marker.st_mode):
        return True
    for _, resolve_path in LOCK_PATHS:
        try:
            os.lstat(resolve_path(path, os.path.join(path, "workspaces")))
            return True
        except FileNotFoundError:
            continue
    return False


def raise_walk_error(error: OSError) -> None:
    raise error


def discover_project_homes(volume_root: str, selected_home: str) -> list[str]:
    homes = {volume_root, selected_home}
    quarantine_root = os.path.abspath(os.path.join(volume_root, "quarantine"))
    try:
        quarantine_stat = os.lstat(quarantine_root)
    except FileNotFoundError:
        quarantine_stat = None
    if quarantine_stat is not None and (
        stat.S_ISLNK(quarantine_stat.st_mode)
        or not stat.S_ISDIR(quarantine_stat.st_mode)
    ):
        raise OSError("the reserved Railway quarantine path is not an actual directory")
    for root, directories, _files in os.walk(
        volume_root,
        topdown=True,
        onerror=raise_walk_error,
        followlinks=False,
    ):
        root = os.path.abspath(root)
        if root == quarantine_root:
            directories[:] = []
            continue
        traversable: list[str] = []
        for name in directories:
            directory_path = os.path.join(root, name)
            directory_stat = os.lstat(directory_path)
            if stat.S_ISLNK(directory_stat.st_mode):
                continue
            if os.path.abspath(directory_path) == quarantine_root:
                continue
            traversable.append(name)
        directories[:] = traversable
        if looks_like_project_home(root):
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
    quarantine_root = os.path.join(volume_root, "quarantine")
    if project_home == quarantine_root or is_within(quarantine_root, project_home):
        print("openalice railway: Project Home cannot select the reserved quarantine tree", file=sys.stderr)
        return 2

    try:
        volume_fd = os.open(volume_root, DIRECTORY_OPEN_FLAGS)
    except OSError as error:
        print(f"openalice railway: retained-lock preflight cannot open the Volume: {error}", file=sys.stderr)
        return 1

    invalid: list[str] = []
    empty: list[tuple[str, LockIdentity]] = []
    recoverable: list[tuple[str, RetainedLockCleanup]] = []
    seen_lock_paths: set[str] = set()
    try:
        try:
            candidate_homes = discover_project_homes(volume_root, project_home)
        except OSError as error:
            print(
                f"openalice railway: retained-lock preflight could not inspect the complete Volume: {error}",
                file=sys.stderr,
            )
            return 1

        for candidate_home in candidate_homes:
            candidate_launcher = launcher_root if candidate_home == project_home else os.path.join(candidate_home, "workspaces")
            for relative, resolve_path in LOCK_PATHS:
                lock_path = os.path.normpath(os.path.abspath(resolve_path(candidate_home, candidate_launcher)))
                if lock_path in seen_lock_paths:
                    continue
                seen_lock_paths.add(lock_path)
                state, identity = inspect_retained_lock(
                    volume_fd,
                    volume_root,
                    lock_path,
                    expected_machine_id,
                )
                if state in ("missing", "fenced"):
                    continue
                if state == "empty" and identity is not None:
                    if isinstance(identity, tuple):
                        empty.append((lock_path, identity))
                    else:
                        invalid.append(os.path.relpath(lock_path, volume_root))
                    continue
                if state == "recoverable" and isinstance(identity, RetainedLockCleanup):
                    recoverable.append((lock_path, identity))
                    continue
                invalid.append(os.path.relpath(lock_path, volume_root))
        if not invalid:
            for lock_path, cleanup in recoverable:
                if not reclaim_recoverable_lock(
                    volume_fd,
                    volume_root,
                    lock_path,
                    cleanup,
                    expected_machine_id,
                ):
                    invalid.append(os.path.relpath(lock_path, volume_root))
            if not invalid:
                for lock_path, identity in empty:
                    if not reclaim_empty_lock(volume_fd, volume_root, lock_path, identity):
                        invalid.append(os.path.relpath(lock_path, volume_root))
    finally:
        os.close(volume_fd)
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
