'use client';

import React, { useRef, useState } from 'react';
import { Mic2, Trash2, GripVertical, Clock, ChevronUp, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Scenario {
  id: string;
  title: string;
  baseAudioFile: File | null;
  baseAudioPreview: string;
  durationLimitSec: number;
  scriptPrompt: string;
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
    onUpdate(scenario.id, {
      baseAudioFile: file,
      baseAudioPreview: URL.createObjectURL(file),
    });
  };

  const handleTitleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    onUpdate(scenario.id, { title: event.target.value });
  };

  const handleDurationChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = event.target.value;
    const value = rawValue === '' ? 0 : Number(rawValue);
    if (Number.isSafeInteger(value) && value >= 0 && value <= 86400) {
      onUpdate(scenario.id, { durationLimitSec: value });
    }
  };

  const handleScriptChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    onUpdate(scenario.id, { scriptPrompt: event.target.value });
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
                  : 'No limit'}
              </span>
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
              Duration limit (seconds)
            </label>
            <input
              id={`scenario-duration-${scenario.id}`}
              type="number"
              value={scenario.durationLimitSec || ''}
              onChange={handleDurationChange}
              placeholder="e.g., 120"
              min="0"
              max="86400"
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
              rows={2}
              maxLength={5000}
              className="w-full bg-slate-950 border border-white/10 rounded-xl py-2 px-3 text-white focus:border-blue-500 transition-colors resize-none"
            />
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
