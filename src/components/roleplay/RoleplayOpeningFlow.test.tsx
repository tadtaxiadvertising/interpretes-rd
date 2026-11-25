// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RoleplayOpeningFlow } from './RoleplayOpeningFlow';

const m = vi.hoisted(() => ({ upload: vi.fn(), from: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ storage: { from: (bucket: string) => (m.from(bucket), { uploadToSignedUrl: m.upload }) } }) }));
vi.mock('./RoleplayOpening', () => ({
  RoleplayOpening: ({ onSave }: { onSave: (url: string, duration: number, blob: Blob) => Promise<void> }) =>
    <button onClick={() => void onSave('blob:test', 999, new Blob(['audio'], { type: 'audio/webm' })).catch(() => {})}>Guardar apertura</button>,
}));
const path = 'openings/session-1/123e4567-e89b-42d3-a456-426614174000.webm';
const success = (data: object) => Response.json({ success: true, data });

beforeEach(() => { vi.resetAllMocks(); m.upload.mockResolvedValue({ error: null }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('opening participant flow', () => {
  it('uploads privately and advances only after server confirmation without sending client duration', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(success({ state: 'pending' }))
      .mockResolvedValueOnce(success({ path, token: 'test-token' }))
      .mockResolvedValueOnce(success({ state: 'confirmed' }));
    vi.stubGlobal('fetch', fetchMock);
    const next = vi.fn();
    render(<RoleplayOpeningFlow sessionId="session-1" onContinue={next} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Guardar apertura' }));
    await waitFor(() => expect(next).toHaveBeenCalledOnce());
    expect(m.from).toHaveBeenCalledWith('roleplay-opening-private');
    expect(m.upload).toHaveBeenCalledWith(path, 'test-token', expect.any(Blob), { contentType: 'audio/webm', upsert: false });
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ action: 'confirm', path });
  });

  it('recovers an already uploaded reservation after reload without recording again', async () => {
    const reservation = { path, expiresAt: '2099-01-01T00:00:00Z', retryAt: null };
    const fetchMock = vi.fn().mockResolvedValueOnce(success({ state: 'pending', reservation }))
      .mockResolvedValueOnce(success({ state: 'confirmed' }));
    vi.stubGlobal('fetch', fetchMock);
    const next = vi.fn();
    render(<RoleplayOpeningFlow sessionId="session-1" onContinue={next} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reintentar confirmación' }));
    await waitFor(() => expect(next).toHaveBeenCalledOnce());
    expect(m.upload).not.toHaveBeenCalled();
  });

  it('recovers a committed opening when the confirmation response is lost', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(success({ state: 'pending' }))
      .mockResolvedValueOnce(success({ path, token: 'test-token' }))
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(success({ state: 'confirmed' })));
    const next = vi.fn();
    render(<RoleplayOpeningFlow sessionId="session-1" onContinue={next} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Guardar apertura' }));
    await waitFor(() => expect(next).toHaveBeenCalledOnce());
  });
});

it('lets the participant discard an incomplete reservation and return to recording', async () => {
  const reservation = { path, expiresAt: '2099-01-01T00:00:00Z', retryAt: null };
  const fetchMock = vi.fn().mockResolvedValueOnce(success({ state: 'pending', reservation }))
    .mockResolvedValueOnce(success({ state: 'pending' })).mockResolvedValueOnce(success({ state: 'pending' }));
  vi.stubGlobal('fetch', fetchMock);
  const next = vi.fn();
  render(<RoleplayOpeningFlow sessionId="session-1" onContinue={next} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Descartar y volver a grabar' }));
  await screen.findByRole('button', { name: 'Guardar apertura' });
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ action: 'discard', path });
  expect(next).not.toHaveBeenCalled();
  expect(m.upload).not.toHaveBeenCalled();
});
