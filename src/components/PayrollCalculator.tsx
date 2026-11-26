import Link from 'next/link';
import { Calculator } from 'lucide-react';

/** Kept as a compatibility component for older page imports. */
export function PayrollCalculator(_props: { interpreters: { id: number; name: string }[] }) {
  return (
    <section className="mx-auto max-w-xl space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--theme-panel)] p-4 sm:p-6">
      <h2 className="flex items-center gap-2 text-xl font-bold text-[var(--foreground)]">
        <Calculator aria-hidden="true" /> Generación de nómina
      </h2>
      <p className="text-sm text-[var(--text-secondary)]">
        La calculadora anterior se ha retirado para evitar contabilizar dos veces los minutos sincronizados.
        Utiliza el motor actual del módulo de nómina.
      </p>
      <Link href="/payroll" className="theme-action-primary inline-flex min-h-11 items-center rounded-xl px-4 py-2 font-semibold">
        Ir a nómina
      </Link>
    </section>
  );
}
