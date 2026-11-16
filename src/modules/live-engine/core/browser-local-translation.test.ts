import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkLocalTranslation,
  createLocalTranslator,
  supportsLocalTranslation,
} from './browser-local-translation';

const translation = vi.fn(async (_text: string) => 'Hello');
const destroy = vi.fn();
const availability = vi.fn(async () => 'available');
const create = vi.fn(async () => ({ translate: translation, destroy }));

beforeEach(() => {
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('Translator', { availability, create });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('browser local Translator API safety boundary', () => {
  it('refuses unsupported browsers rather than using a server fallback', async () => {
    vi.stubGlobal('Translator', undefined);
    expect(supportsLocalTranslation()).toBe(false);
    expect(await checkLocalTranslation({ sourceLanguage: 'es', targetLanguage: 'en' })).toBe('unsupported');
    await expect(createLocalTranslator({ sourceLanguage: 'es', targetLanguage: 'en' }))
      .rejects.toThrow('ON_DEVICE_TRANSLATION_UNSUPPORTED');
  });

  it('refuses insecure origins', async () => {
    vi.stubGlobal('isSecureContext', false);
    expect(supportsLocalTranslation()).toBe(false);
    expect(await checkLocalTranslation({ sourceLanguage: 'en', targetLanguage: 'es' })).toBe('unsupported');
  });

  it('checks exact ES to EN pair without downloading or creating a model', async () => {
    expect(await checkLocalTranslation({ sourceLanguage: 'es', targetLanguage: 'en' })).toBe('available');
    expect(availability).toHaveBeenCalledWith({ sourceLanguage: 'es', targetLanguage: 'en' });
    expect(create).not.toHaveBeenCalled();
  });

  it('creates only from an explicit caller and destroys exactly once', async () => {
    const session = await createLocalTranslator({ sourceLanguage: 'en', targetLanguage: 'es' });
    expect(create).toHaveBeenCalledWith({ sourceLanguage: 'en', targetLanguage: 'es' });
    expect(await session.translate('  Good morning.  ')).toBe('Hello');
    expect(translation).toHaveBeenCalledWith('Good morning.', undefined);
    session.close();
    session.close();
    expect(destroy).toHaveBeenCalledTimes(1);
    await expect(session.translate('another text')).rejects.toThrow('LOCAL_TRANSLATOR_CLOSED');
  });

  it('rejects blank and very long input locally without invoking the model', async () => {
    const session = await createLocalTranslator({ sourceLanguage: 'es', targetLanguage: 'en' });
    await expect(session.translate('   ')).rejects.toThrow('EMPTY_TRANSLATION_INPUT');
    await expect(session.translate('x'.repeat(1801))).rejects.toThrow('TRANSLATION_INPUT_TOO_LONG');
    expect(translation).not.toHaveBeenCalled();
    session.close();
  });

  it('reports clamped local language-pack download progress', async () => {
    const progress = vi.fn();
    await createLocalTranslator({ sourceLanguage: 'es', targetLanguage: 'en' }, { onDownloadProgress: progress });
    const opts = create.mock.calls[0]?.[0] as unknown as { monitor: (monitor: { addEventListener: (name: string, cb: (event: { loaded: number }) => void) => void }) => void };
    let listener: ((event: { loaded: number }) => void) | undefined;
    opts.monitor({ addEventListener: (name, cb) => { expect(name).toBe('downloadprogress'); listener = cb; } });
    listener?.({ loaded: 2 });
    expect(progress).toHaveBeenCalledWith(1);
  });
});
