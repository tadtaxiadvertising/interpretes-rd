'use client';

import React, { useRef, useState, useEffect } from 'react';
import { Play, Pause, Volume2, VolumeX, Headphones, ChevronRight, Info, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';

interface RoleplayScenarioProps {
  scenario: {
    id: string;
    order: number;
    title: string;
    baseAudioUrl: string;
    scriptPrompt?: string;
    durationLimitSec?: number;
  };
  currentIndex: number;
  totalScenarios: number;
  onNext: () => void;
  baseVolume: number;
  onVolumeChange: (vol: number) => void;
  isLoading?: boolean;
}

export function RoleplayScenario({ 
  scenario, 
  currentIndex, 
  totalScenarios, 
  onNext,
  baseVolume,
  onVolumeChange,
  isLoading
}: RoleplayScenarioProps) {
  const [showPrompt, setShowPrompt] = useState(false);
  const [isBasePlaying, setIsBasePlaying] = useState(false);
  const [hasListened, setHasListened] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const repeatTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [repeatPending, setRepeatPending] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleLoadedMetadata = () => setDuration(audio.duration);
    const handleTimeUpdate = () => setCurrentTime(audio.currentTime);
    const handleEnded = () => {
      setCurrentTime(0);
      setIsBasePlaying(false);
      setHasListened(true);
    };

    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
    };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (repeatTimerRef.current) clearTimeout(repeatTimerRef.current);
    repeatTimerRef.current = null;
    setRepeatPending(false);
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    setCurrentTime(0);
    setIsBasePlaying(false);
    setHasListened(false);
    setAudioError(null);
  }, [scenario.id, scenario.baseAudioUrl]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = playbackRate;
  }, [playbackRate]);

  useEffect(() => () => {
    if (repeatTimerRef.current) clearTimeout(repeatTimerRef.current);
  }, []);

  const handleTogglePlayback = async () => {
    if (repeatTimerRef.current) clearTimeout(repeatTimerRef.current);
    repeatTimerRef.current = null;
    setRepeatPending(false);
    const audio = audioRef.current;
    if (!audio || !scenario.baseAudioUrl) {
      setAudioError('El audio base de este escenario no está disponible.');
      return;
    }
    setAudioError(null);
    if (audio.paused) {
      try {
        await audio.play();
      } catch {
        setIsBasePlaying(false);
        setAudioError('No se pudo reproducir el audio. Intenta nuevamente.');
      }
    } else {
      audio.pause();
    }
  };

  const handleRequestRepetition = () => {
    const audio = audioRef.current;
    if (!audio || !scenario.baseAudioUrl || !hasListened || repeatPending || isLoading) return;
    if (repeatTimerRef.current) clearTimeout(repeatTimerRef.current);
    audio.pause();
    setAudioError(null);
    setRepeatPending(true);
    repeatTimerRef.current = setTimeout(() => {
      repeatTimerRef.current = null;
      const currentAudio = audioRef.current;
      if (!currentAudio) {
        setRepeatPending(false);
        return;
      }
      currentAudio.currentTime = 0;
      void currentAudio.play().then(() => {
        setRepeatPending(false);
      }).catch(() => {
        setRepeatPending(false);
        setIsBasePlaying(false);
        setAudioError('No se pudo reproducir la repetición. Intenta nuevamente.');
      });
    }, 4500);
  };

  // Sync volume with parent control
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = baseVolume;
    }
  }, [baseVolume]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
    const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    // The full-listen gate must not be bypassed by dragging the timeline.
    // Rewinding/fast-forwarding becomes available after the first complete listen.
    if (!hasListened || isLoading) return;
    if (repeatTimerRef.current) clearTimeout(repeatTimerRef.current);
    repeatTimerRef.current = null;
    setRepeatPending(false);
    if (audioRef.current) {
      audioRef.current.currentTime = parseFloat(e.target.value);
    }
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-500/10 rounded-xl flex items-center justify-center text-blue-400">
            <span className="font-bold text-lg">{currentIndex + 1}</span>
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">{scenario.title}</h2>
            <p className="text-slate-400 text-sm">Escenario {currentIndex + 1} de {totalScenarios}</p>
          </div>
        </div>
        {scenario.durationLimitSec && (
          <div className="text-right">
            <p className="text-xs text-slate-500">Tiempo máximo respuesta</p>
            <p className="text-lg font-bold text-amber-400 font-mono">
              {Math.floor(scenario.durationLimitSec / 60)}:{String(scenario.durationLimitSec % 60).padStart(2, '0')}
            </p>
          </div>
        )}
      </div>

      <div className="glass p-6 rounded-2xl border border-white/5 bg-slate-900/40">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Headphones className="text-blue-400" />
            Audio Base
          </h3>
          <button
            onClick={() => setShowPrompt(!showPrompt)}
            className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
            title="Ver guión"
          >
            <Info size={18} />
          </button>
        </div>

        <audio
          ref={audioRef}
          src={scenario.baseAudioUrl}
          onPlay={() => setIsBasePlaying(true)}
          onPause={() => setIsBasePlaying(false)}
        />

        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <button
              onClick={handleTogglePlayback}
              disabled={isLoading || !scenario.baseAudioUrl}
              className={cn(
                "w-12 h-12 rounded-xl flex items-center justify-center transition-all",
                isBasePlaying ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"
              )}
            >
              {isBasePlaying ? <Pause size={24} /> : <Play size={24} />}
            </button>

            <div className="flex-1">
              <input
                type="range"
                aria-label="Posición del audio base"
                title={!hasListened ? 'Escucha el audio completo antes de mover la posición' : 'Mover la posición del audio'}
                disabled={!hasListened || isLoading}
                min={0}
                max={duration || 100}
                value={currentTime}
                onChange={handleSeek}
                className="w-full h-2 bg-slate-800 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-500"
                style={{ background: `linear-gradient(to right, #3b82f6 ${progress}%, #1e293b ${progress}%)` }}
              />
              <span className="text-sm font-mono text-slate-400 w-16 text-right">
                {formatTime(currentTime)} / {formatTime(duration || 0)}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 text-xs text-slate-400">
                Velocidad
                <select
                  aria-label="Velocidad de reproducción"
                  value={playbackRate}
                  onChange={(event) => setPlaybackRate(Number(event.target.value))}
                  className="rounded-lg border border-white/10 bg-slate-900 px-2 py-2 text-sm text-white"
                  disabled={isLoading}
                >
                  <option value={0.75}>0.75×</option>
                  <option value={0.85}>0.85×</option>
                  <option value={1}>1×</option>
                  <option value={1.15}>1.15×</option>
                  <option value={1.25}>1.25×</option>
                </select>
              </label>
              <button
                onClick={() => {
                  if (audioRef.current) {
                    audioRef.current.volume = baseVolume > 0 ? 0 : 1;
                    onVolumeChange(baseVolume > 0 ? 0 : 1);
                  }
                }}
                className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
              >
                {baseVolume > 0 ? <Volume2 size={20} /> : <VolumeX size={20} />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.1}
                value={baseVolume}
                onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
                className="w-24 h-2 bg-slate-800 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-500"
              />
            </div>
          </div>

          {hasListened && scenario.baseAudioUrl && (
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleRequestRepetition}
                disabled={isLoading || repeatPending}
                className="inline-flex items-center gap-2 rounded-lg border border-amber-400/30 bg-amber-400/5 px-3 py-2 text-sm font-medium text-amber-200 hover:bg-amber-400/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RotateCcw size={16} />
                {repeatPending ? 'Repetición en espera…' : 'Solicitar repetición (4,5 s)'}
              </button>
              {repeatPending && (
                <span role="status" aria-live="polite" className="text-xs text-amber-200">
                  La intervención se reproducirá nuevamente después de la pausa de 4,5 segundos.
                </span>
              )}
            </div>
          )}

          {audioError && (
            <p role="alert" className="mt-3 text-sm text-red-400">{audioError}</p>
          )}

          {showPrompt && scenario.scriptPrompt && (
            <div className="mt-4 p-4 bg-slate-900/50 rounded-xl border border-white/5 animate-in fade-in">
              <h4 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
                <Info className="text-blue-400" size={16} />
                Guión / Contexto
              </h4>
              <p className="text-slate-300 text-sm whitespace-pre-wrap">{scenario.scriptPrompt}</p>
            </div>
          )}

          <div className="flex gap-2 mt-4 pt-4 border-t border-white/5">
            <button
              onClick={() => setShowPrompt(!showPrompt)}
              className={cn(
                "px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2",
                showPrompt 
                  ? "bg-blue-600 text-white" 
                  : "bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white"
              )}
            >
              {showPrompt ? 'Ocultar guión' : 'Ver guión'}
            </button>
          </div>
        </div>
      </div>

      {!scenario.baseAudioUrl && (
        <p role="alert" className="text-sm text-amber-400">
          Este escenario no tiene un audio base asignado. Solicita a reclutamiento que complete la asignación antes de continuar.
        </p>
      )}

      <button
        onClick={() => {
          // Stop any scheduled replay before the parent starts the recording
          // workflow, even when navigation awaits an asynchronous response.
          if (repeatTimerRef.current) clearTimeout(repeatTimerRef.current);
          repeatTimerRef.current = null;
          setRepeatPending(false);
          onNext();
        }}
        disabled={isLoading || !scenario.baseAudioUrl || !hasListened}
        className={cn(
          "w-full py-4 rounded-xl font-bold transition-all flex items-center justify-center gap-2",
          isLoading || !scenario.baseAudioUrl || !hasListened
            ? "bg-slate-800 text-slate-500 cursor-not-allowed"
            : "bg-blue-600 text-white shadow-xl shadow-blue-600/30 hover:scale-[1.02] active:scale-95"
        )}
      >
        {isLoading ? (
          <span className="animate-pulse">Preparando...</span>
        ) : !scenario.baseAudioUrl ? (
          'Audio base no disponible'
        ) : !hasListened ? (
          'Escucha el audio completo para continuar'
        ) : (
          <>
            Grabar respuesta
            <ChevronRight size={20} />
          </>
        )}
      </button>
    </div>
  );
}