import Link from 'next/link';
import { ArrowLeft, AudioLines, Library, ShieldCheck } from 'lucide-react';
import { notFound } from 'next/navigation';
import prisma from '@/lib/prisma';
import { getAdminReviewUrl } from '@/lib/roleplay';
import { getReusableBaseAudioPath, getRoleplaySnapshotHash } from '@/lib/roleplay-library';
import { ROLEPLAY_MAX_SCENARIOS } from '@/lib/roleplay-limits';

export const dynamic = 'force-dynamic';

export default async function RoleplayLibraryDetailPage({
  params,
}: {
  params: Promise<{ sourceSessionId: string }>;
}) {
  const { sourceSessionId } = await params;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  if (!supabaseUrl || !/^[a-zA-Z0-9_-]{5,120}$/.test(sourceSessionId)) notFound();

  const source = await prisma.roleplaySession.findUnique({
    where: { id: sourceSessionId },
    select: {
      id: true,
      status: true,
      createdAt: true,
      scenarios: {
        orderBy: { order: 'asc' },
        select: {
          id: true,
          order: true,
          title: true,
          baseAudioUrl: true,
          durationLimitSec: true,
          scriptPrompt: true,
          expectedKeys: true,
        },
      },
    },
  });

  if (!source || source.status === 'DRAFT' || source.status === 'CANCELLED' ||
      source.scenarios.length === 0 || source.scenarios.length > ROLEPLAY_MAX_SCENARIOS) {
    notFound();
  }

  const paths = source.scenarios.map((scenario) => getReusableBaseAudioPath(scenario.baseAudioUrl, supabaseUrl));
  if (paths.some((path) => !path)) notFound();

  const fingerprint = getRoleplaySnapshotHash(source.scenarios);
  const preview: Array<{ title: string; order: number; durationLimitSec: number | null; scriptPrompt: string | null; expectedKeys: string[]; audioUrl: string | null }> = [];

  // Keep signed links scoped to this authenticated administrative page,
  // and do not block the entire preview if an old object has been deleted.
  for (let index = 0; index < source.scenarios.length; index++) {
    const scenario = source.scenarios[index];
    let audioUrl: string | null = null;
    try {
      audioUrl = await getAdminReviewUrl(paths[index]!);
    } catch (error) {
      console.error('[ADMIN ROLEPLAY LIBRARY] Preview audio unavailable:', scenario.id, error instanceof Error ? error.message : 'Unknown error');
    }
    preview.push({
      title: scenario.title,
      order: scenario.order,
      durationLimitSec: scenario.durationLimitSec,
      scriptPrompt: scenario.scriptPrompt,
      expectedKeys: scenario.expectedKeys,
      audioUrl,
    });
  }

  const allAvailable = preview.every((scenario) => scenario.audioUrl !== null);

  return (
    <div className="space-y-7">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/admin/roleplays/library" className="mb-3 inline-flex items-center gap-2 text-sm text-blue-300 hover:text-blue-200">
            <ArrowLeft size={16} /> Volver a la biblioteca
          </Link>
          <div className="mb-2 flex items-center gap-2 text-sm text-gray-400"><Library size={17} /> Vista previa de plantilla</div>
          <h1 className="text-3xl font-bold text-white">{preview[0]?.title ?? 'Roleplay'}</h1>
          <p className="mt-2 text-sm text-gray-400">
            {preview.length} escenarios · Creado el {source.createdAt.toLocaleDateString('es-DO')} · Estado de referencia: {source.status}
          </p>
        </div>
        {allAvailable ? (
          <Link href={`/admin/roleplays/new?sourceSessionId=${encodeURIComponent(source.id)}`}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-500">
            <ShieldCheck size={17} /> Asignar esta plantilla
          </Link>
        ) : (
          <span className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            Audio faltante: no se puede asignar
          </span>
        )}
      </header>

      <section className="rounded-2xl border border-blue-500/20 bg-blue-500/5 p-4">
        <p className="text-sm font-semibold text-blue-100">Instantánea identificada</p>
        <p className="mt-2 break-all font-mono text-xs text-blue-100/70">{fingerprint}</p>
        <p className="mt-2 text-xs text-gray-400">
          La huella identifica referencias y metadatos de escenarios; no representa un checksum de los archivos MP3.
          Los enlaces de escucha se generan temporalmente y no modifican el ejercicio original.
        </p>
      </section>

      <section aria-label="Escenarios de la plantilla" className="space-y-4">
        {preview.map((scenario, index) => (
          <article key={index} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 text-sm font-bold text-blue-300">{index + 1}</span>
              <div>
                <h2 className="text-lg font-semibold text-white">{scenario.title}</h2>
                <p className="text-xs text-gray-400">
                  {scenario.durationLimitSec ? `Límite de respuesta: ${scenario.durationLimitSec} segundos` : 'Duración predeterminada'}
                </p>
              </div>
            </div>
            {scenario.audioUrl ? (
              <div className="mt-4">
                <p className="mb-2 flex items-center gap-2 text-sm text-gray-300"><AudioLines size={16} /> Audio de referencia</p>
                <audio src={scenario.audioUrl} controls preload="none" className="w-full" aria-label={`Audio original de ${scenario.title}`} />
              </div>
            ) : (
              <p role="alert" className="mt-4 text-sm text-amber-300">Este audio no está disponible para reproducción.</p>
            )}
            {scenario.scriptPrompt && (
              <div className="mt-4 rounded-xl border border-white/10 bg-slate-950/40 p-4">
                <h3 className="text-sm font-semibold text-white">Instrucciones del escenario</h3>
                <p className="mt-2 whitespace-pre-wrap text-sm text-gray-300">{scenario.scriptPrompt}</p>
              </div>
            )}
            {scenario.expectedKeys.length > 0 && (
              <div className="mt-4">
                <h3 className="text-sm font-semibold text-white">Criterios de evaluación</h3>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-300">
                  {scenario.expectedKeys.map((key, keyIndex) => <li key={keyIndex}>{key}</li>)}
                </ul>
              </div>
            )}
          </article>
        ))}
      </section>
    </div>
  );
}
