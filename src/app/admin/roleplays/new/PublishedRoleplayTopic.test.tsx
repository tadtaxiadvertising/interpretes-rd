// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PublishedRoleplayTopic from './PublishedRoleplayTopic';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const selection = { topic: 'medical', subtopic: 'pharmacy' };
describe('post-publication topic save', () => {
  it('saves against the confirmed session and retries only classification after a failure', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ success: false }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ success: true }) });
    vi.stubGlobal('fetch', fetcher);
    render(<PublishedRoleplayTopic sessionId="session-123" selection={selection}/>);
    const retry = await screen.findByRole('button', { name: 'Reintentar solo clasificación' });
    expect(screen.getByRole('status').textContent).toContain('El roleplay está creado');
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Tema y subtema guardados'));
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const [url, options] of fetcher.mock.calls) {
      expect(url).toBe('/api/admin/roleplays/library/topics');
      expect(JSON.parse(options.body)).toEqual({ sessionId: 'session-123', ...selection });
    }
  });
  it('does not retry or claim success on a conflicting category', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 409 }));
    render(<PublishedRoleplayTopic sessionId="session-123" selection={selection}/>);
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('No se cambió la clasificación'));
    expect(screen.queryByRole('button', { name: 'Reintentar solo clasificación' })).toBeNull();
  });
});
