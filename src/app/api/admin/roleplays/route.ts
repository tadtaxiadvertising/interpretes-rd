import { NextRequest, NextResponse } from 'next/server';
import { privateRoleplayResponse as privateRoleplayJson } from '@/lib/roleplay/private-response';
import { revalidatePath } from 'next/cache';
import prisma from '@/lib/prisma';
import { validateAction } from '@/lib/auth/actions';
import { actorFromBearer } from '@/lib/api-auth';
import { z } from 'zod';
import { createHash, randomUUID } from 'crypto';
import { ROLEPLAY_MAX_SCENARIOS, ROLEPLAY_RESPONSE_MAX_DURATION_SEC } from '@/lib/roleplay-limits';
import { getReusableBaseAudioPath, getRoleplaySnapshotHash } from '@/lib/roleplay-library';
import { sha256RoleplayFile } from '@/lib/roleplay-streaming-checksum';
import { getAdminRoleplayAudioExtension } from '@/lib/roleplay/admin-audio-extension';
import {
  blockingAssignmentStatuses, candidateAssignmentScope, interpreterAssignmentScope,
} from '@/lib/roleplay-assignment-ownership';

const db = prisma;

/**
 * This admin route historically authorizes a browser cookie via validateAction.
 * If the caller explicitly supplies Authorization, require that verified
 * Bearer to represent the exact same admin identity as the cookie. Otherwise
 * the middleware could verify an interpreter Bearer while the handler uses a
 * different, privileged cookie identity.
 */
async function guardRoleplayAdmin(req: NextRequest): Promise<NextResponse | null> {
  const auth = await validateAction('admin');
  if ('error' in auth) {
    return privateRoleplayJson({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  if (req.headers.has('authorization')) {
    const bearer = await actorFromBearer(req);
    if (!bearer || bearer.role !== 'admin' || bearer.userId !== auth.user.userId) {
      return privateRoleplayJson({ success: false, error: 'Forbidden' }, { status: 403 });
    }
  }
  return null;
}

const MAX_AUDIO_SIZE = 15 * 1024 * 1024;
const MAX_TITLE = 200;
const MAX_SCRIPT_PROMPT = 5000;
const MAX_DURATION_SEC = ROLEPLAY_RESPONSE_MAX_DURATION_SEC;


interface ScenarioInput {
  title: string;
  durationLimitSec: number | null;
  scriptPrompt: string | null;
  studioTurn: number | null;
  studioSpeaker: string | null;
  studioLanguage: string | null;
  sourceStartSec: number | null;
  sourceEndSec: number | null;
  expectedKeys?: string[];
}

const scenarioPayloadSchema = z.array(z.object({
  title: z.string().trim().min(1).max(MAX_TITLE),
  durationLimitSec: z.union([z.number(), z.string(), z.null()]).optional(),
  scriptPrompt: z.string().max(MAX_SCRIPT_PROMPT).nullable().optional(),
  studioTurn: z.number().int().positive().max(10000).nullable().optional(),
  studioSpeaker: z.enum(['speaker_1', 'speaker_2', 'speaker_3']).nullable().optional(),
  studioLanguage: z.enum(['en', 'es', 'mixed']).nullable().optional(),
  sourceStartSec: z.number().finite().min(0).max(7200).nullable().optional(),
  sourceEndSec: z.number().finite().min(0).max(7200).nullable().optional(),
}).superRefine((item, ctx) => {
  const hasStart = item.sourceStartSec !== undefined && item.sourceStartSec !== null;
  const hasEnd = item.sourceEndSec !== undefined && item.sourceEndSec !== null;
  if (hasStart !== hasEnd || (hasStart && hasEnd && item.sourceEndSec! <= item.sourceStartSec!)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid source time range' });
  }
})).min(1).max(ROLEPLAY_MAX_SCENARIOS);

function parseScenarios(raw: string): ScenarioInput[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const validation = scenarioPayloadSchema.safeParse(parsed);
  if (!validation.success) return null;

  const scenarios: ScenarioInput[] = [];
  for (const item of validation.data) {
    let duration: number | null = null;
    if (item.durationLimitSec !== undefined && item.durationLimitSec !== null && item.durationLimitSec !== '') {
      const n = Number(item.durationLimitSec);
      if (!Number.isSafeInteger(n) || n < 0 || n > MAX_DURATION_SEC) return null;
      duration = n === 0 ? null : n;
    }
    const prompt = typeof item.scriptPrompt === 'string' && item.scriptPrompt.trim()
      ? item.scriptPrompt.trim()
      : null;
    scenarios.push({ title: item.title, durationLimitSec: duration, scriptPrompt: prompt, studioTurn: item.studioTurn ?? null, studioSpeaker: item.studioSpeaker ?? null, studioLanguage: item.studioLanguage ?? null, sourceStartSec: item.sourceStartSec ?? null, sourceEndSec: item.sourceEndSec ?? null });
  }
  return scenarios;
}

function firstTrustedBaseAudioPath(
  uploadedPaths: readonly string[],
  audioUrls: readonly string[],
  projectUrl: string | undefined,
): string | null {
  // A newly uploaded base object has the canonical path from Storage. For
  // library reuse, validate the original URL against this project's bucket
  // (the same invariant checked before assigning a library snapshot).
  return uploadedPaths[0] ??
    (audioUrls[0] && projectUrl ? getReusableBaseAudioPath(audioUrls[0], projectUrl) : null);
}

export async function POST(req: NextRequest) {
  let draftConflict = false;
  let libraryArchivedDuringAssignment = false;
  let supabaseAdmin: ReturnType<typeof import('@supabase/supabase-js').createClient> | null = null;
  const uploadedPaths: string[] = [];

  try {
    const forbidden = await guardRoleplayAdmin(req);
    if (forbidden) return forbidden;

    const formData = await req.formData();
    const participantType = formData.get('participantType');
    const participantId = formData.get('participantId');
    const rawScenarios = formData.get('scenarios');
    const scenarioAudios = formData.getAll('scenarioAudios');
    const rawAudioChecksums = formData.get('scenarioAudioSha256');
    const rawLibrarySessionId = formData.get('librarySessionId');
    const rawLibraryFingerprint = formData.get('libraryFingerprint');
    const useLibrary = rawLibrarySessionId !== null;
    if (useLibrary && (
      typeof rawLibrarySessionId !== 'string' ||
      !/^[a-zA-Z0-9_-]{5,120}$/.test(rawLibrarySessionId) ||
      typeof rawLibraryFingerprint !== 'string' ||
      !/^[a-f0-9]{64}$/.test(rawLibraryFingerprint) ||
      scenarioAudios.length !== 0 || rawAudioChecksums !== null
    )) {
      return privateRoleplayJson({ success: false, error: 'Invalid library source or audio payload' }, { status: 400 });
    }

    if (typeof participantType !== 'string' || (!useLibrary && typeof rawScenarios !== 'string')) {
      return privateRoleplayJson({ success: false, error: 'Missing required fields' }, { status: 400 });
    }

    const isBulk = participantType === 'all-active-interpreters';
    if (participantType !== 'interpreter' && participantType !== 'candidate' && !isBulk) {
      return privateRoleplayJson({ success: false, error: 'Invalid participant type' }, { status: 400 });
    }

    // Participant invitations must use the configured canonical application
    // origin. A fallback to an unrelated legacy domain can produce dead or
    // misleading links *after* database/storage writes have committed.
    // Bulk assignments do not generate a participant-specific invite URL.
    let frontendOrigin: string | null = null;
    if (!isBulk) {
      const configured = process.env.FRONTEND_ORIGIN;
      try {
        if (!configured || /[\s\u0000-\u001f\u007f]/u.test(configured)) throw new Error('invalid origin');
        const url = new URL(configured);
        const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
        if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback && process.env.NODE_ENV !== 'production')) ||
            url.username || url.password || url.search || url.hash || url.pathname !== '/') {
          throw new Error('invalid origin');
        }
        frontendOrigin = url.origin;
      } catch {
        return privateRoleplayJson(
          { success: false, error: 'El origen público de la plataforma no está configurado correctamente. No se creó el roleplay.' },
          { status: 503 }
        );
      }
    }

    let parsedParticipantId: number | null = null;
    if (!isBulk) {
      if (typeof participantId !== 'string') {
        return privateRoleplayJson({ success: false, error: 'Participant is required' }, { status: 400 });
      }
      // parseInt accepts malformed identifiers such as "12abc" and "12.5".
      // Require an exact positive decimal integer before resolving a participant.
      if (!/^[1-9][0-9]*$/.test(participantId)) {
        return privateRoleplayJson({ success: false, error: 'Invalid participant ID' }, { status: 400 });
      }
      parsedParticipantId = Number(participantId);
      if (!Number.isSafeInteger(parsedParticipantId) || parsedParticipantId <= 0) {
        return privateRoleplayJson({ success: false, error: 'Invalid participant ID' }, { status: 400 });
      }
    }

    // Published sessions act as immutable reference snapshots for this first
    // catalog phase. The browser supplies only a source ID + expected hash.
    // All scenarios, prompts and audio URLs are loaded server-side.
    const sourceAudioUrls: string[] = [];
    let scenarios: ScenarioInput[] | null = null;
    if (useLibrary) {
      const source = await db.roleplaySession.findUnique({
        where: { id: rawLibrarySessionId as string },
        select: {
          status: true,
          scenarios: {
            orderBy: { order: 'asc' },
            select: {
              order: true, title: true, baseAudioUrl: true,
              durationLimitSec: true, scriptPrompt: true, studioTurn: true, studioSpeaker: true, studioLanguage: true, sourceStartSec: true, sourceEndSec: true, expectedKeys: true,
            },
          },
        },
      });
      if (!source || source.status === 'DRAFT' || source.status === 'CANCELLED' ||
          source.scenarios.length === 0 || source.scenarios.length > ROLEPLAY_MAX_SCENARIOS) {
        return privateRoleplayJson({ success: false, error: 'Reusable roleplay not available' }, { status: 404 });
      }
      if (getRoleplaySnapshotHash(source.scenarios) !== rawLibraryFingerprint) {
        return privateRoleplayJson({
          success: false,
          error: 'La biblioteca cambió desde que abriste esta plantilla. Vuelve a seleccionarla.',
        }, { status: 409 });
      }
      const visibility = await db.roleplayLibraryArchive.findUnique({
        where: { fingerprint: rawLibraryFingerprint as string },
        select: { archivedAt: true },
      });
      if (visibility?.archivedAt) {
        return privateRoleplayJson({
          success: false,
          error: 'Este roleplay fue retirado de la biblioteca y no admite nuevas asignaciones.',
        }, { status: 409 });
      }
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
      const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!supabaseUrl || !serviceRoleKey) {
        return privateRoleplayJson({ success: false, error: 'Storage is not configured' }, { status: 503 });
      }
      const paths = source.scenarios.map((scenario) => getReusableBaseAudioPath(scenario.baseAudioUrl, supabaseUrl));
      if (paths.some((path) => !path)) {
        return privateRoleplayJson({ success: false, error: 'Roleplay has unsupported audio references' }, { status: 409 });
      }
      const { createClient } = await import('@supabase/supabase-js');
      supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
      // Cap concurrent storage lookups: a medical exercise can contain 25 segments.
      // Verify every object before reserving a participant or writing to the database.
      const uniquePaths = [...new Set(paths as string[])];
      for (let offset = 0; offset < uniquePaths.length; offset += 5) {
        const batch = await Promise.all(
          uniquePaths.slice(offset, offset + 5).map((path) =>
            supabaseAdmin!.storage.from('roleplay-audio').info(path)
          )
        );
        if (batch.some(({ data, error }) => error || !data)) {
          return privateRoleplayJson({
            success: false,
            error: 'Un audio de esta plantilla ya no está disponible. No se creó ninguna sesión.',
          }, { status: 409 });
        }
      }
      scenarios = source.scenarios.map((scenario) => ({
        title: scenario.title,
        scriptPrompt: scenario.scriptPrompt,
        studioTurn: scenario.studioTurn,
        studioSpeaker: scenario.studioSpeaker,
        studioLanguage: scenario.studioLanguage,
        sourceStartSec: scenario.sourceStartSec,
        sourceEndSec: scenario.sourceEndSec,
        durationLimitSec: scenario.durationLimitSec,
        expectedKeys: scenario.expectedKeys,
      }));
      sourceAudioUrls.push(...source.scenarios.map((scenario) => scenario.baseAudioUrl));
    } else {
      scenarios = parseScenarios(rawScenarios as string);
    }
    if (!scenarios) {
      return privateRoleplayJson(
        { success: false, error: `Invalid scenarios: expected 1-${ROLEPLAY_MAX_SCENARIOS} entries with a non-empty title` },
        { status: 400 }
      );
    }

    let expectedAudioChecksums: Array<string | null> | null = null;
    if (rawAudioChecksums !== null) {
      if (typeof rawAudioChecksums !== 'string') {
        return privateRoleplayJson({ success: false, error: 'Invalid audio checksum payload' }, { status: 400 });
      }
      try {
        const parsedChecksums: unknown = JSON.parse(rawAudioChecksums);
        if (!Array.isArray(parsedChecksums) || parsedChecksums.length !== scenarios.length || parsedChecksums.some((value) => value !== null && (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)))) {
          return privateRoleplayJson({ success: false, error: 'Invalid audio checksum payload' }, { status: 400 });
        }
        expectedAudioChecksums = parsedChecksums as Array<string | null>;
      } catch {
        return privateRoleplayJson({ success: false, error: 'Invalid audio checksum payload' }, { status: 400 });
      }
    }

    if (!useLibrary && scenarioAudios.length !== scenarios.length) {
      return privateRoleplayJson(
        { success: false, error: 'Each scenario requires exactly one base audio file' },
        { status: 400 }
      );
    }

    if (!useLibrary) for (const audio of scenarioAudios) {
      if (!(audio instanceof File)) {
        return privateRoleplayJson({ success: false, error: 'Invalid scenario audio payload' }, { status: 400 });
      }
      if (audio.size <= 0 || audio.size > MAX_AUDIO_SIZE) {
        return privateRoleplayJson({ success: false, error: 'Audio must be between 1 byte and 15 MB' }, { status: 400 });
      }
      if (!getAdminRoleplayAudioExtension(audio.type)) {
        return privateRoleplayJson(
          { success: false, error: `Audio type ${audio.type || 'unknown'} not allowed` },
          { status: 400 }
        );
      }
    }

    if (!useLibrary && expectedAudioChecksums) {
      for (let index = 0; index < scenarioAudios.length; index++) {
        const expected = expectedAudioChecksums[index];
        if (!expected) continue;
        const audio = scenarioAudios[index];
        if (!(audio instanceof File)) continue;
        const actual = await sha256RoleplayFile(audio);
        if (actual !== expected.toLowerCase()) {
          return privateRoleplayJson({ success: false, error: `Audio checksum mismatch for scenario ${index + 1}` }, { status: 400 });
        }
      }
    }

    if (!isBulk && participantType === 'interpreter') {
      const interpreter = await db.interpreter.findUnique({ where: { id: parsedParticipantId! }, select: { id: true } });
      if (!interpreter) return privateRoleplayJson({ success: false, error: 'Interpreter not found' }, { status: 404 });
    } else if (!isBulk) {
      const candidate = await db.recruitmentCandidate.findUnique({ where: { id: parsedParticipantId! }, select: { id: true } });
      if (!candidate) return privateRoleplayJson({ success: false, error: 'Candidate not found' }, { status: 404 });
    }

    // Create-or-resume invariant: never create a second live/evaluated
    // session for the same participant. Checked before any upload happens.
    if (isBulk) {
      // Bulk creation uploads each scenario audio once, then reuses the same
      // immutable public asset URLs for every active interpreter session.
      const activeInterpreters = await db.interpreter.findMany({
        where: { status: 'Activo' },
        select: { id: true },
        orderBy: { id: 'asc' },
      });
      if (activeInterpreters.length === 0) {
        return privateRoleplayJson({ success: false, error: 'No active interpreters found' }, { status: 400 });
      }

      // Eligibility is rechecked under per-interpreter advisory locks
      // inside the creation transaction below; this preview is not authoritative.

      const audioUrls: string[] = [...sourceAudioUrls];
      if (!useLibrary) {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!supabaseUrl || !serviceRoleKey) {
        return privateRoleplayJson({ success: false, error: 'Storage is not configured' }, { status: 503 });
      }
      const { createClient } = await import('@supabase/supabase-js');
      supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
      const batchPath = `base/bulk-${randomUUID()}`;
      for (let i = 0; i < scenarios.length; i++) {
        const audio = scenarioAudios[i] as File;
        // MIME was validated before any upload. Never derive Storage paths from
        // an attacker-controlled File.name (e.g. .html, .svg or separators).
        const extension = getAdminRoleplayAudioExtension(audio.type);
        if (!extension) throw new Error('Unsupported audio MIME type');
        const path = `${batchPath}/${i}.${extension}`;
        const { error: uploadError } = await supabaseAdmin.storage
          .from('roleplay-audio')
          .upload(path, audio, { contentType: audio.type, upsert: false });
        if (uploadError) throw new Error('Failed to upload audio');
        uploadedPaths.push(path);
        const { data: publicUrlData } = supabaseAdmin.storage.from('roleplay-audio').getPublicUrl(path);
        audioUrls.push(publicUrlData.publicUrl);
      }

      }

      const firstBaseAudioPath = firstTrustedBaseAudioPath(
        uploadedPaths, audioUrls, process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
      );
      if (!firstBaseAudioPath) {
        throw new Error('Roleplay base audio path could not be resolved');
      }

      const bulkResult = await db.$transaction(async (tx) => {
        if (useLibrary) {
          const fingerprint = rawLibraryFingerprint as string;
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`roleplay:library:${fingerprint}`}, 0))`;
          const visibility = await tx.roleplayLibraryArchive.findUnique({
            where: { fingerprint },
            select: { archivedAt: true },
          });
          if (visibility?.archivedAt) {
            libraryArchivedDuringAssignment = true;
            throw new Error('Roleplay library snapshot archived during assignment');
          }
        }
        const created: Array<{ id: string }> = [];
        let skippedCount = 0;
        for (const interpreter of activeInterpreters) {
          // A transaction-scoped advisory lock serializes bulk and individual
          // assignments for this interpreter without requiring a schema change.
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`roleplay:interpreter:${interpreter.id}`}, 0))`;
          const stillActive = await tx.interpreter.findFirst({
            where: { id: interpreter.id, status: 'Activo' },
            select: { id: true },
          });
          const existing = stillActive ? await tx.roleplaySession.findFirst({
            where: {
              ...interpreterAssignmentScope(interpreter.id),
              status: { in: blockingAssignmentStatuses(true) },
            },
            select: { id: true },
          }) : { id: 'inactive' };
          if (!stillActive || existing) {
            skippedCount++;
            continue;
          }
          const session = await tx.roleplaySession.create({
            data: {
              interpreterId: interpreter.id,
              recruitmentCandidateId: null,
              baseAudioUrl: audioUrls[0],
              baseAudioPath: firstBaseAudioPath,
              status: 'INVITED',
              scenarios: {
                create: scenarios.map((scenario, index) => ({
                  order: index,
                  title: scenario.title,
                  baseAudioUrl: audioUrls[index],
                  durationLimitSec: scenario.durationLimitSec,
                  scriptPrompt: scenario.scriptPrompt,
        studioTurn: scenario.studioTurn,
        studioSpeaker: scenario.studioSpeaker,
        studioLanguage: scenario.studioLanguage,
        sourceStartSec: scenario.sourceStartSec,
        sourceEndSec: scenario.sourceEndSec,
                  expectedKeys: scenario.expectedKeys ?? [],
                })),
              },
            },
            select: { id: true },
          });
          created.push(session);
        }
        return { created, skippedCount };
      });
      if (bulkResult.created.length === 0) {
        if (uploadedPaths.length > 0 && supabaseAdmin) {
          await supabaseAdmin.storage.from('roleplay-audio').remove(uploadedPaths);
          uploadedPaths.length = 0;
        }
        return privateRoleplayJson({
          success: false,
          error: 'All active interpreters already have a draft or existing roleplay session',
          skippedCount: bulkResult.skippedCount,
        }, { status: 409 });
      }

      revalidatePath('/admin/roleplays');
      revalidatePath('/admin/roleplays/new');
      return privateRoleplayJson({
        success: true,
        data: {
          bulk: true,
          createdCount: bulkResult.created.length,
          skippedCount: bulkResult.skippedCount,
          sessionIds: bulkResult.created.map((session) => session.id),
          scenarioCount: scenarios.length,
        },
      }, { headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } });
    }

    // Candidate ownership wins over provisional interpreter IDs retained in
    // old recruitment sessions. The interpreter's active session must not be
    // blocked or replaced because such a historical candidate row exists.
    const participantWhere = participantType === 'interpreter'
      ? interpreterAssignmentScope(parsedParticipantId!)
      : candidateAssignmentScope(parsedParticipantId!);

    if (!useLibrary) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      return privateRoleplayJson({ success: false, error: 'Storage is not configured' }, { status: 503 });
    }

    const { createClient } = await import('@supabase/supabase-js');
    supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

    }

    // Reserve or resume the participant draft atomically. All roleplay
    // creation paths use the same advisory-lock key for this participant.
    const lockKey = participantType === 'interpreter'
      ? `roleplay:interpreter:${parsedParticipantId!}`
      : `roleplay:candidate:${parsedParticipantId!}`;
    const reservation = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
      const blocking = await tx.roleplaySession.findFirst({
        where: { ...participantWhere, status: { in: blockingAssignmentStatuses(false) } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, status: true },
      });
      if (blocking) return { conflict: blocking, session: null };
      const draft = await tx.roleplaySession.findFirst({
        where: { ...participantWhere, status: 'DRAFT' },
        orderBy: { createdAt: 'desc' },
        select: { id: true, updatedAt: true },
      });
      if (draft && participantType === 'candidate') {
        const existingAccess = await tx.roleplayAccess.findUnique({
          where: { sessionId: draft.id },
          select: { id: true },
        });
        if (existingAccess) return { conflict: { id: draft.id, status: 'DRAFT' as const }, session: null };
      }
      if (draft) return { conflict: null, session: draft };
      const created = await tx.roleplaySession.create({
        data: {
          interpreterId: participantType === 'interpreter' ? parsedParticipantId! : null,
          recruitmentCandidateId: participantType === 'candidate' ? parsedParticipantId! : null,
          baseAudioUrl: '',
          status: 'DRAFT',
        },
        select: { id: true, updatedAt: true },
      });
      return { conflict: null, session: created };
    });
    if (reservation.conflict) {
      return privateRoleplayJson({
        success: false,
        error: `Participant already has a roleplay session in status ${reservation.conflict.status}`,
        sessionId: reservation.conflict.id,
        status: reservation.conflict.status,
      }, { status: 409 });
    }
    if (!reservation.session) throw new Error('Could not reserve roleplay draft');
    const session = reservation.session;

    const audioUrls: string[] = [...sourceAudioUrls];
    if (!useLibrary) {
      const storageClient = supabaseAdmin;
      if (!storageClient) throw new Error('Storage is not configured');
      for (let i = 0; i < scenarios.length; i++) {
      const audio = scenarioAudios[i] as File;
      // MIME was validated before any upload. Never derive Storage paths from
        // an attacker-controlled File.name (e.g. .html, .svg or separators).
        const extension = getAdminRoleplayAudioExtension(audio.type);
        if (!extension) throw new Error('Unsupported audio MIME type');
      const path = `base/${session.id}/upload-${randomUUID()}/${i}.${extension}`;

      const { error: uploadError } = await storageClient.storage
        .from('roleplay-audio')
        .upload(path, audio, { contentType: audio.type, upsert: false });
      if (uploadError) throw new Error('Failed to upload audio');
      uploadedPaths.push(path);

      const { data: publicUrlData } = storageClient.storage.from('roleplay-audio').getPublicUrl(path);
      audioUrls.push(publicUrlData.publicUrl);
      }
    }

    // Store the same immutable object key used for playback, rather than
    // requiring callers to parse a persisted legacy URL in the future.
    const firstBaseAudioPath = firstTrustedBaseAudioPath(
      uploadedPaths, audioUrls, process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
    );
    if (!firstBaseAudioPath) throw new Error('Roleplay base audio path could not be resolved');

    // Non-bulk assignments cannot reach this point without a canonical origin.
    let inviteLink = `${frontendOrigin}/roleplays/${session.id}`;
    let candidateAccess: { tokenHash: string; inviteCode: string; expiresAt: Date } | null = null;
    if (participantType === 'candidate') {
      const { randomBytes, createHash } = await import('crypto');
      const rawToken = randomBytes(32).toString('hex');
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');
      // Use 96 bits of entropy for new public invitation codes. Uppercasing
      // base64url reduced the effective entropy of the previous 4-byte code,
      // making collisions and online guessing more plausible as volume grows.
      // Hex remains uppercase for the existing /r/[code] validator; old short
      // codes remain readable and no invitations need to be migrated.
      const inviteCode = randomBytes(12).toString('hex').toUpperCase();
      candidateAccess = { tokenHash, inviteCode, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) };
      inviteLink = `${frontendOrigin}/r/${inviteCode}`;
    }

    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
      if (useLibrary) {
        const fingerprint = rawLibraryFingerprint as string;
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`roleplay:library:${fingerprint}`}, 0))`;
        const visibility = await tx.roleplayLibraryArchive.findUnique({
          where: { fingerprint },
          select: { archivedAt: true },
        });
        if (visibility?.archivedAt) {
          libraryArchivedDuringAssignment = true;
          throw new Error('Roleplay library snapshot archived during assignment');
        }
      }
      const currentSession = await tx.roleplaySession.findUnique({
        where: { id: session.id },
        select: { status: true, updatedAt: true },
      });
      if (!currentSession || currentSession.status !== 'DRAFT' || currentSession.updatedAt.getTime() !== reservation.session.updatedAt.getTime()) {
        draftConflict = true;
        throw new Error('Roleplay draft changed while the audio was uploading');
      }
      if (participantType === 'candidate') {
        const existingAccess = await tx.roleplayAccess.findUnique({
          where: { sessionId: session.id },
          select: { id: true },
        });
        if (existingAccess) {
          draftConflict = true;
          throw new Error('Candidate roleplay has already been invited');
        }
      }
      await tx.roleplayScenario.deleteMany({ where: { sessionId: session.id } });
      for (let i = 0; i < scenarios.length; i++) {
        await tx.roleplayScenario.create({
          data: {
            sessionId: session.id,
            order: i,
            title: scenarios[i].title,
            baseAudioUrl: audioUrls[i],
            durationLimitSec: scenarios[i].durationLimitSec,
            scriptPrompt: scenarios[i].scriptPrompt,
            studioTurn: scenarios[i].studioTurn,
             studioSpeaker: scenarios[i].studioSpeaker,
             studioLanguage: scenarios[i].studioLanguage,
             sourceStartSec: scenarios[i].sourceStartSec,
             sourceEndSec: scenarios[i].sourceEndSec,
             expectedKeys: scenarios[i].expectedKeys ?? [],
          },
          select: { id: true },
        });
      }
      await tx.roleplaySession.update({
        where: { id: session.id },
        data: { baseAudioUrl: audioUrls[0], baseAudioPath: firstBaseAudioPath },
      });
      if (candidateAccess) {
        await tx.roleplayAccess.create({
          data: { sessionId: session.id, ...candidateAccess },
        });
      }
    });

    revalidatePath('/admin/roleplays');
    revalidatePath('/admin/roleplays/new');
    return privateRoleplayJson({
      success: true,
      data: { sessionId: session.id, inviteLink, scenarioCount: scenarios.length },
    }, { headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    // Storage and database exceptions can include signed URLs, credentials,
    // or infrastructure details; preserve an error category, not its payload.
    console.error('Create Roleplay API Error:', error instanceof Error ? 'Error' : 'UnknownError');

    // A failed/ambiguous transaction response does not prove rollback: the
    // database may have committed the session while the acknowledgment was
    // lost. NEVER delete unique base audio objects in this catch block, as
    // doing so could leave committed Roleplay scenarios with missing audio.
    // Unreferenced uploads must be reconciled later with an age-gated,
    // read-only-first audit and manual review (see issue #408).

    if (libraryArchivedDuringAssignment) {
      return privateRoleplayJson({
        success: false,
        error: 'Esta plantilla fue retirada de la biblioteca mientras se creaba la asignación.',
      }, { status: 409 });
    }
    if (draftConflict) {
      return privateRoleplayJson({ success: false, error: 'This draft was updated by another administrator. Reload and try again.' }, { status: 409 });
    }
    const isUploadFailure = message.startsWith('Failed to upload audio');
    return privateRoleplayJson(
      {
        success: false,
        error: isUploadFailure
          ? 'No fue posible subir un audio. Revisa el archivo e inténtalo de nuevo.'
          : 'No fue posible crear el roleplay. Inténtalo de nuevo.',
      },
      { status: 500, headers: { 'Cache-Control': 'private, no-store' } }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const forbidden = await guardRoleplayAdmin(req);
    if (forbidden) return forbidden;

    const sessions = await db.roleplaySession.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        interpreter: { select: { id: true, name: true, externalId: true, emailCorporativo: true } },
        recruitmentCandidate: { select: { id: true, name: true, email: true } },
        qaScore: { select: { id: true, totalScore: true, criticalError: true } },
      },
    });

    return privateRoleplayJson(
      { success: true, data: sessions },
      { headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } },
    );
  } catch (error: unknown) {
    console.error('Get Roleplays Error:', error instanceof Error ? 'Error' : 'UnknownError');
    return privateRoleplayJson(
      { success: false, error: 'No fue posible consultar los roleplays.' },
      { status: 500, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
}
