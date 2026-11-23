import { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';
import RecruitmentFunnel from '@/components/recruitment/RecruitmentFunnel';

export const metadata: Metadata = {
  title: 'Postúlate como Intérprete | Intérpretes RD',
  description: 'Únete a Intérpretes RD. Completa tu postulación y conoce las etapas de evaluación para formar parte de nuestro equipo.',
};

export default function PostularPage() {
  return (
    <div className="theme-postular min-h-screen bg-slate-950 py-6 px-4 sm:py-12">
      <div className="max-w-4xl mx-auto">
        <div className="mb-5 flex items-center justify-between gap-3"><Link href="/" className="text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">Volver al inicio</Link><ThemeSwitcher /></div>
        {/* Hero */}
        <div className="text-center mb-7 sm:mb-12 animate-in fade-in duration-700">
          <Image src="/interpretes-rd-logo.webp" alt="Logo de Intérpretes RD" width={100} height={100} className="mx-auto mb-6 rounded-2xl bg-white p-2 shadow-xl shadow-blue-500/10" />
          <h1 className="text-3xl sm:text-4xl font-bold text-white mb-4">Únete a Intérpretes RD</h1>
          <p className="text-base sm:text-lg text-gray-400 max-w-2xl mx-auto">
            Buscamos intérpretes profesionales para interpretación remota (VRI/OPI). 
            Completa tu postulación en 4 pasos y accede a oportunidades globales.
          </p>
        </div>

        {/* Funnel Wizard */}
        <RecruitmentFunnel />
      </div>
    </div>
  );
}