import Link from 'next/link';
import { AlertTriangle, AudioLines, Copy, Layers3, Library, Plus } from 'lucide-react';
import prisma from '@/lib/prisma';
import { getReusableBaseAudioPath, getRoleplaySnapshotHash } from '@/lib/roleplay-library';

export const dynamic = 'force-dynamic';

const SCAN_LIMIT = 400;

async function getLibrary() {
  const storageUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  if (!storageUrl) {
    return { items: [], scanned: 0, error: 'El almacenamiento de audio no está configurado.' };
  }

  try {
    const sessions = await prisma.roleplaySession.findMany({
      where: { status: { not: 'DRAFT' }, scenarios: { some: {} } },
      orderBy: { createdAt: 'desc' },
      take: SCAN_LIMIT,
      select: {
        id: true,
        status: true,
        createdAt: true,
        scenarios: {
          orderBy: { order: 'asc' },
          select: {
            id: true, order: true, title: true, baseAudioUrl: true,
            durationLimitSec: true, scriptPrompt: true,
          },
        },
      },
    });

    const versions = new Map<string, {
      sourceSessionId: string;
      fingerprint: string;
      createdAt: Date;
      titles: string[];
      audioCount: number;
      assignmentsInWindow: number;
    }>();

    for (const session of sessions) {
      const scenarios = session.scenarios;
      if (scenarios.length === 0 || scenarios.some((scenario) =>
        !getReusableBaseAudioPath(scenario.baseAudioUrl, storageUrl)
      )) continue;

      const fingerprint = getRoleplaySnapshotHash(scenarios);
      const existing = versions.get(fingerprint);
      if (existing) {
        existing.assignmentsInWindow++;
        continue;
      }
      versions.set(fingerprint, {
        sourceSessionId: session.id,
        fingerprint,
        createdAt: session.createdAt,
        titles: scenarios.map((scenario) => scenario.title),
        audioCount: scenarios.length,
        assignmentsInWindow: 1,
      });
    }
    return { items: [...versions.values()], scanned: sessions.length, error: null as string | null };
  } catch (error) {
    console.error('[ADMIN ROLEPLAY LIBRARY] Failed to load existing scenario snapshots:', error);
    return {
      items: [],
      scanned: 0,
      error: 'No se pudo consultar la biblioteca de roleplays. Revisa el estado de la base de datos.',
    };
  }
}

export default async function RoleplayLibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const params = await searchParams;
  const q = (params.q ?? '').trim().toLowerCase().slice(0, 100);
  const result = await getLibrary();
  const matches = q
    ? result.items.filter((item) => item.titles.some((title) => title.toLowerCase().includes(q)) || item.fingerprint.startsWith(q))
    : result.items;

  return (
    <div className="space-y-7">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-blue-300">
            <Library size={17} /> Roleplay / Biblioteca
          </div>
          <h1 className="text-3xl font-bold text-white">Biblioteca de roleplays</h1>
          <p className="mt-2 max-w-3xl text-sm text-gray-400">
            Reutiliza los escenarios y audios de sesiones publicadas. Una misma grabación no necesita volver a subirse
            para asignar una nueva práctica.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/roleplays" className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-white hover:bg-white/10">
            Sesiones
          </Link>
          <Link href="/admin/roleplays/new" className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white hover:bg-red-500">
            <Plus size={17} /> Importar roleplay
          </Link>
        </div>
      </header>

      <section className="rounded-2xl border border-blue-500/20 bg-blue-500/5 p-5 text-sm text-blue-100">
        <div className="mb-2 flex items-center gap-2 font-semibold"><Layers3 size={17} /> Instantáneas reutilizables</div>
        <p className="text-blue-100/80">
          Esta primera biblioteca recupera los ejercicios ya publicados y agrupa versiones idénticas por su huella SHA-256
          de contenido. No modifica ni elimina sesiones históricas, y no requiere una nueva tabla. La edición y el
          versionado editorial formal se incorporarán en una etapa posterior.
        </p>
        <p className="mt-2 text-xs text-blue-100/70">
          Se examinan las últimas {SCAN_LIMIT} sesiones con escenarios; los ejercicios con audio externo,
          rutas firmadas temporales o archivos sin referencia segura no se ofrecen para reutilización.
        </p>
      </section>

      {result.error && (
        <div role="alert" className="flex items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-5 text-red-200">
          <AlertTriangle size={19} className="shrink-0" />
          <p>{result.error}</p>
        </div>
      )}

      <form action="/admin/roleplays/library" method="get" className="flex flex-wrap gap-3">
        <label className="sr-only" htmlFor="library-query">Buscar ejercicios por título o huella</label>
        <input id="library-query" name="q" type="search" maxLength={100}
          defaultValue={params.q?.slice(0, 100) ?? ''}
          placeholder="Buscar por escenario o huella SHA-256"
          className="min-w-64 flex-1 rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-white placeholder:text-gray-500" />
        <button type="submit" className="rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white hover:bg-blue-500">Buscar</button>
        {q && <Link href="/admin/roleplays/library" className="rounded-xl border border-white/10 px-4 py-3 text-sm text-gray-300 hover:bg-white/5">Limpiar</Link>}
      </form>

      <section aria-label="Ejercicios reutilizables" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-white">Ejercicios disponibles</h2>
          {!result.error && <p className="text-sm text-gray-400">{matches.length} instantáneas · {result.scanned} sesiones examinadas</p>}
        </div>
        {!result.error && matches.length === 0 && (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-12 text-center">
            <AudioLines size={38} className="mx-auto mb-3 text-gray-500" />
            <p className="font-semibold text-white">No hay ejercicios reutilizables {q ? 'con esa búsqueda' : 'todavía'}</p>
            <p className="mt-2 text-sm text-gray-400">Publica un roleplay con audios válidos para incorporarlo a esta biblioteca.</p>
          </div>
        )}
        {matches.map((item) => (
          <article key={item.fingerprint} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <h3 className="text-lg font-bold text-white">{item.titles[0] || 'Roleplay sin título'}</h3>
                <p className="mt-1 text-sm text-gray-400">
                  {item.audioCount} {item.audioCount === 1 ? 'escenario' : 'escenarios'} ·
                  {' '}{item.assignmentsInWindow} {item.assignmentsInWindow === 1 ? 'sesión coincidente' : 'sesiones coincidentes'} en la muestra
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {item.titles.slice(0, 5).map((title, index) => (
                    <span key={index} className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-gray-300">
                      {index + 1}. {title}
                    </span>
                  ))}
                  {item.titles.length > 5 && <span className="px-2 py-1 text-xs text-gray-500">+{item.titles.length - 5} más</span>}
                </div>
                <p className="mt-3 flex items-center gap-2 font-mono text-xs text-gray-500">
                  <Copy size={13} /> SHA-256: {item.fingerprint.slice(0, 16)}…
                </p>
              </div>
              <Link
                href={`/admin/roleplays/new?sourceSessionId=${encodeURIComponent(item.sourceSessionId)}`}
                className="rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-500"
              >
                Reutilizar y asignar
              </Link>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
