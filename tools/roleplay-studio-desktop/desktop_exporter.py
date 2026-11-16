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
import subprocess
import tempfile
import threading
import time
import zipfile

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
            project.get("version") != 1 or type(project.get("version")) is bool or
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
                end - start < 0.1 or end - start > 300 or
                end > project["sourceDurationSeconds"] + 0.1 or
                type(prompt) is not str or len(prompt) > 5000 or
                not _int(limit) or not 0 <= limit <= 300 or
                type(role) is not str or role not in ROLES or
                type(language) is not str or language not in LANGUAGES):
            raise ExportError("Revisa títulos, perfiles, tiempos o instrucciones inválidos.")
        if role == "interpreter":
            raise ExportError("Hay un fragmento del intérprete original. Exclúyelo antes de exportar.")
        total += end - start
        if total > MAX_TOTAL_SECONDS + 1e-6:
            raise ExportError("El ZIP supera los 15 minutos acumulados de audio.")
        last_end = end
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
    length = clip["end"] - clip["start"]
    command = [
        ffmpeg, "-hide_banner", "-nostdin", "-loglevel", "error",
        "-ss", str(clip["start"]), "-i", str(source),
        "-t", str(length), "-map", "0:a:0", "-vn",
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


def export_project(source, project_file, output, *, ffmpeg=None,
                   on_progress=None, cancelled=None):
    """Export a STORE ZIP consumable by the existing Intérpretes RD importer.

    The full input video is never decoded/buffered. The original is not uploaded.
    Existing output files are never overwritten (including symlinks).
    """
    source = Path(source).expanduser().resolve()
    project_file = Path(project_file).expanduser().resolve()
    output = Path(output).expanduser().absolute()
    if (len({str(source), str(project_file), str(output)}) != 3 or
            source.suffix.lower().lstrip(".") not in EXTENSIONS or
            project_file.suffix.lower() != ".json" or
            output.suffix.lower() != ".zip"):
        raise ExportError("Selecciona una grabación, un proyecto JSON y un ZIP de salida distintos.")
    if not source.is_file() or not project_file.is_file():
        raise ExportError("No se encontró la grabación o el proyecto JSON.")
    info = source.stat()
    project_size = project_file.stat().st_size
    if not 0 < info.st_size <= MAX_SOURCE_BYTES or not 0 < project_size <= MAX_PROJECT_BYTES:
        raise ExportError("Archivo fuente o proyecto vacío o por encima de los límites.")
    # Reject the destination before spending CPU; exclusive create repeats this.
    if output.exists() or output.is_symlink():
        raise ExportError("El ZIP de salida ya existe. Elige un nombre nuevo.")

    try:
        with project_file.open("r", encoding="utf-8") as file:
            project = json.load(file)
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ExportError("El proyecto JSON no se pudo leer.") from exc
    clips = validate_project(project, info.st_size)
    before_hash = fingerprint_file(source, info.st_size)
    if before_hash != project["sourceSampleSha256"].lower():
        raise ExportError("La huella parcial no coincide: selecciona la grabación original.")

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
        with zipfile.ZipFile(temp_zip, mode="w", compression=zipfile.ZIP_STORED,
                             allowZip64=False) as archive:
            archive.writestr("manifest.json", json.dumps(
                manifest, ensure_ascii=False, indent=2).encode("utf-8"))
            for name, path in clip_files:
                archive.write(path, arcname=name, compress_type=zipfile.ZIP_STORED)
        if temp_zip.stat().st_size > MAX_ZIP_BYTES:
            raise ExportError("El ZIP excede 16 MiB. Reduce los cortes seleccionados.")

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
            with output.open("xb") as destination:
                created = True
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


def run_desktop():
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
    busy = False
    cancelled = threading.Event()
    events = queue.Queue()

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

    for index, (label, _) in enumerate(labels):
        ttk.Label(frame, text=label).grid(row=index, column=0, sticky="w", pady=8)
        ttk.Entry(frame, textvariable=fields[index], width=58).grid(
            row=index, column=1, sticky="ew", padx=(12, 8))
        ttk.Button(frame, text="Examinar…",
                   command=lambda i=index: pick(i)).grid(row=index, column=2)

    ttk.Label(frame, text="Sin subidas · FFmpeg en tu equipo · ZIP compatible con Intérpretes RD",
              foreground="#24635b").grid(row=3, column=0, columnspan=3, sticky="w", pady=(16, 8))
    bar = ttk.Progressbar(frame, maximum=100, mode="determinate")
    bar.grid(row=4, column=0, columnspan=3, sticky="ew", pady=(4, 6))
    status = tk.StringVar(value="Selecciona el audio/video y el proyecto JSON.")
    ttk.Label(frame, textvariable=status, wraplength=580).grid(
        row=5, column=0, columnspan=3, sticky="w", pady=6)
    controls = ttk.Frame(frame)
    controls.grid(row=6, column=0, columnspan=3, sticky="e", pady=10)

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

    def begin():
        nonlocal busy
        if busy:
            return
        paths = [field.get().strip() for field in fields]
        if not all(paths):
            messagebox.showwarning("Faltan archivos", "Selecciona los tres archivos.")
            return
        cancelled.clear()
        bar["value"] = 0
        status.set("Preparando los fragmentos en este equipo…")
        busy = True
        start_button.configure(state="disabled")
        cancel_button.configure(state="normal")
        threading.Thread(target=worker, args=(paths,), daemon=True).start()

    def cancel():
        if busy:
            cancelled.set()
            status.set("Cancelando FFmpeg y limpiando temporales…")

    start_button = ttk.Button(controls, text="Generar ZIP local", command=begin)
    start_button.pack(side="left", padx=6)
    cancel_button = ttk.Button(controls, text="Cancelar", command=cancel, state="disabled")
    cancel_button.pack(side="left")

    closing = False

    def process_events():
        nonlocal busy
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
            start_button.configure(state="normal")
            cancel_button.configure(state="disabled")
            if kind == "success":
                result = message[1]
                bar["value"] = 100
                status.set(f"ZIP generado: {result['clips']} fragmentos. El video original permanece local.")
                messagebox.showinfo("Exportación terminada", "Paquete ZIP generado correctamente.")
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


if __name__ == "__main__":
    run_desktop()
