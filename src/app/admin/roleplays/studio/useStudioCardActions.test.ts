// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StudioCardActions } from './StudioInterventionCard';
import { useStudioCardActions } from './useStudioCardActions';

afterEach(cleanup);

function actions(): StudioCardActions {
  return {
    seekAudio: vi.fn(), splitAtPlayhead: vi.fn(), mergeWithNext: vi.fn(),
    separateCompound: vi.fn(), previewPairWithoutGap: vi.fn(), previewSegment: vi.fn(),
    removeIntervention: vi.fn(), update: vi.fn(), insertProtocol: vi.fn(),
    markAtPlayhead: vi.fn(), applyBoundaryProposal: vi.fn(),
    onToggleExpanded: vi.fn(), onToggleAdvanced: vi.fn(),
  };
}

describe('stable studio card actions', () => {
  it('keeps all handler identities across an editor render and delegates to the latest callbacks', () => {
    const initial = actions();
    const next = actions();
    const { result, rerender } = renderHook(
      ({ handlers }) => useStudioCardActions(handlers),
      { initialProps: { handlers: initial } },
    );
    const stable = result.current;
    rerender({ handlers: next });
    expect(result.current).toBe(stable);
    stable.update('turn-b', { title: 'Revisado' });
    stable.seekAudio(42);
    stable.onToggleExpanded('turn-b');
    stable.markAtPlayhead('turn-b', 'end');
    expect(next.update).toHaveBeenCalledWith('turn-b', { title: 'Revisado' });
    expect(next.seekAudio).toHaveBeenCalledWith(42);
    expect(next.onToggleExpanded).toHaveBeenCalledWith('turn-b');
    expect(next.markAtPlayhead).toHaveBeenCalledWith('turn-b', 'end');
    expect(initial.update).not.toHaveBeenCalled();
    expect(initial.seekAudio).not.toHaveBeenCalled();
    expect(initial.onToggleExpanded).not.toHaveBeenCalled();
    expect(initial.markAtPlayhead).not.toHaveBeenCalled();
  });
});
