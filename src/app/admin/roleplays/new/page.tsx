import React from 'react';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import prisma from '@/lib/prisma';
import NewRoleplayForm from './NewRoleplayForm';
import { getReusableBaseAudioPath, getRoleplaySnapshotHash } from '@/lib/roleplay-library';
import { ROLEPLAY_MAX_SCENARIOS } from '@/lib/roleplay-limits';

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
  searchParams: Promise<{ candidateId?: string; sourceSessionId?: string }>;
}) {
  const { candidateId, sourceSessionId } = await searchParams;
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
    scenarios: Array<{ title: string; durationLimitSec: number | null; scriptPrompt: string | null }>;
  } | undefined;

  if (sourceSessionId && /^[a-zA-Z0-9_-]{5,120}$/.test(sourceSessionId) && storageUrl) {
    const source = await prisma.roleplaySession.findUnique({
      where: { id: sourceSessionId },
      select: {
        status: true,
        scenarios: {
          orderBy: { order: 'asc' },
          select: { order: true, title: true, baseAudioUrl: true, durationLimitSec: true, scriptPrompt: true, expectedKeys: true },
        },
      },
    });
    if (source && source.status !== 'DRAFT' && source.status !== 'CANCELLED' &&
        source.scenarios.length > 0 && source.scenarios.length <= ROLEPLAY_MAX_SCENARIOS &&
        source.scenarios.every((scenario) => getReusableBaseAudioPath(scenario.baseAudioUrl, storageUrl))) {
      const fingerprint = getRoleplaySnapshotHash(source.scenarios);
      const visibility = await prisma.roleplayLibraryArchive.findUnique({
        where: { fingerprint },
        select: { archivedAt: true },
      });
      if (!visibility?.archivedAt) librarySource = {
        id: sourceSessionId,
        fingerprint: getRoleplaySnapshotHash(source.scenarios),
        scenarios: source.scenarios.map(({ title, durationLimitSec, scriptPrompt }) => ({ title, durationLimitSec, scriptPrompt })),
      };
    }
  }
  return (
    <div className="min-h-screen bg-slate-950 py-12 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <Link 
            href="/admin/roleplays"
            className="p-2 hover:bg-white/10 rounded-xl transition-colors text-gray-400 hover:text-white"
          >
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="text-3xl font-bold text-white">{librarySource ? 'Asignar roleplay de la biblioteca' : 'Crear sesión de roleplay'}</h1>
            <p className="text-gray-400">{librarySource ? 'Reutiliza un ejercicio sin subir nuevamente el audio' : 'Asigna escenarios y audios a participantes'}</p>
          </div>
        </div>

        {sourceSessionId && !librarySource ? (
          <div role="alert" className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-6">
            <p className="font-semibold text-amber-200">La plantilla solicitada no está disponible</p>
            <p className="mt-2 text-sm text-amber-100/80">Puede haber cambiado, no tener audios reutilizables o haber sido retirada.</p>
            <Link href="/admin/roleplays/library" className="mt-4 inline-block text-blue-300 underline">Volver a la biblioteca</Link>
          </div>
        ) : (
          <NewRoleplayForm interpreters={interpreters} candidates={candidates}
            initialCandidateId={initialCandidateId} librarySource={librarySource} />
        )}
      </div>
    </div>
  );
}