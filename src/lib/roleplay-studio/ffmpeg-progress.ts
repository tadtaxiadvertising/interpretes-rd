/**
 * FFmpeg's process exit code alone does not prove a requested segment exists:
 * exporting beyond input EOF can still return 0 with a shorter MP3.
 * `-progress pipe:2` reports the actual encoded output duration.
 */
export function parseFinalFfmpegOutputSeconds(stderr: string): number | null {
  let latestSeconds: number | null = null;
  let finalSeconds: number | null = null;
  for (const rawLine of stderr.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith('out_time=')) {
      const match = /^out_time=(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(line);
      if (!match) {
        latestSeconds = null;
        continue;
      }
      const h = Number(match[1]);
      const m = Number(match[2]);
      const s = Number(match[3]);
      latestSeconds = Number.isFinite(h) && Number.isFinite(m) && Number.isFinite(s)
        && m < 60 && s < 60 ? h * 3600 + m * 60 + s : null;
    } else if (line === 'progress=end') {
      finalSeconds = latestSeconds;
    }
  }
  return finalSeconds;
}
