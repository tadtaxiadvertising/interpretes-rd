import { createClient } from '@supabase/supabase-js';
import { join } from 'path';
import { writeFile, unlink, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import ffmpegPath from 'ffmpeg-static';
import { spawn } from 'child_process';
import { randomUUID } from 'node:crypto';

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

function convertToMp3(inputPath: string, outputPath: string): Promise<void> {
  const ffmpegBinary = ffmpegPath;
  if (!ffmpegBinary) return Promise.reject(new Error('FFmpeg binary is not available in this runtime'));

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(ffmpegBinary, [
      '-nostdin',
      '-threads', '1',
      '-i', inputPath,
      '-t', '300',
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
      else finish(new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-2_000)}`));
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
    const mp3Path = sourcePath.replace(/\.webm$/i, '.mp3');
    if (mp3Path === sourcePath) throw new Error('MP3 conversion requires a WebM source path');
    const { error: mp3UploadError } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(mp3Path, mp3Buffer, { contentType: 'audio/mpeg', upsert: true });

    if (mp3UploadError) {
      throw new Error(`Failed to upload MP3: ${mp3UploadError.message}`);
    }

    // Storage writes are idempotent for this deterministic object path. The
    // worker commits the response path only after its queue lease is verified.
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
