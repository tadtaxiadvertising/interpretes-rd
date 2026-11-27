// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps, ReactNode } from 'react';
import StudioFinalizationPanel from './StudioFinalizationPanel';

vi.mock('next/link', () => ({
  default: ({href, children, prefetch: _prefetch, ...props}: {href:string;children:ReactNode;prefetch?:boolean}) =>
    <a href={href} {...props}>{children}</a>,
}));
vi.mock('@/lib/roleplay-studio/production-tracking', () => ({
  productionStatus: (key:string) => key === 'created' ? 'created' : key === 'uncertain' ? 'unconfirmed' : undefined,
}));
afterEach(cleanup);
const parts = [
  {key:'a',number:1,first:1,last:25,seconds:100},
  {key:'b',number:2,first:26,last:50,seconds:100},
  {key:'c',number:3,first:51,last:60,seconds:40},
];
function setup(overrides: Partial<ComponentProps<typeof StudioFinalizationPanel>> = {}) {
  const props: ComponentProps<typeof StudioFinalizationPanel> = {
    segmentCount:60, expandedEditor:true, publicationPlan:{parts,issue:null},
    currentWavPlan:{parts:parts.map(p=>({key:p.key,bytes:1024*1024})),issue:null},
    hasAudio:true, duration:300, sourceRequiresLocal:true, hasCompound:false, allowServerZipExport:false,
    localOnly:true, wavSource:true, localMp3Eligible:false, convertedMp3Bytes:null,
    busy:false, draftBusy:false, analyzingSilences:false, activeProductionKeys:new Map([['a','created'],['b','uncertain'],['c','pending']]),
    readyAssignment:null, onSelectPart:vi.fn(), onSaveDraft:vi.fn(), onDownloadPart:vi.fn(),
    onChangeMode:vi.fn(), onReleaseMp3:vi.fn(), onEnableMp3:vi.fn(), onPrepareLocal:vi.fn(),
    onPrepareServer:vi.fn(), onDownload:vi.fn(), onConfirmNavigation:vi.fn(()=>false),
    onContinue:vi.fn(event=>event.preventDefault()), ...overrides,
  };
  const view=render(<StudioFinalizationPanel {...props}/>);
  return {props,...view};
}
describe('Studio finalization presentation',()=>{
  it('selects an eligible pending part without starting preparation or creation',()=>{
    const {props,rerender}=setup();
    expect(screen.getByText('Creación confirmada')).toBeTruthy();
    expect(screen.getByText('Intento sin confirmar')).toBeTruthy();
    expect(screen.getByRole('button',{name:'Preparar WAV local para asignación'})).toHaveProperty('disabled',true);
    fireEvent.click(screen.getByRole('button',{name:'Elegir siguiente parte pendiente (3)'}));
    expect(props.onSelectPart).toHaveBeenCalledWith('c');
    expect(props.onPrepareLocal).not.toHaveBeenCalled();
    rerender(<StudioFinalizationPanel {...props} selectedPublicationPart={parts[2]}/>);
    fireEvent.click(screen.getByRole('button',{name:'Preparar parte 3 en WAV local'}));
    expect(props.onPrepareLocal).toHaveBeenCalledOnce();
    expect(props.onPrepareServer).not.toHaveBeenCalled();
    expect(props.onContinue).not.toHaveBeenCalled();
  });
  it('delegates navigation, keeping guarded links and prepared handoff separate',()=>{
    const {props}=setup({readyAssignment:{token:'opaque-token',partKey:'c'}});
    expect(screen.getByText('Preparado')).toBeTruthy();
    const existing=screen.getByRole('link',{name:'Consultar sesiones existentes'});
    expect(fireEvent.click(existing)).toBe(false);
    expect(props.onConfirmNavigation).toHaveBeenCalledOnce();
    const handoff=screen.getByRole('link',{name:'Continuar a asignación'});
    expect(handoff.getAttribute('href')).toBe('/admin/roleplays/new?studioTransfer=opaque-token');
    expect(fireEvent.click(handoff)).toBe(false);
    expect(props.onContinue).toHaveBeenCalledOnce();
  });
  it('requests a mode change without starting a server export',()=>{
    const {props}=setup({segmentCount:1,expandedEditor:false,sourceRequiresLocal:false,localMp3Eligible:true,wavSource:false,currentWavPlan:null});
    fireEvent.click(screen.getByRole('radio',{name:/Servidor \(opcional\)/}));
    expect(props.onChangeMode).toHaveBeenCalledWith('server');
    expect(props.onPrepareServer).not.toHaveBeenCalled();
    expect(props.onDownload).not.toHaveBeenCalled();
  });
});
