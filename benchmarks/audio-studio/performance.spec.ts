import { expect, test } from '@playwright/test';
import type { BenchmarkSample } from './fixture';

function summarize(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const percentile = (p: number) => sorted[Math.ceil(sorted.length * p) - 1];
  return { samples: sorted.length, median: percentile(0.5), p95: percentile(0.95), max: sorted[sorted.length - 1] };
}

test('profiles real Chromium timeline commits with a synthetic maximum-size project', async ({ page, context, browser }, testInfo) => {
  const blocked: string[] = [];
  await context.route('**/*', async route => {
    if (new URL(route.request().url()).origin === 'http://127.0.0.1:4178') return route.continue();
    blocked.push(new URL(route.request().url()).origin);
    await route.abort();
  });
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Escala de intervenciones' }).selectOption('0');
  await expect(page.getByTestId('studio-window-segment')).toHaveCount(100);
  await expect(page.getByRole('button', { name: /^Intervención: Intervención / })).toHaveCount(100);
  await expect(page.getByText('Vista de tiempo simplificada')).toBeVisible();

  const cdp = await context.newCDPSession(page);
  try {
    await cdp.send('Performance.enable');
    await page.evaluate(() => window.runStudioBenchmark(8));
    const before = await cdp.send('Performance.getMetrics');
    const result: BenchmarkSample = await page.evaluate(() => window.runStudioBenchmark(64));
    const after = await cdp.send('Performance.getMetrics');
    const metric = (values: typeof before.metrics, name: string) =>
      values.find(item => item.name === name)?.value ?? null;
    const deltas = Object.fromEntries(['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration'].map(name => {
      const initial = metric(before.metrics, name), final = metric(after.metrics, name);
      return [name, initial === null || final === null ? null : (final - initial) * 1000];
    }));
    const report = {
      schemaVersion: 1,
      browser: browser.version(),
      viewport: page.viewportSize(),
      project: { intervals: 100, simulatedDurationSeconds: 43200 },
      ticks: result.ticks,
      commitMs: summarize(result.commitMs),
      frameIntervalMs: summarize(result.frameIntervalMs),
      cumulativeRendererMetricDeltasMs: deltas,
      heapUsedBytesBefore: metric(before.metrics, 'JSHeapUsedSize'),
      heapUsedBytesAfter: metric(after.metrics, 'JSHeapUsedSize'),
      intervalReads: result.intervalReads,
      mediaReads: result.mediaReads,
      blockedExternalRequests: blocked.length,
      rawSamples: { commitMs: result.commitMs, frameIntervalMs: result.frameIntervalMs },
    };
    await testInfo.attach('audio-studio-performance.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
    expect(result.intervalReads).toBe(0);
    expect(result.mediaReads).toBe(0);
    expect(blocked).toHaveLength(0);
    expect(result.commitMs).toHaveLength(64);
    expect(result.frameIntervalMs).toHaveLength(64);
    await expect(page.getByRole('slider', { name: 'Posición en la ventana temporal' })).toHaveValue(String(result.finalPosition));
  } finally {
    await cdp.detach();
  }
});
