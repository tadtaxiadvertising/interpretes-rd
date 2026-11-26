import { expect, test, type Locator } from '@playwright/test';

// Read-only CSS fixture using the same classes as NotificationBell and
// NotificationHistory. No authenticated session, server actions or notice writes.
const sizes = [
  { width: 320, height: 568 },
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
];

async function contrast(sample: Locator) {
  return sample.evaluate(node => {
    const style = getComputedStyle(node);
    const luminance = (color: string) => {
      const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
      if (!channels || channels.length !== 3) throw new Error('Invalid computed color');
      const rgb = channels.map(channel => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    };
    const a = luminance(style.color);
    const b = luminance(style.backgroundColor);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
}

for (const theme of ['light', 'dark'] as const) {
  for (const size of sizes) {
    test(`notification panel CSS stays usable at ${size.width}px in ${theme}`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto('/login');
      await page.getByRole('button', { name: theme === 'light' ? 'Modo claro' : 'Modo oscuro' }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await page.evaluate(() => {
        const fixture = document.createElement('section');
        fixture.id = 'notification-responsive-fixture';
        fixture.style.cssText = 'position:fixed;inset:0;z-index:9999;background:var(--background)';
        fixture.innerHTML = `
          <div class="relative" style="position:absolute;right:16px;top:16px;width:44px;height:44px">
            <button class="min-h-11 min-w-11" data-testid="fixture-trigger">Avisos</button>
            <div data-testid="fixture-panel" class="notification-panel fixed inset-x-3 top-[4.5rem] z-50 flex max-h-[calc(100dvh-10rem-env(safe-area-inset-bottom))] flex-col overflow-y-auto overscroll-contain rounded-2xl border border-[var(--border)] bg-[var(--theme-panel)] text-[var(--foreground)] shadow-2xl sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:mt-2 sm:w-96">
              <div data-testid="fixture-header" class="sticky top-0 z-10 shrink-0 gap-2 px-3 py-2 border-b border-[var(--border)] flex justify-between items-center bg-[var(--theme-surface-muted)]">
                <div class="min-w-0"><h4 class="font-bold text-[var(--foreground)] text-base">Notificaciones</h4><span class="text-xs text-[var(--text-secondary)]">42 sin leer</span></div>
                <button data-testid="fixture-close" class="min-h-11 min-w-11 shrink-0 rounded-lg px-2 text-sm font-semibold text-[var(--theme-link)]">Cerrar</button>
              </div>
              <div class="flex shrink-0 flex-wrap items-center gap-2 px-3 py-2">
                <button data-testid="fixture-active" aria-pressed="true" class="notification-filter min-h-11 rounded-lg border px-3 text-sm">Todas</button>
                <button aria-pressed="false" class="notification-filter min-h-11 rounded-lg border px-3 text-sm">Sin leer</button>
              </div>
              <form class="shrink-0 space-y-2 p-3">
                <label class="block text-xs text-[var(--text-secondary)]">Buscar<input type="search" class="mt-1 block min-h-11 w-full rounded-lg border border-[var(--theme-control-border)] bg-[var(--theme-control-bg)] px-2 text-sm text-[var(--foreground)]" value="Evaluación"/></label>
                <div class="notification-dates">
                  <label class="min-w-0 text-xs text-[var(--text-secondary)]">Desde<input type="date" value="2026-11-01" class="mt-1 block min-h-11 w-full min-w-0 rounded-lg border border-[var(--theme-control-border)] bg-[var(--theme-control-bg)] px-2 text-sm text-[var(--foreground)]"/></label>
                  <label class="min-w-0 text-xs text-[var(--text-secondary)]">Hasta<input type="date" value="2026-11-25" class="mt-1 block min-h-11 w-full min-w-0 rounded-lg border border-[var(--theme-control-border)] bg-[var(--theme-control-bg)] px-2 text-sm text-[var(--foreground)]"/></label>
                </div>
                <button type="button" class="min-h-11 text-[var(--theme-link)]">Aplicar filtros</button>
              </form>
              <article data-testid="fixture-unread" data-unread="true" class="notification-item border-b border-[var(--border)] p-3 sm:p-4 text-sm">
                <p class="font-semibold">Sin leer</p><p class="break-words text-sm text-[var(--text-secondary)]">Evaluación disponible. ${'Mensaje de prueba '.repeat(30)}</p>
              </article>
              <article data-unread="false" class="notification-item border-b border-[var(--border)] p-3 sm:p-4 text-sm">Leída</article>
            </div>
          </div>`;
        document.body.appendChild(fixture);
      });
      try {
        const panel = page.getByTestId('fixture-panel');
        const close = page.getByTestId('fixture-close');
        const unread = page.getByTestId('fixture-unread');
        await expect(panel).toBeVisible();
        const bounds = await panel.boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(size.width + 1);
        expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(size.height + 1);
        await expect.poll(() => panel.evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
        for (const field of await panel.locator('input').all()) {
          await expect(field).toHaveCSS('color-scheme', theme);
          const dimensions = await field.boundingBox();
          expect(dimensions!.height).toBeGreaterThanOrEqual(44);
          expect(dimensions!.x).toBeGreaterThanOrEqual(bounds!.x);
          expect(dimensions!.x + dimensions!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width + 1);
          expect(await contrast(field)).toBeGreaterThanOrEqual(4.5);
        }
        await expect(unread).toHaveCSS('border-inline-start-width', '3px');
        expect(await contrast(unread)).toBeGreaterThanOrEqual(4.5);
        expect(await contrast(page.getByTestId('fixture-active'))).toBeGreaterThanOrEqual(4.5);
        expect((await close.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await panel.evaluate(node => { node.scrollTop = node.scrollHeight; });
        await expect.poll(async () => {
          const box = await close.boundingBox();
          return !!box && box.y >= bounds!.y - 1 && box.y + box.height <= bounds!.y + bounds!.height + 1;
        }).toBe(true);
        await page.getByTestId('fixture-trigger').focus();
        await page.keyboard.press('Tab');
        await expect(close).toBeFocused();
        await expect(close).toHaveCSS('outline-style', 'solid');
        await expect(close).toHaveCSS('outline-width', '2px');
      } finally {
        await page.locator('#notification-responsive-fixture').evaluate(node => node.remove());
      }
    });
  }
}
