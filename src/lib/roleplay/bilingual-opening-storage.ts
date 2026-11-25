import 'server-only';
import { execFile } from 'node:child_process';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';
import { getSignedBilingualOpeningAudioUrl } from '@/lib/roleplay';
import { ROLEPLAY_RESPONSE_MAX_DURATION_SEC } from '@/lib/roleplay-limits';
import { isCanonicalBilingualOpeningPath, BILINGUAL_OPENING_MAX_BYTES } from './bilingual-opening';

const MAX_BYTES = BILINGUAL_OPENING_MAX_BYTES;
const run = promisify(execFile);
const FORMATS: Record<string, string> = { webm: 'matroska', mp4: 'mov', ogg: 'ogg', mp3: 'mp3' };

export function measuredOpeningDuration(progress: string): number {
  // FFmpeg measures decoded audio samples after resetting timestamps.
  // Require a final progress marker, not an incomplete diagnostic.
  if (!/(?:^|\n)progress=end\s*$/.test(progress)) throw new Error('Invalid opening audio');
  const times = [...progress.matchAll(/^out_time_us=(\d+)\r?$/gm)];
  const seconds = Number(times.at(-1)?.[1]) / 1_000_000;
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > ROLEPLAY_RESPONSE_MAX_DURATION_SEC) {
    throw new Error('Invalid opening audio duration');
  }
  return Math.ceil(seconds);
}

/**
 * Staged server-only verification. Only call after authenticating the session
 * owner and resolving a server-issued immutable opening object key.
 * A signed URL is not confirmation: the actual bytes must be downloaded and
 * decoded successfully. Never call with a client URL or expose diagnostics.
 */
export async function verifyBilingualOpeningAudio(sessionId: string, sourceAudioPath: string) {
  if (!isCanonicalBilingualOpeningPath(sourceAudioPath, sessionId) ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(sessionId)) throw new Error('Invalid opening audio path');
  const format = FORMATS[sourceAudioPath.split('.').at(-1) ?? ''];
  if (!format || !ffmpegPath) throw new Error('Opening audio verification unavailable');
  let directory: string | undefined;
  try {
    directory = await mkdtemp(join(tmpdir(), 'roleplay-opening-'));
    const input = join(directory, 'recording');
    // Sign internally, use a short-lived URL and reject redirection.
    const url = await getSignedBilingualOpeningAudioUrl(sourceAudioPath, 120);
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30_000), cache: 'no-store' });
    if (!response.ok || !response.body) throw new Error('Audio unavailable');
    const length = response.headers.get('content-length');
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES || Number(length) < 1)) {
      await response.body.cancel().catch(() => {});
      throw new Error('Invalid audio size');
    }
    const reader = response.body.getReader();
    let size = 0;
    let file: Awaited<ReturnType<typeof open>> | undefined;
    try {
      file = await open(input, 'wx', 0o600);
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) throw new Error('Invalid audio size');
        await file.writeFile(value);
      }
      if (!size || (length !== null && size !== Number(length))) throw new Error('Invalid audio size');
    } finally {
      try { await reader.cancel(); } catch { /* Preserve original error. */ }
      reader.releaseLock();
      await file?.close();
    }

    // Restrict input demuxer/protocols and decode only the first audio stream.
    // A 301-second cap rejects overlength files without decoding indefinitely.
    const { stdout } = await run(ffmpegPath, [
      '-hide_banner', '-nostdin', '-v', 'error', '-xerror', '-threads', '1',
      '-protocol_whitelist', 'file,pipe', '-f', format, '-i', input,
      '-map', '0:a:0', '-vn', '-sn', '-dn', '-af', 'asetpts=N/SR/TB',
      '-t', String(ROLEPLAY_RESPONSE_MAX_DURATION_SEC + 1),
      '-progress', 'pipe:1', '-nostats', '-f', 'null', '-',
    ], { timeout: 45_000, killSignal: 'SIGKILL', maxBuffer: 256 * 1024 });
    return { sourceAudioPath, durationSec: measuredOpeningDuration(stdout) };
  } catch {
    throw new Error('Unable to verify opening audio');
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}
