// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import * as timeFormat from '@/lib/roleplay-studio/format-time';
import { useStudioCardActions } from './useStudioCardActions';
import StudioInterventionCard, { type StudioIntervention } from './StudioInterventionCard';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const segment: StudioIntervention = {
  id:'turn-a',title:'Consulta',start:1,end:4,scriptPrompt:'Interpreta',responseLimit:60,
  speakerRole:'doctor',language:'en',
};
function makeProps(overrides: Partial<ComponentProps<typeof StudioInterventionCard>> = {}): ComponentProps<typeof StudioInterventionCard> {
  return {
    segment,index:2,canPreviewPair:false,caption:'Referencia privada',compactRows:false,focusMode:true,
    expandedSegmentId:segment.id,advancedTurnId:null,turnActionFeedback:null,boundaryProposal:null,
    canUseBoundaryProposal:false,proposalPreviewId:'boundary-proposal:turn-a',previewingId:null,pairPreviewId:null,duration:90,
    seekAudio:vi.fn(),splitAtPlayhead:vi.fn(),mergeWithNext:vi.fn(),separateCompound:vi.fn(),
    previewPairWithoutGap:vi.fn(),previewSegment:vi.fn(),removeIntervention:vi.fn(),update:vi.fn(),
    insertProtocol:vi.fn(),markAtPlayhead:vi.fn(),applyBoundaryProposal:vi.fn(),onToggleExpanded:vi.fn(),onToggleAdvanced:vi.fn(),
    ...overrides,
  };
}
function setup(overrides: Partial<ComponentProps<typeof StudioInterventionCard>> = {}) {
  const props = makeProps(overrides);
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
    fireEvent.click(screen.getByRole('button',{name:'Hispanohablante · ES'}));
    expect(vi.mocked(props.update).mock.calls).toEqual([['turn-a',{speakerRole:'patient',language:'es'}]]);
    fireEvent.click(advanced);
    expect(props.onToggleAdvanced).toHaveBeenCalledExactlyOnceWith('turn-a');
    rerender(<StudioInterventionCard {...props} advancedTurnId="turn-a"/>);
    fireEvent.change(screen.getByLabelText('Título'),{target:{value:'Consulta revisada'}});
    fireEvent.change(screen.getByLabelText('Inicio (segundos)'),{target:{value:'2'}});
    expect(props.update).toHaveBeenCalledWith('turn-a',{title:'Consulta revisada'});
    expect(props.update).toHaveBeenCalledWith('turn-a',{start:2});
    expect(props.previewSegment).not.toHaveBeenCalled();
  });
  it('offers exactly three profiles in compact view and assigns English to interpreter',()=>{
    const {props}=setup({compactRows:true,expandedSegmentId:null,segment:{...segment,speakerRole:'unknown',language:'unknown'}});
    expect(screen.getByRole('group',{name:'Perfil de intervención 3'}).querySelectorAll('button')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button',{name:'Intérprete original — excluir · EN'}));
    expect(props.update).toHaveBeenCalledExactlyOnceWith('turn-a',{speakerRole:'interpreter',language:'en'});
  });
  it('keeps compact profile choices and grouped cutting tools directly available',()=>{
    const {props}=setup({compactRows:true,focusMode:false,expandedSegmentId:null,
      segment:{...segment,title:'Consulta de seguimiento con un título muy largo para pantallas pequeñas'}});
    const profiles=screen.getByRole('group',{name:'Perfil de intervención 3'});
    expect(profiles.querySelectorAll('button')).toHaveLength(3);
    expect(profiles.className).toContain('grid-cols-2');
    expect(screen.getByRole('button',{name:'Intérprete original — excluir · EN'}).className).toContain('col-span-2');
    const tools=screen.getByRole('group',{name:'Herramientas de intervención 3'});
    for (const button of tools.querySelectorAll('button')) expect(button.className).toContain('min-h-11');
    expect(screen.getByRole('heading',{level:3}).className).not.toContain('truncate');
    fireEvent.click(screen.getByRole('button',{name:'Escuchar fragmento de intervención 3'}));
    expect(props.previewSegment).toHaveBeenCalledExactlyOnceWith(props.segment);
    fireEvent.click(screen.getByRole('button',{name:'Editar'}));
    expect(props.onToggleExpanded).toHaveBeenCalledExactlyOnceWith('turn-a');
    expect(props.update).not.toHaveBeenCalled();
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
  it('skips unchanged card work while dispatching actions from the latest committed parent render',()=>{
    const props = makeProps();
    const initial = vi.fn();
    const next = vi.fn();
    const format = vi.spyOn(timeFormat, 'formatStudioTime');
    function Parent({tick, update}: {tick: number; update: typeof props.update}) {
      const actions = useStudioCardActions({...props, update});
      return <><span>Cursor {tick}</span><StudioInterventionCard {...props} {...actions}/></>;
    }
    const {rerender} = render(<Parent tick={1} update={initial}/>);
    expect(format).toHaveBeenCalled();
    format.mockClear();
    rerender(<Parent tick={2} update={next}/>);
    expect(screen.getByText('Cursor 2')).toBeTruthy();
    expect(format).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'Hispanohablante · ES'}));
    expect(next).toHaveBeenCalledWith('turn-a',{speakerRole:'patient',language:'es'});
    expect(initial).not.toHaveBeenCalled();
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
