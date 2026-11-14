import { describe, expect, it } from 'vitest';
import { detectLocalSpeech } from './local-vad';

function signal(sampleRate: number, seconds: number, active: Array<[number, number]>): Float32Array {
  const data = new Float32Array(Math.floor(sampleRate * seconds));
  for (const [start, end] of active) {
    for (let i = Math.floor(start * sampleRate); i < Math.min(data.length, Math.floor(end * sampleRate)); i++) {
      data[i] = 0.18 * Math.sin(2 * Math.PI * 220 * i / sampleRate);
    }
  }
  return data;
}

describe('local VAD', () => {
  it('detects separated speech-like intervals and applies bounded padding', () => {
    const sampleRate = 16000;
    const result = detectLocalSpeech([signal(sampleRate, 5, [[1, 2], [3, 4]])], sampleRate);

    expect(result).toHaveLength(2);
    expect(result[0].start).toBeLessThanOrEqual(1);
    expect(result[0].end).toBeGreaterThanOrEqual(2);
    expect(result[1].start).toBeGreaterThanOrEqual(2.8);
    expect(result.every((segment) => segment.end <= 5)).toBe(true);
  });

  it('returns no segments for silence or invalid input', () => {
    expect(detectLocalSpeech([new Float32Array(16000 * 3)], 16000)).toEqual([]);
    expect(detectLocalSpeech([], 16000)).toEqual([]);
    expect(detectLocalSpeech([new Float32Array(100), new Float32Array(99)], 16000)).toEqual([]);
    expect(detectLocalSpeech([new Float32Array(16000)], 0)).toEqual([]);
  });

  it('merges stereo activity when the quiet gap is shorter than the silence threshold', () => {
    const sampleRate = 16000;
    const left = signal(sampleRate, 3, [[0.5, 1.5]]);
    const right = signal(sampleRate, 3, [[1.7, 2.6]]);
    const result = detectLocalSpeech([left, right], sampleRate);

    expect(result).toHaveLength(1);
    expect(result[0].start).toBeLessThanOrEqual(0.5);
    expect(result[0].end).toBeGreaterThanOrEqual(2.6);
  });

  it('splits stereo activity when the quiet gap reaches the silence threshold', () => {
    const sampleRate = 16000;
    const left = signal(sampleRate, 4, [[0.5, 1.2]]);
    const right = signal(sampleRate, 4, [[2, 2.8]]);
    const result = detectLocalSpeech([left, right], sampleRate);

    expect(result).toHaveLength(2);
  });

  it('splits a short stereo pause when the configured silence threshold is lower', () => {
    const sampleRate = 16000;
    const left = signal(sampleRate, 3, [[0.5, 1.5]]);
    const right = signal(sampleRate, 3, [[1.7, 2.6]]);
    const result = detectLocalSpeech([left, right], sampleRate, {
      minSilenceDurationSec: 0.1,
    });

    expect(result).toHaveLength(2);
    expect(result[0].start).toBeLessThanOrEqual(0.5);
    expect(result[1].start).toBeGreaterThanOrEqual(1.5);
  });

  it('honors explicit RMS threshold and minimum speech duration', () => {
    const sampleRate = 16000;
    const data = signal(sampleRate, 3, [[0.5, 0.8], [1.5, 2.5]]);
    const result = detectLocalSpeech([data], sampleRate, {
      thresholdRms: 0.02,
      minSpeechDurationSec: 0.7,
    });

    expect(result).toHaveLength(1);
    expect(result[0].start).toBeLessThanOrEqual(1.5);
    expect(result[0].end).toBeGreaterThanOrEqual(2.5);
  });
});
