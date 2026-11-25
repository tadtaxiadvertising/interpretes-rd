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
        <button data-testid="semantic-disabled" class="theme-action-primary disabled:opacity-50 hover:-translate-y-0.5 hover:scale-105 hover:shadow-lg" disabled>Guardando…</button>
        <span data-testid="workspace-motion" class="animate-pulse">Actualizando…</span>
        <a data-testid="semantic-link" class="theme-action-primary" href="#workspace-contrast-fixture">Importar y asignar</a>
        <button data-testid="semantic-secondary" class="theme-action-secondary">Cancelar</button>
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
      const link = page.getByTestId('semantic-link');
      await expect(link).toHaveCSS('color', 'rgb(255, 255, 255)');
      await expect.poll(() => contrast(link)).toBeGreaterThanOrEqual(4.5);
      await link.hover();
      await expect(link).toHaveCSS('background-color', 'rgb(0, 45, 114)');
      await expect.poll(() => contrast(link)).toBeGreaterThanOrEqual(4.5);

      const secondary = page.getByTestId('semantic-secondary');
      await expect.poll(() => contrast(secondary)).toBeGreaterThanOrEqual(4.5);
      await expect.poll(() => contrast(secondary, 'border-top-color')).toBeGreaterThanOrEqual(3);
      const secondaryBackground = await secondary.evaluate(node => getComputedStyle(node).backgroundColor);
      await secondary.hover();
      await expect.poll(() => secondary.evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe(secondaryBackground);
      await expect.poll(() => contrast(secondary)).toBeGreaterThanOrEqual(4.5);
      await expect.poll(() => contrast(secondary, 'border-top-color')).toBeGreaterThanOrEqual(3);

      const disabled = page.getByTestId('semantic-disabled');
      await expect(disabled).toBeDisabled();
      await expect(disabled).toHaveCSS('opacity', '1');
      await expect(disabled).toHaveCSS('cursor', 'not-allowed');
      await expect.poll(() => contrast(disabled)).toBeGreaterThanOrEqual(4.5);
      const disabledBackground = await disabled.evaluate(node => getComputedStyle(node).backgroundColor);
      const disabledBounds = await disabled.boundingBox();
      expect(disabledBounds).not.toBeNull();
      await disabled.hover();
      await expect(disabled).toHaveCSS('background-color', disabledBackground);
      // Chromium may serialize an unapplied transform as an identity matrix.
      // Check the effect rather than requiring a particular CSS serialization.
      await expect.poll(() => disabled.evaluate(node => {
        const style = getComputedStyle(node);
        const transform = style.transform === 'none' || new DOMMatrixReadOnly(style.transform).isIdentity;
        const neutral = (value: string, identity: number) =>
          value === 'none' || value.split(/\s+/).every(part => parseFloat(part) === identity);
        return transform && neutral(style.translate, 0) && neutral(style.scale, 1);
      })).toBe(true);
      await expect.poll(async () => {
        const hovered = await disabled.boundingBox();
        if (!hovered || !disabledBounds) return Infinity;
        return Math.max(
          Math.abs(hovered.x - disabledBounds.x),
          Math.abs(hovered.y - disabledBounds.y),
          Math.abs(hovered.width - disabledBounds.width),
          Math.abs(hovered.height - disabledBounds.height)
        );
      }).toBeLessThan(0.5);
      await expect(disabled).toHaveCSS('box-shadow', 'none');

      const motion = page.getByTestId('workspace-motion');
      await expect(motion).toHaveCSS('animation-iteration-count', '1');
      await expect(motion).toHaveCSS('animation-delay', '0s');
      const duration = await motion.evaluate(node => parseFloat(getComputedStyle(node).animationDuration));
      expect(duration).toBeLessThanOrEqual(0.001);


      await page.getByTestId('semantic-primary').focus();
      await page.keyboard.press('Tab');
      const focused = page.getByTestId('semantic-success');
      await expect(focused).toBeFocused();
      await expect(focused).toHaveCSS('outline-style', 'solid');
      await expect(focused).toHaveCSS('outline-width', '2px');

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

test('wide workspace tables can scroll with the keyboard at mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login');

  for (const [label, theme] of [['Modo claro', 'light'], ['Modo oscuro', 'dark']] as const) {
    await page.getByRole('button', { name: label }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.evaluate(() => {
      const fixture = document.createElement('section');
      fixture.id = 'table-scroll-fixture';
      fixture.className = 'theme-workspace';
      fixture.style.cssText = 'position:fixed;inset:0;z-index:9999;padding:16px;background:var(--theme-panel)';
      fixture.innerHTML = `
        <button data-testid="before-table">Antes</button>
        <div role="region" aria-label="Historial de ejemplo" tabindex="0" class="max-w-full overflow-x-auto">
          <table class="w-full min-w-[850px] text-left">
            <thead class="bg-[var(--theme-surface-muted)] text-[var(--text-secondary)]"><tr><th>Nombre</th><th>Estado</th></tr></thead>
            <tbody><tr><td>Ejemplo</td><td>Disponible</td></tr></tbody>
          </table>
        </div>`;
      document.body.appendChild(fixture);
    });
    try {
      const region = page.getByRole('region', { name: 'Historial de ejemplo' });
      await expect.poll(() => region.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
      await page.getByTestId('before-table').focus();
      await page.keyboard.press('Tab');
      await expect(region).toBeFocused();
      await expect(region).toHaveCSS('outline-style', 'solid');
      await expect(region).toHaveCSS('outline-width', '2px');
      await page.keyboard.press('ArrowRight');
      await expect.poll(() => region.evaluate(node => node.scrollLeft)).toBeGreaterThan(0);
    } finally {
      await page.locator('#table-scroll-fixture').evaluate(node => node.remove());
    }
  }
});

test('calendar summary columns scroll without overlapping the pinned interpreter', async ({ page }) => {
  await page.goto('/login');
  await page.evaluate(() => {
    const fixture = document.createElement('section');
    fixture.id = 'calendar-layout-fixture';
    fixture.className = 'theme-workspace';
    fixture.style.cssText = 'position:fixed;inset:0;z-index:9999;padding:16px;background:var(--theme-panel)';
    fixture.innerHTML = `
      <div data-testid="calendar-region" class="max-w-full overflow-x-auto">
        <table class="w-full text-left text-sm whitespace-nowrap border-collapse">
          <thead><tr>
            <th data-testid="calendar-name" class="p-4 xl:sticky xl:left-0 min-w-[220px] w-[220px] xl:min-w-[340px] xl:w-[340px] bg-[var(--theme-panel)]">Intérprete</th>
            <th data-testid="calendar-summary" class="p-4 min-w-[80px] w-[80px]">Mes actual</th>
            <th class="p-4 min-w-[80px] w-[80px]">Meta</th>
            <th class="p-4 min-w-[70px] w-[70px]">%</th>
            ${Array.from({ length: 31 }, (_, i) => '<th class="p-2 min-w-[48px]">' + (i + 1) + '</th>').join('')}
          </tr></thead>
        </table>
      </div>`;
    document.body.appendChild(fixture);
  });
  try {
    const region = page.getByTestId('calendar-region');
    const name = page.getByTestId('calendar-name');
    const summary = page.getByTestId('calendar-summary');
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(name).toHaveCSS('position', 'sticky');
    await expect(summary).not.toHaveCSS('position', 'sticky');
    const initialNameX = await name.evaluate(node => node.getBoundingClientRect().x);
    await region.evaluate(node => { node.scrollLeft = 250; });
    await expect.poll(() => name.evaluate((node, initialX) => Math.abs(node.getBoundingClientRect().x - initialX), initialNameX)).toBeLessThan(2);

    await page.setViewportSize({ width: 375, height: 812 });
    await region.evaluate(node => { node.scrollLeft = 0; });
    await expect(name).not.toHaveCSS('position', 'sticky');
    const mobileX = await name.evaluate(node => node.getBoundingClientRect().x);
    await region.evaluate(node => { node.scrollLeft = 250; });
    await expect.poll(() => name.evaluate(node => node.getBoundingClientRect().x)).toBeLessThan(mobileX - 100);
  } finally {
    await page.locator('#calendar-layout-fixture').evaluate(node => node.remove());
  }
});
