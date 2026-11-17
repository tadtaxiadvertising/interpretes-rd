"""Offline functional tests; no actual patient audio or network connections."""
import importlib.util
import json
import math
import os
import stat
import subprocess
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

    @unittest.skipUnless(shutil.which("ffmpeg") or
                         importlib.util.find_spec("imageio_ffmpeg"),
                         "FFmpeg not installed on this machine")
    def test_packaging_self_check_encodes_real_synthetic_mp3(self):
        # The actual packaging workflow also runs this against frozen binaries.
        try:
            import tkinter as tk
            tk.Tcl()
        except Exception:
            self.skipTest("Headless Tk not installed; package smoke runs with Tk")
        module.self_check()

    def test_packaging_self_check_refuses_missing_libmp3lame(self):
        from types import ModuleType, SimpleNamespace
        from unittest.mock import patch
        fake_tk = ModuleType("tkinter")
        fake_tk.Tcl = lambda: SimpleNamespace(eval=lambda _: "8.6")
        fake_tk.ttk = ModuleType("tkinter.ttk")
        with (patch.dict("sys.modules",
                         {"tkinter": fake_tk, "tkinter.ttk": fake_tk.ttk}),
              patch.object(module, "resolve_ffmpeg", return_value="ffmpeg"),
              patch.object(module.subprocess, "run", return_value=
                           subprocess.CompletedProcess(["ffmpeg"], 1, b""))):
            with self.assertRaisesRegex(module.ExportError, "libmp3lame"):
                module.self_check()

    def test_packaging_self_check_refuses_missing_tcl_runtime(self):
        from types import ModuleType
        from unittest.mock import patch
        fake_tk = ModuleType("tkinter")
        def broken_tcl():
            raise RuntimeError("packaged Tcl resources not found")
        fake_tk.Tcl = broken_tcl
        fake_tk.ttk = ModuleType("tkinter.ttk")
        with patch.dict("sys.modules",
                        {"tkinter": fake_tk, "tkinter.ttk": fake_tk.ttk}):
            with self.assertRaisesRegex(module.ExportError, "Tcl/Tk"):
                module.self_check()

    def test_packaged_tcl_can_work_while_tk_widget_scripts_are_missing(self):
        from types import ModuleType, SimpleNamespace
        from unittest.mock import patch
        fake_tk = ModuleType("tkinter")
        fake_tk.Tcl = lambda: SimpleNamespace(eval=lambda _: "8.6")
        fake_tk.ttk = ModuleType("tkinter.ttk")
        bundle = self.project.parent / "frozen-runtime"
        bundle.mkdir()
        # Tcl() succeeds but the frozen bundle is missing the Tk scripts.
        with (patch.dict("sys.modules",
                         {"tkinter": fake_tk, "tkinter.ttk": fake_tk.ttk}),
              patch.object(module.sys, "frozen", True, create=True),
              patch.object(module.sys, "_MEIPASS", str(bundle), create=True),
              patch.object(module.sys, "platform", "linux")):
            with self.assertRaisesRegex(module.ExportError, "Tk/ttk"):
                module.self_check()
            scripts = bundle / "_tk_data"
            scripts.mkdir()
            (scripts / "tk.tcl").write_text("tk script", encoding="utf-8")
            with self.assertRaisesRegex(module.ExportError, "Tk/ttk"):
                module.verify_packaged_tk_resources()
            (scripts / "ttk").mkdir()
            (scripts / "ttk" / "ttk.tcl").write_text(
                "ttk widget script", encoding="utf-8")
            # Both scripts exist. The separate MP3 smoke still runs next in
            # self_check, but resource validation must not need any display.
            module.verify_packaged_tk_resources()

    def test_one_dialog_recognizes_source_and_json_in_any_order(self):
        self.assertEqual(module.recognize_media_and_project(
            [str(self.project), str(self.source)]),
            (str(self.source), str(self.project)))
        self.assertEqual(module.recognize_media_and_project(
            [str(self.source), str(self.project)]),
            (str(self.source), str(self.project)))
        for selection in ([str(self.project)], [str(self.source), str(self.source)],
                          [str(self.project), str(self.project)], [],
                          [str(self.source), str(self.project), str(self.source)]):
            with self.subTest(selection=selection), self.assertRaises(module.ExportError):
                module.recognize_media_and_project(selection)

    def test_unique_same_folder_companion_is_found_from_either_selected_file(self):
        expected = (str(self.source), str(self.project))
        self.assertEqual(module.discover_local_companion(self.project), expected)
        self.assertEqual(module.discover_local_companion(self.source), expected)

    def test_duplicate_media_or_json_never_auto_selects_an_ambiguous_pair(self):
        duplicate_audio = self.source.parent / "copy.wav"
        shutil.copyfile(self.source, duplicate_audio)
        # Two recordings with the same partial fingerprint are ambiguous;
        # the GUI must ask the user to choose one explicitly.
        self.assertIsNone(module.discover_local_companion(self.project))
        duplicate_audio.unlink()
        duplicate_project = self.project.parent / "copy.json"
        shutil.copyfile(self.project, duplicate_project)
        self.assertIsNone(module.discover_local_companion(self.source))

    def test_changed_source_or_project_fingerprint_requires_manual_selection(self):
        alternative = self.source.parent / "modified.wav"
        original = bytearray(self.source.read_bytes())
        original[-1] ^= 1
        alternative.write_bytes(original)
        self.assertIsNone(module.discover_local_companion(alternative))
        self.draft["sourceSampleSha256"] = "0" * 64
        self.project.write_text(json.dumps(self.draft), encoding="utf-8")
        self.assertIsNone(module.discover_local_companion(self.project))

    def test_matching_fingerprint_does_not_autoselect_an_invalid_project(self):
        # Matching size/partial hash is necessary, but malformed scenarios
        # must not be suggested as a ready-to-export pair.
        self.draft["segments"][0]["speakerRole"] = "interpreter"
        self.project.write_text(json.dumps(self.draft), encoding="utf-8")
        self.assertIsNone(module.discover_local_companion(self.project))
        self.assertIsNone(module.discover_local_companion(self.source))

        # Invalid time limits must also keep the manual selection fallback.
        self.draft["segments"][0]["speakerRole"] = "doctor"
        self.draft["segments"][0]["end"] = 500
        self.project.write_text(json.dumps(self.draft), encoding="utf-8")
        self.assertIsNone(module.discover_local_companion(self.project))
        self.assertIsNone(module.discover_local_companion(self.source))

    def test_pair_discovery_is_bounded_and_rejects_invalid_projects_and_links(self):
        # No recursive scan or unbounded inventory of private folders.
        self.assertIsNone(module.discover_local_companion(self.project, max_entries=1))
        self.assertIsNone(module.discover_local_companion(self.project, max_candidates=0))
        self.assertIsNone(module.discover_local_companion(self.project, max_entries=0))
        malformed = self.source.parent / "malformed.json"
        malformed.write_text("{", encoding="utf-8")
        self.assertIsNone(module.discover_local_companion(malformed))
        invalid = self.source.parent / "oversized.json"
        invalid.write_bytes(b"x" * (module.MAX_PROJECT_BYTES + 1))
        self.assertIsNone(module.discover_local_companion(invalid))
        link = self.source.parent / "source-link.wav"
        try:
            link.symlink_to(self.source)
        except (OSError, NotImplementedError):
            pass
        else:
            self.assertIsNone(module.discover_local_companion(link))

    def test_zip_suggestion_avoids_existing_and_symlinked_outputs(self):
        folder = self.project.parent
        first = folder / "roleplay-studio.zip"
        self.assertEqual(module.suggest_local_zip_path(self.project), str(first))
        first.write_bytes(b"existing package must survive")
        self.assertEqual(module.suggest_local_zip_path(self.project),
                         str(folder / "roleplay-studio-2.zip"))
        target = folder / "protected.bin"
        target.write_bytes(b"private")
        candidate = folder / "roleplay-studio-2.zip"
        try:
            candidate.symlink_to(target)
        except (OSError, NotImplementedError):
            candidate.write_bytes(b"occupied")
        self.assertEqual(module.suggest_local_zip_path(self.project),
                         str(folder / "roleplay-studio-3.zip"))
        self.assertEqual(first.read_bytes(), b"existing package must survive")
        self.assertEqual(target.read_bytes(), b"private")
        with self.assertRaises(module.ExportError):
            module.suggest_local_zip_path(self.source)

    def test_zip_suggestion_fails_when_all_suggested_names_are_occupied(self):
        # Avoid creating a thousand files: simulate the occupied-path guard.
        from unittest.mock import patch
        with patch.object(module.Path, "exists", return_value=True):
            with self.assertRaisesRegex(module.ExportError, "No hay un nombre ZIP"):
                module.suggest_local_zip_path(self.project)

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
    @unittest.skipUnless(shutil.which("ffmpeg") or
                         importlib.util.find_spec("imageio_ffmpeg"),
                         "FFmpeg not installed on this machine")
    def test_v2_gapless_merge_real_mp3_excludes_original_pause(self):
        tone_wave(self.source, seconds=6)
        size = self.source.stat().st_size
        self.draft["version"] = 2
        self.draft["sourceSizeBytes"] = size
        self.draft["sourceDurationSeconds"] = 6
        self.draft["sourceSampleSha256"] = module.fingerprint_file(self.source, size)
        scene = self.draft["segments"][0]
        scene["start"], scene["end"] = 0.2, 5.2
        scene["ranges"] = [{"start": 0.2, "end": 1.2},
                           {"start": 4, "end": 5.2}]
        self.project.write_text(json.dumps(self.draft), encoding="utf-8")
        self.assertEqual(len(module.validate_project(self.draft, size)), 1)
        self.assertAlmostEqual(module.inspect_project(
            self.source, self.project)["duration_seconds"], 2.2)
        module.export_project(self.source, self.project, self.output)
        with zipfile.ZipFile(self.output) as archive:
            self.assertEqual(archive.namelist(), ["manifest.json", "segment-01.mp3"])
            mp3 = self.output.parent / "joined.mp3"
            mp3.write_bytes(archive.read("segment-01.mp3"))
            check = subprocess.run([
                module.resolve_ffmpeg(), "-hide_banner", "-nostdin", "-loglevel", "error",
                "-i", str(mp3), "-f", "null", "-", "-progress", "pipe:2", "-nostats",
            ], capture_output=True, timeout=30, check=True)
            matches = list(module.OUT_TIME.finditer(check.stderr.decode("utf-8", "replace")))
            self.assertTrue(matches)
            h, m, sec = matches[-1].groups()
            length = int(h) * 3600 + int(m) * 60 + float(sec)
            self.assertGreater(length, 1.95)
            self.assertLess(length, 2.5)  # Outer interval is 5 seconds.
        invalid = json.loads(json.dumps(self.draft))
        invalid["version"] = 1
        with self.assertRaises(module.ExportError):
            module.validate_project(invalid, size)

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
