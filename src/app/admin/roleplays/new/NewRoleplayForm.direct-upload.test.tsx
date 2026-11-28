// @vitest-environment jsdom
import type { ComponentPropsWithoutRef } from 'react';
import userEvent from '@testing-library/user-event';
import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { afterEach,describe,expect,it,vi } from 'vitest';
const m=vi.hoisted(()=>({create:vi.fn(),upload:vi.fn(),consolidate:vi.fn(),publish:vi.fn()}));
vi.mock('@/lib/roleplay/direct-upload-browser-http',()=>({
  createConfiguredRoleplayUploadController:m.create,
  consolidatePreparedRoleplaySlot:m.consolidate,
  publishConsolidatedRoleplay:m.publish,
}));
vi.mock('next/link',()=>({default:(props:ComponentPropsWithoutRef<'a'>)=><a {...props}/>}));
vi.mock('./ScenarioCard',()=>({
  ScenarioCard:({scenario,onUpdate}:{scenario:{id:string};onUpdate:(id:string,updates:Record<string,unknown>)=>void})=>
    <button type="button" onClick={()=>onUpdate(scenario.id,{title:'Consulta de prueba',baseAudioFile:new File(['ID3'],'synthetic.mp3',{type:'audio/mpeg'}),studioTurn:1,studioLanguage:'en'})}>Preparar escenario</button>,
}));
import NewRoleplayForm from './NewRoleplayForm';
afterEach(()=>{cleanup();vi.resetAllMocks();vi.unstubAllGlobals();});
describe('gated private roleplay form',()=>{
  it('keeps one controller and one reservation after uncertain publication',async()=>{
    const fetcher=vi.fn();
    vi.stubGlobal('fetch',fetcher);
    const key='123e4567-e89b-42d3-a456-426614174000';
    m.create.mockReturnValue({run:m.upload});
    m.upload.mockResolvedValue({requestKey:key,verifiedCount:1,total:1});
    m.consolidate.mockResolvedValue({verifiedCount:1,total:1,complete:true});
    m.publish.mockRejectedValueOnce(new Error('private provider detail')).mockResolvedValueOnce({sessionId:'session-123',scenarioCount:1,inviteLink:window.location.origin+'/roleplays/session-123'});
    render(<NewRoleplayForm interpreters={[{id:11,name:'Intérprete sintético'}]} candidates={[]} openingAssignmentEnabled directUploadEnabled/>);
    fireEvent.change(screen.getByLabelText(/Destinatario ·/),{target:{value:'11'}});
    fireEvent.click(screen.getByRole('button',{name:'Preparar escenario'}));
    fireEvent.click(screen.getByRole('button',{name:'Crear roleplay'}));
    await waitFor(()=>expect(screen.getByText(/La operación se interrumpió/)).toBeTruthy());
    expect(screen.getByLabelText(/Destinatario ·/).closest('fieldset')?.disabled).toBe(true);
    expect(screen.getByText('Consolidados: 1 de 1')).toBeTruthy();
    expect(document.body.textContent).not.toContain('private provider detail');
    fireEvent.click(screen.getByRole('button',{name:'Continuar creación'}));
    await waitFor(()=>expect(screen.getByText('¡Roleplay creado correctamente!')).toBeTruthy());
    expect(m.create).toHaveBeenCalledTimes(1);
    expect(m.upload).toHaveBeenCalledTimes(1);
    expect(m.consolidate).toHaveBeenCalledTimes(1);
    expect(m.publish).toHaveBeenCalledTimes(2);
    expect(m.publish.mock.calls[0].slice(0,3)).toEqual(m.publish.mock.calls[1].slice(0,3));
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('gated creation receipt recovery form', () => {
  const key = '123e4567-e89b-42d3-a456-426614174000';
  const complete = { status: 'COMPLETED', sessionIds: ['session-123'], createdCount: 1, skippedCount: 0, scenarioCount: 1 };
  it('retains the same key, locks editing and never resends the audio after a lost response', async () => {
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => key) });
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new Error('connection lost'))
      .mockResolvedValueOnce(Response.json({ success: true, data: { status: 'NOT_FOUND' } }))
      .mockResolvedValueOnce(Response.json({ success: true, data: complete }));
    vi.stubGlobal('fetch', fetcher);
    render(<NewRoleplayForm interpreters={[{id:11,name:'Intérprete sintético'}]} candidates={[]} creationRecoveryEnabled/>);
    fireEvent.change(screen.getByLabelText(/Destinatario ·/), { target: { value: '11' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preparar escenario' }));
    fireEvent.click(screen.getByRole('button', { name: 'Crear roleplay' }));
    const check = await screen.findByRole('button', { name: 'Consultar resultado sin reenviar audios' });
    expect(screen.getByLabelText('Referencia del intento')).toHaveProperty('value', 'rp1:' + key + ':1');
    expect(screen.getByLabelText(/Destinatario ·/).closest('fieldset')?.disabled).toBe(true);
    expect(fetcher.mock.calls[0][0]).toBe('/api/admin/roleplays');
    expect(fetcher.mock.calls[0][1].headers).toEqual({ 'Idempotency-Key': key });
    fireEvent.click(screen.getByRole('button', { name: 'Crear roleplay' }));
    expect(fetcher).toHaveBeenCalledTimes(1);
    fireEvent.click(check);
    await screen.findByText(/Esto no demuestra que la creación haya fallado/);
    fireEvent.click(screen.getByRole('button', { name: 'Consultar resultado sin reenviar audios' }));
    await screen.findByText(/Creación confirmada mediante el recibo/);
    expect(fetcher).toHaveBeenCalledTimes(3);
    for (const call of fetcher.mock.calls.slice(1)) {
      expect(call[0]).toBe('/api/admin/roleplays/creation-receipt');
      expect(call[1].body).toBe(JSON.stringify({ requestKey: key }));
    }
    expect(screen.queryByRole('button', { name: 'Consultar resultado sin reenviar audios' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Crear roleplay' })).toHaveProperty('disabled', true);
  });
  it.each([true, false])('restores a saved reference with new keyed creation enabled=%s', async creationRecoveryEnabled => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ success: true, data: complete }));
    vi.stubGlobal('fetch', fetcher);
    render(<NewRoleplayForm interpreters={[{id:11,name:'Intérprete sintético'}]} candidates={[]} creationRecoveryEnabled={creationRecoveryEnabled} receiptRecoveryEnabled/>);
    fireEvent.click(screen.getByText('Recuperar una creación anterior'));
    if (!creationRecoveryEnabled) expect(screen.getByText(/La creación con clave está pausada/)).toBeTruthy();
    const input = screen.getByLabelText('Referencia de recuperación');
    fireEvent.change(input, { target: { value: 'invalid' } });
    fireEvent.click(screen.getByRole('button', { name: 'Recuperar intento anterior' }));
    expect(screen.getByRole('alert').textContent).toContain('referencia de recuperación válida');
    expect(fetcher).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'rp1:' + key + ':1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Recuperar intento anterior' }));
    await screen.findByText(/Creación confirmada mediante el recibo/);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/admin/roleplays/creation-receipt', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestKey: key }), cache: 'no-store',
    });
    expect(screen.getByRole('button', { name: 'Crear roleplay' })).toHaveProperty('disabled', true);
    expect(screen.queryByText('¡Roleplay creado correctamente!')).toBeNull();
  });

  it('submits recovery via Enter, associates validation errors, and never creates a session', async () => {
    const user = userEvent.setup();
    const fetcher = vi.fn().mockResolvedValue(Response.json({ success: true, data: complete }));
    vi.stubGlobal('fetch', fetcher);
    render(<NewRoleplayForm interpreters={[{id:11,name:'Intérprete sintético'}]} candidates={[]} receiptRecoveryEnabled/>);
    await user.click(screen.getByText('Recuperar una creación anterior'));
    const input = screen.getByLabelText('Referencia de recuperación');
    expect(input.getAttribute('autocapitalize')).toBe('none');
    expect(input.getAttribute('autocorrect')).toBe('off');
    await user.click(input);
    await user.keyboard('invalid{Enter}');
    const error = screen.getByRole('alert');
    expect(input.getAttribute('aria-describedby')).toBe(error.id);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(fetcher).not.toHaveBeenCalled();
    await user.clear(input);
    await user.type(input, 'rp1:' + key + ':1');
    expect(input.hasAttribute('aria-describedby')).toBe(false);
    await user.keyboard('{Enter}');
    await screen.findByText(/Creación confirmada mediante el recibo/);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/admin/roleplays/creation-receipt', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestKey: key }), cache: 'no-store',
    });
    expect(screen.getByRole('button', { name: 'Crear roleplay' })).toHaveProperty('disabled', true);
  });

  it('warns before a full page exit only for unresolved receipts and preserves the tab when reviewing sessions', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ success: true, data: { status: 'IN_PROGRESS' } }))
      .mockResolvedValueOnce(Response.json({ success: true, data: complete }));
    vi.stubGlobal('fetch', fetcher);
    const { unmount } = render(<NewRoleplayForm interpreters={[{id:11,name:'Intérprete sintético'}]} candidates={[]} receiptRecoveryEnabled/>);
    const exitPrevented = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(exitPrevented()).toBe(false);
    fireEvent.click(screen.getByText('Recuperar una creación anterior'));
    fireEvent.change(screen.getByLabelText('Referencia de recuperación'), { target: { value: 'rp1:' + key + ':1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Recuperar intento anterior' }));
    await screen.findByText(/La creación está pendiente de confirmación/);
    expect(exitPrevented()).toBe(true);
    const link = screen.getByRole('link', { name: 'Consultar roleplays existentes (nueva pestaña)' });
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    fireEvent.click(screen.getByRole('button', { name: 'Consultar resultado sin reenviar audios' }));
    await screen.findByText(/Creación confirmada mediante el recibo/);
    expect(exitPrevented()).toBe(false);
    expect(screen.getByRole('link', { name: 'Consultar roleplays existentes' }).hasAttribute('target')).toBe(false);
    unmount();
    expect(exitPrevented()).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.every(call => call[0] === '/api/admin/roleplays/creation-receipt')).toBe(true);
  });

  it('removes the native exit warning when an unresolved form unmounts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ success: true, data: { status: 'NOT_FOUND' } })));
    const { unmount } = render(<NewRoleplayForm interpreters={[]} candidates={[]} receiptRecoveryEnabled/>);
    fireEvent.click(screen.getByText('Recuperar una creación anterior'));
    fireEvent.change(screen.getByLabelText('Referencia de recuperación'), { target: { value: 'rp1:' + key + ':1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Recuperar intento anterior' }));
    await screen.findByText(/Esto no demuestra que la creación haya fallado/);
    const pending = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(pending);
    expect(pending.defaultPrevented).toBe(true);
    unmount();
    const after = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });

  it('does not send a new keyed request in receipt-only mode', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ success: true, data: {
      sessionId: 'legacy-session', scenarioCount: 1, inviteLink: window.location.origin + '/roleplays/legacy-session',
    } }));
    vi.stubGlobal('fetch', fetcher);
    render(<NewRoleplayForm interpreters={[{id:11,name:'Intérprete sintético'}]} candidates={[]} receiptRecoveryEnabled/>);
    expect(screen.getByText('Recuperar una creación anterior')).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Destinatario ·/), { target: { value: '11' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preparar escenario' }));
    fireEvent.click(screen.getByRole('button', { name: 'Crear roleplay' }));
    await screen.findByText('¡Roleplay creado correctamente!');
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][0]).toBe('/api/admin/roleplays');
    expect(fetcher.mock.calls[0][1].headers).toBeUndefined();
  });

  it('does not offer recovery when the receipt endpoint is disabled', () => {
    render(<NewRoleplayForm interpreters={[{id:11,name:'Intérprete sintético'}]} candidates={[]} creationRecoveryEnabled receiptRecoveryEnabled={false}/>);
    expect(screen.queryByText('Recuperar una creación anterior')).toBeNull();
  });

});
