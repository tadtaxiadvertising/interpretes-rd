"""Integrity manifest tests; no network, no real recordings."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

BASE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("archive_checksums", BASE / "archive_checksums.py")
checksums = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checksums)


class ArchiveChecksumTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="studio-integrity-")
        self.folder = Path(self.temp.name)
        self.archive = self.folder / "RoleplayStudioLocal-windows.zip"
        self.archive.write_bytes(b"fake local archive content")

    def tearDown(self):
        self.temp.cleanup()

    def test_create_verify_and_detect_tampering(self):
        file = checksums.generate(self.folder)
        self.assertEqual(file.name, "SHA256SUMS.txt")
        self.assertTrue(checksums.verify(self.folder))
        with self.assertRaises(FileExistsError):
            checksums.generate(self.folder)
        self.archive.write_bytes(b"changed")
        self.assertFalse(checksums.verify(self.folder))

    def test_rejects_multiple_archives_and_wrong_manifest(self):
        other = self.folder / "RoleplayStudioLocal-macos.zip"
        other.write_bytes(b"another platform")
        with self.assertRaises(ValueError):
            checksums.generate(self.folder)
        other.unlink()
        checksums.generate(self.folder)
        (self.folder / "SHA256SUMS.txt").write_text(
            "0" * 64 + "  ../../outside.zip\n", encoding="ascii")
        self.assertFalse(checksums.verify(self.folder))

    def test_rejects_linked_archive(self):
        actual = self.folder / "original.zip"
        actual.write_bytes(b"trusted")
        self.archive.unlink()
        try:
            self.archive.symlink_to(actual)
        except (NotImplementedError, OSError):
            self.skipTest("Symlinks not permitted by Windows test runner")
        with self.assertRaises(ValueError):
            checksums.generate(self.folder)


if __name__ == "__main__":
    unittest.main()
