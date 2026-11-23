import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  submitApplicationAction: vi.fn(),
  getMyApplicationAction: vi.fn(),
  acknowledgeInductionAction: vi.fn(),
  startCandidateRoleplay: vi.fn(),
  routerPush: vi.fn(),
}));

vi.mock('@/app/actions/recruitment', () => ({
  submitApplicationAction: m.submitApplicationAction,
  getMyApplicationAction: m.getMyApplicationAction,
  acknowledgeInductionAction: m.acknowledgeInductionAction,
}));
vi.mock('@/app/actions/roleplay', () => ({ startCandidateRoleplay: m.startCandidateRoleplay }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: m.routerPush }) }));

import RecruitmentFunnel from './RecruitmentFunnel';

const notFound = { success: true, data: { found: false, funnelStep: 1 } };

function fillApplication() {
  fireEvent.change(screen.getByRole('textbox', { name: 'Nombre completo' }), {
    target: { value: 'María Pérez' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: 'Correo electrónico' }), {
    target: { value: 'candidate@example.test' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: 'Teléfono' }), {
    target: { value: '8095550199' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: 'País de residencia' }), {
    target: { value: 'República Dominicana' },
  });
}

async function submitFilledApplication() {
  fillApplication();
  fireEvent.change(screen.getByLabelText(/Enlace del certificado EFSET/), {
    target: { value: 'https://www.efset.org/cert/sample' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Enviar Postulación' }));
  await waitFor(() => expect(m.submitApplicationAction).toHaveBeenCalledTimes(1));
}

beforeEach(() => {
  vi.clearAllMocks();
  m.getMyApplicationAction.mockResolvedValue(notFound);
});
afterEach(() => cleanup());

describe('Registration completion and next actions', () => {
  it('marks the EFSET certificate link as required without changing validation rules', async () => {
    render(<RecruitmentFunnel />);
    const certificate = screen.getByLabelText(/Enlace del certificado EFSET/);
    expect(certificate.getAttribute('required')).not.toBeNull();
    expect(certificate.getAttribute('aria-describedby')).toBe('efset-certificate-help');
    expect(screen.getByText(/Debe ser un enlace HTTPS a tu certificado EFSET/)).toBeTruthy();

    fillApplication();
    fireEvent.click(screen.getByRole('button', { name: 'Enviar Postulación' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain(
      'El enlace HTTPS de tu certificado EFSET es obligatorio'
    ));
    expect(m.submitApplicationAction).not.toHaveBeenCalled();
  });

  it.each([
    ['existing', 'Iniciar sesión para continuar', '/login?next=%2Fcandidate'],
    ['manual', 'Crear acceso de candidato', '/register?next=%2Fcandidate'],
  ] as const)('provides an actionable route for %s candidate access', async (accountAccess, label, href) => {
    m.submitApplicationAction.mockResolvedValue({ success: true, accountAccess, alreadyApplied: false });
    render(<RecruitmentFunnel />);
    await submitFilledApplication();
    const link = await screen.findByRole('link', { name: label });
    expect(link.getAttribute('href')).toBe(href);
    expect(link.getAttribute('href')).not.toContain('candidate@example.test');
    expect(m.startCandidateRoleplay).not.toHaveBeenCalled();
  });

  it('offers secure login without revealing application identifiers for unowned existing email', async () => {
    m.submitApplicationAction.mockResolvedValue({ success: true, alreadyApplied: true });
    render(<RecruitmentFunnel />);
    await submitFilledApplication();
    const link = await screen.findByRole('link', { name: 'Iniciar sesión para continuar' });
    expect(link.getAttribute('href')).toBe('/login?next=%2Fcandidate');
    expect(link.getAttribute('href')).not.toContain('applicationId');
  });

  it('does not suggest login before activating an emailed invitation', async () => {
    m.submitApplicationAction.mockResolvedValue({ success: true, accountAccess: 'invited', alreadyApplied: false });
    render(<RecruitmentFunnel />);
    await submitFilledApplication();
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('enlace seguro'));
    expect(screen.queryByRole('link', { name: 'Iniciar sesión para continuar' })).toBeNull();
  });

  it('keeps account guidance visible after a transient step-restoration failure', async () => {
    m.getMyApplicationAction.mockRejectedValue(new Error('temporary network interruption'));
    m.submitApplicationAction.mockResolvedValue({ success: true, accountAccess: 'existing' });
    render(<RecruitmentFunnel />);
    await submitFilledApplication();
    expect(await screen.findByRole('link', { name: 'Iniciar sesión para continuar' })).toBeTruthy();
  });

  it('keeps direct next-action access when the server advances to induction', async () => {
    m.getMyApplicationAction
      .mockResolvedValueOnce(notFound)
      .mockResolvedValue({ success: true, data: {
        found: true, funnelStep: 2, terminal: false, applicationStatus: 'APPLIED',
        name: 'María Pérez', email: 'candidate@example.test',
      } });
    m.submitApplicationAction.mockResolvedValue({ success: true, accountAccess: 'existing' });
    render(<RecruitmentFunnel />);
    await submitFilledApplication();
    expect(await screen.findByRole('heading', { name: 'Conoce más sobre Intérpretes RD' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Iniciar sesión para continuar' }).getAttribute('href'))
      .toBe('/login?next=%2Fcandidate');
  });
});
