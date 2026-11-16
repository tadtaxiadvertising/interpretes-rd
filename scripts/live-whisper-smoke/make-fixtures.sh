#!/usr/bin/env bash
# CI-only, deterministic synthetic speech test fixtures. No user recordings.
set -euo pipefail

command -v espeak-ng >/dev/null || { echo "espeak-ng is required" >&2; exit 1; }
command -v ffmpeg >/dev/null || { echo "ffmpeg is required" >&2; exit 1; }

root="$(cd "$(dirname "$0")/../.." && pwd)"
out="$root/public/live-whisper-fixture"
temp="$(mktemp -d)"
trap 'rm -rf "$temp"' EXIT
mkdir -p "$out"

# Use freely generated speech, not third-party voice recordings or user audio.
espeak-ng -v en-us -s 142 -p 50 -w "$temp/en.wav" \
  'The patient has a fever and needs to see the doctor.'
espeak-ng -v es -s 140 -p 50 -w "$temp/es.wav" \
  'El paciente tiene fiebre y necesita ver al doctor.'

for lang in en es; do
  ffmpeg -nostdin -hide_banner -loglevel error -y \
    -i "$temp/$lang.wav" -ac 1 -ar 16000 -f f32le "$out/$lang.f32"
  test -s "$out/$lang.f32"
  # A 16kHz mono Float32 frame must have a whole sample count.
  bytes="$(wc -c < "$out/$lang.f32")"
  test $((bytes % 4)) -eq 0
done
echo "Prepared local synthetic spoken-phrase fixtures (ES/EN) without recording users."
