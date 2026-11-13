import { describe, expect, it } from 'vitest';
import { parseFinalFfmpegOutputSeconds } from './ffmpeg-progress';

describe('FFmpeg progress verification', () => {
  it('extracts the last completed encoded duration', () => {
    const lines = [
      'out_time=00:00:00.480000',
      'progress=continue',
      'out_time_us=1200000',
      'out_time=00:00:01.200000',
      'progress=end',
    ];
    expect(parseFinalFfmpegOutputSeconds(lines.join('\n'))).toBe(1.2);
  });

  it('rejects absent and incomplete progress records', () => {
    expect(parseFinalFfmpegOutputSeconds('')).toBeNull();
    expect(parseFinalFfmpegOutputSeconds('out_time=00:00:02.000000\nprogress=continue')).toBeNull();
    expect(parseFinalFfmpegOutputSeconds('out_time=N/A\nprogress=end')).toBeNull();
    expect(parseFinalFfmpegOutputSeconds('out_time=00:00:99.000000\nprogress=end')).toBeNull();
    expect(parseFinalFfmpegOutputSeconds('out_time=00:60:02.000000\nprogress=end')).toBeNull();
  });

  it('uses the final record after earlier progress updates', () => {
    const lines = 'out_time=00:00:02.000000\nprogress=continue\nout_time=00:00:00.504792\nprogress=end';
    expect(parseFinalFfmpegOutputSeconds(lines)).toBeCloseTo(0.504792);
  });
});
