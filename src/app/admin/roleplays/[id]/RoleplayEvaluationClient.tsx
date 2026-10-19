'use client';

import React, { useState, useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { ShieldCheck, CheckCircle2, AlertTriangle, Loader2, Scale } from 'lucide-react';
import { evaluateRoleplay } from '@/app/actions/roleplay';
import { calculateRoleplayScore, clampDimensionScore } from '@/lib/roleplay/scoring';
import { cn } from '@/lib/utils';

// Dimension inputs are 0..10; weights come from the canonical scoring module.
const DIMENSION_FIELDS = [
  { key: 'protocolScore', label: 'Protocol (35%)' },
  { key: 'interpretationScore', label: 'Interpretation (40%)' },
  { key: 'languageScore', label: 'Language (15%)' },
  { key: 'serviceScore', label: 'Service (5%)' },
  { key: 'technicalScore', label: 'Technical (5%)' },
] as const;

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={cn(
        "w-full py-4 rounded-xl font-bold transition-all flex items-center justify-center gap-2",
        pending
          ? "bg-slate-800 text-slate-500 cursor-not-allowed" 
          : "bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-600/20"
      )}
    >
      {pending ? <><Loader2 className="animate-spin" size={20} /> Evaluating...</> : <><Scale size={20} /> Submit Evaluation</>}
    </button>
  );
}

interface RoleplayEvaluationClientProps {
  sessionId: string;
  scenarioId: string;
  isEvaluated: boolean;
  existingScore?: {
    protocolScore: number;
    interpretationScore: number;
    languageScore: number;
    serviceScore: number;
    technicalScore: number;
    criticalError: boolean;
    totalScore: number;
    actionRequired: string;
  } | null;
}

export function RoleplayEvaluationClient({ 
  sessionId, 
  scenarioId, 
  isEvaluated,
  existingScore 
}: RoleplayEvaluationClientProps) {
  const [state, formAction] = useActionState(evaluateRoleplay, null);
  const [formData, setFormData] = useState({
    protocolScore: 10,
    interpretationScore: 10,
    languageScore: 10,
    serviceScore: 10,
    technicalScore: 10,
    criticalError: false,
    comments: '',
  });

  const handleChange = (key: string, value: any) => {
    setFormData(prev => ({ ...prev, [key]: value }));
  };

  if (isEvaluated) {
    return (
      <div className="glass p-6 rounded-2xl border border-white/5 bg-green-500/5">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-green-500/10 rounded-xl flex items-center justify-center">
              <svg className="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </div>
            <div>
              <h4 className="text-lg font-bold text-white">Already Evaluated</h4>
              <p className="text-gray-400 text-sm">This scenario has already been evaluated</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-3xl font-bold text-green-400">
                {existingScore?.totalScore?.toFixed(1) ?? "0"}%
              </p>
              <p className="text-sm text-gray-400">{existingScore?.actionRequired ?? "N/A"}</p>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mt-6">
          {DIMENSION_FIELDS.map(({ key, label }) => (
            <div key={key} className="text-center">
              <p className="text-xs text-gray-500 mb-1">{label}</p>
              <p className="text-2xl font-bold text-white">
                {existingScore?.[key as keyof typeof existingScore] ?? "---"}
              </p>
            </div>
          ))}
        </div>
        {existingScore?.criticalError && (
          <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
            <p className="text-red-400 font-bold">Critical Error Flagged</p>
          </div>
        )}
      </div>
    );
  }


  const calculatedScore = calculateRoleplayScore({
    protocol: clampDimensionScore(formData.protocolScore),
    interpretation: clampDimensionScore(formData.interpretationScore),
    language: clampDimensionScore(formData.languageScore),
    service: clampDimensionScore(formData.serviceScore),
    technical: clampDimensionScore(formData.technicalScore),
    criticalError: formData.criticalError,
  }).totalScore;

  return (
    <div className="glass p-6 rounded-2xl border border-white/5">
      <div className="mb-6">
        <h4 className="text-lg font-bold text-white flex items-center gap-3">
          <ShieldCheck className="text-red-400" />
          QA Evaluation
        </h4>
        <p className="text-gray-400 mt-1">Score the scenario across all 5 dimensions. Selecting <strong className="text-red-400">Critical Error</strong> forces the total score to 0.</p>
      </div>

      <form action={formAction} className="space-y-6">
        {/* Critical Error Toggle */}
        <div className={cn(
          "p-6 rounded-2xl border transition-all flex items-start gap-4",
          formData.criticalError ? "bg-red-500/10 border-red-500/50" : "bg-white/5 border-white/10 hover:border-red-500/30"
        )}>
          <div className="pt-1">
             <input 
              type="checkbox" 
              name="criticalError" 
              id="criticalError"
              checked={formData.criticalError}
              onChange={(e) => {
                setFormData(prev => ({ ...prev, criticalError: e.target.checked }));
              }}
              className="w-5 h-5 accent-red-500 cursor-pointer rounded bg-slate-950 border-white/10" 
            />
          </div>
          <div>
            <label htmlFor="criticalError" className="text-lg font-bold text-white cursor-pointer block">
              Flag: Critical Error Detected
            </label>
            <p className="text-sm text-gray-400 mt-1">Forces total score to 0.00% regardless of other scores.
            </p>
          </div>
        </div>

        {/* Scoring Grid */}
        <div className={cn("grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 transition-opacity duration-300", formData.criticalError && "opacity-30 pointer-events-none grayscale")}>
          {DIMENSION_FIELDS.map(field => (
            <div key={field.key} className="space-y-2">
              <label className="text-xs font-bold text-gray-400 uppercase tracking-wider block">{field.label}</label>
              <input
                type="number"
                name={field.key}
                min="0"
                max="10"
                step="0.5"
                value={String(formData[field.key as keyof typeof formData])}
                onChange={(e) => handleChange(field.key, clampDimensionScore(parseFloat(e.target.value) || 0))}
                className="w-full bg-slate-950 border border-white/10 rounded-xl py-3 px-4 text-white focus:border-red-500 transition-colors font-mono text-center text-xl"
              />
            </div>
          ))}
        </div>

        {/* Live Score Preview */}
        <div className="p-4 rounded-xl border transition-colors" style={{
          backgroundColor: formData.criticalError ? "rgba(239, 68, 68, 0.1)" : "rgba(34, 197, 94, 0.1)",
          borderColor: formData.criticalError ? "rgba(239, 68, 68, 0.3)" : "rgba(34, 197, 94, 0.3)"
        }}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Estimated Total Score</p>
              <p className="text-3xl font-bold" style={{ color: formData.criticalError ? "#ef4444" : "#22c55e" }}>
                {calculatedScore.toFixed(2)}%
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm text-gray-500">Critical Error</p>
              <p className="text-xl font-bold" style={{ color: formData.criticalError ? "#ef4444" : "#22c55e" }}>
                {formData.criticalError ? "YES" : "NO"}
              </p>
            </div>
          </div>
        </div>

        {/* Comments */}
        <div className="space-y-2">
          <label className="text-sm font-bold text-gray-300 uppercase tracking-wider block">Auditor Comments</label>
          <textarea 
            name="comments" 
            rows={4}
            value={formData.comments}
            onChange={(e) => handleChange("comments", e.target.value)}
            className="w-full bg-slate-950 border border-white/10 rounded-xl py-3 px-4 text-white focus:border-red-500 transition-colors resize-none"
            placeholder="Describe the protocol violation, technical issue, or excellent performance..."
          ></textarea>
        </div>

        {/* Feedback Messages */}
        {state?.error && (
          <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 flex items-center gap-3 animate-in fade-in">
             <AlertTriangle />
             <span className="font-bold">{state.error}</span>
          </div>
        )}

        {state?.success && (
          <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-xl text-green-400 flex items-center gap-3 animate-in fade-in">
             <CheckCircle2 />
             <span className="font-bold">Evaluation submitted successfully!</span>
          </div>
        )}

        <SubmitButton />
      </form>
    </div>
  );
}

export default RoleplayEvaluationClient;
