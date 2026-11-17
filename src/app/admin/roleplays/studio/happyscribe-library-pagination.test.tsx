// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RoleplayStudioPage from './page';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) =>
    <a href={href} {...props}>{children}</a>,
}));

const item = (id: string, name: string) => ({
  id, name, state: 'done', language: 'en', durationSeconds: 90,
  createdAt: null, folder: null,
});
const a = 'a'.repeat(32);
const b = 'b'.repeat(32);
const c = 'c'.repeat(32);
const page = (data: ReturnType<typeof item>[], hasMore: boolean) =>
  Response.json({ success: true, data, hasMore, mediaImportEnabled: false });

describe('HappyScribe library on-demand pagination', () => {
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('fetches additional pages only on click, deduplicates, and preserves selection', async () => {
    const fetcher = vi.fn((_url: string, _init?: RequestInit) => {
      if (_url.endsWith('?page=0')) return Promise.resolve(page([item(a, 'First')], true));
      if (_url.endsWith('?page=1')) {
        return Promise.resolve(page([item(a, 'First duplicate'), item(b, 'Second')], false));
      }
      throw new Error('Unexpected provider call');
    });
    vi.stubGlobal('fetch', fetcher);
    render(<RoleplayStudioPage />);
    expect(fetcher).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Actualizar biblioteca' }));
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText('Transcripción de HappyScribe') as HTMLSelectElement).value).toBe(a);
    expect(screen.getByRole('button', { name: 'Cargar más transcripciones (50)' })).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cargar más transcripciones (50)' }));
    });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      '/api/admin/happyscribe/transcriptions?page=0',
      '/api/admin/happyscribe/transcriptions?page=1',
    ]);
    expect(fetcher.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true);
    const choices = screen.getByLabelText('Transcripción de HappyScribe') as HTMLSelectElement;
    expect(choices.value).toBe(a);
    expect(Array.from(choices.options).map(option => option.value)).toEqual(['', a, b]);
    expect(screen.getByText(/2 transcripciones cargadas/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cargar más transcripciones (50)' })).toBeNull();
  });

  it('refreshes only on demand, resets pages and replaces stale library items', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(page([item(a, 'First')], true))
      .mockResolvedValueOnce(page([item(b, 'Second')], false))
      .mockResolvedValueOnce(page([item(c, 'New library')], false));
    vi.stubGlobal('fetch', fetcher);
    render(<RoleplayStudioPage />);
    await act(async () => { fireEvent.click(screen.getByText('Actualizar biblioteca')); });
    await act(async () => { fireEvent.click(screen.getByText('Cargar más transcripciones (50)')); });
    fireEvent.change(screen.getByLabelText('Transcripción de HappyScribe'), { target: { value: b } });

    await act(async () => { fireEvent.click(screen.getByText('Actualizar biblioteca')); });
    const select = screen.getByLabelText('Transcripción de HappyScribe') as HTMLSelectElement;
    expect(Array.from(select.options).map(option => option.value)).toEqual(['', c]);
    expect(select.value).toBe(c);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      '/api/admin/happyscribe/transcriptions?page=0',
      '/api/admin/happyscribe/transcriptions?page=1',
      '/api/admin/happyscribe/transcriptions?page=0',
    ]);
    expect(screen.queryByText('Cargar más transcripciones (50)')).toBeNull();
  });

  it('aborts in-flight library page requests on unmount without downloading media', async () => {
    let listSignal: AbortSignal | undefined;
    let resolvePage!: (value: Response) => void;
    const pending = new Promise<Response>(resolve => { resolvePage = resolve; });
    const fetcher = vi.fn((_url: string, init?: RequestInit) => {
      if (_url.endsWith('?page=0')) return Promise.resolve(page([item(a, 'First')], true));
      listSignal = init?.signal as AbortSignal;
      return pending;
    });
    vi.stubGlobal('fetch', fetcher);
    const { unmount } = render(<RoleplayStudioPage />);
    await act(async () => { fireEvent.click(screen.getByText('Actualizar biblioteca')); });
    fireEvent.click(screen.getByText('Cargar más transcripciones (50)'));
    expect(listSignal).toBeDefined();
    expect(listSignal?.aborted).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(2);
    unmount();
    expect(listSignal?.aborted).toBe(true);
    await act(async () => { resolvePage(page([item(b, 'Late')], false)); await pending; });
    expect(fetcher.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true);
  });
});
