'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Loader2, AlertCircle, ChevronLeft, ChevronRight, X, Save, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { submitRoleplayResponse, confirmRoleplayResponse, saveSelfAssessment } from '@/app/actions/roleplay';
import { RoleplayIntro } from '@/components/roleplay/RoleplayIntro';
import { RoleplayScenario } from '@/components/roleplay/RoleplayScenario';
import { Recorder } from '@/components/roleplay/Recorder';
import { SelfAssessment } from '@/components/roleplay/SelfAssessment';
import { RoleplayProgress } from '@/components/roleplay/RoleplayProgress';
import { RoleplayCompletion } from '@/components/roleplay/RoleplayCompletion';

type PageState = 'loading' | 'intro' | 'scenario' | 'recording' | 'review' | 'self-assessment' | 'completion' | 'error';

interface Scenario {
  id: string;
  order: number;
  title: string;
  baseAudioUrl: string;
  scriptPrompt?: string;
  durationLimitSec?: number;
  expectedKeys?: string[];
}

interface SessionData {
  id: string;
  status: string;
  baseAudioUrl: string;
  currentScenarioIndex: number;
  scenarios: Scenario[];
}

interface ResolvedIdentity {
  userId: string;
  profileId: string | null;
  interpreterId: number | null;
  candidateId: number | null;
  email: string | null;
  role: string;
  provider: 'supabase' | 'authjs';
  onboardingStatus: string;
  onboardingStep: string | null;
  onboardingVersion: number;
  onboardingCompletedAt: string | null;
  roleplayState: string;
  roleplaySessionId: string | null;
  eligibility: {
    canAccessDashboard: boolean;
    canStartRoleplay: boolean;
    needsOnboarding: boolean;
    needsRoleplay: boolean;
  };
}

interface RoleplayClientProps {
  sessionId: string;
  initialIdentity: ResolvedIdentity | null;
}

export function RoleplayClient({ sessionId, initialIdentity }: RoleplayClientProps) {
  const router = useRouter();

  const [pageState, setPageState] = useState<PageState>('loading');
  const [session, setSession] = useState<SessionData | null>(null);
  const [currentScenarioIndex, setCurrentScenarioIndex] = useState(0);
  const [baseAudioVolume, setBaseAudioVolume] = useState(1);
  const [isBasePlaying, setIsBasePlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [completedScenarios, setCompletedScenarios] = useState<number[]>([]);
  const [scenarioResponses, setScenarioResponses] = useState<Record<string, {
    audioUrl: string;
    duration: number;
    scores: Record<string, number>;
    criticalError: boolean;
    notes: string;
  }>>({});

  const stepLabels = ['Intro', 'Escuchar', 'Grabar', 'Autoeval', 'Enviar'];
  const completedScenarioCount = completedScenarios.length;

  // Fetch session data on mount
  useEffect(() => {
    async function fetchSession() {
      try {
        const res = await fetch(`/api/roleplay/session/${sessionId}`);
        const data = await res.json();
        if (data.success && data.data) {
          setSession(data.data);
          setCurrentScenarioIndex(data.data.currentScenarioIndex || 0);

          // Mark completed scenarios based on currentScenarioIndex
          const completed = Array.from({ length: data.data.currentScenarioIndex }, (_, i) => i);
          setCompletedScenarios(completed);

          const terminalStates = ['SUBMITTED', 'UNDER_REVIEW', 'EVALUATED', 'PASSED', 'FAILED'];
          setPageState(terminalStates.includes(data.data.status) ? 'completion' : 'intro');
        } else {
          setError(data.error || 'Failed to load session');
          setPageState('error');
        }
      } catch {
        setError('Failed to load session');
        setPageState('error');
      }
    }
    fetchSession();
  }, [sessionId]);

  const handlePlayBase = useCallback(() => {
    setIsBasePlaying(!isBasePlaying);
  }, [isBasePlaying]);

  const handleVolumeChange = useCallback((vol: number) => {
    setBaseAudioVolume(vol);
  }, []);

  const handleStartRoleplay = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/roleplay/session/${sessionId}/start`, { method: 'POST' });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed to start roleplay');
      setPageState('scenario');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start roleplay');
    } finally {
      setIsLoading(false);
    }
  }, [sessionId]);

  const handleNextScenario = useCallback(() => {
    const nextIndex = currentScenarioIndex + 1;
    if (nextIndex < (session?.scenarios.length || 0)) {
      setCurrentScenarioIndex(nextIndex);
      setPageState('recording');
    } else {
      setPageState('completion');
    }
  }, [currentScenarioIndex, session]);

  const handleScenarioAudioSave = useCallback(async (audioUrl: string, duration: number, blob: Blob) => {
    if (!session) return;
    
    const scenario = session.scenarios[currentScenarioIndex];
    if (!scenario) return;

    setIsLoading(true);
    try {
      const formData = new FormData();
      formData.append('audio', blob);
      formData.append('sessionId', sessionId);
      formData.append('scenarioId', scenario.id);

      const convertRes = await fetch('/api/roleplay/convert-audio', {
        method: 'POST',
        body: formData,
      });

      const convertResult = await convertRes.json();
      
      if (!convertResult.success) throw new Error(convertResult.error || 'Conversion failed');

      const recordedUrl = convertResult.data.sourceUrl || convertResult.data.mp3Url;

      const confirmResult = await confirmRoleplayResponse({
        sessionId,
        scenarioId: scenario.id,
        recordedAudioUrl: recordedUrl,
        sourceAudioPath: convertResult.data.sourcePath || undefined,
        durationSec: Math.max(0, Math.round(duration)),
      });

      if (!confirmResult.success) throw new Error(confirmResult.error);

      setScenarioResponses(prev => ({
        ...prev,
        [scenario.id]: {
          ...prev[scenario.id],
          audioUrl: recordedUrl,
          duration,
          scores: prev[scenario.id]?.scores ?? {},
          criticalError: prev[scenario.id]?.criticalError ?? false,
          notes: prev[scenario.id]?.notes ?? '',
        }
      }));
      setCompletedScenarios(prev => [...prev, currentScenarioIndex]);
      setPageState('self-assessment');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save response');
    } finally {
      setIsLoading(false);
    }
  }, [sessionId, currentScenarioIndex, session]);

  const handleSelfAssessmentComplete = useCallback(async (
    scores: Record<string, number>,
    criticalError: boolean,
    notes: string
  ) => {
    const scenario = session?.scenarios[currentScenarioIndex];
    if (!scenario) return;

    setIsLoading(true);
    try {
      const saveResult = await saveSelfAssessment({
        sessionId,
        scenarioId: scenario.id,
        scores,
        notes: notes || undefined,
      });
      if (!saveResult.success) throw new Error(saveResult.error);

      setScenarioResponses(prev => ({
        ...prev,
        [scenario.id]: {
          ...prev[scenario.id],
          audioUrl: prev[scenario.id]?.audioUrl ?? '',
          duration: prev[scenario.id]?.duration ?? 0,
          scores,
          criticalError,
          notes,
        }
      }));

      const nextIndex = currentScenarioIndex + 1;
      if (nextIndex < (session?.scenarios.length || 0)) {
        setCurrentScenarioIndex(nextIndex);
        setPageState('recording');
      } else {
        setPageState('completion');
      }
    } catch (err) {
      // Stay on the self-assessment step so the candidate can retry; the
      // audio response is already confirmed server-side.
      setError(err instanceof Error ? err.message : 'Failed to save self-assessment');
    } finally {
      setIsLoading(false);
    }
  }, [sessionId, currentScenarioIndex, session]);

  const handleFinalSubmit = useCallback(async () => {
    setIsLoading(true);
    try {
      setPageState('completion');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submission failed');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleBack = useCallback(() => {
    if (pageState === 'scenario') {
      setPageState('intro');
    } else if (pageState === 'recording' || pageState === 'self-assessment') {
      setPageState('scenario');
    } else if (pageState === 'completion') {
      const prevIndex = currentScenarioIndex - 1;
      if (prevIndex >= 0) {
        setCurrentScenarioIndex(prevIndex);
        setPageState('self-assessment');
      } else {
        setPageState('intro');
      }
    }
  }, [pageState, currentScenarioIndex]);

  const currentScenario = session?.scenarios[currentScenarioIndex];

  const totalSteps = 5;
  const currentStep = pageState === 'intro' ? 0 :
    pageState === 'scenario' ? 1 :
    pageState === 'recording' ? 2 :
    pageState === 'self-assessment' ? 3 : 4;

  if (pageState === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="glass p-12 rounded-3xl border border-white/5 text-center max-w-md">
          <div className="w-20 h-20 bg-blue-500/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <Loader2 size={40} className="animate-spin text-blue-400" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">Cargando Sesión</h2>
          <p className="text-gray-400">Preparando tu evaluación de roleplay...</p>
        </div>
      </div>
    );
  }

  if (pageState === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="glass p-12 rounded-3xl border border-white/5 text-center max-w-md">
          <div className="w-20 h-20 bg-red-500/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <AlertCircle size={40} className="text-red-400" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">Error al Cargar</h2>
          <p className="text-gray-400 mb-6">{error}</p>
          <button
            onClick={() => router.push('/dashboard/roleplays')}
            className="w-full py-4 rounded-xl font-bold bg-blue-600 hover:bg-blue-500 text-white transition-colors flex items-center justify-center gap-2"
          >
            <ChevronLeft size={18} />
            Volver al Dashboard
          </button>
        </div>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <div className="min-h-screen bg-slate-950">
      <div className="fixed top-4 left-4 right-4 z-40 flex justify-between items-center px-4 pointer-events-none">
        <div className="pointer-events-auto">
          <button
            onClick={() => router.push('/dashboard')}
            className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
          >
            <X size={20} />
          </button>
        </div>
        <RoleplayProgress
          currentStep={currentStep}
          totalSteps={totalSteps}
          currentScenario={currentScenarioIndex}
          totalScenarios={session.scenarios.length}
          stepLabels={stepLabels}
          completedScenarios={completedScenarios}
        />
      </div>

      <main className="pb-32 px-4">
        <div className="max-w-3xl mx-auto pt-20">
          {pageState === 'intro' && (
            <RoleplayIntro
              sessionId={session.id}
              baseAudioUrl={session.baseAudioUrl}
              scenarioCount={session.scenarios.length}
              onStart={handleStartRoleplay}
              onBack={handleBack}
              isLoading={isLoading}
            />
          )}

          {pageState === 'scenario' && currentScenario && (
            <RoleplayScenario
              scenario={currentScenario}
              currentIndex={currentScenarioIndex}
              totalScenarios={session.scenarios.length}
              onPlayBase={handlePlayBase}
              onNext={handleNextScenario}
              isBasePlaying={isBasePlaying}
              baseVolume={baseAudioVolume}
              onVolumeChange={handleVolumeChange}
              isLoading={isLoading}
            />
          )}

          {pageState === 'recording' && currentScenario && (
            <Recorder
              scenarioId={currentScenario.id}
              sessionId={session.id}
              durationLimitSec={currentScenario.durationLimitSec}
              onSave={handleScenarioAudioSave}
              onComplete={handleNextScenario}
              isLoading={isLoading}
            />
          )}

          {pageState === 'self-assessment' && currentScenario && (
            <SelfAssessment
              scenarioId={currentScenario.id}
              scenarioTitle={currentScenario.title}
              onComplete={handleSelfAssessmentComplete}
              isLoading={isLoading}
            />
          )}

          {pageState === 'completion' && (
            <RoleplayCompletion
              sessionId={session.id}
              scenariosCompleted={session.scenarios.length}
              totalDuration={Object.values(scenarioResponses).reduce((sum, r) => sum + r.duration, 0)}
              onSubmit={handleFinalSubmit}
              onBack={handleBack}
              isSubmitting={isLoading}
            />
          )}
        </div>
      </main>

      {error && (
        <div className="fixed bottom-4 left-4 right-4 z-50 px-4 pointer-events-none">
          <div className="pointer-events-auto max-w-md mx-auto animate-in slide-in-from-bottom-4">
            <div className="glass p-4 rounded-2xl border border-red-500/20 bg-red-500/10 flex items-center gap-3">
              <AlertCircle size={20} className="text-red-400 shrink-0" />
              <p className="text-red-400 font-medium flex-1">{error}</p>
              <button
                onClick={() => setError(null)}
                className="p-1 rounded-lg hover:bg-white/10 text-red-400 hover:text-white transition-colors"
              >
                <X size={18} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}