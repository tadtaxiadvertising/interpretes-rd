import { NextRequest, NextResponse } from 'next/server';
import { privateRoleplayResponse as privateRoleplayJson } from '@/lib/roleplay/private-response';
import { revalidatePath } from 'next/cache';
import { notifyRoleplayAssignments } from '@/lib/notifications/notify-roleplay';
import { revalidateCommittedRoleplayViews } from '@/lib/roleplay/admin-revalidation';
import prisma from '@/lib/prisma';
import { validateAction } from '@/lib/auth/actions';
import { actorFromBearer } from '@/lib/api-auth';
import { z } from 'zod';
import { createHash, randomUUID } from 'crypto';
import { ROLEPLAY_MAX_SCENARIOS, ROLEPLAY_RESPONSE_MAX_DURATION_SEC, ROLEPLAY_MULTIPART_MAX_SCENARIOS, ROLEPLAY_ADMIN_AUDIO_MAX_BYTES, ROLEPLAY_MULTIPART_MAX_BYTES } from '@/lib/roleplay-limits';
import { getReusableBaseAudioPath, getReusableRoleplayAudio, getRoleplaySnapshotHash } from '@/lib/roleplay-library';
import { sha256RoleplayFile } from '@/lib/roleplay-streaming-checksum';
import { prepareRoleplayCreationClaim } from '@/lib/roleplay/prepare-creation-claim';
import { isCreationLedgerReady } from '@/lib/roleplay/creation-ledger-readiness';
import { completeRoleplayCreationInTransaction, InvalidRoleplayCreationKeyError } from '@/lib/roleplay/creation-idempotency-ledger';
import { parseRoleplayReceiptRequest, InvalidRoleplayReceiptRequestError } from '@/lib/roleplay/creation-receipt';
import { InvalidCreationAudioError } from '@/lib/roleplay/creation-audio-digests';
import { getAdminRoleplayAudioExtension } from '@/lib/roleplay/admin-audio-extension';
import { isParsedMultipartFile } from '@/lib/roleplay/parsed-multipart-file';
import { MultipartBodyTooLargeError, readBoundedMultipartFormData } from '@/lib/roleplay-studio/bounded-multipart';
import {
  blockingAssignmentStatuses, candidateAssignmentScope, interpreterAssignmentBatchScope,
  interpreterAssignmentScope,
} from '@/lib/roleplay-assignment-ownership';

import { openingAssignmentEnabled, readOpeningRequirement, insertOpeningRequiredSession } from '@/lib/roleplay/bilingual-opening-assignment';
import { requireBilingualOpeningBucket } from '@/lib/roleplay/bilingual-opening-bucket';
import { ROLEPLAY_PRIVATE_AUDIO_BUCKET, requirePrivateRoleplayAudioBucket } from '@/lib/roleplay/private-audio-bucket-readiness';
import { makePrivateClinicalReference, privateClinicalObjectPath } from '@/lib/roleplay/private-clinical-reference';

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

const MAX_AUDIO_SIZE = ROLEPLAY_ADMIN_AUDIO_MAX_BYTES;
// Legacy multipart accepts 25 x 15 MiB plus generous metadata/boundary headroom.
// This is a hard upper bound, NOT a safe memory budget for the small VPS:
// direct uploads to Storage are still required to solve issue #290.
const MAX_ROLEPLAY_MULTIPART_BYTES = ROLEPLAY_MULTIPART_MAX_BYTES;
// Memory amplification occurs while formData() buffers audio and during Storage
// uploads. Admit only one create request per Next.js process at a time.
// This is not a distributed quota or a substitute for direct-to-Storage upload.
const MAX_ACTIVE_ROLEPLAY_CREATES = 1;
let activeRoleplayCreates = 0;
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
})).min(1).max(ROLEPLAY_MULTIPART_MAX_SCENARIOS);

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
  let uploadBucket = 'roleplay-audio';
  // A successful upload is safe to delete only before any transaction that
  // might have persisted its URL. A failed/ambiguous commit must preserve it.
  let audioCommitMayHaveStarted = false;
  let processingSlotAcquired = false;
  let creationClaim: { actorUserId: string; requestKey: string; payloadHash: string } | null = null;

  try {
    const forbidden = await guardRoleplayAdmin(req);
    if (forbidden) return forbidden;

    // Explicit opt-in only. A keyed request must never silently downgrade
    // into a legacy creation if the pilot is disabled.
    const requestKeyHeader = req.headers.get('Idempotency-Key');
    let creationRequestKey: string | null = null;
    if (requestKeyHeader !== null) {
      if (process.env.ROLEPLAY_CREATION_IDEMPOTENCY_ENABLED !== 'true') {
        return privateRoleplayJson({ success: false, error: 'La creación con clave de idempotencia no está habilitada.' }, { status: 503 });
      }
      creationRequestKey = parseRoleplayReceiptRequest({ requestKey: requestKeyHeader });
    }

    // Reject additional uploads before reading multipart bytes. A second
    // request would multiply the temporary memory footprint on a small VPS.
    if (activeRoleplayCreates >= MAX_ACTIVE_ROLEPLAY_CREATES) {
      try { void req.body?.cancel().catch(() => {}); } catch { /* Best effort. */ }
      return privateRoleplayJson(
        { success: false, error: 'Ya se está creando otro roleplay. Vuelve a intentarlo cuando termine.' },
        { status: 503, headers: { 'Retry-After': '5' } },
      );
    }
    activeRoleplayCreates++;
    processingSlotAcquired = true;

    // Content-Length is only a cheap preflight; it may be missing or false.
    // The bounded reader also checks bytes as they arrive, before parsing.
    const declaredBytes = Number(req.headers.get('content-length') ?? 0);
    if (Number.isFinite(declaredBytes) && declaredBytes > MAX_ROLEPLAY_MULTIPART_BYTES) {
      // Do not leave an oversized upload body streaming after an early 413.
      // Cancellation is best-effort: always preserve the intended rejection
      // even if an upstream transport refuses to cancel its request stream.
      try { void req.body?.cancel().catch(() => {}); } catch { /* Best effort. */ }
      return privateRoleplayJson({ success: false, error: 'El lote de audio excede el tamaño máximo admitido.' }, { status: 413 });
    }
    // Only keyed creations require the hardened ledger. Check the actual
    // runtime DB connection before buffering audio or reserving any claim.
    if (creationRequestKey && !await isCreationLedgerReady(db)) {
      try { void req.body?.cancel().catch(() => {}); } catch { /* Best effort. */ }
      return privateRoleplayJson({ success: false, error: 'El registro seguro de creación todavía no está disponible.' }, { status: 503 });
    }
    const formData = await readBoundedMultipartFormData(req, MAX_ROLEPLAY_MULTIPART_BYTES);
    const participantType = formData.get('participantType');
    const participantId = formData.get('participantId');
    const rawScenarios = formData.get('scenarios');
    const scenarioAudios = formData.getAll('scenarioAudios');
    const rawAudioChecksums = formData.get('scenarioAudioSha256');
    const openingFields = formData.getAll('requiresBilingualOpening');
    if (openingFields.length > 1 || (openingFields.length === 1 && !['true', 'false'].includes(String(openingFields[0])))) {
      return privateRoleplayJson({ success: false, error: 'Configuración de apertura inválida.' }, { status: 400 });
    }
    const assignmentEnabled = openingAssignmentEnabled();
    let requiresOpening = openingFields[0] === 'true';
    if (requiresOpening && !assignmentEnabled) {
      return privateRoleplayJson({ success: false, error: 'La apertura bilingüe aún no está habilitada para nuevas sesiones.' }, { status: 503 });
    }
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

    if (creationRequestKey && participantType !== 'interpreter') {
      return privateRoleplayJson({ success: false, error: 'El piloto solo admite asignaciones individuales de intérpretes.' }, { status: 400 });
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
    let privateLibrary = false;
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
      // A previously required template cannot silently lose its opening.
      if (process.env.ROLEPLAY_BILINGUAL_OPENING_API_ENABLED === 'true' &&
          await readOpeningRequirement(db, rawLibrarySessionId as string)) {
        if (!assignmentEnabled) return privateRoleplayJson({ success: false, error: 'La asignación con apertura está temporalmente deshabilitada.' }, { status: 503 });
        requiresOpening = true;
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
      const reusable = getReusableRoleplayAudio(source.scenarios, supabaseUrl);
      if (!reusable) {
        return privateRoleplayJson({ success: false, error: 'Roleplay has unsupported audio references' }, { status: 409 });
      }
      privateLibrary = reusable.kind === 'private';
      // Private clinical templates always retain opening, even if a stale
      // browser explicitly requests false or omits the field.
      if (privateLibrary) {
        if (!assignmentEnabled) return privateRoleplayJson({ success: false, error: 'La asignación privada con apertura aún no está habilitada.' }, { status: 503 });
        requiresOpening = true;
      }
      if (requiresOpening && !privateLibrary) {
        return privateRoleplayJson({ success: false, error: 'Esta plantilla utiliza audio histórico público. Selecciona una plantilla privada o importa clips nuevos.' }, { status: 409 });
      }
      const { createClient } = await import('@supabase/supabase-js');
      supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
      if (privateLibrary) {
        try {
          await requirePrivateRoleplayAudioBucket(supabaseAdmin.storage);
        } catch {
          return privateRoleplayJson({ success: false, error: 'El almacenamiento clínico privado no está preparado.' }, { status: 503 });
        }
      }
      // Cap concurrent storage lookups: a medical exercise can contain 25 segments.
      // Verify every object before reserving a participant or writing to the database.
      const uniquePaths = [...new Set(reusable.paths)];
      for (let offset = 0; offset < uniquePaths.length; offset += 5) {
        const batch = await Promise.all(
          uniquePaths.slice(offset, offset + 5).map((path) =>
            supabaseAdmin!.storage.from(privateLibrary ? ROLEPLAY_PRIVATE_AUDIO_BUCKET : 'roleplay-audio').info(path)
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
        { success: false, error: `Invalid scenarios: expected 1-${ROLEPLAY_MULTIPART_MAX_SCENARIOS} entries with a non-empty title` },
        { status: 400 }
      );
    }

    if (requiresOpening) {
      // Preflight before reserving sessions or uploading clinical audio.
      // This does not prove object policy isolation; rollout still requires it.
      try {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!url || !key) throw new Error();
        const { createClient } = await import('@supabase/supabase-js');
        const storage = supabaseAdmin ?? createClient(url, key, { auth: { persistSession: false } });
        await requireBilingualOpeningBucket(storage.storage);
        await requirePrivateRoleplayAudioBucket(storage.storage);
        uploadBucket = ROLEPLAY_PRIVATE_AUDIO_BUCKET;
      } catch {
        return privateRoleplayJson({ success: false, error: 'El almacenamiento de apertura no está preparado. No se creó ninguna sesión.' }, { status: 503 });
      }
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
      if (!isParsedMultipartFile(audio)) {
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

    // The keyed path verifies all bytes once in the claim preparation helper.
    if (!creationRequestKey && !useLibrary && expectedAudioChecksums) {
      for (let index = 0; index < scenarioAudios.length; index++) {
        const expected = expectedAudioChecksums[index];
        if (!expected) continue;
        const audio = scenarioAudios[index];
        if (!isParsedMultipartFile(audio)) continue;
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

    if (creationRequestKey && participantType === 'interpreter') {
      const claim = await prepareRoleplayCreationClaim(db, req, creationRequestKey, {
        participantType, participantId: parsedParticipantId, requiresBilingualOpening: requiresOpening, scenarios,
      }, useLibrary
        ? { kind: 'library', verifiedFingerprint: rawLibraryFingerprint as string }
        : { kind: 'upload', files: scenarioAudios, checksums: expectedAudioChecksums });
      if (claim.kind === 'FORBIDDEN') {
        return privateRoleplayJson({ success: false, error: 'Forbidden' }, { status: 403 });
      }
      if (claim.kind === 'CONFLICT' || claim.kind === 'IN_PROGRESS') {
        return privateRoleplayJson({ success: false, error: 'La solicitud requiere revisión. Consulta el recibo o las sesiones existentes antes de repetir.' }, { status: 409 });
      }
      if (claim.kind === 'REPLAY') {
        // Only return an existing interpreter session owned by the same
        // destination. Never reconstruct candidate invitation secrets.
        const session = claim.sessionIds.length === 1 && await db.roleplaySession.findFirst({
          where: { ...interpreterAssignmentScope(parsedParticipantId!), id: claim.sessionIds[0], status: { notIn: ['DRAFT', 'CANCELLED'] } },
          select: { id: true },
        });
        if (!session || claim.createdCount !== 1 || claim.skippedCount !== 0 || claim.scenarioCount !== scenarios.length) {
          return privateRoleplayJson({ success: false, error: 'El recibo requiere revisión antes de continuar.' }, { status: 409 });
        }
        return privateRoleplayJson({ success: true, data: {
          sessionId: session.id, inviteLink: `${frontendOrigin}/roleplays/${session.id}`, scenarioCount: claim.scenarioCount,
        } });
      }
      creationClaim = claim.context;
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

      // Avoid uploading up to 25 audio objects when there is nobody to
      // assign. Use exactly the candidate-safe ownership/status predicate of
      // the eligibility preview. This read is only an optimization: the final
      // per-interpreter advisory locks below remain authoritative.
      const blockingSessions = await db.roleplaySession.findMany({
        where: {
          ...interpreterAssignmentBatchScope(activeInterpreters.map(({ id }) => id)),
          status: { in: blockingAssignmentStatuses(true) },
        },
        select: { interpreterId: true },
      });
      const occupiedIds = new Set(blockingSessions.map(({ interpreterId }) => interpreterId));
      if (activeInterpreters.every(({ id }) => occupiedIds.has(id))) {
        return privateRoleplayJson({
          success: false,
          error: 'All active interpreters already have a draft or existing roleplay session',
          skippedCount: activeInterpreters.length,
        }, { status: 409 });
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
      const batchId = randomUUID();
      const batchPath = `base/bulk-${batchId}`;
      for (let i = 0; i < scenarios.length; i++) {
        const audio = scenarioAudios[i] as File;
        // MIME was validated before any upload. Never derive Storage paths from
        // an attacker-controlled File.name (e.g. .html, .svg or separators).
        const extension = getAdminRoleplayAudioExtension(audio.type);
        if (!extension) throw new Error('Unsupported audio MIME type');
        const reference = requiresOpening ? makePrivateClinicalReference(batchId, i, extension) : null;
        const path = reference ? privateClinicalObjectPath(reference)! : `${batchPath}/${i}.${extension}`;
        const { error: uploadError } = await supabaseAdmin.storage
          .from(uploadBucket)
          .upload(path, audio, { contentType: audio.type, upsert: false });
        if (uploadError) throw new Error('Failed to upload audio');
        uploadedPaths.push(path);
        if (reference) audioUrls.push(reference);
        else {
          const { data: publicUrlData } = supabaseAdmin.storage.from('roleplay-audio').getPublicUrl(path);
          audioUrls.push(publicUrlData.publicUrl);
        }
      }

      }

      const firstBaseAudioPath = requiresOpening ? audioUrls[0] : firstTrustedBaseAudioPath(
        uploadedPaths, audioUrls, process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
      );
      if (!firstBaseAudioPath) {
        throw new Error('Roleplay base audio path could not be resolved');
      }

      audioCommitMayHaveStarted = true;
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
        const created: Array<{ id: string; interpreterId: number }> = [];
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
          const scenarioRows = scenarios.map((scenario, index) => ({
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
                }));
          const sessionData = {
            interpreterId: interpreter.id, recruitmentCandidateId: null,
            baseAudioUrl: audioUrls[0], baseAudioPath: firstBaseAudioPath, status: 'INVITED' as const,
          };
          const session = requiresOpening
            ? await insertOpeningRequiredSession(tx, sessionData)
            : await tx.roleplaySession.create({
                data: { ...sessionData, scenarios: { create: scenarioRows } },
                select: { id: true },
              });
          if (requiresOpening) {
            await tx.roleplaySession.update({
              where: { id: session.id }, data: { scenarios: { create: scenarioRows } },
            });
          }
          created.push({ id: session.id, interpreterId: interpreter.id });
        }
        return { created, skippedCount };
      });
      if (bulkResult.created.length === 0) {
        if (uploadedPaths.length > 0 && supabaseAdmin) {
          await supabaseAdmin.storage.from(uploadBucket).remove(uploadedPaths);
          uploadedPaths.length = 0;
        }
        return privateRoleplayJson({
          success: false,
          error: 'All active interpreters already have a draft or existing roleplay session',
          skippedCount: bulkResult.skippedCount,
        }, { status: 409 });
      }

      await notifyRoleplayAssignments(bulkResult.created);
      revalidateCommittedRoleplayViews(revalidatePath);
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
      if (draft) {
        if (process.env.ROLEPLAY_BILINGUAL_OPENING_API_ENABLED === 'true' &&
            await readOpeningRequirement(tx, draft.id) !== requiresOpening) {
          return { conflict: { id: draft.id, status: 'DRAFT' as const }, session: null };
        }
        return { conflict: null, session: draft };
      }
      const sessionData = {
        interpreterId: participantType === 'interpreter' ? parsedParticipantId! : null,
        recruitmentCandidateId: participantType === 'candidate' ? parsedParticipantId! : null,
        baseAudioUrl: '', status: 'DRAFT' as const,
      };
      const created = requiresOpening
        ? await insertOpeningRequiredSession(tx, sessionData)
        : await tx.roleplaySession.create({ data: sessionData, select: { id: true, updatedAt: true } });
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
      const batchId = randomUUID();
      for (let i = 0; i < scenarios.length; i++) {
      const audio = scenarioAudios[i] as File;
      // MIME was validated before any upload. Never derive Storage paths from
        // an attacker-controlled File.name (e.g. .html, .svg or separators).
        const extension = getAdminRoleplayAudioExtension(audio.type);
        if (!extension) throw new Error('Unsupported audio MIME type');
      const reference = requiresOpening ? makePrivateClinicalReference(batchId, i, extension) : null;
      const path = reference ? privateClinicalObjectPath(reference)! : `base/${session.id}/upload-${randomUUID()}/${i}.${extension}`;

      const { error: uploadError } = await storageClient.storage
        .from(uploadBucket)
        .upload(path, audio, { contentType: audio.type, upsert: false });
      if (uploadError) throw new Error('Failed to upload audio');
      uploadedPaths.push(path);

      if (reference) audioUrls.push(reference);
      else {
        const { data: publicUrlData } = storageClient.storage.from('roleplay-audio').getPublicUrl(path);
        audioUrls.push(publicUrlData.publicUrl);
      }
      }
    }

    // Store the same immutable object key used for playback, rather than
    // requiring callers to parse a persisted legacy URL in the future.
    const firstBaseAudioPath = requiresOpening ? audioUrls[0] : firstTrustedBaseAudioPath(
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

    audioCommitMayHaveStarted = true;
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
      if (participantType === 'interpreter') {
        // Publish only after every scenario is persisted. A concurrent start
        // or change must not be overwritten by a stale draft publication.
        const published = await tx.roleplaySession.updateMany({
          where: {
            id: session.id, status: 'DRAFT', updatedAt: reservation.session.updatedAt,
            interpreterId: parsedParticipantId!, recruitmentCandidateId: null,
          },
          data: { baseAudioUrl: audioUrls[0], baseAudioPath: firstBaseAudioPath, status: 'INVITED' },
        });
        if (published.count !== 1) {
          draftConflict = true;
          throw new Error('Roleplay draft changed before publication');
        }
      } else {
        await tx.roleplaySession.update({
          where: { id: session.id },
          data: { baseAudioUrl: audioUrls[0], baseAudioPath: firstBaseAudioPath },
        });
      }
      if (candidateAccess) {
        await tx.roleplayAccess.create({
          data: { sessionId: session.id, ...candidateAccess },
        });
      }
      if (creationClaim) {
        await completeRoleplayCreationInTransaction(tx, {
          ...creationClaim, sessionIds: [session.id], skippedCount: 0, scenarioCount: scenarios.length,
        });
      }
    });

    if (participantType === 'interpreter') {
      await notifyRoleplayAssignments([{ id: session.id, interpreterId: parsedParticipantId! }]);
    }
    revalidateCommittedRoleplayViews(revalidatePath);
    return privateRoleplayJson({
      success: true,
      data: { sessionId: session.id, inviteLink, scenarioCount: scenarios.length },
    }, { headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } });
  } catch (error: unknown) {
    if (error instanceof InvalidRoleplayReceiptRequestError || error instanceof InvalidCreationAudioError ||
        (error instanceof InvalidRoleplayCreationKeyError && !creationClaim)) {
      return privateRoleplayJson({ success: false, error: 'Clave de creación o contenido del paquete inválido.' }, { status: 400 });
    }
    if (error instanceof MultipartBodyTooLargeError) {
      return privateRoleplayJson({ success: false, error: 'El lote de audio excede el tamaño máximo admitido.' }, { status: 413 });
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    // Storage and database exceptions can include signed URLs, credentials,
    // or infrastructure details; preserve an error category, not its payload.
    console.error('Create Roleplay API Error:', error instanceof Error ? 'Error' : 'UnknownError');

    // The first upload may succeed before a later audio upload fails.
    // Before the publishing transaction starts, these unique paths cannot
    // be referenced by a newly committed scenario, so we can reclaim them.
    // Once a transaction starts, its acknowledgment may be lost *after* a
    // successful commit: never delete those files on an ambiguous failure.
    if (!audioCommitMayHaveStarted && uploadedPaths.length > 0 && supabaseAdmin) {
      try {
        const { error: cleanupError } = await supabaseAdmin.storage
          .from(uploadBucket).remove(uploadedPaths);
        if (cleanupError) {
          console.error('Roleplay pre-commit audio cleanup failed');
        }
      } catch {
        console.error('Roleplay pre-commit audio cleanup failed');
      }
    }
    // Post-transaction orphan reconciliation remains read-only-first and
    // age-gated; see issue #408.

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
  } finally {
    // Every exit path, including 413/401, Storage errors and ambiguous
    // transactions, must free the process-local admission slot.
    if (processingSlotAcquired) activeRoleplayCreates--;
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
