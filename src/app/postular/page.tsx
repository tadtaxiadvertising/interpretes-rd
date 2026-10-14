import { Metadata } from 'next';
import RecruitmentFunnel from '@/components/recruitment/RecruitmentFunnel';

export const metadata: Metadata = {
  title: 'Postúlate como Intérprete | Intérpretes RD',
  description: 'Únete a Intérpretes RD. Completa tu postulación y conoce las etapas de evaluación para formar parte de nuestro equipo.',
};

export default function PostularPage() {
  return (
    <div className="min-h-screen bg-slate-950 py-12 px-4">
      <div className="max-w-4xl mx-auto">
        {/* Hero */}
        <div className="text-center mb-12 animate-in fade-in duration-700">
          <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-xl shadow-blue-500/20">
            <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          </div>
          <h1 className="text-4xl font-bold text-white mb-4">Únete a Free Interpreters</h1>
          <p className="text-lg text-gray-400 max-w-2xl mx-auto">
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