// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoleplayScenario } from './RoleplayScenario';

describe('Participant roleplay scenario — evaluator answer isolation', () => {
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('never renders QA keys even if a future API accidentally supplies them', () => {
    // Structural typing deliberately passes an unexpected extra field.
    const scenario = {
      id: 'medical-scenario', order: 0, title: 'Consulta médica',
      baseAudioUrl: 'https://example.test/base.mp3',
      scriptPrompt: 'Contexto para practicar la interpretación.',
      durationLimitSec: 120,
      expectedKeys: ['PRIVATE-EVALUATOR-ANSWER', 'Hidden clinical reference'],
    };
    render(<RoleplayScenario
      scenario={scenario}
      currentIndex={0} totalScenarios={1}
      onNext={vi.fn()}
      baseVolume={1} onVolumeChange={vi.fn()}
    />);
    expect(screen.queryByText(/PRIVATE-EVALUATOR-ANSWER/)).toBeNull();
    expect(screen.queryByText(/Hidden clinical reference/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Ver claves esperadas/i })).toBeNull();

    const showScript = screen.getAllByRole('button', { name: 'Ver guión' });
    expect(showScript.length).toBeGreaterThan(0);
    fireEvent.click(showScript[showScript.length - 1]);
    expect(screen.getByText('Contexto para practicar la interpretación.')).toBeTruthy();
    expect(screen.queryByText(/PRIVATE-EVALUATOR-ANSWER/)).toBeNull();
    expect(screen.queryByText(/Hidden clinical reference/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Ver claves esperadas/i })).toBeNull();
  });
});
