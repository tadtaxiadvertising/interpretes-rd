// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoleplayOpening } from './RoleplayOpening';

const fixture = vi.hoisted(() => ({ blob: new Blob(['test'], { type: 'audio/webm' }) }));

vi.mock('./Recorder', () => ({
  Recorder: ({ onSave, isLoading }: {
    onSave: (url: string, duration: number, blob: Blob) => Promise<void>;
    isLoading?: boolean;
  }) => (
    <button type="button" disabled={isLoading} onClick={() => void onSave('blob:opening', 42, fixture.blob)}>
      Guardar apertura de prueba
    </button>
  ),
}));

afterEach(cleanup);

describe('dedicated bilingual opening recording', () => {
  it('shows both audiences and forwards the recording to the separate save handler', () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<RoleplayOpening onSave={onSave} />);
    expect(screen.getByRole('heading', { name: 'Protocolo de apertura bilingüe' })).toBeTruthy();
    expect(screen.getByText('1. English')).toBeTruthy();
    expect(screen.getByText('2. Español')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar apertura de prueba' }));
    expect(onSave).toHaveBeenCalledWith('blob:opening', 42, fixture.blob);
  });

  it('passes the pending save state to the recorder', () => {
    render(<RoleplayOpening onSave={vi.fn()} isLoading />);
    expect((screen.getByRole('button', { name: 'Guardar apertura de prueba' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
