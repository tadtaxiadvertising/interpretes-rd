import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    <a href={href} {...props}>{children}</a>,
}));

import { RecruitmentFollowUp } from './RecruitmentFollowUp';

describe('Recruitment follow-up messages', () => {
  it('provides a real candidate portal link instead of a fake appointment scheduler', () => {
    const html = renderToStaticMarkup(<RecruitmentFollowUp applicationStatus="INTERVIEW_PENDING" />);
    expect(html).toContain('Consulta el avance de tu postulación');
    expect(html).toContain('href="/candidate"');
    expect(html).toContain('Ver mi candidatura');
    expect(html).toContain('No hay un calendario de entrevistas disponible');
    expect(html).not.toContain('Calendly');
    expect(html).not.toContain('Cal.com');
    expect(html).not.toContain('Selecciona tu horario');
  });

  it('shows a safe Spanish label for terminal statuses without exposing internal status codes', () => {
    const html = renderToStaticMarkup(<RecruitmentFollowUp terminal applicationStatus="REJECTED" />);
    expect(html).toContain('Tu proceso de selección ha finalizado');
    expect(html).toContain('Rechazado');
    expect(html).not.toContain('>REJECTED<');
    expect(html).toContain('href="/candidate"');
  });

  it('uses a neutral status label for unknown values', () => {
    const html = renderToStaticMarkup(<RecruitmentFollowUp terminal applicationStatus="UNKNOWN_PRIVATE_STATUS" />);
    expect(html).toContain('Sin estado');
    expect(html).not.toContain('UNKNOWN_PRIVATE_STATUS');
  });
});
