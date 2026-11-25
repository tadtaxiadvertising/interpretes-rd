import { expect, test, type Locator } from '@playwright/test';

/**
 * Exercise the compiled workspace CSS in Chromium without an authenticated
 * account, real payment details, or mutations. These samples use the same
 * utility combinations as the actual workspace, not an inline mock palette.
 * This complements, rather than replaces, an authenticated visual audit.
 */
async function contrast(sample: Locator, foreground = 'color') {
  return sample.evaluate((node, property) => {
    const style = getComputedStyle(node);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas unavailable');
    const luminance = (color: string) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const rgba = context.getImageData(0, 0, 1, 1).data;
      if (rgba[3] !== 255) throw new Error('Expected opaque sample: ' + color);
      const linear = [...rgba.slice(0, 3)].map(channel => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    };
    const [a, b] = [luminance(style.getPropertyValue(property)), luminance(style.backgroundColor)];
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }, foreground);
}

test('compiled workspace controls and solid actions retain contrast', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login');
  for (const [label, theme] of [['Modo claro', 'light'], ['Modo oscuro', 'dark']] as const) {
    await page.getByRole('button', { name: label }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.evaluate(() => {
      const fixture = document.createElement('section');
      fixture.id = 'workspace-contrast-fixture';
      fixture.className = 'theme-workspace bg-[var(--theme-panel)]';
      fixture.style.cssText = 'position:fixed;inset:0;z-index:9999;padding:20px;display:grid;align-content:start;gap:12px';
      fixture.innerHTML = `
        <p data-testid="semantic-text" class="bg-[var(--theme-panel)] text-[var(--foreground)]">Texto</p>
        <p data-testid="semantic-status" class="bg-[var(--theme-surface-muted)] text-[var(--theme-warning)]">Aviso</p>
        <input data-testid="workspace-field" class="border border-[var(--theme-control-border)] bg-[var(--theme-control-bg)] text-[var(--theme-control-text)]" value="Ejemplo" />
        <select data-testid="workspace-select" class="border border-[var(--theme-control-border)] bg-[var(--theme-control-bg)] text-[var(--theme-control-text)]"><option>Ejemplo</option></select>
        <button data-testid="workspace-action" class="bg-blue-600 hover:bg-blue-500 text-white">Guardar</button>
        <button data-testid="workspace-danger" class="bg-red-600 hover:bg-red-500 text-white">Cancelar</button>
        <button data-testid="semantic-primary" class="theme-action-primary">Guardar</button>
        <button data-testid="semantic-success" class="theme-action-success">Iniciar</button>
        <button data-testid="semantic-danger" class="theme-action-danger">Finalizar</button>
      `;
      document.body.appendChild(fixture);
    });
    try {
      for (const id of ['semantic-text', 'semantic-status', 'workspace-field', 'workspace-select']) {
        await expect.poll(() => contrast(page.getByTestId(id)), { message: theme + ': ' + id })
          .toBeGreaterThanOrEqual(4.5);
      }
      for (const id of ['workspace-field', 'workspace-select']) {
        const field = page.getByTestId(id);
        await expect(field).toHaveCSS('color-scheme', theme);
        await expect.poll(() => contrast(field, 'border-top-color')).toBeGreaterThanOrEqual(3);
      }
      // Shared actions must retain contrast on both themes, before and after hover.
      for (const id of ['semantic-primary', 'semantic-success', 'semantic-danger']) {
        const action = page.getByTestId(id);
        await expect(action).toHaveCSS('color', 'rgb(255, 255, 255)');
        await expect.poll(() => contrast(action)).toBeGreaterThanOrEqual(4.5);
        const normal = await action.evaluate(node => getComputedStyle(node).backgroundColor);
        await action.hover();
        await expect.poll(() => action.evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe(normal);
        await expect.poll(() => contrast(action)).toBeGreaterThanOrEqual(4.5);
        await page.mouse.move(0, 0);
      }
      // The legacy light overrides must not turn text on a solid CTA dark.
      if (theme === 'light') {
        for (const id of ['workspace-action', 'workspace-danger']) {
          const action = page.getByTestId(id);
          await expect.poll(() => contrast(action)).toBeGreaterThanOrEqual(4.5);
          await action.hover();
          await expect.poll(() => contrast(action)).toBeGreaterThanOrEqual(4.5);
        }
      }
    } finally {
      await page.locator('#workspace-contrast-fixture').evaluate(node => node.remove());
    }
  }
});
