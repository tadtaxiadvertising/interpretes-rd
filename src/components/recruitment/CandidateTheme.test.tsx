import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/app/actions/auth', () => ({ updatePassword: vi.fn() }));
vi.mock('@/app/actions/roleplay', () => ({ startCandidateRoleplay: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { CandidatePasswordSetup } from './CandidatePasswordSetup';
import { CandidateRoleplayAction } from './CandidateRoleplayAction';

describe('Candidate appearance and form accessibility', () => {
  it('labels both password fields and retains the server action keys', () => {
    const html = renderToStaticMarkup(<CandidatePasswordSetup />);
    expect(html).toContain('for="candidate-new-password"');
    expect(html).toContain('id="candidate-new-password"');
    expect(html).toContain('name="password"');
    expect(html).toContain('for="candidate-confirm-password"');
    expect(html).toContain('id="candidate-confirm-password"');
    expect(html).toContain('name="confirmPassword"');
    expect(html).toContain('text-[var(--foreground)]');
    expect(html).toContain('bg-[#1764bf]');
  });

  it('keeps the roleplay action readable across light and dark themes', () => {
    const html = renderToStaticMarkup(<CandidateRoleplayAction label="Continuar Roleplay" />);
    expect(html).toContain('Continuar Roleplay');
    expect(html).toContain('bg-[#1764bf]');
    expect(html).toContain('hover:bg-[#1554a8]');
    expect(html).toContain('focus-visible:outline-2');
  });
});
