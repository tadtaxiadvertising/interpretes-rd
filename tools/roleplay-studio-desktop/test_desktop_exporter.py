"""Offline functional tests; no actual patient audio or network connections."""
import importlib.util
import json
import math
import os
import stat
from pathlib import Path
import shutil
import struct
import tempfile
import threading
import unittest
import wave
import zipfile

BASE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("desktop_exporter", BASE / "desktop_exporter.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def tone_wave(path, seconds=3):
    rate = 16000
    with wave.open(str(path), "wb") as file:
        file.setnchannels(1)
        file.setsampwidth(2)
        file.setframerate(rate)
        # Deterministic fixture - independent of machine audio hardware.
        frames = b"".join(struct.pack("<h", int(math.sin(
            index * 2 * math.pi * 440 / rate) * 6000))
            for index in range(rate * seconds))
        file.writeframes(frames)


class StudioDesktopTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="roleplay-desktop-test-")
        root = Path(self.temp.name)
        self.source = root / "medical;safe file.wav"
        self.project = root / "source.json"
        self.output = root / "result.zip"
        tone_wave(self.source)
        size = self.source.stat().st_size
        self.draft = {
            "format": module.FORMAT,
            "version": 1,
            "sourceSizeBytes": size,
            "sourceSampleSha256": module.fingerprint_file(self.source, size),
            "sourceDurationSeconds": 3,
            "segments": [{
                "title": "Doctor · 1",
                "start": 0.2,
                "end": 1.8,
                "scriptPrompt": "",
                "responseLimit": 120,
                "speakerRole": "doctor",
                "language": "en",
            }],
        }
        self.project.write_text(json.dumps(self.draft), encoding="utf-8")

    def tearDown(self):
        self.temp.cleanup()

    def test_fingerprint_matches_independent_hash_framing(self):
        import hashlib
        size = self.source.stat().st_size
        with self.source.open("rb") as file:
            payload = file.read()
        offsets = [0, max(0, size // 2 - 65536), max(0, size - 131072)]
        content = b"ir-studio-long-v1|" + str(size).encode() + b"|"
        for offset in offsets:
            length = min(131072, size - offset)
            content += f"{offset}|{length}|".encode() + payload[offset:offset+length]
        self.assertEqual(module.fingerprint_file(self.source, size),
                         hashlib.sha256(content).hexdigest())

    def test_project_rejects_unsafe_segments(self):
        source_size = self.source.stat().st_size
        self.assertEqual(len(module.validate_project(self.draft, source_size)), 1)
        for replacement in [
            {"speakerRole": "interpreter"},
            {"end": 500},
            {"start": -1},
            {"responseLimit": 301},
            {"responseLimit": True},
            {"language": "undetermined"},
            {"scriptPrompt": "x" * 5001},
        ]:
            with self.subTest(replacement=replacement), self.assertRaises(module.ExportError):
                invalid = json.loads(json.dumps(self.draft))
                invalid["segments"][0].update(replacement)
                module.validate_project(invalid, source_size)
        # JS Number.isSafeInteger accepts a JSON 120.0; Python must match.
        fractional_json = json.loads(json.dumps(self.draft))
        fractional_json["segments"][0]["responseLimit"] = 120.0
        module.validate_project(fractional_json, source_size)

    def test_preflight_shows_safe_summary_without_ffmpeg(self):
        checked = module.inspect_project(self.source, self.project)
        self.assertEqual(len(checked["clips"]), 1)
        self.assertAlmostEqual(checked["duration_seconds"], 1.6)
        self.assertEqual(checked["source_hash"], self.draft["sourceSampleSha256"])
        self.assertEqual(checked["unreviewed_roles"], 0)
        self.assertFalse(self.output.exists())

    def test_preflight_warns_about_unreviewed_speaker(self):
        self.draft["segments"][0]["speakerRole"] = "unknown"
        self.project.write_text(json.dumps(self.draft), encoding="utf-8")
        result = module.inspect_project(self.source, self.project)
        self.assertEqual(result["unreviewed_roles"], 1)
        # Existing publication contract permits "unknown": warn instead of
        # unilaterally changing that policy in the local export tool.

    def test_preflight_detects_wrong_source_with_same_length(self):
        # Deliberately corrupt the first sampled byte without changing size.
        with self.source.open("r+b") as original:
            original.seek(60)
            original.write(b"Q")
        with self.assertRaisesRegex(module.ExportError, "huella"):
            module.inspect_project(self.source, self.project)

    def test_refuses_output_symlink_without_touching_target(self):
        link_target = self.output.parent / "protected-data.bin"
        link_target.write_bytes(b"confidential")
        try:
            self.output.symlink_to(link_target)
        except (OSError, NotImplementedError):
            self.skipTest("This Windows runner does not allow unprivileged symlinks")
        with self.assertRaises(module.ExportError):
            module.export_project(self.source, self.project, self.output)
        self.assertEqual(link_target.read_bytes(), b"confidential")

    def test_invalid_fingerprint_rejected(self):
        self.draft["sourceSampleSha256"] = "0" * 64
        self.project.write_text(json.dumps(self.draft), encoding="utf-8")
        with self.assertRaisesRegex(module.ExportError, "huella"):
            module.export_project(self.source, self.project, self.output)
        self.assertFalse(self.output.exists())

    def test_cancelled_before_transcode_does_not_create_zip(self):
        cancel = threading.Event()
        cancel.set()
        with self.assertRaises(module.ExportCancelled):
            module.export_project(self.source, self.project, self.output, cancelled=cancel)
        self.assertFalse(self.output.exists())

    def test_existing_output_is_never_overwritten(self):
        self.output.write_bytes(b"keep-me")
        with self.assertRaisesRegex(module.ExportError, "ya existe"):
            module.export_project(self.source, self.project, self.output)
        self.assertEqual(self.output.read_bytes(), b"keep-me")

    @unittest.skipUnless(shutil.which("ffmpeg") or
                         importlib.util.find_spec("imageio_ffmpeg"),
                         "FFmpeg not installed on this machine")
    def test_real_ffmpeg_export_matches_roleplay_store_zip_contract(self):
        updates = []
        result = module.export_project(
            self.source, self.project, self.output,
            on_progress=lambda done, total: updates.append((done, total)))
        self.assertEqual(updates, [(1, 1)])
        self.assertEqual(result["clips"], 1)
        self.assertLessEqual(self.output.stat().st_size, module.MAX_ZIP_BYTES)
        if os.name == "posix":
            self.assertEqual(
                stat.S_IMODE(self.output.stat().st_mode), 0o600,
                "Confidential roleplay ZIP must be owner-readable only on POSIX.")
        with zipfile.ZipFile(self.output) as archive:
            self.assertEqual(archive.namelist(), ["manifest.json", "segment-01.mp3"])
            self.assertTrue(all(info.compress_type == zipfile.ZIP_STORED
                                for info in archive.infolist()))
            # The platform's strict native ZIP reader insists on flag 0x0800
            # in both local and central records, even for ASCII filenames.
            self.assertTrue(all(info.flag_bits == 0x0800
                                for info in archive.infolist()))
            raw = self.output.read_bytes()
            self.assertEqual(struct.unpack_from("<H", raw, 6)[0], 0x0800)
            central = raw.index(bytes((0x50, 0x4B, 0x01, 0x02)))
            self.assertEqual(struct.unpack_from("<H", raw, central + 8)[0], 0x0800)
            self.assertIsNone(archive.testzip())
            manifest = json.loads(archive.read("manifest.json"))
            segment = manifest["segments"][0]
            import hashlib
            self.assertEqual(segment["file"], "segment-01.mp3")
            self.assertEqual(segment["sha256"],
                             hashlib.sha256(archive.read("segment-01.mp3")).hexdigest())
            self.assertEqual(segment["script_prompt"], "")
            self.assertEqual(segment["duration_limit_sec"], 120)
        # The original never moves or changes; exporting twice must fail closed.
        self.assertTrue(self.source.is_file())
        with self.assertRaises(module.ExportError):
            module.export_project(self.source, self.project, self.output)


if __name__ == "__main__":
    unittest.main()
