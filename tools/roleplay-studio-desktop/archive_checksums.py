#!/usr/bin/env python3
"""Generate and verify one archive checksum for a manually built desktop artifact.

Integrity check only: SHA-256 does NOT sign a release or establish provenance.
The operator must still verify the trusted GitHub Actions run and commit.
"""
from __future__ import annotations

import hashlib
from pathlib import Path
import re
import sys

ARCHIVE_NAMES = {
    "RoleplayStudioLocal-windows.zip",
    "RoleplayStudioLocal-macos.zip",
    "RoleplayStudioLocal-linux.tar.gz",
}
MANIFEST_NAME = "SHA256SUMS.txt"


def archive_in(directory: Path) -> Path:
    archives = sorted(path for path in directory.iterdir()
                      if path.name in ARCHIVE_NAMES)
    if (len(archives) != 1 or archives[0].is_symlink()
            or not archives[0].is_file()):
        raise ValueError("Exactly one verified desktop archive is required")
    return archives[0]


def hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def generate(directory: Path) -> Path:
    archive = archive_in(directory)
    checksum = hash_file(archive)
    manifest = directory / MANIFEST_NAME
    # Exclusive creation. Do not allow a stale or symlinked checksum file.
    with manifest.open("x", encoding="ascii", newline="\n") as stream:
        stream.write(f"{checksum}  {archive.name}\n")
    return manifest


def verify(directory: Path) -> bool:
    archive = archive_in(directory)
    manifest = directory / MANIFEST_NAME
    if manifest.is_symlink() or not manifest.is_file():
        return False
    text = manifest.read_text(encoding="ascii")
    match = re.fullmatch(r"([0-9a-f]{64})  ([A-Za-z0-9.-]+)\n", text)
    return bool(match and match.group(2) == archive.name
                and match.group(1) == hash_file(archive))


def main() -> int:
    directory = Path.cwd()
    try:
        if "--verify" in sys.argv[1:]:
            if len(sys.argv) != 2 or not verify(directory):
                raise ValueError("SHA-256 integrity check failed")
            print("Desktop archive integrity: OK")
        elif len(sys.argv) == 1:
            manifest = generate(directory)
            print(f"Created {manifest.name} for the packaged archive")
        else:
            raise ValueError("Usage: archive_checksums.py [--verify]")
    except (OSError, UnicodeError, ValueError) as exc:
        print(f"Desktop archive integrity: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
