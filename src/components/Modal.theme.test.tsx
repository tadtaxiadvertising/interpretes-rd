// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { Modal } from './Modal';

afterEach(() => cleanup());

function TestDialog() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Abrir diálogo</button>
      <Modal isOpen={open} onClose={() => setOpen(false)} title="Editar intérprete">
        <label htmlFor="test-field">Nombre</label>
        <input id="test-field" placeholder="Nombre" />
      </Modal>
    </>
  );
}

describe('Shared modal appearance and accessibility', () => {
  it('keeps portal content in the theme workspace and respects the chosen palette', () => {
    render(<TestDialog />);
    const trigger = screen.getByRole('button', { name: 'Abrir diálogo' });
    fireEvent.click(trigger);

    const dialog = screen.getByRole('dialog', { name: 'Editar intérprete' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.className).toContain('bg-[var(--theme-panel)]');
    expect(dialog.className).toContain('text-[var(--foreground)]');
    expect(dialog.closest('.theme-workspace')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cerrar ventana' })).toBe(document.activeElement);

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar ventana' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('can close with Escape without interfering with its contents', () => {
    render(<TestDialog />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir diálogo' }));
    expect(screen.getByLabelText('Nombre')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
