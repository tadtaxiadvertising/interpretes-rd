import { describe, expect, it } from 'vitest';
import { RECRUITMENT_EMAIL_KINDS, recruitmentEmailTemplate, renderRecruitmentEmail } from './recruitment-templates';

describe('recruitment operational email content', () => {
  it('defines four distinct corporate communications', () => {
    expect(RECRUITMENT_EMAIL_KINDS).toHaveLength(4);
    expect(new Set(RECRUITMENT_EMAIL_KINDS.map((kind) => renderRecruitmentEmail(kind).subject)).size).toBe(4);
  });

  it.each(RECRUITMENT_EMAIL_KINDS)('renders Spanish HTML and plain text for %s without sensitive data or active content', (kind) => {
    const template = recruitmentEmailTemplate(kind);
    const result = renderRecruitmentEmail(kind);
    expect(result.subject).toBe(template.subject);
    expect(result.subject).toContain('Intérpretes RD');
    expect(result.subject).not.toMatch(/[\r\n]/);
    expect(result.text).toContain(template.heading);
    expect(result.text).toContain(template.message);
    expect(result.text).toContain(template.nextStep);
    expect(result.html).toContain('<html lang="es">');
    expect(result.html).toContain(template.heading);
    expect(result.html).toContain(template.message);
    expect(result.html).toContain(template.nextStep);
    expect(result.html).toMatch(/<\/body><\/html>$/);
    expect(result.html).not.toMatch(/<script|<iframe|href=|src=|supabase\.co|@/i);
    expect(result.text).not.toMatch(/https?:\/\/|@/);
  });

  it('does not claim an interview date has been confirmed', () => {
    expect(renderRecruitmentEmail('interview_pending').text).toContain('no confirma una fecha ni una hora');
  });

  it('does not expose evaluation outcome in an email', () => {
    expect(renderRecruitmentEmail('review_available').text).not.toMatch(/aprobado|rechazado|reprobado|puntuación/i);
  });
});
