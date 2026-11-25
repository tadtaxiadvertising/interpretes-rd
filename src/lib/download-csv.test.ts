// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadCsv } from './download-csv';

const createObjectURL = vi.fn(() => 'blob:csv-test');
const revokeObjectURL = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('CSV browser download lifecycle', () => {
  it('downloads the original payload and releases the temporary URL after clicking', () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('sample.csv');
      expect(this.href).toBe('blob:csv-test');
      expect(this.isConnected).toBe(true);
    });
    downloadCsv('Nombre,Importe\nEjemplo,120', 'sample.csv');
    expect(click).toHaveBeenCalledOnce();
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(document.querySelector('a[download="sample.csv"]')).toBeNull();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:csv-test');
  });

  it('cleans up the link and URL if the download click throws', () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { throw new Error('download failed'); });
    expect(() => downloadCsv('sample', 'sample.csv')).toThrow('download failed');
    expect(document.querySelector('a[download="sample.csv"]')).toBeNull();
    vi.advanceTimersByTime(1_000);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:csv-test');
  });
});
