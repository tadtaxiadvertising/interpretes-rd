'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, AlertCircle, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { confirmRoleplayResponse, createRoleplayResponseUpload, saveSelfAssessment, submitRoleplaySession } from '@/app/actions/roleplay';
import { createClient as createSupabaseBrowserClient } from '@/lib/supabase/client';
import { RoleplayIntro } from '@/components/roleplay/RoleplayIntro';
import { RoleplayScenario } from '@/components/roleplay/RoleplayScenario';
import { Recorder } from '@/components/roleplay/Recorder';
import { SelfAssessment } from '@/components/roleplay/SelfAssessment';
import { RoleplayProgress } from '@/components/roleplay/RoleplayProgress';
import { RoleplayCompletion } from '@/components/roleplay/RoleplayCompletion';
import { hasCompleteRoleplaySelfAssessment } from '@/lib/roleplay/self-assessment';

type PageState = 'loading' | 'intro' | 'scenario' | 'recording' | 'review' | 'self-assessment' | 'completion' | 'error';

interface Scenario {
  id: string;
  order: number;
  title: string;
  baseAudioUrl: string;
  scriptPrompt?: string;
  durationLimitSec?: number;
  responses?: Array<{
    sourceAudioUrl: string | null;
    durationSec: number | null;
    selfScore: Record<string, number | boolean> | null;
    selfNotes: string | null;
  }>;
}

interface SessionData {
  id: string;
  status: string;
  baseAudioUrl: string;
  currentScenarioIndex: number;
  canCompleteSelfAssessment?: boolean;
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

  // Fetch session data on mount
  useEffect(() => {
    async function fetchSession() {
      try {
        const res = await fetch(`/api/roleplay/session/${sessionId}`);
        const data = await res.json();
        if (data.success && data.data) {
          setSession(data.data);
          const currentIndex = data.data.currentScenarioIndex || 0;
          setCurrentScenarioIndex(currentIndex);

          const completed = data.data.scenarios
            .map((scenario: Scenario, index: number) =>
              hasCompleteRoleplaySelfAssessment(scenario.responses?.[0]?.selfScore) ? index : -1
            )
            .filter((index: number) => index >= 0);
          setCompletedScenarios(completed);

          const restoredResponses: Record<string, { audioUrl: string; duration: number; scores: Record<string, number>; criticalError: boolean; notes: string }> = {};
          for (const scenario of data.data.scenarios as Scenario[]) {
            const response = scenario.responses?.[0];
            if (response) {
              const score = response.selfScore ?? {};
              restoredResponses[scenario.id] = {
                audioUrl: response.sourceAudioUrl ?? '',
                duration: response.durationSec ?? 0,
                scores: Object.fromEntries(Object.entries(score).filter(([key]) => key !== 'criticalError')) as Record<string, number>,
                criticalError: score.criticalError === true,
                notes: response.selfNotes ?? '',
              };
            }
          }
          setScenarioResponses(restoredResponses);

          const terminalStates = ['SUBMITTED', 'UNDER_REVIEW', 'EVALUATED', 'PASSED', 'FAILED'];
          const missingAssessmentIndex = data.data.scenarios.findIndex((scenario: Scenario) =>
            Boolean(scenario.responses?.[0]?.sourceAudioUrl) &&
            !hasCompleteRoleplaySelfAssessment(scenario.responses?.[0]?.selfScore)
          );
          if (data.data.canCompleteSelfAssessment && missingAssessmentIndex >= 0) {
            // Recover attempts submitted by the previous client before its
            // auto-advance bug could save the candidate's self-assessment.
            setCurrentScenarioIndex(missingAssessmentIndex);
            setPageState('self-assessment');
          } else if (terminalStates.includes(data.data.status)) {
            setPageState('completion');
          } else if (currentIndex >= data.data.scenarios.length) {
            setPageState('completion');
          } else {
            const currentResponse = data.data.scenarios[currentIndex]?.responses?.[0];
            if (currentResponse?.sourceAudioUrl && !currentResponse.selfScore) {
              setPageState('self-assessment');
            } else if (['STARTED', 'IN_PROGRESS'].includes(data.data.status)) {
              setPageState('scenario');
            } else {
              setPageState('intro');
            }
          }
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

  const handleStartRecording = useCallback(() => {
    // Listening/review and recording are separate required stages for every scenario.
    setPageState('recording');
  }, []);

  const handleScenarioAudioSave = useCallback(async (_audioUrl: string, duration: number, blob: Blob) => {
    if (!session) return;

    const scenario = session.scenarios[currentScenarioIndex];
    if (!scenario) return;

    setIsLoading(true);
    setError(null);
    try {
      // Ask the server to authorize this exact candidate/session/scenario and
      // issue a one-object upload token. Audio bytes never pass through Next.js.
      const uploadAuthorization = await createRoleplayResponseUpload({
        sessionId,
        scenarioId: scenario.id,
        mimeType: blob.type || 'audio/webm',
        size: blob.size,
      });
      if (!uploadAuthorization.success || !uploadAuthorization.data) {
        throw new Error(uploadAuthorization.error || 'No se pudo autorizar la grabación');
      }
      const uploadData = uploadAuthorization.data;

      const supabase = createSupabaseBrowserClient();
      if (!supabase) throw new Error('El servicio de almacenamiento no está configurado en este navegador');

      const { error: uploadError } = await supabase.storage
        .from('roleplay-audio')
        .uploadToSignedUrl(
          uploadData.path,
          uploadData.token,
          blob,
          { contentType: blob.type || 'audio/webm', upsert: false }
        );
      if (uploadError) throw new Error('No se pudo subir la grabación. Comprueba tu conexión e inténtalo de nuevo.');

      // Confirmation re-checks ownership, scenario order, and object existence
      // before the response becomes immutable and eligible for evaluation.
      const confirmResult = await confirmRoleplayResponse({
        sessionId,
        scenarioId: scenario.id,
        recordedAudioUrl: uploadData.path,
        sourceAudioPath: uploadData.path,
        durationSec: Math.max(0, Math.round(duration)),
      });
      if (!confirmResult.success || !confirmResult.data) {
        throw new Error(confirmResult.error || 'No se pudo confirmar la grabación');
      }

      const recordedUrl = confirmResult.data.recordedAudioUrl;
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
      setPageState('self-assessment');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save response');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [sessionId, currentScenarioIndex, session]);

  const handleSelfAssessmentComplete = useCallback(async (
    scores: {
      protocol: number;
      interpretation: number;
      language: number;
      service: number;
      technical: number;
    },
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
        criticalError,
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

      setCompletedScenarios(prev => prev.includes(currentScenarioIndex)
        ? prev
        : [...prev, currentScenarioIndex]);

      const nextIndex = currentScenarioIndex + 1;
      const nextLegacyAssessmentIndex = session?.canCompleteSelfAssessment
        ? session.scenarios.findIndex((item, index) =>
            index > currentScenarioIndex &&
            Boolean(item.responses?.[0]?.sourceAudioUrl) &&
            !hasCompleteRoleplaySelfAssessment(item.responses?.[0]?.selfScore)
          )
        : -1;

      if (nextLegacyAssessmentIndex >= 0) {
        // Older submitted attempts already contain all recordings; resume each
        // missing self-assessment without trying to record audio into a closed session.
        setCurrentScenarioIndex(nextLegacyAssessmentIndex);
        setPageState('self-assessment');
      } else if (session?.canCompleteSelfAssessment) {
        setCurrentScenarioIndex(session.scenarios.length);
        setPageState('completion');
      } else if (nextIndex < (session?.scenarios.length || 0)) {
        setCurrentScenarioIndex(nextIndex);
        setPageState('scenario');
      } else {
        setCurrentScenarioIndex(nextIndex);
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
    setError(null);
    try {
      const result = await submitRoleplaySession({ sessionId });
      if (!result.success) throw new Error(result.error || 'Submission failed');
      router.push(initialIdentity?.role === 'candidate' ? '/candidate' : '/dashboard/roleplays');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submission failed');
    } finally {
      setIsLoading(false);
    }
  }, [sessionId, router, initialIdentity]);
  const handleExit = useCallback(() => {
    router.push(initialIdentity?.role === 'candidate' ? '/candidate' : '/dashboard/roleplays');
  }, [router, initialIdentity]);

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
              onNext={handleStartRecording}
              baseVolume={baseAudioVolume}
              onVolumeChange={handleVolumeChange}
              isLoading={isLoading}
            />
          )}

          {pageState === 'recording' && currentScenario && (
            <Recorder
              durationLimitSec={currentScenario.durationLimitSec}
              onSave={handleScenarioAudioSave}
              isLoading={isLoading}
            />
          )}

          {pageState === 'self-assessment' && currentScenario && (
            <SelfAssessment
              // Each scenario owns an independent assessment state. Without
              // this key React reuses the previous scenario's selected scores.
              key={currentScenario.id}
              scenarioTitle={currentScenario.title}
              onComplete={handleSelfAssessmentComplete}
              initialScores={scenarioResponses[currentScenario.id]?.scores}
              initialCriticalError={scenarioResponses[currentScenario.id]?.criticalError}
              initialNotes={scenarioResponses[currentScenario.id]?.notes}
              isLoading={isLoading}
            />
          )}

          {pageState === 'completion' && (
            <RoleplayCompletion
              sessionId={session.id}
              scenariosCompleted={completedScenarios.length || session.scenarios.length}
              totalDuration={Object.values(scenarioResponses).reduce((sum, r) => sum + r.duration, 0)}
              onSubmit={handleFinalSubmit}
              onBack={['SUBMITTED', 'UNDER_REVIEW', 'EVALUATED', 'PASSED', 'FAILED'].includes(session.status) && !session.canCompleteSelfAssessment ? handleExit : handleBack}
              isSubmitting={isLoading}
              isComplete={['SUBMITTED', 'UNDER_REVIEW', 'EVALUATED', 'PASSED', 'FAILED'].includes(session.status) && !session.canCompleteSelfAssessment}
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