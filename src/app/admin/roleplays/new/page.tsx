import { readCreationPilotConfig } from '@/lib/roleplay/creation-pilot-config';
import React from 'react';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import prisma from '@/lib/prisma';
import NewRoleplayForm from './NewRoleplayForm';
import { getReusableRoleplayAudio, getRoleplaySnapshotHash } from '@/lib/roleplay-library';
import { ROLEPLAY_MAX_SCENARIOS } from '@/lib/roleplay-limits';
import { openingAssignmentEnabled, readOpeningRequirement } from '@/lib/roleplay/bilingual-opening-assignment';

// Data is read straight from Prisma instead of self-fetching the REST API:
// server components must not rely on internal HTTP calls (no cookie
// forwarding, and `/api/interpreters` / `/api/recruitment/candidates` do
// not exist — only the `/api/v1/*` routes do).
async function getInterpreters() {
  try {
    return await prisma.interpreter.findMany({
      where: { status: { in: ['Activo', 'Training', 'Probation'] } },
      select: { id: true, name: true, externalId: true, emailCorporativo: true, status: true },
      orderBy: { name: 'asc' },
      take: 500,
    });
  } catch {
    return [];
  }
}

async function getCandidates(candidateId?: number) {
  try {
    return await prisma.recruitmentCandidate.findMany({
      where: candidateId
        ? { OR: [{ applications: { some: { status: 'APPLIED' } } }, { id: candidateId }] }
        : { applications: { some: { status: 'APPLIED' } } },
      select: { id: true, name: true, email: true },
      orderBy: { fechaPostulacion: 'desc' },
      take: 500,
    });
  } catch {
    return [];
  }
}

export default async function NewRoleplayPage({
  searchParams,
}: {
  searchParams: Promise<{ candidateId?: string; sourceSessionId?: string; studioTransfer?: string }>;
}) {
  const { candidateId, sourceSessionId, studioTransfer } = await searchParams;
  const storageUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const parsedCandidateId = candidateId && /^\d+$/.test(candidateId) ? Number(candidateId) : undefined;
  const [interpreters, candidates] = await Promise.all([
    getInterpreters(),
    getCandidates(parsedCandidateId),
  ]);
  const initialCandidateId = parsedCandidateId && candidates.some((candidate) => candidate.id === parsedCandidateId)
    ? parsedCandidateId
    : undefined;

  let librarySource: {
    id: string;
    fingerprint: string;
    requiresOpening?: boolean;
    audioKind?: 'private' | 'legacy';
    scenarios: Array<{ title: string; durationLimitSec: number | null; scriptPrompt: string | null; studioTurn: number | null; studioSpeaker: string | null; studioLanguage: string | null; sourceStartSec: number | null; sourceEndSec: number | null }>;
  } | undefined;

  if (sourceSessionId && /^[a-zA-Z0-9_-]{5,120}$/.test(sourceSessionId) && storageUrl) {
    const source = await prisma.roleplaySession.findUnique({
      where: { id: sourceSessionId },
      select: {
        status: true,
        scenarios: {
          orderBy: { order: 'asc' },
          select: { order: true, title: true, baseAudioUrl: true, durationLimitSec: true, scriptPrompt: true, studioTurn: true, studioSpeaker: true, studioLanguage: true, sourceStartSec: true, sourceEndSec: true, expectedKeys: true },
        },
      },
    });
    const reusable = source ? getReusableRoleplayAudio(source.scenarios, storageUrl) : null;
    if (source && source.status !== 'DRAFT' && source.status !== 'CANCELLED' &&
        source.scenarios.length > 0 && source.scenarios.length <= ROLEPLAY_MAX_SCENARIOS &&
        reusable) {
      const fingerprint = getRoleplaySnapshotHash(source.scenarios);
      const visibility = await prisma.roleplayLibraryArchive.findUnique({
        where: { fingerprint },
        select: { archivedAt: true },
      });
      if (!visibility?.archivedAt) librarySource = {
        id: sourceSessionId,
        fingerprint: getRoleplaySnapshotHash(source.scenarios),
        audioKind: reusable.kind,
        requiresOpening: reusable.kind === 'private' || (process.env.ROLEPLAY_BILINGUAL_OPENING_API_ENABLED === 'true'
          ? await readOpeningRequirement(prisma, sourceSessionId) : false),
        scenarios: source.scenarios.map(({ title, durationLimitSec, scriptPrompt, studioTurn, studioSpeaker, studioLanguage, sourceStartSec, sourceEndSec }) => ({ title, durationLimitSec, scriptPrompt, studioTurn, studioSpeaker, studioLanguage, sourceStartSec, sourceEndSec })),
      };
    }
  }
  return (
    <div className="min-h-screen bg-[var(--background)] py-12 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <Link 
            href="/admin/roleplays"
            className="p-2 hover:bg-[var(--theme-hover)] rounded-xl transition-colors text-[var(--text-secondary)] hover:text-[var(--foreground)]"
          >
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="text-3xl font-bold text-[var(--foreground)]">{librarySource ? 'Asignar ejercicio de la biblioteca' : 'Crear sesión de práctica'}</h1>
            <p className="text-[var(--text-secondary)]">{librarySource ? 'Reutiliza un ejercicio sin volver a cargar el audio' : 'Asigna ejercicios y audios a los participantes'}</p>
          </div>
        </div>

        {librarySource?.requiresOpening && !openingAssignmentEnabled() ? (
          <div role="alert" className="rounded-2xl border border-[var(--border)] bg-[var(--theme-surface-muted)] p-6">
            <p className="font-semibold text-[var(--foreground)]">La asignación privada todavía no está habilitada</p>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">Puedes revisar la plantilla en la biblioteca. No se permite omitir su protocolo de apertura.</p>
            <Link href="/admin/roleplays/library" className="mt-4 inline-block text-[var(--theme-link)] underline">Volver a la biblioteca</Link>
          </div>
        ) : sourceSessionId && !librarySource ? (
          <div role="alert" className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-6">
            <p className="font-semibold text-[var(--theme-warning)]">La plantilla solicitada no está disponible</p>
            <p className="mt-2 text-sm text-[var(--theme-warning)]">Puede haber cambiado, no tener audios reutilizables o haber sido retirada.</p>
            <Link href="/admin/roleplays/library" className="mt-4 inline-block text-[var(--theme-link)] underline">Volver a la biblioteca</Link>
          </div>
        ) : (
          <NewRoleplayForm interpreters={interpreters} candidates={candidates}
            initialCandidateId={initialCandidateId} librarySource={librarySource}
            studioTransfer={!sourceSessionId && typeof studioTransfer === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(studioTransfer) ? studioTransfer : undefined}
            openingAssignmentEnabled={openingAssignmentEnabled()}
            creationRecoveryEnabled={readCreationPilotConfig(process.env).keyedCreationEnabled}
            receiptRecoveryEnabled={readCreationPilotConfig(process.env).receiptsEnabled}
            directUploadEnabled={openingAssignmentEnabled() && [
              'ROLEPLAY_DIRECT_UPLOAD_RESERVATION_API_ENABLED',
              'ROLEPLAY_DIRECT_UPLOAD_VERIFICATION_API_ENABLED',
              'ROLEPLAY_DIRECT_UPLOAD_PUBLICATION_ENABLED',
              'ROLEPLAY_DIRECT_UPLOAD_PUBLICATION_PILOT_API_ENABLED',
              'ROLEPLAY_DIRECT_UPLOAD_INCREMENTAL_API_ENABLED',
              'ROLEPLAY_DIRECT_UPLOAD_FORM_ENABLED',
            ].every(flag=>process.env[flag]==='true')} />
        )}
      </div>
    </div>
  );
}