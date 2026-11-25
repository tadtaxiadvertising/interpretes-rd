// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { RoleplayOpeningReview } from './RoleplayOpeningReview';

afterEach(cleanup);

describe('independent opening QA card', () => {
  it('does not add an opening card for exempt sessions', () => {
    const { container } = render(<RoleplayOpeningReview opening={{ state: 'not-required' }} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows separate playback, duration and bilingual review criteria', () => {
    render(<RoleplayOpeningReview opening={{ state: 'confirmed', durationSec: 62, audioUrl: 'https://storage.example.test/signed' }} />);
    expect(screen.getByRole('heading', { name: 'Protocolo de apertura bilingüe' })).toBeTruthy();
    const player = screen.getByLabelText('Grabación de apertura bilingüe');
    expect(player.getAttribute('src')).toBe('https://storage.example.test/signed');
    expect(player.getAttribute('preload')).toBe('none');
    expect(screen.getByText(/Grabación confirmada · 1:02/)).toBeTruthy();
    expect(screen.getByText(/presentación ante el médico en inglés/)).toBeTruthy();
    expect(screen.getByText(/ante el paciente en español/)).toBeTruthy();
  });

  it('shows clear recovery states without rendering an empty player', () => {
    const { rerender } = render(<RoleplayOpeningReview opening={{ state: 'pending' }} />);
    expect(screen.getByRole('status').textContent).toContain('pendiente');
    expect(screen.queryByLabelText('Grabación de apertura bilingüe')).toBeNull();
    rerender(<RoleplayOpeningReview opening={{ state: 'confirmed', durationSec: 42, audioUrl: null }} />);
    expect(screen.getByRole('alert').textContent).toContain('reproducción no está disponible');
    rerender(<RoleplayOpeningReview opening={{ state: 'unavailable' }} />);
    expect(screen.getByRole('alert').textContent).toContain('No se pudo consultar');
  });
});
