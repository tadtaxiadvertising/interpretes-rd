import prisma from '@/lib/prisma';
import AssignmentForm from '@/components/admin/AssignmentForm';

export const dynamic = 'force-dynamic';

export default async function AssignmentsPage() {
  const [assignments, interpreters, accounts] = await Promise.all([
    prisma.interpreterAccountAssignment.findMany({
      orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
      take: 100,
      include: { interpreter: { select: { name: true } }, account: { select: { name: true, company: { select: { name: true } } } } },
    }),
    prisma.interpreter.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    prisma.account.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ]);
  return <section className="space-y-6 text-white">
    <header><p className="text-sm uppercase tracking-widest text-blue-400">Administración · Operaciones</p><h1 className="text-3xl font-bold">Asignaciones de intérpretes</h1><p className="text-slate-400">Un intérprete puede trabajar en múltiples cuentas. Se conserva el historial por fechas sin modificar tarifas ni producción.</p></header>
    <AssignmentForm interpreters={interpreters} accounts={accounts} />
    <div className="overflow-x-auto rounded-2xl border border-white/10"><table className="w-full min-w-[650px] text-left text-sm">
      <thead className="bg-white/5"><tr><th className="p-4">Intérprete</th><th className="p-4">Compañía / cuenta</th><th className="p-4">Inicio</th><th className="p-4">Fin</th></tr></thead>
      <tbody>{assignments.map(a => <tr key={a.id} className="border-t border-white/10"><td className="p-4">{a.interpreter.name}</td><td className="p-4">{a.account.company?.name || 'Sin compañía'} / {a.account.name}</td><td className="p-4">{a.startsAt.toISOString().slice(0,10)}</td><td className="p-4">{a.endsAt?.toISOString().slice(0,10) || 'Vigente'}</td></tr>)}
      {!assignments.length && <tr><td colSpan={4} className="p-6 text-center text-slate-400">No hay asignaciones registradas.</td></tr>}</tbody>
    </table></div>
    <p className="text-xs text-slate-500">Se muestran las 100 asignaciones más recientes.</p>
  </section>;
}
