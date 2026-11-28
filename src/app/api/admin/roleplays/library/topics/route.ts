import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import prisma from '@/lib/prisma';
import { validateAction } from '@/lib/auth/actions';
import { actorFromBearer } from '@/lib/api-auth';
import { privateRoleplayResponse } from '@/lib/roleplay/private-response';
import { safeServerErrorCategory } from '@/lib/security/safe-server-error';
import { getReusableRoleplayAudio, getRoleplaySnapshotHash } from '@/lib/roleplay-library';
import { parseEditorialRoleplayTopic } from '@/lib/roleplay-library-topics';

/** Initial classification after confirmed publication. Never replace an
 * existing editorial decision; manual edits belong to the fingerprint PATCH. */
export async function POST(req: NextRequest) {
  try {
    const auth = await validateAction('admin');
    if ('error' in auth) return privateRoleplayResponse({ success: false, error: auth.error }, { status: 403 });
    if (req.headers.has('authorization')) {
      const bearer = await actorFromBearer(req);
      if (!bearer || bearer.role !== 'admin' || bearer.userId !== auth.user.userId)
        return privateRoleplayResponse({ success: false, error: 'Forbidden' }, { status: 403 });
    }
    if (process.env.ROLEPLAY_LIBRARY_EDITORIAL_TOPICS_ENABLED !== 'true')
      return privateRoleplayResponse({ success: false, error: 'Clasificación editorial no habilitada.' }, { status: 503 });
    const payload: unknown = await req.json().catch(() => null);
    if (!payload || typeof payload !== 'object' ||
        !('sessionId' in payload) || typeof payload.sessionId !== 'string' ||
        !/^[a-zA-Z0-9_-]{5,120}$/.test(payload.sessionId) ||
        !('topic' in payload) || !('subtopic' in payload))
      return privateRoleplayResponse({ success: false, error: 'Clasificación inválida.' }, { status: 400 });
    const selection = parseEditorialRoleplayTopic(payload.topic, payload.subtopic);
    if (!selection) return privateRoleplayResponse({ success: false, error: 'Tema y subtema incompatibles.' }, { status: 400 });
    const storageUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    if (!storageUrl) return privateRoleplayResponse({ success: false, error: 'Almacenamiento no disponible.' }, { status: 503 });
    const sessionId = payload.sessionId;
    const result = await prisma.$transaction(async tx => {
      const source = await tx.roleplaySession.findUnique({
        where: { id: sessionId },
        select: { status: true, scenarios: { orderBy: { order: 'asc' }, select: {
          order: true, title: true, baseAudioUrl: true, durationLimitSec: true, scriptPrompt: true,
          studioTurn: true, studioSpeaker: true, studioLanguage: true, sourceStartSec: true, sourceEndSec: true, expectedKeys: true,
        } } },
      });
      if (!source || source.status === 'DRAFT' || source.status === 'CANCELLED' ||
          !getReusableRoleplayAudio(source.scenarios, storageUrl)) return 'unavailable';
      const fingerprint = getRoleplaySnapshotHash(source.scenarios);
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`roleplay:library:${fingerprint}`}, 0))`;
      const archive = await tx.roleplayLibraryArchive.findUnique({ where: { fingerprint }, select: { archivedAt: true } });
      if (archive?.archivedAt) return 'unavailable';
      await tx.$executeRaw`INSERT INTO public.roleplay_library_topics (fingerprint, topic, subtopic)
        VALUES (${fingerprint}, ${selection.topic}, ${selection.subtopic})
        ON CONFLICT (fingerprint) DO NOTHING`;
      const rows = await tx.$queryRaw<Array<{ topic: string; subtopic: string }>>`
        SELECT topic, subtopic FROM public.roleplay_library_topics WHERE fingerprint = ${fingerprint}`;
      return rows[0]?.topic === selection.topic && rows[0]?.subtopic === selection.subtopic ? 'saved' : 'conflict';
    });
    if (result !== 'saved') return privateRoleplayResponse({ success: false, error: result === 'conflict'
      ? 'La plantilla ya tiene otra clasificación. Revísala en la biblioteca.'
      : 'La plantilla todavía no está disponible en la biblioteca.' }, { status: 409 });
    try { revalidatePath('/admin/roleplays/library'); } catch { /* classification is already committed */ }
    return privateRoleplayResponse({ success: true });
  } catch (error) {
    console.error('[ADMIN ROLEPLAY LIBRARY] Failed initial classification:', safeServerErrorCategory(error));
    return privateRoleplayResponse({ success: false, error: 'No se pudo guardar la clasificación.' }, { status: 500 });
  }
}
