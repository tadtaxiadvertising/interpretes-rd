import { expect, test } from '@playwright/test';

/**
 * Read-only dark/light design audit, including WCAG AA contrast.
 * No user accounts, production data, applications, or reservations are touched.
 */
async function paletteContrast(
  page: import('@playwright/test').Page,
  foregroundToken: string,
  backgroundToken: string
) {
  return page.evaluate(([foregroundToken, backgroundToken]) => {
    const sample = document.createElement('span');
    sample.style.color = `var(${foregroundToken})`;
    sample.style.backgroundColor = `var(${backgroundToken})`;
    document.body.appendChild(sample);
    const computed = getComputedStyle(sample);
    const colors = [computed.color, computed.backgroundColor];
    sample.remove();

    const luminance = (color: string) => {
      const values = color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
      if (!values || values.length !== 3) throw new Error(`Invalid computed color: ${color}`);
      const rgb = values.map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
    };
    const [high, low] = colors.map(luminance).sort((a, b) => b - a);
    return (high + 0.05) / (low + 0.05);
  }, [foregroundToken, backgroundToken]);
}

test('brand, status and form tokens meet contrast requirements in both appearances', async ({ page }) => {
  await page.goto('/login');
  const semanticTokens = [
    '--foreground', '--theme-link', '--theme-success',
    '--theme-warning', '--theme-danger', '--theme-purple', '--theme-away', '--theme-info',
  ];

  for (const [mode, theme] of [['Modo claro', 'light'], ['Modo oscuro', 'dark']] as const) {
    await page.getByRole('button', { name: mode }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

    for (const token of semanticTokens) {
      expect(await paletteContrast(page, token, '--theme-panel'),
        `${theme}: ${token} on panel`).toBeGreaterThanOrEqual(4.5);
    }
    for (const token of ['--theme-success', '--theme-warning', '--theme-danger', '--theme-purple']) {
      expect(await paletteContrast(page, token, '--theme-track'),
        `${theme}: ${token} against the progress track`).toBeGreaterThanOrEqual(3);
    }
    expect(await paletteContrast(page, '--theme-control-border', '--theme-control-bg'),
      `${theme}: neutral form boundary`).toBeGreaterThanOrEqual(3);
  }
});

test('login, registration and application stay usable at phone width in both appearances', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });

  for (const route of ['/login', '/register', '/postular']) {
    await page.goto(route);
    for (const [mode, theme] of [['Modo claro', 'light'], ['Modo oscuro', 'dark']] as const) {
      await page.getByRole('button', { name: mode }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth > window.innerWidth + 1
      );
      expect(overflow, `${route} horizontal overflow in ${theme}`).toBe(false);
    }
  }
});

test('visible form controls follow the selected native color scheme', async ({ page }) => {
  await page.goto('/postular');
  const field = page.getByRole('textbox', { name: 'Correo electrónico' });
  await expect(field).toBeVisible();

  for (const [mode, theme] of [['Modo claro', 'light'], ['Modo oscuro', 'dark']] as const) {
    await page.getByRole('button', { name: mode }).click();
    await expect(field).toHaveCSS('color-scheme', theme);
    await field.focus();
    const outline = await field.evaluate((element) =>
      getComputedStyle(element).outlineStyle
    );
    expect(outline, `${theme} focused input outline`).not.toBe('none');
  }
});
