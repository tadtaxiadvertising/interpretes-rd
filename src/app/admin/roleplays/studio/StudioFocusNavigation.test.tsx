// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import StudioFocusNavigation from './StudioFocusNavigation';

afterEach(cleanup);

const turns = [
  {segment:{id:'a',title:'Primera'},index:0},
  {segment:{id:'c',title:'Tercera',sourceSpeakerGroup:'speaker 1'},index:2},
  {segment:{id:'e',title:'Quinta'},index:4},
];
function setup(overrides: Partial<ComponentProps<typeof StudioFocusNavigation>> = {}) {
  const props: ComponentProps<typeof StudioFocusNavigation> = {
    visibleSegments:turns,focusedTurn:turns[1],focusIndex:1,totalTurns:5,workspaceActive:true,
    canConfirmFocused:true,editingDisabled:false,confirmed:false,focusedReviewIssue:null,
    sourceProfileCount:2,previewActive:false,playhead:10,duration:90,
    onSelect:vi.fn(),onConfirm:vi.fn(),onExclude:vi.fn(),onApplyProfile:vi.fn(),
    onPreview:vi.fn(),onPause:vi.fn(),onSkip:vi.fn(),onSeek:vi.fn(),...overrides,
  };
  return {props,...render(<StudioFocusNavigation {...props}/>)};
}

describe('focused intervention navigation',()=>{
  it('uses visible neighbors and preserves original numbering without starting playback',()=>{
    const {props}=setup();
    expect(screen.getByText('Intervención 3 de 5 · 2 de 3 visibles')).toBeTruthy();
    const select=screen.getByLabelText('Ir a intervención') as HTMLSelectElement;
    expect(Array.from(select.options).map(o=>o.textContent)).toEqual(['#1 · Primera','#3 · Tercera','#5 · Quinta']);
    fireEvent.click(screen.getByRole('button',{name:'Anterior intervención'}));
    fireEvent.click(screen.getByRole('button',{name:'Siguiente intervención'}));
    fireEvent.change(select,{target:{value:'e'}});
    expect(vi.mocked(props.onSelect).mock.calls).toEqual([['a'],['e'],['e']]);
    expect(props.onPreview).not.toHaveBeenCalled();
    expect(props.onConfirm).not.toHaveBeenCalled();
  });
  it('preserves boundary and review guards while allowing playback',()=>{
    const {props}=setup({focusedTurn:turns[0],focusIndex:0,editingDisabled:true,canConfirmFocused:false,focusedReviewIssue:'Revisa los tiempos'});
    expect(screen.getByRole('button',{name:'Anterior intervención'})).toHaveProperty('disabled',true);
    expect(screen.getByRole('button',{name:'Confirmar y avanzar'})).toHaveProperty('disabled',true);
    expect(screen.getByRole('button',{name:'Excluir y avanzar'})).toHaveProperty('disabled',true);
    expect(screen.getByText(/Revisa los tiempos/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'Escuchar intervención activa'}));
    expect(props.onPreview).toHaveBeenCalledOnce();
    expect(props.onConfirm).not.toHaveBeenCalled();
  });
  it('delegates review, profile and player actions to separate callbacks',()=>{
    const {props,rerender}=setup();
    fireEvent.click(screen.getByRole('button',{name:'Confirmar y avanzar'}));
    fireEvent.click(screen.getByRole('button',{name:'Excluir y avanzar'}));
    fireEvent.click(screen.getByRole('button',{name:/Aplicar perfil a 2 turnos/}));
    expect(props.onConfirm).toHaveBeenCalledOnce();
    expect(props.onExclude).toHaveBeenCalledOnce();
    expect(props.onApplyProfile).toHaveBeenCalledOnce();
    const group=within(screen.getByRole('group',{name:'Reproducción en modo enfoque'}));
    fireEvent.click(group.getByRole('button',{name:'Retroceder audio 5 segundos'}));
    fireEvent.click(group.getByRole('button',{name:'Avanzar audio 5 segundos'}));
    fireEvent.change(group.getByRole('slider'),{target:{value:'30'}});
    fireEvent.click(group.getByRole('button',{name:'Pausar audio'}));
    expect(vi.mocked(props.onSkip).mock.calls).toEqual([[-5],[5]]);
    expect(props.onSeek).toHaveBeenCalledWith(30);
    expect(props.onPause).toHaveBeenCalledOnce();
    rerender(<StudioFocusNavigation {...props} focusedTurn={turns[2]} focusIndex={2} previewActive/>);
    expect(screen.getByRole('button',{name:'Siguiente intervención'})).toHaveProperty('disabled',true);
    expect(screen.getByRole('button',{name:'Detener fragmento activo'}).getAttribute('aria-pressed')).toBe('true');
  });
});
