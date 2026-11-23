// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
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
    trigger.focus(); // jsdom fireEvent.click does not move focus as a real pointer click would.
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

  it('traps Tab and Shift+Tab inside the current dialog', () => {
    render(<TestDialog />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir diálogo' }));
    const close = screen.getByRole('button', { name: 'Cerrar ventana' });
    const field = screen.getByLabelText('Nombre');

    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(field);
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    close.focus();
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(field);
  });

  it('does not let closed dialogs unlock scrolling while one remains open', () => {
    const close = () => {};
    document.body.style.overflow = 'scroll';
    const { rerender, unmount } = render(
      <>
        <Modal isOpen onClose={close} title="Primer diálogo"><button>Aceptar</button></Modal>
        <Modal isOpen={false} onClose={close} title="Segundo diálogo"><button>Otro</button></Modal>
      </>
    );
    expect(document.body.style.overflow).toBe('hidden');

    rerender(
      <>
        <Modal isOpen onClose={close} title="Primer diálogo"><button>Aceptar</button></Modal>
        <Modal isOpen onClose={close} title="Segundo diálogo"><button>Otro</button></Modal>
      </>
    );
    expect(document.body.style.overflow).toBe('hidden');

    rerender(
      <>
        <Modal isOpen={false} onClose={close} title="Primer diálogo"><button>Aceptar</button></Modal>
        <Modal isOpen onClose={close} title="Segundo diálogo"><button>Otro</button></Modal>
      </>
    );
    expect(document.body.style.overflow).toBe('hidden');

    unmount();
    expect(document.body.style.overflow).toBe('scroll');
    document.body.style.overflow = '';
  });

  it('does not modify body scrolling when every dialog is closed', () => {
    document.body.style.overflow = 'auto';
    render(<Modal isOpen={false} onClose={() => {}} title="Cerrado"><p>Vacío</p></Modal>);
    expect(document.body.style.overflow).toBe('auto');
    document.body.style.overflow = '';
  });

  it('can close with Escape without interfering with its contents', () => {
    render(<TestDialog />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir diálogo' }));
    expect(screen.getByLabelText('Nombre')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
