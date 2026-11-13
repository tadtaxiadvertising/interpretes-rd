// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import NewRoleplayForm from './NewRoleplayForm';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) =>
    <a href={href}>{children}</a>,
}));

describe('Admin roleplay new form: deterministic server/client initial markup', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const props = { interpreters: [], candidates: [] };

  it('reuses the same initial htmlFor/id values between server markup and browser render', () => {
    const html = renderToString(<NewRoleplayForm {...props} />);
    const ssr = new DOMParser().parseFromString(html, 'text/html');
    const serverIds = [...ssr.querySelectorAll('[id^="scenario-"]')].map(el => el.id);
    expect(serverIds).toEqual(expect.arrayContaining([
      'scenario-title-new-roleplay-initial-scenario',
      'scenario-duration-new-roleplay-initial-scenario',
      'scenario-prompt-new-roleplay-initial-scenario',
      'scenario-audio-new-roleplay-initial-scenario',
    ]));

    const { container } = render(<NewRoleplayForm {...props} />);
    const clientIds = [...container.querySelectorAll('[id^="scenario-"]')].map(el => el.id);
    expect(clientIds).toEqual(serverIds);

    const title = screen.getByLabelText('Scenario title');
    expect(title.id).toBe('scenario-title-new-roleplay-initial-scenario');
    expect(container.querySelector(`label[for="${title.id}"]`)).not.toBeNull();
  });

  it('still creates unique event-time IDs after adding cards', () => {
    const { container } = render(<NewRoleplayForm {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /Add Scenario/i }));

    const inputIds = [...container.querySelectorAll('input[id^="scenario-title-"]')]
      .map(el => el.id);
    expect(inputIds).toHaveLength(2);
    expect(new Set(inputIds).size).toBe(2);
    expect(inputIds[0]).toBe('scenario-title-new-roleplay-initial-scenario');
  });
});
