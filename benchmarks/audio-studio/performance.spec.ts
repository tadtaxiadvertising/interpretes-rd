import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
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
    const reportPath = testInfo.outputPath('audio-studio-performance.json');
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
    await testInfo.attach('audio-studio-performance.json', { path: reportPath, contentType: 'application/json' });
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


test('speaker cut labels and keyboard focus remain legible in both workspace themes', async ({ page }) => {
  await page.goto('/?contrast');
  await page.getByRole('combobox', { name: 'Escala de intervenciones' }).selectOption('0');
  await expect(page.getByRole('button', { name: /^Intervención: Intervención / })).toHaveCount(100);
  const excluded = page.getByRole('button', { name: 'Excluida: Corte excluido de prueba' });
  await expect(excluded).toBeVisible();
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => {
      document.documentElement.dataset.theme = value;
      document.getElementById('root')?.classList.add('theme-workspace');
    }, theme);
    const colors = await page.locator('.studio-timeline-cut').evaluateAll(nodes => {
      const luminance = (rgb: string) => {
        const channels = rgb.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(channel => {
          const value = channel / 255;
          return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        });
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      };
      return nodes.map(node => {
        const css = getComputedStyle(node);
        const a = luminance(css.color);
        const b = luminance(css.backgroundColor);
        return { ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), opacity: css.opacity, fill: css.backgroundColor };
      });
    });
    expect(colors).toHaveLength(101);
    expect(new Set(colors.map(color => color.fill)).size).toBe(6);
    for (const color of colors) {
      expect(color.ratio, theme).toBeGreaterThanOrEqual(4.5);
      expect(color.opacity, theme).toBe('1');
    }
    await expect(excluded).toHaveCSS('border-top-style', 'dashed');
    const selected = page.locator('.studio-timeline-cut[aria-pressed="true"]');
    await expect(selected).toHaveCount(1);
    await expect(selected).toHaveCSS('box-shadow', /inset/);
    await page.keyboard.press('Tab');
    await selected.focus();
    await expect(selected).toBeFocused();
    await expect(selected).toHaveCSS('outline-style', 'dashed');
    await expect(selected).toHaveCSS('outline-offset', '-4px');
  }
});
