import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EmailProviderVault from './EmailProviderVault';

const actions = vi.hoisted(() => ({
  listEmailProviderProfiles: vi.fn(),
  importConfiguredEmailProvider: vi.fn(),
  addEmailProviderProfile: vi.fn(),
  testSavedEmailProvider: vi.fn(),
  confirmSavedProviderReceipt: vi.fn(),
  setPreferredEmailProvider: vi.fn(),
  saveEmailProviderBudget: vi.fn(),
  retireSavedEmailProvider: vi.fn(),
  replaceSavedEmailProvider: vi.fn(),
}));
vi.mock('@/app/actions/email-provider-vault', () => actions);

const ready = {
  status: 'ready',
  profiles: [{ id: 'profile-1', name: 'Perfil de prueba', provider: 'brevo', from: 'fixture@example.test', replyTo: '', updatedAt: '2026-11-25T00:00:00Z', testAcceptedAt: null, receiptConfirmedAt: null, retiredAt: null }],
  quotas: [{ provider: 'brevo', dailyLimit: 100, dailyUsed: 0, monthlyLimit: 500, monthlyUsed: 0 }],
  selectionPaused: true,
  preferenceEditable: true,
};

async function loadProfiles() {
  actions.listEmailProviderProfiles.mockResolvedValueOnce(ready);
  render(<EmailProviderVault />);
  fireEvent.click(screen.getByRole('button', { name: 'Consultar perfiles' }));
  await screen.findByText('Perfil de prueba · brevo');
}

describe('EmailProviderVault refresh failures', () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(cleanup);

  it('removes outdated controls when a refresh rejects', async () => {
    await loadProfiles();
    actions.listEmailProviderProfiles.mockRejectedValueOnce(new Error('offline'));
    fireEvent.click(screen.getByRole('button', { name: 'Consultar perfiles' }));
    await screen.findByText(/No se pudieron actualizar los perfiles/);
    expect(screen.queryByText('Perfil de prueba · brevo')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Enviar prueba a este remitente' })).toBeNull();
  });

  it('preserves operation outcome separately from an unsuccessful refresh', async () => {
    await loadProfiles();
    actions.testSavedEmailProvider.mockResolvedValueOnce('accepted');
    actions.listEmailProviderProfiles.mockResolvedValueOnce({ status: 'unavailable', profiles: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar prueba a este remitente' }));
    await screen.findByText('Proveedor aceptó la prueba. Comprueba el buzón.');
    expect(screen.getByText(/No se pudieron actualizar los perfiles/)).toBeTruthy();
    expect(screen.queryByText('Perfil de prueba · brevo')).toBeNull();
    expect(actions.testSavedEmailProvider).toHaveBeenCalledTimes(1);
  });

  it('keeps nonsecret fields after invalid input but clears credentials', async () => {
    await loadProfiles();
    actions.addEmailProviderProfile.mockResolvedValueOnce('invalid');
    const name = screen.getByLabelText('Nombre') as HTMLInputElement;
    const from = screen.getByLabelText('Remitente autorizado') as HTMLInputElement;
    const key = screen.getByLabelText('Clave API') as HTMLInputElement;
    fireEvent.change(name, { target: { value: 'Nuevo perfil' } });
    fireEvent.change(from, { target: { value: 'sender@example.test' } });
    fireEvent.change(key, { target: { value: 'fixture-key' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar perfil' }));
    await screen.findByText('Revisa los campos o la clave de cifrado.');
    expect(name.value).toBe('Nuevo perfil');
    expect(from.value).toBe('sender@example.test');
    expect(key.value).toBe('');
    expect(actions.addEmailProviderProfile).toHaveBeenCalledTimes(1);
  });

  it('clears nonsecret fields after a confirmed save', async () => {
    await loadProfiles();
    actions.addEmailProviderProfile.mockResolvedValueOnce('saved');
    actions.listEmailProviderProfiles.mockResolvedValueOnce(ready);
    const name = screen.getByLabelText('Nombre') as HTMLInputElement;
    const from = screen.getByLabelText('Remitente autorizado') as HTMLInputElement;
    const key = screen.getByLabelText('Clave API') as HTMLInputElement;
    fireEvent.change(name, { target: { value: 'Nuevo perfil' } });
    fireEvent.change(from, { target: { value: 'sender@example.test' } });
    fireEvent.change(key, { target: { value: 'fixture-key' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar perfil' }));
    await screen.findByText('Perfil guardado. No se activó para envíos.');
    expect(name.value).toBe('');
    expect(from.value).toBe('');
    expect(key.value).toBe('');
  });

  it('requires a fresh consultation when profile creation has an uncertain outcome', async () => {
    await loadProfiles();
    actions.addEmailProviderProfile.mockResolvedValueOnce('unavailable');
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Nuevo perfil' } });
    fireEvent.change(screen.getByLabelText('Remitente autorizado'), { target: { value: 'sender@example.test' } });
    fireEvent.change(screen.getByLabelText('Clave API'), { target: { value: 'fixture-key' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar perfil' }));
    await screen.findByText(/No se pudo confirmar si el perfil se guardó/);
    expect(screen.queryByRole('button', { name: 'Guardar perfil' })).toBeNull();
    expect(actions.addEmailProviderProfile).toHaveBeenCalledTimes(1);
  });

  it('recovers after a later successful consultation', async () => {
    await loadProfiles();
    actions.listEmailProviderProfiles.mockRejectedValueOnce(new Error('offline'));
    fireEvent.click(screen.getByRole('button', { name: 'Consultar perfiles' }));
    await screen.findByText(/No se pudieron actualizar los perfiles/);
    actions.listEmailProviderProfiles.mockResolvedValueOnce(ready);
    fireEvent.click(screen.getByRole('button', { name: 'Consultar perfiles' }));
    await screen.findByText('Perfil de prueba · brevo');
    await waitFor(() => expect(screen.queryByText(/No se pudieron actualizar los perfiles/)).toBeNull());
  });
});
