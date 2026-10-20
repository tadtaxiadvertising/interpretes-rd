import React from 'react';
import Link from 'next/link';
import { ShieldAlert, ArrowLeft, Home, Lock } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default function UnauthorizedPage() {
  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden">
      {/* Background aesthetics */}
      <div className="fixed inset-0 bg-[#05050a]" />
      <div className="absolute top-0 left-0 w-full h-full opacity-30">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-red-600/20 rounded-full blur-[120px] animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-indigo-600/20 rounded-full blur-[120px] animate-pulse" style={{ animationDelay: '2s' }} />
      </div>

      <div className="relative z-10 max-w-lg w-full px-6">
        <div className="backdrop-blur-2xl bg-white/[0.02] border border-white/10 rounded-[2.5rem] p-10 shadow-2xl text-center">
          <div className="mb-8 flex justify-center">
            <div className="relative">
              <div className="absolute inset-0 bg-red-500/20 blur-2xl rounded-full" />
              <div className="relative p-6 rounded-3xl bg-gradient-to-br from-red-500/10 to-rose-500/5 border border-red-500/20">
                <Lock size={48} className="text-red-500" />
              </div>
            </div>
          </div>

          <h1 className="text-4xl font-black text-white mb-4 tracking-tight uppercase">
            Acceso Denegado
          </h1>
          
          <div className="w-12 h-1 bg-red-500 mx-auto mb-6 rounded-full" />
          
          <p className="text-slate-400 text-lg mb-10 leading-relaxed">
            Tu cuenta no tiene los privilegios necesarios para acceder a este recurso. 
            Si crees que esto es un error, contacta al administrador del sistema.
          </p>

          <div className="grid grid-cols-1 gap-4">
            <Link 
              href="/login"
              className="flex items-center justify-center gap-3 w-full py-4 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white rounded-2xl font-bold shadow-xl shadow-red-950/20 transition-all active:scale-[0.98]"
            >
              <ArrowLeft size={20} />
              Volver al Login
            </Link>
            
            <Link 
              href="/"
              className="flex items-center justify-center gap-3 w-full py-4 bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white rounded-2xl font-semibold border border-white/5 transition-all"
            >
              <Home size={18} />
              Ir al Inicio
            </Link>
          </div>

          <div className="mt-12 pt-8 border-t border-white/5">
            <div className="flex items-center justify-center gap-2 text-[10px] text-slate-600 font-bold uppercase tracking-[0.3em]">
              <ShieldAlert size={12} />
              <span>Security Auth System · Error 403</span>
            </div>
          </div>
        </div>
        
        <p className="text-center text-slate-700 text-[10px] mt-8 uppercase tracking-widest font-medium">
          Intérpretes RD · System Protection
        </p>
      </div>
    </div>
  );
}
