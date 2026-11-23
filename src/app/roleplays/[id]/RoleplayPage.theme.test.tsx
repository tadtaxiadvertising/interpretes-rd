// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/auth/actions', () => ({ getResolvedIdentity: vi.fn().mockResolvedValue(null) }));
vi.mock('./RoleplayClient', () => ({
  RoleplayClient: ({ sessionId }: { sessionId: string }) => <div data-testid="roleplay-client">{sessionId}</div>,
}));

import RoleplayPage from './page';

afterEach(() => cleanup());

describe('Roleplay page appearance', () => {
  it('scopes legacy Roleplay components to the experience light/dark palette without changing identity inputs', async () => {
    const node = await RoleplayPage({ params: Promise.resolve({ id: 'session-theme-1' }) });
    const { container } = render(node);
    expect(container.firstElementChild?.classList.contains('theme-experience')).toBe(true);
    expect(screen.getByTestId('roleplay-client').textContent).toBe('session-theme-1');
  });
});
