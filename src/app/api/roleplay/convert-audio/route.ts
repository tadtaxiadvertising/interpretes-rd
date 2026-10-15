import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { join } from 'path';
import { writeFile, unlink, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import ffmpegPath from 'ffmpeg-static';
import { spawn } from 'child_process';
import { resolveCurrentIdentity } from '@/lib/identity/resolve-user';
import prisma from '@/lib/prisma';
import { applyRateLimit, createRateLimitHeaders, RATE_LIMITS } from '@/lib/security/rate-limit';

const BUCKET = 'roleplay-audio';
const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15 MB
const ALLOWED_MIME_TYPES = [
  'audio/webm',
  'audio/webm;codecs=opus',
  'audio/webm;codecs=pcm',
  'audio/mp4',
  'audio/ogg',
  'audio/mpeg',
];

// Signed URL durations (short-lived for security)
const VALIDATION_URL_DURATION = 15 * 60; // 15 minutes - for validate/start flow
const PLAYBACK_URL_DURATION = 60 * 60; // 1 hour - for playback during roleplay
const ADMIN_REVIEW_URL_DURATION = 60 * 60 * 24; // 24 hours - for QA review

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Supabase environment variables not configured');
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

async function checkUploadAccess(identity: Awaited<ReturnType<typeof resolveCurrentIdentity>>, sessionId: string, sessionCookie: string | null): Promise<{ hasAccess: boolean; session?: any; error?: string }> {
  const identityResult = identity;
  if (!identityResult) {
    return { hasAccess: false, error: 'Not authenticated' };
  }

  const session = await prisma.roleplaySession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      interpreterId: true,
      recruitmentCandidateId: true,
      status: true,
      access: { select: { usedAt: true, validatedAt: true, startedAt: true } },
    },
  });

  if (!session) {
    return { hasAccess: false, error: 'Session not found' };
  }

  // Admin has access to all
  if (identityResult.role === 'admin') {
    return { hasAccess: true, session };
  }

  // Check interpreter ownership
  if (session.interpreterId && identityResult.interpreterId === session.interpreterId) {
    const validStates = ['STARTED', 'IN_PROGRESS'];
    if (!validStates.includes(session.status)) {
      return { hasAccess: false, error: 'Session not in a valid state for recording' };
    }
    return { hasAccess: true, session };
  }

  // Candidate sessions are bound to the opaque, server-issued roleplay_session
  // cookie created by the invite/start flow. An authenticated user alone — or
  // an unused invitation that merely exists on the session — is NOT sufficient:
  // the caller must present the exact credential bound to this session.
  if (session.recruitmentCandidateId) {
    if (sessionCookie !== session.id) {
      return { hasAccess: false, error: 'Access denied' };
    }
    if (!['STARTED', 'IN_PROGRESS'].includes(session.status)) {
      return { hasAccess: false, error: 'Session not in a valid state for recording' };
    }
    return { hasAccess: true, session };
  }

  return { hasAccess: false, error: 'Access denied' };
}

function validateAudioFile(file: File): { valid: boolean; error?: string } {
  if (file.size === 0) {
    return { valid: false, error: 'File is empty' };
  }
  if (file.size > MAX_FILE_SIZE) {
    return { valid: false, error: 'File exceeds 15 MB limit' };
  }
  const normalizedMime = normalizeMimeType(file.type);
  if (!ALLOWED_MIME_TYPES.includes(normalizedMime)) {
    return { valid: false, error: `MIME type ${file.type} not allowed` };
  }
  return { valid: true };
}

function normalizeMimeType(mime: string): string {
  if (mime.startsWith('audio/webm')) return 'audio/webm';
  if (mime.startsWith('audio/mp4')) return 'audio/mp4';
  if (mime.startsWith('audio/ogg')) return 'audio/ogg';
  if (mime.startsWith('audio/mpeg')) return 'audio/mpeg';
  return mime;
}

async function convertToMp3(inputPath: string, outputPath: string): Promise<void> {
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
 * Queue async MP3 conversion job
 * In production, this would use BullMQ, pg-boss, or similar queue system
 * For now, we fire-and-forget with basic error logging
 */
async function queueMp3Conversion(sessionId: string, scenarioId: string, sourcePath: string): Promise<void> {
  // Fire and forget - don't await
  convertAndStoreMp3(sessionId, scenarioId, sourcePath).catch(err => {
    console.error(`[ASYNC CONVERSION] Failed for ${sessionId}/${scenarioId}:`, err);
    // Update response record with processing error
    // This would be done via a proper queue with retries in production
  });
}

async function convertAndStoreMp3(sessionId: string, scenarioId: string, sourcePath: string): Promise<void> {
  const tempDir = tmpdir();
  const inputPath = join(tempDir, `${sessionId}_${scenarioId}_input.webm`);
  const outputPath = join(tempDir, `${sessionId}_${scenarioId}_output.mp3`);

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
    const mp3Path = `responses/${sessionId}/${scenarioId}.mp3`;
    const { error: mp3UploadError } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(mp3Path, mp3Buffer, { contentType: 'audio/mpeg', upsert: true });

    if (mp3UploadError) {
      throw new Error(`Failed to upload MP3: ${mp3UploadError.message}`);
    }

    // Update RoleplayResponse with processed audio path
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();
    await prisma.roleplayResponse.updateMany({
      where: { 
        scenario: { 
          sessionId,
          order: parseInt(scenarioId.replace('scenario_', '')) || 0
        }
      },
      data: {
        processedAudioPath: mp3Path,
        audioStatus: 'READY',
      },
    });
    await prisma.$disconnect();

    console.log(`[ASYNC CONVERSION] Completed for ${sessionId}/${scenarioId}`);
  } catch (error) {
    // Update with error status
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();
    await prisma.roleplayResponse.updateMany({
      where: { 
        scenario: { 
          sessionId,
          order: parseInt(scenarioId.replace('scenario_', '')) || 0
        }
      },
      data: {
        audioStatus: 'FAILED',
        processingError: error instanceof Error ? error.message : 'Unknown error',
      },
    });
    await prisma.$disconnect();
    throw error;
  } finally {
    // Cleanup temp files
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
  }
}

export async function POST(req: NextRequest) {
  try {
    // Apply rate limiting
    const rateLimitResult = applyRateLimit(req, RATE_LIMITS.audioUpload);
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { success: false, error: 'Too many requests. Please try again later.' },
        { status: 429, headers: createRateLimitHeaders(rateLimitResult) }
      );
    }

    // Resolve identity and check access
    const identity = await resolveCurrentIdentity();
    if (!identity) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get('audio') as File;
    const sessionId = formData.get('sessionId') as string;
    const scenarioId = formData.get('scenarioId') as string;

    if (!file || !sessionId || !scenarioId) {
      return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 });
    }

    // Check upload access
    const sessionCookie = req.cookies.get('roleplay_session')?.value ?? null;
    const accessCheck = await checkUploadAccess(identity, sessionId, sessionCookie);
    if (!accessCheck.hasAccess) {
      return NextResponse.json({ success: false, error: accessCheck.error }, { status: 403 });
    }

    const validation = validateAudioFile(file);
    if (!validation.valid) {
      return NextResponse.json({ success: false, error: validation.error }, { status: 400 });
    }

    // Determine extension from MIME type
    const ext = file.type.includes('webm') ? 'webm' : 
                file.type.includes('mp4') ? 'mp4' :
                file.type.includes('ogg') ? 'ogg' : 'webm';
    
    const sourcePath = `responses/${sessionId}/${scenarioId}.${ext}`;
    
    // Upload original WebM/Opus to Supabase (PRIMARY STORAGE)
    const { error: uploadError } = await getSupabaseAdmin().storage
      .from(BUCKET)
      .upload(sourcePath, file, { contentType: file.type, upsert: true });

    if (uploadError) {
      return NextResponse.json({ success: false, error: 'Failed to upload original audio' }, { status: 500 });
    }

    // Get short-lived signed URL for immediate playback (15 min for validation, 1 hour for playback)
    const { data: signedUrlData } = await getSupabaseAdmin().storage
      .from(BUCKET)
      .createSignedUrl(sourcePath, PLAYBACK_URL_DURATION);

    if (!signedUrlData?.signedUrl) {
      return NextResponse.json({ success: false, error: 'Failed to create signed URL' }, { status: 500 });
    }

    const playbackUrl = signedUrlData.signedUrl;

    // Queue async MP3 conversion (non-blocking)
    // Only if the original is WebM and we need MP3 for compatibility
    const needsMp3 = file.type.includes('webm');
    if (needsMp3) {
      queueMp3Conversion(sessionId, scenarioId, sourcePath);
    }

    return NextResponse.json({ 
      success: true, 
      data: { 
        sourceUrl: playbackUrl,
        sourcePath,
        audioStatus: needsMp3 ? 'UPLOADED' : 'READY',
        // Include MP3 URL if already available (will be populated after async conversion)
        processedUrl: null,
        processedPath: null,
      } 
    });
  } catch (error) {
    console.error('Audio upload error:', error);
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}