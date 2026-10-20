'use client';

import { useState } from 'react';
import { Save, Loader2, User, Mail, Phone, Globe, Share2, Award, Zap } from 'lucide-react';
import { submitApplicationAction } from '@/app/actions/recruitment';

interface CandidateFormProps {
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function CandidateForm({ onSuccess, onCancel }: CandidateFormProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    let name = formData.get('name');
    let email = formData.get('email');
    let phone = formData.get('telefono');
    let country = formData.get('pais');
    let englishLevel = formData.get('englishLevel');
    let speedtestMbps = formData.get('speedtestMbps');
    let efsetLink = formData.get('efsetLink');
    let cvUrl = formData.get('cvUrl');

    if (typeof name !== 'string') throw new Error('El nombre completo es obligatorio.');
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error('El correo electrónico no es válido.');
    }
    if (typeof phone !== 'string' || phone.trim().length < 10) {
      throw new Error('El teléfono debe incluir al menos 10 caracteres.');
    }
    if (typeof country !== 'string' || country.trim().length < 2) {
      throw new Error('Indica tu país de residencia.');
    }
    if (typeof englishLevel !== 'string' || !['B1','B2','C1','C2'].includes(englishLevel)) {
      throw new Error('Selecciona un nivel de inglés válido.');
    }
    if (typeof speedtestMbps !== 'string') {
      throw new Error('El speedtest (Mbps) es obligatorio.');
    }
    const speedtest = parseInt(speedtestMbps, 10);
    if (!Number.isInteger(speedtest) || speedtest < 1 || speedtest > 10000) {
      throw new Error('El speedtest debe ser un número entero entre 1 y 10000.');
    }
    if (typeof efsetLink !== 'string' || !efsetLink.startsWith('https://')) {
      throw new Error('El enlace EF SET debe ser HTTPS.');
    }
    if (cvUrl !== null && cvUrl !== undefined && typeof cvUrl !== 'string') {
      throw new Error('El enlace del CV no es válido.');
    }

    try {
      const result = await submitApplicationAction({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim(),
        country: country.trim(),
        englishLevel: englishLevel as 'B1' | 'B2' | 'C1' | 'C2',
        speedtestMbps: speedtest,
        efsetLink,
        cvUrl: cvUrl ?? undefined,
      });

      if (result.success) {
        onSuccess?.();
      } else {
        setError(result.error || 'No se pudo registrar el candidato.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado al registrar el candidato.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-400 text-sm animate-in fade-in slide-in-from-top-2">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Full Name</label>
          <div className="relative">
            <User className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
            <input
              required
              name="name"
              className="w-full bg-white/5 border border-white/10 rounded-2xl py-3 pl-12 pr-4 text-white focus:border-blue-500/50 transition-all outline-none focus:ring-2 focus:ring-blue-500/20"
              placeholder="Applicant Name"
            />
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Email Address</label>
          <div className="relative">
            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
            <input
              required
              type="email"
              name="email"
              className="w-full bg-white/5 border border-white/10 rounded-2xl py-3 pl-12 pr-4 text-white focus:border-blue-500/50 transition-all outline-none focus:ring-2 focus:ring-blue-500/20"
              placeholder="email@example.com"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Phone / WhatsApp</label>
          <div className="relative">
            <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
            <input
              name="telefono"
              className="w-full bg-white/5 border border-white/10 rounded-2xl py-3 pl-12 pr-4 text-white focus:border-blue-500/50 transition-all outline-none focus:ring-2 focus:ring-blue-500/20"
              placeholder="+1 234 567 890"
            />
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Country</label>
          <div className="relative">
            <Globe className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
            <input
              name="pais"
              className="w-full bg-white/5 border border-white/10 rounded-2xl py-3 pl-12 pr-4 text-white focus:border-blue-500/50 transition-all outline-none focus:ring-2 focus:ring-blue-500/20"
              placeholder="Dominican Republic"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="space-y-2">
          <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">EF SET Link</label>
          <div className="relative">
            <Globe className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
            <input
              name="efsetLink"
              type="url"
              className="w-full bg-white/5 border border-white/10 rounded-2xl py-3 pl-12 pr-4 text-white focus:border-blue-500/50 transition-all outline-none focus:ring-2 focus:ring-blue-500/20"
              placeholder="https://efset.org/..."
            />
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">English Level</label>
          <div className="relative">
            <Award className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" size={18} />
            <select
              name="englishLevel"
              className="w-full bg-white/5 border border-white/10 rounded-2xl py-3 pl-12 pr-4 text-white focus:border-blue-500/50 transition-all outline-none focus:ring-2 focus:ring-blue-500/20 appearance-none cursor-pointer [&>option]:bg-[#1a1a1a]"
            >
              <option value="B1">B1 (Intermediate)</option>
              <option value="B2">B2 (Upper Intermediate)</option>
              <option value="C1">C1 (Advanced)</option>
              <option value="C2">C2 (Proficient)</option>
            </select>
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">CV URL (optional)</label>
          <div className="relative">
            <Share2 className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
            <input
              name="cvUrl"
              type="url"
              className="w-full bg-white/5 border border-white/10 rounded-2xl py-3 pl-12 pr-4 text-white focus:border-blue-500/50 transition-all outline-none focus:ring-2 focus:ring-blue-500/20"
              placeholder="https://...pdf"
            />
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Speedtest (Mbps)</label>
          <div className="relative">
            <Zap className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
            <input
              type="number"
              name="speedtestMbps"
              className="w-full bg-white/5 border border-white/10 rounded-2xl py-3 pl-12 pr-4 text-white focus:border-blue-500/50 transition-all outline-none focus:ring-2 focus:ring-blue-500/20"
              placeholder="50"
            />
          </div>
        </div>
        <div className="hidden" aria-hidden="true">
          <input name="fuente" value="web" />
        </div>
      </div>

      <div className="flex gap-4 pt-4">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 py-4 bg-white/5 hover:bg-white/10 text-gray-400 rounded-2xl font-bold transition-all border border-white/10 active:scale-95"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={loading}
          className="flex-1 py-4 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl font-bold transition-all glow flex items-center justify-center gap-2 disabled:opacity-50 active:scale-95"
        >
          {loading ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
          Register Candidate
        </button>
      </div>
    </form>
  );
}
