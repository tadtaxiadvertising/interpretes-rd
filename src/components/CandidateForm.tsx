'use client';

import React, { useState } from 'react';
import { Save, Loader2, User, Mail, Phone, Globe, Share2, Award, Zap } from 'lucide-react';

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
    const speedtestValue = parseInt(String(formData.get('speedtestMbps') ?? ''), 10);
    const data = {
      name: formData.get('name'),
      email: formData.get('email'),
      telefono: formData.get('telefono'),
      pais: formData.get('pais'),
      fuente: formData.get('fuente'),
      englishLevel: formData.get('englishLevel'),
      speedtestMbps: Number.isFinite(speedtestValue) && speedtestValue > 0 ? speedtestValue : null,
      fechaPostulacion: new Date().toISOString(),
      status: 'Aplicante',
    };

    try {
      const response = await fetch('/api/v1/recruitment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        const detail =
          Array.isArray(errorData?.details) && errorData.details[0]?.message
            ? errorData.details[0].message
            : null;
        throw new Error(detail || errorData?.error || 'Failed to create candidate');
      }

      onSuccess?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
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
          <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Source</label>
          <div className="relative">
            <Share2 className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" size={18} />
            <select
              name="fuente"
              className="w-full bg-white/5 border border-white/10 rounded-2xl py-3 pl-12 pr-4 text-white focus:border-blue-500/50 transition-all outline-none focus:ring-2 focus:ring-blue-500/20 appearance-none cursor-pointer [&>option]:bg-[#1a1a1a]"
            >
              <option value="LinkedIn">LinkedIn</option>
              <option value="Facebook">Facebook</option>
              <option value="Referido">Referido</option>
            </select>
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
              <option value="B2">B2 (Upper Intermediate)</option>
              <option value="C1">C1 (Advanced)</option>
              <option value="C2">C2 (Proficient)</option>
            </select>
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
