// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ getAgreement: vi.fn() }));
vi.mock('@/app/actions/onboarding', () => ({
  acceptTerms: vi.fn(),
  saveBankingDetails: vi.fn(),
  completeOnboarding: vi.fn(),
}));
vi.mock('@/app/actions/legal-agreements', () => ({
  getPublishedLegalAgreement: m.getAgreement,
}));
vi.mock('next/image', () => ({
  default: (props: { alt: string }) => <span role="img" aria-label={props.alt} />,
}));
vi.mock('./BankFormRD', () => ({
  BankFormRD: () => <div data-testid="bank-form-stub" />,
  isBankFormValid: () => false,
}));

import { OnboardingWizard } from './OnboardingWizard';

describe('Onboarding branding and appearance', () => {
  beforeEach(() => {
    window.localStorage.clear();
    m.getAgreement.mockResolvedValue({ success: false, error: 'Acuerdo no disponible' });
  });
  afterEach(() => cleanup());

  it('exposes brand and appearance choices within the modal, not behind its overlay', () => {
    const { container } = render(<OnboardingWizard initialStep={2} onComplete={() => {}} interpreterName="Intérprete" />);
    expect(container.firstElementChild?.classList.contains('theme-experience')).toBe(true);
    expect(screen.getByRole('img', { name: 'Logo de Intérpretes RD' })).toBeTruthy();
    expect(screen.getByText('Intérpretes RD')).toBeTruthy();

    const darkButton = screen.getByRole('button', { name: 'Modo oscuro' });
    fireEvent.click(darkButton);
    expect(document.documentElement.dataset.theme).toBe('dark');

    const lightButton = screen.getByRole('button', { name: 'Modo claro' });
    fireEvent.click(lightButton);
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('keeps the banking step and the step indicator reachable', () => {
    render(<OnboardingWizard initialStep={1} onComplete={() => {}} />);
    expect(screen.getByTestId('bank-form-stub')).toBeTruthy();
    expect(screen.getByText('PASO 2 DE 3')).toBeTruthy();
  });
});
