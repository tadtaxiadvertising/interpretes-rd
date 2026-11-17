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
  it('opens verified scenario details only when requested in a compact imported review', () => {
    render(<ScenarioCard {...props} startCollapsed />);
    expect(screen.getByDisplayValue('Interpreting scenario')).toBeTruthy();
    expect(screen.queryByLabelText(/Base audio/)).toBeNull();
    const toggle = screen.getByRole('button', { name: 'Editar detalles del escenario 1' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(screen.getByLabelText(/Base audio/)).toBeTruthy();
    expect(screen.getByDisplayValue('Preserve these instructions')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar detalles del escenario 1' }));
    expect(screen.queryByLabelText(/Base audio/)).toBeNull();
  });

  it('opens a collapsed imported scenario and focuses the missing audio input on validation', () => {
    const { rerender } = render(<ScenarioCard {...props} startCollapsed />);
    expect(screen.queryByLabelText(/Base audio/)).toBeNull();
    expect(screen.getByDisplayValue('Interpreting scenario')).toBeTruthy();

    rerender(<ScenarioCard {...props} startCollapsed focusRequest={{ field: 'audio', requestId: 1 }} />);
    const audio = screen.getByLabelText(/Base audio/) as HTMLInputElement;
    expect(document.activeElement).toBe(audio);
    expect(screen.getByRole('button', { name: 'Ocultar detalles del escenario 1' })
      .getAttribute('aria-expanded')).toBe('true');

    rerender(<ScenarioCard {...props} startCollapsed focusRequest={null} />);
    expect(screen.getByLabelText(/Base audio/)).toBe(audio);
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar detalles del escenario 1' }));
    expect(screen.queryByLabelText(/Base audio/)).toBeNull();
  });

  it('focuses an always-visible title without expanding compact details', () => {
    const { rerender } = render(<ScenarioCard {...props} startCollapsed />);
    rerender(<ScenarioCard {...props} startCollapsed focusRequest={{ field: 'title', requestId: 2 }} />);
    expect(document.activeElement).toBe(screen.getByLabelText('Scenario title'));
    expect(screen.queryByLabelText(/Base audio/)).toBeNull();
  });

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

  it('infers a readable title only for a new untitled scenario', () => {
    const createObjectURL = vi.fn(() => 'blob:new-file');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    const onUpdate = vi.fn();
    render(<ScenarioCard {...props} scenario={{ ...scenario, title: '' }} onUpdate={onUpdate} />);
    const file = new File(['new audio'], 'patient_visit-follow_up.mp3', { type: 'audio/mpeg' });
    fireEvent.change(screen.getByLabelText(/Base audio/), { target: { files: [file] } });

    expect(onUpdate).toHaveBeenCalledWith(scenario.id, expect.objectContaining({
      title: 'patient visit follow up',
      baseAudioFile: file,
    }));
  });

  it('does not invent a title for a rejected audio file', () => {
    const onUpdate = vi.fn();
    render(<ScenarioCard {...props} scenario={{ ...scenario, title: '' }} onUpdate={onUpdate} />);
    const file = new File(['invalid'], 'patient-visit.txt', { type: 'text/plain' });
    fireEvent.change(screen.getByLabelText(/Base audio/), { target: { files: [file] } });
    expect(onUpdate).not.toHaveBeenCalled();
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
