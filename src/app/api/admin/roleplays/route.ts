import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { validateAction } from '@/lib/auth/actions';

const db = prisma;
const MAX_AUDIO_SIZE = 15 * 1024 * 1024;
const MAX_SCENARIOS = 10;
const MAX_TITLE = 200;
const MAX_SCRIPT_PROMPT = 5000;
const MAX_DURATION_SEC = 86400;
const ALLOWED_AUDIO_TYPES = new Set([
  'audio/webm',
  'audio/webm;codecs=opus',
  'audio/mp4',
  'audio/ogg',
  'audio/mpeg',
]);

// Statuses that block creating a new session for the same participant
// (create-or-resume invariant): a live or already-evaluated attempt must
// never be silently duplicated. DRAFT means an unfinished admin draft that
// this route may replace; EXPIRED/CANCELLED allow a fresh creation.
const BLOCKING_SESSION_STATUSES = [
  'INVITED',
  'STARTED',
  'IN_PROGRESS',
  'SUBMITTED',
  'UNDER_REVIEW',
  'EVALUATED',
  'PASSED',
  'FAILED',
] as const;

interface ScenarioInput {
  title: string;
  durationLimitSec: number | null;
  scriptPrompt: string | null;
}

function parseScenarios(raw: string): ScenarioInput[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > MAX_SCENARIOS) {
    return null;
  }

  const scenarios: ScenarioInput[] = [];
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) return null;
    const { title, durationLimitSec, scriptPrompt } = item as Record<string, unknown>;

    if (typeof title !== 'string' || !title.trim() || title.trim().length > MAX_TITLE) return null;

    let duration: number | null = null;
    if (durationLimitSec !== undefined && durationLimitSec !== null && durationLimitSec !== '') {
      const n = Number(durationLimitSec);
      if (!Number.isSafeInteger(n) || n < 0 || n > MAX_DURATION_SEC) return null;
      duration = n === 0 ? null : n;
    }

    let prompt: string | null = null;
    if (typeof scriptPrompt === 'string' && scriptPrompt.trim()) {
      if (scriptPrompt.length > MAX_SCRIPT_PROMPT) return null;
      prompt = scriptPrompt.trim();
    }

    scenarios.push({ title: title.trim(), durationLimitSec: duration, scriptPrompt: prompt });
  }
  return scenarios;
}

export async function POST(req: NextRequest) {
  let sessionId: string | null = null;
  let createdSession = false;
  let supabaseAdmin: ReturnType<typeof import('@supabase/supabase-js').createClient> | null = null;
  const uploadedPaths: string[] = [];

  try {
    const auth = await validateAction('admin');
    if ('error' in auth) return NextResponse.json({ success: false, error: auth.error }, { status: 403 });

    const formData = await req.formData();
    const participantType = formData.get('participantType');
    const participantId = formData.get('participantId');
    const rawScenarios = formData.get('scenarios');
    const scenarioAudios = formData.getAll('scenarioAudios');

    if (typeof participantType !== 'string' || typeof participantId !== 'string' || typeof rawScenarios !== 'string') {
      return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 });
    }

    if (participantType !== 'interpreter' && participantType !== 'candidate') {
      return NextResponse.json({ success: false, error: 'Invalid participant type' }, { status: 400 });
    }

    const parsedParticipantId = Number.parseInt(participantId, 10);
    if (!Number.isSafeInteger(parsedParticipantId) || parsedParticipantId <= 0) {
      return NextResponse.json({ success: false, error: 'Invalid participant ID' }, { status: 400 });
    }

    const scenarios = parseScenarios(rawScenarios);
    if (!scenarios) {
      return NextResponse.json(
        { success: false, error: `Invalid scenarios: expected 1-${MAX_SCENARIOS} entries with a non-empty title` },
        { status: 400 }
      );
    }

    if (scenarioAudios.length !== scenarios.length) {
      return NextResponse.json(
        { success: false, error: 'Each scenario requires exactly one base audio file' },
        { status: 400 }
      );
    }

    for (const audio of scenarioAudios) {
      if (!(audio instanceof File)) {
        return NextResponse.json({ success: false, error: 'Invalid scenario audio payload' }, { status: 400 });
      }
      if (audio.size <= 0 || audio.size > MAX_AUDIO_SIZE) {
        return NextResponse.json({ success: false, error: 'Audio must be between 1 byte and 15 MB' }, { status: 400 });
      }
      if (!ALLOWED_AUDIO_TYPES.has(audio.type)) {
        return NextResponse.json(
          { success: false, error: `Audio type ${audio.type || 'unknown'} not allowed` },
          { status: 400 }
        );
      }
    }

    if (participantType === 'interpreter') {
      const interpreter = await db.interpreter.findUnique({ where: { id: parsedParticipantId }, select: { id: true } });
      if (!interpreter) return NextResponse.json({ success: false, error: 'Interpreter not found' }, { status: 404 });
    } else {
      const candidate = await db.recruitmentCandidate.findUnique({ where: { id: parsedParticipantId }, select: { id: true } });
      if (!candidate) return NextResponse.json({ success: false, error: 'Candidate not found' }, { status: 404 });
    }

    // Create-or-resume invariant: never create a second live/evaluated
    // session for the same participant. Checked before any upload happens.
    const participantWhere =
      participantType === 'interpreter'
        ? { interpreterId: parsedParticipantId }
        : { recruitmentCandidateId: parsedParticipantId };

    const blockingSession = await db.roleplaySession.findFirst({
      where: { ...participantWhere, status: { in: [...BLOCKING_SESSION_STATUSES] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true },
    });
    if (blockingSession) {
      return NextResponse.json(
        {
          success: false,
          error: `Participant already has a roleplay session in status ${blockingSession.status}`,
          sessionId: blockingSession.id,
          status: blockingSession.status,
        },
        { status: 409 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json({ success: false, error: 'Storage is not configured' }, { status: 503 });
    }

    const { createClient } = await import('@supabase/supabase-js');
    supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

    // Resume an unfinished DRAFT by reusing its row (stable id => stable
    // invite link) and replacing its scenarios/audios with this submission.
    const draftSession = await db.roleplaySession.findFirst({
      where: { ...participantWhere, status: 'DRAFT' },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    let session: { id: string };
    if (draftSession) {
      session = { id: draftSession.id };
      await db.roleplayScenario.deleteMany({ where: { sessionId: draftSession.id } });
      try {
        const { data: staleFiles, error: listError } = await supabaseAdmin.storage
          .from('roleplay-audio')
          .list(`base/${draftSession.id}`);
        if (!listError && staleFiles && staleFiles.length > 0) {
          await supabaseAdmin.storage
            .from('roleplay-audio')
            .remove(staleFiles.map((f) => `base/${draftSession.id}/${f.name}`));
        }
      } catch (cleanupError) {
        console.error('Draft resume storage cleanup failed:', cleanupError);
      }
    } else {
      session = await db.roleplaySession.create({
        data: {
          interpreterId: participantType === 'interpreter' ? parsedParticipantId : null,
          recruitmentCandidateId: participantType === 'candidate' ? parsedParticipantId : null,
          baseAudioUrl: '',
          status: 'DRAFT',
        },
        select: { id: true },
      });
      createdSession = true;
    }
    sessionId = session.id;

    const audioUrls: string[] = [];
    for (let i = 0; i < scenarios.length; i++) {
      const audio = scenarioAudios[i] as File;
      const extension = audio.name.split('.').pop()?.toLowerCase() || 'webm';
      const path = `base/${session.id}/${i}.${extension}`;

      const { error: uploadError } = await supabaseAdmin.storage
        .from('roleplay-audio')
        .upload(path, audio, { contentType: audio.type, upsert: true });
      if (uploadError) throw new Error('Failed to upload audio');
      uploadedPaths.push(path);

      const { data: publicUrlData } = supabaseAdmin.storage.from('roleplay-audio').getPublicUrl(path);
      audioUrls.push(publicUrlData.publicUrl);
    }

    await db.$transaction(async (tx) => {
      for (let i = 0; i < scenarios.length; i++) {
        await tx.roleplayScenario.create({
          data: {
            sessionId: session.id,
            order: i,
            title: scenarios[i].title,
            baseAudioUrl: audioUrls[i],
            durationLimitSec: scenarios[i].durationLimitSec,
            scriptPrompt: scenarios[i].scriptPrompt,
            expectedKeys: [],
          },
          select: { id: true },
        });
      }
      // Legacy readers (intro screen, dashboard) still resolve the session-level
      // audio; keep it pointing at the first scenario's base audio.
      await tx.roleplaySession.update({
        where: { id: session.id },
        data: { baseAudioUrl: audioUrls[0] },
      });
    });

    const origin = process.env.FRONTEND_ORIGIN || 'https://freeinterpreters.com';
    let inviteLink = `${origin}/roleplays/${session.id}`;

    if (participantType === 'candidate') {
      const { randomBytes, createHash } = await import('crypto');
      const rawToken = randomBytes(32).toString('hex');
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      // Generate short invite code (8 chars alphanumeric)
      const inviteCode = randomBytes(4).toString('base64url').slice(0, 8).toUpperCase();

      await db.roleplayAccess.create({
        data: { sessionId: session.id, tokenHash, inviteCode, expiresAt },
      });

      inviteLink = `${origin}/r/${inviteCode}`;
    }

    return NextResponse.json({
      success: true,
      data: { sessionId: session.id, inviteLink, scenarioCount: scenarios.length },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Create Roleplay API Error:', message);

    // Best-effort cleanup: never leave a half-created session (no scenarios,
    // missing audios) behind after a failed create. A resumed DRAFT row is
    // kept (idempotent retry target) but reset to an empty draft.
    if (sessionId) {
      try {
        if (createdSession) {
          await db.roleplaySession.delete({ where: { id: sessionId } });
        } else {
          await db.roleplayScenario.deleteMany({ where: { sessionId } });
          await db.roleplaySession.update({ where: { id: sessionId }, data: { baseAudioUrl: '' } });
        }
      } catch (cleanupError) {
        console.error('Create Roleplay cleanup failed:', cleanupError);
      }
    }
    if (supabaseAdmin && uploadedPaths.length > 0) {
      try {
        await supabaseAdmin.storage.from('roleplay-audio').remove(uploadedPaths);
      } catch (cleanupError) {
        console.error('Create Roleplay storage cleanup failed:', cleanupError);
      }
    }

    const isUploadFailure = message === 'Failed to upload audio';
    return NextResponse.json(
      { success: false, error: isUploadFailure ? message : 'Failed to create roleplay' },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const auth = await validateAction('admin');
    if ('error' in auth) return NextResponse.json({ success: false, error: auth.error }, { status: 403 });

    const sessions = await db.roleplaySession.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        interpreter: { select: { id: true, name: true, externalId: true, emailCorporativo: true } },
        recruitmentCandidate: { select: { id: true, name: true, email: true } },
        qaScore: { select: { id: true, totalScore: true, criticalError: true } },
      },
    });

    return NextResponse.json({ success: true, data: sessions });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Get Roleplays Error:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
