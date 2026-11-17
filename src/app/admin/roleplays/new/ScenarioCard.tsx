'use client';

import React, { useRef, useState } from 'react';
import { Mic2, Trash2, GripVertical, Clock, ChevronUp, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ROLEPLAY_RESPONSE_MAX_DURATION_SEC } from '@/lib/roleplay-limits';
import { addStudioProtocol, type StudioProtocolKind, type StudioProtocolLanguage } from '@/lib/roleplay-studio/protocols';

interface Scenario {
  id: string;
  title: string;
  baseAudioFile: File | null;
  baseAudioPreview: string;
  durationLimitSec: number;
  scriptPrompt: string;
  studioTurn?: number;
  studioSpeaker?: 'speaker_1' | 'speaker_2' | 'speaker_3';
  studioLanguage?: 'en' | 'es' | 'mixed';
  sourceStartSec?: number | null;
  sourceEndSec?: number | null;
  sha256?: string;
}

interface ScenarioCardProps {
  scenario: Scenario;
  index: number;
  scenarioCount: number;
  onUpdate: (id: string, updates: Partial<Scenario>) => void;
  onRemove: (id: string) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
  isDragging: boolean;
}

const MAX_AUDIO_SIZE = 15 * 1024 * 1024;
const ALLOWED_AUDIO_TYPES = new Set(['audio/mpeg', 'audio/wav', 'audio/webm', 'audio/mp4']);

export function ScenarioCard({
  scenario,
  index,
  scenarioCount,
  onUpdate,
  onRemove,
  onMoveUp,
  onMoveDown,
  isDragging,
}: ScenarioCardProps) {
  const [audioError, setAudioError] = useState<string | null>(null);
  const [protocolLanguage, setProtocolLanguage] = useState<StudioProtocolLanguage>('es');
  const [protocolError, setProtocolError] = useState<string | null>(null);
  const [protocolNotice, setProtocolNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAudioSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size <= 0 || file.size > MAX_AUDIO_SIZE) {
      setAudioError('El audio debe pesar entre 1 byte y 15 MB.');
      event.target.value = '';
      return;
    }
    if (!ALLOWED_AUDIO_TYPES.has(file.type)) {
      setAudioError('Formato no válido. Utiliza MP3, WAV, WebM o MP4.');
      event.target.value = '';
      return;
    }

    setAudioError(null);
    // Avoid asking for a title that can be inferred from the uploaded clip.
    // Never overwrite an administrator's or Audio Studio's existing title.
    const inferredTitle = file.name
      .replace(/\.[^.]+$/, '')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
    onUpdate(scenario.id, {
      ...(scenario.title.trim() ? {} : { title: inferredTitle || `Intervención ${index + 1}` }),
      baseAudioFile: file,
      baseAudioPreview: URL.createObjectURL(file),
      sha256: undefined,
      // Audio Studio metadata describes the original imported recording.
      // Replacing the clip must not preserve stale speaker/timeline identity.
      studioTurn: undefined,
      studioSpeaker: undefined,
      studioLanguage: undefined,
      sourceStartSec: undefined,
      sourceEndSec: undefined,
    });
  };

  const handleTitleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    onUpdate(scenario.id, { title: event.target.value });
  };

  const handleDurationChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = event.target.value;
    const value = rawValue === '' ? 0 : Number(rawValue);
    if (Number.isSafeInteger(value) && value >= 0 && value <= ROLEPLAY_RESPONSE_MAX_DURATION_SEC) {
      onUpdate(scenario.id, { durationLimitSec: value });
    }
  };

  const handleScriptChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setProtocolError(null);
    setProtocolNotice(null);
    onUpdate(scenario.id, { scriptPrompt: event.target.value });
  };

  const handleAddProtocol = (kind: StudioProtocolKind) => {
    try {
      const result = addStudioProtocol(scenario.scriptPrompt, kind, protocolLanguage);
      setProtocolError(null);
      setProtocolNotice(result.added ? 'Protocolo añadido a las instrucciones del escenario.' : 'Este protocolo ya está incluido.');
      if (result.added) onUpdate(scenario.id, { scriptPrompt: result.text });
    } catch (error) {
      setProtocolNotice(null);
      setProtocolError(error instanceof Error ? error.message : 'No se pudo añadir el protocolo.');
    }
  };

  return (
    <div
      className={cn(
        'glass p-6 rounded-2xl border border-white/5 transition-all duration-300',
        isDragging && 'opacity-50 ring-2 ring-blue-500/50',
      )}
    >
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <button
            type="button"
            className="p-2 hover:bg-white/10 rounded-xl text-gray-400 hover:text-white transition-colors cursor-grab active:cursor-grabbing"
            onMouseDown={(event) => event.preventDefault()}
            aria-label="Reorder scenario"
            title="Use the up/down controls to reorder scenarios"
          >
            <GripVertical size={20} className="text-gray-500" />
          </button>
          <div className="flex-1 min-w-0">
            <label className="sr-only" htmlFor={`scenario-title-${scenario.id}`}>Scenario title</label>
            <input
              id={`scenario-title-${scenario.id}`}
              type="text"
              value={scenario.title}
              onChange={handleTitleChange}
              placeholder={`Scenario ${index + 1} title`}
              maxLength={200}
              className="bg-transparent border-none text-white placeholder-gray-500 text-lg font-semibold focus:outline-none w-full"
            />
            <div className="flex items-center gap-4 text-xs text-gray-500 mt-1">
              <span className="flex items-center gap-1">
                <Clock size={12} />
                {scenario.durationLimitSec
                  ? `${Math.floor(scenario.durationLimitSec / 60)}:${(scenario.durationLimitSec % 60).toString().padStart(2, '0')}`
                  : 'Default (5:00 max)'}
              </span>
              {scenario.studioTurn && <span>Turno original #{scenario.studioTurn}</span>}
              {scenario.studioSpeaker && <span>{scenario.studioSpeaker.replace('_', ' ')}</span>}
              {scenario.studioLanguage && <span>{scenario.studioLanguage.toUpperCase()}</span>}
              {scenario.sourceStartSec != null && scenario.sourceEndSec != null && <span>{scenario.sourceStartSec.toFixed(2)}s–{scenario.sourceEndSec.toFixed(2)}s</span>}
              {scenario.baseAudioFile && (
                <span className="flex items-center gap-1 text-green-400">
                  <Mic2 size={12} />
                  Audio ready
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => onMoveUp(scenario.id)} disabled={index === 0} aria-label={`Move scenario ${index + 1} up`} className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed">
            <ChevronUp size={18} />
          </button>
          <button type="button" onClick={() => onMoveDown(scenario.id)} disabled={index === scenarioCount - 1} aria-label={`Move scenario ${index + 1} down`} className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed">
            <ChevronDown size={18} />
          </button>
          <button
            type="button"
            onClick={() => onRemove(scenario.id)}
            className="p-2 hover:bg-red-500/20 rounded-xl text-red-400 hover:text-red-300 transition-colors"
            aria-label={`Remove scenario ${index + 1}`}
          >
            <Trash2 size={18} />
          </button>
        </div>
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1" htmlFor={`scenario-duration-${scenario.id}`}>
              Duration limit (seconds, max {ROLEPLAY_RESPONSE_MAX_DURATION_SEC})
            </label>
            <input
              id={`scenario-duration-${scenario.id}`}
              type="number"
              value={scenario.durationLimitSec || ''}
              onChange={handleDurationChange}
              placeholder="e.g., 120"
              min="0"
              max={ROLEPLAY_RESPONSE_MAX_DURATION_SEC}
              step="1"
              className="w-full bg-slate-950 border border-white/10 rounded-xl py-2 px-3 text-white focus:border-blue-500 transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1" htmlFor={`scenario-prompt-${scenario.id}`}>
              Script prompt (optional)
            </label>
            <textarea
              id={`scenario-prompt-${scenario.id}`}
              value={scenario.scriptPrompt}
              onChange={handleScriptChange}
              placeholder="Key phrases or guidance for the interpreter..."
              rows={3}
              maxLength={5000}
              className="w-full bg-slate-950 border border-white/10 rounded-xl py-2 px-3 text-white focus:border-blue-500 transition-colors resize-none"
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor={`scenario-protocol-language-${scenario.id}`}>Protocol language</label>
              <select
                id={`scenario-protocol-language-${scenario.id}`}
                value={protocolLanguage}
                onChange={(event) => setProtocolLanguage(event.target.value as StudioProtocolLanguage)}
                className="rounded-lg border border-white/10 bg-slate-950 px-2 py-1.5 text-xs text-gray-200"
              >
                <option value="es">Protocolos en español</option>
                <option value="en">Protocols in English</option>
              </select>
              <button type="button" onClick={() => handleAddProtocol('opening')} className="rounded-lg border border-white/10 px-2 py-1.5 text-xs text-blue-200 hover:bg-white/10">
                + Apertura
              </button>
              <button type="button" onClick={() => handleAddProtocol('repetition')} className="rounded-lg border border-white/10 px-2 py-1.5 text-xs text-blue-200 hover:bg-white/10">
                + Repetición
              </button>
              <button type="button" onClick={() => handleAddProtocol('closing')} className="rounded-lg border border-white/10 px-2 py-1.5 text-xs text-blue-200 hover:bg-white/10">
                + Cierre
              </button>
            </div>
            {protocolNotice && <p role="status" className="mt-2 text-xs text-emerald-300">{protocolNotice}</p>}
            {protocolError && <p role="alert" className="mt-2 text-xs text-red-300">{protocolError}</p>}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1" htmlFor={`scenario-audio-${scenario.id}`}>
            Base audio (MP3, WAV, WebM or MP4 · max. 15 MB)
          </label>
          <input
            ref={fileInputRef}
            id={`scenario-audio-${scenario.id}`}
            type="file"
            accept="audio/mpeg,audio/wav,audio/webm,audio/mp4"
            onChange={handleAudioSelect}
            aria-describedby={audioError ? `scenario-audio-error-${scenario.id}` : undefined}
            className="w-full bg-slate-950 border border-white/10 rounded-xl py-2 px-3 text-white focus:border-blue-500 transition-colors file:mr-4 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-blue-600 file:text-white hover:file:bg-blue-500"
          />
          {audioError && (
            <p id={`scenario-audio-error-${scenario.id}`} role="alert" className="text-sm text-red-400 mt-2">
              {audioError}
            </p>
          )}
          {scenario.baseAudioFile && (
            <p className="text-xs text-gray-400 mt-2">
              {scenario.baseAudioFile.name} · {(scenario.baseAudioFile.size / (1024 * 1024)).toFixed(2)} MB
            </p>
          )}
          {scenario.baseAudioPreview && (
            <div className="space-y-2 mt-3">
              <p className="text-xs font-medium text-gray-400">Preview</p>
              <audio src={scenario.baseAudioPreview} controls preload="metadata" className="w-full" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
