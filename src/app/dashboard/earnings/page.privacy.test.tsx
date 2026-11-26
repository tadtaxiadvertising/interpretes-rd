// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({
  actor: vi.fn(), find: vi.fn(), redirect: vi.fn((path: string): never => { throw new Error('REDIRECT:' + path); }),
}));
vi.mock('@/lib/auth/current-actor', () => ({ getCurrentActor: m.actor }));
vi.mock('@/lib/prisma', () => ({ default: { interpreter: { findUnique: m.find } } }));
vi.mock('next/navigation', () => ({ redirect: m.redirect }));
import EarningsPage from './page';

beforeEach(() => {
  vi.clearAllMocks();
  m.actor.mockResolvedValue({ role: 'interpreter', interpreterId: 7, email: 'example@example.test' });
  m.find.mockResolvedValue({ id: 7, name: 'Ejemplo', tariffPerMinute: 2, metodoPago: null, cuentaPago: '1234567890', payrollRecords: [], accountRates: [{ id: 4, tariffPerHour: 150.25, account: { name: 'Cuenta ejemplo' } }] });
});
afterEach(cleanup);

describe('private earnings page', () => {
  it('queries only the resolved interpreter ID and renders that profile’s special rates', async () => {
    render(await EarningsPage());
    expect(m.find).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ where: { id: 7 } }));
    expect(screen.getByText('Cuenta ejemplo')).toBeTruthy();
    expect(screen.getByText('RD$150.25/hora')).toBeTruthy();
    expect(screen.queryByText('1234567890')).toBeNull();
    expect(screen.getByText('•••• 7890')).toBeTruthy();
  });
  it.each([[null, '/login'], [{ role: 'admin', interpreterId: 7 }, '/admin'], [{ role: 'candidate', interpreterId: 7 }, '/candidate']] as const)('rejects unrelated actor %j', async (actor, route) => {
    m.actor.mockResolvedValueOnce(actor);
    await expect(EarningsPage()).rejects.toThrow('REDIRECT:' + route);
    expect(m.find).not.toHaveBeenCalled();
  });
  it('does not retrieve financial records for an unlinked interpreter', async () => {
    m.actor.mockResolvedValueOnce({ role: 'interpreter', interpreterId: null });
    render(await EarningsPage());
    expect(screen.getByText('Perfil no vinculado')).toBeTruthy();
    expect(m.find).not.toHaveBeenCalled();
  });
});
