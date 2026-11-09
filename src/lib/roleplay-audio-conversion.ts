import { createClient } from '@supabase/supabase-js';
import { join } from 'path';
import { writeFile, unlink, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import ffmpegPath from 'ffmpeg-static';
import { spawn } from 'child_process';
import { randomUUID } from 'node:crypto';
import { ROLEPLAY_RESPONSE_MAX_DURATION_SEC } from '@/lib/roleplay-limits';

export const BUCKET = 'roleplay-audio';

export function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Supabase environment variables not configured');
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

const MAX_SOURCE_AUDIO_BYTES = 15 * 1024 * 1024;
const FFMPEG_TIMEOUT_MS = 3 * 60 * 1000;
// Probing the container metadata is cheap; keep it well below the conversion
// timeout so a malformed file cannot stall the worker.
const FFMPEG_PROBE_TIMEOUT_MS = 15 * 1000;
// Allow a small tolerance for container-level duration rounding. Anything
// beyond this is a real over-length recording and must fail instead of being
// silently truncated by `-t`.
const DURATION_TOLERANCE_SEC = 1;

// FFmpeg prints its version/configuration banner before the actual error. The
// worker persists a truncated copy of this message, so keeping the banner would
// hide the real cause (for example "Invalid data found when processing input").
const FFMPEG_BANNER_LINE = /^(ffmpeg version|built with|configuration:|lib(?:av|sw|postproc)\w*|copyright|--enable-)/i;

export function summarizeFfmpegStderr(stderr: string): string {
  const lines = stderr
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  const meaningful = lines.filter(line => !FFMPEG_BANNER_LINE.test(line));
  const selected = (meaningful.length > 0 ? meaningful : lines).slice(-8);
  return selected.join(' ').slice(-800);
}

/**
 * Parse the `Duration: HH:MM:SS.ss` line that FFmpeg prints for an input.
 * Exported for tests; the worker uses it to reject over-length recordings
 * before conversion instead of silently truncating them.
 */
export function parseFfmpegDurationSeconds(stderr: string): number | null {
  const match = stderr.match(/Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/);
  if (!match) return null;
  const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  if (!Number.isFinite(seconds)) return null;
  return Math.round(seconds * 1000) / 1000;
}

function probeAudioDurationSeconds(inputPath: string): Promise<number | null> {
  const ffmpegBinary = ffmpegPath;
  if (!ffmpegBinary) return Promise.resolve(null);

  return new Promise((resolve) => {
    const ffmpeg = spawn(ffmpegBinary, ['-hide_banner', '-nostdin', '-i', inputPath], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    let settled = false;

    const finish = (value: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(value);
    };

    const timeout = setTimeout(() => {
      ffmpeg.kill('SIGKILL');
      finish(null);
    }, FFMPEG_PROBE_TIMEOUT_MS);

    ffmpeg.stderr.on('data', (data: Buffer) => {
      if (stderr.length < 16_384) {
        stderr += data.toString().slice(0, 16_384 - stderr.length);
      }
    });

    ffmpeg.on('error', () => finish(null));
    // `ffmpeg -i` without an output exits non-zero by design; the duration is
    // already in stderr, so the exit code is irrelevant here.
    ffmpeg.on('close', () => finish(parseFfmpegDurationSeconds(stderr)));
  });
}

/**
 * Give every conversion attempt its own immutable object path. A worker that
 * loses its database lease may still finish an in-flight upload; unique paths
 * prevent that stale process from overwriting the current owner's MP3.
 */
export function buildProcessedAudioPath(sourcePath: string, attemptId: string): string {
  if (!/\.webm$/i.test(sourcePath)) {
    throw new Error('MP3 conversion requires a WebM source path');
  }
  if (!/^[a-zA-Z0-9-]{1,64}$/.test(attemptId)) {
    throw new Error('Invalid audio conversion attempt identifier');
  }
  return sourcePath.replace(/\.webm$/i, '.' + attemptId + '.mp3');
}

async function convertToMp3(inputPath: string, outputPath: string): Promise<void> {
  const ffmpegBinary = ffmpegPath;
  if (!ffmpegBinary) throw new Error('FFmpeg binary is not available in this runtime');

  // Never silently truncate. If the recorded container is longer than the
  // platform maximum, fail with an actionable message; the `-t` below remains
  // only as a defensive ceiling for inputs whose duration cannot be probed.
  const sourceDurationSec = await probeAudioDurationSeconds(inputPath);
  if (
    sourceDurationSec !== null &&
    sourceDurationSec > ROLEPLAY_RESPONSE_MAX_DURATION_SEC + DURATION_TOLERANCE_SEC
  ) {
    throw new Error(
      `Recording is ${Math.ceil(sourceDurationSec)} seconds long; the maximum is ${ROLEPLAY_RESPONSE_MAX_DURATION_SEC} seconds`,
    );
  }
  if (sourceDurationSec === null) {
    console.warn('[ASYNC CONVERSION] Could not determine source duration; applying the safety cap');
  }

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(ffmpegBinary, [
      '-nostdin',
      '-threads', '1',
      '-i', inputPath,
      '-t', String(ROLEPLAY_RESPONSE_MAX_DURATION_SEC),
      '-vn',
      '-ar', '44100',
      '-ac', '2',
      '-b:a', '128k',
      '-f', 'mp3',
      outputPath,
    ], { stdio: 'pipe' });

    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      ffmpeg.kill('SIGKILL');
      if (!settled) {
        settled = true;
        reject(new Error('FFmpeg conversion exceeded the 180-second time limit'));
      }
    }, FFMPEG_TIMEOUT_MS);

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve();
    };

    ffmpeg.stderr.on('data', (data: Buffer) => {
      if (stderr.length < 8_192) {
        stderr += data.toString().slice(0, 8_192 - stderr.length);
      }
    });

    ffmpeg.on('error', (error) => finish(new Error(`FFmpeg process error: ${error.message}`)));
    ffmpeg.on('close', (code) => {
      if (code === 0) finish();
      else finish(new Error(`FFmpeg exited with code ${code}: ${summarizeFfmpegStderr(stderr) || 'no stderr output'}`));
    });
  });
}

export async function convertAndStoreMp3(sessionId: string, scenarioId: string, sourcePath: string): Promise<string> {
  const tempDir = tmpdir();
  const attemptId = randomUUID();
  const inputPath = join(tempDir, `${attemptId}_input.webm`);
  const outputPath = join(tempDir, `${attemptId}_output.mp3`);

  try {
    // Copy source file to temp
    const supabaseAdmin = getSupabaseAdmin();
    const { data: fileData, error: downloadError } = await supabaseAdmin.storage
      .from(BUCKET)
      .download(sourcePath);

    if (downloadError || !fileData) {
      throw new Error(`Failed to download source audio: ${downloadError?.message}`);
    }
    if (fileData.size <= 0 || fileData.size > MAX_SOURCE_AUDIO_BYTES) {
      throw new Error('Source audio is empty or exceeds the 15 MB processing limit');
    }

    const buffer = Buffer.from(await fileData.arrayBuffer());
    await writeFile(inputPath, buffer);

    // Convert to MP3
    await convertToMp3(inputPath, outputPath);

    // Read converted MP3
    const mp3Buffer = await readFile(outputPath);

    // Upload MP3 to Supabase
    const mp3Path = buildProcessedAudioPath(sourcePath, attemptId);
    const { error: mp3UploadError } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(mp3Path, mp3Buffer, { contentType: 'audio/mpeg', upsert: false });

    if (mp3UploadError) {
      throw new Error(`Failed to upload MP3: ${mp3UploadError.message}`);
    }

    // Each attempt has an immutable path: a stale worker cannot overwrite the
    // current owner's object. The worker publishes only its own path after its
    // database lease is verified; orphan cleanup can run independently.
    console.log(`[ASYNC CONVERSION] Uploaded MP3 for ${sessionId}/${scenarioId}`);
    return mp3Path;
  } catch (error) {
    throw error;
  } finally {
    // Cleanup temp files
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
  }
}
