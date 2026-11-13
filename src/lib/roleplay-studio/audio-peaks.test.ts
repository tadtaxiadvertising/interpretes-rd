import { describe, expect, it } from 'vitest';
import {
  calculateWaveformPeaks,
  canRenderWaveform,
  WAVEFORM_MAX_PREVIEW_BYTES,
  WAVEFORM_MAX_PREVIEW_SECONDS,
} from './audio-peaks';

describe('Audio Studio local waveform safety and peak sampling', () => {
  it('enforces a memory-conscious preview envelope independent of export limits', () => {
    expect(canRenderWaveform(180, 2 * 1024 * 1024)).toBe(true);
    expect(canRenderWaveform(WAVEFORM_MAX_PREVIEW_SECONDS, WAVEFORM_MAX_PREVIEW_BYTES)).toBe(true);
    expect(canRenderWaveform(WAVEFORM_MAX_PREVIEW_SECONDS + 0.1, 1000)).toBe(false);
    expect(canRenderWaveform(60, WAVEFORM_MAX_PREVIEW_BYTES + 1)).toBe(false);
    expect(canRenderWaveform(Infinity, 1000)).toBe(false);
    expect(canRenderWaveform(Number.NaN, 1000)).toBe(false);
    expect(canRenderWaveform(0, 1000)).toBe(false);
    expect(canRenderWaveform(20, 0)).toBe(false);
  });

  it('creates deterministic peaks from both channels without amplifying silence', () => {
    const channels = [
      new Float32Array([0, 0, 0.25, 0, 0, 0, 0, 0]),
      new Float32Array([0, 0, -0.75, 0, 0, -0.5, 0, 0]),
    ];
    expect(calculateWaveformPeaks(channels, 4)).toEqual([0, 0.75, 0.5, 0]);
  });

  it('uses the shortest channel safely and discards corrupt non-finite samples', () => {
    const left = new Float32Array([0, Number.NaN, 0.2, 0.3, 0.9, 0]);
    const right = new Float32Array([0, 0.6, Number.POSITIVE_INFINITY, 0.4]);
    const peaks = calculateWaveformPeaks([left, right], 2);
    expect(peaks).toHaveLength(2);
    expect(peaks[0]).toBeCloseTo(0.6, 5);
    expect(peaks[1]).toBeCloseTo(0.4, 5);
  });

  it('fails closed for empty and excessive inputs', () => {
    expect(calculateWaveformPeaks([])).toEqual([]);
    expect(calculateWaveformPeaks([new Float32Array(0)])).toEqual([]);
    expect(calculateWaveformPeaks([new Float32Array([0.5])], 2000)).toEqual([]);
    expect(calculateWaveformPeaks([new Float32Array([0.5])], 0)).toEqual([]);
    expect(calculateWaveformPeaks([new Float32Array([2, -3])], 2)).toEqual([1, 1]);
  });
});
