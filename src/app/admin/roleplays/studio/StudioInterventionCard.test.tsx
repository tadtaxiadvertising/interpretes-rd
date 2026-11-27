// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import StudioInterventionCard, { type StudioIntervention } from './StudioInterventionCard';

afterEach(cleanup);
const segment: StudioIntervention = {
  id:'turn-a',title:'Consulta',start:1,end:4,scriptPrompt:'Interpreta',responseLimit:60,
  speakerRole:'doctor',language:'en',
};
function setup(overrides: Partial<ComponentProps<typeof StudioInterventionCard>> = {}) {
  const props: ComponentProps<typeof StudioInterventionCard> = {
    segment,index:2,canPreviewPair:false,caption:'Referencia privada',compactRows:false,focusMode:true,
    expandedSegmentId:segment.id,advancedTurnId:null,turnActionFeedback:null,boundaryProposal:null,
    canUseBoundaryProposal:false,proposalPreviewId:'boundary-proposal:turn-a',previewingId:null,pairPreviewId:null,duration:90,
    seekAudio:vi.fn(),splitAtPlayhead:vi.fn(),mergeWithNext:vi.fn(),separateCompound:vi.fn(),
    previewPairWithoutGap:vi.fn(),previewSegment:vi.fn(),removeIntervention:vi.fn(),update:vi.fn(),
    insertProtocol:vi.fn(),markAtPlayhead:vi.fn(),applyBoundaryProposal:vi.fn(),onToggleExpanded:vi.fn(),onToggleAdvanced:vi.fn(),
    ...overrides,
  };
  return {props,...render(<StudioInterventionCard {...props}/>)};
}
describe('controlled intervention editor',()=>{
  it('keeps the focus form concise and delegates classification and advanced fields by stable ID',()=>{
    const {props,rerender}=setup();
    expect(screen.getByRole('article').id).toBe('studio-intervention-turn-a');
    expect(screen.getByText('Referencia privada')).toBeTruthy();
    const advanced=screen.getByRole('button',{name:'Ajustes avanzados'});
    expect(advanced.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByLabelText('Título').closest('#studio-advanced-turn-a')?.hasAttribute('hidden')).toBe(true);
    fireEvent.change(screen.getByLabelText('Perfil del hablante'),{target:{value:'patient'}});
    fireEvent.change(screen.getByLabelText('Idioma de la intervención'),{target:{value:'es'}});
    expect(vi.mocked(props.update).mock.calls).toEqual([['turn-a',{speakerRole:'patient'}],['turn-a',{language:'es'}]]);
    fireEvent.click(advanced);
    expect(props.onToggleAdvanced).toHaveBeenCalledOnce();
    rerender(<StudioInterventionCard {...props} advancedTurnId="turn-a"/>);
    fireEvent.change(screen.getByLabelText('Título'),{target:{value:'Consulta revisada'}});
    fireEvent.change(screen.getByLabelText('Inicio (segundos)'),{target:{value:'2'}});
    expect(props.update).toHaveBeenCalledWith('turn-a',{title:'Consulta revisada'});
    expect(props.update).toHaveBeenCalledWith('turn-a',{start:2});
    expect(props.previewSegment).not.toHaveBeenCalled();
  });
  it('does not let compound cuts be edited as continuous ranges',()=>{
    const compound={...segment,end:12,ranges:[{start:1,end:4},{start:9,end:12}]};
    const {props}=setup({segment:compound,advancedTurnId:segment.id});
    expect(screen.getByLabelText('Inicio (segundos)')).toHaveProperty('disabled',true);
    expect(screen.getByLabelText('Final (segundos)')).toHaveProperty('disabled',true);
    expect(screen.getByRole('button',{name:/Dividir intervención 3/})).toHaveProperty('disabled',true);
    expect(screen.getByRole('button',{name:/Unir intervención 3/})).toHaveProperty('disabled',true);
    fireEvent.click(screen.getByRole('button',{name:'Separar cortes de intervención 3'}));
    expect(props.separateCompound).toHaveBeenCalledWith('turn-a');
  });
  it('previews a boundary proposal without applying it',()=>{
    const {props}=setup({boundaryProposal:{start:1.2,end:3.8,reason:'silence'},canUseBoundaryProposal:true});
    fireEvent.click(screen.getByRole('button',{name:'Escuchar propuesta'}));
    expect(props.previewSegment).toHaveBeenCalledWith({...segment,id:'boundary-proposal:turn-a',start:1.2,end:3.8});
    expect(props.applyBoundaryProposal).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'Aplicar ajuste de tiempos'}));
    expect(props.applyBoundaryProposal).toHaveBeenCalledOnce();
  });
});
