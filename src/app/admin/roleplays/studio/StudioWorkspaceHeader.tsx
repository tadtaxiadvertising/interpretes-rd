'use client';

import type { Ref } from 'react';

type WorkspaceStage = 'edit' | 'finish';
type Props = {
  stage: WorkspaceStage;
  onStageChange: (stage: WorkspaceStage) => void;
  onExit: () => void;
  exitRef: Ref<HTMLButtonElement>;
};

/** Stage switching changes presentation only; editorial and media state live in the page. */
export default function StudioWorkspaceHeader({ stage, onStageChange, onExit, exitRef }: Props) {
  return (
    <div className="flex min-w-0 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] pb-2">
      <h1 className="text-base font-bold text-[var(--foreground)]">Escritorio de Audio Studio</h1>
      <div className="grid w-full min-w-0 grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap" role="group" aria-label="Etapas del escritorio">
        <button type="button" aria-pressed={stage === 'edit'} onClick={() => onStageChange('edit')}
          className={`min-h-11 min-w-11 rounded-lg px-3 py-2 text-xs font-semibold sm:min-h-0 sm:min-w-0 ${stage === 'edit' ? 'theme-action-primary' : 'theme-action-secondary'}`}>Editar</button>
        <button type="button" aria-pressed={stage === 'finish'} onClick={() => onStageChange('finish')}
          className={`min-h-11 min-w-11 rounded-lg px-3 py-2 text-xs font-semibold sm:min-h-0 sm:min-w-0 ${stage === 'finish' ? 'theme-action-primary' : 'theme-action-secondary'}`}>Finalizar</button>
        <button ref={exitRef} type="button" onClick={onExit}
          className="theme-action-secondary col-span-2 min-h-11 min-w-11 rounded-lg px-3 py-2 text-xs font-semibold sm:min-h-0 sm:min-w-0">Salir del escritorio</button>
      </div>
    </div>
  );
}
