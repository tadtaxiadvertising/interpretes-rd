#!/usr/bin/env python3
"""Emit a deterministic non-clinical ZIP fixture using the real desktop ZIP writer.

Intentionally does not access FFmpeg, media files, network resources or the GUI.
The generated dummy MP3 is only for testing ZIP parsing and SHA-256 contracts.
"""
import hashlib
from pathlib import Path
import sys

from desktop_exporter import write_studio_store_zip


def main(args):
    if len(args) != 1:
        raise SystemExit("Uso: python emit_native_zip_fixture.py RUTA_ZIP")
    target = Path(args[0])
    if target.suffix.lower() != ".zip":
        raise SystemExit("La ruta de salida debe terminar en .zip")
    clip = target.with_name("segment-01.mp3")
    # Not a playable recording: deliberately tiny, synthetic, harmless bytes.
    payload = b"ID3\x04\x00\x00\x00\x00\x00\x00roleplay-fixture"
    clip.write_bytes(payload)
    manifest = {
        "version": 1,
        "generator": "interpretes-rd-roleplay-studio",
        "segments": [{
            "order": 0,
            "title": "Triaje · dolor torácico (prueba sintética)",
            "file": "segment-01.mp3",
            "size_bytes": len(payload),
            "sha256": hashlib.sha256(payload).hexdigest(),
            "duration_limit_sec": 120,
            "script_prompt": "¿Puede describir el dolor? Solo contenido ficticio.",
        }],
    }
    write_studio_store_zip(target, manifest, [("segment-01.mp3", clip)])
    clip.unlink()


if __name__ == "__main__":
    main(sys.argv[1:])
