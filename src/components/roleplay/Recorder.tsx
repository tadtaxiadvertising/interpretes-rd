'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Mic, MicOff, Play, Pause, Square, CheckCircle2, AlertCircle, Loader2, Trash2, RotateCcw, Volume2, VolumeX, Clock, Send } from 'lucide-react';
import { cn } from '@/lib/utils';

type RecordingState = 'ready' | 'recording' | 'review' | 'uploading' | 'complete';

interface RecorderProps {
  durationLimitSec?: number;
  onSave: (audioUrl: string, durationSec: number, blob: Blob) => Promise<void>;
  isLoading?: boolean;
}

export function Recorder({ 
  durationLimitSec = 300, 
  onSave, 
  isLoading 
}: RecorderProps) {
  const [state, setState] = useState<RecordingState>('ready');
  const [recordingBlob, setRecordingBlob] = useState<Blob | null>(null);
  const [recordingUrl, setRecordingUrl] = useState<string>('');
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [playbackVolume, setPlaybackVolume] = useState(1);
  const [playbackProgress, setPlaybackProgress] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const durationRef = useRef(0);
  const recordingUrlRef = useRef('');
  const streamRef = useRef<MediaStream | null>(null);
  const playbackIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
    const secs = (seconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  };

  const stopTimer = useCallback(() => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
  }, []);

  const handleStopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    recorder.stop();
    stopTimer();
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
  }, [stopTimer]);

  const startTimer = useCallback(() => {
    durationRef.current = 0;
    setDuration(0);
    timerIntervalRef.current = setInterval(() => {
      const next = ++durationRef.current;
      setDuration(next);
      if (durationLimitSec && next >= durationLimitSec) {
        handleStopRecording();
      }
    }, 1000);
  }, [durationLimitSec, handleStopRecording]);

  const handleStartRecording = async () => {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        } 
      });
      streamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') 
        ? 'audio/webm;codecs=opus' 
        : 'audio/webm';

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        setRecordingBlob(blob);
        const url = URL.createObjectURL(blob);
        if (recordingUrlRef.current) URL.revokeObjectURL(recordingUrlRef.current);
        recordingUrlRef.current = url;
        setRecordingUrl(url);
        setState('review');
      };

      recorder.start(100);
      startTimer();
      setState('recording');
    } catch (err) {
      setError('Acceso al micrófono denegado. Permite el uso del micrófono en tu navegador.');
      console.error(err);
    }
  };

  const handlePlayPausePreview = () => {
    if (!previewAudioRef.current || !recordingUrl) return;
    if (previewAudioRef.current.paused) {
      previewAudioRef.current.play();
    } else {
      previewAudioRef.current.pause();
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (previewAudioRef.current) {
      previewAudioRef.current.currentTime = parseFloat(e.target.value);
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const vol = parseFloat(e.target.value);
    setPlaybackVolume(vol);
    if (previewAudioRef.current) {
      previewAudioRef.current.volume = vol;
    }
  };

  useEffect(() => {
    const audio = previewAudioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => {
      setPlaybackProgress(audio.duration > 0 ? (audio.currentTime / audio.duration) * 100 : 0);
    };
    const handleEnded = () => {
      setPlaybackProgress(0);
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
    };
  }, []);

  const handleReRecord = () => {
    if (recordingUrlRef.current) URL.revokeObjectURL(recordingUrlRef.current);
    recordingUrlRef.current = '';
    setRecordingBlob(null);
    setRecordingUrl('');
    setDuration(0);
    setState('ready');
  };

  const handleSubmit = async () => {
    if (!recordingBlob) return;

    setState('uploading');
    setIsUploading(true);
    setError(null);

    try {
      await onSave(recordingUrl, duration, recordingBlob);
      setState('complete');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar la respuesta');
      setState('review');
    } finally {
      setIsUploading(false);
    }
  };

  useEffect(() => {
    // playbackIntervalRef es un useRef (puntero mutable, no reactivo). Se
    // captura en un const y la limpieza del efecto usa ese valor; stopTimer es
    // useCallback estable y el ref es un objeto inmutable que no requiere
    // reactividad, por lo que no se requiere la regla exhaustive-deps.
    const playbackInterval = playbackIntervalRef.current;
    return () => {
      stopTimer();
      if (playbackInterval) clearInterval(playbackInterval);
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        recorder.onstop = null;
        recorder.stop();
      }
      streamRef.current?.getTracks().forEach(track => track.stop());
      if (recordingUrlRef.current) URL.revokeObjectURL(recordingUrlRef.current);
      recordingUrlRef.current = '';
    };
  }, [stopTimer, playbackIntervalRef]);

  // State 1: Ready to record
  if (state === 'ready') {
    return (
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="glass p-8 rounded-3xl border border-white/5 text-center">
          <div className="w-24 h-24 bg-red-500/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <Mic size={48} className="text-red-500" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">Grabar tu respuesta</h2>
          <p className="text-slate-400 mb-6 max-w-md mx-auto">
            Presiona el botón para comenzar. Tienes hasta {Math.floor(durationLimitSec / 60)} minutos.
          </p>

          <button
            onClick={handleStartRecording}
            disabled={isLoading}
            className={cn(
              "w-full max-w-xs mx-auto py-4 rounded-xl font-bold text-lg transition-all flex items-center justify-center gap-3",
              isLoading
                ? "bg-slate-800 text-slate-500 cursor-not-allowed"
                : "bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-600/20"
            )}
          >
            <Mic size={24} />
            <span>Comenzar Grabación</span>
          </button>

          {durationLimitSec && (
            <p className="text-xs text-slate-500 mt-4">
              Tiempo máximo: {formatTime(durationLimitSec)}
            </p>
          )}

          {error && (
            <div className="mt-4 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 flex items-center gap-3">
              <AlertCircle size={20} className="shrink-0" />
              <p className="font-medium">{error}</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // State 2: Recording
  if (state === 'recording') {
    const progress = durationLimitSec ? (duration / durationLimitSec) * 100 : 0;
    
    return (
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="glass p-8 rounded-3xl border border-white/5 text-center">
          <div className="w-28 h-28 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-6 animate-pulse">
            <div className="w-10 h-10 bg-red-500 rounded-full" />
          </div>
          <div className="text-7xl font-mono font-bold text-white mb-2" style={{ fontFamily: 'monospace' }}>
            {formatTime(duration)}
          </div>
          {durationLimitSec && (
            <div className="w-full max-w-md mx-auto h-2 bg-slate-800 rounded-full overflow-hidden mb-4">
              <div
                className="h-full bg-red-500 rounded-full transition-all duration-1000"
                style={{ width: `${Math.min(progress, 100)}%` }}
              />
            </div>
          )}
          <p className="text-slate-400 mb-8">Grabando en curso...</p>
          
          <button
            onClick={handleStopRecording}
            className="w-full max-w-xs mx-auto py-4 rounded-xl font-bold text-lg bg-slate-800 hover:bg-slate-700 text-white transition-colors flex items-center justify-center gap-3 mx-auto"
          >
            <Square size={24} />
            Detener Grabación
          </button>

          {error && (
            <div className="mt-4 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 flex items-center gap-3">
              <AlertCircle size={20} className="shrink-0" />
              <p className="font-medium">{error}</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // State 3: Review
  if (state === 'review') {
    return (
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="glass p-8 rounded-3xl border border-white/5">
          <div className="text-center mb-8">
            <div className="w-20 h-20 bg-green-500/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 size={40} className="text-green-400" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Revisar tu respuesta</h2>
            <p className="text-slate-400">Duración: {formatTime(duration)}</p>
          </div>

          <div className="glass p-6 rounded-2xl border border-white/5 bg-slate-900/40">
            <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <Mic className="text-green-400" />
              Tu Grabación
            </h3>
            <audio
              ref={previewAudioRef}
              src={recordingUrl}
              controls
              className="w-full"
            />
            <div className="flex items-center gap-3 mt-4">
              <button
                onClick={() => {
                  if (previewAudioRef.current) {
                    previewAudioRef.current.volume = playbackVolume > 0 ? 0 : 1;
                    setPlaybackVolume(playbackVolume > 0 ? 0 : 1);
                  }
                }}
                className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
              >
                {playbackVolume > 0 ? <Volume2 size={20} /> : <VolumeX size={20} />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.1}
                value={playbackVolume}
                onChange={handleVolumeChange}
                className="w-24 h-2 bg-slate-800 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-green-500"
              />
              <span className="text-sm text-slate-400 w-10">{Math.round(playbackVolume * 100)}%</span>
            </div>
          </div>

          <div className="flex gap-4">
            <button
              onClick={handleReRecord}
              className="flex-1 py-4 rounded-xl font-bold border border-white/10 text-gray-300 hover:bg-white/5 transition-colors flex items-center justify-center gap-2"
            >
              <RotateCcw size={20} />
              Volver a Grabar
            </button>
            <button
              onClick={handleSubmit}
              disabled={isUploading || isLoading}
              className={cn(
                "flex-1 py-4 rounded-xl font-bold transition-all flex items-center justify-center gap-2",
                isUploading || isLoading
                  ? "bg-slate-800 text-slate-500 cursor-not-allowed opacity-50"
                  : "bg-green-600 text-white hover:bg-green-500"
              )}
            >
              {isUploading ? (
                <>
                  <Loader2 size={20} className="animate-spin" />
                  Guardando...
                </>
              ) : (
                <>
                  <Send size={20} />
                  Guardar y Continuar
                </>
              )}
            </button>
          </div>

          {error && (
            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 flex items-center gap-3">
              <AlertCircle size={20} className="shrink-0" />
              <p className="font-medium">{error}</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // State 4: Uploading
  if (state === 'uploading') {
    return (
      <div className="min-h-screen bg-slate-950 py-12 px-4 flex items-center justify-center">
        <div className="glass p-8 rounded-3xl border border-white/5 text-center max-w-md">
          <div className="w-20 h-20 bg-blue-500/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <Loader2 size={40} className="animate-spin text-blue-400" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">Guardando respuesta</h2>
          <p className="text-slate-400 mb-8">Por favor espera mientras subimos tu grabación...</p>
          
          <div className="w-full bg-white/5 h-2 rounded-full overflow-hidden">
            <div className="bg-blue-500 h-full rounded-full animate-pulse" style={{ width: '100%' }} />
          </div>
        </div>
      </div>
    );
  }

  // State 5: Complete
  return (
    <div className="min-h-screen bg-slate-950 py-12 px-4 flex items-center justify-center">
      <div className="glass p-8 rounded-3xl border border-white/5 text-center max-w-md animate-in fade-in zoom-in-95 duration-500">
        <div className="w-20 h-20 bg-green-500/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
          <CheckCircle2 size={40} className="text-green-400" />
        </div>
        <h2 className="text-2xl font-bold text-white mb-2">¡Respuesta Guardada!</h2>
        <p className="text-slate-400 mb-8">Tu grabación se ha guardado correctamente.</p>
        <div className="w-full bg-white/5 h-2 rounded-full overflow-hidden mb-6">
          <div className="bg-green-500 h-full rounded-full" style={{ width: '100%' }} />
        </div>
        <p className="text-green-400 font-medium">Completado</p>
      </div>
    </div>
  );
}