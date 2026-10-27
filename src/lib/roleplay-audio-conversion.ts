import { createClient } from '@supabase/supabase-js';
import { join } from 'path';
import { writeFile, unlink, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import ffmpegPath from 'ffmpeg-static';
import { spawn } from 'child_process';
import { randomUUID } from 'node:crypto';
import prisma from '@/lib/prisma';

export const BUCKET = 'roleplay-audio';

export function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Supabase environment variables not configured');
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

function convertToMp3(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(ffmpegPath!, [
      '-i', inputPath,
      '-vn',
      '-ar', '44100',
      '-ac', '2',
      '-b:a', '128k',
      '-f', 'mp3',
      outputPath,
    ]);

    let stderr = '';
    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ffmpeg.on('error', (err) => {
      reject(new Error(`FFmpeg error: ${err.message}`));
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg exited with code ${code}: ${stderr}`));
      }
    });
  });
}

/**
 * Queue async MP3 conversion job.
 * Fire-and-forget with basic error logging; the response record is updated
 * transactionally via the Prisma singleton when conversion completes.
 */
export function queueMp3Conversion(sessionId: string, scenarioId: string, sourcePath: string): void {
  convertAndStoreMp3(sessionId, scenarioId, sourcePath).catch(err => {
    console.error(`[ASYNC CONVERSION] Failed for ${sessionId}/${scenarioId}:`, err);
  });
}

export async function convertAndStoreMp3(sessionId: string, scenarioId: string, sourcePath: string): Promise<void> {
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

    // Update the response for this exact scenario (scenarioId is the FK; it is
    // a cuid, so it must never be parsed into a scenario `order`).
    await prisma.roleplayResponse.updateMany({
      where: { scenarioId, sourceAudioPath: sourcePath },
      data: {
        processedAudioPath: mp3Path,
        audioStatus: 'READY',
      },
    });

    console.log(`[ASYNC CONVERSION] Completed for ${sessionId}/${scenarioId}`);
  } catch (error) {
    await prisma.roleplayResponse.updateMany({
      where: { scenarioId, sourceAudioPath: sourcePath },
      data: {
        audioStatus: 'FAILED',
        processingError: error instanceof Error ? error.message : 'Unknown error',
      },
    });
    throw error;
  } finally {
    // Cleanup temp files
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
  }
}
