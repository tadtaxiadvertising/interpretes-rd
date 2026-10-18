import React from 'react';
import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import prisma from '@/lib/prisma';
import { getAdminReviewUrl } from '@/lib/roleplay';
import { resolveResponseAudioUrl } from '@/lib/roleplay-review';
import { RoleplayEvaluationClient } from './RoleplayEvaluationClient';
import { formatDate } from '@/lib/utils';

export const metadata: Metadata = {
  title: 'Roleplay Evaluation',
  description: 'Evaluate roleplay session',
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function RoleplayEvaluationPage({ params }: PageProps) {
  const { id } = await params;

  const session = await prisma.roleplaySession.findUnique({
    where: { id },
    include: {
      interpreter: { select: { id: true, name: true, externalId: true, emailCorporativo: true } },
      recruitmentCandidate: { select: { id: true, name: true, email: true } },
      scenarios: {
        orderBy: { order: 'asc' },
        include: { responses: true },
      },
      qaScore: true,
    },
  });

  if (!session) {
    notFound();
  }

  // Re-sign stored audio paths so admin review does not depend on the
  // short-lived signed URL captured at submission time (ISSUE-021).
  const scenarios = await Promise.all(
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

  return (
    <div className="min-h-screen bg-slate-950 py-12 px-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">Roleplay Evaluation</h1>
            <p className="text-gray-400">Session: {session.id.slice(0, 12)}...</p>
          </div>
          <div className="flex items-center gap-4">
            <span className={`px-3 py-1 rounded-full text-xs font-bold ${
              session.status === 'EVALUATED' 
                ? 'bg-green-500/10 text-green-400' 
                : 'bg-yellow-500/10 text-yellow-400'
            }`}>
              {session.status}
            </span>
          </div>
        </div>

        {/* Participant Info */}
        <div className="glass p-6 rounded-2xl border border-white/5 mb-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-2">Participant</h3>
              <p className="text-lg font-bold text-white">
                {session.interpreter?.name || session.recruitmentCandidate?.name || 'Unknown'}
              </p>
              <p className="text-sm text-gray-400 mt-1">
                {session.interpreter?.emailCorporativo || session.recruitmentCandidate?.email || ''}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {session.interpreter ? 'Interpreter' : 'Candidate'}
              </p>
            </div>
            <div>
              <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-2">Status</h3>
              <p className="text-lg font-bold text-white">
                {session.status}
                {session.status === 'EVALUATED' && session.evaluatedAt && ` • ${formatDate(session.evaluatedAt)}`}
              </p>
              {session.submittedAt && (
                <p className="text-sm text-gray-400 mt-1">Submitted: {formatDate(session.submittedAt)}</p>
              )}
            </div>
            <div>
              <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-2">Scenarios</h3>
              <p className="text-lg font-bold text-white">
                {session.scenarios.length}
              </p>
              <p className="text-sm text-gray-400 mt-1">
                {session.scenarios.filter(s => s.responses.length > 0).length} completed
              </p>
            </div>
          </div>
        </div>

        {/* Scenarios Evaluation */}
        {scenarios.length > 0 && (
          <div className="space-y-6">
            {scenarios.map((scenario, index) => (
              <ScenarioEvaluationCard 
                key={scenario.id}
                scenario={scenario}
                scenarioIndex={index + 1}
                totalScenarios={scenarios.length}
                sessionId={session.id}
                isEvaluated={session.status === 'EVALUATED'}
                qaScore={session.qaScore}
              />
            ))}
          </div>
        )}

        {!scenarios.length && (
          <div className="glass p-12 rounded-3xl border border-white/5 text-center">
            <p className="text-gray-400">No scenarios configured for this session.</p>
          </div>
        )}
      </div>
    </div>
  );
}

interface ScenarioEvaluationCardProps {
  scenario: any;
  scenarioIndex: number;
  totalScenarios: number;
  sessionId: string;
  isEvaluated: boolean;
  qaScore: any;
}

function ScenarioEvaluationCard({ 
  scenario, 
  scenarioIndex, 
  totalScenarios,
  sessionId,
  isEvaluated,
  qaScore
}: ScenarioEvaluationCardProps) {
  const response = scenario.responses[0];
  const hasResponse = !!response;
  const hasSelfAssessment = !!response?.selfScore;

  return (
    <div className="glass p-6 rounded-2xl border border-white/5">
      {/* Scenario Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-blue-500/10 rounded-xl flex items-center justify-center">
            <span className="text-blue-400 font-bold text-lg">{scenarioIndex}</span>
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">{scenario.title || `Scenario ${scenarioIndex}`}</h3>
            <p className="text-sm text-gray-400">
              {scenario.durationLimitSec ? `Time limit: ${Math.floor(scenario.durationLimitSec / 60)}:${(scenario.durationLimitSec % 60).toString().padStart(2, '0')}` : 'No time limit'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {hasResponse && (
            <span className="px-3 py-1 rounded-full text-xs font-bold bg-green-500/10 text-green-400">
              Response Recorded
            </span>
          )}
          {hasSelfAssessment && (
            <span className="px-3 py-1 rounded-full text-xs font-bold bg-blue-500/10 text-blue-400">
              Self-Assessed
            </span>
          )}
          {isEvaluated && (
            <span className="px-3 py-1 rounded-full text-xs font-bold bg-purple-500/10 text-purple-400">
              Evaluated
            </span>
          )}
        </div>
      </div>

      {/* Audio Players */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {/* Base Audio */}
        <div className="glass p-4 rounded-xl border border-white/5 bg-slate-900/40">
          <h4 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
            <span className="w-5 h-5 bg-blue-500/10 rounded-lg flex items-center justify-center">
              <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
            </span>
            Base Audio
          </h4>
          <audio 
            src={scenario.baseAudioUrl} 
            controls 
            className="w-full"
          />
        </div>

        {/* Response Audio */}
        <div className="glass p-4 rounded-xl border border-white/5 bg-slate-900/40">
          <h4 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
            <span className="w-5 h-5 bg-green-500/10 rounded-lg flex items-center justify-center">
              <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
            </span>
            Interpreter Response
          </h4>
          {hasResponse ? (
            <audio src={response.reviewAudioUrl ?? undefined} controls className="w-full" />
          ) : (
            <div className="w-full h-20 flex items-center justify-center text-gray-500">
              No response recorded yet
            </div>
          )}
        </div>
      </div>

      {/* Self-Assessment */}
      {hasSelfAssessment && (
        <div className="glass p-4 rounded-xl border border-white/5 mb-6">
          <h4 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
            <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            Self-Assessment
          </h4>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {[
              { key: 'protocol', label: 'Protocol', weight: '20%' },
              { key: 'interpretation', label: 'Interpretation', weight: '40%' },
              { key: 'language', label: 'Language', weight: '20%' },
              { key: 'service', label: 'Service', weight: '10%' },
              { key: 'technical', label: 'Technical', weight: '10%' },
            ].map(({ key, label, weight }) => (
              <div key={key} className="text-center">
                <p className="text-xs text-gray-500 mb-1">{label} ({weight})</p>
                <p className="text-2xl font-bold text-white">
                  {response.selfScore?.[key] ?? '—'}
                </p>
              </div>
            ))}
          </div>
          {response.selfScore?.criticalError && (
            <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
              <p className="text-red-400 font-bold">⚠ Critical Error Flagged</p>
            </div>
          )}
          {response.selfScore?.selfNotes && (
            <div className="mt-4">
              <p className="text-xs text-gray-500 mb-1">Notes:</p>
              <p className="text-sm text-gray-300">{response.selfScore.selfNotes}</p>
            </div>
          )}
        </div>
      )}

      {/* QA Evaluation Form */}
      <div className="border-t border-white/5 pt-6">
        <h4 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4">
          QA Evaluation
        </h4>
        <RoleplayEvaluationClient 
          sessionId={scenario.sessionId || ''}
          scenarioId={scenario.id}
          isEvaluated={isEvaluated}
          existingScore={qaScore}
        />
      </div>
    </div>
  );
}