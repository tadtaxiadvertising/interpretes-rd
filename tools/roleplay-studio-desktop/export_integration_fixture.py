#!/usr/bin/env python3
"""Test-only bridge from a browser-generated JSON project to real FFmpeg.

Run exclusively on local synthetic data generated in the TypeScript test.
No network access, real recordings, source modifications or server-side jobs.
"""
import json
import sys
from desktop_exporter import export_project


def main(argv):
    if len(argv) != 4:
        raise SystemExit(
            "usage: export_integration_fixture.py SOURCE.mp4 PROJECT.json OUT.zip FFMPEG"
        )
    source, project, output, ffmpeg = argv
    result = export_project(source, project, output, ffmpeg=ffmpeg)
    print(json.dumps(result))


if __name__ == "__main__":
    main(sys.argv[1:])
