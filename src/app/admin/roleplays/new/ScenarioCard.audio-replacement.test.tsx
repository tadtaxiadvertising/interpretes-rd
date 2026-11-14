// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ScenarioCard } from './ScenarioCard';

const scenario = {
  id: 'studio-turn-4',
  title: 'Interpreting scenario',
  baseAudioFile: new File(['old'], 'old.mp3', { type: 'audio/mpeg' }),
  baseAudioPreview: 'blob:old',
  durationLimitSec: 120,
  scriptPrompt: 'Preserve these instructions',
  studioTurn: 4,
  studioSpeaker: 'speaker_2' as const,
  studioLanguage: 'es' as const,
  sourceStartSec: 24.5,
  sourceEndSec: 31.25,
  sha256: '0'.repeat(64),
};

const props = {
  scenario,
  index: 0,
  scenarioCount: 1,
  onUpdate: vi.fn(),
  onRemove: vi.fn(),
  onMoveUp: vi.fn(),
  onMoveDown: vi.fn(),
  isDragging: false,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('replacing Audio Studio source audio', () => {
  it('clears imported timeline, speaker, language, turn and checksum without changing other edits', () => {
    const createObjectURL = vi.fn(() => 'blob:new-file');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    const onUpdate = vi.fn();
    render(<ScenarioCard {...props} onUpdate={onUpdate} />);
    const newFile = new File(['new audio'], 'replacement.mp3', { type: 'audio/mpeg' });
    fireEvent.change(screen.getByLabelText(/Base audio/), { target: { files: [newFile] } });

    expect(createObjectURL).toHaveBeenCalledWith(newFile);
    expect(onUpdate).toHaveBeenCalledOnce();
    expect(onUpdate).toHaveBeenCalledWith(scenario.id, {
      baseAudioFile: newFile,
      baseAudioPreview: 'blob:new-file',
      sha256: undefined,
      studioTurn: undefined,
      studioSpeaker: undefined,
      studioLanguage: undefined,
      sourceStartSec: undefined,
      sourceEndSec: undefined,
    });
    expect(onUpdate.mock.calls[0][1]).not.toHaveProperty('title');
    expect(onUpdate.mock.calls[0][1]).not.toHaveProperty('scriptPrompt');
  });

  it('preserves the previous imported metadata if the replacement file is rejected', () => {
    const onUpdate = vi.fn();
    render(<ScenarioCard {...props} onUpdate={onUpdate} />);
    const invalidFile = new File(['not audio'], 'replacement.txt', { type: 'text/plain' });
    fireEvent.change(screen.getByLabelText(/Base audio/), { target: { files: [invalidFile] } });

    expect(screen.getByRole('alert').textContent).toContain('Formato no válido');
    expect(onUpdate).not.toHaveBeenCalled();
  });
});
