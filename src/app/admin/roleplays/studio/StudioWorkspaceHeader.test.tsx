// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import StudioWorkspaceHeader from './StudioWorkspaceHeader';

afterEach(cleanup);

describe('workspace stage navigation', () => {
  it('changes the pressed stage without invoking exit or other actions', () => {
    const exitRef = createRef<HTMLButtonElement>();
    const exit = vi.fn();
    const change = vi.fn();
    function Harness() {
      const [stage, setStage] = useState<'edit' | 'finish'>('edit');
      return <StudioWorkspaceHeader stage={stage} onStageChange={next => {
        change(next);
        setStage(next);
      }} onExit={exit} exitRef={exitRef}/>;
    }
    render(<Harness/>);
    const group = within(screen.getByRole('group', { name: 'Etapas del escritorio' }));
    const edit = group.getByRole('button', { name: 'Editar' });
    const finish = group.getByRole('button', { name: 'Finalizar' });
    expect(edit.getAttribute('aria-pressed')).toBe('true');
    expect(finish.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(finish);
    expect(change).toHaveBeenLastCalledWith('finish');
    expect(edit.getAttribute('aria-pressed')).toBe('false');
    expect(finish.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(edit);
    expect(change).toHaveBeenLastCalledWith('edit');
    expect(exit).not.toHaveBeenCalled();
    const exitButton = group.getByRole('button', { name: 'Salir del escritorio' });
    expect(exitRef.current).toBe(exitButton);
    exitRef.current?.focus();
    expect(document.activeElement).toBe(exitButton);
    fireEvent.click(exitButton);
    expect(exit).toHaveBeenCalledOnce();
    expect(change).toHaveBeenCalledTimes(2);
  });
});
