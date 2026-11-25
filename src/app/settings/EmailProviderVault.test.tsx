import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

  it.each([
    { dailyUsed: 100, monthlyUsed: 0, periodValid: true },
    { dailyUsed: 0, monthlyUsed: 500, periodValid: true },
    { dailyUsed: 0, monthlyUsed: 0, periodValid: false },
  ])('blocks a test when quota is unavailable: %j', async usage => {
    actions.listEmailProviderProfiles.mockResolvedValueOnce({
      ...ready, quotas: [{ ...ready.quotas[0], ...usage }],
    });
    render(<EmailProviderVault />);
    fireEvent.click(screen.getByRole('button', { name: 'Consultar perfiles' }));
    const button = await screen.findByRole('button', { name: 'Enviar prueba a este remitente' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(actions.testSavedEmailProvider).not.toHaveBeenCalled();
  });

  it('blocks a test with no matching provider quota', async () => {
    actions.listEmailProviderProfiles.mockResolvedValueOnce({ ...ready, quotas: [] });
    render(<EmailProviderVault />);
    fireEvent.click(screen.getByRole('button', { name: 'Consultar perfiles' }));
    const button = await screen.findByRole('button', { name: 'Enviar prueba a este remitente' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText('No hay presupuesto local consultado para realizar una prueba.')).toBeTruthy();
    fireEvent.click(button);
    expect(actions.testSavedEmailProvider).not.toHaveBeenCalled();
  });

  it('explains that an available test consumes a shared local attempt', async () => {
    await loadProfiles();
    const button = screen.getByRole('button', { name: 'Enviar prueba a este remitente' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    const hint = document.getElementById(button.getAttribute('aria-describedby') ?? '');
    expect(hint?.textContent).toContain('reserva un intento del presupuesto local compartido');
  });

  it('distinguishes an exhausted preferred provider from an active transport', async () => {
    actions.listEmailProviderProfiles.mockResolvedValueOnce({
      ...ready, preferredId: 'profile-1',
      profiles: [{ ...ready.profiles[0], testAcceptedAt: 'accepted', receiptConfirmedAt: 'confirmed' }],
      quotas: [{ ...ready.quotas[0], dailyUsed: 100 }],
    });
    render(<EmailProviderVault />);
    fireEvent.click(screen.getByRole('button', { name: 'Consultar perfiles' }));
    await screen.findByText('Preferencia sin disponibilidad local: Presupuesto local agotado. Revisa los límites antes de elegir.');
    expect(screen.getByRole('heading', { name: 'Proveedor preferido: Perfil de prueba' })).toBeTruthy();
    expect(screen.queryByText(/Recepción confirmada · .* intentos locales restantes/)).toBeNull();
  });

  it('shows low local availability without requiring the preference to be editable', async () => {
    actions.listEmailProviderProfiles.mockResolvedValueOnce({
      ...ready, preferredId: 'profile-1', preferenceEditable: false,
      profiles: [{ ...ready.profiles[0], testAcceptedAt: 'accepted', receiptConfirmedAt: 'confirmed' }],
      quotas: [{ ...ready.quotas[0], dailyUsed: 95 }],
    });
    render(<EmailProviderVault />);
    fireEvent.click(screen.getByRole('button', { name: 'Consultar perfiles' }));
    await screen.findByText('Recepción confirmada · 5 intentos locales restantes.');
    expect(screen.getByText('El presupuesto del proveedor preferido está próximo a agotarse.')).toBeTruthy();
  });

  it('does not assume availability when the preferred profile is missing from the listing', async () => {
    actions.listEmailProviderProfiles.mockResolvedValueOnce({ ...ready, preferredId: 'missing' });
    render(<EmailProviderVault />);
    fireEvent.click(screen.getByRole('button', { name: 'Consultar perfiles' }));
    await screen.findByText('El perfil preferido no figura en la consulta. No se puede comprobar su disponibilidad local.');
  });

  it('invalidates a snapshot after an uncertain replacement and prevents stale resubmission', async () => {
    await loadProfiles();
    actions.replaceSavedEmailProvider.mockResolvedValueOnce('unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Editar configuración / clave' }));
    fireEvent.change(screen.getByLabelText('Clave API (nueva o vigente)'), { target: { value: 'fixture-key' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar reemplazo' }));
    await screen.findByText('No se pudo confirmar el reemplazo. Consulta los perfiles antes de repetir la operación.');
    expect(screen.queryByRole('button', { name: 'Guardar reemplazo' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Editar configuración / clave' })).toBeNull();
    expect(actions.replaceSavedEmailProvider).toHaveBeenCalledTimes(1);
  });

  it('invalidates a snapshot after an uncertain retirement', async () => {
    await loadProfiles();
    actions.retireSavedEmailProvider.mockResolvedValueOnce('unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Desactivar perfil' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar desactivación' }));
    await screen.findByText('No se pudo confirmar la desactivación. Consulta los perfiles antes de repetir la operación.');
    expect(screen.queryByRole('button', { name: 'Confirmar desactivación' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Desactivar perfil' })).toBeNull();
    expect(actions.retireSavedEmailProvider).toHaveBeenCalledTimes(1);
  });

  it('refreshes a duplicate replacement conflict without preserving a submitted secret', async () => {
    await loadProfiles();
    actions.replaceSavedEmailProvider.mockResolvedValueOnce('already_saved');
    actions.listEmailProviderProfiles.mockResolvedValueOnce(ready);
    fireEvent.click(screen.getByRole('button', { name: 'Editar configuración / clave' }));
    const key = screen.getByLabelText('Clave API (nueva o vigente)') as HTMLInputElement;
    fireEvent.change(key, { target: { value: 'fixture-key' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar reemplazo' }));
    await screen.findByText(/Ya existe un perfil activo de este proveedor y remitente/);
    expect(actions.listEmailProviderProfiles).toHaveBeenCalledTimes(2);
    expect(key.value).toBe('');
    expect(screen.getByRole('button', { name: 'Guardar reemplazo' })).toBeTruthy();
  });

  it('closes editing when a fresh consultation reports the profile retired', async () => {
    await loadProfiles();
    fireEvent.click(screen.getByRole('button', { name: 'Editar configuración / clave' }));
    actions.listEmailProviderProfiles.mockResolvedValueOnce({
      ...ready, profiles: [{ ...ready.profiles[0], retiredAt: '2026-11-25T01:00:00Z' }],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Consultar perfiles' }));
    await screen.findByText('Desactivado (histórico)');
    expect(screen.queryByRole('button', { name: 'Guardar reemplazo' })).toBeNull();
    actions.listEmailProviderProfiles.mockResolvedValueOnce(ready);
    fireEvent.click(screen.getByRole('button', { name: 'Consultar perfiles' }));
    await screen.findByRole('button', { name: 'Editar configuración / clave' });
    expect(screen.queryByRole('button', { name: 'Guardar reemplazo' })).toBeNull();
  });

  it('sends the original budget limits and refreshes a concurrent change', async () => {
    await loadProfiles();
    actions.saveEmailProviderBudget.mockResolvedValueOnce('budget_conflict');
    actions.listEmailProviderProfiles.mockResolvedValueOnce({
      ...ready, quotas: [{ ...ready.quotas[0], dailyLimit: 80, monthlyLimit: 400 }],
    });
    fireEvent.change(screen.getByLabelText('Máximo diario'), { target: { value: '60' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar presupuesto' }));
    await screen.findByText(/El presupuesto cambió o ya no está disponible/);
    expect(actions.saveEmailProviderBudget).toHaveBeenCalledExactlyOnceWith({
      provider: 'brevo', dailyLimit: 60, monthlyLimit: 500, expectedDailyLimit: 100, expectedMonthlyLimit: 500,
    });
    expect((screen.getByLabelText('Máximo diario') as HTMLInputElement).value).toBe('80');
    expect((screen.getByLabelText('Máximo mensual') as HTMLInputElement).value).toBe('400');
    expect((screen.getByRole('button', { name: 'Guardar presupuesto' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('requires explicit consultation after an uncertain budget save', async () => {
    await loadProfiles();
    actions.saveEmailProviderBudget.mockResolvedValueOnce('unavailable');
    fireEvent.change(screen.getByLabelText('Máximo diario'), { target: { value: '60' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar presupuesto' }));
    await screen.findByText('No se pudo confirmar el cambio de presupuesto. Consulta los perfiles antes de repetir la operación.');
    expect(screen.queryByRole('button', { name: 'Guardar presupuesto' })).toBeNull();
    expect(actions.listEmailProviderProfiles).toHaveBeenCalledTimes(1);
    expect(actions.saveEmailProviderBudget).toHaveBeenCalledTimes(1);
    actions.listEmailProviderProfiles.mockResolvedValueOnce({
      ...ready, quotas: [{ ...ready.quotas[0], dailyLimit: 60 }],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Consultar perfiles' }));
    await screen.findByRole('button', { name: 'Guardar presupuesto' });
    expect((screen.getByLabelText('Máximo diario') as HTMLInputElement).value).toBe('60');
    expect((screen.getByRole('button', { name: 'Guardar presupuesto' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the confirmed budget save separately from a failed refresh', async () => {
    await loadProfiles();
    actions.saveEmailProviderBudget.mockResolvedValueOnce('budget_saved');
    actions.listEmailProviderProfiles.mockRejectedValueOnce(new Error('offline'));
    fireEvent.change(screen.getByLabelText('Máximo diario'), { target: { value: '60' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar presupuesto' }));
    await screen.findByText('Presupuesto guardado. El consumo acumulado no ha cambiado.');
    expect(screen.getByText(/No se pudieron actualizar los perfiles/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Guardar presupuesto' })).toBeNull();
  });

  it('requires a fresh consultation when choosing a preference has an uncertain outcome', async () => {
    const verified = { ...ready, profiles: [{ ...ready.profiles[0], testAcceptedAt: 'accepted', receiptConfirmedAt: 'confirmed' }] };
    actions.listEmailProviderProfiles.mockResolvedValueOnce(verified);
    actions.setPreferredEmailProvider.mockResolvedValueOnce('unavailable');
    render(<EmailProviderVault />);
    fireEvent.click(screen.getByRole('button', { name: 'Consultar perfiles' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Elegir como proveedor preferido' }));
    await screen.findByText('No se pudo confirmar el cambio de preferencia. Consulta los perfiles antes de repetir la operación.');
    expect(screen.queryByRole('button', { name: 'Elegir como proveedor preferido' })).toBeNull();
    expect(actions.setPreferredEmailProvider).toHaveBeenCalledExactlyOnceWith('profile-1');
    expect(actions.listEmailProviderProfiles).toHaveBeenCalledTimes(1);
    actions.listEmailProviderProfiles.mockResolvedValueOnce({ ...verified, preferredId: 'profile-1' });
    fireEvent.click(screen.getByRole('button', { name: 'Consultar perfiles' }));
    await screen.findByRole('heading', { name: 'Proveedor preferido: Perfil de prueba' });
    expect(screen.queryByRole('button', { name: 'Elegir como proveedor preferido' })).toBeNull();
  });

  it('invalidates outdated selection controls after an uncertain clear', async () => {
    actions.listEmailProviderProfiles.mockResolvedValueOnce({ ...ready, preferredId: 'profile-1' });
    actions.setPreferredEmailProvider.mockResolvedValueOnce('unavailable');
    render(<EmailProviderVault />);
    fireEvent.click(screen.getByRole('button', { name: 'Consultar perfiles' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Quitar preferencia' }));
    await screen.findByText(/No se pudo confirmar el cambio de preferencia/);
    expect(screen.queryByRole('button', { name: 'Quitar preferencia' })).toBeNull();
    expect(actions.setPreferredEmailProvider).toHaveBeenCalledExactlyOnceWith(null);
    expect(actions.listEmailProviderProfiles).toHaveBeenCalledTimes(1);
  });

  it('preserves a confirmed preference outcome when refreshing fails', async () => {
    actions.listEmailProviderProfiles.mockResolvedValueOnce({ ...ready, preferredId: 'profile-1' });
    actions.setPreferredEmailProvider.mockResolvedValueOnce('preference_cleared');
    actions.listEmailProviderProfiles.mockRejectedValueOnce(new Error('offline'));
    render(<EmailProviderVault />);
    fireEvent.click(screen.getByRole('button', { name: 'Consultar perfiles' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Quitar preferencia' }));
    await screen.findByText('Preferencia eliminada.');
    expect(screen.getByText(/No se pudieron actualizar los perfiles/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Quitar preferencia' })).toBeNull();
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
  const alternativesFixture = {
    ...ready,
    preferredId: 'profile-1',
    profiles: [
      { ...ready.profiles[0], testAcceptedAt: 'accepted', receiptConfirmedAt: 'confirmed' },
      { ...ready.profiles[0], id: 'same-provider', name: 'Misma cuota', testAcceptedAt: 'accepted', receiptConfirmedAt: 'confirmed' },
      { ...ready.profiles[0], id: 'backup', name: 'Alternativa Resend', provider: 'resend', testAcceptedAt: 'accepted', receiptConfirmedAt: 'confirmed' },
      { ...ready.profiles[0], id: 'backup-2', name: 'Segundo Resend', provider: 'resend', testAcceptedAt: 'accepted', receiptConfirmedAt: 'confirmed' },
      { ...ready.profiles[0], id: 'untested', name: 'Sin verificar', provider: 'resend' },
    ],
    quotas: [...ready.quotas, { provider: 'resend', dailyLimit: 50, dailyUsed: 10, monthlyLimit: 100, monthlyUsed: 20 }],
  };

  it('offers verified independent profiles only and requires confirmation for the quick selection', async () => {
    actions.listEmailProviderProfiles.mockResolvedValueOnce(alternativesFixture);
    render(<EmailProviderVault />);
    fireEvent.click(screen.getByRole('button', { name: 'Consultar perfiles' }));
    const selector = await screen.findByLabelText('Elegir alternativa verificada') as HTMLSelectElement;
    expect(within(selector).getAllByRole('option').map(option => (option as HTMLOptionElement).value)).toEqual(['', 'backup', 'backup-2']);
    const button = screen.getByRole('button', { name: 'Guardar alternativa preferida' }) as HTMLButtonElement;
    const confirmation = screen.getByRole('checkbox', { name: 'Confirmo el cambio de preferencia, sin activar envíos.' }) as HTMLInputElement;
    fireEvent.change(selector, { target: { value: 'backup' } });
    expect(button.disabled).toBe(true);
    fireEvent.click(confirmation);
    expect(button.disabled).toBe(false);
    fireEvent.change(selector, { target: { value: 'backup-2' } });
    expect(confirmation.checked).toBe(false);
    expect(button.disabled).toBe(true);
    expect(actions.setPreferredEmailProvider).not.toHaveBeenCalled();
    fireEvent.click(confirmation);
    actions.setPreferredEmailProvider.mockResolvedValueOnce('preferred_saved');
    actions.listEmailProviderProfiles.mockResolvedValueOnce({ ...alternativesFixture, preferredId: 'backup-2' });
    fireEvent.click(button);
    await screen.findByRole('heading', { name: 'Proveedor preferido: Segundo Resend' });
    expect(actions.setPreferredEmailProvider).toHaveBeenCalledExactlyOnceWith('backup-2');
    expect(actions.testSavedEmailProvider).not.toHaveBeenCalled();
  });

  it('does not permit quick selection while the preference is locked', async () => {
    actions.listEmailProviderProfiles.mockResolvedValueOnce({ ...alternativesFixture, preferenceEditable: false });
    render(<EmailProviderVault />);
    fireEvent.click(screen.getByRole('button', { name: 'Consultar perfiles' }));
    expect((await screen.findByLabelText('Elegir alternativa verificada') as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Guardar alternativa preferida' }) as HTMLButtonElement).disabled).toBe(true);
    expect(actions.setPreferredEmailProvider).not.toHaveBeenCalled();
  });

  it('clears the quick selection on refresh so stale confirmation cannot be reused', async () => {
    actions.listEmailProviderProfiles.mockResolvedValueOnce(alternativesFixture);
    render(<EmailProviderVault />);
    fireEvent.click(screen.getByRole('button', { name: 'Consultar perfiles' }));
    const selector = await screen.findByLabelText('Elegir alternativa verificada') as HTMLSelectElement;
    fireEvent.change(selector, { target: { value: 'backup' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Confirmo el cambio de preferencia, sin activar envíos.' }));
    actions.listEmailProviderProfiles.mockResolvedValueOnce(alternativesFixture);
    fireEvent.click(screen.getByRole('button', { name: 'Consultar perfiles' }));
    await waitFor(() => expect(selector.value).toBe(''));
    expect((screen.getByRole('button', { name: 'Guardar alternativa preferida' }) as HTMLButtonElement).disabled).toBe(true);
    expect(actions.setPreferredEmailProvider).not.toHaveBeenCalled();
  });
});
