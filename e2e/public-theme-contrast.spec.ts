import { test, expect, type Locator } from '@playwright/test';

// This suite is read-only: it never creates a user or submits an application.
function luminance(color: string) {
  const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  if (!channels || channels.length < 3) throw new Error(`Unexpected CSS color: ${color}`);
  const linear = channels.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

async function contrastRatio(element: Locator) {
  const { foreground, background } = await element.evaluate((node) => {
    const computed = window.getComputedStyle(node);
    return { foreground: computed.color, background: computed.backgroundColor };
  });
  const lightness = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lightness[0] + 0.05) / (lightness[1] + 0.05);
}

test('public application CTA is readable in both appearances and on hover', async ({ page }) => {
  await page.goto('/');
  const apply = page.locator('a[href="/postular"]').first();
  await expect(apply).toBeVisible();

  for (const mode of ['Modo claro', 'Modo oscuro']) {
    const toggle = page.getByRole('button', { name: mode });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(await contrastRatio(apply), `Contrast ratio for ${mode}`).toBeGreaterThanOrEqual(4.5);

    await apply.hover();
    await expect.poll(async () => await apply.evaluate((node) => getComputedStyle(node).backgroundColor))
      .toBe('rgb(21, 84, 168)');
    expect(await contrastRatio(apply), `Hover contrast for ${mode}`).toBeGreaterThanOrEqual(4.5);
  }
});

test('theme selection is preserved after navigation reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Modo claro' }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Modo claro' })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.locator('html').getAttribute('data-theme')).toBe('light');
});


test('light-mode login registration link is readable on its white card', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Modo claro' }).click();
  const link = page.getByRole('link', { name: 'Crear cuenta' });
  await expect(link).toBeVisible();
  const foreground = await link.evaluate((node) => getComputedStyle(node).color);
  const background = await page.locator('.theme-login .glass').evaluate((node) => getComputedStyle(node).backgroundColor);
  const levels = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  expect((levels[0] + 0.05) / (levels[1] + 0.05)).toBeGreaterThanOrEqual(4.5);
});
