import prisma from '@/lib/prisma';
import AssignmentForm from '@/components/admin/AssignmentForm';

export const dynamic = 'force-dynamic';

export default async function AssignmentsPage() {
  const [assignments, interpreters, accounts] = await Promise.all([
    prisma.interpreterAccountAssignment.findMany({
      orderBy: [{ startsAt: 'desc' }, { id: 'desc' }], take: 100,
      include: { interpreter: { select: { name: true } }, account: { select: { name: true, client: { select: { name: true } }, company: { select: { name: true } } } } },
    }),
    prisma.interpreter.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    prisma.account.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, client: { select: { name: true } }, company: { select: { name: true } } } }),
  ]);
  return <section className="space-y-6 text-[var(--foreground)]">
    <header><p className="text-sm uppercase tracking-widest text-[var(--theme-link)]">Administración · Operaciones</p><h1 className="text-3xl font-bold">Asignaciones de intérpretes</h1><p className="text-[var(--text-secondary)]">Asigna intérpretes a cuentas específicas de cada cliente. Se conserva el historial por fechas sin modificar tarifas ni producción.</p></header>
    <AssignmentForm interpreters={interpreters} accounts={accounts.map(a => ({ id: a.id, name: a.name, clientName: a.client?.name ?? null, companyName: a.company?.name ?? null }))} />
    <div role="region" aria-label="Historial de asignaciones" tabIndex={0} className="max-w-full overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--theme-panel)]"><table className="w-full min-w-[850px] text-left text-sm">
      <thead className="bg-[var(--theme-surface-muted)] text-[var(--text-secondary)]"><tr><th className="p-4">Intérprete</th><th className="p-4">Cliente</th><th className="p-4">Compañía / cuenta</th><th className="p-4">Inicio</th><th className="p-4">Fin</th></tr></thead>
      <tbody>{assignments.map(a => <tr key={a.id} className="border-t border-[var(--border)] hover:bg-[var(--theme-hover)] transition-colors"><td className="p-4">{a.interpreter.name}</td><td className="p-4">{a.account.client?.name || 'Pendiente de identificar'}</td><td className="p-4">{a.account.company?.name || 'Sin compañía'} / {a.account.name}</td><td className="p-4">{a.startsAt.toISOString().slice(0,10)}</td><td className="p-4">{a.endsAt?.toISOString().slice(0,10) || 'Vigente'}</td></tr>)}
      {!assignments.length && <tr><td colSpan={5} className="p-6 text-center text-[var(--text-secondary)]">No hay asignaciones registradas.</td></tr>}</tbody>
    </table></div>
    <p className="text-xs text-[var(--text-tertiary)]">Se muestran las 100 asignaciones más recientes.</p>
  </section>;
}
