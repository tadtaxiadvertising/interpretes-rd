#!/usr/bin/env python3
"""Roleplay Audio Studio: offline desktop exporter.

All processing stays on the administrator's computer. This file intentionally
has no network, database, or browser-server dependencies. Python is needed to
run from source, but packaged distributions contain their own runtime.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
from pathlib import Path
import queue
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import threading
import time
import zlib

FORMAT = "interpretes-rd-studio-long-local-project"
MAX_SOURCE_BYTES = 8 * 1024**3
MAX_SOURCE_SECONDS = 12 * 3600
MAX_PROJECT_BYTES = 180_000
MAX_SEGMENTS = 25
MAX_TOTAL_SECONDS = 900
MAX_ZIP_BYTES = 16 * 1024 * 1024
MAX_CLIP_BYTES = 15 * 1024 * 1024
SAMPLE_BYTES = 128 * 1024
EXTENSIONS = {"mp3", "m4a", "wav", "aac", "ogg", "oga", "opus", "flac",
              "mp4", "m4v", "mov", "webm", "mkv"}
ROLES = {"doctor", "patient", "nurse", "operator", "interpreter", "unknown"}
LANGUAGES = {"en", "es", "unknown"}
OUT_TIME = re.compile(r"out_time=(\d+):(\d{2}):(\d{2}(?:\.\d+)?)")


class ExportError(Exception):
    """User-facing validation or conversion error, without private file data."""


class ExportCancelled(ExportError):
    """The operator explicitly cancelled local processing."""


def _obj(value):
    return type(value) is dict


def _number(value):
    # bool is a subclass of int in Python, but not a JS number.
    return type(value) in (int, float) and math.isfinite(value)


def _int(value):
    return _number(value) and abs(value) <= 9007199254740991 and float(value).is_integer()


def validate_project(project, source_size):
    """Mirror the established Node exporter's safety/manifest constraints."""
    if (not _obj(project) or project.get("format") != FORMAT or
            project.get("version") not in (1, 2) or type(project.get("version")) is bool or
            not _int(project.get("sourceSizeBytes")) or
            project["sourceSizeBytes"] != source_size or
            not isinstance(project.get("sourceSampleSha256"), str) or
            re.fullmatch(r"[0-9a-fA-F]{64}", project["sourceSampleSha256"]) is None or
            not _number(project.get("sourceDurationSeconds")) or
            not 0 < project["sourceDurationSeconds"] <= MAX_SOURCE_SECONDS or
            type(project.get("segments")) is not list or
            not 1 <= len(project["segments"]) <= MAX_SEGMENTS):
        raise ExportError("El proyecto JSON no corresponde a esta grabación o está incompleto.")

    clips = project["segments"]
    # Validate before sorting; arbitrary structures must never reach FFmpeg.
    for clip in clips:
        if not _obj(clip) or not _number(clip.get("start")):
            raise ExportError("Hay una intervención con datos inválidos.")
    ordered = sorted(clips, key=lambda clip: clip["start"])
    total = 0.0
    last_end = 0.0
    for clip in ordered:
        title = clip.get("title")
        start = clip.get("start")
        end = clip.get("end")
        prompt = clip.get("scriptPrompt")
        limit = clip.get("responseLimit")
        role = clip.get("speakerRole")
        language = clip.get("language")
        if (type(title) is not str or not title.strip() or len(title) > 200 or
                not _number(start) or not _number(end) or start < last_end or
                end - start < 0.1 or
                end > project["sourceDurationSeconds"] + 0.1 or
                type(prompt) is not str or len(prompt) > 5000 or
                not _int(limit) or not 0 <= limit <= 300 or
                type(role) is not str or role not in ROLES or
                type(language) is not str or language not in LANGUAGES):
            raise ExportError("Revisa títulos, perfiles, tiempos o instrucciones inválidos.")
        if role == "interpreter":
            raise ExportError("Hay un fragmento del intérprete original. Exclúyelo antes de exportar.")
        if "ranges" in clip and project["version"] != 2:
            raise ExportError("Un proyecto v1 no admite intervalos compuestos.")
        selected = end - start
        if "ranges" in clip:
            ranges = clip["ranges"]
            if (type(ranges) is not list or len(ranges) != 2 or
                    any(not _obj(r) or not _number(r.get("start")) or
                        not _number(r.get("end")) or r["start"] < 0 or
                        r["end"] - r["start"] < 0.1 - 1e-6 or
                        r["end"] > project["sourceDurationSeconds"] + 0.1
                        for r in ranges) or
                    abs(start - ranges[0]["start"]) > 1e-6 or
                    abs(end - ranges[1]["end"]) > 1e-6 or
                    ranges[1]["start"] - ranges[0]["end"] <= 2 + 1e-6):
                raise ExportError("El proyecto contiene intervalos compuestos inválidos.")
            selected = sum(r["end"] - r["start"] for r in ranges)
        if selected > 300 + 1e-6:
            raise ExportError("Una intervención supera los 5 minutos de audio seleccionado.")
        total += selected
        if total > MAX_TOTAL_SECONDS + 1e-6:
            raise ExportError("El ZIP supera los 15 minutos acumulados de audio.")
        last_end = end
    if project["version"] == 2 and not any("ranges" in clip for clip in ordered):
        raise ExportError("Un proyecto v2 debe contener al menos una intervención compuesta.")
    return ordered


def fingerprint_file(source: Path, size: int):
    """SHA-256 of three framed 128 KiB slices; exactly matches long-media.ts.

    It is a partial fingerprint, not a collision-resistant full-file integrity
    guarantee for the remainder of the 8 GiB original.
    """
    digest = hashlib.sha256()
    digest.update(f"ir-studio-long-v1|{size}|".encode("utf-8"))
    offsets = (0, max(0, size // 2 - SAMPLE_BYTES // 2),
               max(0, size - SAMPLE_BYTES))
    with source.open("rb") as file:
        for offset in offsets:
            length = min(SAMPLE_BYTES, size - offset)
            file.seek(offset)
            data = file.read(length)
            if len(data) != length:
                raise ExportError("La fuente cambió durante la lectura.")
            digest.update(f"{offset}|{length}|".encode("utf-8"))
            digest.update(data)
    return digest.hexdigest()


def resolve_ffmpeg():
    """Prefer the packaged FFmpeg binary; fall back to user's local installation."""
    try:
        import imageio_ffmpeg
        binary = imageio_ffmpeg.get_ffmpeg_exe()
        if binary and Path(binary).is_file():
            return binary
    except (ImportError, OSError, RuntimeError):
        pass
    binary = shutil.which("ffmpeg")
    if binary:
        return binary
    raise ExportError(
        "No se encontró FFmpeg local. Usa el ejecutable de escritorio que incluye "
        "FFmpeg o instala FFmpeg para ejecutar este proyecto desde Python."
    )


def transcode_clip(source, destination, clip, ffmpeg, cancelled):
    if cancelled.is_set():
        raise ExportCancelled("Exportación cancelada.")
    ranges = clip.get("ranges", [{"start": clip["start"], "end": clip["end"]}])
    length = sum(r["end"] - r["start"] for r in ranges)
    # Two bounded inputs + decoded-audio concat: one encoded MP3 with no
    # intermediary silence, never bytewise concatenation of encoded streams.
    inputs = []
    for cut in ranges:
        inputs.extend(["-ss", str(cut["start"]), "-t",
                       str(cut["end"] - cut["start"]), "-i", str(source)])
    mapping = (["-filter_complex",
                "[0:a:0][1:a:0]concat=n=2:v=0:a=1[out]", "-map", "[out]"]
               if len(ranges) == 2 else ["-map", "0:a:0"])
    command = [
        ffmpeg, "-hide_banner", "-nostdin", "-loglevel", "error",
        *inputs, *mapping, "-vn",
        "-ac", "1", "-ar", "24000", "-codec:a", "libmp3lame",
        "-b:a", "64k", "-progress", "pipe:2", "-nostats", "-y",
        str(destination),
    ]
    # Never use a shell: input paths may contain whitespace or metacharacters.
    try:
        process = subprocess.Popen(
            command, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
    except OSError as exc:
        raise ExportError("No se pudo iniciar FFmpeg local.") from exc

    deadline = time.monotonic() + min(300, 90 + length)
    output = b""
    try:
        while True:
            if cancelled.is_set():
                raise ExportCancelled("Exportación cancelada.")
            if time.monotonic() >= deadline:
                raise ExportError("FFmpeg excedió el tiempo permitido para un corte.")
            try:
                _, output = process.communicate(timeout=0.4)
                break
            except subprocess.TimeoutExpired:
                continue
    except (ExportError, KeyboardInterrupt):
        process.kill()
        process.communicate()
        raise
    if process.returncode != 0:
        raise ExportError("FFmpeg no pudo extraer el audio del fragmento.")
    matches = list(OUT_TIME.finditer(output.decode("utf-8", "replace")))
    if not matches:
        raise ExportError("FFmpeg no confirmó la duración del fragmento.")
    hh, mm, ss = matches[-1].groups()
    actual = int(hh) * 3600 + int(mm) * 60 + float(ss)
    tolerance = min(0.35, max(0.08, length * 0.1))
    if actual + tolerance < length:
        raise ExportError("Un corte termina fuera de la pista de audio o quedó truncado.")



def write_studio_store_zip(target: Path, manifest: dict, clip_files):
    """Produce canonical Audio Studio ZIP headers, not generic Python ZIPs.

    extractStudioZip() rejects archives lacking the UTF-8 filename flag 0x0800,
    even for ASCII names. Python zipfile does not set it for ASCII names. Emit
    bounded, strict STORE records with matching local/central flags and CRCs.
    """
    records = [("manifest.json", json.dumps(
        manifest, ensure_ascii=False, indent=2).encode("utf-8"))] + list(clip_files)
    if not 2 <= len(records) <= 26:
        raise ExportError("Cantidad de archivos ZIP inválida.")
    central = []
    with target.open("xb") as archive:
        for name, source in records:
            if not (name == "manifest.json" or
                    re.fullmatch(r"segment-(?:0[1-9]|1[0-9]|2[0-5])\.mp3", name)):
                raise ExportError("Nombre de archivo ZIP no permitido.")
            encoded = name.encode("utf-8")
            is_manifest = isinstance(source, bytes)
            if is_manifest:
                length = len(source)
                checksum = zlib.crc32(source) & 0xFFFFFFFF
            else:
                length = source.stat().st_size
                checksum = 0
                with source.open("rb") as data_file:
                    while True:
                        block = data_file.read(1024 * 1024)
                        if not block:
                            break
                        checksum = zlib.crc32(block, checksum) & 0xFFFFFFFF
            limit = 500_000 if is_manifest else MAX_CLIP_BYTES
            if not 0 < length <= limit:
                raise ExportError("Archivo del paquete fuera del tamaño permitido.")
            offset = archive.tell()
            archive.write(struct.pack(
                "<IHHHHHIIIHH", 0x04034B50, 20, 0x0800, 0, 0, 0,
                checksum, length, length, len(encoded), 0))
            archive.write(encoded)
            if is_manifest:
                archive.write(source)
            else:
                written = 0
                copied_crc = 0
                with source.open("rb") as data_file:
                    while True:
                        block = data_file.read(1024 * 1024)
                        if not block:
                            break
                        archive.write(block)
                        written += len(block)
                        copied_crc = zlib.crc32(block, copied_crc) & 0xFFFFFFFF
                if written != length or copied_crc != checksum:
                    raise ExportError("Un clip temporal cambió al crear el ZIP.")
            central.append(struct.pack(
                "<IHHHHHHIIIHHHHHII", 0x02014B50, 20, 20, 0x0800, 0,
                0, 0, checksum, length, length, len(encoded), 0, 0,
                0, 0, 0, offset) + encoded)
        central_start = archive.tell()
        for record in central:
            archive.write(record)
        central_size = archive.tell() - central_start
        archive.write(struct.pack(
            "<IHHHHIIH", 0x06054B50, 0, 0, len(central), len(central),
            central_size, central_start, 0))
        if archive.tell() > MAX_ZIP_BYTES:
            raise ExportError("El ZIP excede 16 MiB. Reduce los cortes seleccionados.")


def inspect_project(source, project_file):
    """Validate the project, source and sampled fingerprint without decoding media.

    This quick, offline preflight can be called from the GUI before conversion.
    Export always repeats it, so a stale validation cannot authorize publication.
    """
    source = Path(source).expanduser().resolve()
    project_file = Path(project_file).expanduser().resolve()
    if (source == project_file or
            source.suffix.lower().lstrip(".") not in EXTENSIONS or
            project_file.suffix.lower() != ".json" or
            not source.is_file() or not project_file.is_file()):
        raise ExportError("Selecciona la grabación original y un proyecto JSON válido.")
    info = source.stat()
    project_size = project_file.stat().st_size
    if not 0 < info.st_size <= MAX_SOURCE_BYTES or not 0 < project_size <= MAX_PROJECT_BYTES:
        raise ExportError("Archivo fuente o proyecto vacío o por encima de los límites.")
    try:
        with project_file.open("r", encoding="utf-8") as file:
            project = json.load(file)
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ExportError("El proyecto JSON no se pudo leer.") from exc
    clips = validate_project(project, info.st_size)
    source_hash = fingerprint_file(source, info.st_size)
    if source_hash != project["sourceSampleSha256"].lower():
        raise ExportError("La huella parcial no coincide: selecciona la grabación original.")
    return {
        "source": source,
        "project": project_file,
        "info": info,
        "clips": clips,
        "source_hash": source_hash,
        "duration_seconds": sum(
            sum(r["end"] - r["start"] for r in clip.get("ranges",
                [{"start": clip["start"], "end": clip["end"]}]))
            for clip in clips),
        "unreviewed_roles": sum(clip["speakerRole"] == "unknown" for clip in clips),
    }


def export_project(source, project_file, output, *, ffmpeg=None,
                   on_progress=None, cancelled=None):
    """Export a STORE ZIP consumable by the existing Intérpretes RD importer.

    The full input video is never decoded/buffered. The original is not uploaded.
    Existing output files are never overwritten (including symlinks).
    """
    output = Path(output).expanduser().absolute()
    if output.suffix.lower() != ".zip" or output.resolve(strict=False) in (
            Path(source).expanduser().resolve(), Path(project_file).expanduser().resolve()):
        raise ExportError("Selecciona una salida ZIP distinta de la grabación y del proyecto.")
    # Fail before processing; the exclusive create below repeats this protection.
    if output.exists() or output.is_symlink():
        raise ExportError("El ZIP de salida ya existe. Elige un nombre nuevo.")
    inspected = inspect_project(source, project_file)
    source = inspected["source"]
    info = inspected["info"]
    clips = inspected["clips"]
    before_hash = inspected["source_hash"]

    ffmpeg = ffmpeg or resolve_ffmpeg()
    cancelled = cancelled or threading.Event()
    with tempfile.TemporaryDirectory(prefix="ir-studio-desktop-") as tmp:
        work = Path(tmp)
        clip_files = []
        manifest = {"version": 1,
                    "generator": "interpretes-rd-roleplay-studio",
                    "segments": []}
        total_bytes = 0
        for index, clip in enumerate(clips):
            if cancelled.is_set():
                raise ExportCancelled("Exportación cancelada.")
            name = f"segment-{index + 1:02d}.mp3"
            target = work / name
            transcode_clip(source, target, clip, ffmpeg, cancelled)
            size = target.stat().st_size
            if not 0 < size <= MAX_CLIP_BYTES:
                raise ExportError("Uno de los clips excede el tamaño permitido.")
            total_bytes += size
            if total_bytes > MAX_ZIP_BYTES:
                raise ExportError("El ZIP excedería 16 MiB. Reduce los cortes seleccionados.")
            with target.open("rb") as file:
                digest = hashlib.file_digest(file, "sha256").hexdigest()
            manifest["segments"].append({
                "order": index,
                "title": clip["title"].strip(),
                "file": name,
                "size_bytes": size,
                "sha256": digest,
                "duration_limit_sec": clip["responseLimit"],
                "script_prompt": clip["scriptPrompt"],
            })
            clip_files.append((name, target))
            if on_progress:
                on_progress(index + 1, len(clips))

        temp_zip = work / "roleplay-studio.zip"
        write_studio_store_zip(temp_zip, manifest, clip_files)

        after = source.stat()
        if (info.st_size != after.st_size or info.st_mtime_ns != after.st_mtime_ns or
                before_hash != fingerprint_file(source, after.st_size)):
            raise ExportError("La grabación original cambió durante la exportación.")
        if cancelled.is_set():
            raise ExportCancelled("Exportación cancelada.")

        # Exclusive creation prevents overwriting an existing ZIP or following
        # a pre-existing symbolic link. Remove only files we created on failure.
        created = False
        try:
            # Python Path.open('xb') uses mode 0o666 before umask, which may
            # expose confidential medical recordings on shared POSIX machines.
            # Create exclusively with 0o600 instead (Windows inherits ACLs).
            flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0)
            fd = os.open(output, flags, 0o600)
            created = True
            with os.fdopen(fd, "wb") as destination:
                with temp_zip.open("rb") as file:
                    shutil.copyfileobj(file, destination, length=1024 * 1024)
            if cancelled.is_set():
                raise ExportCancelled("Exportación cancelada.")
        except FileExistsError as exc:
            raise ExportError("El ZIP de salida ya existe. Elige un nombre nuevo.") from exc
        except Exception:
            if created:
                output.unlink(missing_ok=True)
            raise
    return {"clips": len(clips), "size_bytes": output.stat().st_size}


def suggest_local_zip_path(project_file):
    """Suggest a generic non-existing ZIP beside the JSON, without overwriting.

    Final export repeats an exclusive O_EXCL create, preventing symlink or
    concurrent overwrite races even if the suggested name is later taken.
    """
    project = Path(project_file).expanduser().absolute()
    if project.suffix.lower() != ".json":
        raise ExportError("Selecciona primero un proyecto JSON válido.")
    for number in range(1, 1001):
        name = ("roleplay-studio.zip" if number == 1
                else f"roleplay-studio-{number}.zip")
        candidate = project.parent / name
        if not candidate.exists() and not candidate.is_symlink():
            return str(candidate)
    raise ExportError("No hay un nombre ZIP disponible en esta carpeta. Elige otra ubicación.")


def recognize_media_and_project(selected):
    """Resolve one source and one JSON from a single file-picker interaction."""
    if len(selected) != 2:
        raise ExportError("Selecciona exactamente dos archivos: grabación y proyecto JSON.")
    sources = [path for path in selected if
               Path(path).suffix.lower().lstrip(".") in EXTENSIONS]
    projects = [path for path in selected if
                Path(path).suffix.lower() == ".json"]
    if len(sources) != 1 or len(projects) != 1 or sources[0] == projects[0]:
        raise ExportError("Selecciona una grabación compatible y un único proyecto JSON.")
    return sources[0], projects[0]


def run_desktop():
    # The Windows console bootloader is more reliable with the bundled FFmpeg.
    # Hide its terminal only in packaged GUI mode; keep it visible for diagnostics.
    if os.name == "nt" and getattr(sys, "frozen", False):
        try:
            import ctypes
            console = ctypes.windll.kernel32.GetConsoleWindow()
            process_ids = (ctypes.c_ulong * 8)()
            # Hide only a new private console created for this EXE. A user
            # launching it from PowerShell must never lose their terminal.
            attached = ctypes.windll.kernel32.GetConsoleProcessList(process_ids, 8)
            if console and attached == 1:
                ctypes.windll.user32.ShowWindow(console, 0)
        except (AttributeError, OSError):
            pass
    # Lazy import: headless unit tests and CI must not require a GUI/display.
    import tkinter as tk
    from tkinter import filedialog, messagebox, ttk

    root = tk.Tk()
    root.title("Intérpretes RD · Exportador Local de Roleplay")
    root.minsize(630, 325)
    frame = ttk.Frame(root, padding=20)
    frame.grid(sticky="nsew")
    root.columnconfigure(0, weight=1)
    frame.columnconfigure(1, weight=1)

    labels = (
        ("Grabación original", [("Audio o video", "*.mp3 *.m4a *.wav *.aac *.ogg *.oga *.opus *.flac *.mp4 *.m4v *.mov *.webm *.mkv")]),
        ("Proyecto de Audio Studio", [("Proyecto JSON", "*.json")]),
        ("Paquete de salida", [("Paquete ZIP", "*.zip")]),
    )
    fields = [tk.StringVar(), tk.StringVar(), tk.StringVar()]
    input_widgets = []
    browse_buttons = []
    suggested_output = None
    busy = False
    cancelled = threading.Event()
    events = queue.Queue()

    def propose_output():
        nonlocal suggested_output
        current = fields[2].get().strip()
        if not fields[1].get().strip() or (current and current != suggested_output):
            return
        try:
            destination = suggest_local_zip_path(fields[1].get())
        except ExportError:
            return
        suggested_output = destination
        fields[2].set(destination)

    def pick_pair():
        selected = filedialog.askopenfilenames(
            title="Selecciona la grabación y su proyecto JSON",
            filetypes=[("Grabación y JSON",
                        "*.mp3 *.m4a *.wav *.aac *.ogg *.oga *.opus *.flac "
                        "*.mp4 *.m4v *.mov *.webm *.mkv *.json"),
                       ("Todos los archivos", "*.*")],
        )
        if not selected:
            return
        # Tk cannot select files from two directories in a single dialog.
        # A one-file selection seamlessly opens the complementary picker.
        if len(selected) == 1:
            first = selected[0]
            if Path(first).suffix.lower() == ".json":
                second = filedialog.askopenfilename(
                    title="Ahora selecciona la grabación original",
                    filetypes=labels[0][1])
            elif Path(first).suffix.lower().lstrip(".") in EXTENSIONS:
                second = filedialog.askopenfilename(
                    title="Ahora selecciona el proyecto JSON",
                    filetypes=labels[1][1])
            else:
                messagebox.showwarning(
                    "Archivo no válido", "Selecciona una grabación o un proyecto JSON.")
                return
            if not second:
                return
            selected = (first, second)
        try:
            source, project = recognize_media_and_project(selected)
        except ExportError as exc:
            messagebox.showwarning("Selección incompleta", str(exc))
            return
        fields[0].set(source)
        fields[1].set(project)
        propose_output()

    def pick(index):
        if index == 2:
            path = filedialog.asksaveasfilename(
                title="Guardar paquete sin sobrescribir archivos",
                defaultextension=".zip", filetypes=labels[index][1],
            )
        else:
            path = filedialog.askopenfilename(
                title=labels[index][0], filetypes=labels[index][1],
            )
        if path:
            fields[index].set(path)
            if index == 1:
                propose_output()

    pair_button = ttk.Button(frame, text="Elegir grabación + JSON (2 archivos)",
                             command=pick_pair)
    pair_button.grid(row=0, column=0, columnspan=3, sticky="w", pady=(0, 8))
    browse_buttons.append(pair_button)
    for index, (label, _) in enumerate(labels):
        ttk.Label(frame, text=label).grid(row=index + 1, column=0, sticky="w", pady=8)
        entry = ttk.Entry(frame, textvariable=fields[index], width=58)
        entry.grid(row=index + 1, column=1, sticky="ew", padx=(12, 8))
        input_widgets.append(entry)
        browse = ttk.Button(frame, text="Examinar…",
                            command=lambda i=index: pick(i))
        browse.grid(row=index + 1, column=2)
        browse_buttons.append(browse)

    ttk.Label(frame, text="Sin subidas · FFmpeg en tu equipo · ZIP compatible con Intérpretes RD",
              foreground="#24635b").grid(row=4, column=0, columnspan=3, sticky="w", pady=(16, 8))
    bar = ttk.Progressbar(frame, maximum=100, mode="determinate")
    bar.grid(row=5, column=0, columnspan=3, sticky="ew", pady=(4, 6))
    status = tk.StringVar(value="Selecciona el audio/video y el proyecto JSON.")
    ttk.Label(frame, textvariable=status, wraplength=580).grid(
        row=6, column=0, columnspan=3, sticky="w", pady=6)

    def invalidate_previous_summary(*_):
        if not busy:
            bar["value"] = 0
            status.set("Archivos modificados. Valida el proyecto o genera el ZIP.")

    for field in fields:
        field.trace_add("write", invalidate_previous_summary)

    controls = ttk.Frame(frame)
    controls.grid(row=7, column=0, columnspan=3, sticky="e", pady=10)

    def set_editable(enabled):
        state = "normal" if enabled else "disabled"
        for widget in input_widgets + browse_buttons:
            widget.configure(state=state)

    def inspect_worker(paths):
        try:
            inspection = inspect_project(paths[0], paths[1])
            if cancelled.is_set():
                events.put(("cancelled",))
            else:
                events.put(("inspected", len(inspection["clips"]),
                            inspection["duration_seconds"],
                            inspection["unreviewed_roles"]))
        except (ExportError, OSError) as exc:
            events.put(("error", str(exc)))
        except Exception:
            events.put(("error", "No fue posible verificar el proyecto."))

    def worker(paths):
        try:
            result = export_project(*paths, cancelled=cancelled,
                                    on_progress=lambda done, total:
                                    events.put(("progress", done, total)))
            events.put(("success", result))
        except ExportCancelled:
            events.put(("cancelled",))
        except (ExportError, OSError) as exc:
            events.put(("error", str(exc)))
        except Exception:
            events.put(("error", "Error inesperado del exportador local."))

    def begin_job(kind):
        nonlocal busy
        if busy:
            return
        paths = [field.get().strip() for field in fields]
        if not paths[0] or not paths[1] or (kind == "export" and not paths[2]):
            messagebox.showwarning(
                "Faltan archivos",
                "Selecciona la grabación y el JSON; para exportar, también el ZIP de salida.")
            return
        cancelled.clear()
        bar["value"] = 0
        status.set("Verificando el proyecto sin subir archivos…" if kind == "inspect"
                   else "Preparando los fragmentos en este equipo…")
        busy = True
        set_editable(False)
        start_button.configure(state="disabled")
        inspect_button.configure(state="disabled")
        cancel_button.configure(state="normal")
        target = inspect_worker if kind == "inspect" else worker
        threading.Thread(target=target, args=(paths,), daemon=True).start()

    def cancel():
        if busy:
            cancelled.set()
            status.set("Cancelando FFmpeg y limpiando temporales…")

    inspect_button = ttk.Button(
        controls, text="Validar proyecto", command=lambda: begin_job("inspect"))
    inspect_button.pack(side="left", padx=6)
    start_button = ttk.Button(
        controls, text="Generar ZIP local", command=lambda: begin_job("export"))
    start_button.pack(side="left", padx=6)
    cancel_button = ttk.Button(controls, text="Cancelar", command=cancel, state="disabled")
    cancel_button.pack(side="left")

    closing = False

    def process_events():
        nonlocal busy, suggested_output
        while True:
            try:
                message = events.get_nowait()
            except queue.Empty:
                break
            kind = message[0]
            if kind == "progress":
                _, done, total = message
                bar["value"] = round(done / total * 100)
                status.set(f"Preparados {done} de {total} fragmentos.")
                continue
            busy = False
            set_editable(True)
            start_button.configure(state="normal")
            inspect_button.configure(state="normal")
            cancel_button.configure(state="disabled")
            if kind == "inspected":
                _, count, seconds, unreviewed = message
                status.set(
                    f"Coincidencia de archivos verificada: {count} intervenciones, "
                    f"{seconds / 60:.1f} min seleccionados. "
                    + (f"Atención: {unreviewed} hablante(s) sin identificar; "
                       "revisa si corresponde excluir al intérprete. "
                       if unreviewed else "")
                    + "La pista de audio se comprobará al generar el ZIP.")
            elif kind == "success":
                result = message[1]
                bar["value"] = 100
                exported_path = fields[2].get().strip()
                # Offer a fresh path for a second package only if the first
                # suggestion was accepted. Never replace a manual filename.
                if exported_path == suggested_output:
                    suggested_output = None
                    fields[2].set("")
                    propose_output()
                status.set(f"ZIP generado: {result['clips']} fragmentos. Guardado en: {exported_path}. "
                           "La grabación original permanece local.")
                messagebox.showinfo("Exportación terminada",
                                    f"El ZIP está guardado en:\\n{exported_path}")
            elif kind == "cancelled":
                status.set("Exportación cancelada; temporales eliminados.")
            else:
                status.set("No se pudo completar el paquete.")
                messagebox.showerror("Error de exportación", message[1])
        if closing and not busy:
            root.destroy()
        else:
            root.after(120, process_events)

    def on_close():
        nonlocal closing
        if busy:
            closing = True
            cancel()
        else:
            root.destroy()

    root.protocol("WM_DELETE_WINDOW", on_close)
    root.after(120, process_events)
    root.mainloop()


def self_check():
    """Non-GUI packaging smoke check; returns nonzero if FFmpeg is unavailable."""
    binary = resolve_ffmpeg()
    try:
        probe = subprocess.run([binary, "-hide_banner", "-version"],
                               stdin=subprocess.DEVNULL,
                               stdout=subprocess.DEVNULL,
                               stderr=subprocess.DEVNULL, timeout=10, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ExportError("El ejecutable FFmpeg incluido no funciona.") from exc
    if probe.returncode != 0:
        raise ExportError("El ejecutable FFmpeg incluido no funciona.")


if __name__ == "__main__":
    if len(sys.argv) == 2 and sys.argv[1] == "--self-check":
        try:
            self_check()
        except Exception as exc:
            # A Windows --windowed build has no console. Diagnostics are
            # permitted only in opt-in CI smoke tests, never during editing.
            diagnostic = os.environ.get("ROLEPLAY_STUDIO_SELF_CHECK_LOG")
            if diagnostic:
                try:
                    Path(diagnostic).write_text(
                        f"{type(exc).__name__}: {str(exc)}\\n", encoding="utf-8")
                except OSError:
                    pass
            sys.exit(1)
        sys.exit(0)
    run_desktop()
