import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { resolveCurrentIdentity } from '@/lib/identity/resolve-user';
import prisma from '@/lib/prisma';
import { applyRateLimit, createRateLimitHeaders, RATE_LIMITS } from '@/lib/security/rate-limit';
import { BUCKET, getSupabaseAdmin } from '@/lib/roleplay-audio-conversion';
import { confirmRoleplayResponse } from '@/app/actions/roleplay';

const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15 MB
const ALLOWED_MIME_TYPES = [
  'audio/webm',
  'audio/webm;codecs=opus',
  'audio/webm;codecs=pcm',
  'audio/mp4',
  'audio/ogg',
  'audio/mpeg',
];

async function checkUploadAccess(identity: Awaited<ReturnType<typeof resolveCurrentIdentity>>, sessionId: string, sessionCookie: string | null): Promise<{ hasAccess: boolean; error?: string }> {
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

  // Response recordings are restricted to the participant roles accepted by
  // the canonical confirmation action; administrators manage scenarios, not
  // candidate/interpreter response recordings.
  if (identityResult.role === 'admin') {
    return { hasAccess: false, error: 'Access denied' };
  }

  // A recruitment session is candidate-owned; a historical interpreter link
  // must never grant another actor permission to upload into it.
  if (session.recruitmentCandidateId !== null) {
    if (
      identityResult.role !== 'candidate' ||
      identityResult.candidateId !== session.recruitmentCandidateId ||
      sessionCookie !== session.id
    ) {
      return { hasAccess: false, error: 'Access denied' };
    }
    if (!['STARTED', 'IN_PROGRESS'].includes(session.status)) {
      return { hasAccess: false, error: 'Session not in a valid state for recording' };
    }
    return { hasAccess: true };
  }

  if (
    session.interpreterId !== null &&
    identityResult.role === 'interpreter' &&
    identityResult.interpreterId === session.interpreterId
  ) {
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
  const normalized = mime.trim().toLowerCase();
  if (['audio/webm', 'audio/webm;codecs=opus', 'audio/webm;codecs=pcm'].includes(normalized)) return 'audio/webm';
  if (normalized === 'audio/mp4') return 'audio/mp4';
  if (normalized === 'audio/ogg') return 'audio/ogg';
  if (normalized === 'audio/mpeg') return 'audio/mpeg';
  return normalized;
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
    const file = formData.get('audio');
    const sessionId = formData.get('sessionId');
    const scenarioId = formData.get('scenarioId');

    if (!(file instanceof File) || typeof sessionId !== 'string' || typeof scenarioId !== 'string' || !sessionId || !scenarioId) {
      return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 });
    }

    // Check upload access
    const sessionCookie = req.cookies.get('roleplay_session')?.value ?? null;
    const accessCheck = await checkUploadAccess(identity, sessionId, sessionCookie);
    if (!accessCheck.hasAccess) {
      return NextResponse.json({ success: false, error: accessCheck.error }, { status: 403 });
    }

    // The session cookie proves access to the session, not to an arbitrary
    // scenario ID supplied in multipart form data. Bind the scenario to this
    // session before constructing a storage path or accepting an upload.
    const scenario = await prisma.roleplayScenario.findFirst({
      where: { id: scenarioId, sessionId },
      select: { id: true },
    });
    if (!scenario) {
      return NextResponse.json(
        { success: false, error: 'Scenario does not belong to this Roleplay session' },
        { status: 404 }
      );
    }

    // Once a response has been confirmed, its storage object is immutable.
    // This prevents a repeated or stale upload from replacing the audio that QA
    // will evaluate. Check before any storage write.
    const confirmedResponse = await prisma.roleplayResponse.findUnique({
      where: { scenarioId },
      select: { id: true },
    });
    if (confirmedResponse) {
      return NextResponse.json(
        { success: false, error: 'Audio already confirmed for this scenario' },
        { status: 409 }
      );
    }

    const validation = validateAudioFile(file);
    if (!validation.valid) {
      return NextResponse.json({ success: false, error: validation.error }, { status: 400 });
    }

    // Keep the storage suffix aligned with the normalized MIME type.
    // In particular, MPEG audio must be stored as .mp3, never mislabeled .webm.
    const normalizedMime = normalizeMimeType(file.type);
    const extensionByMime: Record<string, string> = {
      'audio/webm': 'webm',
      'audio/mp4': 'mp4',
      'audio/ogg': 'ogg',
      'audio/mpeg': 'mp3',
    };
    const ext = extensionByMime[normalizedMime];
    if (!ext) {
      return NextResponse.json({ success: false, error: 'Unsupported audio format' }, { status: 400 });
    }

    // Each upload attempt receives its own immutable object path. Concurrent or
    // late uploads can no longer overwrite the audio selected for QA.
    const uploadId = randomUUID();
    const sourcePath = `responses/${sessionId}/${scenarioId}/${uploadId}.${ext}`;

    // Upload original audio to Supabase (PRIMARY STORAGE)
    const { error: uploadError } = await getSupabaseAdmin().storage
      .from(BUCKET)
      .upload(sourcePath, file, { contentType: file.type, upsert: false });

    if (uploadError) {
      return NextResponse.json({ success: false, error: 'Failed to upload original audio' }, { status: 500 });
    }

    // Confirm through the canonical transactional path. This verifies the
    // stored object, persists the response, and enqueues WebM conversion in
    // the same transaction. Previously this endpoint returned a URL/path only,
    // leaving an uploaded object with no response row and no worker job.
    const confirmation = await confirmRoleplayResponse({
      sessionId,
      scenarioId,
      recordedAudioUrl: sourcePath,
      sourceAudioPath: sourcePath,
    });

    if (!confirmation.success || !confirmation.data) {
      const { error: cleanupError } = await getSupabaseAdmin().storage
        .from(BUCKET)
        .remove([sourcePath]);
      if (cleanupError) {
        console.error('Failed to clean up unconfirmed Roleplay audio:', cleanupError.message);
      }
      const status = confirmation.code === 'CONFLICT' ? 409
        : confirmation.code === 'FORBIDDEN' || confirmation.code === 'UNAUTHORIZED' ? 403
        : 400;
      return NextResponse.json(
        { success: false, error: confirmation.error || 'Unable to confirm uploaded audio' },
        { status }
      );
    }

    const needsMp3 = normalizedMime === 'audio/webm';
    return NextResponse.json({
      success: true,
      data: {
        sourceUrl: confirmation.data.recordedAudioUrl,
        sourcePath,
        audioStatus: needsMp3 ? 'UPLOADED' : 'READY',
        processedUrl: null,
        processedPath: null,
      },
    });
  } catch (error) {
    console.error('Audio upload error:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Unable to process audio upload' 
    }, { status: 500 });
  }
}
