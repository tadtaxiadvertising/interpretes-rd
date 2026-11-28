import { NextRequest } from 'next/server';
import { privateRoleplayResponse } from '@/lib/roleplay/private-response';
import { safeServerErrorCategory } from '@/lib/security/safe-server-error';
import { revalidatePath } from 'next/cache';
import prisma from '@/lib/prisma';
import { validateAction } from '@/lib/auth/actions';
import { actorFromBearer } from '@/lib/api-auth';
import { parseEditorialRoleplayTopic } from '@/lib/roleplay-library-topics';
import { getReusableRoleplayAudio, getRoleplaySnapshotHash } from '@/lib/roleplay-library';

const FINGERPRINT_RE = /^[a-f0-9]{64}$/;

/**
 * A successful archive/restore transaction cannot be rolled back by Next.js
 * cache invalidation. Refresh paths independently after commit and never
 * report the persisted write as failed when revalidation throws.
 */
function refreshCommittedLibraryViews(paths: readonly string[]): void {
  for (const path of paths) {
    try {
      revalidatePath(path);
    } catch {
      // Do not log session IDs, paths or framework error objects.
      console.warn('[ADMIN ROLEPLAY LIBRARY] Committed change; cache refresh failed');
    }
  }
}

/**
 * Remove a roleplay from the reusable catalog without deleting any actual
 * practice session, audio asset, response, or QA evaluation.
 * Catalog entries are derived from existing session snapshots.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ fingerprint: string }> },
) {
  try {
    const auth = await validateAction('admin');
    if ('error' in auth) return privateRoleplayResponse({ success: false, error: auth.error }, { status: 403 });
    if (req.headers.has('authorization')) {
      const bearer = await actorFromBearer(req);
      if (!bearer || bearer.role !== 'admin' || bearer.userId !== auth.user.userId) {
        return privateRoleplayResponse({ success: false, error: 'Forbidden' }, { status: 403 });
      }
    }

    const { fingerprint } = await params;
    if (!FINGERPRINT_RE.test(fingerprint)) {
      return privateRoleplayResponse({ success: false, error: 'Invalid catalog fingerprint' }, { status: 400 });
    }

    const payload: unknown = await req.json().catch(() => null);
    if (!payload || typeof payload !== 'object' ||
      !('sourceSessionId' in payload) || typeof payload.sourceSessionId !== 'string' ||
      !/^[a-zA-Z0-9_-]{5,120}$/.test(payload.sourceSessionId)) {
      return privateRoleplayResponse({ success: false, error: 'Invalid source session' }, { status: 400 });
    }

    const source = await prisma.roleplaySession.findUnique({
      where: { id: payload.sourceSessionId },
      select: {
        status: true,
        scenarios: {
          orderBy: { order: 'asc' },
          select: { order: true, title: true, baseAudioUrl: true, durationLimitSec: true, scriptPrompt: true, studioTurn: true, studioSpeaker: true, studioLanguage: true, sourceStartSec: true, sourceEndSec: true, expectedKeys: true },
        },
      },
    });
    if (!source || source.status === 'DRAFT' || source.status === 'CANCELLED' ||
        source.scenarios.length === 0 || getRoleplaySnapshotHash(source.scenarios) !== fingerprint) {
      return privateRoleplayResponse({ success: false, error: 'This library snapshot is no longer available' }, { status: 409 });
    }

    const archivedAt = new Date();
    await prisma.$transaction(async (tx) => {
      // Coordinate with assignments using this exact content snapshot.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`roleplay:library:${fingerprint}`}, 0))`;
      await tx.roleplayLibraryArchive.upsert({
        where: { fingerprint },
        create: { fingerprint, archivedAt, archivedBy: auth.user.userId },
        update: { archivedAt, archivedBy: auth.user.userId },
      });
    });
    refreshCommittedLibraryViews([
      '/admin/roleplays/library',
      `/admin/roleplays/library/${payload.sourceSessionId}`,
    ]);
    return privateRoleplayResponse({ success: true, archived: true });
  } catch (error) {
    console.error('[ADMIN ROLEPLAY LIBRARY] Failed to archive snapshot', safeServerErrorCategory(error));
    return privateRoleplayResponse({ success: false, error: 'No se pudo retirar el roleplay de la biblioteca' }, { status: 500 });
  }
}

/** Restore a previously withdrawn snapshot. Old sessions were never removed. */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ fingerprint: string }> },
) {
  try {
    const auth = await validateAction('admin');
    if ('error' in auth) return privateRoleplayResponse({ success: false, error: auth.error }, { status: 403 });
    if (req.headers.has('authorization')) {
      const bearer = await actorFromBearer(req);
      if (!bearer || bearer.role !== 'admin' || bearer.userId !== auth.user.userId) {
        return privateRoleplayResponse({ success: false, error: 'Forbidden' }, { status: 403 });
      }
    }

    const { fingerprint } = await params;
    if (!FINGERPRINT_RE.test(fingerprint)) {
      return privateRoleplayResponse({ success: false, error: 'Invalid catalog fingerprint' }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`roleplay:library:${fingerprint}`}, 0))`;
      return tx.roleplayLibraryArchive.updateMany({
        where: { fingerprint, archivedAt: { not: null } },
        data: { archivedAt: null },
      });
    });
    if (result.count === 0) {
      return privateRoleplayResponse({ success: false, error: 'No archived entry found' }, { status: 404 });
    }
    refreshCommittedLibraryViews(['/admin/roleplays/library']);
    return privateRoleplayResponse({ success: true, archived: false });
  } catch (error) {
    console.error('[ADMIN ROLEPLAY LIBRARY] Failed to restore snapshot', safeServerErrorCategory(error));
    return privateRoleplayResponse({ success: false, error: 'No se pudo restaurar el roleplay' }, { status: 500 });
  }
}

/** Change catalog metadata only. Does not alter the snapshot or archive state. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ fingerprint: string }> },
) {
  try {
    const auth = await validateAction('admin');
    if ('error' in auth) return privateRoleplayResponse({ success: false, error: auth.error }, { status: 403 });
    if (req.headers.has('authorization')) {
      const bearer = await actorFromBearer(req);
      if (!bearer || bearer.role !== 'admin' || bearer.userId !== auth.user.userId) {
        return privateRoleplayResponse({ success: false, error: 'Forbidden' }, { status: 403 });
      }
    }
    if (process.env.ROLEPLAY_LIBRARY_EDITORIAL_TOPICS_ENABLED !== 'true') {
      return privateRoleplayResponse({ success: false, error: 'La clasificación editorial todavía no está habilitada.' }, { status: 503 });
    }
    const { fingerprint } = await params;
    const payload: unknown = await req.json().catch(() => null);
    if (!FINGERPRINT_RE.test(fingerprint) || !payload || typeof payload !== 'object' ||
      !('sourceSessionId' in payload) || typeof payload.sourceSessionId !== 'string' ||
      !/^[a-zA-Z0-9_-]{5,120}$/.test(payload.sourceSessionId) ||
      !('topic' in payload) || !('subtopic' in payload)) {
      return privateRoleplayResponse({ success: false, error: 'Clasificación inválida.' }, { status: 400 });
    }
    const selection = parseEditorialRoleplayTopic(payload.topic, payload.subtopic);
    const clear = payload.topic === '' && payload.subtopic === '';
    if (!selection && !clear) return privateRoleplayResponse({ success: false, error: 'Selecciona un tema y un subtema compatibles.' }, { status: 400 });
    const storageUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    if (!storageUrl) return privateRoleplayResponse({ success: false, error: 'Almacenamiento no disponible.' }, { status: 503 });
    const sourceSessionId = payload.sourceSessionId;
    const changed = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`roleplay:library:${fingerprint}`}, 0))`;
      const source = await tx.roleplaySession.findUnique({
        where: { id: sourceSessionId },
        select: { status: true, scenarios: { orderBy: { order: 'asc' }, select: {
          order: true, title: true, baseAudioUrl: true, durationLimitSec: true, scriptPrompt: true,
          studioTurn: true, studioSpeaker: true, studioLanguage: true, sourceStartSec: true, sourceEndSec: true, expectedKeys: true,
        } } },
      });
      if (!source || source.status === 'DRAFT' || source.status === 'CANCELLED' ||
        !getReusableRoleplayAudio(source.scenarios, storageUrl) || getRoleplaySnapshotHash(source.scenarios) !== fingerprint) return false;
      if (selection) {
        await tx.$executeRaw`INSERT INTO public.roleplay_library_topics (fingerprint, topic, subtopic)
          VALUES (${fingerprint}, ${selection.topic}, ${selection.subtopic})
          ON CONFLICT (fingerprint) DO UPDATE SET topic = EXCLUDED.topic, subtopic = EXCLUDED.subtopic, updated_at = now()`;
      } else {
        await tx.$executeRaw`DELETE FROM public.roleplay_library_topics WHERE fingerprint = ${fingerprint}`;
      }
      return true;
    });
    if (!changed) return privateRoleplayResponse({ success: false, error: 'Esta plantilla ya no está disponible.' }, { status: 409 });
    refreshCommittedLibraryViews(['/admin/roleplays/library']);
    return privateRoleplayResponse({ success: true, selection });
  } catch (error) {
    console.error('[ADMIN ROLEPLAY LIBRARY] Failed to update topic', safeServerErrorCategory(error));
    return privateRoleplayResponse({ success: false, error: 'No se pudo guardar la clasificación.' }, { status: 500 });
  }
}
