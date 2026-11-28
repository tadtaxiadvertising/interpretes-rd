// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
  it('puts direct preparation before optional download and desktop instructions',()=>{
    const {props}=setup({segmentCount:1, expandedEditor:false, publicationPlan:{parts:[parts[0]],issue:null},
      currentWavPlan:{parts:[{key:'a',bytes:1024}],issue:null}});
    const direct=screen.getByRole('button',{name:'Preparar WAV local para asignación'});
    const alternative=screen.getByRole('region',{name:'Descarga del plan o paquete'});
    const download=within(alternative).getByRole('button',{name:'Descargar plan local de cortes (JSON)'});
    expect(direct.compareDocumentPosition(alternative) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(direct.className).toContain('theme-action-primary');
    expect(download.className).toContain('theme-action-secondary');
    expect(props.onPrepareLocal).not.toHaveBeenCalled();
    expect(props.onDownload).not.toHaveBeenCalled();
    fireEvent.click(download);
    expect(props.onDownload).toHaveBeenCalledOnce();
    expect(props.onPrepareLocal).not.toHaveBeenCalled();
  });
  it('promotes the local plan when browser preparation is unavailable',()=>{
    const {props}=setup({segmentCount:1,expandedEditor:false,localMp3Eligible:false,wavSource:false,currentWavPlan:null,
      publicationPlan:{parts:[parts[0]],issue:null}});
    const alternative=screen.getByRole('region',{name:'Descarga del plan o paquete'});
    expect(within(alternative).getByRole('heading',{name:'Preparar con el exportador de escritorio'})).toBeTruthy();
    expect(within(alternative).getByRole('button',{name:'Descargar plan local de cortes (JSON)'}).className).toContain('theme-action-primary');
    expect(props.onDownload).not.toHaveBeenCalled();
    expect(props.onPrepareServer).not.toHaveBeenCalled();
  });
  it('promotes the selected part download when full local browser preparation is unavailable',()=>{
    const {props}=setup({wavSource:false,localMp3Eligible:false,currentWavPlan:null,selectedPublicationPart:parts[1]});
    const part=screen.getByRole('button',{name:'Descargar parte seleccionada (JSON local)'});
    expect(part.className).toContain('theme-action-primary');
    fireEvent.click(part);
    expect(props.onDownloadPart).toHaveBeenCalledOnce();
    expect(props.onPrepareLocal).not.toHaveBeenCalled();
  });
  it('requests a mode change without starting a server export',()=>{
    const {props}=setup({segmentCount:1,expandedEditor:false,sourceRequiresLocal:false,localMp3Eligible:true,wavSource:false,currentWavPlan:null});
    fireEvent.click(screen.getByRole('radio',{name:/Servidor \(opcional\)/}));
    expect(props.onChangeMode).toHaveBeenCalledWith('server');
    expect(props.onPrepareServer).not.toHaveBeenCalled();
    expect(props.onDownload).not.toHaveBeenCalled();
  });
});


describe('next preparation step', () => {
  const hint = () => screen.getByRole('status', { name: 'Siguiente paso de preparación' }).textContent;
  it('explains the missing selection without preparing anything', () => {
    const { props, rerender } = setup();
    expect(hint()).toContain('Selecciona una parte');
    rerender(<StudioFinalizationPanel {...props} selectedPublicationPart={parts[1]}/>);
    expect(hint()).toContain('Prepara los cortes WAV locales');
    expect(props.onPrepareLocal).not.toHaveBeenCalled();
    expect(props.onPrepareServer).not.toHaveBeenCalled();
  });
  it.each([
    [{ hasAudio: false }, 'Selecciona una grabación válida'],
    [{ segmentCount: 0 }, 'Añade al menos una intervención'],
    [{ busy: true }, 'preparación en curso'],
    [{ draftBusy: true }, 'verificando el proyecto'],
    [{ analyzingSilences: true }, 'análisis de pausas'],
    [{ currentWavPlan: null }, 'Calculando la compatibilidad'],
    [{ publicationPlan: { parts: [], issue: 'Plan inválido' } }, 'Guarda el borrador ampliado'],
    [{ currentWavPlan: { parts: [], issue: 'WAV incompatible' } }, 'exportador de escritorio'],
    [{ wavSource: false, localMp3Eligible: true }, 'Habilita el procesamiento local MP3'],
    [{ wavSource: false, localMp3Eligible: false, segmentCount: 1 }, 'Descarga el plan local JSON'],
    [{ localOnly: false, segmentCount: 1 }, 'El original se enviará al servidor'],
    [{ readyAssignment: { token: 'opaque', partKey: 'a' } }, 'Continúa a asignación'],
  ] satisfies [Partial<ComponentProps<typeof StudioFinalizationPanel>>, string][])('guides the next action for %j', (overrides, expected) => {
    const { props } = setup(overrides);
    expect(hint()).toContain(expected);
    expect(props.onPrepareLocal).not.toHaveBeenCalled();
    expect(props.onPrepareServer).not.toHaveBeenCalled();
    expect(props.onDownload).not.toHaveBeenCalled();
  });
});

describe('finalization action guards', () => {
  it.each(['busy', 'draftBusy', 'analyzingSilences'] as const)('blocks export and preparation while %s', pending => {
    const { props } = setup({ selectedPublicationPart: parts[1], [pending]: true });
    const actions = [
      screen.getByRole('button', { name: 'Descargar parte seleccionada (JSON local)' }),
      screen.getByRole('button', { name: 'Preparar parte 2 en WAV local' }),
    ];
    for (const action of actions) {
      expect(action).toHaveProperty('disabled', true);
      fireEvent.click(action);
    }
    expect(screen.getByRole('combobox', { name: 'Parte del roleplay' })).toHaveProperty('disabled', true);
    expect(props.onPrepareLocal).not.toHaveBeenCalled();
    expect(props.onDownloadPart).not.toHaveBeenCalled();
  });
});
