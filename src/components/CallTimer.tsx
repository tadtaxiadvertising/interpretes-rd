'use client';

import React, { useState, useEffect, useRef, useCallback, useTransition } from 'react';
import { Play, Square, DollarSign, Clock, Loader2 } from 'lucide-react';
import { startCall, endCall } from '@/app/actions/calls';
import type { TimerLocalState } from '@/lib/types';
import { cn } from '@/lib/utils';
import { QuickLogButton } from './QuickLogButton';

const LS_KEY = 'fios_active_call';

interface CallTimerProps {
  activeCall: {
    sessionId: number;
    startedAt: string;
    tariffSnapshot: number;
  } | null;
  currentRate: number;
}

function formatTime(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/**
 * CallTimerDashboard — Unified call control panel.
 *
 * Integrates the timer display with BOTH action buttons:
 * - "Iniciar Llamada" (Green) — starts a timed session
 * - "Registro Rápido" (Blue) — logs minutes manually
 *
 * The floating action button (FAB) has been ELIMINATED.
 * All call-related actions are co-located in this single component.
 */
export function CallTimer({ activeCall, currentRate }: CallTimerProps) {
  const [isActive, setIsActive] = useState(!!activeCall);
  const [elapsed, setElapsed] = useState(0);
  const [sessionId, setSessionId] = useState<number | null>(activeCall?.sessionId ?? null);
  const [tariff, setTariff] = useState(activeCall?.tariffSnapshot ?? currentRate);
  const [callResult, setCallResult] = useState<{ duration: number; cost: number } | null>(null);
  const [isPending, startTransition] = useTransition();
  const startedAtRef = useRef<string | null>(activeCall?.startedAt ?? null);
  const workerRef = useRef<Worker | null>(null);

  // Initialize Web Worker for background-safe timing
  useEffect(() => {
    workerRef.current = new Worker('/timer-worker.js');
    workerRef.current.onmessage = (e) => {
      if (e.data.type === 'tick') {
        setElapsed(e.data.elapsed);
      }
    };

    return () => {
      workerRef.current?.terminate();
    };
  }, []);

  // Calculate elapsed from server timestamp (resilient to reload)
  const calculateElapsed = useCallback((startedAt: string) => {
    return Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
  }, []);

  // Resume from active call (server-provided or localStorage)
  useEffect(() => {
    if (activeCall && activeCall.sessionId !== sessionId) {
      startedAtRef.current = activeCall.startedAt;
      setSessionId(activeCall.sessionId);
      setTariff(activeCall.tariffSnapshot);
      setIsActive(true);
      setElapsed(calculateElapsed(activeCall.startedAt));

      // Start the worker
      workerRef.current?.postMessage({ type: 'start', startedAt: activeCall.startedAt });

      // Sync to localStorage
      const state: TimerLocalState = {
        sessionId: activeCall.sessionId,
        startedAt: activeCall.startedAt,
        interpreterId: 0,
      };
      localStorage.setItem(LS_KEY, JSON.stringify(state));
    }
  }, [activeCall, calculateElapsed, sessionId]);

  function handleStart() {
    setCallResult(null);
    startTransition(async () => {
      const result = await startCall();
      if (result.success && result.data) {
        setSessionId(result.data.sessionId);
        startedAtRef.current = result.data.startedAt;
        setTariff(currentRate);
        setIsActive(true);
        setElapsed(0);

        // Start the Web Worker timer
        workerRef.current?.postMessage({ type: 'start', startedAt: result.data.startedAt });

        const state: TimerLocalState = {
          sessionId: result.data.sessionId,
          startedAt: result.data.startedAt,
          interpreterId: 0,
        };
        localStorage.setItem(LS_KEY, JSON.stringify(state));
      }
    });
  }

  function handleEnd() {
    if (!sessionId) return;
    startTransition(async () => {
      const result = await endCall(sessionId);
      if (result.success && result.data) {
        setIsActive(false);
        setCallResult({
          duration: result.data.durationSeconds,
          cost: result.data.callCost,
        });
        localStorage.removeItem(LS_KEY);

        // Stop the Web Worker
        workerRef.current?.postMessage({ type: 'stop' });
      }
    });
  }

  const estimatedCost = (elapsed / 60) * tariff;

  return (
    <div className="flex flex-col items-center">
      {/* Timer Display — Large circular dial */}
      <div className={cn(
        'relative w-64 h-64 rounded-full flex items-center justify-center mb-8 transition-all duration-500',
        isActive
          ? 'bg-gradient-to-br from-blue-600/20 to-purple-600/20 border-2 border-blue-500/30 shadow-[0_0_60px_rgba(59,130,246,0.15)]'
          : 'bg-[var(--theme-surface-muted)] border-2 border-[var(--border)]'
      )}>
        {isActive && (
          <div className="absolute inset-0 rounded-full border-2 border-blue-400/20 animate-ping" style={{ animationDuration: '3s' }} />
        )}
        <div className="text-center z-10">
          <p className="text-5xl font-mono font-bold text-[var(--foreground)] tracking-wider">
            {formatTime(elapsed)}
          </p>
          {isActive && (
            <div className="flex items-center justify-center gap-1 mt-3 text-[var(--theme-success)]">
              <DollarSign size={14} />
              <span className="text-sm font-semibold">RD${estimatedCost.toFixed(2)}</span>
              <span className="text-xs text-[var(--text-secondary)] ml-1">est.</span>
            </div>
          )}
        </div>
      </div>

      {/* Rate info follows the selected theme */}
      <div className="flex items-center gap-2 mb-6 text-[var(--foreground)] text-sm font-medium">
        <Clock size={14} className="text-[var(--theme-link)]" />
        <span>
          Tarifa: <span className="text-[var(--foreground)] font-bold">RD${(tariff * 60).toFixed(2)}/hr</span>
        </span>
      </div>

      {/* ── Control Buttons ──────────────────────────────────────── */}
      {/* "Iniciar Llamada" (Green) + "Registro Rápido" (Blue) side by side */}
      {/* When a call is active, only the "Finalizar" (Red) button shows */}
      <div className="flex gap-4 flex-wrap justify-center">
        {!isActive ? (
          <>
            <button
              onClick={handleStart}
              disabled={isPending}
              id="btn-start-call"
              className="flex items-center gap-2 px-8 py-4 theme-action-success font-bold rounded-2xl transition-all duration-300 disabled:opacity-50 shadow-lg shadow-green-600/20 hover:shadow-green-500/30 hover:-translate-y-0.5"
            >
              {isPending ? <Loader2 size={20} className="animate-spin" /> : <Play size={20} />}
              Iniciar Llamada
            </button>
            {/* QuickLogButton rendered INLINE — no more floating FAB */}
            <div className="relative z-[60]">
              <QuickLogButton />
            </div>
          </>
        ) : (
          <button
            onClick={handleEnd}
            disabled={isPending}
            id="btn-end-call"
            className="flex items-center gap-2 px-8 py-4 theme-action-danger font-bold rounded-2xl transition-all duration-300 disabled:opacity-50 shadow-lg shadow-red-600/20 hover:shadow-red-500/30 hover:-translate-y-0.5"
          >
            {isPending ? <Loader2 size={20} className="animate-spin" /> : <Square size={20} />}
            Finalizar Llamada
          </button>
        )}
      </div>

      {/* Call Result card — slides in from bottom after ending a call */}
      {callResult && (
        <div className="mt-8 glass rounded-2xl p-6 w-full max-w-sm border border-green-500/20 animate-in slide-in-from-bottom-4 duration-500">
          <h4 className="text-sm font-bold text-[var(--theme-success)] mb-3">Llamada Completada ✓</h4>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-[var(--text-secondary)]">Duración</p>
              <p className="text-lg font-bold text-[var(--foreground)]">{formatTime(callResult.duration)}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--text-secondary)]">Ganancia</p>
              <p className="text-lg font-bold text-[var(--theme-success)]">RD${callResult.cost.toFixed(2)}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
