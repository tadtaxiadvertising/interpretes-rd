import React from 'react';
import { ArrowLeft, Volume2, VolumeX, Play, Pause, AlertTriangle, CheckCircle2, Loader2, Save, AlertCircle as AlertCircleIcon } from 'lucide-react';
import Link from 'next/link';
import { cn, formatDate } from '@/lib/utils';
import prisma from '@/lib/prisma';
import { getAdminReviewUrl } from '@/lib/roleplay';
import { resolveResponseAudioUrl } from '@/lib/roleplay-review';
import { RoleplayStatus } from '@prisma/client';

export const dynamic = 'force-dynamic';

const statusColors = {
  DRAFT: 'bg-slate-500/10 text-slate-400',
  INVITED: 'bg-yellow-500/10 text-yellow-400',
  STARTED: 'bg-blue-500/10 text-blue-400',
  IN_PROGRESS: 'bg-indigo-500/10 text-indigo-400',
  SUBMITTED: 'bg-yellow-500/10 text-yellow-400',
  UNDER_REVIEW: 'bg-blue-500/10 text-blue-400',
  EVALUATED: 'bg-green-500/10 text-green-400',
  PASSED: 'bg-emerald-500/10 text-emerald-400',
  FAILED: 'bg-red-500/10 text-red-400',
  EXPIRED: 'bg-slate-500/10 text-slate-400',
  CANCELLED: 'bg-slate-500/10 text-slate-400',
} as const;

interface EvaluatePageProps {
  params: Promise<{ id: string }>;
}

async function getSessionData(sessionId: string) {
  const session = await prisma.roleplaySession.findUnique({
    where: { id: sessionId },
    include: {
      interpreter: { select: { id: true, name: true, emailCorporativo: true, externalId: true } },
      recruitmentCandidate: { select: { id: true, name: true, email: true } },
      access: true,
      qaScore: true,
      scenarios: {
        include: {
          responses: {
            select: {
              id: true,
              sourceAudioUrl: true,
              sourceAudioPath: true,
              processedAudioUrl: true,
              processedAudioPath: true,
              audioStatus: true,
              processingError: true,
              durationSec: true,
              selfScore: true,
              selfNotes: true,
              submittedAt: true,
              createdAt: true,
            },
          },
        },
        orderBy: { order: 'asc' },
      },
    },
  });

  // Fetch evaluator separately if evaluatorId exists
  let evaluator = null;
  if (session?.evaluatorId) {
    evaluator = await prisma.rbacUser.findUnique({
      where: { id: session.evaluatorId },
      select: { id: true, name: true, email: true },
    });
  }

  // Re-sign each stored response audio path so admin review playback does not
  // depend on the short-lived signed URL captured at submission time.
  if (session) {
    session.scenarios = await Promise.all(
      session.scenarios.map(async (scenario) => ({
        ...scenario,
        responses: await Promise.all(
          scenario.responses.map(async (response) => ({
            ...response,
            reviewAudioUrl: await resolveResponseAudioUrl(response, getAdminReviewUrl),
          }))
        ),
      }))
    );
  }

  return { ...session, evaluator };
}

async function getEvaluators() {
  return prisma.rbacUser.findMany({
    where: { role: { in: ['ADMIN', 'HOLDER'] } },
    select: { id: true, name: true, email: true },
    orderBy: { name: 'asc' },
  });
}

export default async function EvaluatePage({ params }: EvaluatePageProps) {
  const { id: sessionId } = await params;
  const session = await getSessionData(sessionId);
  const evaluators = await getEvaluators();

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="glass p-12 rounded-3xl border border-white/5 text-center max-w-md">
          <h2 className="text-2xl font-bold text-white mb-2">Sesión no encontrada</h2>
          <Link href="/admin/roleplays/queue" className="text-blue-400 hover:underline">
            Volver a la cola
          </Link>
        </div>
      </div>
    );
  }

  const participant = session.interpreter || session.recruitmentCandidate;
  const isCandidate = !!session.recruitmentCandidate;
  const participantType = isCandidate ? 'candidate' : 'interpreter';
  const hasEvaluation = !!session.qaScore;
  const sessionStatus = session.status || 'UNKNOWN';
  const canEvaluate = ['SUBMITTED', 'UNDER_REVIEW'].includes(sessionStatus);
  const isCurrentEvaluator = session.evaluatorId; // Would check against current user in real app

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link href="/admin/roleplays/queue" className="p-2 hover:bg-white/10 rounded-xl text-gray-400 hover:text-white transition-colors">
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h2 className="text-3xl font-bold text-white">Evaluar Roleplay</h2>
            <p className="text-gray-400">Sesión: <code className="font-mono text-xs bg-white/5 px-2 py-1 rounded">{sessionId.slice(0, 12)}...</code></p>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          {canEvaluate && !hasEvaluation && !isCurrentEvaluator && (
            <button className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl font-bold flex items-center gap-2 transition-colors">
              Reclamar Evaluación
            </button>
          )}
          <Link
            href="/admin/roleplays/queue"
            className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white rounded-xl font-medium transition-colors border border-white/10"
          >
            Volver a la Cola
          </Link>
        </div>
      </header>

      {/* Participant Info */}
      <div className="glass rounded-3xl p-6 border border-white/5">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="md:col-span-2">
            <h3 className="text-lg font-bold text-white mb-3">Participante</h3>
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 bg-blue-500/10 rounded-2xl flex items-center justify-center text-blue-400">
                <span className="text-2xl font-bold">
                  {(isCandidate ? session.recruitmentCandidate?.name : session.interpreter?.name)?.charAt(0) || '?'}
                </span>
              </div>
              <div>
                <p className="text-xl font-bold text-white">{isCandidate ? session.recruitmentCandidate?.name : session.interpreter?.name || 'Desconocido'}</p>
                <p className="text-slate-400">{isCandidate ? session.recruitmentCandidate?.email : session.interpreter?.emailCorporativo}</p>
                {session.interpreter?.externalId && (
                  <p className="text-sm text-blue-400">ID Externo: {session.interpreter.externalId}</p>
                )}
                <span className={cn(
                  "inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold mt-2",
                  PARTICIPANT_COLORS[participantType]
                )}>
                  {participantType === 'interpreter' ? 'Intérprete Activo' : 'Candidato'}
                </span>
              </div>
            </div>
          </div>
          <div>
            <h3 className="text-lg font-bold text-white mb-3">Estado de la Sesión</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Estado</span>
                <span className={cn(
                  "px-3 py-1 rounded-full text-xs font-bold",
                  statusColors[session.status as keyof typeof statusColors] ?? statusColors.DRAFT
                )}>
                  {session.status}
                </span>
              </div>
              {session.submittedAt && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Enviado</span>
                  <span className="text-white">{formatDate(session.submittedAt)}</span>
                </div>
              )}
              {session.evaluator && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Evaluador</span>
                  <span className="text-white">{session.evaluator.name} ({session.evaluator.email})</span>
                </div>
              )}
              {session.reviewStartedAt && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Revisión iniciada</span>
                  <span className="text-white">{formatDate(session.reviewStartedAt)}</span>
                </div>
              )}
              {session.evaluatedAt && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Evaluado</span>
                  <span className="text-white">{formatDate(session.evaluatedAt)}</span>
                </div>
              )}
            </div>
          </div>
          <div>
            <h3 className="text-lg font-bold text-white mb-3">Progreso</h3>
            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-slate-400">Escenarios</span>
                  <span className="font-bold text-white">
                    {session.scenarios?.filter((s: any) => s.responses?.length > 0).length || 0} / {session.scenarios?.length || 0}
                  </span>
                </div>
                <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full"
                    style={{ width: `${((session.scenarios?.filter((s: any) => s.responses?.length > 0).length || 0) / (session.scenarios?.length || 1)) * 100}%` }}
                  />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-slate-400">Autoevaluaciones</span>
                  <span className="font-bold text-white">
                    {session.scenarios?.filter((s: any) => s.responses?.some((r: any) => r.selfScore)).length || 0} / {session.scenarios?.length || 0}
                  </span>
                </div>
                <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-amber-500 rounded-full"
                    style={{ width: `${((session.scenarios?.filter((s: any) => s.responses?.some((r: any) => r.selfScore)).length || 0) / (session.scenarios?.length || 1)) * 100}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Scenarios Evaluation */}
      <div className="space-y-6">
        {session.scenarios?.map((scenario: any, scenarioIndex: number) => (
          <ScenarioEvaluationCard
            key={scenario.id}
            scenario={scenario}
            scenarioIndex={scenarioIndex}
            totalScenarios={session.scenarios?.length || 0}
            hasEvaluation={hasEvaluation}
            qaScore={session.qaScore}
            canEvaluate={canEvaluate}
          />
        ))}
      </div>

      {/* Final Evaluation Form */}
      {canEvaluate && !hasEvaluation && (
        <FinalEvaluationForm
          sessionId={sessionId}
          session={session}
          evaluators={evaluators}
        />
      )}

      {/* Existing Evaluation Display */}
      {hasEvaluation && (
        <ExistingEvaluationDisplay qaScore={session.qaScore!} evaluator={session.evaluator} />
      )}
    </div>
  );
}

function ScenarioEvaluationCard({ 
  scenario, 
  scenarioIndex, 
  totalScenarios,
  hasEvaluation,
  qaScore,
  canEvaluate
}: {
  scenario: any;
  scenarioIndex: number;
  totalScenarios: number;
  hasEvaluation: boolean;
  qaScore: any;
  canEvaluate: boolean;
}) {
  const response = scenario.responses?.[0];
  const hasResponse = !!response;
  const hasSelfScore = !!response?.selfScore;

  const baseAudioUrl = response?.sourceAudioUrl || response?.processedAudioUrl || scenario.baseAudioUrl;
  const responseAudioUrl = response?.reviewAudioUrl || response?.sourceAudioUrl || response?.processedAudioUrl;

  return (
    <div className="glass rounded-3xl border border-white/5 overflow-hidden">
      <div className="p-6 border-b border-white/5 flex flex-wrap gap-4 items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-blue-500/10 rounded-xl flex items-center justify-center text-blue-400 font-bold text-lg">
            {scenarioIndex + 1}
          </div>
          <div>
            <h3 className="text-xl font-bold text-white">{scenario.title}</h3>
            <p className="text-slate-400 text-sm">Escenario {scenarioIndex + 1} de {totalScenarios}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 ml-auto">
          {hasResponse && (
            <span className="px-3 py-1 rounded-full text-xs font-bold bg-green-500/10 text-green-400">
              Respuesta grabada
            </span>
          )}
          {hasSelfScore && (
            <span className="px-3 py-1 rounded-full text-xs font-bold bg-amber-500/10 text-amber-400">
              Autoeval completada
            </span>
          )}
          {hasEvaluation && (
            <span className="px-3 py-1 rounded-full text-xs font-bold bg-blue-500/10 text-blue-400">
              Evaluado
            </span>
          )}
        </div>
      </div>

      <div className="p-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Base Audio */}
          <div className="space-y-4">
            <h4 className="text-lg font-bold text-white flex items-center gap-2">
              <span className="p-2 bg-blue-500/10 rounded-xl text-blue-400">
                <Volume2 size={18} />
              </span>
              Audio Base
            </h4>
            <div className="glass p-4 rounded-xl border border-white/5 bg-slate-900/40">
              <audio controls src={scenario.baseAudioUrl} className="w-full" />
              {scenario.scriptPrompt && (
                <div className="mt-4 p-3 bg-slate-900/50 rounded-xl border border-white/5">
                  <h5 className="text-sm font-bold text-white mb-2">Guión / Contexto</h5>
                  <p className="text-slate-300 text-sm whitespace-pre-wrap">{scenario.scriptPrompt}</p>
                </div>
              )}
              {scenario.expectedKeys && scenario.expectedKeys.length > 0 && (
                <div className="mt-4 p-3 bg-amber-500/10 rounded-xl border border-amber-500/20">
                  <h5 className="text-sm font-bold text-amber-400 mb-2 flex items-center gap-2">
                    <AlertTriangle size={16} />
                    Puntos Clave Esperados
                  </h5>
                  <ul className="text-sm text-slate-300 space-y-1">
                    {scenario.expectedKeys.map((key: string, i: number) => (
                      <li key={i} className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 bg-amber-500 rounded-full" />
                        {key}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>

          {/* Response Audio */}
          <div className="space-y-4">
            <h4 className="text-lg font-bold text-white flex items-center gap-2">
              <span className="p-2 bg-green-500/10 rounded-xl text-green-400">
                <Volume2 size={18} />
              </span>
              Respuesta del Participante
              {hasResponse && <span className="text-sm text-green-400">✓ Grabada</span>}
              {!hasResponse && <span className="text-sm text-red-400">✗ Sin respuesta</span>}
            </h4>
            <div className="glass p-4 rounded-xl border border-white/5 bg-slate-900/40">
              {hasResponse && responseAudioUrl ? (
                <>
                  <audio controls src={responseAudioUrl} className="w-full" />
                  {response?.durationSec && (
                    <p className="text-sm text-slate-400 mt-2">Duración: {Math.floor(response.durationSec / 60)}:{String(response.durationSec % 60).padStart(2, '0')}</p>
                  )}
                  {response?.audioStatus && (
                    <p className="text-xs text-slate-500 mt-1">Estado: {response.audioStatus}</p>
                  )}
                  {response?.processingError && (
                    <p className="text-xs text-red-400 mt-1">Error: {response.processingError}</p>
                  )}
                </>
              ) : (
                <div className="text-center py-8 text-slate-500">
                  <p>No hay respuesta grabada para este escenario</p>
                </div>
              )}
            </div>

            {/* Self Assessment */}
            {hasResponse && response?.selfScore && (
              <div className="mt-6 p-4 bg-amber-500/10 rounded-xl border border-amber-500/20">
                <h5 className="text-sm font-bold text-amber-400 mb-3 flex items-center gap-2">
                  <AlertTriangle size={16} />
                  Autoevaluación del Participante
                </h5>
                <div className="grid grid-cols-2 gap-3">
                  {Object.entries(response.selfScore as Record<string, number>).map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between p-2 bg-slate-900/50 rounded-lg">
                      <span className="text-sm text-slate-300 capitalize">{key}</span>
                      <div className="flex items-center gap-1">
                        {[1,2,3,4,5,6,7,8,9,10].map(v => (
                          <span key={v} className={cn(
                            "w-6 h-6 text-xs font-bold rounded",
                            v <= value ? "bg-amber-500 text-white" : "bg-slate-800 text-slate-500"
                          )}>
                            {v}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                {response?.criticalError && (
                  <div className="mt-3 p-3 bg-red-500/10 rounded-lg border border-red-500/20 flex items-center gap-2 text-red-400">
                    <AlertCircleIcon size={16} />
                    <span className="font-medium">Error Crítico Reportado: SÍ</span>
                  </div>
                )}
                {response?.selfNotes && (
                  <div className="mt-3 p-3 bg-slate-900/50 rounded-lg border border-white/5">
                    <p className="text-xs text-slate-400">Notas: </p>
                    <p className="text-sm text-slate-300">{response.selfNotes}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* QA Scores for this scenario (if evaluated) */}
        {hasEvaluation && (
          <div className="mt-6 p-4 bg-blue-500/10 rounded-xl border border-blue-500/20">
            <h5 className="text-sm font-bold text-blue-400 mb-3">Evaluación QA (Final)</h5>
            <div className="grid grid-cols-2 gap-3">
              {qaScore && [
                ['Protocolo', qaScore.protocolScore],
                ['Interpretación', qaScore.interpretationScore],
                ['Idioma', qaScore.languageScore],
                ['Servicio', qaScore.serviceScore],
                ['Técnico', qaScore.technicalScore],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between p-2 bg-slate-900/50 rounded-lg">
                  <span className="text-sm text-slate-300">{label}</span>
                  <div className="flex items-center gap-1">
                    {[1,2,3,4,5,6,7,8,9,10].map(v => (
                      <span key={v} className={cn(
                        "w-6 h-6 text-xs font-bold rounded",
                        v <= (Number(value) || 0) ? "bg-blue-500 text-white" : "bg-slate-800 text-slate-500"
                      )}>
                        {v}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {qaScore?.criticalError && (
              <div className="mt-3 p-3 bg-red-500/10 rounded-lg border border-red-500/20 flex items-center gap-2 text-red-400">
                <AlertCircleIcon size={16} />
                <span className="font-medium">Error Crítico: SÍ</span>
              </div>
            )}
            {qaScore?.comentarios && (
              <div className="mt-3 p-3 bg-slate-900/50 rounded-lg border border-white/5">
                <p className="text-xs text-slate-400">Comentarios: </p>
                <p className="text-sm text-slate-300">{qaScore.comentarios}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function FinalEvaluationForm({ 
  sessionId, 
  session, 
  evaluators 
}: { 
  sessionId: string; 
  session: any; 
  evaluators: any[];
}) {
  return (
    <div className="glass rounded-3xl border border-white/5 overflow-hidden">
      <div className="p-6 border-b border-white/5 bg-gradient-to-r from-emerald-500/10 to-blue-500/10">
        <h3 className="text-xl font-bold text-white flex items-center gap-3">
          <CheckCircle2 className="text-emerald-400" size={24} />
          Evaluación Final QA
        </h3>
        <p className="text-slate-400 mt-1">Completa la evaluación para todos los escenarios</p>
      </div>

      <form className="p-6 space-y-8" onSubmit={(e) => e.preventDefault()}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="md:col-span-2">
            <h4 className="text-lg font-bold text-white mb-4">Puntuaciones (1-10)</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[
                { id: 'protocolScore', label: 'Protocolo', weight: '35%' },
                { id: 'interpretationScore', label: 'Interpretación', weight: '40%' },
                { id: 'languageScore', label: 'Idioma', weight: '15%' },
                { id: 'serviceScore', label: 'Servicio', weight: '5%' },
                { id: 'technicalScore', label: 'Técnico', weight: '5%' },
              ].map(({ id, label, weight }) => (
                <div key={id} className="p-4 bg-slate-800/50 rounded-xl border border-white/5">
                  <div className="flex items-center justify-between mb-3">
                    <label className="font-medium text-white">{label}</label>
                    <span className="text-xs text-slate-400">Peso: {weight}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {[1,2,3,4,5,6,7,8,9,10].map((v) => (
                      <button
                        key={v}
                        type="button"
                        name={id}
                        value={v}
                        className={cn(
                          "w-10 h-10 rounded-lg font-bold text-sm transition-all flex items-center justify-center",
                          "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white"
                        )}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                  <input type="hidden" name={id} value="" />
                </div>
              ))}
            </div>
          </div>

          <div className="md:col-span-2">
            <h4 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <AlertTriangle className="text-red-400" size={20} />
              Error Crítico
            </h4>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" name="criticalError" value="true" className="w-5 h-5 rounded border-white/20 text-red-500 focus:ring-red-500" />
                <span className="text-white">Marcar error crítico (anula el score final a 0)</span>
              </label>
            </div>
          </div>

          <div className="md:col-span-2">
            <h4 className="text-lg font-bold text-white mb-4">Comentarios</h4>
            <textarea
              name="comentarios"
              rows={4}
              className="w-full bg-slate-800/50 border border-white/5 rounded-xl p-4 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 resize-none"
              placeholder="Observaciones detalladas sobre la evaluación..."
            />
          </div>
        </div>

        <div className="pt-6 border-t border-white/5 flex flex-col sm:flex-row gap-4 justify-end">
          <button type="button" className="px-6 py-3 bg-white/5 hover:bg-white/10 text-white rounded-xl font-bold transition-colors border border-white/10">
            Guardar Borrador
          </button>
          <button type="submit" className="px-8 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold transition-colors flex items-center gap-2">
            <Save size={20} />
            Finalizar Evaluación
          </button>
        </div>
      </form>
    </div>
  );
}

function ExistingEvaluationDisplay({ qaScore, evaluator }: { qaScore: any; evaluator: any }) {
  const totalScore = qaScore.totalScore || 0;
  const isPassed = !qaScore.criticalError && totalScore >= 85;
  const isWarning = !qaScore.criticalError && totalScore >= 70 && totalScore < 85;

  return (
    <div className="glass rounded-3xl border border-white/5 overflow-hidden">
      <div className="p-6 border-b border-white/5 bg-gradient-to-r from-blue-500/10 to-purple-500/10">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h3 className="text-xl font-bold text-white flex items-center gap-3">
              <CheckCircle2 className={cn(
                qaScore.criticalError ? 'text-red-400' : 
                isPassed ? 'text-emerald-400' : 
                isWarning ? 'text-yellow-400' : 'text-red-400'
              )} size={24} />
              {qaScore.criticalError ? 'Evaluación: RECHAZADA (Error Crítico)' : 
               isPassed ? 'Evaluación: APROBADA' : 
               isWarning ? 'Evaluación: CON ADVERTENCIA' : 'Evaluación: RECHAZADA'}
            </h3>
            <p className="text-slate-400 mt-1">Score Final: <span className="font-bold text-white">{totalScore.toFixed(1)}%</span></p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-xs text-slate-500">Evaluador</p>
              <p className="font-medium text-white">{evaluator?.name || 'Sistema'}</p>
            </div>
            <div className="w-20 h-20 bg-slate-800/50 rounded-2xl flex items-center justify-center text-blue-400">
              <span className="text-3xl font-bold">{evaluator?.name?.charAt(0) || '?'}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <ScoreCard label="Protocolo" value={qaScore.protocolScore} weight="35%" />
          <ScoreCard label="Interpretación" value={qaScore.interpretationScore} weight="40%" />
          <ScoreCard label="Idioma" value={qaScore.languageScore} weight="15%" />
          <ScoreCard label="Servicio" value={qaScore.serviceScore} weight="5%" />
          <ScoreCard label="Técnico" value={qaScore.technicalScore} weight="5%" />
        </div>

        {qaScore.criticalError && (
          <div className="mb-6 p-4 bg-red-500/10 rounded-xl border border-red-500/20 flex items-center gap-3">
            <AlertCircleIcon className="text-red-400" size={24} />
            <div>
              <p className="font-bold text-red-400">Error Crítico Detectado</p>
              <p className="text-sm text-slate-400">El score final se establece en 0% independientemente de las puntuaciones parciales.</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h4 className="text-lg font-bold text-white mb-3">Comentarios</h4>
            <div className="p-4 bg-slate-900/50 rounded-xl border border-white/5">
              {qaScore.comentarios || <p className="text-slate-500">Sin comentarios</p>}
            </div>
          </div>
          <div>
            <h4 className="text-lg font-bold text-white mb-3">Acción Requerida</h4>
            <div className="p-4 bg-slate-900/50 rounded-xl border border-white/5">
              {qaScore.accionRequerida || <p className="text-slate-500">Sin acción especificada</p>}
            </div>
          </div>
        </div>

        <div className="pt-6 border-t border-white/5 flex flex-wrap gap-3 justify-end">
          <Link href="/admin/roleplays/queue" className="px-6 py-3 bg-white/5 hover:bg-white/10 text-white rounded-xl font-bold transition-colors border border-white/10">
            Volver a la Cola
          </Link>
        </div>
      </div>
    </div>
  );
}

function ScoreCard({ label, value, weight }: { label: string; value: number | null; weight: string }) {
  const numValue = Number(value || 0);
  return (
    <div className="p-4 bg-slate-800/50 rounded-xl border border-white/5">
      <div className="flex items-center justify-between mb-2">
        <span className="font-medium text-white">{label}</span>
        <span className="text-xs text-slate-400">Peso: {weight}</span>
      </div>
      <div className="flex items-center gap-1">
        {[1,2,3,4,5,6,7,8,9,10].map(v => (
          <span key={v} className={cn(
            "w-8 h-8 text-xs font-bold rounded flex items-center justify-center",
            v <= numValue ? "bg-blue-500 text-white" : "bg-slate-800 text-slate-500"
          )}>
            {v}
          </span>
        ))}
      </div>
    </div>
  );
}

const PARTICIPANT_COLORS: Record<string, string> = {
  interpreter: 'bg-blue-500/10 text-blue-400',
  candidate: 'bg-purple-500/10 text-purple-400',
};