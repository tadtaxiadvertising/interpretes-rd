import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import prisma from '@/lib/prisma';
import { validateAction } from '@/lib/auth/actions';
import { getRoleplaySnapshotHash } from '@/lib/roleplay-library';

const FINGERPRINT_RE = /^[a-f0-9]{64}$/;

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
    if ('error' in auth) return NextResponse.json({ success: false, error: auth.error }, { status: 403 });

    const { fingerprint } = await params;
    if (!FINGERPRINT_RE.test(fingerprint)) {
      return NextResponse.json({ success: false, error: 'Invalid catalog fingerprint' }, { status: 400 });
    }

    const payload: unknown = await req.json().catch(() => null);
    if (!payload || typeof payload !== 'object' ||
      !('sourceSessionId' in payload) || typeof payload.sourceSessionId !== 'string' ||
      !/^[a-zA-Z0-9_-]{5,120}$/.test(payload.sourceSessionId)) {
      return NextResponse.json({ success: false, error: 'Invalid source session' }, { status: 400 });
    }

    const source = await prisma.roleplaySession.findUnique({
      where: { id: payload.sourceSessionId },
      select: {
        status: true,
        scenarios: {
          orderBy: { order: 'asc' },
          select: { order: true, title: true, baseAudioUrl: true, durationLimitSec: true, scriptPrompt: true, expectedKeys: true },
        },
      },
    });
    if (!source || source.status === 'DRAFT' || source.status === 'CANCELLED' ||
        source.scenarios.length === 0 || getRoleplaySnapshotHash(source.scenarios) !== fingerprint) {
      return NextResponse.json({ success: false, error: 'This library snapshot is no longer available' }, { status: 409 });
    }

    await prisma.roleplayLibraryArchive.upsert({
      where: { fingerprint },
      create: { fingerprint, archivedAt: new Date() },
      update: { archivedAt: new Date() },
    });
    revalidatePath('/admin/roleplays/library');
    revalidatePath(`/admin/roleplays/library/${payload.sourceSessionId}`);
    return NextResponse.json({ success: true, archived: true });
  } catch (error) {
    console.error('[ADMIN ROLEPLAY LIBRARY] Failed to archive snapshot', error instanceof Error ? error.name : 'UnknownError');
    return NextResponse.json({ success: false, error: 'No se pudo retirar el roleplay de la biblioteca' }, { status: 500 });
  }
}

/** Restore a previously withdrawn snapshot. Old sessions were never removed. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ fingerprint: string }> },
) {
  try {
    const auth = await validateAction('admin');
    if ('error' in auth) return NextResponse.json({ success: false, error: auth.error }, { status: 403 });

    const { fingerprint } = await params;
    if (!FINGERPRINT_RE.test(fingerprint)) {
      return NextResponse.json({ success: false, error: 'Invalid catalog fingerprint' }, { status: 400 });
    }

    const result = await prisma.roleplayLibraryArchive.updateMany({
      where: { fingerprint, archivedAt: { not: null } },
      data: { archivedAt: null },
    });
    if (result.count === 0) {
      return NextResponse.json({ success: false, error: 'No archived entry found' }, { status: 404 });
    }
    revalidatePath('/admin/roleplays/library');
    return NextResponse.json({ success: true, archived: false });
  } catch (error) {
    console.error('[ADMIN ROLEPLAY LIBRARY] Failed to restore snapshot', error instanceof Error ? error.name : 'UnknownError');
    return NextResponse.json({ success: false, error: 'No se pudo restaurar el roleplay' }, { status: 500 });
  }
}
